import {
  collection,
  getDocs,
  orderBy,
  query,
  where,
  type Firestore,
} from "firebase/firestore";
import { COL } from "./collections";
import type { WageWorkType } from "./enums";
import type { BoardBreakdown, BoardReconciliation, WorkLog } from "./types";
import { itemsFrom } from "./workLogs";

/**
 * Board reconciliation: what came in, what has been cut, what is left.
 *
 * The workshop holds boards that belong to its customers. "How many of mine have you
 * still got?" had no answer other than walking to the stack and counting, and a
 * customer who brought 40 boards and collected 30 had no way to check the other ten
 * were still there.
 *
 * Derived, never stored. Received comes from the jobs' board breakdowns; cut comes from
 * the work logs against those jobs. A stored remainder would drift from the two records
 * it is the difference between — and drift in a figure about somebody else's property
 * is the worst kind.
 */

/**
 * Board work types.
 *
 * Only the types that consume a whole board count as cutting one. `grooving` and
 * `glass` are measured in millimetres of run, and `mortise` is an operation performed
 * on a board already counted — including any of them would subtract thousands of
 * "boards" from a stack of forty.
 *
 * Used only as the fallback for entries that predate `boardsUsed`. New entries record
 * the sheets drawn explicitly, because a unit count is pieces cut and not sheets
 * consumed: 40 pieces routinely come out of 12 boards, and treating the two as the same
 * number claimed 40 sheets off a stack that only ever held 12.
 */
const BOARD_CONSUMING: WageWorkType[] = [
  "board",
  "only_cutting",
  "special_board",
];

/**
 * Boards on a job, from the tracker's per-material counts.
 *
 * `tape` is deliberately excluded: edge tape is measured in rolls, not sheets, and
 * adding it would inflate what the customer is owed back. It is reconciled separately
 * by `receivedTape` below.
 */
export function receivedBoards(boards: BoardBreakdown | undefined): number {
  if (!boards) return 0;
  return (
    (boards.egger ?? 0) +
    (boards.mdf ?? 0) +
    (boards.hdf ?? 0) +
    (boards.mfc_9x7 ?? 0) +
    (boards.mfc_9x4 ?? 0) +
    (boards.kwali ?? 0) +
    (boards.quarter ?? 0)
  );
}

/** Rolls of edge tape received on a job, counted apart from sheets. */
export function receivedTape(boards: BoardBreakdown | undefined): number {
  return boards?.tape ?? 0;
}

/**
 * Sheets drawn from the customer's stack by one work log.
 *
 * `boardsUsed` when the entry records it, which is the honest figure — the operator
 * says how many sheets they took. Only entries written before that field existed fall
 * back to summing board-consuming unit counts, and that fallback systematically
 * over-counts, because units are pieces cut rather than sheets consumed.
 *
 * The fallback is kept rather than treating old entries as zero: an entry that recorded
 * 26 boards cut did draw *something*, and zero would report those sheets as still on
 * site when the customer has already collected them.
 */
export function cutBoards(
  log: Pick<WorkLog, "workType" | "units" | "items" | "boardsUsed">
): number {
  if (Number.isFinite(log.boardsUsed) && (log.boardsUsed as number) >= 0) {
    return log.boardsUsed as number;
  }
  return itemsFrom(log)
    .filter((i) => BOARD_CONSUMING.includes(i.workType))
    .reduce((sum, i) => sum + i.units, 0);
}

/** Rolls of edge tape drawn by one work log. */
export function usedTape(log: Pick<WorkLog, "edgeTapeUsed">): number {
  return Number.isFinite(log.edgeTapeUsed) ? (log.edgeTapeUsed as number) : 0;
}

export interface JobBoardRow {
  jobId: string;
  jobNumber: string;
  customerId: string;
  customerName: string;
  status: string;
  receivedAtMs: number | null;
  receivedBoards: number;
  cutBoards: number;
  remainingBoards: number;
  overCut: number;
  receivedTape: number;
  usedTape: number;
  remainingTape: number;
}

/**
 * How many boards remain on a job, for the work-log over-draw check.
 *
 * Exported so the entry form can warn before the entry is saved: an operator taking
 * more sheets than the customer brought is either a mis-count or a mix-up with another
 * customer's stack, and both are far cheaper to catch at the machine than in a dispute
 * weeks later.
 *
 * `excludeLogId` lets a correction ignore its own prior contribution, or the entry being
 * edited would be counted against itself and appear to over-draw.
 */
export async function boardsRemainingOnJob(
  db: Firestore,
  jobId: string,
  excludeLogId?: string
): Promise<{
  received: number;
  used: number;
  remaining: number;
  /** Tape is checked too: over-drawing rolls is the same mistake in a different unit. */
  receivedTape: number;
  usedTape: number;
  remainingTape: number;
} | null> {
  const [jobSnap, logSnap] = await Promise.all([
    getDocs(query(collection(db, COL.serviceJobs), where("__name__", "==", jobId))),
    getDocs(query(collection(db, COL.workLogs), where("jobId", "==", jobId))),
  ]);

  const job = jobSnap.docs[0];
  if (!job) return null;

  const boards = job.data().boards as BoardBreakdown | undefined;
  const mine = logSnap.docs.filter((d) => d.id !== excludeLogId);

  const received = receivedBoards(boards);
  const used = mine.reduce((sum, d) => sum + cutBoards(d.data() as WorkLog), 0);

  const tapeIn = receivedTape(boards);
  const tapeOut = mine.reduce((sum, d) => sum + usedTape(d.data() as WorkLog), 0);

  return {
    received,
    used,
    remaining: received - used,
    receivedTape: tapeIn,
    usedTape: tapeOut,
    remainingTape: tapeIn - tapeOut,
  };
}

/**
 * Reconciles boards per job and per customer.
 *
 * One pass over jobs and one over work logs, joined on `jobId`. Work logs with no job
 * cannot be attributed to a customer's stack, so they are reported separately rather
 * than spread across jobs by guesswork — which is the whole reason the work log now
 * selects a job from a list instead of taking a typed number.
 */
export async function reconcileBoards(
  db: Firestore
): Promise<{
  byCustomer: BoardReconciliation[];
  byJob: JobBoardRow[];
  /** Materials drawn on logs with no job attached, so unattributable to a customer. */
  unattributedCutBoards: number;
  unattributedUsedTape: number;
}> {
  const [jobSnap, logSnap] = await Promise.all([
    getDocs(query(collection(db, COL.serviceJobs), orderBy("receivedAt", "desc"))),
    getDocs(collection(db, COL.workLogs)),
  ]);

  const cutByJob = new Map<string, number>();
  const tapeByJob = new Map<string, number>();
  let unattributedCutBoards = 0;
  let unattributedUsedTape = 0;

  for (const d of logSnap.docs) {
    const x = d.data() as WorkLog;

    /*
     * Which job the materials came off.
     *
     * An entry's items can each name their own job, because one shift can span two
     * customers. Where they do, the materials are attributed to the *first* item's job
     * rather than split, since `boardsUsed` is a single figure for the entry and there
     * is nothing to say how it divided. Where every item shares the entry's job — the
     * common case — this is simply that job.
     *
     * An entry whose items disagree and which draws materials is therefore approximate
     * at job level but exact at customer level whenever the jobs belong to one customer,
     * which is the case that matters for "how many of mine have you got".
     */
    const items = itemsFrom(x);
    const jobId = x.jobId ?? items.find((i) => i.jobId)?.jobId ?? null;

    const boards = cutBoards(x);
    const tape = usedTape(x);

    if (jobId) {
      if (boards > 0) cutByJob.set(jobId, (cutByJob.get(jobId) ?? 0) + boards);
      if (tape > 0) tapeByJob.set(jobId, (tapeByJob.get(jobId) ?? 0) + tape);
    } else {
      // Both materials are reported when the log names no job, not just boards. Tape
      // dropped here would leave rolls that left the shop still counted as on site — the
      // same drift in a figure about somebody else's property that boards are guarded
      // against.
      unattributedCutBoards += boards;
      unattributedUsedTape += tape;
    }
  }

  const byJob: JobBoardRow[] = [];
  const customers = new Map<string, BoardReconciliation>();

  for (const d of jobSnap.docs) {
    const x = d.data();
    // Cancelled jobs never happened, so their boards were not taken in against work.
    if (x.status === "cancelled") continue;

    const received = receivedBoards(x.boards as BoardBreakdown | undefined);
    const cut = cutByJob.get(d.id) ?? 0;
    // More cut than received is a data fault — a mis-keyed count, or boards received
    // that were never entered — so it is surfaced rather than clamped away and
    // forgotten.
    const overCut = Math.max(0, cut - received);
    const remaining = Math.max(0, received - cut);

    const tapeIn = receivedTape(x.boards as BoardBreakdown | undefined);
    const tapeOut = tapeByJob.get(d.id) ?? 0;

    const customerId = (x.customerId as string) ?? "";
    const customerName = (x.customerName as string) ?? "Unknown";

    byJob.push({
      jobId: d.id,
      jobNumber: x.jobNumber ?? "",
      customerId,
      customerName,
      status: x.status ?? "received",
      receivedAtMs: x.receivedAt?.toMillis?.() ?? null,
      receivedBoards: received,
      cutBoards: cut,
      remainingBoards: remaining,
      overCut,
      receivedTape: tapeIn,
      usedTape: tapeOut,
      remainingTape: Math.max(0, tapeIn - tapeOut),
    });

    if (!customerId) continue;

    const row =
      customers.get(customerId) ??
      ({
        customerId,
        customerName,
        receivedBoards: 0,
        cutBoards: 0,
        remainingBoards: 0,
        receivedTape: 0,
        usedTape: 0,
        remainingTape: 0,
        jobCount: 0,
        openJobCount: 0,
      } satisfies BoardReconciliation);

    row.receivedBoards += received;
    row.cutBoards += cut;
    row.receivedTape += tapeIn;
    row.usedTape += tapeOut;
    row.jobCount += 1;
    if (x.status !== "collected") row.openJobCount += 1;
    customers.set(customerId, row);
  }

  const byCustomer = [...customers.values()]
    .map((c) => ({
      ...c,
      // Summed at customer level from the customer's own totals rather than from the
      // per-job remainders: a job that over-cut and one that under-cut should net out
      // across the same customer's stack, which per-job flooring would hide.
      remainingBoards: Math.max(0, c.receivedBoards - c.cutBoards),
      overCut:
        c.cutBoards > c.receivedBoards ? c.cutBoards - c.receivedBoards : undefined,
      remainingTape: Math.max(0, c.receivedTape - c.usedTape),
    }))
    .filter(
      (c) => c.receivedBoards > 0 || c.cutBoards > 0 || c.receivedTape > 0
    )
    .sort((a, b) => b.remainingBoards - a.remainingBoards);

  return { byCustomer, byJob, unattributedCutBoards, unattributedUsedTape };
}

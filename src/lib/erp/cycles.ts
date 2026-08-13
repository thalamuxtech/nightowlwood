import {
  addDoc,
  collection,
  doc,
  getDoc,
  getDocs,
  limit as fsLimit,
  orderBy,
  query,
  serverTimestamp,
  Timestamp,
  updateDoc,
  where,
  writeBatch,
  type Firestore,
} from "firebase/firestore";
import { COL } from "./collections";
import { writeAudit, type AuditActor } from "./audit";
import {
  BOARD_TYPE_LABELS,
  CUTTING_WORK_TYPES,
  EDGING_WORK_TYPES,
  type BoardType,
  type WageWorkType,
} from "./enums";
import { sumKobo } from "./money";

/**
 * Blade and gum cycles — performance, not stock.
 *
 * The brief is explicit that this "is performance-cycle based, not quantity-based inventory". The
 * question is not how many blades are in the store; it is how many boards the last blade cut before
 * it went blunt, what that worked out to per board, and whether this brand is better than the last
 * one. A store count cannot answer any of that.
 *
 * ## How a cycle is bounded
 *
 * Issuing a new blade closes the previous one automatically. That is the brief's rule and it is also
 * the only honest reading of the event: the moment a fresh blade goes on the saw, whatever the old
 * one was going to do it has done. Nobody has to remember to close anything, which matters because
 * the thing people forget is the paperwork at the end.
 *
 * ## Where the boards come from
 *
 * Derived from the work logs between the two issue dates, never typed. A hand-entered figure is a
 * guess that looks like a measurement, and the work logs already hold the truth — that is what they
 * are for. `boardsUsed` on each log is the sheet count off the customer's stack, which is the number
 * that actually passed through the machine.
 *
 * ## Why blade and gum count different work
 *
 * A blade is consumed by cutting; gum is consumed by edging. The brief spells out the consequence:
 * "for gum, the calculation must use boards edged, not boards cut (omit only-cutting)". A board that
 * was only cut never reached the bander and used no gum, so counting it would flatter every gum
 * cycle. See `CUTTING_WORK_TYPES` and `EDGING_WORK_TYPES`.
 *
 * ## Cost recognition
 *
 * Issuing also books the cost as a service expense dated to the issue day, because the brief says
 * so plainly: "Cost is recognized only when a gum bag is issued to production. The issued value is
 * recorded as a Service Expense for the week or month of the issue date." Recognising it at purchase
 * would charge a bulk delivery of six bags to the week it arrived and leave the following five weeks
 * looking artificially profitable.
 */

/** What kind of consumable a cycle is for. */
export type CycleConsumable = "blade" | "gum";

export const CYCLE_CONSUMABLE_LABELS: Record<CycleConsumable, string> = {
  blade: "Saw blade",
  gum: "Edge-banding gum",
};

/**
 * Reference costs from the brief, in kobo.
 *
 * Defaults for the issue form only — the real figure is whatever the invoice said, and it is typed
 * per issue. Held here so the form does not open empty on the common case.
 */
export const CYCLE_DEFAULT_COST_KOBO: Record<CycleConsumable, number> = {
  // "Blade (145k/set)"
  blade: 145_000_00,
  // "Gum (65k/bag)"
  gum: 65_000_00,
};

/** The unit each consumable is issued in, for labels. */
export const CYCLE_UNIT: Record<CycleConsumable, string> = {
  blade: "set",
  gum: "bag",
};

export interface NewCycleIssue {
  consumable: CycleConsumable;
  /** What was fitted — brand, model, whatever identifies it on the shelf. */
  label: string;
  /** `yyyy-mm-dd`. The day it went on the machine, not the day it was typed. */
  dateKey: string;
  /** What this one cost. Defaults to the reference figure when left empty. */
  costKobo: number;
  /** How many units were issued at once. Almost always one. */
  quantity?: number;
  notes?: string;
  /** Set when the issue also drew the item down from company stock. */
  inventoryItemId?: string;
}

export interface CycleMetrics {
  /** Days the cycle ran. Null while it is still open. */
  durationDays: number | null;
  /** Boards through the relevant machine, derived from work logs in the window. */
  boards: number;
  /** Boards per day, to one decimal. Null when the duration is not yet known. */
  boardsPerDay: number | null;
  /** What each board cost in consumable. Null when no boards were processed. */
  costPerBoardKobo: number | null;
  /** Service revenue earned on the jobs worked during the window. */
  revenueKobo: number;
  /** Boards by material, which is what makes two cycles comparable. */
  byBoardType: Array<{ boardType: BoardType; boards: number }>;
  /** Work-log entries behind the figures, so a surprising number can be traced. */
  logCount: number;
}

export interface ConsumableCycleRecord {
  id: string;
  consumable: CycleConsumable;
  label: string;
  startKey: string;
  /** Null while open — this is the cycle currently on the machine. */
  endKey: string | null;
  costKobo: number;
  quantity: number;
  notes?: string;
  /** The expense this issue booked, so the two can be reconciled. */
  expenseId?: string;
  createdAtMs: number | null;
}

export interface CycleWithMetrics extends ConsumableCycleRecord {
  metrics: CycleMetrics;
}

/** `yyyy-mm-dd` → a Timestamp at local midnight. */
function dayTimestamp(dateKey: string): Timestamp {
  const [y, m, d] = dateKey.split("-").map(Number);
  return Timestamp.fromDate(new Date(y, (m ?? 1) - 1, d ?? 1));
}

/** Inclusive day count between two `yyyy-mm-dd` keys, or null if unusable. */
function daysBetweenKeys(fromKey: string, toKey: string): number | null {
  const [fy, fm, fd] = fromKey.split("-").map(Number);
  const [ty, tm, td] = toKey.split("-").map(Number);
  const ms = new Date(ty, tm - 1, td).getTime() - new Date(fy, fm - 1, fd).getTime();
  if (!Number.isFinite(ms) || ms < 0) return null;
  // Rounded rather than floored so a daylight-saving shift cannot cost a day.
  return Math.round(ms / 86_400_000) + 1;
}

/**
 * Boards a work log put through the given machine.
 *
 * `boardsUsed` is the sheet count off the customer's stack and the only figure that says how many
 * boards physically moved — unit counts are pieces, and cutting 40 pieces from 12 sheets would
 * otherwise claim 40. It is apportioned by whether the entry contains any relevant work at all:
 * an entry that is purely `only_cutting` contributes to a blade cycle and nothing to a gum cycle.
 *
 * When an entry mixes cutting-only with edged work, the sheets are counted in full for both. That
 * is deliberate and slightly generous to the gum figure: the alternative is apportioning sheets
 * across work types by piece count, which invents a precision the data does not carry. The
 * mixed-entry case is uncommon, and overstating it is visible in `logCount` rather than silent.
 */
function boardsForMachine(
  log: { boardsUsed?: number; items?: Array<{ workType: WageWorkType }>; workType?: WageWorkType },
  relevant: readonly WageWorkType[]
): number {
  const sheets = log.boardsUsed ?? 0;
  if (sheets <= 0) return 0;

  const types =
    log.items && log.items.length > 0
      ? log.items.map((i) => i.workType)
      : log.workType
        ? [log.workType]
        : [];

  return types.some((t) => relevant.includes(t)) ? sheets : 0;
}

/**
 * The metrics for one window.
 *
 * `toKey` is the closing date for a finished cycle, or today for the one still running — an open
 * cycle's figures are meaningful and waiting for it to be closed to see them defeats the purpose.
 */
export async function cycleMetrics(
  db: Firestore,
  consumable: CycleConsumable,
  startKey: string,
  endKey: string | null,
  costKobo: number
): Promise<CycleMetrics> {
  const closingKey = endKey ?? new Date().toLocaleDateString("en-CA");
  const relevant = consumable === "blade" ? CUTTING_WORK_TYPES : EDGING_WORK_TYPES;

  /*
   * Work logs in the window.
   *
   * Queried on `workDate` — the day the work happened, not the day it was keyed — because a log
   * entered late still belongs to the cycle that was on the machine when the boards were cut.
   */
  const snap = await getDocs(
    query(
      collection(db, COL.workLogs),
      where("workDate", ">=", dayTimestamp(startKey)),
      where("workDate", "<=", dayTimestamp(closingKey)),
      orderBy("workDate", "asc")
    )
  );

  let boards = 0;
  let logCount = 0;
  const byType = new Map<BoardType, number>();
  const jobIds = new Set<string>();

  for (const d of snap.docs) {
    const x = d.data() as {
      boardsUsed?: number;
      items?: Array<{ workType: WageWorkType; jobId?: string }>;
      workType?: WageWorkType;
      jobId?: string;
      boardType?: BoardType;
    };
    const sheets = boardsForMachine(x, relevant);
    if (sheets <= 0) continue;

    boards += sheets;
    logCount += 1;

    /*
     * Board type, where the log carries one.
     *
     * Many entries will not: the material is a property of the customer's stack rather than of the
     * work. Those are grouped under `other` rather than dropped, so the breakdown always sums to
     * the headline figure — a breakdown that quietly totals less than the number above it is worse
     * than one with an honest "unspecified" row.
     */
    const t = (x.boardType as BoardType) ?? "other";
    byType.set(t, (byType.get(t) ?? 0) + sheets);

    if (x.jobId) jobIds.add(x.jobId);
    for (const item of x.items ?? []) {
      if (item.jobId) jobIds.add(item.jobId);
    }
  }

  /*
   * Revenue on the jobs worked during the cycle.
   *
   * Read per job rather than by date range, because a job received in March and cut in April earns
   * its money against the April blade. Capped: a cycle spanning hundreds of jobs is a reporting
   * question, not a reason to read the whole collection.
   */
  const jobList = [...jobIds].slice(0, 200);
  let revenueKobo = 0;
  if (jobList.length > 0) {
    const jobs = await Promise.all(
      jobList.map((id) => getDoc(doc(db, COL.serviceJobs, id)).catch(() => null))
    );
    revenueKobo = sumKobo(
      jobs
        .filter((s) => s?.exists() && s.data()?.status !== "cancelled")
        .map((s) => (s!.data()?.totalKobo as number) ?? 0)
    );
  }

  const durationDays = endKey ? daysBetweenKeys(startKey, endKey) : daysBetweenKeys(startKey, closingKey);

  return {
    durationDays,
    boards,
    boardsPerDay:
      durationDays && durationDays > 0 ? Math.round((boards / durationDays) * 10) / 10 : null,
    costPerBoardKobo: boards > 0 ? Math.round(costKobo / boards) : null,
    revenueKobo,
    byBoardType: [...byType.entries()]
      .map(([boardType, b]) => ({ boardType, boards: b }))
      .sort((a, b) => b.boards - a.boards),
    logCount,
  };
}

function cycleFrom(id: string, x: Record<string, unknown>): ConsumableCycleRecord {
  return {
    id,
    consumable: (x.consumable as CycleConsumable) ?? "blade",
    label: (x.label as string) ?? "",
    startKey: (x.startKey as string) ?? "",
    endKey: (x.endKey as string) ?? null,
    costKobo: (x.costKobo as number) ?? 0,
    quantity: (x.quantity as number) ?? 1,
    notes: (x.notes as string) ?? undefined,
    expenseId: (x.expenseId as string) ?? undefined,
    createdAtMs:
      (x.createdAt as { toMillis?: () => number } | undefined)?.toMillis?.() ?? null,
  };
}

/** The cycle currently on the machine for this consumable, if any. */
export async function openCycle(
  db: Firestore,
  consumable: CycleConsumable
): Promise<ConsumableCycleRecord | null> {
  /*
   * Queried on the consumable alone and filtered in memory.
   *
   * `where(consumable) + where(endKey == null) + orderBy(startKey)` would need a composite index for
   * a collection that holds a few dozen documents a year. One equality is enough.
   */
  const snap = await getDocs(
    query(collection(db, COL.consumableCycles), where("consumable", "==", consumable))
  );
  // Filtered to the open ones and sorted newest-first, so a stray second open cycle — which should
  // not exist — resolves to the most recently fitted rather than an arbitrary one.
  const open = snap.docs
    .map((d) => cycleFrom(d.id, d.data()))
    .filter((c) => c.endKey === null)
    .sort((a, b) => b.startKey.localeCompare(a.startKey));
  return open[0] ?? null;
}

/**
 * Issues a consumable: closes the previous cycle, opens a new one, and books the cost.
 *
 * Three writes in one batch, because a half-applied issue is the worst outcome available — a new
 * cycle with the old one still open would double-count every board from that day onward, and a
 * cycle with no expense would understate service costs while looking complete.
 *
 * The expense is dated to the issue day and charged to the service stream, which is what makes the
 * brief's cost-recognition rule real rather than described.
 */
export async function issueConsumable(
  db: Firestore,
  actor: AuditActor,
  input: NewCycleIssue
): Promise<{ cycleId: string; closedCycleId: string | null; expenseId: string }> {
  if (!input.label.trim()) throw new Error("What was fitted? Give the brand or model.");
  if (!input.dateKey) throw new Error("Give the day it went on the machine.");
  if (!(input.costKobo > 0)) throw new Error("What did it cost? A cycle with no cost has no cost per board.");

  const quantity = Math.max(1, Math.round(input.quantity ?? 1));
  const previous = await openCycle(db, input.consumable);

  /*
   * A new issue cannot predate the cycle it closes.
   *
   * Allowing it would produce a negative duration and a cost-per-board computed over a window that
   * ran backwards. Far better caught here than rendered as a nonsense figure.
   */
  if (previous && input.dateKey < previous.startKey) {
    throw new Error(
      `The current ${CYCLE_CONSUMABLE_LABELS[input.consumable].toLowerCase()} was fitted on ${previous.startKey}. A new one cannot be dated before that.`
    );
  }

  const batch = writeBatch(db);

  // The expense, dated to the issue day. This is the cost recognition the brief asks for.
  const expenseRef = doc(collection(db, COL.expenses));
  const totalCostKobo = input.costKobo * quantity;
  batch.set(expenseRef, {
    date: dayTimestamp(input.dateKey),
    payeeType: "company",
    payeeName: "Workshop",
    purpose: `${CYCLE_CONSUMABLE_LABELS[input.consumable]} issued to production: ${input.label.trim()}`,
    category: "consumables",
    amountKobo: totalCostKobo,
    // Charged to cutting and edging, which is what consumed it.
    stream: "service",
    /*
     * Idempotency markers, matching the convention used by project purchases: they say which
     * record caused this expense, so a reconciliation can tell a consumable issue apart from a
     * hand-typed consumables entry.
     */
    sourceCollection: COL.consumableCycles,
    sourceId: null,
    receiptUrl: null,
    createdAt: serverTimestamp(),
    createdBy: actor.uid,
  });

  // The new cycle.
  const cycleRef = doc(collection(db, COL.consumableCycles));
  batch.set(cycleRef, {
    consumable: input.consumable,
    label: input.label.trim(),
    startKey: input.dateKey,
    startAt: dayTimestamp(input.dateKey),
    endKey: null,
    endAt: null,
    costKobo: input.costKobo,
    quantity,
    notes: input.notes?.trim() || null,
    expenseId: expenseRef.id,
    inventoryItemId: input.inventoryItemId ?? null,
    createdAt: serverTimestamp(),
    createdBy: actor.uid,
  });

  // Closing the previous one, automatically — the brief's trigger.
  if (previous) {
    batch.update(doc(db, COL.consumableCycles, previous.id), {
      endKey: input.dateKey,
      endAt: dayTimestamp(input.dateKey),
      closedByCycleId: cycleRef.id,
      updatedAt: serverTimestamp(),
      updatedBy: actor.uid,
    });
  }

  // Back-fills the expense with the cycle that caused it, now that its id is known.
  batch.update(expenseRef, { sourceId: cycleRef.id });

  await batch.commit();

  await writeAudit(db, {
    actor,
    action: "create",
    collectionName: COL.consumableCycles,
    docId: cycleRef.id,
    summary:
      `Issued ${quantity} ${CYCLE_UNIT[input.consumable]}(s) of ${input.label.trim()} on ${input.dateKey}` +
      (previous ? `, closing the cycle started ${previous.startKey}` : "") +
      `; booked ${totalCostKobo} kobo to service costs`,
    after: {
      consumable: input.consumable,
      startKey: input.dateKey,
      costKobo: input.costKobo,
      quantity,
      closedCycleId: previous?.id ?? null,
      expenseId: expenseRef.id,
    },
  });

  return { cycleId: cycleRef.id, closedCycleId: previous?.id ?? null, expenseId: expenseRef.id };
}

/**
 * Closes the open cycle without issuing a replacement.
 *
 * For the case the automatic trigger cannot cover: a blade that broke and was not replaced the same
 * day. Without this the cycle would run on and absorb boards cut by whatever came next.
 */
export async function closeOpenCycle(
  db: Firestore,
  actor: AuditActor,
  consumable: CycleConsumable,
  endKey: string,
  reason?: string
): Promise<void> {
  const current = await openCycle(db, consumable);
  if (!current) {
    throw new Error(`There is no open ${CYCLE_CONSUMABLE_LABELS[consumable].toLowerCase()} cycle.`);
  }
  if (endKey < current.startKey) {
    throw new Error(`It was fitted on ${current.startKey}, so it cannot be closed before that.`);
  }

  await updateDoc(doc(db, COL.consumableCycles, current.id), {
    endKey,
    endAt: dayTimestamp(endKey),
    closeReason: reason?.trim() || null,
    updatedAt: serverTimestamp(),
    updatedBy: actor.uid,
  });

  await writeAudit(db, {
    actor,
    action: "update",
    collectionName: COL.consumableCycles,
    docId: current.id,
    summary:
      `Closed the ${consumable} cycle started ${current.startKey} on ${endKey}` +
      (reason?.trim() ? ` (${reason.trim()})` : ""),
    after: { endKey, reason: reason?.trim() ?? null },
  });
}

/**
 * Cycles for one consumable, newest first, each with its metrics computed.
 *
 * Metrics are computed on read rather than stored, for the reason the rest of this codebase gives
 * for the same choice: a work log entered or corrected after a cycle closed changes that cycle's
 * boards, and a stored figure would silently be the pre-correction one.
 */
export async function loadCycles(
  db: Firestore,
  consumable: CycleConsumable,
  max = 12
): Promise<CycleWithMetrics[]> {
  const snap = await getDocs(
    query(
      collection(db, COL.consumableCycles),
      where("consumable", "==", consumable),
      fsLimit(200)
    )
  );

  const cycles = snap.docs
    .map((d) => cycleFrom(d.id, d.data()))
    // Newest first by start date, which puts the open cycle at the top: it is the most recently
    // fitted one by construction, since fitting a new one closes the last.
    .sort((a, b) => b.startKey.localeCompare(a.startKey))
    .slice(0, max);

  return Promise.all(
    cycles.map(async (c) => ({
      ...c,
      metrics: await cycleMetrics(db, consumable, c.startKey, c.endKey, c.costKobo * c.quantity),
    }))
  );
}

/** A board type's label, with the unspecified bucket named for what it is. */
export function boardTypeLabel(type: BoardType): string {
  return type === "other" ? "Not specified" : (BOARD_TYPE_LABELS[type] ?? type);
}

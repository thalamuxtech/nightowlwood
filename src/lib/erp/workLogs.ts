import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  Timestamp,
  updateDoc,
  where,
  writeBatch,
  type Firestore,
} from "firebase/firestore";
import { COL } from "./collections";
import type { DeductionType, WageWorkType } from "./enums";
import type { WorkLog, WorkLogItem } from "./types";
import { writeAudit, type AuditActor } from "./audit";

/**
 * Work log writes.
 *
 * A work log is the sole input to payroll, so the shape matters more than the
 * volume. Two invariants carry the weight:
 *
 * 1. `assistantIds` must name the people who assisted, because the wage engine
 *    credits each named assistant for the units on that log. A log saved with a
 *    head count and no names produces money that cannot be attributed to anyone.
 * 2. `items` holds every kind of work on the entry with its own unit count, and
 *    `workType`/`units` mirror the first item. A shift is not one kind of work, and
 *    forcing it to be meant the smaller counts went unrecorded and unpaid.
 */

export interface NewWorkLog {
  staffId: string;
  staffName: string;
  /** Every kind of work done, each with its own count. At least one required. */
  items: WorkLogItem[];
  workDate: Date;
  assistantIds?: string[];
  assistantNames?: string[];
  jobId?: string;
  jobNumber?: string;
  /**
   * Sheets drawn from the customer's stack.
   *
   * Recorded rather than inferred from the unit counts: 40 pieces routinely come out of 12
   * boards, so treating units as sheets claimed 40 off a stack that only held 12. This is
   * the figure the remaining-boards calculation subtracts.
   */
  boardsUsed?: number;
  /** Rolls of edge tape consumed, counted apart from sheets. */
  edgeTapeUsed?: number;
  notes?: string;
  /**
   * Money to withhold from this person's pay, raised alongside the work.
   *
   * Captured here because the moment the work is recorded is the moment the
   * supervisor remembers the no-show or the breakage. Written as its own
   * `deductions` document, which the next wage or salary run picks up.
   */
  deduction?: {
    type: DeductionType;
    amountKobo: number;
    reason?: string;
  };
}

/**
 * The work items on a log, whatever era it was written in.
 *
 * Every reader goes through this. `items` is authoritative when present; entries
 * written before it existed carry only `workType`/`units`, and silently reading
 * `items` on those would zero a real person's pay for that week.
 */
export function itemsFrom(
  log: Pick<WorkLog, "workType" | "units"> & { items?: WorkLogItem[] }
): WorkLogItem[] {
  const items = (log.items ?? []).filter(
    (i) => i && i.workType && Number.isFinite(i.units) && i.units > 0
  );
  if (items.length > 0) return items;
  // Legacy shape, or an entry whose items array is empty/corrupt.
  if (log.workType && Number.isFinite(log.units) && log.units > 0) {
    return [{ workType: log.workType, units: log.units }];
  }
  return [];
}

/** Total units on a log, across every work type. For display only. */
export function totalUnits(
  log: Pick<WorkLog, "workType" | "units"> & { items?: WorkLogItem[] }
): number {
  return itemsFrom(log).reduce((sum, i) => sum + i.units, 0);
}

/**
 * Collapses repeated work types and drops empty rows.
 *
 * The form lets a row be added twice — it is a list of dropdowns, and someone will
 * pick "Board" on both — and two rows of the same type would double the wage lines
 * for that type rather than summing them. Merging on the way in means the stored
 * entry is already canonical, so no reader has to cope with duplicates.
 */
export function normaliseItems(items: WorkLogItem[]): WorkLogItem[] {
  const merged = new Map<WageWorkType, number>();
  for (const item of items) {
    const units = Number(item.units);
    if (!item.workType || !Number.isFinite(units) || units <= 0) continue;
    merged.set(item.workType, (merged.get(item.workType) ?? 0) + units);
  }
  return [...merged.entries()].map(([workType, units]) => ({ workType, units }));
}

/** Shared shape for the document body, so create and update cannot drift. */
function workLogBody(input: NewWorkLog, items: WorkLogItem[], ids: string[]) {
  return {
    staffId: input.staffId,
    staffName: input.staffName,
    // The first item is mirrored into the legacy fields so anything still reading
    // them — printed sheets, older wage runs — keeps working.
    workType: items[0].workType,
    units: items[0].units,
    items,
    workDate: Timestamp.fromDate(input.workDate),
    assistantIds: ids,
    assistantNames: input.assistantNames ?? [],
    // Kept in step with the named list so the two can never disagree.
    assistantCount: ids.length,
    jobId: input.jobId ?? null,
    jobNumber: input.jobNumber ?? null,
    // Null rather than 0 when not recorded, so "no boards drawn" stays distinguishable
    // from "nobody said" — `cutBoards` falls back to the unit counts only for the latter.
    boardsUsed:
      Number.isFinite(input.boardsUsed) && (input.boardsUsed as number) >= 0
        ? input.boardsUsed
        : null,
    edgeTapeUsed:
      Number.isFinite(input.edgeTapeUsed) && (input.edgeTapeUsed as number) >= 0
        ? input.edgeTapeUsed
        : null,
    notes: input.notes ?? null,
  };
}

/** "12 × Board, 2 × Door", for audit lines and list rows. */
export function describeItems(items: WorkLogItem[]): string {
  return items.map((i) => `${i.units} × ${i.workType}`).join(", ");
}

export async function createWorkLog(
  db: Firestore,
  actor: AuditActor,
  input: NewWorkLog
): Promise<string> {
  const items = normaliseItems(input.items);
  if (items.length === 0) {
    throw new Error("Record at least one kind of work with a unit count above zero.");
  }

  const ids = (input.assistantIds ?? []).filter(Boolean);

  const ref = await addDoc(collection(db, COL.workLogs), {
    ...workLogBody(input, items, ids),
    createdAt: serverTimestamp(),
    createdBy: actor.uid,
  });

  // Raised after the log so a deduction can point at it. A failure here leaves the
  // work recorded and the deduction not, which is the safe way round: the work is
  // what someone is owed for, and a missed deduction can be re-entered.
  if (input.deduction && input.deduction.amountKobo > 0) {
    await createDeduction(db, actor, {
      staffId: input.staffId,
      staffName: input.staffName,
      type: input.deduction.type,
      amountKobo: input.deduction.amountKobo,
      reason: input.deduction.reason,
      date: input.workDate,
      workLogId: ref.id,
    });
  }

  await writeAudit(db, {
    actor,
    action: "create",
    collectionName: COL.workLogs,
    docId: ref.id,
    summary:
      `${input.staffName}: ${describeItems(items)}` +
      (ids.length ? ` with ${ids.length} assistant(s)` : ""),
    after: {
      staffId: input.staffId,
      items,
      assistantCount: ids.length,
    },
  });

  return ref.id;
}

/**
 * Corrects a work log.
 *
 * A work log is the sole input to payroll, so a mis-keyed board count mis-pays a
 * real person. Correction was previously delete-and-recreate, which loses who
 * originally recorded it and when.
 *
 * Wage runs snapshot their lines at save time, so an edit cannot retroactively
 * change a run that has already been generated, approved or paid. It does change
 * what a *future* run for that period computes, which is the intended behaviour
 * for a correction, and is why the before-image is recorded.
 */
export async function updateWorkLog(
  db: Firestore,
  actor: AuditActor,
  logId: string,
  input: NewWorkLog
): Promise<void> {
  const items = normaliseItems(input.items);
  if (items.length === 0) {
    throw new Error("Record at least one kind of work with a unit count above zero.");
  }

  const ref = doc(db, COL.workLogs, logId);
  const snap = await getDoc(ref);
  if (!snap.exists()) throw new Error("That work log no longer exists.");
  const prev = snap.data() as WorkLog;

  const ids = (input.assistantIds ?? []).filter(Boolean);
  const before = itemsFrom(prev);

  await updateDoc(ref, {
    ...workLogBody(input, items, ids),
    updatedAt: serverTimestamp(),
    updatedBy: actor.uid,
  });

  await writeAudit(db, {
    actor,
    action: "update",
    collectionName: COL.workLogs,
    docId: logId,
    summary:
      `Corrected work log for ${input.staffName}: ` +
      `${describeItems(before) || "nothing"} → ${describeItems(items)}`,
    before: {
      staffId: prev.staffId ?? "",
      items: before,
      assistantCount: prev.assistantCount ?? 0,
    },
    after: {
      staffId: input.staffId,
      items,
      assistantCount: ids.length,
    },
  });
}

// ---------------------------------------------------------------------------
// Deductions
// ---------------------------------------------------------------------------

/**
 * Records money to be withheld from someone's pay.
 *
 * Its own document rather than a field on the work log, for three reasons: a
 * no-show is the absence of work and has no log to sit on, a deduction must survive
 * the log being corrected, and a run has to be able to mark it consumed without
 * touching payroll's input data.
 *
 * `appliedToRunId: null` is what makes it visible to the next run. Nothing else
 * claims it, so a deduction cannot be taken twice.
 */
export async function createDeduction(
  db: Firestore,
  actor: AuditActor,
  input: {
    staffId: string;
    staffName: string;
    type: DeductionType;
    amountKobo: number;
    reason?: string;
    date: Date;
    workLogId?: string;
  }
): Promise<string> {
  if (!(input.amountKobo > 0)) {
    throw new Error("A deduction must be greater than zero.");
  }
  if (!input.staffId) throw new Error("A deduction must name who it applies to.");

  const ref = await addDoc(collection(db, COL.deductions), {
    staffId: input.staffId,
    staffName: input.staffName,
    type: input.type,
    amountKobo: input.amountKobo,
    reason: input.reason?.trim() || null,
    date: Timestamp.fromDate(input.date),
    workLogId: input.workLogId ?? null,
    appliedToRunId: null,
    appliedToRunType: null,
    appliedAt: null,
    createdAt: serverTimestamp(),
    createdBy: actor.uid,
  });

  await writeAudit(db, {
    actor,
    action: "create",
    collectionName: COL.deductions,
    docId: ref.id,
    summary:
      `${input.staffName}: ${input.type} deduction of ${input.amountKobo} kobo` +
      (input.reason ? ` (${input.reason})` : ""),
    after: {
      staffId: input.staffId,
      type: input.type,
      amountKobo: input.amountKobo,
    },
  });

  return ref.id;
}

/**
 * Deductions not yet taken by any run, for a period.
 *
 * Dated on or before `until` rather than within a window: a deduction raised three
 * weeks ago and never applied is still owed, and a window would let it fall through
 * the gap between runs permanently.
 */
export async function loadPendingDeductions(
  db: Firestore,
  until: Date
): Promise<
  Array<{
    id: string;
    staffId: string;
    staffName: string;
    type: DeductionType;
    amountKobo: number;
    reason?: string;
    dateMs: number | null;
  }>
> {
  const snap = await getDocs(
    query(
      collection(db, COL.deductions),
      where("appliedToRunId", "==", null),
      where("date", "<=", Timestamp.fromDate(until))
    )
  );
  return snap.docs.map((d) => {
    const x = d.data();
    return {
      id: d.id,
      staffId: x.staffId ?? "",
      staffName: x.staffName ?? "",
      type: (x.type as DeductionType) ?? "general",
      amountKobo: x.amountKobo ?? 0,
      reason: x.reason ?? undefined,
      dateMs: x.date?.toMillis?.() ?? null,
    };
  });
}

/**
 * Marks deductions as consumed by a run.
 *
 * Called when a run is approved, not when it is generated: a draft can be discarded
 * and regenerated, and claiming the deduction at draft time would make it vanish
 * from the second attempt. Batched so a run never half-claims its deductions.
 */
export async function markDeductionsApplied(
  db: Firestore,
  actor: AuditActor,
  deductionIds: string[],
  runId: string,
  runType: "wage" | "salary"
): Promise<void> {
  const ids = [...new Set(deductionIds.filter(Boolean))];
  if (ids.length === 0) return;

  for (let i = 0; i < ids.length; i += 400) {
    const batch = writeBatch(db);
    for (const id of ids.slice(i, i + 400)) {
      batch.update(doc(db, COL.deductions, id), {
        appliedToRunId: runId,
        appliedToRunType: runType,
        appliedAt: serverTimestamp(),
        updatedBy: actor.uid,
      });
    }
    await batch.commit();
  }
}

/**
 * Releases the deductions a run had claimed.
 *
 * Needed when a run is reopened or deleted: the money was never actually withheld,
 * so the deduction is still owed and has to become available to the next run. Without
 * this, reopening a run would quietly forgive every penalty in it.
 */
export async function releaseDeductionsForRun(
  db: Firestore,
  actor: AuditActor,
  runId: string
): Promise<number> {
  const snap = await getDocs(
    query(collection(db, COL.deductions), where("appliedToRunId", "==", runId))
  );
  if (snap.empty) return 0;

  for (let i = 0; i < snap.docs.length; i += 400) {
    const batch = writeBatch(db);
    for (const d of snap.docs.slice(i, i + 400)) {
      batch.update(d.ref, {
        appliedToRunId: null,
        appliedToRunType: null,
        appliedAt: null,
        updatedBy: actor.uid,
      });
    }
    await batch.commit();
  }

  return snap.size;
}

/** Deletes a deduction that has not been applied. Admin only, per rules. */
export async function deleteDeduction(
  db: Firestore,
  actor: AuditActor,
  deductionId: string
): Promise<void> {
  const ref = doc(db, COL.deductions, deductionId);
  const snap = await getDoc(ref);
  if (!snap.exists()) throw new Error("That deduction no longer exists.");
  const d = snap.data();

  if (d.appliedToRunId) {
    throw new Error(
      "This deduction has already been applied to a pay run, so it cannot be removed. " +
        "Reopen that run first, which releases it."
    );
  }

  await deleteDoc(ref);

  await writeAudit(db, {
    actor,
    action: "delete",
    collectionName: COL.deductions,
    docId: deductionId,
    summary: `Removed a ${d.type} deduction of ${d.amountKobo ?? 0} kobo for ${d.staffName ?? "staff"}`,
  });
}

/**
 * Deletes a work log. Admin only, enforced in rules.
 *
 * Wage runs snapshot their own lines at save time, so removing a log does not
 * alter a run that has already been generated; it only affects future runs for
 * that period.
 */
export async function deleteWorkLog(
  db: Firestore,
  actor: AuditActor,
  logId: string,
  summary: string
): Promise<void> {
  await deleteDoc(doc(db, COL.workLogs, logId));
  await writeAudit(db, {
    actor,
    action: "delete",
    collectionName: COL.workLogs,
    docId: logId,
    summary: `Deleted work log: ${summary}`,
  });
}

/** Local date as `YYYY-MM-DD`, for date inputs. */
export function toDateInputValue(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * Parses a date input as local midnight.
 *
 * `new Date("2026-07-29")` parses as UTC, which in a positive-offset zone lands
 * on the previous day locally and would file the work into the wrong week.
 */
export function fromDateInputValue(value: string): Date {
  const [y, m, d] = value.split("-").map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1, 12, 0, 0, 0);
}

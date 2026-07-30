import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  serverTimestamp,
  Timestamp,
  updateDoc,
  type Firestore,
} from "firebase/firestore";
import { COL } from "./collections";
import type { WageWorkType } from "./enums";
import { writeAudit, type AuditActor } from "./audit";

/**
 * Work log writes.
 *
 * A work log is the sole input to payroll, so the shape matters more than the
 * volume: `assistantIds` must name the people who assisted, because the wage
 * engine credits each named assistant for the units on that log. A log saved
 * with a head count and no names produces money that cannot be attributed to
 * anyone, which the wage run then has to report as unattributed.
 */

export interface NewWorkLog {
  staffId: string;
  staffName: string;
  workType: WageWorkType;
  units: number;
  workDate: Date;
  assistantIds?: string[];
  assistantNames?: string[];
  jobId?: string;
  jobNumber?: string;
  notes?: string;
}

export async function createWorkLog(
  db: Firestore,
  actor: AuditActor,
  input: NewWorkLog
): Promise<string> {
  if (input.units <= 0) throw new Error("Units must be greater than zero.");

  const ids = (input.assistantIds ?? []).filter(Boolean);

  const ref = await addDoc(collection(db, COL.workLogs), {
    staffId: input.staffId,
    staffName: input.staffName,
    workType: input.workType,
    units: input.units,
    workDate: Timestamp.fromDate(input.workDate),
    assistantIds: ids,
    assistantNames: input.assistantNames ?? [],
    // Kept in step with the named list so the two can never disagree.
    assistantCount: ids.length,
    jobId: input.jobId ?? null,
    jobNumber: input.jobNumber ?? null,
    notes: input.notes ?? null,
    createdAt: serverTimestamp(),
    createdBy: actor.uid,
  });

  await writeAudit(db, {
    actor,
    action: "create",
    collectionName: COL.workLogs,
    docId: ref.id,
    summary:
      `${input.staffName}: ${input.units} × ${input.workType}` +
      (ids.length ? ` with ${ids.length} assistant(s)` : ""),
    after: {
      staffId: input.staffId,
      workType: input.workType,
      units: input.units,
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
  if (input.units <= 0) throw new Error("Units must be greater than zero.");

  const ref = doc(db, COL.workLogs, logId);
  const snap = await getDoc(ref);
  if (!snap.exists()) throw new Error("That work log no longer exists.");
  const prev = snap.data();

  const ids = (input.assistantIds ?? []).filter(Boolean);

  await updateDoc(ref, {
    staffId: input.staffId,
    staffName: input.staffName,
    workType: input.workType,
    units: input.units,
    workDate: Timestamp.fromDate(input.workDate),
    assistantIds: ids,
    assistantNames: input.assistantNames ?? [],
    assistantCount: ids.length,
    jobId: input.jobId ?? null,
    jobNumber: input.jobNumber ?? null,
    notes: input.notes ?? null,
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
      `${prev.units ?? 0} → ${input.units} × ${input.workType}`,
    before: {
      staffId: prev.staffId ?? "",
      workType: prev.workType ?? "",
      units: prev.units ?? 0,
      assistantCount: prev.assistantCount ?? 0,
    },
    after: {
      staffId: input.staffId,
      workType: input.workType,
      units: input.units,
      assistantCount: ids.length,
    },
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

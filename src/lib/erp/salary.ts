import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  query,
  runTransaction,
  serverTimestamp,
  Timestamp,
  updateDoc,
  where,
  writeBatch,
  type Firestore,
} from "firebase/firestore";
import { COL } from "./collections";
import { sumKobo } from "./money";
import { applyDeductions } from "./wages";
import { recordPayrollExpense } from "./payroll";
import type { Loan, Staff } from "./types";
import { writeAudit, type AuditActor } from "./audit";

/**
 * Monthly salaries.
 *
 * The workshop pays two kinds of staff, and they are genuinely different
 * calculations rather than one with a flag:
 *
 *  - Piece-rate workers are paid weekly from what they logged. Their gross is
 *    derived from work logs and rates, so it cannot be known until the week is
 *    entered. That is the wage run.
 *  - Salaried staff are paid a fixed monthly figure that does not depend on the
 *    logs at all. Their gross is known in advance and the only variable parts are
 *    unpaid days, an agreed bonus, and loan repayments.
 *
 * Modelling salary as a wage run with a synthetic "work type" was the tempting
 * shortcut and would have been wrong: it would put a fictional piece-rate line
 * into the work-log ledger, and the weekly period would not match the month the
 * salary actually covers.
 *
 * Loan deductions go through the same `applyDeductions` used by the wage run, so
 * a member of staff who is repaying a loan is treated identically whichever way
 * they are paid, and the cap that stops a loan swallowing a whole payslip applies
 * to both.
 */

export interface SalaryLine {
  staffId: string;
  staffName: string;
  /** The contracted monthly figure, copied at run time. */
  baseKobo: number;
  /** Days not worked and not paid for. Zero for a normal month. */
  unpaidDays: number;
  /** Working days the month is treated as having, for pro-rating. */
  workingDays: number;
  /** Reduction for unpaid days, derived from the two figures above. */
  unpaidKobo: number;
  /** Anything agreed on top: overtime, a one-off bonus. */
  bonusKobo: number;
  bonusNote?: string;
  grossKobo: number;
  deductionKobo: number;
  netKobo: number;
}

export interface SalaryRunPreview {
  lines: SalaryLine[];
  baseTotalKobo: number;
  bonusTotalKobo: number;
  unpaidTotalKobo: number;
  grossTotalKobo: number;
  deductionsKobo: number;
  netPayableKobo: number;
  /** Salaried staff with no figure set, so they cannot be paid yet. */
  missingSalary: string[];
}

/**
 * Working days assumed in a month when pro-rating unpaid leave.
 *
 * A fixed divisor rather than a per-month calendar count. Using the real number of
 * working days would mean the same absent day costs a different amount depending on
 * the month, which staff read as inconsistent. 26 is the six-day week the workshop
 * runs, and it is stored on each line so a past run can still be explained even if
 * this constant later changes.
 */
export const DEFAULT_WORKING_DAYS = 26;

/** Pro-rates a salary for days not worked. */
export function unpaidDeduction(
  baseKobo: number,
  unpaidDays: number,
  workingDays: number = DEFAULT_WORKING_DAYS
): number {
  if (unpaidDays <= 0 || workingDays <= 0) return 0;
  // Capped at the base: more unpaid days than the month holds cannot produce a
  // negative salary that the company would appear to be owed.
  const capped = Math.min(unpaidDays, workingDays);
  return Math.round((baseKobo * capped) / workingDays);
}

/**
 * Builds a salary run for a month, before it is saved.
 *
 * Reads the salaried staff, their outstanding loans, and nothing else: unlike a wage
 * run there are no work logs involved, which is the whole point of the distinction.
 */
export async function previewSalaryRun(
  db: Firestore,
  input: {
    periodStart: Date;
    periodEnd: Date;
    /** Per-staff adjustments keyed by staff id, from the operator's input. */
    adjustments?: Record<string, { unpaidDays?: number; bonusKobo?: number; bonusNote?: string }>;
    workingDays?: number;
  }
): Promise<SalaryRunPreview> {
  const [staffSnap, loanSnap] = await Promise.all([
    getDocs(query(collection(db, COL.staff), where("active", "==", true))),
    getDocs(
      query(collection(db, COL.loans), where("status", "in", ["disbursed", "repaying"]))
    ),
  ]);

  const workingDays = input.workingDays ?? DEFAULT_WORKING_DAYS;
  const adjustments = input.adjustments ?? {};

  const salaried = staffSnap.docs
    .map((d) => ({ id: d.id, ...d.data() }) as Staff & { id: string })
    // Only staff with a salary set: an unset figure means piece-rate, which the
    // wage run handles.
    .filter((s) => (s.monthlySalaryKobo ?? 0) > 0 || s.isSalaried === true);

  const missingSalary = salaried
    .filter((s) => !(s.monthlySalaryKobo && s.monthlySalaryKobo > 0))
    .map((s) => s.name);

  const payable = salaried.filter((s) => (s.monthlySalaryKobo ?? 0) > 0);

  const draftLines = payable.map((s) => {
    const baseKobo = s.monthlySalaryKobo ?? 0;
    const adj = adjustments[s.id] ?? {};
    const unpaidDays = Math.max(0, adj.unpaidDays ?? 0);
    const unpaidKobo = unpaidDeduction(baseKobo, unpaidDays, workingDays);
    const bonusKobo = Math.max(0, adj.bonusKobo ?? 0);
    const grossKobo = Math.max(0, baseKobo - unpaidKobo + bonusKobo);
    return {
      staffId: s.id,
      staffName: s.name,
      baseKobo,
      unpaidDays,
      workingDays,
      unpaidKobo,
      bonusKobo,
      bonusNote: adj.bonusNote,
      grossKobo,
    };
  });

  // Loan repayments, through the same engine the wage run uses so the cap and the
  // ordering behave identically for both kinds of staff.
  const loans = loanSnap.docs.map((d) => ({ id: d.id, ...d.data() }) as Loan);
  const outstandingByStaff = new Map<string, number>();
  for (const l of loans) {
    outstandingByStaff.set(
      l.staffId,
      (outstandingByStaff.get(l.staffId) ?? 0) + (l.outstandingKobo ?? 0)
    );
  }

  const { applied, totalDeductedKobo } = applyDeductions(
    draftLines.map((l) => ({
      staffId: l.staffId,
      staffName: l.staffName,
      totalKobo: l.grossKobo,
    })),
    [...outstandingByStaff.entries()].map(([staffId, outstandingKobo]) => ({
      staffId,
      outstandingKobo,
    }))
  );
  const deductionByStaff = new Map(applied.map((a) => [a.staffId, a.deductedKobo]));

  const lines: SalaryLine[] = draftLines.map((l) => {
    const deductionKobo = deductionByStaff.get(l.staffId) ?? 0;
    return { ...l, deductionKobo, netKobo: Math.max(0, l.grossKobo - deductionKobo) };
  });

  const grossTotalKobo = sumKobo(lines.map((l) => l.grossKobo));

  return {
    lines,
    baseTotalKobo: sumKobo(lines.map((l) => l.baseKobo)),
    bonusTotalKobo: sumKobo(lines.map((l) => l.bonusKobo)),
    unpaidTotalKobo: sumKobo(lines.map((l) => l.unpaidKobo)),
    grossTotalKobo,
    deductionsKobo: totalDeductedKobo,
    netPayableKobo: Math.max(0, grossTotalKobo - totalDeductedKobo),
    missingSalary,
  };
}

/** Saves a salary run as a draft. */
export async function saveDraftSalaryRun(
  db: Firestore,
  actor: AuditActor,
  input: { periodStart: Date; periodEnd: Date },
  preview: SalaryRunPreview
): Promise<string> {
  if (preview.lines.length === 0) {
    throw new Error("No salaried staff to pay for this month.");
  }

  const ref = doc(collection(db, COL.salaryRuns));
  // One document holding its lines, rather than a subcollection: a salary run has
  // one row per salaried employee, which is a handful, not the hundreds a wage run
  // can carry.
  await runTransaction(db, async (tx) => {
    tx.set(ref, {
      periodStart: Timestamp.fromDate(input.periodStart),
      periodEnd: Timestamp.fromDate(input.periodEnd),
      status: "draft",
      lines: preview.lines,
      baseTotalKobo: preview.baseTotalKobo,
      bonusTotalKobo: preview.bonusTotalKobo,
      unpaidTotalKobo: preview.unpaidTotalKobo,
      grossTotalKobo: preview.grossTotalKobo,
      deductionsKobo: preview.deductionsKobo,
      netPayableKobo: preview.netPayableKobo,
      staffCount: preview.lines.length,
      createdAt: serverTimestamp(),
      createdBy: actor.uid,
    });
  });

  await writeAudit(db, {
    actor,
    action: "create",
    collectionName: COL.salaryRuns,
    docId: ref.id,
    summary:
      `Salary run for ${preview.lines.length} staff: ` +
      `gross ${preview.grossTotalKobo} kobo, net ${preview.netPayableKobo} kobo`,
    after: {
      grossTotalKobo: preview.grossTotalKobo,
      netPayableKobo: preview.netPayableKobo,
    },
  });

  return ref.id;
}

/**
 * Adjusts one person's salary line on a draft.
 *
 * Draft only, matching the wage run: approving is the point at which the figures
 * become a decision already taken. The base is not editable here because it is the
 * contracted salary and belongs on the staff record, where changing it is a
 * deliberate act that outlives this month.
 */
export async function adjustSalaryLine(
  db: Firestore,
  actor: AuditActor,
  runId: string,
  staffId: string,
  next: { unpaidDays: number; bonusKobo: number; bonusNote?: string }
): Promise<void> {
  if (next.unpaidDays < 0) throw new Error("Unpaid days cannot be negative.");
  if (next.bonusKobo < 0) throw new Error("A bonus cannot be negative.");

  const ref = doc(db, COL.salaryRuns, runId);

  await runTransaction(db, async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists()) throw new Error("Salary run not found.");
    const run = snap.data();

    if (run.status !== "draft") {
      throw new Error(
        `This run is ${run.status}, so its figures can no longer be changed.`
      );
    }

    const lines = (run.lines ?? []) as SalaryLine[];
    if (!lines.some((l) => l.staffId === staffId)) {
      throw new Error("That staff member is not on this run.");
    }

    const updated = lines.map((l) => {
      if (l.staffId !== staffId) return l;
      const unpaidKobo = unpaidDeduction(l.baseKobo, next.unpaidDays, l.workingDays);
      const grossKobo = Math.max(0, l.baseKobo - unpaidKobo + next.bonusKobo);
      return {
        ...l,
        unpaidDays: next.unpaidDays,
        unpaidKobo,
        bonusKobo: next.bonusKobo,
        bonusNote: next.bonusNote ?? null,
        grossKobo,
        // The deduction stands: it is what the loan ledger says is owed, and a
        // changed gross does not change the debt.
        netKobo: Math.max(0, grossKobo - (l.deductionKobo ?? 0)),
      } as SalaryLine;
    });

    const grossTotal = sumKobo(updated.map((l) => l.grossKobo));
    const deductions = sumKobo(updated.map((l) => l.deductionKobo ?? 0));

    tx.update(ref, {
      lines: updated,
      baseTotalKobo: sumKobo(updated.map((l) => l.baseKobo)),
      bonusTotalKobo: sumKobo(updated.map((l) => l.bonusKobo)),
      unpaidTotalKobo: sumKobo(updated.map((l) => l.unpaidKobo)),
      grossTotalKobo: grossTotal,
      deductionsKobo: deductions,
      netPayableKobo: Math.max(0, grossTotal - deductions),
      adjusted: true,
      updatedAt: serverTimestamp(),
      updatedBy: actor.uid,
    });
  });

  await writeAudit(db, {
    actor,
    action: "update",
    collectionName: COL.salaryRuns,
    docId: runId,
    summary:
      `Adjusted a salary line: ${next.unpaidDays} unpaid day(s), ` +
      `bonus ${next.bonusKobo} kobo`,
    after: { staffId, ...next },
  });
}

/**
 * Approves a salary run and posts its loan repayments.
 *
 * The same shape as the wage run's approval, and for the same reason: every read
 * happens before the first write, because Firestore rejects a transaction that
 * interleaves them. Balances are written back into the map as they are applied so
 * two lines against one loan cannot both deduct from the original figure.
 */
export async function approveSalaryRun(
  db: Firestore,
  actor: AuditActor,
  runId: string
): Promise<void> {
  const runRef = doc(db, COL.salaryRuns, runId);

  // Queries cannot take part in a transaction, so candidates are gathered first and
  // re-read inside it.
  const candidateSnap = await getDocs(
    query(collection(db, COL.loans), where("status", "in", ["disbursed", "repaying"]))
  );
  const candidatesByStaff = new Map<string, string[]>();
  const requestedAtById = new Map<string, number>();
  for (const d of candidateSnap.docs) {
    const staffId = (d.data().staffId as string) ?? "";
    candidatesByStaff.set(staffId, [...(candidatesByStaff.get(staffId) ?? []), d.id]);
    requestedAtById.set(d.id, d.data().requestedAt?.toMillis?.() ?? 0);
  }

  await runTransaction(db, async (tx) => {
    const snap = await tx.get(runRef);
    if (!snap.exists()) throw new Error("Salary run not found.");
    const run = snap.data();
    if (run.status !== "draft") {
      throw new Error(`This run is already ${run.status}.`);
    }

    const lines = (run.lines ?? []) as SalaryLine[];

    const relevantIds = [
      ...new Set(
        lines
          .filter((l) => (l.deductionKobo ?? 0) > 0)
          .flatMap((l) => candidatesByStaff.get(l.staffId) ?? [])
      ),
    ];
    const loanSnaps = await Promise.all(
      relevantIds.map((id) => tx.get(doc(db, COL.loans, id)))
    );
    const loansById = new Map<string, Loan>();
    relevantIds.forEach((id, i) => {
      if (loanSnaps[i].exists()) loansById.set(id, loanSnaps[i].data() as Loan);
    });

    for (const line of lines) {
      let remaining = line.deductionKobo ?? 0;
      if (remaining <= 0) continue;

      // Oldest first, so the ledger closes loans in the order they were taken.
      const ids = (candidatesByStaff.get(line.staffId) ?? []).sort(
        (a, b) => (requestedAtById.get(a) ?? 0) - (requestedAtById.get(b) ?? 0)
      );

      for (const loanId of ids) {
        if (remaining <= 0) break;
        const loan = loansById.get(loanId);
        if (!loan) continue;
        if (loan.status !== "disbursed" && loan.status !== "repaying") continue;

        const take = Math.min(remaining, loan.outstandingKobo ?? 0);
        if (take <= 0) continue;
        const nextOutstanding = (loan.outstandingKobo ?? 0) - take;

        tx.update(doc(db, COL.loans, loanId), {
          repaidKobo: (loan.repaidKobo ?? 0) + take,
          outstandingKobo: nextOutstanding,
          status: nextOutstanding <= 0 ? "settled" : "repaying",
          settledAt: nextOutstanding <= 0 ? serverTimestamp() : null,
          updatedAt: serverTimestamp(),
          updatedBy: actor.uid,
        });
        tx.set(doc(collection(db, `${COL.loans}/${loanId}/repayments`)), {
          salaryRunId: runId,
          amountKobo: take,
          at: serverTimestamp(),
          recordedBy: actor.uid,
        });

        loansById.set(loanId, {
          ...loan,
          repaidKobo: (loan.repaidKobo ?? 0) + take,
          outstandingKobo: nextOutstanding,
          status: nextOutstanding <= 0 ? "settled" : "repaying",
        });
        remaining -= take;
      }
    }

    tx.update(runRef, {
      status: "approved",
      approvedBy: actor.uid,
      approvedAt: serverTimestamp(),
    });
  });

  await writeAudit(db, {
    actor,
    action: "wage_run_approve",
    collectionName: COL.salaryRuns,
    docId: runId,
    summary: "Approved salary run and posted loan repayments",
  });
}

/** Marks an approved salary run as paid. */
export async function markSalaryRunPaid(
  db: Firestore,
  actor: AuditActor,
  runId: string
): Promise<void> {
  const ref = doc(db, COL.salaryRuns, runId);
  const snap = await getDoc(ref);
  if (!snap.exists()) throw new Error("Salary run not found.");
  if (snap.data().status !== "approved") {
    throw new Error("Approve the run before marking it paid.");
  }

  const run = snap.data();

  await updateDoc(ref, {
    status: "paid",
    paidAt: serverTimestamp(),
    updatedBy: actor.uid,
  });

  // Salaries reach the expense ledger exactly as wages do, through the same
  // helper, so labour cost lands in the books the same way whichever way a person
  // is paid. Net rather than gross: a loan repayment deducted from a salary never
  // leaves the business.
  const fmt = (d: Date) =>
    d.toLocaleDateString("en-GB", { month: "long", year: "numeric" });
  await recordPayrollExpense(db, actor, {
    amountKobo: run.netPayableKobo ?? 0,
    date: new Date(),
    purpose: `Salaries, ${fmt(run.periodStart?.toDate?.() ?? new Date())}`,
    sourceCollection: COL.salaryRuns,
    sourceId: runId,
  });

  await writeAudit(db, {
    actor,
    action: "wage_run_pay",
    collectionName: COL.salaryRuns,
    docId: runId,
    summary: "Marked salary run as paid",
  });
}

/** Discards a draft salary run. Approved and paid runs are the record of what was paid. */
export async function deleteDraftSalaryRun(
  db: Firestore,
  actor: AuditActor,
  runId: string
): Promise<void> {
  const ref = doc(db, COL.salaryRuns, runId);
  const snap = await getDoc(ref);
  if (!snap.exists()) throw new Error("Salary run not found.");
  if (snap.data().status !== "draft") {
    throw new Error("Only a draft run can be discarded.");
  }

  await deleteDoc(ref);

  await writeAudit(db, {
    actor,
    action: "delete",
    collectionName: COL.salaryRuns,
    docId: runId,
    summary: "Discarded a draft salary run",
  });
}

/** Sets or clears a staff member's contracted monthly salary. Admin only, in rules. */
export async function setMonthlySalary(
  db: Firestore,
  actor: AuditActor,
  staffId: string,
  monthlySalaryKobo: number | null,
  staffName: string
): Promise<void> {
  if (monthlySalaryKobo !== null && monthlySalaryKobo < 0) {
    throw new Error("A salary cannot be negative.");
  }

  await updateDoc(doc(db, COL.staff, staffId), {
    monthlySalaryKobo,
    // Clearing the figure returns them to piece-rate, so the flag follows it.
    isSalaried: monthlySalaryKobo !== null && monthlySalaryKobo > 0,
    updatedAt: serverTimestamp(),
    updatedBy: actor.uid,
  });

  await writeAudit(db, {
    actor,
    action: "wage_rate_change",
    collectionName: COL.staff,
    docId: staffId,
    summary:
      monthlySalaryKobo === null || monthlySalaryKobo === 0
        ? `${staffName} moved to piece rate`
        : `${staffName} set to a monthly salary of ${monthlySalaryKobo} kobo`,
    after: { monthlySalaryKobo },
  });
}

/** Batch helper so a whole month's salaries can be set from one screen. */
export async function setMonthlySalaries(
  db: Firestore,
  actor: AuditActor,
  updates: Array<{ staffId: string; staffName: string; monthlySalaryKobo: number | null }>
): Promise<void> {
  if (updates.length === 0) return;
  const batch = writeBatch(db);
  for (const u of updates) {
    batch.update(doc(db, COL.staff, u.staffId), {
      monthlySalaryKobo: u.monthlySalaryKobo,
      isSalaried: u.monthlySalaryKobo !== null && u.monthlySalaryKobo > 0,
      updatedAt: serverTimestamp(),
      updatedBy: actor.uid,
    });
  }
  await batch.commit();

  await writeAudit(db, {
    actor,
    action: "wage_rate_change",
    collectionName: COL.staff,
    docId: "batch",
    summary: `Updated monthly salary for ${updates.length} staff member(s)`,
    after: { count: updates.length },
  });
}

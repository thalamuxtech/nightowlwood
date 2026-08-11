import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
  where,
  writeBatch,
  type Firestore,
} from "firebase/firestore";
import { COL, loanRepaymentsPath, wageRunLinesPath } from "./collections";
import {
  WAGE_WORK_TYPES,
  type DeductionType,
  type ExpenseCategory,
  type WageWorkType,
} from "./enums";
import {
  DEFAULT_WAGE_WORK_TYPE_SETTINGS,
  SETTINGS_DOC,
  type WageWorkTypeSettings,
} from "./settings";
import { sumKobo } from "./money";
import type { Loan, StaffRate, WageRate, WorkLog } from "./types";
import { writeAudit, type AuditActor } from "./audit";
import {
  applyAllDeductions,
  applyDeductions,
  computeWageRun,
  resolveRates,
  resolveStaffRates,
  resolveWorkTypes,
  workTypeIdFrom,
  type ComputedStaffRow,
  type ComputedWageLine,
} from "./wages";
import {
  loadPendingDeductions,
  markDeductionsApplied,
  releaseDeductionsForRun,
} from "./workLogs";

/**
 * Wage run persistence.
 *
 * A run is generated, reviewed, approved, then paid. Approval is the point of no
 * return: it snapshots the rates used and writes loan repayments, so re-running
 * an approved week cannot silently restate what someone was paid.
 */

export interface GenerateRunInput {
  periodStart: Date;
  periodEnd: Date;
}

export interface RunPreview {
  lines: ComputedWageLine[];
  perStaff: Array<{
    staffId: string;
    staffName: string;
    operatorKobo: number;
    assistantKobo: number;
    totalKobo: number;
    /** Loan repayments plus work-log deductions. */
    deductionKobo: number;
    loanDeductionKobo: number;
    /** Work-log deductions taken in this run, itemised for the payslip. */
    otherDeductions: Array<{
      id: string;
      type: DeductionType;
      amountKobo: number;
      reason?: string;
    }>;
    netKobo: number;
    /** What this person was paid at, so the run can show the working. */
    rateLines: ComputedStaffRow["rateLines"];
  }>;
  operatorTotalKobo: number;
  assistantTotalKobo: number;
  grandTotalKobo: number;
  deductionsKobo: number;
  /** Split out so the run can say what was a loan and what was a penalty. */
  loanDeductionsKobo: number;
  otherDeductionsKobo: number;
  netPayableKobo: number;
  unattributedAssistantKobo: number;
  missingRates: WageWorkType[];
  ratesUsed: Array<{
    workType: WageWorkType;
    operatorRateKobo: number;
    assistantRateKobo: number;
  }>;
  /** Per-person overrides in force, snapshotted so history stays reproducible. */
  staffRatesUsed: Array<{
    staffId: string;
    staffName: string;
    role: "operator" | "assistant";
    workType: WageWorkType | null;
    rateKobo: number;
  }>;
  /** Deduction documents this run intends to claim on approval. */
  deductionIds: string[];
  logCount: number;
}

/**
 * Computes a run for the period without writing anything.
 *
 * Rates are resolved as at the period *end*, so a rate change mid-week applies
 * to the whole week rather than splitting it. That matches how the business
 * announces a new rate, and it is recorded in the snapshot either way.
 */
export async function previewWageRun(
  db: Firestore,
  input: GenerateRunInput
): Promise<RunPreview> {
  const startTs = Timestamp.fromDate(input.periodStart);
  const endTs = Timestamp.fromDate(input.periodEnd);

  const [logSnap, rateSnap, staffRateSnap, loanSnap, staffSnap, pending] =
    await Promise.all([
      getDocs(
        query(
          collection(db, COL.workLogs),
          where("workDate", ">=", startTs),
          where("workDate", "<=", endTs)
        )
      ),
      getDocs(collection(db, COL.wageRates)),
      getDocs(collection(db, COL.staffRates)),
      getDocs(
        query(collection(db, COL.loans), where("status", "in", ["disbursed", "repaying"]))
      ),
      getDocs(collection(db, COL.staff)),
      // Anything unapplied and dated on or before the period end. Not restricted to
      // the period: a penalty raised before a run that never picked it up is still
      // owed, and windowing it would let it fall permanently between two runs.
      loadPendingDeductions(db, input.periodEnd),
    ]);

  const logs = logSnap.docs.map((d) => ({ id: d.id, ...d.data() })) as WorkLog[];
  const rates = rateSnap.docs.map((d) => ({ id: d.id, ...d.data() })) as WageRate[];
  const staffRates = staffRateSnap.docs.map((d) => ({
    id: d.id,
    ...d.data(),
  })) as StaffRate[];

  const staffNames = new Map<string, string>();
  for (const d of staffSnap.docs) staffNames.set(d.id, (d.data().name as string) ?? d.id);

  const atMs = input.periodEnd.getTime();
  const resolved = resolveRates(rates, atMs);
  const personal = resolveStaffRates(staffRates, atMs);
  const computed = computeWageRun(logs, resolved, staffNames, personal);

  const loans = loanSnap.docs.map((d) => ({ id: d.id, ...d.data() })) as Loan[];
  // One staff member may hold several loans; deduct against the combined
  // outstanding rather than only the first one found.
  const outstandingByStaff = new Map<string, number>();
  for (const l of loans) {
    outstandingByStaff.set(
      l.staffId,
      (outstandingByStaff.get(l.staffId) ?? 0) + (l.outstandingKobo ?? 0)
    );
  }

  const {
    byStaff,
    appliedDeductionIds,
    totalDeductedKobo,
  } = applyAllDeductions(
    computed.perStaff,
    [...outstandingByStaff.entries()].map(([staffId, outstandingKobo]) => ({
      staffId,
      outstandingKobo,
    })),
    pending.map((d) => ({
      id: d.id,
      staffId: d.staffId,
      type: d.type,
      amountKobo: d.amountKobo,
      reason: d.reason,
    }))
  );

  const perStaff = computed.perStaff.map((s) => {
    const applied = byStaff.get(s.staffId);
    const deductionKobo = applied?.totalDeductionKobo ?? 0;
    return {
      ...s,
      deductionKobo,
      loanDeductionKobo: applied?.loanDeductionKobo ?? 0,
      otherDeductions: applied?.taken ?? [],
      // Guarded even though applyAllDeductions never over-deducts, because this is
      // the figure that becomes a payment.
      netKobo: Math.max(0, s.totalKobo - deductionKobo),
    };
  });

  const loanDeductionsKobo = sumKobo(perStaff.map((s) => s.loanDeductionKobo));

  return {
    lines: computed.lines,
    perStaff,
    operatorTotalKobo: computed.operatorTotalKobo,
    assistantTotalKobo: computed.assistantTotalKobo,
    grandTotalKobo: computed.grandTotalKobo,
    deductionsKobo: totalDeductedKobo,
    loanDeductionsKobo,
    otherDeductionsKobo: totalDeductedKobo - loanDeductionsKobo,
    netPayableKobo: Math.max(0, computed.grandTotalKobo - totalDeductedKobo),
    unattributedAssistantKobo: computed.unattributedAssistantKobo,
    missingRates: computed.missingRates,
    ratesUsed: [...resolved.values()],
    staffRatesUsed: staffRates
      .filter((r) => {
        const fromMs = r.effectiveFrom?.toMillis?.() ?? 0;
        const toMs = r.effectiveTo?.toMillis?.() ?? Number.POSITIVE_INFINITY;
        return fromMs <= atMs && toMs > atMs;
      })
      .map((r) => ({
        staffId: r.staffId,
        staffName: staffNames.get(r.staffId) ?? r.staffName ?? r.staffId,
        role: r.role,
        workType: r.workType ?? null,
        rateKobo: r.rateKobo,
      })),
    deductionIds: appliedDeductionIds,
    logCount: logs.length,
  };
}

/**
 * Saves a run as a draft, with its lines and the rates it used.
 *
 * The snapshot is written at save time rather than read on display, so a later
 * rate change cannot rewrite history. Batched so a partial run never appears.
 */
export async function saveDraftWageRun(
  db: Firestore,
  actor: AuditActor,
  input: GenerateRunInput,
  preview: RunPreview
): Promise<string> {
  // One batch, so a partial run never appears. That atomicity is worth more than
  // supporting an arbitrarily large run, but it means the 500-operation limit is
  // a real ceiling: the run document plus one line per (staff, role, work type).
  // Lines are aggregated rather than per-log, so this is bounded by the workforce
  // and not by how busy the period was, and the limit is far off in practice.
  // Checked explicitly because Firestore's own error names neither the limit nor
  // payroll, and a failed wage run needs to say what to do about it.
  const MAX_BATCH_OPS = 500;
  if (preview.lines.length + 1 > MAX_BATCH_OPS) {
    throw new Error(
      `This run has ${preview.lines.length} pay lines, over the ${MAX_BATCH_OPS - 1} that can be ` +
        "saved at once. Split the period into two shorter runs."
    );
  }

  const runRef = doc(collection(db, COL.wageRuns));
  const batch = writeBatch(db);

  batch.set(runRef, {
    periodStart: Timestamp.fromDate(input.periodStart),
    periodEnd: Timestamp.fromDate(input.periodEnd),
    status: "draft",
    ratesSnapshot: preview.ratesUsed,
    // Per-person overrides snapshotted alongside the work-type rates, for the same
    // reason: without them a run cannot be re-explained after someone's rate changes.
    staffRatesSnapshot: preview.staffRatesUsed,
    operatorTotalKobo: preview.operatorTotalKobo,
    assistantTotalKobo: preview.assistantTotalKobo,
    grandTotalKobo: preview.grandTotalKobo,
    deductionsKobo: preview.deductionsKobo,
    loanDeductionsKobo: preview.loanDeductionsKobo,
    otherDeductionsKobo: preview.otherDeductionsKobo,
    netPayableKobo: preview.netPayableKobo,
    unattributedAssistantKobo: preview.unattributedAssistantKobo,
    logCount: preview.logCount,
    perStaff: preview.perStaff,
    // Recorded on the draft, claimed on approval. A draft that is discarded must
    // leave its deductions available to the next attempt, so nothing is marked
    // applied until the run is actually signed off.
    deductionIds: preview.deductionIds,
    createdAt: serverTimestamp(),
    createdBy: actor.uid,
  });

  for (const line of preview.lines) {
    batch.set(doc(collection(db, wageRunLinesPath(runRef.id))), line);
  }

  await batch.commit();

  await writeAudit(db, {
    actor,
    action: "wage_run_generate",
    collectionName: COL.wageRuns,
    docId: runRef.id,
    summary:
      `Generated wage run ${fmtPeriod(input.periodStart, input.periodEnd)}: ` +
      `gross ${preview.grandTotalKobo} kobo, net ${preview.netPayableKobo} kobo`,
    after: {
      grandTotalKobo: preview.grandTotalKobo,
      netPayableKobo: preview.netPayableKobo,
    },
  });

  return runRef.id;
}

/**
 * Approves a draft run and records the loan repayments it deducted.
 *
 * The candidate loans are queried *before* the transaction, then re-read inside
 * it with `tx.get`. A query cannot participate in a Firestore transaction, so
 * reading balances with `getDocs` inside one would not be covered by the
 * conflict check, and two concurrent approvals could each deduct from the same
 * balance and double-post a repayment. Re-reading each document transactionally
 * means the second attempt retries against fresh data.
 */
export async function approveWageRun(
  db: Firestore,
  actor: AuditActor,
  runId: string
): Promise<void> {
  const runRef = doc(db, COL.wageRuns, runId);

  // Outside the transaction: find which loans might be involved. A loan created
  // after this point simply is not deducted by this run, which is correct.
  const candidateSnap = await getDocs(
    query(collection(db, COL.loans), where("status", "in", ["disbursed", "repaying"]))
  );
  const candidatesByStaff = new Map<string, string[]>();
  const requestedAtById = new Map<string, number>();
  for (const d of candidateSnap.docs) {
    const data = d.data() as Loan;
    const list = candidatesByStaff.get(data.staffId) ?? [];
    list.push(d.id);
    candidatesByStaff.set(data.staffId, list);
    requestedAtById.set(d.id, data.requestedAt?.toMillis?.() ?? 0);
  }

  /** Set inside the transaction, consumed after it commits. */
  let deductionIds: string[] = [];

  await runTransaction(db, async (tx) => {
    const snap = await tx.get(runRef);
    if (!snap.exists()) throw new Error("Wage run not found.");
    const run = snap.data();
    if (run.status !== "draft") {
      throw new Error(`This run is already ${run.status}, so it cannot be approved again.`);
    }

    deductionIds = (run.deductionIds ?? []) as string[];

    /*
     * Loan repayments are driven by the loan half of the deduction only.
     *
     * `deductionKobo` on a row is loans *plus* work-log deductions, and posting that
     * against the loan ledger would credit a no-show penalty as a loan repayment —
     * quietly writing off part of a real debt. `loanDeductionKobo` is the figure that
     * actually came off a loan. It is read with a fallback to the combined figure so
     * runs drafted before the split existed still post correctly: those had no
     * work-log deductions, so the two were the same number.
     */
    const perStaff = (run.perStaff ?? []) as Array<{
      staffId: string;
      staffName: string;
      deductionKobo: number;
      loanDeductionKobo?: number;
    }>;

    // Every loan this run might touch, read up front.
    //
    // Firestore requires all reads in a transaction to precede all writes. Reading
    // each loan as it was applied put the second staff member's tx.get after the
    // first one's tx.update, which fails with "transactions require all reads to be
    // executed before all writes". The reads are therefore hoisted out of the loop
    // and the applying pass below is pure computation over what was read.
    const relevantIds = [
      ...new Set(
        perStaff
          .filter((s) => (s.loanDeductionKobo ?? s.deductionKobo ?? 0) > 0)
          .flatMap((s) => candidatesByStaff.get(s.staffId) ?? [])
      ),
    ];
    const loanSnaps = await Promise.all(
      relevantIds.map((id) => tx.get(doc(db, COL.loans, id)))
    );
    const loansById = new Map<string, Loan>();
    relevantIds.forEach((id, i) => {
      const snap = loanSnaps[i];
      if (snap.exists()) loansById.set(id, snap.data() as Loan);
    });

    // Apply each staff member's deduction across their outstanding loans,
    // oldest first, so the ledger closes loans in the order they were taken.
    for (const s of perStaff) {
      // The loan portion only — see the note above `perStaff`.
      let remaining = s.loanDeductionKobo ?? s.deductionKobo ?? 0;
      if (remaining <= 0) continue;

      const ids = (candidatesByStaff.get(s.staffId) ?? []).sort(
        (a, b) => (requestedAtById.get(a) ?? 0) - (requestedAtById.get(b) ?? 0)
      );

      for (const loanId of ids) {
        if (remaining <= 0) break;

        const loan = loansById.get(loanId);
        if (!loan) continue;

        // Status may have changed since the pre-query; skip anything settled.
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

        tx.set(doc(collection(db, loanRepaymentsPath(loanId))), {
          wageRunId: runId,
          amountKobo: take,
          at: serverTimestamp(),
          recordedBy: actor.uid,
        });

        // Written back so a second staff member sharing this loan (or the same
        // person's next deduction) sees the reduced balance rather than the
        // original, which would double-apply the repayment.
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

  /*
   * Claim the work-log deductions this run took.
   *
   * After the transaction rather than inside it: the deduction ids come from the run
   * document, which is only read once the transaction opens, and Firestore requires
   * every read to precede every write — so fetching them to update would have to
   * happen before the run's own status check.
   *
   * Ordered so the failure mode is the harmless one. If this throws, the run is
   * approved and the deductions stay pending, so the next run claims them: someone
   * is deducted later than intended. The reverse order would mark them consumed
   * against a run that then failed to approve, and the money would never be
   * withheld at all.
   */
  await markDeductionsApplied(db, actor, deductionIds, runId, "wage");

  await writeAudit(db, {
    actor,
    action: "wage_run_approve",
    collectionName: COL.wageRuns,
    docId: runId,
    summary:
      "Approved wage run, posted loan repayments" +
      (deductionIds.length
        ? ` and applied ${deductionIds.length} work-log deduction(s)`
        : ""),
  });
}

/**
 * Adjusts one person's pay on a draft run.
 *
 * Draft only. An approved run has been signed off and a paid one has left the
 * account, so both are a record of a decision already taken rather than a working
 * document. Approving is the point at which the figures stop being editable, which
 * is why the guard lives here and not only in the UI.
 *
 * The run's own totals are recomputed from the adjusted rows rather than patched by
 * a delta, so the header can never drift from the lines that justify it. The
 * deduction is left alone: it comes from outstanding loans, and overriding it here
 * would let someone quietly write off a debt without a repayment being recorded.
 */
export async function adjustWageRunStaff(
  db: Firestore,
  actor: AuditActor,
  runId: string,
  staffId: string,
  next: { operatorKobo: number; assistantKobo: number }
): Promise<void> {
  if (next.operatorKobo < 0 || next.assistantKobo < 0) {
    throw new Error("Pay cannot be negative.");
  }

  const ref = doc(db, COL.wageRuns, runId);

  await runTransaction(db, async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists()) throw new Error("Wage run not found.");
    const run = snap.data();

    if (run.status !== "draft") {
      throw new Error(
        `This run is ${run.status}, so its figures can no longer be changed. ` +
          "Generate a new run for the period instead."
      );
    }

    const perStaff = (run.perStaff ?? []) as RunPreview["perStaff"];
    const row = perStaff.find((s) => s.staffId === staffId);
    if (!row) throw new Error("That staff member is not on this run.");

    const before = { operatorKobo: row.operatorKobo, assistantKobo: row.assistantKobo };

    const updated = perStaff.map((s) => {
      if (s.staffId !== staffId) return s;
      const total = next.operatorKobo + next.assistantKobo;
      return {
        ...s,
        operatorKobo: next.operatorKobo,
        assistantKobo: next.assistantKobo,
        totalKobo: total,
        // Never negative: a deduction larger than the adjusted gross would
        // otherwise show as the company owing the worker money.
        netKobo: Math.max(0, total - (s.deductionKobo ?? 0)),
      };
    });

    const grandTotal = sumKobo(updated.map((s) => s.totalKobo));
    const deductions = sumKobo(updated.map((s) => s.deductionKobo ?? 0));

    tx.update(ref, {
      perStaff: updated,
      operatorTotalKobo: sumKobo(updated.map((s) => s.operatorKobo)),
      assistantTotalKobo: sumKobo(updated.map((s) => s.assistantKobo)),
      grandTotalKobo: grandTotal,
      deductionsKobo: deductions,
      netPayableKobo: Math.max(0, grandTotal - deductions),
      // Flagged so a run that no longer matches the work logs is obvious later.
      adjusted: true,
      updatedAt: serverTimestamp(),
      updatedBy: actor.uid,
    });

    return { before, name: row.staffName };
  });

  await writeAudit(db, {
    actor,
    action: "update",
    collectionName: COL.wageRuns,
    docId: runId,
    summary:
      `Adjusted pay on a draft run: operator ${next.operatorKobo} kobo, ` +
      `assistant ${next.assistantKobo} kobo`,
    after: { staffId, ...next },
  });
}

/**
 * Deletes a draft run and its lines.
 *
 * A draft is a working document derived from the work logs, so discarding one and
 * regenerating is the normal way to pick up a corrected log. Approved and paid runs
 * are never deletable: they are the record of what was actually paid.
 */
/**
 * Returns an approved or paid run to draft so its figures can be corrected.
 *
 * Nothing about payroll should be permanently stuck: a run approved against the
 * wrong week, or paid with an assistant's share missed, has to be fixable. What must
 * not happen is a silent rewrite of what was paid, so this leaves a trail — the
 * audit entry records the status it came from and the net it stood at, and the
 * reopened run carries `reopenedFrom` and `reopenedNetKobo` for anyone reading the
 * document later.
 *
 * Reopening a *paid* run also removes the expense that payment booked. That expense
 * is keyed on the run id and `recordPayrollExpense` refuses to write a second one
 * for the same source, so leaving it would both overstate costs for a payment that
 * is being unwound and prevent the corrected run from ever booking its own.
 */
export async function reopenWageRun(
  db: Firestore,
  actor: AuditActor,
  runId: string
): Promise<void> {
  const ref = doc(db, COL.wageRuns, runId);
  const snap = await getDoc(ref);
  if (!snap.exists()) throw new Error("Wage run not found.");
  const run = snap.data();
  const from = String(run.status ?? "draft");
  if (from === "draft") throw new Error("This run is already a draft.");

  if (from === "paid") {
    const booked = await getDocs(
      query(
        collection(db, COL.expenses),
        where("sourceCollection", "==", COL.wageRuns),
        where("sourceId", "==", runId)
      )
    );
    for (const d of booked.docs) await deleteDoc(d.ref);
  }

  /*
   * Return the work-log deductions to the pending pool.
   *
   * The money was never actually withheld — the run is being unwound — so the
   * penalty or advance is still owed and has to be available to whatever run
   * replaces this one. Without this, reopening a run quietly forgives every
   * deduction in it, which is the opposite of what reopening is for.
   */
  const released = await releaseDeductionsForRun(db, actor, runId);

  await updateDoc(ref, {
    status: "draft",
    approvedAt: null,
    approvedBy: null,
    paidAt: null,
    reopenedFrom: from,
    reopenedNetKobo: run.netPayableKobo ?? 0,
    reopenedAt: serverTimestamp(),
    updatedBy: actor.uid,
  });

  await writeAudit(db, {
    actor,
    action: "status_change",
    collectionName: COL.wageRuns,
    docId: runId,
    summary:
      `Reopened a ${from} wage run for editing` +
      (from === "paid"
        ? ` and reversed the ${run.netPayableKobo ?? 0} kobo payroll expense it had booked`
        : "") +
      (released ? `; released ${released} deduction(s) back to pending` : ""),
    before: { status: from, netPayableKobo: run.netPayableKobo ?? 0 },
    after: { status: "draft" },
  });
}

/**
 * Deletes a wage run and its lines.
 *
 * A run at any status can go, because a run created for the wrong period is not
 * something to live with. An approved or paid one has to be reopened first, which is
 * what forces the payroll expense to be reversed and leaves the audit trail — so the
 * money that left the business is never quietly detached from the record of it.
 */
export async function deleteDraftWageRun(
  db: Firestore,
  actor: AuditActor,
  runId: string
): Promise<void> {
  const ref = doc(db, COL.wageRuns, runId);
  const snap = await getDoc(ref);
  if (!snap.exists()) throw new Error("Wage run not found.");
  if (snap.data().status !== "draft") {
    throw new Error(
      `This run is ${snap.data().status}. Reopen it first — that reverses the payroll expense and records what it stood at before anything is deleted.`
    );
  }

  // Lines are a subcollection, so they are removed explicitly or they outlive the
  // run and count toward nothing.
  const lineSnap = await getDocs(collection(db, wageRunLinesPath(runId)));
  for (let i = 0; i < lineSnap.docs.length; i += 400) {
    const batch = writeBatch(db);
    lineSnap.docs.slice(i, i + 400).forEach((d) => batch.delete(d.ref));
    await batch.commit();
  }

  // A draft should not hold claimed deductions — approval is what claims them, and
  // reopening releases them — but a deduction pointing at a deleted run would be
  // stranded as neither applied nor pending, so it is never claimable again. Cheap
  // to be certain about.
  await releaseDeductionsForRun(db, actor, runId);

  await deleteDoc(ref);

  await writeAudit(db, {
    actor,
    action: "delete",
    collectionName: COL.wageRuns,
    docId: runId,
    summary: `Discarded a draft wage run (${lineSnap.size} line(s))`,
  });
}

/** Marks an approved run as paid. */
/**
 * Books a paid payroll run into the expense ledger.
 *
 * Shared by the weekly wage run and the monthly salary run, so labour cost reaches
 * the books the same way regardless of how someone is paid.
 *
 * Idempotent by construction: the expense carries the run that produced it, and an
 * existing entry for that run short-circuits the write. Marking a run paid twice
 * would otherwise book the payroll twice and quietly halve the reported profit.
 */
export async function recordPayrollExpense(
  db: Firestore,
  actor: AuditActor,
  input: {
    amountKobo: number;
    date: Date;
    purpose: string;
    sourceCollection: string;
    sourceId: string;
    /**
     * Which cost line this lands on.
     *
     * Weekly piece-rate wages and monthly salaries are both labour but are not the
     * same cost to manage — one moves with how busy the workshop is and the other
     * does not — so the profit report separates them. Defaults to `wages` for
     * callers that predate the distinction.
     */
    category?: ExpenseCategory;
  }
): Promise<void> {
  if (input.amountKobo <= 0) return;

  const existing = await getDocs(
    query(
      collection(db, COL.expenses),
      where("sourceCollection", "==", input.sourceCollection),
      where("sourceId", "==", input.sourceId)
    )
  );
  if (!existing.empty) return;

  await addDoc(collection(db, COL.expenses), {
    date: Timestamp.fromDate(input.date),
    payeeType: "staff",
    payeeName: "Payroll",
    purpose: input.purpose,
    category: input.category ?? ("wages" satisfies ExpenseCategory),
    amountKobo: input.amountKobo,
    receiptUrl: null,
    // The link back to the run is what makes this idempotent, and what lets an
    // auditor trace an expense line to the payroll that justifies it.
    sourceCollection: input.sourceCollection,
    sourceId: input.sourceId,
    createdAt: serverTimestamp(),
    createdBy: actor.uid,
  });

  await writeAudit(db, {
    actor,
    action: "create",
    collectionName: COL.expenses,
    docId: input.sourceId,
    summary: `Booked ${input.purpose} to expenses: ${input.amountKobo} kobo`,
    after: { amountKobo: input.amountKobo, category: input.category ?? "wages" },
  });
}

export async function markWageRunPaid(
  db: Firestore,
  actor: AuditActor,
  runId: string
): Promise<void> {
  const ref = doc(db, COL.wageRuns, runId);
  const snap = await getDoc(ref);
  if (!snap.exists()) throw new Error("Wage run not found.");
  const run = snap.data();
  if (run.status === "paid") throw new Error("This run is already marked paid.");
  if (run.status !== "approved") {
    throw new Error("Approve the run before marking it paid.");
  }

  await updateDoc(ref, {
    status: "paid",
    paidAt: serverTimestamp(),
    updatedBy: actor.uid,
  });

  // Wages are the workshop's largest cost, so paying a run has to reach the
  // expense ledger or the dashboard reports revenue with the labour that earned
  // it missing, and every profit figure is overstated.
  //
  // Written at the point of payment rather than approval, because approval commits
  // the figure while payment is when the money actually leaves. The net is used,
  // not the gross: a loan repayment deducted from pay never leaves the business,
  // and booking the gross would double-count money already recorded as lent.
  await recordPayrollExpense(db, actor, {
    amountKobo: run.netPayableKobo ?? 0,
    date: new Date(),
    purpose: `Wage run ${fmtPeriod(
      run.periodStart?.toDate?.() ?? new Date(),
      run.periodEnd?.toDate?.() ?? new Date()
    )}`,
    sourceCollection: COL.wageRuns,
    sourceId: runId,
  });

  await writeAudit(db, {
    actor,
    action: "wage_run_pay",
    collectionName: COL.wageRuns,
    docId: runId,
    summary: "Marked wage run as paid",
  });
}

// ---------------------------------------------------------------------------
// Loans and advances
// ---------------------------------------------------------------------------

export async function requestLoan(
  db: Firestore,
  actor: AuditActor,
  input: {
    staffId: string;
    staffName: string;
    type: "loan" | "advance";
    amountKobo: number;
    purpose: string;
  }
): Promise<string> {
  const ref = doc(collection(db, COL.loans));
  const batch = writeBatch(db);
  batch.set(ref, {
    ...input,
    status: "requested",
    requestedAt: serverTimestamp(),
    repaidKobo: 0,
    outstandingKobo: 0, // set on disbursement, not on request
    createdAt: serverTimestamp(),
    createdBy: actor.uid,
  });
  await batch.commit();

  await writeAudit(db, {
    actor,
    action: "loan_request",
    collectionName: COL.loans,
    docId: ref.id,
    summary: `${input.staffName} requested a ${input.type} of ${input.amountKobo} kobo`,
    after: { amountKobo: input.amountKobo, purpose: input.purpose },
  });

  return ref.id;
}

/**
 * Approves and disburses in one step.
 *
 * `outstandingKobo` is set here rather than at request time: nothing is owed
 * until the money actually leaves, and a pending request must not appear as a
 * deduction on the next wage run.
 */
export async function approveLoan(
  db: Firestore,
  actor: AuditActor,
  loanId: string,
  staffName: string,
  amountKobo: number
): Promise<void> {
  await updateDoc(doc(db, COL.loans, loanId), {
    status: "disbursed",
    approvedBy: actor.uid,
    approvedAt: serverTimestamp(),
    disbursedAt: serverTimestamp(),
    outstandingKobo: amountKobo,
    updatedAt: serverTimestamp(),
    updatedBy: actor.uid,
  });

  await writeAudit(db, {
    actor,
    action: "loan_approve",
    collectionName: COL.loans,
    docId: loanId,
    summary: `Approved and disbursed ${amountKobo} kobo to ${staffName}`,
    after: { status: "disbursed", outstandingKobo: amountKobo },
  });
}

/**
 * Corrects a loan or advance that has not been disbursed.
 *
 * Only while it is still `requested`. Once money has left, the amount owed is a
 * fact about a payment that has happened, and editing it would silently change what
 * the next wage run deducts from someone's pay without any repayment having been
 * made. A disbursed loan is corrected by recording repayments, not by retyping it.
 */
export async function updateLoanRequest(
  db: Firestore,
  actor: AuditActor,
  loanId: string,
  input: {
    staffId: string;
    staffName: string;
    type: "loan" | "advance";
    amountKobo: number;
    purpose: string;
  }
): Promise<void> {
  if (input.amountKobo <= 0) throw new Error("An amount is required.");

  const ref = doc(db, COL.loans, loanId);
  const snap = await getDoc(ref);
  if (!snap.exists()) throw new Error("That request no longer exists.");
  const prev = snap.data();

  if (prev.status !== "requested") {
    throw new Error(
      `This is already ${prev.status}, so it can no longer be edited. ` +
        "Record a repayment instead."
    );
  }

  await updateDoc(ref, {
    staffId: input.staffId,
    staffName: input.staffName,
    type: input.type,
    amountKobo: input.amountKobo,
    purpose: input.purpose,
    updatedAt: serverTimestamp(),
    updatedBy: actor.uid,
  });

  await writeAudit(db, {
    actor,
    action: "update",
    collectionName: COL.loans,
    docId: loanId,
    summary:
      `Edited ${input.type} request for ${input.staffName}: ` +
      `${prev.amountKobo ?? 0} → ${input.amountKobo} kobo`,
    before: { amountKobo: prev.amountKobo ?? 0, staffName: prev.staffName ?? "" },
    after: { amountKobo: input.amountKobo, staffName: input.staffName },
  });
}

/**
 * Withdraws a request that should not have been raised.
 *
 * Kept as a status rather than a delete so the request still appears in the
 * history: a withdrawn request and one that was never made are different facts,
 * and staff do ask why a request vanished.
 */
export async function cancelLoanRequest(
  db: Firestore,
  actor: AuditActor,
  loanId: string,
  staffName: string
): Promise<void> {
  const ref = doc(db, COL.loans, loanId);
  const snap = await getDoc(ref);
  if (!snap.exists()) throw new Error("That request no longer exists.");
  if (snap.data().status !== "requested") {
    throw new Error("Only a pending request can be withdrawn.");
  }

  await updateDoc(ref, {
    status: "rejected",
    rejectedAt: serverTimestamp(),
    withdrawn: true,
    updatedAt: serverTimestamp(),
    updatedBy: actor.uid,
  });

  await writeAudit(db, {
    actor,
    action: "loan_reject",
    collectionName: COL.loans,
    docId: loanId,
    summary: `Withdrew the request from ${staffName}`,
    after: { status: "rejected", withdrawn: true },
  });
}

export async function rejectLoan(
  db: Firestore,
  actor: AuditActor,
  loanId: string,
  staffName: string,
  reason?: string
): Promise<void> {
  await updateDoc(doc(db, COL.loans, loanId), {
    status: "rejected",
    notes: reason ?? null,
    updatedAt: serverTimestamp(),
    updatedBy: actor.uid,
  });

  await writeAudit(db, {
    actor,
    action: "loan_reject",
    collectionName: COL.loans,
    docId: loanId,
    summary: `Rejected loan request from ${staffName}`,
    after: { status: "rejected", reason: reason ?? null },
  });
}

// ---------------------------------------------------------------------------
// Rates
// ---------------------------------------------------------------------------

/**
 * Changes a rate by closing the current one and inserting a replacement.
 *
 * Never an in-place edit: a past wage run must stay reproducible, and
 * overwriting the rate would silently restate what people were already paid.
 */
export async function setWageRate(
  db: Firestore,
  actor: AuditActor,
  /**
   * A built-in work type, or the id of one the workshop added.
   *
   * Typed as a plain string rather than `WageWorkType` because the vocabulary is
   * extensible — see `addWorkType`. The engine looks rates up by id and never enumerates
   * the enum, so a custom type prices exactly like a built-in one.
   */
  workType: string,
  next: { operatorRateKobo: number; assistantRateKobo: number; effectiveFrom: Date; note?: string }
): Promise<void> {
  const effectiveFrom = Timestamp.fromDate(next.effectiveFrom);
  const batch = writeBatch(db);

  const currentSnap = await getDocs(
    query(
      collection(db, COL.wageRates),
      where("workType", "==", workType),
      where("effectiveTo", "==", null)
    )
  );
  for (const d of currentSnap.docs) {
    batch.update(d.ref, { effectiveTo: effectiveFrom });
  }

  batch.set(doc(collection(db, COL.wageRates)), {
    workType,
    operatorRateKobo: next.operatorRateKobo,
    assistantRateKobo: next.assistantRateKobo,
    effectiveFrom,
    effectiveTo: null,
    // A rate an admin has explicitly set is no longer a seeded guess.
    estimated: false,
    note: next.note ?? null,
    createdAt: serverTimestamp(),
    createdBy: actor.uid,
  });

  await batch.commit();

  await writeAudit(db, {
    actor,
    action: "wage_rate_change",
    collectionName: COL.wageRates,
    docId: workType,
    summary:
      `${workType}: operator ${next.operatorRateKobo} kobo, ` +
      `assistant ${next.assistantRateKobo} kobo`,
    after: {
      operatorRateKobo: next.operatorRateKobo,
      assistantRateKobo: next.assistantRateKobo,
    },
  });
}

/**
 * Sets a rate for one person, closing whatever they were on before.
 *
 * Versioned rather than overwritten, exactly as `setWageRate` is: a wage run from
 * before a raise has to stay reproducible, and an in-place edit would silently
 * restate what somebody was already paid.
 *
 * `workType` null means every kind of work — the usual case, where one operator is
 * simply on a better rate than the standard. A row naming a work type beats the
 * general one (see `rateFor`), so a blanket uplift and a single exception can
 * coexist without one erasing the other.
 */
export async function setStaffRate(
  db: Firestore,
  actor: AuditActor,
  input: {
    staffId: string;
    staffName: string;
    role: "operator" | "assistant";
    workType?: WageWorkType | null;
    rateKobo: number;
    effectiveFrom: Date;
    note?: string;
  }
): Promise<void> {
  if (!input.staffId) throw new Error("Choose who this rate is for.");
  if (!(input.rateKobo >= 0)) throw new Error("A rate cannot be negative.");

  const effectiveFrom = Timestamp.fromDate(input.effectiveFrom);
  const workType = input.workType ?? null;

  // Close only the row this one replaces: the same person, the same role, the same
  // work-type slot. Closing every rate a person holds would wipe a per-type
  // exception the moment a general rate was set.
  const currentSnap = await getDocs(
    query(
      collection(db, COL.staffRates),
      where("staffId", "==", input.staffId),
      where("role", "==", input.role),
      where("workType", "==", workType),
      where("effectiveTo", "==", null)
    )
  );

  const batch = writeBatch(db);
  for (const d of currentSnap.docs) {
    batch.update(d.ref, { effectiveTo: effectiveFrom });
  }
  batch.set(doc(collection(db, COL.staffRates)), {
    staffId: input.staffId,
    staffName: input.staffName,
    role: input.role,
    workType,
    rateKobo: input.rateKobo,
    effectiveFrom,
    effectiveTo: null,
    note: input.note?.trim() || null,
    createdAt: serverTimestamp(),
    createdBy: actor.uid,
  });
  await batch.commit();

  await writeAudit(db, {
    actor,
    action: "wage_rate_change",
    collectionName: COL.staffRates,
    docId: input.staffId,
    summary:
      `${input.staffName} (${input.role}, ${workType ?? "all work"}): ` +
      `${input.rateKobo} kobo per unit`,
    after: {
      staffId: input.staffId,
      role: input.role,
      workType,
      rateKobo: input.rateKobo,
    },
  });
}

/**
 * Ends a per-person rate, returning that person to the standard rate.
 *
 * Closed rather than deleted, so a run from while it applied can still be explained.
 * Effective from now, because a rate that stops applying retroactively would restate
 * pay already agreed.
 */
export async function endStaffRate(
  db: Firestore,
  actor: AuditActor,
  rateId: string
): Promise<void> {
  const ref = doc(db, COL.staffRates, rateId);
  const snap = await getDoc(ref);
  if (!snap.exists()) throw new Error("That rate no longer exists.");
  const r = snap.data();

  await updateDoc(ref, {
    effectiveTo: Timestamp.fromDate(new Date()),
    updatedAt: serverTimestamp(),
    updatedBy: actor.uid,
  });

  await writeAudit(db, {
    actor,
    action: "wage_rate_change",
    collectionName: COL.staffRates,
    docId: rateId,
    summary:
      `Ended the personal rate for ${r.staffName ?? "staff"} ` +
      `(${r.role ?? "?"}, ${r.workType ?? "all work"}); back to the standard rate`,
    before: { rateKobo: r.rateKobo ?? 0 },
  });
}

// ---------------------------------------------------------------------------
// Work-type vocabulary
// ---------------------------------------------------------------------------

/** The workshop's own additions and hidden built-ins. */
export async function loadWorkTypeSettings(
  db: Firestore
): Promise<WageWorkTypeSettings> {
  try {
    const snap = await getDoc(doc(db, COL.settings, SETTINGS_DOC.wageWorkTypes));
    if (!snap.exists()) return DEFAULT_WAGE_WORK_TYPE_SETTINGS;
    const d = snap.data();
    return {
      custom: (d.custom ?? []) as Array<{ id: string; label: string }>,
      hidden: (d.hidden ?? []) as string[],
    };
  } catch {
    return DEFAULT_WAGE_WORK_TYPE_SETTINGS;
  }
}

/**
 * Adds a kind of work the built-in list does not cover.
 *
 * The id is derived from the label once and never recomputed, because every work log and
 * wage line stores it — renaming the type later changes what it is called and leaves
 * historical records attached to it.
 */
export async function addWorkType(
  db: Firestore,
  actor: AuditActor,
  label: string
): Promise<string> {
  const trimmed = label.trim();
  if (!trimmed) throw new Error("Name the kind of work.");

  const id = workTypeIdFrom(trimmed);
  if (!id) throw new Error("That name has no letters or numbers in it.");

  const settings = await loadWorkTypeSettings(db);

  if ((WAGE_WORK_TYPES as readonly string[]).includes(id)) {
    throw new Error(
      `"${trimmed}" already exists as a standard work type. Set its rate rather than adding it again.`
    );
  }
  if (settings.custom.some((c) => c.id === id)) {
    throw new Error(`"${trimmed}" has already been added.`);
  }

  await setDoc(
    doc(db, COL.settings, SETTINGS_DOC.wageWorkTypes),
    {
      custom: [...settings.custom, { id, label: trimmed }],
      // Adding back something previously hidden un-hides it, which is what someone
      // re-adding a name they removed actually means.
      hidden: settings.hidden.filter((h) => h !== id),
    },
    { merge: true }
  );

  await writeAudit(db, {
    actor,
    action: "settings_change",
    collectionName: COL.settings,
    docId: SETTINGS_DOC.wageWorkTypes,
    summary: `Added work type "${trimmed}" (${id})`,
    after: { id, label: trimmed },
  });

  return id;
}

/**
 * Stops offering a work type, without erasing it.
 *
 * Hidden rather than deleted for two reasons: a work log or wage run from last year still
 * references it and has to keep rendering a label, and a rate already set against it stays
 * valid for reproducing that run. Hiding removes it from the pickers only.
 *
 * A type with work logged against it in the current period is refused, because hiding it
 * would leave that work unpriceable in the run about to be generated.
 */
export async function hideWorkType(
  db: Firestore,
  actor: AuditActor,
  workTypeId: string,
  label: string
): Promise<void> {
  const settings = await loadWorkTypeSettings(db);
  if (settings.hidden.includes(workTypeId)) return;

  const remaining = resolveWorkTypes(settings).filter((t) => t.id !== workTypeId);
  if (remaining.length === 0) {
    throw new Error("At least one kind of work has to remain.");
  }

  await setDoc(
    doc(db, COL.settings, SETTINGS_DOC.wageWorkTypes),
    { hidden: [...settings.hidden, workTypeId] },
    { merge: true }
  );

  await writeAudit(db, {
    actor,
    action: "settings_change",
    collectionName: COL.settings,
    docId: SETTINGS_DOC.wageWorkTypes,
    summary:
      `Stopped offering work type "${label}" (${workTypeId}). ` +
      "Existing logs and rates keep it.",
    after: { hidden: workTypeId },
  });
}

/** Offers a hidden work type again. */
export async function unhideWorkType(
  db: Firestore,
  actor: AuditActor,
  workTypeId: string,
  label: string
): Promise<void> {
  const settings = await loadWorkTypeSettings(db);
  await setDoc(
    doc(db, COL.settings, SETTINGS_DOC.wageWorkTypes),
    { hidden: settings.hidden.filter((h) => h !== workTypeId) },
    { merge: true }
  );

  await writeAudit(db, {
    actor,
    action: "settings_change",
    collectionName: COL.settings,
    docId: SETTINGS_DOC.wageWorkTypes,
    summary: `Offering work type "${label}" (${workTypeId}) again`,
  });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fmtPeriod(start: Date, end: Date): string {
  const f = (d: Date) =>
    d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
  return `${f(start)} to ${f(end)}`;
}

/** Total gross across a set of run lines, for display checks. */
export function grossOf(lines: ComputedWageLine[]): number {
  return sumKobo(lines.map((l) => l.amountKobo));
}

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
import { COL, loanRepaymentsPath, wageRunLinesPath } from "./collections";
import type { WageWorkType } from "./enums";
import { sumKobo } from "./money";
import type { Loan, WageRate, WorkLog } from "./types";
import { writeAudit, type AuditActor } from "./audit";
import {
  applyDeductions,
  computeWageRun,
  resolveRates,
  type ComputedWageLine,
} from "./wages";

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
    deductionKobo: number;
    netKobo: number;
  }>;
  operatorTotalKobo: number;
  assistantTotalKobo: number;
  grandTotalKobo: number;
  deductionsKobo: number;
  netPayableKobo: number;
  unattributedAssistantKobo: number;
  missingRates: WageWorkType[];
  ratesUsed: Array<{
    workType: WageWorkType;
    operatorRateKobo: number;
    assistantRateKobo: number;
  }>;
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

  const [logSnap, rateSnap, loanSnap, staffSnap] = await Promise.all([
    getDocs(
      query(
        collection(db, COL.workLogs),
        where("workDate", ">=", startTs),
        where("workDate", "<=", endTs)
      )
    ),
    getDocs(collection(db, COL.wageRates)),
    getDocs(
      query(collection(db, COL.loans), where("status", "in", ["disbursed", "repaying"]))
    ),
    getDocs(collection(db, COL.staff)),
  ]);

  const logs = logSnap.docs.map((d) => ({ id: d.id, ...d.data() })) as WorkLog[];
  const rates = rateSnap.docs.map((d) => ({ id: d.id, ...d.data() })) as WageRate[];

  const staffNames = new Map<string, string>();
  for (const d of staffSnap.docs) staffNames.set(d.id, (d.data().name as string) ?? d.id);

  const resolved = resolveRates(rates, input.periodEnd.getTime());
  const computed = computeWageRun(logs, resolved, staffNames);

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

  const { applied, totalDeductedKobo } = applyDeductions(
    computed.perStaff,
    [...outstandingByStaff.entries()].map(([staffId, outstandingKobo]) => ({
      staffId,
      outstandingKobo,
    }))
  );
  const deductionByStaff = new Map(applied.map((a) => [a.staffId, a.deductedKobo]));

  const perStaff = computed.perStaff.map((s) => {
    const deductionKobo = deductionByStaff.get(s.staffId) ?? 0;
    return { ...s, deductionKobo, netKobo: s.totalKobo - deductionKobo };
  });

  return {
    lines: computed.lines,
    perStaff,
    operatorTotalKobo: computed.operatorTotalKobo,
    assistantTotalKobo: computed.assistantTotalKobo,
    grandTotalKobo: computed.grandTotalKobo,
    deductionsKobo: totalDeductedKobo,
    netPayableKobo: computed.grandTotalKobo - totalDeductedKobo,
    unattributedAssistantKobo: computed.unattributedAssistantKobo,
    missingRates: computed.missingRates,
    ratesUsed: [...resolved.values()],
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
    operatorTotalKobo: preview.operatorTotalKobo,
    assistantTotalKobo: preview.assistantTotalKobo,
    grandTotalKobo: preview.grandTotalKobo,
    deductionsKobo: preview.deductionsKobo,
    netPayableKobo: preview.netPayableKobo,
    unattributedAssistantKobo: preview.unattributedAssistantKobo,
    logCount: preview.logCount,
    perStaff: preview.perStaff,
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

  await runTransaction(db, async (tx) => {
    const snap = await tx.get(runRef);
    if (!snap.exists()) throw new Error("Wage run not found.");
    const run = snap.data();
    if (run.status !== "draft") {
      throw new Error(`This run is already ${run.status}, so it cannot be approved again.`);
    }

    const perStaff = (run.perStaff ?? []) as Array<{
      staffId: string;
      staffName: string;
      deductionKobo: number;
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
          .filter((s) => (s.deductionKobo ?? 0) > 0)
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
      let remaining = s.deductionKobo ?? 0;
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

  await writeAudit(db, {
    actor,
    action: "wage_run_approve",
    collectionName: COL.wageRuns,
    docId: runId,
    summary: "Approved wage run and posted loan repayments",
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
export async function deleteDraftWageRun(
  db: Firestore,
  actor: AuditActor,
  runId: string
): Promise<void> {
  const ref = doc(db, COL.wageRuns, runId);
  const snap = await getDoc(ref);
  if (!snap.exists()) throw new Error("Wage run not found.");
  if (snap.data().status !== "draft") {
    throw new Error("Only a draft run can be discarded.");
  }

  // Lines are a subcollection, so they are removed explicitly or they outlive the
  // run and count toward nothing.
  const lineSnap = await getDocs(collection(db, wageRunLinesPath(runId)));
  for (let i = 0; i < lineSnap.docs.length; i += 400) {
    const batch = writeBatch(db);
    lineSnap.docs.slice(i, i + 400).forEach((d) => batch.delete(d.ref));
    await batch.commit();
  }

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
export async function markWageRunPaid(
  db: Firestore,
  actor: AuditActor,
  runId: string
): Promise<void> {
  await updateDoc(doc(db, COL.wageRuns, runId), {
    status: "paid",
    paidAt: serverTimestamp(),
    updatedBy: actor.uid,
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
  workType: WageWorkType,
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

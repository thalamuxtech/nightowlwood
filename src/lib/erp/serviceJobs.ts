import {
  addDoc,
  collection,
  doc,
  getDocs,
  increment,
  runTransaction,
  serverTimestamp,
  Timestamp,
  updateDoc,
  writeBatch,
  type Firestore,
} from "firebase/firestore";
import { COL, COUNTER, jobLinesPath, jobPaymentsPath } from "./collections";
import { JOB_STATUS_FLOW, type BoardType, type JobStatus, type ServiceType } from "./enums";
import { lineAmountKobo, sumKobo } from "./money";
import { allocateDocNumber } from "./numbering";
import type { BoardBreakdown, JobPayment, ServiceJobLine } from "./types";
import { writeAudit, type AuditActor } from "./audit";

/**
 * Service-job operations.
 *
 * Totals are stored on the job document rather than summed on read: a job list
 * showing 200 rows would otherwise need 400 extra subcollection reads. The
 * trade-off is that every write path has to keep them correct, which is why
 * mutations go through these helpers instead of raw `updateDoc` calls.
 */

export interface NewJobInput {
  customerId: string;
  customerName: string;
  customerPhone?: string;
  staffId?: string;
  staffName?: string;
  boards: BoardBreakdown;
  accessories?: string;
  driverName?: string;
  driverPhone?: string;
  notes?: string;
  /** Optional opening lines, priced from the rate card. */
  lines?: Array<Omit<ServiceJobLine, "id" | "amountKobo">>;
}

export interface CreateJobResult {
  jobId: string;
  jobNumber: string;
}

/**
 * Creates a job with its opening line items and a reserved job number.
 *
 * The number is allocated in its own transaction before the batch, because a
 * counter read-modify-write cannot share a batch with the document that
 * consumes it.
 */
export async function createServiceJob(
  db: Firestore,
  actor: AuditActor,
  input: NewJobInput
): Promise<CreateJobResult> {
  const { formatted: jobNumber } = await allocateDocNumber(db, COUNTER.job);

  const lines = (input.lines ?? []).map((l) => ({
    ...l,
    amountKobo: lineAmountKobo(l.quantity, l.unitPriceKobo),
  }));
  const totalKobo = sumKobo(lines.map((l) => l.amountKobo));

  const jobRef = doc(collection(db, COL.serviceJobs));
  const batch = writeBatch(db);

  batch.set(jobRef, {
    jobNumber,
    customerId: input.customerId,
    customerName: input.customerName,
    customerPhone: input.customerPhone ?? null,
    staffId: input.staffId ?? null,
    staffName: input.staffName ?? null,
    boards: input.boards ?? {},
    accessories: input.accessories ?? null,
    driverName: input.driverName ?? null,
    driverPhone: input.driverPhone ?? null,
    status: "received" satisfies JobStatus,
    receivedAt: serverTimestamp(),
    totalKobo,
    paidKobo: 0,
    balanceKobo: totalKobo,
    notes: input.notes ?? null,
    createdAt: serverTimestamp(),
    createdBy: actor.uid,
  });

  for (const line of lines) {
    batch.set(doc(collection(db, jobLinesPath(jobRef.id))), line);
  }

  await batch.commit();

  await writeAudit(db, {
    actor,
    action: "create",
    collectionName: COL.serviceJobs,
    docId: jobRef.id,
    summary: `Created ${jobNumber} for ${input.customerName}`,
    after: { jobNumber, customerName: input.customerName, totalKobo },
  });

  return { jobId: jobRef.id, jobNumber };
}

/** True when `to` is a permitted next status from `from`. */
export function canTransition(from: JobStatus, to: JobStatus): boolean {
  return JOB_STATUS_FLOW[from].includes(to);
}

/**
 * Moves a job to a new status, rejecting transitions the flow doesn't allow.
 *
 * Guarding here rather than only in the UI stops a stale tab from moving a
 * collected job back into production.
 */
export async function advanceJobStatus(
  db: Firestore,
  actor: AuditActor,
  jobId: string,
  jobNumber: string,
  from: JobStatus,
  to: JobStatus,
  extra: Record<string, unknown> = {}
): Promise<void> {
  if (!canTransition(from, to)) {
    throw new Error(`Cannot move ${jobNumber} from ${from} to ${to}.`);
  }

  const patch: Record<string, unknown> = {
    status: to,
    updatedAt: serverTimestamp(),
    updatedBy: actor.uid,
    ...extra,
  };
  // Stamp completion when the customer takes the work away.
  if (to === "collected") patch.completedAt = serverTimestamp();

  await updateDoc(doc(db, COL.serviceJobs, jobId), patch);

  await writeAudit(db, {
    actor,
    action: "status_change",
    collectionName: COL.serviceJobs,
    docId: jobId,
    summary: `${jobNumber}: ${from} → ${to}`,
    before: { status: from },
    after: { status: to },
  });
}

/**
 * Adds a line item and rolls the job totals forward.
 *
 * Runs in a transaction so two people pricing the same job cannot both read the
 * old total and overwrite each other's addition.
 */
export async function addJobLine(
  db: Firestore,
  actor: AuditActor,
  jobId: string,
  line: Omit<ServiceJobLine, "id" | "amountKobo">
): Promise<void> {
  const amountKobo = lineAmountKobo(line.quantity, line.unitPriceKobo);
  const jobRef = doc(db, COL.serviceJobs, jobId);
  const lineRef = doc(collection(db, jobLinesPath(jobId)));

  await runTransaction(db, async (tx) => {
    const snap = await tx.get(jobRef);
    if (!snap.exists()) throw new Error("Job not found.");
    const data = snap.data();
    const nextTotal = (data.totalKobo ?? 0) + amountKobo;
    const paid = data.paidKobo ?? 0;

    tx.set(lineRef, { ...line, amountKobo });
    tx.update(jobRef, {
      totalKobo: nextTotal,
      balanceKobo: nextTotal - paid,
      updatedAt: serverTimestamp(),
      updatedBy: actor.uid,
    });
  });

  await writeAudit(db, {
    actor,
    action: "update",
    collectionName: COL.serviceJobs,
    docId: jobId,
    summary: `Added line: ${line.serviceType} ×${line.quantity}`,
    after: { serviceType: line.serviceType, quantity: line.quantity, amountKobo },
  });
}

/** Removes a line item and rolls the totals back. */
export async function removeJobLine(
  db: Firestore,
  actor: AuditActor,
  jobId: string,
  lineId: string,
  amountKobo: number
): Promise<void> {
  const jobRef = doc(db, COL.serviceJobs, jobId);
  const lineRef = doc(db, `${jobLinesPath(jobId)}/${lineId}`);

  await runTransaction(db, async (tx) => {
    const snap = await tx.get(jobRef);
    if (!snap.exists()) throw new Error("Job not found.");
    const data = snap.data();
    const nextTotal = Math.max(0, (data.totalKobo ?? 0) - amountKobo);
    const paid = data.paidKobo ?? 0;

    tx.delete(lineRef);
    tx.update(jobRef, {
      totalKobo: nextTotal,
      balanceKobo: nextTotal - paid,
      updatedAt: serverTimestamp(),
      updatedBy: actor.uid,
    });
  });

  await writeAudit(db, {
    actor,
    action: "update",
    collectionName: COL.serviceJobs,
    docId: jobId,
    summary: `Removed a line item (−${amountKobo} kobo)`,
  });
}

/**
 * Records a payment against a job, the "Payment History" table on the paper
 * tracker, and updates the running balance.
 */
export async function recordJobPayment(
  db: Firestore,
  actor: AuditActor,
  jobId: string,
  jobNumber: string,
  payment: Pick<JobPayment, "description" | "amountKobo" | "method"> & { date?: Date }
): Promise<void> {
  const jobRef = doc(db, COL.serviceJobs, jobId);
  const payRef = doc(collection(db, jobPaymentsPath(jobId)));

  await runTransaction(db, async (tx) => {
    const snap = await tx.get(jobRef);
    if (!snap.exists()) throw new Error("Job not found.");
    const data = snap.data();
    const nextPaid = (data.paidKobo ?? 0) + payment.amountKobo;

    tx.set(payRef, {
      date: payment.date ? Timestamp.fromDate(payment.date) : serverTimestamp(),
      description: payment.description,
      amountKobo: payment.amountKobo,
      method: payment.method,
      createdAt: serverTimestamp(),
      createdBy: actor.uid,
    });
    tx.update(jobRef, {
      paidKobo: nextPaid,
      balanceKobo: (data.totalKobo ?? 0) - nextPaid,
      updatedAt: serverTimestamp(),
      updatedBy: actor.uid,
    });
  });

  await writeAudit(db, {
    actor,
    action: "payment_record",
    collectionName: COL.serviceJobs,
    docId: jobId,
    summary: `${jobNumber}: payment of ${payment.amountKobo} kobo (${payment.method})`,
    after: { amountKobo: payment.amountKobo, method: payment.method },
  });
}

/**
 * Recomputes totals from the subcollections.
 *
 * A repair path, not part of normal operation, for jobs whose stored totals
 * drifted (a failed batch, or data imported from the spreadsheets).
 */
export async function recalculateJobTotals(db: Firestore, jobId: string): Promise<void> {
  const [lineSnap, paySnap] = await Promise.all([
    getDocs(collection(db, jobLinesPath(jobId))),
    getDocs(collection(db, jobPaymentsPath(jobId))),
  ]);

  const totalKobo = sumKobo(lineSnap.docs.map((d) => d.data().amountKobo as number));
  const paidKobo = sumKobo(paySnap.docs.map((d) => d.data().amountKobo as number));

  await updateDoc(doc(db, COL.serviceJobs, jobId), {
    totalKobo,
    paidKobo,
    balanceKobo: totalKobo - paidKobo,
  });
}

/** Adds customer-brought boards to service inventory when a job is created. */
export async function receiveServiceInventory(
  db: Firestore,
  actor: AuditActor,
  input: {
    customerId: string;
    customerName: string;
    jobId: string;
    jobNumber: string;
    boardType: BoardType;
    quantity: number;
    description?: string;
  }
): Promise<void> {
  await addDoc(collection(db, COL.inventoryService), {
    ...input,
    description: input.description ?? null,
    status: "held",
    receivedAt: serverTimestamp(),
    createdAt: serverTimestamp(),
    createdBy: actor.uid,
  });
}

/** Board-breakdown keys that hold counts, excluding the free-text fields. */
const BOARD_COUNT_KEYS: Array<keyof BoardBreakdown> = [
  "mdf",
  "egger",
  "hdf",
  "quarter",
  "kwali",
  "tape",
];

/** Total boards recorded on a job, for list summaries. */
export function totalBoards(boards: BoardBreakdown | undefined): number {
  if (!boards) return 0;
  return BOARD_COUNT_KEYS.reduce((sum, k) => {
    const v = boards[k];
    return sum + (typeof v === "number" && Number.isFinite(v) ? v : 0);
  }, 0);
}

/** Board counts as `MDF 12 · Egger 4` for compact display. */
export function describeBoards(
  boards: BoardBreakdown | undefined,
  labels: Record<string, string>
): string {
  if (!boards) return "-";
  const parts = BOARD_COUNT_KEYS.filter((k) => {
    const v = boards[k];
    return typeof v === "number" && v > 0;
  }).map((k) => `${labels[k] ?? k} ${boards[k]}`);
  return parts.length ? parts.join(" · ") : "-";
}

/** Increments a customer's job counter, for the customer list. */
export async function bumpCustomerJobCount(db: Firestore, customerId: string): Promise<void> {
  await updateDoc(doc(db, COL.customers, customerId), {
    jobCount: increment(1),
    lastJobAt: serverTimestamp(),
  }).catch(() => {
    // Non-critical denormalisation; a missing counter must not fail job creation.
  });
}

/** Service types that price per board, used to prefill quantity from the boards. */
export const BOARD_PRICED_SERVICES: ServiceType[] = [
  "cutting_edging",
  "only_cutting",
  "special_board",
];

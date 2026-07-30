import {
  collection,
  doc,
  getDoc,
  getDocs,
  serverTimestamp,
  Timestamp,
  updateDoc,
  writeBatch,
  type Firestore,
} from "firebase/firestore";
import { COL, COUNTER, jobLinesPath } from "./collections";
import {
  SERVICE_TYPE_LABELS,
  type InvoiceStatus,
  type ServiceType,
} from "./enums";
import { applyPercentKobo, sumKobo } from "./money";
import { allocateDocNumber } from "./numbering";
import { componentsPath } from "./collections";
import { DEFAULT_INVOICE_SETTINGS, SETTINGS_DOC } from "./settings";
import type { InvoiceLine } from "./types";
import { writeAudit, type AuditActor } from "./audit";

/**
 * Invoice creation and issue.
 *
 * Invoices are generated **from** a job or project rather than typed by hand, so
 * the figure on the invoice is the figure in the records. Marking one paid is
 * deliberately not here: that goes through an admin-only Cloud Function, because
 * settling a debt in the books is the most abusable action in the system and a
 * client-side write would be enforced only by rules that a bug could sidestep.
 */

export interface InvoiceTotals {
  subtotalKobo: number;
  taxPercent: number;
  taxKobo: number;
  totalKobo: number;
}

/** Tax applies to the subtotal. Nothing compounds. */
export function computeInvoiceTotals(
  subtotalKobo: number,
  taxPercent: number
): InvoiceTotals {
  const taxKobo = applyPercentKobo(subtotalKobo, taxPercent);
  return { subtotalKobo, taxPercent, taxKobo, totalKobo: subtotalKobo + taxKobo };
}

async function invoiceSettings(db: Firestore) {
  try {
    const snap = await getDoc(doc(db, COL.settings, SETTINGS_DOC.invoice));
    if (!snap.exists()) return DEFAULT_INVOICE_SETTINGS;
    const d = snap.data();
    return {
      ...DEFAULT_INVOICE_SETTINGS,
      taxPercent: d.taxPercent ?? DEFAULT_INVOICE_SETTINGS.taxPercent,
      taxLabel: d.taxLabel ?? DEFAULT_INVOICE_SETTINGS.taxLabel,
      paymentTermsDays:
        d.paymentTermsDays ?? DEFAULT_INVOICE_SETTINGS.paymentTermsDays,
    };
  } catch {
    return DEFAULT_INVOICE_SETTINGS;
  }
}

/**
 * The customer's email, read from the customer record at invoice time.
 *
 * Not taken from the job or project: those hold a name-and-phone snapshot from
 * intake, and an address added or corrected later would never reach the invoice.
 * The customer record is the one place it is maintained.
 *
 * Absence is normal, not an error. Walk-in trade often has no address, and an
 * invoice without one is still a valid invoice, it simply cannot be emailed.
 */
async function customerEmail(
  db: Firestore,
  customerId: unknown
): Promise<string | undefined> {
  if (typeof customerId !== "string" || !customerId) return undefined;
  try {
    const snap = await getDoc(doc(db, COL.customers, customerId));
    const email = snap.data()?.email;
    return typeof email === "string" && email ? email : undefined;
  } catch {
    // A missing or unreadable customer must not stop an invoice being raised.
    return undefined;
  }
}

/**
 * Builds an invoice from a service job.
 *
 * The job's own payments are carried over as `amountPaidKobo`, so an invoice
 * raised after a deposit shows the real balance rather than the full amount. A
 * customer who has already paid half should not receive a demand for the whole.
 */
export async function createInvoiceFromJob(
  db: Firestore,
  actor: AuditActor,
  jobId: string
): Promise<{ invoiceId: string; invoiceNumber: string }> {
  const jobSnap = await getDoc(doc(db, COL.serviceJobs, jobId));
  if (!jobSnap.exists()) throw new Error("Job not found.");
  const job = jobSnap.data();

  const lineSnap = await getDocs(collection(db, jobLinesPath(jobId)));
  if (lineSnap.empty) {
    throw new Error("This job has no priced work, so there is nothing to invoice.");
  }

  const lines: InvoiceLine[] = lineSnap.docs.map((d, i) => {
    const x = d.data();
    const serviceType = x.serviceType as ServiceType;
    return {
      id: `l${i + 1}`,
      description:
        SERVICE_TYPE_LABELS[serviceType] +
        (x.boardType ? ` (${String(x.boardType).toUpperCase()})` : ""),
      quantity: x.quantity ?? 0,
      unitPriceKobo: x.unitPriceKobo ?? 0,
      amountKobo: x.amountKobo ?? 0,
    };
  });

  const settings = await invoiceSettings(db);
  const totals = computeInvoiceTotals(
    sumKobo(lines.map((l) => l.amountKobo)),
    settings.taxPercent
  );
  const paid = job.paidKobo ?? 0;

  return persist(db, actor, {
    type: "service",
    customerId: job.customerId ?? "",
    customerName: job.customerName ?? "",
    customerPhone: job.customerPhone ?? undefined,
    customerEmail: await customerEmail(db, job.customerId),
    jobId,
    reference: job.jobNumber ?? undefined,
    lines,
    totals,
    taxLabel: settings.taxLabel,
    paidKobo: paid,
    paymentTermsDays: settings.paymentTermsDays,
  });
}

/**
 * Builds an invoice from a project.
 *
 * One line per component rather than per feature: a client is buying "Main
 * kitchen", not 33 separate screws and hinges. The detail belongs on the
 * estimate, which is where it was agreed.
 */
export async function createInvoiceFromProject(
  db: Firestore,
  actor: AuditActor,
  projectId: string
): Promise<{ invoiceId: string; invoiceNumber: string }> {
  const projSnap = await getDoc(doc(db, COL.projects, projectId));
  if (!projSnap.exists()) throw new Error("Project not found.");
  const project = projSnap.data();

  const compSnap = await getDocs(collection(db, componentsPath(projectId)));
  const priced = compSnap.docs.filter((d) => (d.data().estimatedCostKobo ?? 0) > 0);
  if (priced.length === 0) {
    throw new Error("No component on this project is priced, so there is nothing to invoice.");
  }

  const lines: InvoiceLine[] = priced.map((d, i) => {
    const x = d.data();
    const amount = x.estimatedCostKobo ?? 0;
    return {
      id: `l${i + 1}`,
      description: x.name ?? "Component",
      quantity: 1,
      unitPriceKobo: amount,
      amountKobo: amount,
    };
  });

  const settings = await invoiceSettings(db);
  // Where a contract value was agreed on approval, that is the price. The sum of
  // components is an estimate; the contract is what the client signed up to.
  const componentSum = sumKobo(lines.map((l) => l.amountKobo));
  const agreed = project.contractValueKobo ?? 0;
  if (agreed > 0 && agreed !== componentSum) {
    lines.push({
      id: `l${lines.length + 1}`,
      description: "Adjustment to agreed contract value",
      quantity: 1,
      unitPriceKobo: agreed - componentSum,
      amountKobo: agreed - componentSum,
    });
  }

  const totals = computeInvoiceTotals(
    sumKobo(lines.map((l) => l.amountKobo)),
    settings.taxPercent
  );

  return persist(db, actor, {
    type: "project",
    customerId: project.customerId ?? "",
    customerName: project.customerName ?? "",
    customerEmail: await customerEmail(db, project.customerId),
    projectId,
    reference: project.projectNumber ?? undefined,
    lines,
    totals,
    taxLabel: settings.taxLabel,
    paidKobo: 0,
    paymentTermsDays: settings.paymentTermsDays,
  });
}

async function persist(
  db: Firestore,
  actor: AuditActor,
  input: {
    type: "service" | "project";
    customerId: string;
    customerName: string;
    customerPhone?: string;
    customerEmail?: string;
    jobId?: string;
    projectId?: string;
    reference?: string;
    lines: InvoiceLine[];
    totals: InvoiceTotals;
    taxLabel: string;
    paidKobo: number;
    paymentTermsDays: number;
  }
): Promise<{ invoiceId: string; invoiceNumber: string }> {
  const { formatted: invoiceNumber } = await allocateDocNumber(db, COUNTER.invoice);
  const ref = doc(collection(db, COL.invoices));

  const balance = input.totals.totalKobo - input.paidKobo;
  const due = new Date();
  due.setDate(due.getDate() + input.paymentTermsDays);

  const batch = writeBatch(db);
  batch.set(ref, {
    invoiceNumber,
    type: input.type,
    customerId: input.customerId,
    customerName: input.customerName,
    customerPhone: input.customerPhone ?? null,
    customerEmail: input.customerEmail ?? null,
    jobId: input.jobId ?? null,
    projectId: input.projectId ?? null,
    reference: input.reference ?? null,
    lines: input.lines,
    subtotalKobo: input.totals.subtotalKobo,
    taxPercent: input.totals.taxPercent,
    taxLabel: input.taxLabel,
    taxKobo: input.totals.taxKobo,
    totalKobo: input.totals.totalKobo,
    amountPaidKobo: input.paidKobo,
    balanceKobo: balance,
    // A new invoice starts as a draft even when already part paid: issuing is a
    // separate, deliberate act.
    status: "draft" satisfies InvoiceStatus,
    dueAt: Timestamp.fromDate(due),
    createdAt: serverTimestamp(),
    createdBy: actor.uid,
  });
  await batch.commit();

  await writeAudit(db, {
    actor,
    action: "create",
    collectionName: COL.invoices,
    docId: ref.id,
    summary:
      `Created ${invoiceNumber} for ${input.customerName}: ` +
      `${input.lines.length} line(s), total ${input.totals.totalKobo} kobo`,
    after: {
      invoiceNumber,
      totalKobo: input.totals.totalKobo,
      balanceKobo: balance,
    },
  });

  return { invoiceId: ref.id, invoiceNumber };
}

/** Marks a draft as issued and stamps the issue date. */
export async function issueInvoice(
  db: Firestore,
  actor: AuditActor,
  invoiceId: string,
  invoiceNumber: string
): Promise<void> {
  await updateDoc(doc(db, COL.invoices, invoiceId), {
    status: "sent" satisfies InvoiceStatus,
    issuedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    updatedBy: actor.uid,
  });

  await writeAudit(db, {
    actor,
    action: "invoice_issue",
    collectionName: COL.invoices,
    docId: invoiceId,
    summary: `Issued ${invoiceNumber}`,
    after: { status: "sent" },
  });
}

/**
 * Records a part payment against an invoice.
 *
 * Managers may do this: taking money in is ordinary operations. What they cannot
 * do is declare an invoice settled, which is the admin-only path and is why
 * status is never set here even when the balance reaches zero. An invoice that
 * looks paid because a manager entered a large figure is exactly the failure
 * mode being avoided.
 */
export async function recordInvoicePayment(
  db: Firestore,
  actor: AuditActor,
  invoiceId: string,
  invoiceNumber: string,
  amountKobo: number
): Promise<void> {
  const snap = await getDoc(doc(db, COL.invoices, invoiceId));
  if (!snap.exists()) throw new Error("Invoice not found.");
  const inv = snap.data();

  const nextPaid = (inv.amountPaidKobo ?? 0) + amountKobo;
  const total = inv.totalKobo ?? 0;
  if (nextPaid > total) {
    throw new Error(
      `That would take payments past the invoice total. Outstanding is ${total - (inv.amountPaidKobo ?? 0)} kobo.`
    );
  }

  await updateDoc(doc(db, COL.invoices, invoiceId), {
    amountPaidKobo: nextPaid,
    balanceKobo: total - nextPaid,
    // Partial only. Full settlement is the admin-only Cloud Function.
    status: nextPaid > 0 && nextPaid < total ? "partial" : inv.status,
    updatedAt: serverTimestamp(),
    updatedBy: actor.uid,
  });

  await writeAudit(db, {
    actor,
    action: "payment_record",
    collectionName: COL.invoices,
    docId: invoiceId,
    summary: `${invoiceNumber}: payment of ${amountKobo} kobo recorded`,
    before: { amountPaidKobo: inv.amountPaidKobo ?? 0 },
    after: { amountPaidKobo: nextPaid },
  });
}

/** Voids an invoice. Admin only, enforced in rules. */
export async function voidInvoice(
  db: Firestore,
  actor: AuditActor,
  invoiceId: string,
  invoiceNumber: string,
  reason: string
): Promise<void> {
  await updateDoc(doc(db, COL.invoices, invoiceId), {
    status: "void" satisfies InvoiceStatus,
    notes: reason,
    updatedAt: serverTimestamp(),
    updatedBy: actor.uid,
  });

  await writeAudit(db, {
    actor,
    action: "invoice_void",
    collectionName: COL.invoices,
    docId: invoiceId,
    summary: `Voided ${invoiceNumber}: ${reason}`,
    after: { status: "void", reason },
  });
}

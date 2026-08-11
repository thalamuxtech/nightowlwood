import {
  collection,
  deleteDoc,
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
  type TaxMode,
} from "./enums";
import { applyPercentKobo, sumKobo, taxWithinKobo } from "./money";
import { allocateDocNumber } from "./numbering";
import { addonsPath, componentsPath } from "./collections";
import { isAddonIncluded } from "./addons";
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
  discountPercent: number;
  discountKobo: number;
  /** Subtotal after discount — the base tax is worked out from. */
  netKobo: number;
  taxMode: TaxMode;
  taxPercent: number;
  taxKobo: number;
  totalKobo: number;
  commissionPercent: number;
  commissionKobo: number;
}

export interface TotalsInput {
  subtotalKobo: number;
  discountPercent?: number;
  /** An absolute discount, used when it is negotiated as a figure not a rate. */
  discountKobo?: number;
  taxMode?: TaxMode;
  taxPercent?: number;
  commissionPercent?: number;
}

/**
 * The one place invoice arithmetic happens.
 *
 * Every surface that shows a total — the screen, the printed sheet, the
 * server-rendered PDF, the POS receipt — calls this rather than adding percentages
 * up itself. Four separate implementations was how the same invoice could show two
 * different figures depending on where it was read.
 *
 * The order is fixed and each step is deliberate:
 *
 * 1. **Discount** comes off the subtotal first, so tax is charged on what is
 *    actually being sold rather than on a price nobody paid.
 * 2. **Tax** is then either added on top (`exclusive`) or extracted from within
 *    (`inclusive`). Inclusive does not change the total at all — that is the whole
 *    meaning of the word — it only says how much of the total is tax.
 * 3. **Commission** is a percentage of the **invoice total**, as specified. It is
 *    reported, never added: it is the business's cost of winning the work, not a
 *    charge to the customer, so adding it to `totalKobo` would bill the customer
 *    for the agent who introduced them.
 */
export function computeInvoiceTotals(input: TotalsInput): InvoiceTotals {
  const subtotalKobo = Math.max(0, Math.round(input.subtotalKobo));
  const discountPercent = input.discountPercent ?? 0;

  // A percentage and an absolute figure are both supported; the percentage is
  // applied first and an explicit figure is added to it, so the two compose rather
  // than one silently overriding the other.
  const discountKobo = Math.min(
    subtotalKobo,
    applyPercentKobo(subtotalKobo, discountPercent) + Math.max(0, input.discountKobo ?? 0)
  );
  const netKobo = subtotalKobo - discountKobo;

  const taxMode: TaxMode = input.taxMode ?? "none";
  const taxPercent = taxMode === "none" ? 0 : (input.taxPercent ?? 0);

  let taxKobo = 0;
  let totalKobo = netKobo;

  if (taxMode === "exclusive") {
    taxKobo = applyPercentKobo(netKobo, taxPercent);
    totalKobo = netKobo + taxKobo;
  } else if (taxMode === "inclusive") {
    // The total is unchanged: the tax was always inside the price.
    taxKobo = taxWithinKobo(netKobo, taxPercent);
    totalKobo = netKobo;
  }

  const commissionPercent = input.commissionPercent ?? 0;

  return {
    subtotalKobo,
    discountPercent,
    discountKobo,
    netKobo,
    taxMode,
    taxPercent,
    taxKobo,
    totalKobo,
    commissionPercent,
    // Of the total, per the business rule, not of the subtotal.
    commissionKobo: applyPercentKobo(totalKobo, commissionPercent),
  };
}

/** Sums invoice lines. Kept here so callers never re-derive a subtotal. */
export function subtotalOfLines(lines: Array<{ amountKobo: number }>): number {
  return sumKobo(lines.map((l) => l.amountKobo));
}

export async function invoiceSettings(db: Firestore) {
  try {
    const snap = await getDoc(doc(db, COL.settings, SETTINGS_DOC.invoice));
    if (!snap.exists()) return DEFAULT_INVOICE_SETTINGS;
    const d = snap.data();
    return {
      ...DEFAULT_INVOICE_SETTINGS,
      // `taxMode` is what decides whether tax is charged at all, so an older
      // settings document that predates it must not start charging: absent means
      // "exclusive if a rate was set, none otherwise", which reproduces exactly
      // what those invoices did before the mode existed.
      taxMode: (d.taxMode as TaxMode) ?? ((d.taxPercent ?? 0) > 0 ? "exclusive" : "none"),
      taxPercent: d.taxPercent ?? DEFAULT_INVOICE_SETTINGS.taxPercent,
      taxLabel: d.taxLabel ?? DEFAULT_INVOICE_SETTINGS.taxLabel,
      paymentTermsDays:
        d.paymentTermsDays ?? DEFAULT_INVOICE_SETTINGS.paymentTermsDays,
      defaultCommissionPercent:
        d.defaultCommissionPercent ?? DEFAULT_INVOICE_SETTINGS.defaultCommissionPercent,
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
  const totals = computeInvoiceTotals({
    subtotalKobo: subtotalOfLines(lines),
    taxMode: settings.taxMode,
    taxPercent: settings.taxPercent,
    commissionPercent: settings.defaultCommissionPercent,
  });
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

  /*
   * Addons are billed as their own lines, and taken *out* of their component's line.
   *
   * Two reasons to split them out. A client querying a ₦2.4m kitchen wants to see that
   * ₦450,000 of it was an oven they chose, and an addon buried inside "Main kitchen"
   * cannot be pointed at; it is also the honest presentation, since the workshop did
   * not make the oven.
   *
   * The subtraction is the part that matters for correctness. A component's
   * `estimatedCostKobo` already includes its ticked addons — the rollup in `addons.ts`
   * puts them there — so listing the component at its full total *and* the addons
   * separately would bill the appliance twice. What is left after the subtraction is
   * the workshop's own work on that component.
   *
   * Read per component sequentially rather than in parallel, because a project with
   * many components would otherwise open a burst of concurrent reads for what is a
   * background step in raising one document.
   */
  const lines: InvoiceLine[] = [];

  for (const compDoc of compSnap.docs) {
    const x = compDoc.data();
    const componentTotal = x.estimatedCostKobo ?? 0;

    const addonSnap = await getDocs(collection(db, addonsPath(projectId, compDoc.id)));
    /*
     * The same inclusion rule the rollup used, from the same function.
     *
     * This has to agree exactly with `applyAddonDelta`, because `addonTotal` is
     * subtracted from the component's stored total below. If the two rules disagree
     * about one addon, the subtraction removes an amount the component never carried
     * (or leaves one it did), and the client is billed the difference wrong. A local
     * copy of the rule is what let that happen before.
     */
    const billable = addonSnap.docs.filter((a) => isAddonIncluded(a.data()));
    const addonTotal = sumKobo(billable.map((a) => a.data().amountKobo ?? 0));

    // The component's own work, with the addons removed. Floored at zero: a component
    // whose stored total has drifted below its addons must not produce a negative
    // line, which would silently credit the client.
    const ownWork = Math.max(0, componentTotal - addonTotal);
    if (ownWork > 0) {
      lines.push({
        id: `l${lines.length + 1}`,
        description: x.name ?? "Component",
        quantity: 1,
        unitPriceKobo: ownWork,
        amountKobo: ownWork,
      });
    }

    for (const a of billable) {
      const ax = a.data();
      const qty = ax.quantity ?? 1;
      const amount = ax.amountKobo ?? 0;
      // A ticked addon still awaiting its supplier price contributes nothing to the
      // total, and a ₦0 line on a customer's invoice invites a question with no useful
      // answer. It stays on the estimate, where it is a note that something is pending.
      if (amount <= 0) continue;
      lines.push({
        id: `l${lines.length + 1}`,
        description:
          `${ax.name ?? "Addon"}` +
          (ax.brand ? ` — ${ax.brand}` : "") +
          (ax.model ? ` ${ax.model}` : ""),
        quantity: qty,
        // Back out the per-unit figure from the stored total so quantity × unit
        // reconciles on the printed sheet, which is what a client checks.
        unitPriceKobo: qty > 0 ? Math.round(amount / qty) : amount,
        amountKobo: amount,
      });
    }
  }

  if (lines.length === 0) {
    throw new Error(
      "Nothing on this project is priced, so there is nothing to invoice. Price a component or an addon first."
    );
  }

  const settings = await invoiceSettings(db);
  // Where a contract value was agreed on approval, that is the price. The sum of
  // components is an estimate; the contract is what the client signed up to.
  const lineSum = subtotalOfLines(lines);
  const agreed = project.contractValueKobo ?? 0;
  if (agreed > 0 && agreed !== lineSum) {
    lines.push({
      id: `l${lines.length + 1}`,
      description: "Adjustment to agreed contract value",
      quantity: 1,
      unitPriceKobo: agreed - lineSum,
      amountKobo: agreed - lineSum,
    });
  }

  const totals = computeInvoiceTotals({
    subtotalKobo: subtotalOfLines(lines),
    taxMode: settings.taxMode,
    taxPercent: settings.taxPercent,
    commissionPercent: settings.defaultCommissionPercent,
  });

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

/**
 * Raises an invoice that is not tied to a job or a project.
 *
 * The lines are typed by hand, which is the point: a delivery charge, a call-out, a
 * one-off supply of boards to a trade customer. None of those are a service job — no
 * boards come in and nothing is tracked through a pipeline — and creating a fake job
 * to bill them, which is what the office was doing on paper, leaves the job list
 * full of records that were never work.
 *
 * Everything else about it is an ordinary invoice: same numbering sequence, same
 * draft-then-issue flow, same PDF, same audit trail.
 */
export async function createStandaloneInvoice(
  db: Firestore,
  actor: AuditActor,
  input: {
    customerId?: string;
    customerName: string;
    customerPhone?: string;
    customerEmail?: string;
    reference?: string;
    lines: InvoiceLine[];
    taxMode?: TaxMode;
    taxPercent?: number;
    taxLabel?: string;
    commissionPercent?: number;
    commissionNote?: string;
    discountPercent?: number;
    discountKobo?: number;
    paymentTermsDays?: number;
    notes?: string;
  }
): Promise<{ invoiceId: string; invoiceNumber: string }> {
  if (!input.customerName.trim()) throw new Error("Name who the invoice is for.");

  const lines = input.lines.filter((l) => l.description.trim() !== "");
  if (lines.length === 0) {
    throw new Error("Add at least one line with a description.");
  }

  const settings = await invoiceSettings(db);
  const totals = computeInvoiceTotals({
    subtotalKobo: subtotalOfLines(lines),
    discountPercent: input.discountPercent,
    discountKobo: input.discountKobo,
    taxMode: input.taxMode ?? settings.taxMode,
    taxPercent: input.taxPercent ?? settings.taxPercent,
    commissionPercent: input.commissionPercent ?? settings.defaultCommissionPercent,
  });

  return persist(db, actor, {
    type: "standalone",
    customerId: input.customerId ?? "",
    customerName: input.customerName.trim(),
    customerPhone: input.customerPhone,
    customerEmail:
      input.customerEmail ?? (await customerEmail(db, input.customerId)),
    reference: input.reference,
    lines,
    totals,
    taxLabel: input.taxLabel ?? settings.taxLabel,
    commissionNote: input.commissionNote,
    paidKobo: 0,
    paymentTermsDays: input.paymentTermsDays ?? settings.paymentTermsDays,
    notes: input.notes,
  });
}

async function persist(
  db: Firestore,
  actor: AuditActor,
  input: {
    type: "service" | "project" | "standalone";
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
    commissionNote?: string;
    paidKobo: number;
    paymentTermsDays: number;
    notes?: string;
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
    discountPercent: input.totals.discountPercent,
    discountKobo: input.totals.discountKobo,
    taxMode: input.totals.taxMode,
    taxPercent: input.totals.taxPercent,
    taxLabel: input.taxLabel,
    taxKobo: input.totals.taxKobo,
    commissionPercent: input.totals.commissionPercent,
    commissionKobo: input.totals.commissionKobo,
    commissionNote: input.commissionNote ?? null,
    totalKobo: input.totals.totalKobo,
    amountPaidKobo: input.paidKobo,
    balanceKobo: balance,
    // A new invoice starts as a draft even when already part paid: issuing is a
    // separate, deliberate act.
    status: "draft" satisfies InvoiceStatus,
    dueAt: Timestamp.fromDate(due),
    notes: input.notes ?? null,
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

/**
 * Edits a draft invoice: its lines, tax treatment, commission and discount.
 *
 * Draft only, and deliberately so. Once an invoice has been issued the customer is
 * holding a document with a number and a figure on it, and quietly changing what
 * that number means is how a dispute becomes unwinnable. An issued invoice is
 * corrected by voiding it and raising another, which leaves both in the record.
 *
 * `amountPaidKobo` is preserved rather than recomputed — a job's deposit carried
 * onto the invoice at creation is real money received, and rebuilding the totals
 * must not discard it. The balance is re-derived from the new total so the two
 * cannot disagree.
 */
export async function updateDraftInvoice(
  db: Firestore,
  actor: AuditActor,
  invoiceId: string,
  input: {
    customerName?: string;
    customerPhone?: string;
    customerEmail?: string;
    reference?: string;
    lines: InvoiceLine[];
    taxMode: TaxMode;
    taxPercent: number;
    taxLabel: string;
    commissionPercent: number;
    commissionNote?: string;
    discountPercent: number;
    discountKobo?: number;
    notes?: string;
  }
): Promise<void> {
  const ref = doc(db, COL.invoices, invoiceId);
  const snap = await getDoc(ref);
  if (!snap.exists()) throw new Error("That invoice no longer exists.");
  const prev = snap.data();

  if (prev.status !== "draft") {
    throw new Error(
      `This invoice is ${prev.status}, so it can no longer be edited. ` +
        "Void it and raise a replacement if the figures are wrong."
    );
  }

  const lines = input.lines.filter((l) => l.description.trim() !== "");
  if (lines.length === 0) throw new Error("An invoice needs at least one line.");

  const totals = computeInvoiceTotals({
    subtotalKobo: subtotalOfLines(lines),
    discountPercent: input.discountPercent,
    discountKobo: input.discountKobo,
    taxMode: input.taxMode,
    taxPercent: input.taxPercent,
    commissionPercent: input.commissionPercent,
  });

  const paid = prev.amountPaidKobo ?? 0;
  if (totals.totalKobo < paid) {
    throw new Error(
      `The new total (${totals.totalKobo} kobo) is less than the ${paid} kobo already ` +
        "paid against this invoice. Refund or adjust the payment first."
    );
  }

  await updateDoc(ref, {
    ...(input.customerName !== undefined
      ? { customerName: input.customerName.trim() }
      : {}),
    ...(input.customerPhone !== undefined
      ? { customerPhone: input.customerPhone || null }
      : {}),
    ...(input.customerEmail !== undefined
      ? { customerEmail: input.customerEmail || null }
      : {}),
    reference: input.reference ?? prev.reference ?? null,
    lines,
    subtotalKobo: totals.subtotalKobo,
    discountPercent: totals.discountPercent,
    discountKobo: totals.discountKobo,
    taxMode: totals.taxMode,
    taxPercent: totals.taxPercent,
    taxLabel: input.taxLabel,
    taxKobo: totals.taxKobo,
    commissionPercent: totals.commissionPercent,
    commissionKobo: totals.commissionKobo,
    commissionNote: input.commissionNote ?? null,
    totalKobo: totals.totalKobo,
    balanceKobo: totals.totalKobo - paid,
    notes: input.notes ?? prev.notes ?? null,
    updatedAt: serverTimestamp(),
    updatedBy: actor.uid,
  });

  await writeAudit(db, {
    actor,
    action: "update",
    collectionName: COL.invoices,
    docId: invoiceId,
    summary:
      `Edited draft ${prev.invoiceNumber}: total ${prev.totalKobo ?? 0} → ` +
      `${totals.totalKobo} kobo, ${lines.length} line(s)`,
    before: {
      totalKobo: prev.totalKobo ?? 0,
      taxKobo: prev.taxKobo ?? 0,
      commissionKobo: prev.commissionKobo ?? 0,
    },
    after: {
      totalKobo: totals.totalKobo,
      taxKobo: totals.taxKobo,
      commissionKobo: totals.commissionKobo,
    },
  });
}

/**
 * Deletes a draft invoice.
 *
 * Only a draft, and only because a draft is not yet a document anyone has seen — it
 * has a number allocated but has never been sent. An issued invoice is voided
 * instead, which keeps the number in the sequence: a gap in an invoice sequence is
 * exactly what an auditor asks about, and "we deleted it" is not an answer.
 */
export async function deleteDraftInvoice(
  db: Firestore,
  actor: AuditActor,
  invoiceId: string
): Promise<void> {
  const ref = doc(db, COL.invoices, invoiceId);
  const snap = await getDoc(ref);
  if (!snap.exists()) throw new Error("That invoice no longer exists.");
  const inv = snap.data();

  if (inv.status !== "draft") {
    throw new Error(
      `Only a draft can be deleted. Void ${inv.invoiceNumber} instead, which keeps ` +
        "the number in the sequence."
    );
  }
  if ((inv.amountPaidKobo ?? 0) > 0) {
    throw new Error(
      "Money has been recorded against this draft, so it cannot be deleted. Void it instead."
    );
  }

  await deleteDoc(ref);

  await writeAudit(db, {
    actor,
    action: "delete",
    collectionName: COL.invoices,
    docId: invoiceId,
    summary: `Deleted draft ${inv.invoiceNumber} (${inv.totalKobo ?? 0} kobo, never issued)`,
    before: { invoiceNumber: inv.invoiceNumber, totalKobo: inv.totalKobo ?? 0 },
  });
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

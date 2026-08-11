import {
  collection,
  getDoc,
  getDocs,
  orderBy,
  query,
  where,
  doc,
  type Firestore,
} from "firebase/firestore";
import { COL, jobPaymentsPath } from "./collections";
import type { InvoiceStatus, JobStatus, PaymentMethod } from "./enums";
import { sumKobo } from "./money";
import type { BoardBreakdown, Customer } from "./types";
import { cutBoards, receivedBoards, receivedTape, usedTape } from "./boards";
import { itemsFrom } from "./workLogs";
import type { WorkLog } from "./types";

/**
 * One customer, gathered from everywhere they appear.
 *
 * The question this answers is the one asked at the counter: "where do we stand with this
 * man?" It was previously unanswerable without opening jobs, invoices, payments and the
 * board stack separately and holding four numbers in your head — so in practice nobody
 * did, and the answer was whatever someone remembered.
 *
 * Three things it puts together:
 *
 * - **Money, both ways.** What they owe on unpaid invoices and job balances, and what the
 *   workshop owes them — a customer who overpaid a deposit is a creditor, and that is a
 *   real liability rather than a rounding oddity.
 * - **Their stock.** Boards and tape they brought in, what has been cut, what is still on
 *   site. Their property, which the workshop is answerable for.
 * - **A history.** Jobs, invoices, payments and sales in one timeline, so a dispute can be
 *   walked through in order instead of reconstructed.
 */

export interface CustomerLedgerEntry {
  id: string;
  at: number | null;
  kind: "job" | "invoice" | "payment" | "sale";
  reference: string;
  description: string;
  /** What the customer was billed. */
  chargeKobo: number;
  /** What they paid. */
  paidKobo: number;
  status?: string;
}

export interface CustomerStockRow {
  jobId: string;
  jobNumber: string;
  status: JobStatus;
  receivedAtMs: number | null;
  boards: BoardBreakdown;
  receivedBoards: number;
  cutBoards: number;
  remainingBoards: number;
  receivedTape: number;
  usedTape: number;
  remainingTape: number;
}

export interface CustomerProfile {
  customer: Customer;

  /*
   * Money.
   *
   * `owedToUsKobo` counts invoice balances plus the balance on jobs that were never
   * invoiced — a job worked and part paid is money owed whether or not a document was
   * raised, and counting only invoices understated receivables by exactly the jobs nobody
   * had got round to billing.
   *
   * Invoiced jobs are excluded from the job half, or the same debt would be counted twice
   * — once as the invoice balance and once as the job balance behind it.
   */
  owedToUsKobo: number;
  owedToUsFromInvoicesKobo: number;
  owedToUsFromUninvoicedJobsKobo: number;
  /** Overpayment: what the workshop holds beyond what was charged. */
  owedToThemKobo: number;
  /** Net position. Positive means the customer owes; negative means the workshop does. */
  netBalanceKobo: number;

  lifetimeChargedKobo: number;
  lifetimePaidKobo: number;

  /** Their boards and tape, per job and in total. */
  stock: CustomerStockRow[];
  totalRemainingBoards: number;
  totalRemainingTape: number;

  ledger: CustomerLedgerEntry[];

  counts: {
    jobs: number;
    openJobs: number;
    invoices: number;
    unpaidInvoices: number;
    sales: number;
  };
}

/**
 * Builds a customer's full picture.
 *
 * Read on demand rather than kept as running totals on the customer record: a
 * denormalised balance that drifts from the documents behind it is worse than no balance
 * at all, because it will be believed. Six queries, none of them large for one customer.
 */
export async function loadCustomerProfile(
  db: Firestore,
  customerId: string
): Promise<CustomerProfile | null> {
  const custSnap = await getDoc(doc(db, COL.customers, customerId));
  if (!custSnap.exists()) return null;
  const customer = { id: custSnap.id, ...custSnap.data() } as Customer;

  const [jobSnap, invoiceSnap, saleSnap, logSnap] = await Promise.all([
    getDocs(
      query(
        collection(db, COL.serviceJobs),
        where("customerId", "==", customerId),
        orderBy("receivedAt", "desc")
      )
    ),
    getDocs(
      query(collection(db, COL.invoices), where("customerId", "==", customerId))
    ),
    getDocs(query(collection(db, COL.sales), where("customerId", "==", customerId))),
    // Work logs are fetched wholesale and filtered by job below: they carry a jobId but
    // no customerId, and adding one would be a denormalisation that could disagree with
    // the job it points at.
    getDocs(collection(db, COL.workLogs)),
  ]);

  const jobIds = new Set(jobSnap.docs.map((d) => d.id));

  /**
   * Boards and tape drawn per job, from the logs against this customer's jobs.
   *
   * The job is resolved the same way `reconcileBoards` resolves it — the entry's own job,
   * or the first item that names one. Checking only `x.jobId` meant a shift split across
   * two customers was attributed on the Boards screen and dropped here, so the two screens
   * disagreed about the same customer's stack.
   */
  const cutByJob = new Map<string, number>();
  const tapeByJob = new Map<string, number>();
  for (const d of logSnap.docs) {
    const x = d.data() as WorkLog;
    const jobId = x.jobId ?? itemsFrom(x).find((i) => i.jobId)?.jobId ?? null;
    if (!jobId || !jobIds.has(jobId)) continue;
    cutByJob.set(jobId, (cutByJob.get(jobId) ?? 0) + cutBoards(x));
    tapeByJob.set(jobId, (tapeByJob.get(jobId) ?? 0) + usedTape(x));
  }

  // --- Jobs, stock, and the uninvoiced half of what is owed --------------

  /**
   * Jobs whose balance is represented by a *live* invoice, so it is not counted twice.
   *
   * Restricted to invoices that actually stand as a debt. A draft has not been sent and a
   * void one was cancelled — neither contributes to what is owed, so excluding their jobs
   * as well made a ₦100,000 receivable vanish the moment somebody raised a draft invoice
   * and did not issue it. Since invoices are *created* as drafts, that was the normal path.
   */
  const invoicedJobIds = new Set(
    invoiceSnap.docs
      .filter((d) => {
        const s = d.data().status;
        return s !== "draft" && s !== "void";
      })
      .map((d) => d.data().jobId as string | undefined)
      .filter((id): id is string => Boolean(id))
  );

  const stock: CustomerStockRow[] = [];
  const ledger: CustomerLedgerEntry[] = [];
  let owedFromJobs = 0;
  let openJobs = 0;

  /*
   * Lifetime accumulators, kept separate from the ledger.
   *
   * The ledger holds overlapping views of the same money on purpose, so it can be read as a
   * timeline. These count each naira exactly once.
   */
  let chargedFromUninvoicedJobs = 0;
  let jobPaymentsKobo = 0;
  let invoicePaidKobo = 0;
  let invoiceChargedKobo = 0;
  let salesKobo = 0;

  for (const d of jobSnap.docs) {
    const x = d.data();
    const status = (x.status as JobStatus) ?? "received";
    const boards = (x.boards ?? {}) as BoardBreakdown;

    const received = receivedBoards(boards);
    const cut = cutByJob.get(d.id) ?? 0;
    const tapeIn = receivedTape(boards);
    const tapeOut = tapeByJob.get(d.id) ?? 0;

    if (status !== "cancelled" && (received > 0 || tapeIn > 0)) {
      stock.push({
        jobId: d.id,
        jobNumber: x.jobNumber ?? "",
        status,
        receivedAtMs: x.receivedAt?.toMillis?.() ?? null,
        boards,
        receivedBoards: received,
        cutBoards: cut,
        remainingBoards: Math.max(0, received - cut),
        receivedTape: tapeIn,
        usedTape: tapeOut,
        remainingTape: Math.max(0, tapeIn - tapeOut),
      });
    }

    if (status !== "cancelled") {
      if (status !== "collected") openJobs += 1;
      if (!invoicedJobIds.has(d.id)) {
        owedFromJobs += Math.max(0, x.balanceKobo ?? 0);
        // Charged once: an invoiced job's charge is counted on the invoice instead.
        chargedFromUninvoicedJobs += x.totalKobo ?? 0;
      }
    }

    ledger.push({
      id: d.id,
      at: x.receivedAt?.toMillis?.() ?? null,
      kind: "job",
      reference: x.jobNumber ?? "",
      description:
        `Job received` +
        (received > 0 ? ` · ${received} board${received === 1 ? "" : "s"}` : "") +
        (tapeIn > 0 ? ` · ${tapeIn} tape` : ""),
      chargeKobo: x.totalKobo ?? 0,
      paidKobo: x.paidKobo ?? 0,
      status,
    });
  }

  // --- Invoices ---------------------------------------------------------

  let owedFromInvoices = 0;
  let overpaid = 0;
  let unpaidInvoices = 0;

  for (const d of invoiceSnap.docs) {
    const x = d.data();
    const status = (x.status as InvoiceStatus) ?? "draft";
    const balance = x.balanceKobo ?? 0;

    // A draft has not been sent, so it is not yet a debt. A void one never was.
    const live = status !== "draft" && status !== "void";
    if (live && balance > 0) {
      owedFromInvoices += balance;
      unpaidInvoices += 1;
    }
    // A negative balance means more was taken than charged, which the workshop holds on
    // the customer's behalf.
    if (live && balance < 0) overpaid += Math.abs(balance);

    if (live) {
      invoiceChargedKobo += x.totalKobo ?? 0;
      /*
       * What this invoice records as paid, less anything the job behind it already
       * accounts for.
       *
       * `createInvoiceFromJob` copies the job's `paidKobo` onto the new invoice, so an
       * invoice raised after a deposit reports that deposit too. The job's own payment
       * documents are the record of it, so only the part paid *against the invoice*
       * counts here — otherwise a deposit is counted twice.
       */
      const jobBehind = x.jobId
        ? jobSnap.docs.find((j) => j.id === x.jobId)
        : undefined;
      const carriedOver = jobBehind ? (jobBehind.data().paidKobo ?? 0) : 0;
      invoicePaidKobo += Math.max(0, (x.amountPaidKobo ?? 0) - carriedOver);
    }

    ledger.push({
      id: d.id,
      at: x.issuedAt?.toMillis?.() ?? x.createdAt?.toMillis?.() ?? null,
      kind: "invoice",
      reference: x.invoiceNumber ?? "",
      description: `Invoice · ${(x.lines ?? []).length} line(s)`,
      chargeKobo: x.totalKobo ?? 0,
      paidKobo: x.amountPaidKobo ?? 0,
      status,
    });
  }

  // --- Job payments, as their own timeline entries -----------------------

  // One read per job. Bounded by how many jobs one customer has, which is small, and it is
  // the only way to show individual payments rather than a single rolled-up figure.
  const paymentSnaps = await Promise.all(
    jobSnap.docs.map((j) => getDocs(collection(db, jobPaymentsPath(j.id))))
  );
  paymentSnaps.forEach((snap, i) => {
    const job = jobSnap.docs[i];
    for (const p of snap.docs) {
      const x = p.data();
      // The payment documents are the record of money received on jobs. A job's own
      // `paidKobo` is a rollup of these, so it is never added on top.
      jobPaymentsKobo += x.amountKobo ?? 0;
      ledger.push({
        id: p.id,
        at: x.date?.toMillis?.() ?? null,
        kind: "payment",
        reference: job.data().jobNumber ?? "",
        description:
          `Payment received` +
          (x.method ? ` · ${String(x.method as PaymentMethod)}` : "") +
          (x.description ? ` · ${x.description}` : ""),
        chargeKobo: 0,
        paidKobo: x.amountKobo ?? 0,
      });
    }
  });

  // --- Counter sales ----------------------------------------------------

  let salesCount = 0;
  for (const d of saleSnap.docs) {
    const x = d.data();
    if (x.status === "voided") continue;
    salesCount += 1;
    // A counter sale is charged and settled at once, so it counts once on each side.
    salesKobo += x.totalKobo ?? 0;
    ledger.push({
      id: d.id,
      at: x.soldAt?.toMillis?.() ?? null,
      kind: "sale",
      reference: x.receiptNumber ?? "",
      description: `Counter sale · ${(x.lines ?? []).length} item(s)`,
      // A counter sale is paid as it happens, so it is charged and settled at once.
      chargeKobo: x.totalKobo ?? 0,
      paidKobo: x.totalKobo ?? 0,
    });
  }

  ledger.sort((a, b) => (b.at ?? 0) - (a.at ?? 0));

  const owedToUsKobo = owedFromInvoices + owedFromJobs;

  // Each naira once. See the note on the returned fields.
  const chargedOnceKobo =
    invoiceChargedKobo + chargedFromUninvoicedJobs + salesKobo;
  const paidOnceKobo = jobPaymentsKobo + invoicePaidKobo + salesKobo;

  return {
    customer,
    owedToUsKobo,
    owedToUsFromInvoicesKobo: owedFromInvoices,
    owedToUsFromUninvoicedJobsKobo: owedFromJobs,
    owedToThemKobo: overpaid,
    netBalanceKobo: owedToUsKobo - overpaid,
    /*
     * Lifetime figures, counted once each.
     *
     * NOT summed over `ledger`: that array deliberately holds overlapping views of the same
     * money so the timeline reads naturally — a job appears, then the invoice raised from
     * it, then each payment against it. Summing it counted one ₦100,000 job as ₦200,000
     * charged (job + its invoice) and one ₦40,000 deposit as ₦120,000 paid (the job's
     * rollup, the payment document, and the invoice's copy).
     *
     * Charged: invoices, plus jobs that were never invoiced. Same exclusion as
     * `owedToUsKobo`, for the same reason.
     *
     * Paid: the payment documents plus what invoices record, minus nothing — a job's
     * `paidKobo` is a rollup *of* those payment documents, so including it as well would
     * count each payment twice. Invoice payments are counted because an invoice can be paid
     * directly without a job payment behind it; where one is carried over from a job at
     * creation the job's own payments are the record, which is why `jobPaidKobo` is
     * subtracted back out.
     */
    lifetimeChargedKobo: chargedOnceKobo,
    lifetimePaidKobo: paidOnceKobo,
    stock,
    totalRemainingBoards: stock.reduce((s, r) => s + r.remainingBoards, 0),
    totalRemainingTape: stock.reduce((s, r) => s + r.remainingTape, 0),
    ledger,
    counts: {
      jobs: jobSnap.size,
      openJobs,
      invoices: invoiceSnap.size,
      unpaidInvoices,
      sales: salesCount,
    },
  };
}

/**
 * Every customer with an outstanding balance, for the receivables view.
 *
 * Deliberately reads invoices rather than walking each customer's full profile: the
 * question here is "who owes us money", and a per-customer profile query for a directory
 * of hundreds would be hundreds of round trips to answer it.
 */
export async function loadReceivables(
  db: Firestore
): Promise<
  Array<{
    customerId: string;
    customerName: string;
    outstandingKobo: number;
    overdueKobo: number;
    invoiceCount: number;
  }>
> {
  const snap = await getDocs(collection(db, COL.invoices));
  const byCustomer = new Map<
    string,
    {
      customerId: string;
      customerName: string;
      outstandingKobo: number;
      overdueKobo: number;
      invoiceCount: number;
    }
  >();

  const now = Date.now();

  for (const d of snap.docs) {
    const x = d.data();
    const status = x.status as InvoiceStatus;
    if (status === "draft" || status === "void") continue;

    const balance = x.balanceKobo ?? 0;
    if (balance <= 0) continue;

    const customerId = (x.customerId as string) ?? "";
    if (!customerId) continue;

    const row =
      byCustomer.get(customerId) ??
      {
        customerId,
        customerName: (x.customerName as string) ?? "Unknown",
        outstandingKobo: 0,
        overdueKobo: 0,
        invoiceCount: 0,
      };

    row.outstandingKobo += balance;
    row.invoiceCount += 1;
    const dueMs = x.dueAt?.toMillis?.() ?? null;
    if (dueMs !== null && dueMs < now) row.overdueKobo += balance;

    byCustomer.set(customerId, row);
  }

  return [...byCustomer.values()].sort(
    (a, b) => b.outstandingKobo - a.outstandingKobo
  );
}

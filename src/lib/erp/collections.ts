/**
 * Firestore collection paths, in one place.
 *
 * Referencing these constants rather than string literals means a rename shows
 * up as a type error instead of a silent read from a collection that doesn't
 * exist. Subcollection helpers take the parent id.
 */

export const COL = {
  // People
  users: "users",
  staff: "staff",
  customers: "customers",

  // Services
  serviceJobs: "serviceJobs",
  workLogs: "workLogs",

  // Products
  projects: "projects",
  estimates: "estimates",
  estimateTemplates: "estimateTemplates",

  // Money
  invoices: "invoices",
  expenses: "expenses",
  meterReadings: "meterReadings",
  // Counter sales: boards, edge tape and accessories sold over the counter.
  // Separate from serviceJobs because nothing is being worked on — money and
  // stock change hands once, so there is no pipeline to move through.
  sales: "sales",

  // Payroll
  wageRates: "wageRates",
  wageRuns: "wageRuns",
  /**
   * Per-person rate overrides.
   *
   * `wageRates` holds the rate for a *kind of work*; this holds the rate for a
   * *person* doing it, because two operators on the same machine are not
   * necessarily paid the same and a raise for one must not raise everyone. A
   * person with no row here falls back to the work-type rate, so this collection
   * is empty until someone is actually paid differently.
   */
  staffRates: "staffRates",
  /** Deductions raised at the work log, applied by the next wage or salary run. */
  deductions: "deductions",
  // Monthly salaried staff are paid on their own cycle, so a salary run is a
  // separate record from a weekly wage run rather than a variant of it.
  salaryRuns: "salaryRuns",
  loans: "loans",

  // Inventory
  inventoryService: "inventoryService",
  inventoryCompany: "inventoryCompany",
  inventoryProduct: "inventoryProduct",
  /**
   * The counter's own stock.
   *
   * Separate from `inventoryCompany` because the two answer different questions: company stock is
   * what the workshop holds to consume, this is what is on the shop floor to sell. Goods reach it
   * by an explicit transfer, which decrements one and increments the other in a single
   * transaction — see `transferToCounter` in sales.ts.
   *
   * The cost travels with the transfer, so a sale is costed at what the workshop actually paid
   * rather than at a figure retyped at the counter.
   */
  inventoryPos: "inventoryPos",
  consumableCycles: "consumableCycles",

  // Procurement, who we buy from and how well it performs
  suppliers: "suppliers",
  purchases: "purchases",
  consumableBrands: "consumableBrands",

  // Tools
  toolRequests: "toolRequests",

  /**
   * Change requests awaiting an admin's decision.
   *
   * Every delete and every consequential edit routes through here rather than straight
   * at the record, so a second pair of eyes sees it and the reason is captured while the
   * person still remembers it.
   */
  approvals: "approvals",

  /**
   * Days the workshop was shut.
   *
   * Recorded so an empty work log is explained. Without it, a public holiday and a day
   * nobody bothered logging look identical, and the first question about a light week is
   * always "did we not work, or did we not write it down?".
   */
  holidays: "holidays",

  /** Recurring fixed costs — rent, subscriptions, contributions. */
  fixedCosts: "fixedCosts",

  /**
   * The fixed assets register.
   *
   * Machines, vehicles, generators, computers. Its own collection rather than a category of stock
   * because the questions differ: stock asks how many are left and changes daily, an asset asks what
   * it is worth now and falls in value on a schedule. See `assets.ts`.
   */
  fixedAssets: "fixedAssets",

  /**
   * The daily attendance register.
   *
   * One document per person per day, with a derived id so a second tick corrects the first
   * rather than adding a contradictory row. Records the fact of an absence; the deduction that
   * may follow is a separate document and a separate decision — see `markAttendance`.
   */
  attendance: "attendance",

  /**
   * Cutting lists.
   *
   * The panel-by-panel document a customer brings in. Fillable through a public link, because
   * the customer is the one who knows what they want cut — and because the paper copy is the
   * thing that gets lost.
   */
  cuttingLists: "cuttingLists",

  /*
   * Marketing.
   *
   * Four collections because they have four different lifetimes. A site visit is a dated
   * event that never changes; a lead has a status that moves for months; a follow-up is one
   * attempt against a lead, of which there are many; a quotation request is a handover to
   * the office with its own answer. Folding any pair together would mean editing history to
   * record the present — see the note at the top of `marketing.ts`.
   */
  siteVisits: "siteVisits",
  leads: "leads",
  followUps: "followUps",
  quoteRequests: "quoteRequests",

  // System
  auditLog: "auditLog",
  counters: "counters",
  settings: "settings",
} as const;

/** Subcollections, keyed by parent. */
export const SUB = {
  jobLines: "lines",
  jobPayments: "payments",
  components: "components",
  features: "features",
  /** Kitchenwares, appliances and other bought-in extras on a component. */
  addons: "addons",
  estimateLines: "lines",
  wageRunLines: "lines",
  loanRepayments: "repayments",
  inventoryMovements: "movements",
  toolItems: "items",
  purchaseLines: "lines",
  saleLines: "lines",
  /** Items bought against a project, the actual-cost side of the estimate. */
  projectPurchases: "purchases",
  /** Supporting files on an invoice — cutting lists, drawings, signed sheets. */
  invoiceAttachments: "attachments",
  /** Employment history, letters and documents for one staff member. */
  staffDocuments: "documents",
} as const;

export const jobLinesPath = (jobId: string) => `${COL.serviceJobs}/${jobId}/${SUB.jobLines}`;
export const jobPaymentsPath = (jobId: string) => `${COL.serviceJobs}/${jobId}/${SUB.jobPayments}`;
export const componentsPath = (projectId: string) => `${COL.projects}/${projectId}/${SUB.components}`;
export const featuresPath = (projectId: string, componentId: string) =>
  `${COL.projects}/${projectId}/${SUB.components}/${componentId}/${SUB.features}`;
export const estimateLinesPath = (estimateId: string) =>
  `${COL.estimates}/${estimateId}/${SUB.estimateLines}`;
export const wageRunLinesPath = (runId: string) => `${COL.wageRuns}/${runId}/${SUB.wageRunLines}`;
export const loanRepaymentsPath = (loanId: string) => `${COL.loans}/${loanId}/${SUB.loanRepayments}`;
export const inventoryMovementsPath = (itemId: string) =>
  `${COL.inventoryCompany}/${itemId}/${SUB.inventoryMovements}`;

/**
 * Movements under a counter-stock item.
 *
 * Its own helper rather than a parameter on the one above, because the two collections are genuinely
 * different shelves and a single helper taking a collection name is one typo away from writing a
 * counter movement into the workshop's ledger.
 */
export const posMovementsPath = (itemId: string) =>
  `${COL.inventoryPos}/${itemId}/${SUB.inventoryMovements}`;
export const toolItemsPath = (requestId: string) =>
  `${COL.toolRequests}/${requestId}/${SUB.toolItems}`;
export const purchaseLinesPath = (purchaseId: string) =>
  `${COL.purchases}/${purchaseId}/${SUB.purchaseLines}`;
export const addonsPath = (projectId: string, componentId: string) =>
  `${COL.projects}/${projectId}/${SUB.components}/${componentId}/${SUB.addons}`;
export const saleLinesPath = (saleId: string) => `${COL.sales}/${saleId}/${SUB.saleLines}`;
export const projectPurchasesPath = (projectId: string) =>
  `${COL.projects}/${projectId}/${SUB.projectPurchases}`;
export const invoiceAttachmentsPath = (invoiceId: string) =>
  `${COL.invoices}/${invoiceId}/${SUB.invoiceAttachments}`;
export const staffDocumentsPath = (staffId: string) =>
  `${COL.staff}/${staffId}/${SUB.staffDocuments}`;

/** Document-number counters, incremented atomically in a transaction. */
export const COUNTER = {
  job: "job",
  project: "project",
  invoice: "invoice",
  toolRequest: "toolRequest",
  sale: "sale",
  cuttingList: "cuttingList",
} as const;

export type CounterName = (typeof COUNTER)[keyof typeof COUNTER];

/** Prefixes for human-readable document numbers, e.g. `JOB-2026-0142`. */
export const NUMBER_PREFIX: Record<CounterName, string> = {
  job: "JOB",
  project: "PRJ",
  invoice: "INV",
  toolRequest: "TR",
  sale: "RCP",
  cuttingList: "CL",
};

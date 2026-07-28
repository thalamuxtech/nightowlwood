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

  // Payroll
  wageRates: "wageRates",
  wageRuns: "wageRuns",
  loans: "loans",

  // Inventory
  inventoryService: "inventoryService",
  inventoryCompany: "inventoryCompany",
  inventoryProduct: "inventoryProduct",
  consumableCycles: "consumableCycles",

  // Procurement — who we buy from and how well it performs
  suppliers: "suppliers",
  purchases: "purchases",
  consumableBrands: "consumableBrands",

  // Tools
  toolRequests: "toolRequests",

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
  estimateLines: "lines",
  wageRunLines: "lines",
  loanRepayments: "repayments",
  inventoryMovements: "movements",
  toolItems: "items",
  purchaseLines: "lines",
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
export const toolItemsPath = (requestId: string) =>
  `${COL.toolRequests}/${requestId}/${SUB.toolItems}`;
export const purchaseLinesPath = (purchaseId: string) =>
  `${COL.purchases}/${purchaseId}/${SUB.purchaseLines}`;

/** Document-number counters, incremented atomically in a transaction. */
export const COUNTER = {
  job: "job",
  project: "project",
  invoice: "invoice",
  toolRequest: "toolRequest",
} as const;

export type CounterName = (typeof COUNTER)[keyof typeof COUNTER];

/** Prefixes for human-readable document numbers, e.g. `JOB-2026-0142`. */
export const NUMBER_PREFIX: Record<CounterName, string> = {
  job: "JOB",
  project: "PRJ",
  invoice: "INV",
  toolRequest: "TR",
};

/**
 * Controlled vocabularies for the ERP.
 *
 * The legacy record book stored these as free text, which produced 35 spellings
 * for ~9 real service types (C/E, CIE, cIE, Gruving, GROVING, O/C, O.C, OC,
 * Oniy /C, FREAM, Fame …) and 6 for two board types. Every enum here exists to
 * stop that recurring, and `normaliseServiceType`/`normaliseBoardType` map the
 * historical spellings onto it during migration.
 */

// ---------------------------------------------------------------------------
// Roles
// ---------------------------------------------------------------------------

export const ROLES = ["admin", "manager", "operator"] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_LABELS: Record<Role, string> = {
  admin: "Admin",
  manager: "Manager",
  operator: "Operator",
};

// ---------------------------------------------------------------------------
// Services
// ---------------------------------------------------------------------------

/** Billable service types, from the `C & E` sheet after de-duplication. */
export const SERVICE_TYPES = [
  "cutting_edging",
  "only_cutting",
  "door",
  "double_door",
  "glass_door",
  "frame",
  "special_frame",
  "grooving",
  "glass",
  "gyara",
  "special_board",
  "mortise",
] as const;
export type ServiceType = (typeof SERVICE_TYPES)[number];

export const SERVICE_TYPE_LABELS: Record<ServiceType, string> = {
  cutting_edging: "Cutting & Edging",
  only_cutting: "Only Cutting",
  door: "Door",
  double_door: "Double Door",
  glass_door: "Glass Door",
  frame: "Frame",
  special_frame: "Special Frame",
  grooving: "Grooving",
  glass: "Glass",
  gyara: "Gyara (rework)",
  special_board: "Special Board",
  mortise: "Mortise",
};

/** Board / sheet materials, from the `Inventory` and `C & E` sheets. */
export const BOARD_TYPES = [
  "mdf",
  "egger",
  "hdf",
  "quarter",
  "kwali",
  "high_glossy",
  "aluko",
  "glass",
  "other",
] as const;
export type BoardType = (typeof BOARD_TYPES)[number];

export const BOARD_TYPE_LABELS: Record<BoardType, string> = {
  mdf: "MDF",
  egger: "Egger",
  hdf: "HDF",
  quarter: "Quarter",
  kwali: "Kwali",
  high_glossy: "High Glossy",
  aluko: "Aluko",
  glass: "Glass",
  other: "Other",
};

/**
 * Service job lifecycle. Mirrors the physical Job Order Tracker: boards come
 * in, work is done, Q.O checks quantity + quality, customer collects.
 */
export const JOB_STATUSES = [
  "received",
  "in_progress",
  "qc",
  "ready_for_pickup",
  "collected",
  "on_hold",
  "cancelled",
] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

export const JOB_STATUS_LABELS: Record<JobStatus, string> = {
  received: "Received",
  in_progress: "In Progress",
  qc: "Quality Check",
  ready_for_pickup: "Ready for Pickup",
  collected: "Collected",
  on_hold: "On Hold",
  cancelled: "Cancelled",
};

/** Forward-only transitions, plus hold/cancel escapes from any live state. */
export const JOB_STATUS_FLOW: Record<JobStatus, JobStatus[]> = {
  received: ["in_progress", "on_hold", "cancelled"],
  in_progress: ["qc", "on_hold", "cancelled"],
  qc: ["ready_for_pickup", "in_progress", "on_hold"],
  ready_for_pickup: ["collected", "qc", "on_hold"],
  collected: [],
  on_hold: ["received", "in_progress", "qc", "ready_for_pickup", "cancelled"],
  cancelled: [],
};

// ---------------------------------------------------------------------------
// Products
// ---------------------------------------------------------------------------

/** Estimate categories, verbatim from the Cost Estimate Template sheets. */
export const PRODUCT_CATEGORIES = [
  "kitchen",
  "doors",
  "frames",
  "tv_wall_panels",
  "closets",
  "bedset",
] as const;
export type ProductCategory = (typeof PRODUCT_CATEGORIES)[number];

export const PRODUCT_CATEGORY_LABELS: Record<ProductCategory, string> = {
  kitchen: "Kitchen",
  doors: "Doors",
  frames: "Frames",
  tv_wall_panels: "TV Wall Panels",
  closets: "Closets",
  bedset: "Bedset",
};

export const PROJECT_STATUSES = [
  "enquiry",
  "estimating",
  "awaiting_approval",
  "approved",
  "in_production",
  "installing",
  "completed",
  "cancelled",
] as const;
export type ProjectStatus = (typeof PROJECT_STATUSES)[number];

export const PROJECT_STATUS_LABELS: Record<ProjectStatus, string> = {
  enquiry: "Enquiry",
  estimating: "Estimating",
  awaiting_approval: "Awaiting Approval",
  approved: "Approved",
  in_production: "In Production",
  installing: "Installing",
  completed: "Completed",
  cancelled: "Cancelled",
};

export const ESTIMATE_STATUSES = [
  "draft",
  "in_review",
  "reviewed",
  "approved",
  "superseded",
] as const;
export type EstimateStatus = (typeof ESTIMATE_STATUSES)[number];

export const ESTIMATE_STATUS_LABELS: Record<EstimateStatus, string> = {
  draft: "Draft",
  in_review: "In Review",
  reviewed: "Reviewed",
  approved: "Approved",
  superseded: "Superseded",
};

// ---------------------------------------------------------------------------
// Money
// ---------------------------------------------------------------------------

export const INVOICE_STATUSES = ["draft", "sent", "partial", "paid", "void"] as const;
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];

export const INVOICE_STATUS_LABELS: Record<InvoiceStatus, string> = {
  draft: "Draft",
  sent: "Sent",
  partial: "Part Paid",
  paid: "Paid",
  void: "Void",
};

export const PAYMENT_METHODS = ["cash", "transfer", "pos", "cheque", "other"] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  cash: "Cash",
  transfer: "Bank Transfer",
  pos: "POS",
  cheque: "Cheque",
  other: "Other",
};

export const EXPENSE_CATEGORIES = [
  "wages",
  "food",
  "transport",
  "fuel",
  "power",
  "consumables",
  "materials",
  "tools",
  "maintenance",
  "rent",
  "admin",
  "other",
] as const;
export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number];

export const EXPENSE_CATEGORY_LABELS: Record<ExpenseCategory, string> = {
  wages: "Wages & Salary",
  food: "Food",
  transport: "Transport",
  fuel: "Fuel",
  power: "Power / Utilities",
  consumables: "Consumables",
  materials: "Materials",
  tools: "Tools",
  maintenance: "Maintenance",
  rent: "Rent",
  admin: "Administration",
  other: "Other",
};

// ---------------------------------------------------------------------------
// Payroll
// ---------------------------------------------------------------------------

/**
 * Work types that earn a piece rate. Distinct from ServiceType: what the
 * customer is billed for and what the operator is paid for are priced on
 * different scales (a "Board" wage line covers both MDF and Egger C&E).
 */
export const WAGE_WORK_TYPES = [
  "board",
  "door",
  "double_door",
  "frame",
  "special_frame",
  "only_cutting",
  "grooving",
  "glass",
  "gyara",
  "special_board",
  "mortise",
] as const;
export type WageWorkType = (typeof WAGE_WORK_TYPES)[number];

export const WAGE_WORK_TYPE_LABELS: Record<WageWorkType, string> = {
  board: "Board (C&E)",
  door: "Door",
  double_door: "Double Door",
  frame: "Frame",
  special_frame: "Special Frame",
  only_cutting: "Only Cutting",
  grooving: "Grooving",
  glass: "Glass",
  gyara: "Gyara",
  special_board: "Special Board",
  mortise: "Mortise",
};

export const WAGE_RUN_STATUSES = ["draft", "approved", "paid"] as const;
export type WageRunStatus = (typeof WAGE_RUN_STATUSES)[number];

export const LOAN_TYPES = ["loan", "advance"] as const;
export type LoanType = (typeof LOAN_TYPES)[number];

export const LOAN_STATUSES = [
  "requested",
  "approved",
  "rejected",
  "disbursed",
  "repaying",
  "settled",
] as const;
export type LoanStatus = (typeof LOAN_STATUSES)[number];

export const LOAN_STATUS_LABELS: Record<LoanStatus, string> = {
  requested: "Requested",
  approved: "Approved",
  rejected: "Rejected",
  disbursed: "Disbursed",
  repaying: "Repaying",
  settled: "Settled",
};

// ---------------------------------------------------------------------------
// Inventory & tools
// ---------------------------------------------------------------------------

export const INVENTORY_KINDS = ["service", "company", "product"] as const;
export type InventoryKind = (typeof INVENTORY_KINDS)[number];

export const INVENTORY_KIND_LABELS: Record<InventoryKind, string> = {
  /** Customer-brought items held for service work, we are custodians, not owners. */
  service: "Service Inventory",
  /** Company-owned consumables and materials used to do the work. */
  company: "Company Inventory",
  /** Items purchased for a specific client project. */
  product: "Product Inventory",
};

export const MOVEMENT_TYPES = ["in", "out", "adjust"] as const;
export type MovementType = (typeof MOVEMENT_TYPES)[number];

export const CONSUMABLE_TYPES = ["blade", "gum", "tape", "other"] as const;
export type ConsumableType = (typeof CONSUMABLE_TYPES)[number];

export const TOOL_REQUEST_STATUSES = [
  "requested",
  "issued",
  "partially_returned",
  "returned",
  "overdue",
] as const;
export type ToolRequestStatus = (typeof TOOL_REQUEST_STATUSES)[number];

export const TOOL_REQUEST_STATUS_LABELS: Record<ToolRequestStatus, string> = {
  requested: "Requested",
  issued: "Issued",
  partially_returned: "Partly Returned",
  returned: "Returned",
  overdue: "Overdue",
};

// ---------------------------------------------------------------------------
// Legacy normalisation
// ---------------------------------------------------------------------------

/**
 * Maps the historical free-text spellings onto ServiceType. Keys are
 * lowercased and stripped of spaces/punctuation before lookup, so `O/C`,
 * `O.C`, `OC` and `o c` all collapse to the same key.
 */
const SERVICE_TYPE_ALIASES: Record<string, ServiceType> = {
  ce: "cutting_edging",
  cie: "cutting_edging",
  specialce: "cutting_edging",
  oc: "only_cutting",
  onlyc: "only_cutting",
  onlycutting: "only_cutting",
  onlycoting: "only_cutting",
  onlycotting: "only_cutting",
  ocoting: "only_cutting",
  ocutting: "only_cutting",
  oniyc: "only_cutting",
  door: "door",
  doors: "door",
  doubledoor: "double_door",
  doobledoor: "double_door",
  glassdoor: "glass_door",
  frame: "frame",
  fream: "frame",
  fame: "frame",
  sframe: "special_frame",
  specialframe: "special_frame",
  grooving: "grooving",
  gruving: "grooving",
  groving: "grooving",
  glass: "glass",
  gyara: "gyara",
  specialboard: "special_board",
  mortise: "mortise",
};

const BOARD_TYPE_ALIASES: Record<string, BoardType> = {
  mdf: "mdf",
  egger: "egger",
  eager: "egger",
  eegger: "egger",
  hdf: "hdf",
  quarter: "quarter",
  qrt: "quarter",
  quarterplywood: "quarter",
  kwali: "kwali",
  highglossy: "high_glossy",
  highglosy: "high_glossy",
  aluko: "aluko",
  alukoboard: "aluko",
  glass: "glass",
};

function slug(raw: string): string {
  return raw.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** Best-effort mapping of a legacy service label. Returns null if unknown. */
export function normaliseServiceType(raw: string | null | undefined): ServiceType | null {
  if (!raw) return null;
  return SERVICE_TYPE_ALIASES[slug(raw)] ?? null;
}

/** Best-effort mapping of a legacy board label. Returns null if unknown. */
export function normaliseBoardType(raw: string | null | undefined): BoardType | null {
  if (!raw) return null;
  return BOARD_TYPE_ALIASES[slug(raw)] ?? null;
}

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

/**
 * Board / sheet materials.
 *
 * **The order of this list is the order they appear everywhere** — intake forms, the
 * job sheet, board reconciliation. It follows the sequence the workshop counts stock
 * in rather than alphabetical or historical order, because a form whose fields run in
 * a different order from the person reading the stack out loud produces transposed
 * numbers. Egger and MDF lead because they are the two highest-volume lines.
 *
 * MFC comes in two sheet sizes (9×7 and 9×4 feet) which are stocked and counted
 * separately, so they are distinct types rather than one type with a size field: a
 * customer who brought ten 9×4 sheets is not owed ten 9×7 ones.
 */
export const BOARD_TYPES = [
  "egger",
  "mdf",
  "hdf",
  "mfc_9x7",
  "mfc_9x4",
  "kwali",
  "quarter",
  "tape",
  "high_glossy",
  // Bangaji is MFC 9x7 — see BOARD_TYPE_LABELS. Not a separate type.
  "marine",
  "aluko",
  "glass",
  "other",
] as const;
export type BoardType = (typeof BOARD_TYPES)[number];

export const BOARD_TYPE_LABELS: Record<BoardType, string> = {
  egger: "Egger",
  mdf: "MDF",
  hdf: "HDF",
  /*
   * MFC 9×7 is the board the workshop calls Bangaji.
   *
   * One board, two names — the rate card gives it as "MFC(9x7) Bangaji". Kept as a single
   * type with both names in the label, because modelling them separately (as this first did)
   * would let the same sheet be counted twice on one job and priced under two different
   * rates.
   */
  mfc_9x7: "MFC 9×7 (Bangaji)",
  mfc_9x4: "MFC 9×4",
  kwali: "Kwali",
  quarter: "Quarter",
  tape: "Edge Tape",
  high_glossy: "High Glossy",
  marine: "Marine",
  aluko: "Aluko",
  glass: "Glass",
  other: "Other",
};

/**
 * Cutting & edging rate per board, by material.
 *
 * The rates genuinely differ by material — Bangaji at ₦6,400 is more than twice MDF — so a
 * single blended C&E rate would either overcharge the cheap boards or undercharge the
 * expensive ones. Seeds `settings/boardRateCard` on first run and is editable from
 * Settings; nothing reads these constants once that document exists.
 *
 * These are the figures confirmed by the workshop, in naira per board.
 */
/*
 * Cutting & edging, per board, as quoted by the workshop.
 *
 * These are the client's stated figures and not guesses — three of them were previously wrong:
 * HDF had no rate at all, MFC 9×4 had none, and Kwali was carrying 3,000 when the rate is 1,500.
 * A missing rate silently prices that board's cutting at nothing; a wrong one overcharges every
 * mixed job it appears on.
 */
export const DEFAULT_BOARD_CE_RATES: Partial<Record<BoardType, number>> = {
  high_glossy: 3000,
  mdf: 3000,
  hdf: 3200,
  egger: 3200,
  // MFC 9×7 Starwood, which the workshop calls Bangaji.
  mfc_9x7: 6400,
  // MFC 9×4 Gizir.
  mfc_9x4: 4000,
  kwali: 1500,
  marine: 3200,
};

/**
 * Board types the C&E rate card prices, in the order they are quoted.
 *
 * Must stay in step with `DEFAULT_BOARD_CE_RATES` above: this list is what the rate-card editor
 * renders and what the customer's cutting-list form offers, so a board priced but absent here is a
 * board nobody can select — which is how HDF and MFC 9×4 came to be missing from both.
 */
export const CE_RATED_BOARD_TYPES = [
  "high_glossy",
  "mdf",
  "hdf",
  "egger",
  "mfc_9x7",
  "mfc_9x4",
  "kwali",
  "marine",
] as const;
export type CeRatedBoardType = (typeof CE_RATED_BOARD_TYPES)[number];

/**
 * The board types counted on intake, in counting order.
 *
 * A subset of BOARD_TYPES: these are the ones the Job Order Tracker has a box for and
 * that `BoardBreakdown` carries. The rest exist as line-item materials but are not
 * part of the per-job count, so listing them on the intake form would invite counts
 * that nothing reconciles against.
 *
 * `tape` is included because the workshop receives it per job, but it is measured in
 * rolls rather than sheets — see `receivedBoards` in boards.ts, which excludes it from
 * the board remainder for exactly that reason.
 */
export const COUNTED_BOARD_TYPES = [
  "egger",
  "mdf",
  "hdf",
  "mfc_9x7",
  "mfc_9x4",
  "kwali",
  "quarter",
  "tape",
] as const;
export type CountedBoardType = (typeof COUNTED_BOARD_TYPES)[number];

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

/*
 * "superseded" was dropped when the estimate stopped being a separate document.
 * It meant "a newer estimate exists for this project", which cannot happen now that
 * a project has exactly one estimate: revising it edits the same one and bumps its
 * version. Nothing wrote the status any more, so it was vocabulary the UI offered
 * for a state unreachable in practice.
 */
export const ESTIMATE_STATUSES = [
  "draft",
  "in_review",
  "reviewed",
  "approved",
] as const;
export type EstimateStatus = (typeof ESTIMATE_STATUSES)[number];

export const ESTIMATE_STATUS_LABELS: Record<EstimateStatus, string> = {
  draft: "Draft",
  in_review: "In Review",
  reviewed: "Reviewed",
  approved: "Approved",
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

/**
 * Whether the tax rate is added on top of the line total or already inside it.
 *
 * Nigerian trade quotes both ways: a workshop price is usually the price the
 * customer pays (inclusive), while a corporate client with a TIN expects VAT
 * shown as an addition (exclusive). Getting this wrong changes what is owed by
 * the tax amount, so it is recorded per invoice rather than assumed.
 */
export const TAX_MODES = ["none", "exclusive", "inclusive"] as const;
export type TaxMode = (typeof TAX_MODES)[number];

export const TAX_MODE_LABELS: Record<TaxMode, string> = {
  none: "No tax",
  exclusive: "Added on top (exclusive)",
  inclusive: "Already included (inclusive)",
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

/**
 * Expense categories.
 *
 * `salary` is separate from `wages` because the two are different pay cycles with
 * different people on them — a monthly salaried fitter and a piece-rate machine
 * operator — and the profit report breaks labour down by both. `tax` exists so
 * remitted VAT and company tax are a cost line rather than being buried in
 * `admin`, which would understate what the business actually pays out.
 */
export const EXPENSE_CATEGORIES = [
  "wages",
  "salary",
  "food",
  "transport",
  "fuel",
  "power",
  "consumables",
  "materials",
  "purchases",
  "tools",
  "maintenance",
  "rent",
  "tax",
  "admin",
  "other",
] as const;
export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number];

export const EXPENSE_CATEGORY_LABELS: Record<ExpenseCategory, string> = {
  wages: "Wages (piece rate)",
  salary: "Salaries (monthly)",
  food: "Food",
  transport: "Transport",
  fuel: "Fuel",
  power: "Power / Utilities",
  consumables: "Consumables",
  materials: "Materials",
  purchases: "Project purchases",
  tools: "Tools",
  maintenance: "Maintenance",
  rent: "Rent",
  tax: "Tax remitted",
  admin: "Administration",
  other: "Other",
};

/**
 * Cost groups for the profit report.
 *
 * Every expense category maps to exactly one group, so the P&L cannot omit a
 * category or count one twice — adding a category without placing it here is a
 * type error rather than a silently missing cost line.
 */
export const COST_GROUPS = ["labour", "materials", "power", "overhead", "tax"] as const;
export type CostGroup = (typeof COST_GROUPS)[number];

export const COST_GROUP_LABELS: Record<CostGroup, string> = {
  labour: "Labour",
  materials: "Materials & stock",
  power: "Power",
  overhead: "Overheads",
  tax: "Tax",
};

export const EXPENSE_COST_GROUP: Record<ExpenseCategory, CostGroup> = {
  wages: "labour",
  salary: "labour",
  food: "overhead",
  transport: "overhead",
  fuel: "power",
  power: "power",
  consumables: "materials",
  materials: "materials",
  purchases: "materials",
  tools: "overhead",
  maintenance: "overhead",
  rent: "overhead",
  tax: "tax",
  admin: "overhead",
  other: "overhead",
};

/**
 * Whether a cost is fixed or moves with output.
 *
 * The distinction the workshop actually manages by. Rent, salaries and subscriptions
 * are owed whether or not a single board is cut; wages, power, gum and blades scale with
 * how busy the week was. Knowing the fixed monthly figure is what answers "how much do
 * we have to turn over before we break even", which a single cost total cannot.
 *
 * `salary` is fixed and `wages` is variable — the same reason they are separate
 * categories at all. Maintenance is variable because it follows machine hours.
 */
export const COST_BEHAVIOURS = ["fixed", "variable"] as const;
export type CostBehaviour = (typeof COST_BEHAVIOURS)[number];

export const COST_BEHAVIOUR_LABELS: Record<CostBehaviour, string> = {
  fixed: "Fixed",
  variable: "Variable",
};

export const EXPENSE_COST_BEHAVIOUR: Record<ExpenseCategory, CostBehaviour> = {
  // Owed regardless of output.
  salary: "fixed",
  rent: "fixed",
  admin: "fixed",
  // Moves with how much work goes through the shop.
  wages: "variable",
  power: "variable",
  fuel: "variable",
  consumables: "variable",
  materials: "variable",
  purchases: "variable",
  maintenance: "variable",
  tools: "variable",
  food: "variable",
  transport: "variable",
  tax: "variable",
  other: "variable",
};

// ---------------------------------------------------------------------------
// Profit streams
// ---------------------------------------------------------------------------

/**
 * The three trades the workshop runs, each with its own profitability.
 *
 * The brief is emphatic that these are "three completely separate profitability
 * calculations", and the reason is double counting. Cutting and edging consumes operator
 * wages, power, gum and blades; a manufacturing project consumes boards, hardware and
 * outsourced work. Charging a project for the gum used on somebody else's cutting job
 * makes both figures wrong — the project looks unprofitable and the service looks better
 * than it is.
 *
 * So the question every cost has to answer is not "what kind of cost is this" — that is
 * `CostGroup` — but "which trade consumed it". They are orthogonal: operator wages are
 * `labour` by kind and `service` by stream.
 *
 * `overhead` is the fourth value and it is not a trade. Rent, salaries, admin and tax are
 * owed whether or not a single board is cut, and attributing them to a stream would mean
 * inventing an apportionment nobody agreed. They are reported as their own block and
 * subtracted once at the bottom, which is the only way the three trade figures stay
 * comparable with each other.
 */
export const PROFIT_STREAMS = ["service", "project", "retail", "overhead"] as const;
export type ProfitStream = (typeof PROFIT_STREAMS)[number];

export const PROFIT_STREAM_LABELS: Record<ProfitStream, string> = {
  service: "Cutting & edging",
  project: "Projects",
  retail: "Counter sales",
  overhead: "Company overheads",
};

/** The three that are actual trades, in reporting order. Excludes `overhead`. */
export const TRADING_STREAMS = ["service", "project", "retail"] as const;
export type TradingStream = (typeof TRADING_STREAMS)[number];

/**
 * Which trade each expense category is charged to by default.
 *
 * A *default*, not a rule: an expense carries its own `stream` when whoever entered it knew
 * better, and this is the fallback for the ones that do not. See `streamOfExpense` in
 * profit.ts.
 *
 * The assignments that matter, and why:
 *
 * - **`wages` → service.** Piece-rate wages are paid for cutting and edging. Project labour
 *   is not on piece rates here, and the brief explicitly excludes service wages from project
 *   profitability.
 * - **`power`, `fuel`, `consumables`, `maintenance` → service.** These are the machines: the
 *   saw, the edge bander, the generator, the gum and the blades. The brief names every one of
 *   them as a service cost and excludes them from projects by name.
 * - **`purchases`, `materials` → project.** Boards, hardware, appliances and outsourced work
 *   bought against a job.
 * - **`salary`, `rent`, `admin`, `tax` → overhead.** Owed by the company, not by a trade.
 * - **`food`, `transport`, `tools` → overhead.** Genuinely shared. Transport is the one worth
 *   arguing about — a delivery is arguably a project cost — so it is left as an overhead until
 *   somebody tags it, rather than quietly loaded onto projects.
 *
 * Retail has no default category: a counter sale's only cost is the stock it sold, which comes
 * from the sale's own cost of goods rather than from the expense ledger. An expense typed
 * against retail by hand still lands there.
 */
export const EXPENSE_PROFIT_STREAM: Record<ExpenseCategory, ProfitStream> = {
  wages: "service",
  power: "service",
  fuel: "service",
  consumables: "service",
  maintenance: "service",
  purchases: "project",
  materials: "project",
  salary: "overhead",
  rent: "overhead",
  admin: "overhead",
  tax: "overhead",
  food: "overhead",
  transport: "overhead",
  tools: "overhead",
  other: "overhead",
};

// ---------------------------------------------------------------------------
// Counter sales (POS)
// ---------------------------------------------------------------------------

/**
 * What a counter sale is for.
 *
 * The workshop sells boards, edge tape and fittings over the counter as well as
 * doing service work, and that trade never appeared in the records at all. A sale
 * is its own document rather than a service job because there is no work to
 * track: money and stock change hands once.
 */
/**
 * A counter sale's state.
 *
 * `credit` is a completed sale whose money has not all arrived — the goods left, the stock came
 * off the shelf, and the customer owes the balance. Kept distinct from `completed` so the till
 * can list what is owed rather than treating every sale as settled, which is how a trade
 * customer's account ends up in a notebook.
 */
export const SALE_STATUSES = ["completed", "credit", "voided"] as const;
export type SaleStatus = (typeof SALE_STATUSES)[number];

export const SALE_STATUS_LABELS: Record<SaleStatus, string> = {
  completed: "Paid",
  credit: "On account",
  voided: "Voided",
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

/**
 * Why money was withheld from someone's pay.
 *
 * Kept as a controlled list because the reason changes how it should be read: an
 * advance is money already handed over and is genuinely owed back, while a
 * penalty or a no-show is a reduction in what was earned. Lumping both under one
 * "deduction" figure makes a wage dispute unarguable, since nobody can say which
 * of the two a given amount was.
 *
 * These are recorded at the work log, so the wage run applies them automatically
 * rather than someone remembering to subtract them at pay time.
 */
export const DEDUCTION_TYPES = ["advance", "no_show", "penalty", "general"] as const;
export type DeductionType = (typeof DEDUCTION_TYPES)[number];

export const DEDUCTION_TYPE_LABELS: Record<DeductionType, string> = {
  advance: "Salary / wage advance",
  no_show: "No show",
  penalty: "Penalty / damage",
  general: "General",
};

/**
 * How each deduction's amount is arrived at.
 *
 * `no_show` is the one that can be computed: a day absent costs a day's pay, which for a
 * salaried person is their monthly figure over the working days in the month. The others
 * are judgements — what a broken panel cost, what advance was handed over — so they are
 * entered. Recording which is which lets the form derive the figure where it can and
 * insist on one where it cannot.
 */
export const DEDUCTION_AMOUNT_SOURCE: Record<DeductionType, "derived" | "entered"> = {
  no_show: "derived",
  penalty: "entered",
  advance: "entered",
  general: "entered",
};

// ---------------------------------------------------------------------------
// People / HR
// ---------------------------------------------------------------------------

/**
 * How someone is paid.
 *
 * Drives which pay run picks them up: `salary` staff appear in the monthly salary run,
 * `wage` staff in the weekly piece-rate run. Stored explicitly rather than inferred from
 * whether a salary figure is present, so a salaried employee on zero this month is still
 * distinguishable from a piece-rate worker.
 */
export const EMPLOYMENT_TYPES = ["salary", "wage"] as const;
export type EmploymentType = (typeof EMPLOYMENT_TYPES)[number];

export const EMPLOYMENT_TYPE_LABELS: Record<EmploymentType, string> = {
  salary: "Monthly salary",
  wage: "Piece-rate wage",
};

/**
 * Roles as the workshop names them.
 *
 * A controlled list because these appear on appointment letters and ID cards, where
 * free text produced three spellings of "Assistant Operator". `other` exists so a new
 * role never blocks a hire.
 */
export const STAFF_ROLES = [
  "manager",
  "accountant",
  "store_keeper",
  "secretary",
  "cutting_operator",
  "edging_operator",
  "assistant_operator",
  "security",
  "janitor",
  "other",
] as const;
export type StaffRole = (typeof STAFF_ROLES)[number];

export const STAFF_ROLE_LABELS: Record<StaffRole, string> = {
  manager: "Manager",
  accountant: "Accountant",
  store_keeper: "Store Keeper",
  secretary: "Secretary",
  cutting_operator: "Cutting Operator",
  edging_operator: "Edging Operator",
  assistant_operator: "Assistant Operator",
  security: "Security",
  janitor: "Janitor",
  other: "Other",
};

/** Whether someone is still employed, and how they left if not. */
export const STAFF_STATUSES = ["active", "suspended", "resigned", "terminated"] as const;
export type StaffStatus = (typeof STAFF_STATUSES)[number];

export const STAFF_STATUS_LABELS: Record<StaffStatus, string> = {
  active: "Active",
  suspended: "Suspended",
  resigned: "Resigned",
  terminated: "Terminated",
};

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
  // MFC by size. A bare "mfc" cannot be resolved to a size, so it maps to the
  // higher-volume 9×7 rather than being dropped — a board counted as the wrong size is
  // recoverable, one counted as nothing is not.
  mfc: "mfc_9x7",
  mfc9x7: "mfc_9x7",
  mfc97: "mfc_9x7",
  mfc9x4: "mfc_9x4",
  mfc94: "mfc_9x4",
  quarter: "quarter",
  qrt: "quarter",
  quarterplywood: "quarter",
  kwali: "kwali",
  tape: "tape",
  edgetape: "tape",
  stape: "tape",
  // Bangaji is the workshop's name for MFC 9×7, so both spellings resolve to it.
  bangaji: "mfc_9x7",
  bangagi: "mfc_9x7",
  marine: "marine",
  marineboard: "marine",
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

// ---------------------------------------------------------------------------
// Marketing
// ---------------------------------------------------------------------------

/**
 * What kind of site a marketer walked onto.
 *
 * Two values because that is the real split in how the work is won: a homeowner
 * decides alone and quickly, a commercial site goes through an engineer or a main
 * contractor and takes months. The follow-up rhythm is different for each, so the
 * distinction is worth recording at the door rather than inferring later.
 */
export const SITE_TYPES = ["residential", "commercial"] as const;
export type SiteType = (typeof SITE_TYPES)[number];

export const SITE_TYPE_LABELS: Record<SiteType, string> = {
  residential: "Residential",
  commercial: "Commercial",
};

/** Who was actually spoken to on site. */
export const CONTACT_ROLES = ["engineer", "contractor", "owner", "other"] as const;
export type ContactRole = (typeof CONTACT_ROLES)[number];

export const CONTACT_ROLE_LABELS: Record<ContactRole, string> = {
  engineer: "Engineer",
  contractor: "Contractor",
  owner: "Owner",
  other: "Someone else",
};

/**
 * How warm the prospect felt.
 *
 * A marketer's read, recorded at the time. Deliberately three coarse bands rather
 * than a score out of ten: nobody can tell a 6 from a 7 standing in a dusty
 * corridor, and a scale finer than the judgement behind it invents precision.
 */
export const INTEREST_LEVELS = ["high", "medium", "low"] as const;
export type InterestLevel = (typeof INTEREST_LEVELS)[number];

export const INTEREST_LEVEL_LABELS: Record<InterestLevel, string> = {
  high: "High",
  medium: "Medium",
  low: "Low",
};

/**
 * Where the building had got to.
 *
 * This is the single most useful field on the form, because it says *when* the work
 * is winnable. A site that has not started is a diary entry for three months' time;
 * one near finishing is either today's order or already lost to whoever is on site.
 */
export const SITE_SITUATIONS = [
  "not_started",
  "ongoing",
  "near_finishing",
  "has_carpenter",
] as const;
export type SiteSituation = (typeof SITE_SITUATIONS)[number];

export const SITE_SITUATION_LABELS: Record<SiteSituation, string> = {
  not_started: "Not started",
  ongoing: "Ongoing work",
  near_finishing: "Near finishing",
  has_carpenter: "Already has a carpenter",
};

/** What was talked about. Several apply on one visit, so this is a multi-select. */
export const DISCUSSED_SERVICES = [
  "kitchen_cabinets",
  "doors",
  "cutting_edging",
  "wardrobes",
  "interior",
  "glass",
  "other",
] as const;
export type DiscussedService = (typeof DISCUSSED_SERVICES)[number];

export const DISCUSSED_SERVICE_LABELS: Record<DiscussedService, string> = {
  kitchen_cabinets: "Kitchen cabinets",
  doors: "Doors",
  cutting_edging: "Cutting & edging",
  wardrobes: "Wardrobes",
  interior: "General interior work",
  glass: "Glass work",
  other: "Other",
};

/** What happens next. One per visit — the single thing that has been committed to. */
export const NEXT_ACTIONS = [
  "follow_up_call",
  "site_revisit",
  "send_quotation",
  "send_samples",
  "none",
] as const;
export type NextAction = (typeof NEXT_ACTIONS)[number];

export const NEXT_ACTION_LABELS: Record<NextAction, string> = {
  follow_up_call: "Follow-up call",
  site_revisit: "Site revisit",
  send_quotation: "Send quotation",
  send_samples: "Send samples",
  none: "No follow-up needed",
};

/**
 * A lead's state.
 *
 * `won` and `lost` are both terminal and deliberately distinct: a pipeline that only
 * records wins cannot tell you why the losses happened, which is the more useful half
 * of the information. `contacted` is the working middle where most of the file lives.
 */
export const LEAD_STATUSES = ["new", "contacted", "quoted", "won", "lost"] as const;
export type LeadStatus = (typeof LEAD_STATUSES)[number];

export const LEAD_STATUS_LABELS: Record<LeadStatus, string> = {
  new: "New",
  contacted: "Following up",
  quoted: "Quoted",
  won: "Won",
  lost: "Lost",
};

/** Terminal states, where no further follow-up is expected. */
export const CLOSED_LEAD_STATUSES: readonly LeadStatus[] = ["won", "lost"];

/** Roughly what the client can spend. A band, because nobody states a figure at first contact. */
export const BUDGET_LEVELS = ["high", "medium", "low", "unknown"] as const;
export type BudgetLevel = (typeof BUDGET_LEVELS)[number];

export const BUDGET_LEVEL_LABELS: Record<BudgetLevel, string> = {
  high: "High",
  medium: "Medium",
  low: "Low",
  unknown: "Not known yet",
};

/** How a follow-up was made. Recorded because a visit and a call are not the same effort. */
export const CONTACT_METHODS = ["call", "visit", "whatsapp", "sms", "email"] as const;
export type ContactMethod = (typeof CONTACT_METHODS)[number];

export const CONTACT_METHOD_LABELS: Record<ContactMethod, string> = {
  call: "Call",
  visit: "Visit",
  whatsapp: "WhatsApp",
  sms: "SMS",
  email: "Email",
};

/** How soon the client needs it, as they described it. */
export const URGENCY_LEVELS = ["high", "medium", "low"] as const;
export type UrgencyLevel = (typeof URGENCY_LEVELS)[number];

export const URGENCY_LEVEL_LABELS: Record<UrgencyLevel, string> = {
  high: "High — wants it now",
  medium: "Medium",
  low: "Low — planning ahead",
};

/**
 * A quotation request's state.
 *
 * The request is the marketer handing a serious client to the office; these three
 * states are the handover's whole lifecycle. `quoted` carries the invoice or estimate
 * that answered it, which is what closes the loop between marketing and billing.
 */
export const QUOTE_REQUEST_STATUSES = ["pending", "quoted", "declined"] as const;
export type QuoteRequestStatus = (typeof QUOTE_REQUEST_STATUSES)[number];

export const QUOTE_REQUEST_STATUS_LABELS: Record<QuoteRequestStatus, string> = {
  pending: "Waiting on the office",
  quoted: "Quotation sent",
  declined: "Declined",
};

/**
 * A day's attendance for one person.
 *
 * Four states, deliberately coarse. The brief is explicit that this should not start with
 * biometrics — a register somebody ticks is a system that gets used, and a clocking machine
 * nobody trusts is a system that gets worked around.
 *
 * `absent` is the only one with money attached: it is what a no-show deduction is raised from.
 * `holiday` exists so an empty day is explained rather than looking like a day nobody bothered
 * recording, which is the first question anyone asks about a light week. `leave` is an agreed
 * absence and costs nothing, which is precisely why it must be distinguishable from a no-show.
 */
export const ATTENDANCE_STATUSES = ["present", "absent", "leave", "holiday"] as const;
export type AttendanceStatus = (typeof ATTENDANCE_STATUSES)[number];

export const ATTENDANCE_STATUS_LABELS: Record<AttendanceStatus, string> = {
  present: "Present",
  absent: "Absent",
  leave: "Approved leave",
  holiday: "Public holiday",
};

/** Which statuses are a chargeable absence — the ones a no-show deduction may follow. */
export const CHARGEABLE_ABSENCE: readonly AttendanceStatus[] = ["absent"];

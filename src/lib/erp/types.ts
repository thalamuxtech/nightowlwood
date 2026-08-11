import type { Timestamp } from "firebase/firestore";
import type {
  BoardType,
  ConsumableType,
  DeductionType,
  EmploymentType,
  EstimateStatus,
  ExpenseCategory,
  InvoiceStatus,
  JobStatus,
  LoanStatus,
  LoanType,
  MovementType,
  PaymentMethod,
  ProductCategory,
  ProjectStatus,
  Role,
  SaleStatus,
  ServiceType,
  StaffRole,
  StaffStatus,
  TaxMode,
  ToolRequestStatus,
  WageRunStatus,
  WageWorkType,
} from "./enums";

/**
 * Domain types for the ERP.
 *
 * All monetary fields are integer kobo and named `…Kobo` (see `money.ts`).
 * `Timestamp | null` is used for server timestamps, which read back as null on
 * the write round-trip before the server resolves them.
 */

/** Fields written on every mutable document for traceability. */
export interface AuditFields {
  createdAt: Timestamp | null;
  createdBy: string;
  updatedAt?: Timestamp | null;
  updatedBy?: string;
}

// ---------------------------------------------------------------------------
// People
// ---------------------------------------------------------------------------

export interface AppUser extends AuditFields {
  id: string; // === auth uid
  email: string;
  name: string;
  role: Role;
  phone?: string;
  active: boolean;
  /** Set when this login corresponds to a staff record (operators). */
  staffId?: string;
  lastLoginAt?: Timestamp | null;
}

export interface Staff extends AuditFields {
  id: string;
  name: string;
  /** What they are called on the floor, e.g. "Mal Habu". Used on the work log. */
  nickname?: string;
  phone?: string;
  altPhone?: string;
  jobTitle?: string;
  /** Controlled role, for appointment letters and ID cards. */
  role?: StaffRole;
  isOperator: boolean;
  isAssistant: boolean;
  active: boolean;
  status?: StaffStatus;
  /** Monthly salaried staff; piece-rate workers leave this unset. */
  monthlySalaryKobo?: number;
  /** True when this person is paid a monthly salary rather than per piece. Kept
   *  alongside the figure so a salaried employee on zero this month is still
   *  distinguishable from a piece-rate worker. */
  isSalaried?: boolean;
  employmentType?: EmploymentType;
  bankName?: string;
  bankAccount?: string;
  /** Linked login, if this staff member has admin access. */
  userId?: string;

  /*
   * Employment record.
   *
   * Enough to produce an appointment letter and an ID card without asking again, and to
   * answer the questions that come up years later: when did they start, who do we call
   * if something happens, what number is on their card.
   */
  staffNumber?: string;
  address?: string;
  dateOfBirth?: Timestamp | null;
  hiredAt?: Timestamp | null;
  endedAt?: Timestamp | null;
  nextOfKinName?: string;
  nextOfKinPhone?: string;
  nextOfKinRelationship?: string;
  /** Passport photograph, for the ID card. */
  photoUrl?: string;
  /** National ID / NIN, held because payroll and formal letters ask for it. */
  idNumber?: string;
  notes?: string;
}

export interface Customer extends AuditFields {
  id: string;
  name: string;
  phone?: string;
  altPhone?: string;
  email?: string;
  address?: string;
  /** Walk-in service customer, project client, or both. */
  isServiceCustomer: boolean;
  isProductClient: boolean;
  notes?: string;
}

// ---------------------------------------------------------------------------
// Services pipeline
// ---------------------------------------------------------------------------

/**
 * Board counts as recorded on the paper Job Order Tracker checkboxes.
 *
 * Field order matches `COUNTED_BOARD_TYPES`, which is the order the workshop counts a
 * stack in. The two MFC sizes are counted separately because they are stocked
 * separately.
 */
export interface BoardBreakdown {
  egger?: number;
  mdf?: number;
  hdf?: number;
  /** MFC in 9×7 feet sheets. */
  mfc_9x7?: number;
  /** MFC in 9×4 feet sheets. */
  mfc_9x4?: number;
  kwali?: number;
  quarter?: number;
  /** Rolls of edge tape, not sheets — excluded from the board remainder. */
  tape?: number;
  colour?: string;
  otherBoard?: string;
}

/**
 * Boards received against boards cut, for one customer.
 *
 * Derived, never stored: received comes from the jobs' board breakdowns and cut
 * comes from the work logs against those jobs, so the remainder cannot drift from
 * the two records it is the difference between. The reason this matters is that a
 * customer's boards are their property — the workshop is holding them — and
 * "how many of mine have you still got?" had no answer other than counting the
 * stack by hand.
 */
export interface BoardReconciliation {
  customerId: string;
  customerName: string;
  receivedBoards: number;
  cutBoards: number;
  /** received − cut, floored at zero: more cut than received is a data fault. */
  remainingBoards: number;
  /** Set when cut exceeds received, which needs investigating rather than hiding. */
  overCut?: number;
  /** Edge tape, counted in rolls and kept apart from sheets. */
  receivedTape: number;
  usedTape: number;
  remainingTape: number;
  jobCount: number;
  openJobCount: number;
}

export interface ServiceJob extends AuditFields {
  id: string;
  jobNumber: string;
  customerId: string;
  /** Denormalised for list views; kept in sync on customer rename. */
  customerName: string;
  customerPhone?: string;
  staffId?: string;
  staffName?: string;
  staffSignature?: string;
  boards: BoardBreakdown;
  accessories?: string;
  repName?: string;
  repPhone?: string;
  status: JobStatus;
  /** Q.O checks from the bottom of the tracker form. */
  quantityCheck?: boolean;
  qualityCheck?: boolean;
  qoSignature?: string;
  pickupBy?: string;
  pickupPhone?: string;
  pickupDate?: Timestamp | null;
  pickupSignature?: string;
  receivedAt: Timestamp | null;
  completedAt?: Timestamp | null;
  /** Derived totals, recomputed whenever line items or payments change. */
  totalKobo: number;
  paidKobo: number;
  balanceKobo: number;
  notes?: string;
}

export interface ServiceJobLine {
  id: string;
  serviceType: ServiceType;
  boardType?: BoardType;
  description?: string;
  quantity: number;
  unitPriceKobo: number;
  amountKobo: number;
}

export interface JobPayment extends AuditFields {
  id: string;
  date: Timestamp | null;
  description: string;
  amountKobo: number;
  method: PaymentMethod;
}

/**
 * One kind of work within a work log entry, with its own unit count.
 *
 * `jobId` is per item because one shift can span two customers' jobs: an operator cuts
 * 20 boards for one and edges 12 for another without stopping. A single job on the
 * whole entry forced those to be two records, and in practice the second was skipped —
 * which is how work went unpaid and boards went unreconciled.
 *
 * Absent means "the entry's job", so an entry where all the work is for one customer
 * carries the job once at the top and every item inherits it.
 */
export interface WorkLogItem {
  workType: WageWorkType;
  units: number;
  /** Overrides the entry's job for this item only. */
  jobId?: string;
  jobNumber?: string;
}

/**
 * Piece-rate work performed, feeding the wage run.
 *
 * An entry carries **several** work types with their own unit counts, because a
 * shift is not one kind of work: an operator cuts 30 boards, edges 12 and hangs 2
 * doors on the same day against the same job with the same assistants. Forcing
 * that into one type per entry meant either three near-duplicate records to key,
 * or — what actually happened on paper — only the largest number being written
 * down and the rest going unpaid.
 *
 * `workType`/`units` are retained at the top level as the first item's values.
 * Every wage run written before `items` existed reads those fields, and so do the
 * printed sheets, so dropping them would silently zero historical pay. Readers
 * must prefer `items` when present; `itemsFrom()` in `workLogs.ts` does this in
 * one place so no caller has to remember.
 */
export interface WorkLog extends AuditFields {
  id: string;
  jobId?: string;
  jobNumber?: string;
  staffId: string;
  staffName: string;
  /** First item's work type. Legacy readers use this; prefer `items`. */
  workType: WageWorkType;
  /** First item's units. Legacy readers use this; prefer `items`. */
  units: number;
  /** Every kind of work on this entry. Absent on entries written before it existed. */
  items?: WorkLogItem[];

  /*
   * Materials drawn from the customer's stack.
   *
   * Recorded rather than inferred from the unit counts, because the two are genuinely
   * different numbers: cutting 40 pieces out of 12 boards is normal, and deriving
   * boards from pieces would have claimed 40 sheets off a stack of 12. This is the
   * figure the remaining-boards calculation subtracts.
   */
  boardsUsed?: number;
  /** Rolls of edge tape consumed, counted apart from sheets. */
  edgeTapeUsed?: number;

  workDate: Timestamp | null;
  /** Assistants present for this work, used for the assistant wage split. */
  assistantCount?: number;
  assistantIds?: string[];
  assistantNames?: string[];
  notes?: string;
}

/**
 * Money withheld from a person's pay, raised at the work log.
 *
 * Recorded as its own document rather than a field on the work log because a
 * deduction is not always tied to work having been done — a no-show is precisely
 * the absence of it — and because it must survive the work log being corrected.
 *
 * `appliedToRunId` is what stops a deduction being taken twice: a run claims it
 * on approval, and an unclaimed deduction is the only kind the next run picks up.
 */
export interface StaffDeduction extends AuditFields {
  id: string;
  staffId: string;
  staffName: string;
  type: DeductionType;
  amountKobo: number;
  reason?: string;
  date: Timestamp | null;
  /** Set when the work log that raised it is known, for traceability. */
  workLogId?: string;
  /** The run that consumed this deduction. Null until one does. */
  appliedToRunId?: string | null;
  appliedAt?: Timestamp | null;
  /** Which kind of run claimed it, since wage and salary runs are separate. */
  appliedToRunType?: "wage" | "salary" | null;
}

/**
 * A rate for a specific person, overriding the work-type rate.
 *
 * Versioned exactly as `WageRate` is, and for the same reason: a past run has to
 * stay reproducible, so a raise closes the old row and inserts a new one.
 *
 * `workType` null means "every kind of work" — the common case, where one person
 * is simply paid more than the standard rate across the board. A row naming a
 * work type beats a row that does not, so a general uplift and one exception can
 * coexist.
 */
export interface StaffRate extends AuditFields {
  id: string;
  staffId: string;
  staffName: string;
  role: "operator" | "assistant";
  workType?: WageWorkType | null;
  rateKobo: number;
  effectiveFrom: Timestamp | null;
  effectiveTo?: Timestamp | null;
  note?: string;
}

// ---------------------------------------------------------------------------
// Products pipeline
// ---------------------------------------------------------------------------

export interface Project extends AuditFields {
  id: string;
  projectNumber: string;
  customerId: string;
  customerName: string;
  title: string;
  location?: string;
  status: ProjectStatus;
  startDate?: Timestamp | null;
  targetDate?: Timestamp | null;
  completedAt?: Timestamp | null;
  /** Agreed contract value once approved. */
  contractValueKobo?: number;
  /** Rolled up from components → features. */
  estimatedCostKobo: number;
  actualCostKobo: number;
  notes?: string;

  /*
   * The estimate.
   *
   * The project *is* its estimate: the components and their ticked features are
   * the line items, and these fields are the rest of the document. There is no
   * separate snapshot, so a price corrected on a component is corrected on the
   * estimate, which is the whole point — one set of numbers, never two that can
   * disagree.
   */

  /** Both percentages apply to the component subtotal only, never to each other. */
  errorMarginPercent?: number;
  nightowlChargePercent?: number;

  /*
   * Boards the job needs, by material.
   *
   * Entered once here and priced by the Services cutting & edging rate card, which is what
   * makes the estimate's cutting line derived rather than typed. Before this, C&E was
   * keyed twice — once as a service job line, once as a cost item — at whatever figure the
   * person quoting remembered, and the two disagreed on the document the client sees.
   */
  boardCounts?: BoardBreakdown;
  /** The C&E charge those counts produce, recomputed whenever they change. */
  cuttingChargeKobo?: number;
  /** Bumped each time the estimate is sent out, so a client can cite a version. */
  estimateVersion?: number;
  estimateStatus?: EstimateStatus;
  estimateApprovedBy?: string;
  estimateApprovedAt?: Timestamp | null;
  estimateNotes?: string;
  lastEmailedTo?: string;
  lastEmailedAt?: Timestamp | null;

  /**
   * External-reviewer access, held here now that there is no estimate document.
   * Only hashes are stored, never the raw token.
   */
  reviewTokenHash?: string;
  reviewPasscodeHash?: string;
  reviewEmail?: string;
  reviewerName?: string;
  reviewSentAt?: Timestamp | null;
  reviewExpiresAt?: Timestamp | null;
  reviewedAt?: Timestamp | null;
  reviewAttempts?: number;
  reviewNotes?: string;
  /** Components the reviewer was asked to look at. Empty means all of them. */
  reviewComponentIds?: string[];
}

export interface ProjectComponent extends AuditFields {
  id: string;
  name: string;
  category: ProductCategory;
  status: ProjectStatus;
  order: number;
  estimatedCostKobo: number;
  notes?: string;
}

/** A priced line within a component: quantity × unit price. */
export interface ComponentFeature {
  id: string;
  item: string;
  /** What the site actually needs, before rounding up to purchasable units. */
  actualQuantity?: number;
  quantity: number;
  unitPriceKobo: number;
  amountKobo: number;
  order: number;
  /**
   * Whether the line goes on the estimate.
   *
   * Template rows arrive unchecked: the template is a checklist of everything
   * that *might* apply to a kitchen, not a bill. Ticking a line is what says
   * "this job needs it", which is a separate decision from what it costs, so a
   * zero-priced line can still be listed and a priced one deliberately held
   * back. Absent on rows written before the flag existed, where a price is the
   * only signal of intent available.
   */
  included?: boolean;
  notes?: string;
  /**
   * Set when an external reviewer added or changed this line.
   *
   * Reviewer edits now land straight on the feature, because the feature is the
   * estimate line. Without these the admin would have no way to tell a figure the
   * office typed from one a fabricator sent back, which is exactly the thing worth
   * a second look before it goes to a client.
   */
  addedByReviewer?: boolean;
  reviewerNote?: string;
  /** What the line said before the reviewer touched it, so the change is visible. */
  reviewedFromKobo?: number | null;

  /*
   * Whether this line is boards, and which kind.
   *
   * Ticking it means the line's quantity counts toward the project's board total, which is
   * what the cutting & edging charge is calculated from. Before this, the boards a job needed
   * were entered once as a cost item and again as a separate board count, and the two
   * disagreed — so the cutting charge was computed against a number nobody had checked
   * against the items actually being bought.
   *
   * `boardType` is needed because the C&E rate differs per material: 10 Egger and 10 MFC 9×7
   * are the same quantity and nearly twice the charge.
   */
  isBoard?: boolean;
  boardType?: BoardType;
}

/**
 * A bought-in extra on a component: kitchenwares, appliances, fittings.
 *
 * Separate from `ComponentFeature` because the two are different kinds of money.
 * A feature is work the workshop performs and prices with its own margin; an addon
 * is an item bought at a supplier price and passed on. Mixing them meant a ₦450,000
 * oven inflated the base that the error margin and Nightowl charge were applied to,
 * so the client was quietly charged a manufacturing margin on an appliance nobody
 * manufactured.
 *
 * `marginPercent` is therefore per-addon and defaults to zero: some addons are
 * passed through at cost as a courtesy, others carry a handling charge, and that is
 * a commercial decision per line rather than a system-wide rate.
 */
export interface ComponentAddon extends AuditFields {
  id: string;
  name: string;
  category: "kitchenware" | "appliance" | "fitting" | "other";
  brand?: string;
  model?: string;
  supplier?: string;
  quantity: number;
  /** What it costs the business to buy. */
  unitCostKobo: number;
  /** Handling/markup on top of cost, 0 for a straight pass-through. */
  marginPercent?: number;
  /** quantity × unitCost, plus margin. Computed, not entered. */
  amountKobo: number;
  order: number;
  /** Whether the addon goes on the estimate, matching ComponentFeature.included. */
  included?: boolean;
  notes?: string;
}

/**
 * Something bought against a project.
 *
 * This is the actual-cost side of the estimate: the estimate says what the job was
 * expected to cost, and these say what was really spent. Without them a project's
 * profit is a guess, because the only recorded figure is the one quoted before any
 * material was bought.
 *
 * Booked to the expense ledger on save, keyed on the purchase id, so project cost
 * and company cost are the same money rather than two figures that disagree.
 */
export interface ProjectPurchase extends AuditFields {
  id: string;
  projectId: string;
  projectNumber?: string;
  /** Optional link to the component it was bought for, for per-component cost. */
  componentId?: string;
  componentName?: string;
  item: string;
  category: ExpenseCategory;
  quantity: number;
  unit?: string;
  unitCostKobo: number;
  totalCostKobo: number;
  supplierId?: string;
  supplierName?: string;
  purchasedAt: Timestamp | null;
  receiptUrl?: string;
  /** The expense document this booked, so the two can never drift apart. */
  expenseId?: string;
  notes?: string;
}

/**
 * A counter sale: boards, edge tape, accessories.
 *
 * Sold and paid for at once, so there is no balance and no pipeline. Each line
 * decrements company stock through an inventory movement, which is what makes the
 * shop floor's stock figure trustworthy — a sale that did not move stock is how a
 * board count drifts from reality.
 *
 * `costOfGoodsKobo` is captured at sale time from the item's unit cost. Profit on a
 * sale has to be computed against what the stock cost *then*, not what a
 * replacement costs today, or margin silently changes every time a supplier
 * reprices.
 */
export interface Sale extends AuditFields {
  id: string;
  receiptNumber: string;
  /** Walk-in trade is normal, so a customer is optional. */
  customerId?: string;
  customerName?: string;
  customerPhone?: string;
  lines: SaleLine[];
  subtotalKobo: number;
  discountPercent?: number;
  discountKobo?: number;
  taxMode?: TaxMode;
  taxPercent?: number;
  taxKobo: number;
  totalKobo: number;
  /** What the goods cost the business, summed from the lines. */
  costOfGoodsKobo: number;
  method: PaymentMethod;
  /** Cash tendered, so the till can show change given. Cash sales only. */
  tenderedKobo?: number;
  changeKobo?: number;

  /*
   * Credit sales.
   *
   * A counter sale is usually settled on the spot, and the model assumed always — which meant a
   * trade customer taking boards on account had nowhere to be recorded, so it went in a notebook
   * and the debt was invisible to the books.
   *
   * `amountPaidKobo` is what was actually handed over, `balanceKobo` what is still owed. A
   * fully-paid sale carries the total and a zero balance, so cash and credit are the same shape
   * and nothing has to branch on which it was.
   */
  amountPaidKobo: number;
  balanceKobo: number;
  /** When the balance is expected. Set on a credit sale so it can be chased. */
  dueAt?: Timestamp | null;
  settledAt?: Timestamp | null;

  status: SaleStatus;
  soldAt: Timestamp | null;
  soldByName?: string;
  voidedAt?: Timestamp | null;
  voidReason?: string;
  notes?: string;
}

export interface SaleLine {
  id: string;
  /** Set when sold from stock; absent for an untracked one-off item. */
  inventoryItemId?: string;
  item: string;
  unit?: string;
  quantity: number;
  unitPriceKobo: number;
  /** Unit cost at the moment of sale, for margin. */
  unitCostKobo?: number;
  /**
   * False for a service, which is sold but holds no stock to move.
   *
   * Cutting and edge banding go over the counter like anything else. Decrementing them would
   * drive their count negative on every sale, and then block the till entirely once negative
   * stock is disallowed.
   */
  tracksStock?: boolean;
  amountKobo: number;
}

export interface Estimate extends AuditFields {
  id: string;
  projectId: string;
  projectNumber?: string;
  version: number;
  status: EstimateStatus;
  subtotalKobo: number;
  errorMarginPercent: number;
  errorMarginKobo: number;
  /**
   * The rate the charge was quoted at.
   *
   * Stored rather than back-derived from `nightowlChargesKobo / subtotalKobo`.
   * That ratio is unrecoverable once the subtotal reaches zero — remove the last
   * line and both operands are zero — so an estimate emptied and refilled came
   * back charging nothing. Optional because estimates issued before this field
   * existed do not carry it; readers fall back to the ratio for those.
   */
  nightowlChargePercent?: number;
  nightowlChargesKobo: number;
  totalKobo: number;
  /** External-reviewer access. Only hashes are stored, never the raw token. */
  reviewTokenHash?: string;
  reviewPasscodeHash?: string;
  reviewEmail?: string;
  reviewerName?: string;
  reviewSentAt?: Timestamp | null;
  reviewExpiresAt?: Timestamp | null;
  reviewedAt?: Timestamp | null;
  reviewAttempts?: number;
  reviewNotes?: string;
  approvedBy?: string;
  approvedAt?: Timestamp | null;
}

export interface EstimateLine {
  id: string;
  category: ProductCategory;
  item: string;
  actualQuantity?: number;
  quantity: number;
  unitPriceKobo: number;
  amountKobo: number;
  order: number;
  /** True when an external reviewer added this line, so admin can see changes. */
  addedByReviewer?: boolean;
  reviewerNote?: string;
}

/** Seeded line-item checklists, one per product category. */
export interface EstimateTemplate {
  id: ProductCategory;
  label: string;
  items: string[];
}

// ---------------------------------------------------------------------------
// Money out / in
// ---------------------------------------------------------------------------

export interface InvoiceLine {
  id: string;
  description: string;
  quantity: number;
  unitPriceKobo: number;
  amountKobo: number;
}

export interface Invoice extends AuditFields {
  id: string;
  /**
   * Where the invoice came from.
   *
   * `standalone` is a real mode, not a fallback: the workshop bills for things
   * that never became a job or a project — a delivery, a call-out, a one-off
   * supply — and those were previously invoiced on paper because the system could
   * only generate from an existing record.
   */
  type: "service" | "project" | "standalone";
  invoiceNumber: string;
  customerId: string;
  customerName: string;
  jobId?: string;
  projectId?: string;
  lines: InvoiceLine[];
  subtotalKobo: number;

  /*
   * Tax, commission and discount.
   *
   * Order matters and is fixed: discount comes off the subtotal, commission is a
   * percentage of the *invoice total*, and tax is either added on top of or
   * already inside the taxable base. Each rate is stored alongside the amount it
   * produced rather than only the amount, so an invoice can be re-read years later
   * and still explain itself — and stored alongside the rate rather than only the
   * rate, so a later change to settings cannot restate a document already sent.
   */

  /** `none` when nothing is charged, which is the default. */
  taxMode?: TaxMode;
  taxPercent?: number;
  taxLabel?: string;
  taxKobo: number;
  /**
   * Agent/introducer commission, a percentage of the invoice total.
   *
   * Recorded on the invoice because it is a cost the business incurs by raising
   * it, and the profit report has to see it. It does not change what the customer
   * pays.
   */
  commissionPercent?: number;
  commissionKobo?: number;
  commissionNote?: string;
  discountPercent?: number;
  discountKobo?: number;

  totalKobo: number;
  amountPaidKobo: number;
  balanceKobo: number;
  status: InvoiceStatus;
  issuedAt?: Timestamp | null;
  dueAt?: Timestamp | null;
  /** Set only by the admin-only Cloud Function, never client-side. */
  paidAt?: Timestamp | null;
  paidBy?: string;
  sentAt?: Timestamp | null;
  pdfUrl?: string;
  notes?: string;
}

/**
 * A file held against an invoice — most often the customer's cutting list.
 *
 * The reason this exists: a cutting list is the customer's own document, handed over on
 * paper, and losing it means the job cannot be re-cut and the customer cannot be
 * answered. Attaching it to the invoice puts it somewhere it can be found and reprinted
 * years later, next to the money it relates to.
 */
export interface InvoiceAttachment extends AuditFields {
  id: string;
  kind: "cutting_list" | "drawing" | "receipt" | "signed_sheet" | "other";
  title: string;
  fileUrl: string;
  /** MIME type, so the viewer knows whether it can be shown or only downloaded. */
  contentType?: string;
  sizeBytes?: number;
  notes?: string;
}

export interface Expense extends AuditFields {
  id: string;
  date: Timestamp | null;
  payeeType: "staff" | "company" | "vendor";
  payeeName: string;
  purpose: string;
  category: ExpenseCategory;
  amountKobo: number;
  receiptUrl?: string;
}

/**
 * One utility meter reading.
 *
 * The charge is `(reading − previous) × conversionFactor × ratePerUnit`. The
 * middle term is the part that needs explaining: some meters read in a unit that
 * has to be multiplied up before it is billable (the observed factor is 60),
 * while others read directly in the billed unit. It is therefore configured per
 * meter and stored per reading, so turning it on later cannot silently restate
 * every historical bill.
 */
export interface MeterReading extends AuditFields {
  id: string;
  meterName: string;
  date: Timestamp | null;
  reading: number;
  /** The reading this one was measured against, kept so the row explains itself. */
  previousReading?: number | null;
  /** reading − previous reading, in dial units. Computed on write, not entered. */
  actualConsumed: number;
  /**
   * Multiplier from dial units to billed units. 1 means the dial already reads in
   * the billed unit. Stored per reading so history stays reproducible.
   */
  conversionFactor?: number;
  /** actualConsumed × conversionFactor — what the rate is actually applied to. */
  billedUnits?: number;
  /** Cost per *billed* unit. */
  ratePerUnitKobo: number;
  amountKobo: number;
  /** Set when the reading is below its predecessor, or is the first for a meter. */
  warning?: string | null;
}

// ---------------------------------------------------------------------------
// Payroll
// ---------------------------------------------------------------------------

/**
 * A piece rate, versioned. `effectiveTo === null` marks the live rate; setting
 * a new rate closes the previous one rather than overwriting it, so historical
 * wage runs stay reproducible.
 */
export interface WageRate extends AuditFields {
  id: string;
  workType: WageWorkType;
  operatorRateKobo: number;
  assistantRateKobo: number;
  effectiveFrom: Timestamp | null;
  effectiveTo?: Timestamp | null;
  note?: string;
}

export interface WageRunLine {
  id: string;
  staffId: string;
  staffName: string;
  role: "operator" | "assistant";
  workType: WageWorkType;
  units: number;
  rateKobo: number;
  amountKobo: number;
  /** True when the rate came from a per-person override, not the work-type rate. */
  personalRate?: boolean;
}

/**
 * One person's pay on a run.
 *
 * Named rather than a role total, which was the gap in the previous view: a run
 * that says "assistants ₦12,000" is not something an assistant can check, and the
 * whole point of a payslip is that the person paid can verify it.
 */
export interface WageRunStaffRow {
  staffId: string;
  staffName: string;
  operatorKobo: number;
  assistantKobo: number;
  totalKobo: number;
  /** Loan repayments plus work-log deductions. */
  deductionKobo: number;
  loanDeductionKobo?: number;
  /** Work-log deductions, itemised so a payslip can state the reason. */
  otherDeductions?: Array<{
    id: string;
    type: DeductionType;
    amountKobo: number;
    reason?: string;
  }>;
  netKobo: number;
  /** The rates this person was actually paid at, for the run view. */
  rateLines?: Array<{
    role: "operator" | "assistant";
    workType: WageWorkType;
    units: number;
    rateKobo: number;
    amountKobo: number;
    personalRate?: boolean;
  }>;
}

export interface WageRun extends AuditFields {
  id: string;
  periodStart: Timestamp | null;
  periodEnd: Timestamp | null;
  status: WageRunStatus;
  /** Rates copied in at generation time so later rate edits can't rewrite history. */
  ratesSnapshot: Array<{
    workType: WageWorkType;
    operatorRateKobo: number;
    assistantRateKobo: number;
  }>;
  operatorTotalKobo: number;
  assistantPerPersonKobo: number;
  assistantCount: number;
  assistantSubTotalKobo: number;
  grandTotalKobo: number;
  /** Loan/advance repayments plus work-log deductions applied in this run. */
  deductionsKobo: number;
  netPayableKobo: number;
  /** Per-person breakdown, so the run shows names rather than role totals. */
  perStaff?: WageRunStaffRow[];
  approvedBy?: string;
  approvedAt?: Timestamp | null;
  paidAt?: Timestamp | null;
  notes?: string;
}

export interface Loan extends AuditFields {
  id: string;
  staffId: string;
  staffName: string;
  type: LoanType;
  amountKobo: number;
  purpose: string;
  status: LoanStatus;
  requestedAt: Timestamp | null;
  approvedBy?: string;
  approvedAt?: Timestamp | null;
  disbursedAt?: Timestamp | null;
  repaidKobo: number;
  outstandingKobo: number;
  settledAt?: Timestamp | null;
  notes?: string;
}

export interface LoanRepayment {
  id: string;
  wageRunId?: string;
  amountKobo: number;
  at: Timestamp | null;
  recordedBy: string;
}

// ---------------------------------------------------------------------------
// Inventory & tools
// ---------------------------------------------------------------------------

/**
 * Service inventory: customer-owned boards and items brought in for service
 * work. Held on site while the job runs, we are custodians, not owners, so
 * these never count as company stock or assets.
 */
export interface ServiceInventoryItem extends AuditFields {
  id: string;
  customerId: string;
  customerName: string;
  jobId?: string;
  jobNumber?: string;
  boardType: BoardType;
  description?: string;
  quantity: number;
  receivedAt: Timestamp | null;
  releasedAt?: Timestamp | null;
  status: "held" | "released";
}

/** Company-owned consumables and materials. */
export interface CompanyInventoryItem extends AuditFields {
  id: string;
  sku?: string;
  name: string;
  category: string;
  unit: string;
  quantityOnHand: number;
  reorderLevel: number;
  unitCostKobo: number;
  supplier?: string;
  lastRestockedAt?: Timestamp | null;
  active: boolean;
}

export interface InventoryMovement extends AuditFields {
  id: string;
  type: MovementType;
  quantity: number;
  reason: string;
  jobId?: string;
  projectId?: string;
  unitCostKobo?: number;
  /**
   * Who took the stock.
   *
   * "Gum, 2 bags out" answers what left but not who has it, which is the question asked
   * when the count is short. Naming the receiver turns the movement log from a record of
   * quantities into a record of custody — and someone who knows their name goes on the
   * line draws what they need rather than what is available.
   *
   * `issuedToStaffId` links to a staff record where one exists; the free-text name
   * carries the cases it cannot, like a fitter on site or a driver collecting.
   */
  issuedToStaffId?: string;
  issuedToName?: string;
  /** Who handed it over, which is a different person from the receiver. */
  issuedByName?: string;
  /** Running balance after this movement, for audit without re-summing. */
  balanceAfter: number;
}

/** Items bought for one specific client project. */
export interface ProductInventoryItem extends AuditFields {
  id: string;
  projectId: string;
  projectNumber?: string;
  componentId?: string;
  item: string;
  quantity: number;
  unitCostKobo: number;
  totalCostKobo: number;
  supplier?: string;
  purchasedAt: Timestamp | null;
  receiptUrl?: string;
}

/** Blade/gum lifecycle, for consumption rate and replacement forecasting. */
export interface ConsumableCycle extends AuditFields {
  id: string;
  type: ConsumableType;
  model: string;
  /** Brand/model being evaluated, so cycles roll up into brand performance. */
  brandId?: string;
  brandName?: string;
  supplierId?: string;
  supplierName?: string;
  line?: "egger" | "mdf" | "both";
  startDate: Timestamp | null;
  endDate?: Timestamp | null;
  /** Boards processed over the cycle, if tracked, drives cost per board. */
  unitsProcessed?: number;
  costKobo?: number;
  /** Computed on close: endDate − startDate, the headline durability figure. */
  lifespanDays?: number;
  /** Why it was retired, distinguishes fair wear from a premature failure. */
  retiredReason?: "worn_out" | "broke_early" | "damaged" | "lost" | "other";
  notes?: string;
}

// ---------------------------------------------------------------------------
// Procurement & supplier performance
// ---------------------------------------------------------------------------

/**
 * A vendor. Ratings are *derived* from purchase history rather than entered by
 * hand, so the numbers reflect what actually happened.
 */
export interface Supplier extends AuditFields {
  id: string;
  name: string;
  phone?: string;
  altPhone?: string;
  email?: string;
  address?: string;
  categories?: string[];
  active: boolean;
  notes?: string;

  // --- Derived scorecard, recomputed when a purchase is recorded ---
  /** Number of completed purchases. */
  purchaseCount?: number;
  totalSpendKobo?: number;
  /** Mean days between order and delivery. */
  avgLeadTimeDays?: number;
  /** Share of deliveries that arrived on/before the promised date, 0–100. */
  onTimeRatePercent?: number;
  /** Share of received lines rejected for quality/short delivery, 0–100. */
  defectRatePercent?: number;
  lastPurchaseAt?: Timestamp | null;
}

/**
 * A consumable brand/model, e.g. "Freud Blade" vs "Infrawood BLD". This is the
 * unit of comparison for purchasing decisions: the legacy Gum & Blade sheet
 * shows Infrawood lasting ~4 days against Freud's ~14, which is the difference
 * between a cheap blade and a false economy.
 */
export interface ConsumableBrand extends AuditFields {
  id: string;
  name: string;
  type: ConsumableType;
  preferredSupplierId?: string;
  active: boolean;
  notes?: string;

  // --- Derived from closed ConsumableCycle records ---
  cyclesRecorded?: number;
  avgLifespanDays?: number;
  /** Mean boards processed per unit, when units are tracked. */
  avgUnitsProcessed?: number;
  avgUnitCostKobo?: number;
  /** avgUnitCost ÷ avgUnitsProcessed, the true cost driver, not sticker price. */
  costPerUnitProcessedKobo?: number;
  /** Share of cycles retired as `broke_early`, 0–100. */
  earlyFailureRatePercent?: number;
}

export interface Purchase extends AuditFields {
  id: string;
  supplierId: string;
  supplierName: string;
  reference?: string;
  orderedAt: Timestamp | null;
  /** What the supplier promised, compared against `receivedAt` for on-time rate. */
  promisedAt?: Timestamp | null;
  receivedAt?: Timestamp | null;
  status: "ordered" | "partial" | "received" | "cancelled";
  subtotalKobo: number;
  totalKobo: number;
  /** True when anything was short-delivered or rejected; feeds defect rate. */
  hadIssues?: boolean;
  issueNotes?: string;
  receiptUrl?: string;
  notes?: string;
}

export interface PurchaseLine {
  id: string;
  /** Links to company inventory when the item is stocked. */
  inventoryItemId?: string;
  brandId?: string;
  item: string;
  quantityOrdered: number;
  quantityReceived?: number;
  /** Rejected on inspection, short delivery or poor quality. */
  quantityRejected?: number;
  unit: string;
  unitCostKobo: number;
  amountKobo: number;
}

export interface ToolRequest extends AuditFields {
  id: string;
  requestNumber: string;
  jobName: string;
  jobLocation?: string;
  requestedByStaffId?: string;
  requestedByName: string;
  requestSignature?: string;
  requestDate: Timestamp | null;
  /** When the tools are due back; drives the overdue flag. */
  expectedReturnDate?: Timestamp | null;
  issuedByName?: string;
  issueSignature?: string;
  issuedAt?: Timestamp | null;
  returnedByName?: string;
  returnSignature?: string;
  returnedDate?: Timestamp | null;
  status: ToolRequestStatus;
  notes?: string;
}

export interface ToolRequestItem {
  id: string;
  name: string;
  description?: string;
  quantityRequested: number;
  quantityIssued?: number;
  quantityReturned?: number;
  remarks?: string;
}

// ---------------------------------------------------------------------------
// Approvals
// ---------------------------------------------------------------------------

/**
 * A request to delete or change a record, awaiting an admin's decision.
 *
 * Deletions and consequential edits stop being something one person does alone. The
 * reason is captured at the moment of asking — while whoever is asking still remembers
 * why — and an admin sees both the reason and the exact before/after before anything
 * happens.
 *
 * The proposed change is stored as `payload` rather than applied and reverted, because a
 * reverted write has already been seen by anything watching the collection: a wage run
 * would have picked up a deleted work log, an invoice would have shown a changed figure.
 * Holding the intent and applying it once, on approval, means the record only ever moves
 * through states that were actually authorised.
 */
export interface ApprovalRequest extends AuditFields {
  id: string;
  kind: "delete" | "update";
  /** Collection path of the target, e.g. `workLogs` or `projects/abc/purchases`. */
  targetCollection: string;
  targetId: string;
  /** Human label so the queue reads without resolving every target. */
  targetLabel: string;
  /** Why it is being asked for. Required — the whole point of the queue. */
  reason: string;
  /** The fields to write on approval. Absent for a deletion. */
  payload?: Record<string, unknown>;
  /** What the record said when the request was raised, for the reviewer to compare. */
  before?: Record<string, unknown>;
  status: "pending" | "approved" | "rejected" | "cancelled";
  requestedByUid: string;
  requestedByEmail: string;
  requestedAt: Timestamp | null;
  decidedByUid?: string;
  decidedByEmail?: string;
  decidedAt?: Timestamp | null;
  /** Why an admin refused, so the requester learns something. */
  decisionNote?: string;
  /** Set when applying the approved change failed, with the reason. */
  applyError?: string;
}

// ---------------------------------------------------------------------------
// HR
// ---------------------------------------------------------------------------

/**
 * A day, or run of days, the workshop was shut.
 *
 * Stored as a range because holidays come in runs — Sallah is not one day — and entering
 * four separate records for it invites three of them being forgotten. A range also makes
 * the payroll question answerable: a salaried person is not absent on a public holiday,
 * so those days must not count against them.
 */
export interface Holiday extends AuditFields {
  id: string;
  name: string;
  /** Inclusive. A single day has startDate === endDate. */
  startDate: Timestamp | null;
  endDate: Timestamp | null;
  /** Public holiday, or a workshop closure like a stock take. */
  kind: "public" | "closure";
  notes?: string;
}

/**
 * A recurring cost owed whether or not any work happens.
 *
 * Rent, subscriptions, the security contribution. Held separately from the expense
 * ledger because they are a *commitment* rather than a payment: knowing the monthly
 * fixed figure is what answers "what must we turn over to break even", and that question
 * cannot be answered from expenses already paid.
 *
 * Recording a payment against one still writes an ordinary expense, so the ledger stays
 * the single source of truth for money that has actually left.
 */
export interface FixedCost extends AuditFields {
  id: string;
  name: string;
  category: ExpenseCategory;
  amountKobo: number;
  /** How often it falls due. Annual costs are shown monthly as amount ÷ 12. */
  cadence: "monthly" | "quarterly" | "annual";
  /** Day of the month it is due, where that is known. */
  dueDay?: number;
  active: boolean;
  notes?: string;
}

/** A document held against a staff member: appointment letter, ID card, certificate. */
export interface StaffDocument extends AuditFields {
  id: string;
  kind: "appointment_letter" | "id_card" | "contract" | "certificate" | "other";
  title: string;
  /** Set when a file was uploaded rather than generated. */
  fileUrl?: string;
  /** Reference number printed on the document, so a copy can be matched to a record. */
  reference?: string;
  issuedAt: Timestamp | null;
  notes?: string;
}

// ---------------------------------------------------------------------------
// Audit
// ---------------------------------------------------------------------------

export interface AuditLogEntry {
  id: string;
  actorUid: string;
  actorEmail: string;
  actorRole: Role;
  action: string;
  collectionName: string;
  docId: string;
  summary?: string;
  before?: Record<string, unknown>;
  after?: Record<string, unknown>;
  at: Timestamp | null;
}

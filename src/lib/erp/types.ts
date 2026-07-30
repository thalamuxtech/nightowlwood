import type { Timestamp } from "firebase/firestore";
import type {
  BoardType,
  ConsumableType,
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
  ServiceType,
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
  phone?: string;
  jobTitle?: string;
  isOperator: boolean;
  isAssistant: boolean;
  active: boolean;
  /** Monthly salaried staff; piece-rate workers leave this unset. */
  monthlySalaryKobo?: number;
  /** True when this person is paid a monthly salary rather than per piece. Kept
   *  alongside the figure so a salaried employee on zero this month is still
   *  distinguishable from a piece-rate worker. */
  isSalaried?: boolean;
  bankName?: string;
  bankAccount?: string;
  /** Linked login, if this staff member has admin access. */
  userId?: string;
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

/** Board counts as recorded on the paper Job Order Tracker checkboxes. */
export interface BoardBreakdown {
  mdf?: number;
  egger?: number;
  hdf?: number;
  quarter?: number;
  kwali?: number;
  tape?: number;
  colour?: string;
  otherBoard?: string;
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

/** A unit of piece-rate work performed, feeding the wage run. */
export interface WorkLog extends AuditFields {
  id: string;
  jobId?: string;
  jobNumber?: string;
  staffId: string;
  staffName: string;
  workType: WageWorkType;
  units: number;
  workDate: Timestamp | null;
  /** Assistants present for this work, used for the assistant wage split. */
  assistantCount?: number;
  assistantIds?: string[];
  notes?: string;
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
  notes?: string;
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
  invoiceNumber: string;
  type: "service" | "project";
  customerId: string;
  customerName: string;
  jobId?: string;
  projectId?: string;
  lines: InvoiceLine[];
  subtotalKobo: number;
  taxPercent?: number;
  taxKobo: number;
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

export interface MeterReading extends AuditFields {
  id: string;
  meterName: string;
  date: Timestamp | null;
  reading: number;
  /** reading − previous reading; computed on write, not entered. */
  actualConsumed: number;
  ratePerUnitKobo: number;
  amountKobo: number;
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
  /** Loan/advance deductions applied in this run. */
  deductionsKobo: number;
  netPayableKobo: number;
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

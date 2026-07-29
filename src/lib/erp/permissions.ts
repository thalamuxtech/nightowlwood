import type { Role } from "./enums";

/**
 * Capability-based permissions.
 *
 * The UI, the Firestore rules and the Cloud Functions all derive from this one
 * matrix. Hiding a button is not access control, anything listed here as
 * admin-only is *also* enforced server-side. This file is the human-readable
 * copy of that contract.
 */

export const CAPABILITIES = [
  // Read
  "dashboard.view.ops",
  "dashboard.view.finance",
  "audit.view",

  // Services
  "job.view",
  "job.create",
  "job.edit",
  "job.advanceStatus",
  "job.recordPayment",
  "worklog.viewAll",
  "worklog.viewOwn",
  "worklog.create",

  // Products
  "project.view",
  "project.create",
  "project.edit",
  "estimate.view",
  "estimate.create",
  "estimate.edit",
  "estimate.sendForReview",
  "estimate.approve",

  // Inventory & tools
  "inventory.view",
  "inventory.edit",
  "tool.request",
  "tool.issue",

  // Procurement
  "supplier.view",
  "supplier.edit",
  "purchase.view",
  "purchase.create",
  "purchase.receive",
  /** Supplier/brand scorecards, includes spend, so admin-only. */
  "procurement.viewPerformance",

  // People
  "customer.view",
  "customer.edit",
  "staff.view",
  "staff.edit",
  "user.manage",
  "settings.change",

  // Money, finance-sensitive
  "invoice.view",
  "invoice.create",
  "invoice.markPaid",
  "expense.view",
  "expense.create",
  "wage.viewRates",
  "wage.editRates",
  "wage.run",
  "wage.approve",
  "loan.request",
  "loan.approve",

  // Destructive
  "record.delete",
] as const;

export type Capability = (typeof CAPABILITIES)[number];

/**
 * Manager covers day-to-day operations but is deliberately excluded from:
 * marking invoices paid, wage rates, running/approving payroll, approving
 * loans, company-wide finance figures, user management and deletion.
 */
const MANAGER_CAPABILITIES: Capability[] = [
  "dashboard.view.ops",
  "job.view",
  "job.create",
  "job.edit",
  "job.advanceStatus",
  "job.recordPayment",
  "worklog.viewAll",
  "worklog.viewOwn",
  "worklog.create",
  "project.view",
  "project.create",
  "project.edit",
  "estimate.view",
  "estimate.create",
  "estimate.edit",
  "estimate.sendForReview",
  "inventory.view",
  "inventory.edit",
  "tool.request",
  "tool.issue",
  // Managers place and receive orders; the spend scorecard stays admin-only.
  "supplier.view",
  "supplier.edit",
  "purchase.view",
  "purchase.create",
  "purchase.receive",
  "customer.view",
  "customer.edit",
  "staff.view",
  "invoice.view",
  "invoice.create",
  "expense.view",
  "expense.create",
  "loan.request",
];

/** Operators only see and log their own work. */
const OPERATOR_CAPABILITIES: Capability[] = [
  "worklog.viewOwn",
  "worklog.create",
  "job.view",
  "tool.request",
  "loan.request",
];

const ROLE_CAPABILITIES: Record<Role, readonly Capability[]> = {
  // Admin holds every capability by definition; listing them would drift.
  admin: CAPABILITIES,
  manager: MANAGER_CAPABILITIES,
  operator: OPERATOR_CAPABILITIES,
};

/** True when `role` holds `capability`. */
export function can(role: Role | null | undefined, capability: Capability): boolean {
  if (!role) return false;
  return ROLE_CAPABILITIES[role].includes(capability);
}

/** True when `role` holds every one of `capabilities`. */
export function canAll(role: Role | null | undefined, capabilities: Capability[]): boolean {
  return capabilities.every((c) => can(role, c));
}

/** True when `role` holds at least one of `capabilities`. */
export function canAny(role: Role | null | undefined, capabilities: Capability[]): boolean {
  return capabilities.some((c) => can(role, c));
}

/** Full capability list for a role, used by the settings screen. */
export function capabilitiesFor(role: Role): readonly Capability[] {
  return ROLE_CAPABILITIES[role];
}

/**
 * Capabilities that must never be granted to a non-admin, mirrored in
 * `firestore.rules` and the Cloud Functions. Kept explicit so a future edit to
 * MANAGER_CAPABILITIES that accidentally adds one of these is caught by a test.
 */
export const ADMIN_ONLY_CAPABILITIES: Capability[] = [
  "dashboard.view.finance",
  "audit.view",
  "procurement.viewPerformance",
  "invoice.markPaid",
  "wage.viewRates",
  "wage.editRates",
  "wage.run",
  "wage.approve",
  "loan.approve",
  "estimate.approve",
  "staff.edit",
  "user.manage",
  "settings.change",
  "record.delete",
];

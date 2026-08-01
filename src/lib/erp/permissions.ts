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
 * Manager runs the workshop floor: the jobs coming through, the projects quoted
 * for, and the stock and tools that feed both.
 *
 * Deliberately narrow. Everything to do with money the business receives or pays
 * out — invoices, expenses, meters, payroll, loans — belongs to the admin, as does
 * the website, the staff directory and anything that changes how the system itself
 * behaves. A manager opening a screen they have no business in is worse than not
 * seeing it: the sidebar hides a group once every entry in it is denied, so the
 * shape of this list is the shape of their portal.
 *
 * This is the *default*. An admin can widen or narrow it per role in
 * Settings → Roles, and those overrides win — except for ADMIN_ONLY_CAPABILITIES
 * below, which the rules deny regardless of what is saved.
 */
const MANAGER_CAPABILITIES: Capability[] = [
  "dashboard.view.ops",
  // Service jobs, end to end.
  "job.view",
  "job.create",
  "job.edit",
  "job.advanceStatus",
  "job.recordPayment",
  // The work log is how a job's labour is recorded, so a manager logging work for
  // the floor needs both halves of it.
  "worklog.viewAll",
  "worklog.viewOwn",
  "worklog.create",
  // Projects and the estimate built from them. Approving an estimate stays admin:
  // that is the moment a figure becomes the contract value.
  "project.view",
  "project.create",
  "project.edit",
  "estimate.view",
  "estimate.create",
  "estimate.edit",
  "estimate.sendForReview",
  // Stock and tools.
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
  // Customers are needed to raise a job or a project against someone. Kept at
  // view: editing the directory is admin's, and customer.edit also gates the
  // website screens, which a manager has no part in.
  "customer.view",
  // Staff names, to log work against them. Not staff.edit.
  "staff.view",
];

/**
 * Operators log their own work and nothing else.
 *
 * One screen, one purpose: the work log form that feeds their wage calculation.
 * They reach it through a code rather than the admin sign-in, and land on the form
 * itself with no navigation, so this list exists to authorise that one screen
 * rather than to build a menu.
 */
const OPERATOR_CAPABILITIES: Capability[] = ["worklog.viewOwn", "worklog.create"];

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

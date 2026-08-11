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
  /** HR records, letters and ID cards. Separate from staff.edit, which is pay-facing. */
  "hr.manage",
  "user.manage",
  "settings.change",

  /*
   * Approvals.
   *
   * `approval.request` is held by anyone who can reach a delete button — it is the
   * ability to *ask*. `approval.decide` is the gate, and giving it to the same person who
   * raised the request defeats the workflow, which is why they are separate capabilities
   * rather than one.
   */
  "approval.request",
  "approval.decide",

  // Money, finance-sensitive
  "invoice.view",
  "invoice.create",
  "invoice.edit",
  "invoice.markPaid",
  "invoice.void",
  "expense.view",
  "expense.create",
  /** Counter sales. Selling is routine; voiding a completed sale is not. */
  "sale.view",
  "sale.create",
  "sale.void",
  /** Company-wide profit and loss, so admin-level by default. */
  "profit.view",
  "wage.viewRates",
  "wage.editRates",
  "wage.run",
  "wage.approve",
  /** Deductions reduce someone's pay, so raising one is its own permission. */
  "deduction.create",
  "loan.request",
  "loan.approve",

  /** Marking days the workshop was shut, which affects absence and payroll. */
  "holiday.manage",

  /*
   * Marketing.
   *
   * Split three ways because three different people touch it. A marketer *records* — visits,
   * leads, follow-ups, quotation requests — and that is the bulk of the daily traffic.
   * `marketing.view` reads the pipeline without adding to it, which is what the office needs
   * to answer a quotation request. `marketing.manage` is the supervisor's half: setting the
   * daily targets and closing a lead as won or lost, both of which are judgements about
   * someone else's work rather than a record of your own.
   */
  "marketing.view",
  "marketing.record",
  "marketing.manage",

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
  /*
   * The counter.
   *
   * Selling over the counter is exactly the manager's job — it is the shop floor,
   * and an admin is not standing at it. Voiding a completed sale is not: that
   * reverses stock and takings after the fact, so it stays with the admin along
   * with everything else that can rewrite what money did.
   */
  "sale.view",
  "sale.create",
  /*
   * Raising a deduction, but not approving the run that applies it.
   *
   * A no-show or a penalty is observed on the floor by whoever was there, and a
   * deduction nobody can record until the admin is available is one that gets
   * forgotten. The safeguard is that it only ever *proposes* the reduction — the
   * wage run that consumes it still needs wage.approve.
   */
  "deduction.create",
  /*
   * Marketing, in full.
   *
   * The whole module is floor work — a marketer walks sites and a manager runs the marketer.
   * Nothing in it moves money, so there is no reason to hold any of it back: the worst a
   * wrong entry does is misstate how many sites were walked, and the audit log says who
   * wrote it. `marketing.manage` is included because setting the daily targets and calling a
   * lead won or lost is exactly the manager's judgement, not the admin's.
   */
  "marketing.view",
  "marketing.record",
  "marketing.manage",
  // Customers are needed to raise a job or a project against someone. Kept at
  // view: editing the directory is admin's, and customer.edit also gates the
  // website screens, which a manager has no part in.
  "customer.view",
  // Staff names, to log work against them. Not staff.edit.
  "staff.view",
  /*
   * Asking to delete or change something, but never deciding it.
   *
   * A manager needs a working delete button — a record entered against the wrong customer
   * has to be fixable by whoever noticed. What they get is a request with a reason
   * attached; `approval.decide` stays with the admin, because a workflow where the
   * requester approves their own request is not a workflow.
   */
  "approval.request",
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
 * Capabilities no override can grant, mirrored in `firestore.rules` and the
 * Cloud Functions.
 *
 * Only two, and both for the same reason: each is a route to taking away an
 * admin's own access. `user.manage` can change roles, including demoting the last
 * administrator; `settings.change` can edit the very document that stores these
 * grants. A system where a mis-grant leaves nobody able to administer it has no
 * way back except editing Firestore by hand.
 *
 * Everything else is the admin's to give. Approving payroll, setting wage rates,
 * marking invoices paid, approving loans and estimates, deleting records, editing
 * staff, reading the audit log and seeing company finance figures were all locked
 * here before, which meant a workshop large enough to have a payroll clerk or a
 * bookkeeper had to make that person a full administrator. Those are now grantable
 * per role, and the rules honour the grant rather than denying it behind the
 * checkbox.
 *
 * Kept explicit so a future edit to MANAGER_CAPABILITIES that accidentally adds
 * one of these is caught by a test.
 */
export const ADMIN_ONLY_CAPABILITIES: Capability[] = [
  "user.manage",
  "settings.change",
];

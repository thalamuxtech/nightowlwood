import type { Capability } from "./permissions";

/**
 * Capabilities grouped for the permissions editor.
 *
 * The raw capability list is flat and dotted (`invoice.markPaid`), which is
 * right for code but unreadable as a settings screen. These groups and labels
 * exist only for presentation, `permissions.ts` remains the source of truth
 * for what a capability *is*.
 */

export interface CapabilityMeta {
  capability: Capability;
  label: string;
  /** Shown when the setting has a consequence worth stating outright. */
  hint?: string;
  /** Admin-only by design; rendered locked in the editor. */
  adminOnly?: boolean;
}

export interface CapabilityGroup {
  key: string;
  title: string;
  capabilities: CapabilityMeta[];
}

export const CAPABILITY_GROUPS: CapabilityGroup[] = [
  {
    key: "services",
    title: "Service jobs",
    capabilities: [
      { capability: "job.view", label: "View jobs" },
      { capability: "job.create", label: "Create jobs" },
      { capability: "job.edit", label: "Edit jobs" },
      { capability: "job.advanceStatus", label: "Move jobs through the pipeline" },
      {
        capability: "job.recordPayment",
        label: "Record customer payments",
        hint: "Adds to payment history; does not mark an invoice paid.",
      },
      { capability: "worklog.viewOwn", label: "View own work logs" },
      { capability: "worklog.viewAll", label: "View everyone's work logs" },
      { capability: "worklog.create", label: "Log work" },
    ],
  },
  {
    key: "products",
    title: "Projects & estimates",
    capabilities: [
      { capability: "project.view", label: "View projects" },
      { capability: "project.create", label: "Create projects" },
      { capability: "project.edit", label: "Edit projects" },
      { capability: "estimate.view", label: "View estimates" },
      { capability: "estimate.create", label: "Create estimates" },
      { capability: "estimate.edit", label: "Edit estimates" },
      { capability: "estimate.sendForReview", label: "Send an estimate for external review" },
      {
        capability: "estimate.approve",
        label: "Approve an estimate",
        hint: "Fixes the agreed price for the project.",
        adminOnly: true,
      },
    ],
  },
  {
    key: "inventory",
    title: "Inventory, tools & purchasing",
    capabilities: [
      { capability: "inventory.view", label: "View inventory" },
      { capability: "inventory.edit", label: "Adjust stock" },
      { capability: "tool.request", label: "Request tools" },
      { capability: "tool.issue", label: "Issue and receive tools" },
      { capability: "supplier.view", label: "View suppliers" },
      { capability: "supplier.edit", label: "Edit suppliers" },
      { capability: "purchase.view", label: "View purchases" },
      { capability: "purchase.create", label: "Raise purchase orders" },
      { capability: "purchase.receive", label: "Receive deliveries" },
      {
        capability: "procurement.viewPerformance",
        label: "Supplier & brand scorecards",
        hint: "Includes total spend per supplier.",
        adminOnly: true,
      },
    ],
  },
  {
    key: "people",
    title: "People",
    capabilities: [
      { capability: "customer.view", label: "View customers" },
      { capability: "customer.edit", label: "Add and edit customers" },
      { capability: "staff.view", label: "View staff" },
      { capability: "staff.edit", label: "Edit staff records", adminOnly: true },
      {
        capability: "user.manage",
        label: "Manage users and roles",
        hint: "Can grant anyone any level of access.",
        adminOnly: true,
      },
    ],
  },
  {
    key: "money",
    title: "Money",
    capabilities: [
      { capability: "invoice.view", label: "View invoices" },
      { capability: "invoice.create", label: "Create invoices" },
      {
        capability: "invoice.markPaid",
        label: "Mark an invoice paid",
        hint: "Settles a debt in the books. Admin only by design.",
        adminOnly: true,
      },
      { capability: "expense.view", label: "View expenses" },
      { capability: "expense.create", label: "Record expenses" },
      {
        capability: "dashboard.view.finance",
        label: "Company finances & P&L",
        adminOnly: true,
      },
    ],
  },
  {
    key: "payroll",
    title: "Payroll",
    capabilities: [
      { capability: "wage.viewRates", label: "View wage rates", adminOnly: true },
      { capability: "wage.editRates", label: "Change wage rates", adminOnly: true },
      { capability: "wage.run", label: "Generate a wage run", adminOnly: true },
      { capability: "wage.approve", label: "Approve and pay wages", adminOnly: true },
      { capability: "loan.request", label: "Request a loan or advance" },
      { capability: "loan.approve", label: "Approve loans and advances", adminOnly: true },
    ],
  },
  {
    key: "system",
    title: "System",
    capabilities: [
      { capability: "dashboard.view.ops", label: "Operations dashboard" },
      { capability: "settings.change", label: "Change settings", adminOnly: true },
      { capability: "audit.view", label: "View the audit log", adminOnly: true },
      {
        capability: "record.delete",
        label: "Delete records",
        hint: "Permanent. Admin only by design.",
        adminOnly: true,
      },
    ],
  },
];

/** Flat lookup for labels, used outside the grouped editor. */
export const CAPABILITY_LABELS: Record<string, string> = Object.fromEntries(
  CAPABILITY_GROUPS.flatMap((g) => g.capabilities.map((c) => [c.capability, c.label]))
);

/**
 * Capabilities that cannot be granted to a non-admin role from the editor.
 *
 * Mirrors ADMIN_ONLY_CAPABILITIES in permissions.ts. Kept here as a derived
 * list so the editor and the enforcement layer cannot drift apart silently.
 */
export const LOCKED_CAPABILITIES: Capability[] = CAPABILITY_GROUPS.flatMap((g) =>
  g.capabilities.filter((c) => c.adminOnly).map((c) => c.capability)
);

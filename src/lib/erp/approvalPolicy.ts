import { doc, getDoc, setDoc, serverTimestamp, type Firestore } from "firebase/firestore";
import { COL } from "./collections";
import { writeAudit, type AuditActor } from "./audit";

/**
 * Which operations need a second pair of eyes, and who provides them.
 *
 * Configurable rather than hardcoded because where the line sits is a judgement about *this*
 * workshop, not a fact about the software. A one-admin business that gates every deletion ends
 * up rubber-stamping its own inbox, which is worse than no gate at all — the trail then claims
 * scrutiny that did not happen. A business with two supervisors can afford to gate more.
 *
 * Owned by the super admin alone. An admin able to edit this could clear the requirement on
 * their own next deletion, which would make the whole workflow decorative.
 */

/** Operations that can be put behind approval, in the order the settings screen lists them. */
export const APPROVAL_OPERATIONS = [
  "workLog.delete",
  "wageRun.delete",
  "salaryRun.delete",
  "jobPayment.delete",
  "invoice.delete",
  "expense.delete",
  "supplier.delete",
  "inventoryItem.delete",
  "project.delete",
  "estimate.editApproved",
] as const;

export type ApprovalOperation = (typeof APPROVAL_OPERATIONS)[number];

export const APPROVAL_OPERATION_LABELS: Record<ApprovalOperation, string> = {
  "workLog.delete": "Deleting a work log",
  "wageRun.delete": "Deleting a wage run",
  "salaryRun.delete": "Deleting a salary run",
  "jobPayment.delete": "Deleting a recorded payment",
  "invoice.delete": "Deleting an invoice",
  "expense.delete": "Deleting an expense",
  "supplier.delete": "Deleting a supplier",
  "inventoryItem.delete": "Deleting a stock item",
  "project.delete": "Deleting a project",
  "estimate.editApproved": "Editing an approved estimate",
};

/** Why each one might be worth gating, shown beside the switch. */
export const APPROVAL_OPERATION_HINTS: Record<ApprovalOperation, string> = {
  "workLog.delete": "This is what the wage run reads, so removing it changes what somebody is paid.",
  "wageRun.delete": "A run holds a period's pay and the deductions applied to it.",
  "salaryRun.delete": "The monthly counterpart to a wage run.",
  "jobPayment.delete": "Money the customer handed over. Removing it makes them owe it again.",
  "invoice.delete": "The customer may already be holding this document.",
  "expense.delete": "Changes the period's profit after it may have been reported.",
  "supplier.delete": "Loses the lead-time and defect history built up against them.",
  "inventoryItem.delete": "Loses the movement history and the average cost behind it.",
  "project.delete": "Takes its components, features and purchases with it.",
  "estimate.editApproved": "The contract value was agreed at the figure being changed.",
};

export interface ApprovalPolicy {
  /**
   * Operations requiring approval even from someone who could otherwise act directly.
   *
   * Stored as a list rather than a map of booleans so the document says what is *on* and
   * nothing else — a false entry and a missing entry mean the same thing, and keeping both
   * shapes would invite them to disagree.
   */
  required: ApprovalOperation[];
  /**
   * True when only the super admin may decide requests.
   *
   * The alternative is that anybody holding `approval.decide` may. Defaults to false, which
   * matches how the module behaved before this setting existed.
   */
  superAdminDecidesOnly: boolean;
}

/**
 * Nothing gated, decisions open to whoever holds `approval.decide`.
 *
 * Deliberately empty rather than a sensible-looking preset: turning a gate on is a decision
 * somebody should make on purpose, and a default that quietly blocked deletions would look
 * like a bug to a workshop that never chose it. The settings screen recommends where to start.
 */
export const DEFAULT_APPROVAL_POLICY: ApprovalPolicy = {
  required: [],
  superAdminDecidesOnly: false,
};

const POLICY_DOC = "approvals";

/** Reads the policy, falling back to the default when unset or unreadable. */
export async function loadApprovalPolicy(db: Firestore): Promise<ApprovalPolicy> {
  try {
    const snap = await getDoc(doc(db, COL.settings, POLICY_DOC));
    if (!snap.exists()) return DEFAULT_APPROVAL_POLICY;
    const x = snap.data();
    const stored = Array.isArray(x.required) ? (x.required as string[]) : [];
    return {
      // Filtered against the known list, so an operation removed from the code does not
      // resurface as an unrecognised string that gates nothing but reads as though it does.
      required: stored.filter((s): s is ApprovalOperation =>
        (APPROVAL_OPERATIONS as readonly string[]).includes(s)
      ),
      superAdminDecidesOnly: x.superAdminDecidesOnly === true,
    };
  } catch {
    /*
     * A read failure means no gate rather than every gate.
     *
     * The opposite would be safer in the abstract but wrong in practice: it would block the
     * whole workshop's deletions on a transient error, and the direct-delete capability check
     * is still enforced by the rules underneath. Failing open here loses a second opinion;
     * failing closed loses the day's work.
     */
    return DEFAULT_APPROVAL_POLICY;
  }
}

/** True when `operation` needs a decision even from someone who could act directly. */
export function requiresApproval(
  policy: ApprovalPolicy,
  operation: ApprovalOperation | undefined
): boolean {
  if (!operation) return false;
  return policy.required.includes(operation);
}

export async function saveApprovalPolicy(
  db: Firestore,
  actor: AuditActor,
  policy: ApprovalPolicy
): Promise<void> {
  const clean: ApprovalPolicy = {
    required: APPROVAL_OPERATIONS.filter((o) => policy.required.includes(o)),
    superAdminDecidesOnly: policy.superAdminDecidesOnly === true,
  };

  await setDoc(
    doc(db, COL.settings, POLICY_DOC),
    { ...clean, updatedAt: serverTimestamp(), updatedBy: actor.uid },
    { merge: true }
  );

  await writeAudit(db, {
    actor,
    action: "update",
    collectionName: COL.settings,
    docId: POLICY_DOC,
    summary:
      `Approval policy: ${clean.required.length} operation(s) require approval` +
      `${clean.superAdminDecidesOnly ? ", decided by the super admin only" : ""}`,
    // Spread into a plain record: the audit payload is index-signed, and listing the gated
    // operations by name is what makes a later "why was this blocked in March" answerable.
    after: {
      required: clean.required.join(", ") || "(none)",
      superAdminDecidesOnly: clean.superAdminDecidesOnly,
    },
  });
}

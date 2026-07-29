import { addDoc, collection, serverTimestamp, type Firestore } from "firebase/firestore";
import { COL } from "./collections";
import type { Role } from "./enums";

/**
 * Append-only audit trail.
 *
 * The legacy spreadsheets had no record of who entered or changed anything,
 * which makes a payroll or invoice dispute unresolvable. Every mutation to
 * money, payroll, stock or status writes an entry here. Firestore rules allow
 * create but never update or delete, so the trail cannot be rewritten, not
 * even by an admin.
 */

export interface AuditActor {
  uid: string;
  email: string;
  role: Role;
}

/** Verb-noun action names, so the log reads as a sentence. */
export type AuditAction =
  | "create"
  | "update"
  | "delete"
  | "status_change"
  | "payment_record"
  | "invoice_issue"
  | "invoice_mark_paid"
  | "invoice_void"
  | "wage_rate_change"
  | "wage_run_generate"
  | "wage_run_approve"
  | "wage_run_pay"
  | "loan_request"
  | "loan_approve"
  | "loan_reject"
  | "loan_disburse"
  | "inventory_movement"
  | "tool_issue"
  | "tool_return"
  | "purchase_receive"
  | "estimate_send_review"
  | "estimate_review_submit"
  | "estimate_approve"
  | "role_change"
  | "user_deactivate"
  | "settings_change"
  | "login";

export interface WriteAuditInput {
  actor: AuditActor;
  action: AuditAction;
  collectionName: string;
  docId: string;
  /** One-line human summary, e.g. "Marked INV-2026-0007 paid (₦57,450)". */
  summary?: string;
  before?: Record<string, unknown>;
  after?: Record<string, unknown>;
}

/** Fields never copied into the audit log. */
const REDACT_KEYS = new Set([
  "reviewTokenHash",
  "reviewPasscodeHash",
  "password",
  "bankAccount",
  "bankAccountNumber",
]);

/**
 * Strips undefined (Firestore rejects it), drops secrets, and truncates long
 * strings so a pasted note can't bloat every log entry.
 */
function sanitise(value: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  if (!value) return undefined;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value)) {
    if (v === undefined) continue;
    if (REDACT_KEYS.has(k)) {
      out[k] = "[redacted]";
      continue;
    }
    out[k] = typeof v === "string" && v.length > 300 ? `${v.slice(0, 300)}…` : v;
  }
  return out;
}

/**
 * Writes an audit entry.
 *
 * Deliberately never throws: an audit failure must not roll back the business
 * action that succeeded. Failures are reported to the console for follow-up.
 */
export async function writeAudit(db: Firestore, input: WriteAuditInput): Promise<void> {
  try {
    await addDoc(collection(db, COL.auditLog), {
      actorUid: input.actor.uid,
      actorEmail: input.actor.email,
      actorRole: input.actor.role,
      action: input.action,
      collectionName: input.collectionName,
      docId: input.docId,
      summary: input.summary ?? null,
      before: sanitise(input.before) ?? null,
      after: sanitise(input.after) ?? null,
      at: serverTimestamp(),
    });
  } catch (err) {
    console.error("[audit] failed to write entry", input.action, input.docId, err);
  }
}

/**
 * Shallow diff of the fields that actually changed, for a compact `update`
 * entry. Storing whole documents makes the log unreadable and expensive.
 */
export function diffFields(
  before: Record<string, unknown>,
  after: Record<string, unknown>
): { before: Record<string, unknown>; after: Record<string, unknown> } {
  const b: Record<string, unknown> = {};
  const a: Record<string, unknown> = {};
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  for (const k of keys) {
    if (JSON.stringify(before[k]) !== JSON.stringify(after[k])) {
      b[k] = before[k];
      a[k] = after[k];
    }
  }
  return { before: b, after: a };
}

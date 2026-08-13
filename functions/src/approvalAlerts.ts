import { getFirestore } from "firebase-admin/firestore";
import { onDocumentUpdated } from "firebase-functions/v2/firestore";
import { defineSecret } from "firebase-functions/params";
import { BrevoMailer, ConsoleMailer, type Mailer } from "./mailer";
import {
  calloutBox,
  detailTable,
  paragraph,
  renderEmail,
  type CompanyDetails,
} from "./emailTemplate";

/**
 * Emails the administrators when an approval request is decided.
 *
 * The requirement is explicit and stated twice in the brief: "An email notification is sent to the
 * administrator for every approved change." The audit log already records every decision, but a log
 * is something you have to think to go and read — and the whole point of routing deletions through
 * an approval is that somebody outside the transaction learns about it.
 *
 * ## Why a Firestore trigger rather than a call from the client
 *
 * The approval itself is written by the admin's browser (`approveRequest` in `approvals.ts`). If the
 * email were sent from there, a decision made with a flaky connection, or by someone who closed the
 * tab, would be a decision nobody was told about — and the client would need mail credentials. A
 * trigger fires from the write itself, so the notification is a consequence of the record existing
 * rather than of the browser completing a second step.
 *
 * ## Why it never throws
 *
 * A failed send must not retry the trigger indefinitely nor look like a failed approval. The
 * decision has already been committed; mail is a courtesy on top of it. Everything is caught and
 * logged, and `sentAt` is stamped on the request so a retry cannot double-send.
 */

const BREVO_API_KEY = defineSecret("BREVO_API_KEY");
const REGION = "europe-west1";
const SENDER = { email: "info@nightowl.com.ng", name: "Nightowl Woodworks" };

const FALLBACK_COMPANY: CompanyDetails = {
  name: "Nightowl Woodworks Ltd",
  tagline: "Precision in Every Cut",
  email: "info@nightowl.com.ng",
  website: "nightowl.com.ng",
};

function mailer(): Mailer {
  const key = BREVO_API_KEY.value();
  return key ? new BrevoMailer(key, SENDER) : new ConsoleMailer();
}

async function companyDetails(): Promise<CompanyDetails> {
  try {
    const snap = await getFirestore().doc("settings/company").get();
    if (!snap.exists) return FALLBACK_COMPANY;
    const d = snap.data() ?? {};
    return {
      name: d.name ?? FALLBACK_COMPANY.name,
      tagline: d.tagline ?? FALLBACK_COMPANY.tagline,
      email: d.email ?? FALLBACK_COMPANY.email,
      phone: d.phone || undefined,
      website: d.website || undefined,
      address: d.address || undefined,
    };
  } catch {
    return FALLBACK_COMPANY;
  }
}

/**
 * Every active administrator's email address.
 *
 * Read from `users` rather than a configured list, so adding an administrator is enough — a
 * hard-coded recipient is one that keeps mailing somebody who left. Falls back to the company
 * address if no admin has a usable email, because a notification nobody receives is the failure
 * this function exists to prevent.
 */
async function adminRecipients(): Promise<string[]> {
  const out = new Set<string>();
  try {
    const snap = await getFirestore()
      .collection("users")
      .where("role", "==", "admin")
      .get();
    for (const doc of snap.docs) {
      const email = doc.data().email;
      if (doc.data().active === false) continue;
      if (typeof email === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        out.add(email);
      }
    }
  } catch {
    // Falls through to the company address below.
  }
  if (out.size === 0) out.add(FALLBACK_COMPANY.email);
  return [...out];
}

/** Formats a stored value for the change table. Objects are shown as compact JSON. */
function describe(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "string") return value.length > 200 ? `${value.slice(0, 200)}…` : value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  try {
    const json = JSON.stringify(value);
    return json.length > 400 ? `${json.slice(0, 400)}…` : json;
  } catch {
    return "(not printable)";
  }
}

export const notifyApprovalDecision = onDocumentUpdated(
  {
    document: "approvals/{approvalId}",
    region: REGION,
    secrets: [BREVO_API_KEY],
    // One retry at most: a transient Brevo outage is worth one more attempt, an invalid key is not
    // worth hundreds. `sentAt` below is what makes the retry safe.
    retry: false,
  },
  async (event) => {
    const before = event.data?.before.data();
    const after = event.data?.after.data();
    if (!before || !after) return;

    /*
     * Only the moment of decision.
     *
     * `pending → approved | rejected` is the transition worth an email. Anything else — a lock being
     * cleared, a note edited, the request being cancelled by whoever raised it — is noise, and a
     * function that mails on every write to the document would train people to filter it.
     */
    const decided = after.status === "approved" || after.status === "rejected";
    if (!decided || before.status === after.status) return;

    // Already notified: a retry, or a second write that did not change the status.
    if (after.notifiedAt) return;

    try {
      const [company, to] = await Promise.all([companyDetails(), adminRecipients()]);

      const approved = after.status === "approved";
      const action = String(after.action ?? "change");
      const target = `${after.collectionName ?? "record"}/${after.docId ?? "?"}`;

      const rows: Array<[string, string]> = [
        ["Decision", approved ? "Approved" : "Rejected"],
        ["What", `${action} on ${target}`],
        ["Summary", describe(after.summary)],
        ["Requested by", describe(after.requestedByEmail ?? after.requestedByUid)],
        ["Reason given", describe(after.reason)],
        ["Decided by", describe(after.decidedByEmail ?? after.decidedByUid)],
      ];
      if (after.decisionNote) rows.push(["Decision note", describe(after.decisionNote)]);

      /*
       * The before/after values, when the request carried them.
       *
       * This is the half a log entry usually loses: an approved edit that says only "updated the
       * invoice" cannot be checked, whereas one that shows 45,000 became 145,000 can. Included only
       * when present, since a deletion has a before and no after.
       */
      const changeRows: Array<[string, string]> = [];
      if (after.before !== undefined && after.before !== null) {
        changeRows.push(["Was", describe(after.before)]);
      }
      if (after.after !== undefined && after.after !== null) {
        changeRows.push(["Now", describe(after.after)]);
      }

      const html = renderEmail({
        company,
        eyebrow: "Approval decided",
        heading: approved
          ? `Approved: ${action} on ${target}`
          : `Rejected: ${action} on ${target}`,
        body:
          paragraph(
            approved
              ? "The change below was approved and has been applied. This message is the record that it happened."
              : "The change below was requested and refused. Nothing was applied."
          ) +
          detailTable(rows) +
          (changeRows.length > 0 ? detailTable(changeRows) : "") +
          (approved
            ? calloutBox(
                "If this was not expected, the audit log holds the full entry with its timestamp."
              )
            : ""),
        footerNote: "Sent automatically by the Nightowl admin backend.",
      });

      const result = await mailer().send({
        to: to.map((email) => ({ email })),
        subject: `${approved ? "Approved" : "Rejected"}: ${action} on ${target}`,
        html,
        replyTo: { email: company.email, name: company.name },
        tags: ["approval-decision"],
      });

      /*
       * Stamped whatever the outcome.
       *
       * On success it stops a duplicate. On failure it stops a retry loop from mailing repeatedly
       * once delivery recovers — the decision is in the audit log either way, and `notifyError`
       * records why nobody was told.
       */
      await event.data!.after.ref.update({
        notifiedAt: new Date(),
        notifiedTo: to,
        notifyError: result.ok ? null : (result.error ?? "Send failed."),
      });
    } catch (err) {
      // Never rethrown: the approval itself is committed, and a failed courtesy email must not
      // present as a failed approval or spin the trigger.
      console.error("notifyApprovalDecision failed", err);
      try {
        await event.data!.after.ref.update({
          notifiedAt: new Date(),
          notifyError: err instanceof Error ? err.message : "Unknown error.",
        });
      } catch {
        /* nothing further to do */
      }
    }
  }
);

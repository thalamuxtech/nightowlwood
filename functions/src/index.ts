import { initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { defineSecret } from "firebase-functions/params";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { BrevoMailer, ConsoleMailer, type Mailer } from "./mailer";
import {
  calloutBox,
  detailTable,
  paragraph,
  renderEmail,
  type CompanyDetails,
} from "./emailTemplate";

initializeApp();

/**
 * Brevo API key, held in Secret Manager.
 *
 * Set it with:  firebase functions:secrets:set BREVO_API_KEY
 * The value is never in source, never in firebase.json, and never exposed to the
 * browser. Functions that need it declare it in `secrets`, so it is injected
 * only into those runtimes.
 */
const BREVO_API_KEY = defineSecret("BREVO_API_KEY");

/** Region close to Nigeria; also keeps latency predictable. */
const REGION = "europe-west1";

const FALLBACK_COMPANY: CompanyDetails = {
  name: "Nightowl Woodworks Ltd",
  tagline: "Precision in Every Cut",
  email: "info@nightowl.com.ng",
  website: "nightowl.com.ng",
};

/** Sender must be on a Brevo-authenticated domain, else Brevo rejects the send. */
const SENDER = { email: "info@nightowl.com.ng", name: "Nightowl Woodworks" };

function mailer(): Mailer {
  const key = BREVO_API_KEY.value();
  // No key configured (e.g. local emulator): log instead of failing, so the
  // rest of a flow can still be exercised.
  return key ? new BrevoMailer(key, SENDER) : new ConsoleMailer();
}

/** Loads company details from settings, falling back to the constants above. */
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
 * Resolves the caller's ERP role from `users/{uid}`.
 *
 * Authentication is not authorisation here: public signup is enabled on this
 * project, so a valid token proves only that someone has an account. The user
 * document is what grants staff access.
 */
async function requireRole(
  auth: { uid: string; token: { email?: string } } | undefined,
  allowed: Array<"admin" | "manager" | "operator">
): Promise<{ uid: string; email: string; role: "admin" | "manager" | "operator" }> {
  if (!auth) {
    throw new HttpsError("unauthenticated", "Sign in first.");
  }
  const snap = await getFirestore().doc(`users/${auth.uid}`).get();
  if (!snap.exists || snap.data()?.active === false) {
    throw new HttpsError("permission-denied", "This account is not active staff.");
  }
  const role = snap.data()?.role as "admin" | "manager" | "operator" | undefined;
  if (!role || !allowed.includes(role)) {
    throw new HttpsError("permission-denied", `Requires one of: ${allowed.join(", ")}.`);
  }
  return { uid: auth.uid, email: auth.token.email ?? snap.data()?.email ?? "", role };
}

function isEmail(value: unknown): value is string {
  return typeof value === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

// ---------------------------------------------------------------------------
// sendTestEmail, proves the Brevo path end to end
// ---------------------------------------------------------------------------

/**
 * Sends a branded test email. Admin only.
 *
 * Exists so the mail path can be verified independently of any business flow:
 * if this fails, the problem is credentials or DNS, not invoice code.
 */
/**
 * Builds the test email.
 *
 * Shared by the preview and the send so the two cannot drift: a preview that
 * renders different markup from what is delivered is worse than no preview.
 */
async function buildTestEmail(sentByEmail: string): Promise<{ subject: string; html: string }> {
  const company = await companyDetails();
  const sentAt = new Date().toLocaleString("en-GB", {
    timeZone: "Africa/Lagos",
    dateStyle: "full",
    timeStyle: "short",
  });

  const html = renderEmail({
    company,
    eyebrow: "System test",
    heading: "Email delivery is working",
    body:
      paragraph(
        "This is a test message from the Nightowl admin backend. If you are reading it, transactional email is configured correctly."
      ) +
      detailTable([
        ["Sent by", sentByEmail],
        ["Sent at", sentAt],
        ["Sender domain", SENDER.email.split("@")[1] ?? ""],
      ]) +
      paragraph(
        "Invoices, estimate review links and stock alerts will use this same template."
      ) +
      calloutBox("No action needed, this is a test."),
    footerNote: "Sent from the Nightowl Woodworks admin dashboard.",
  });

  return { subject: "Nightowl Woodworks, email test", html };
}

/**
 * Returns the rendered email without sending it.
 *
 * Deliberately does not require the Brevo secret: a preview should work even
 * when the key is missing or rejected, so the template can be checked
 * independently of whether delivery is configured.
 */
export const previewTestEmail = onCall(
  { region: REGION, cors: true },
  async (request) => {
    const actor = await requireRole(request.auth, ["admin"]);
    const { subject, html } = await buildTestEmail(actor.email);
    return { subject, html };
  }
);

/**
 * Sends a branded test email. Admin only.
 *
 * Exists so the mail path can be verified independently of any business flow:
 * if this fails, the problem is credentials or DNS, not invoice code.
 */
export const sendTestEmail = onCall(
  { region: REGION, secrets: [BREVO_API_KEY], cors: true },
  async (request) => {
    const actor = await requireRole(request.auth, ["admin"]);

    const to = request.data?.to;
    if (!isEmail(to)) {
      throw new HttpsError("invalid-argument", "Provide a valid `to` email address.");
    }

    const company = await companyDetails();
    const { subject, html } = await buildTestEmail(actor.email);

    const result = await mailer().send({
      to: [{ email: to }],
      subject,
      html,
      replyTo: { email: company.email, name: company.name },
      tags: ["system-test"],
    });

    if (!result.ok) {
      // Surface the provider's own message: "sender not authenticated" and
      // "invalid key" need different fixes, and a generic error hides which.
      throw new HttpsError("internal", result.error ?? "Send failed.");
    }

    try {
      await getFirestore().collection("auditLog").add({
        actorUid: actor.uid,
        actorEmail: actor.email,
        actorRole: actor.role,
        action: "settings_change",
        collectionName: "system",
        docId: "email-test",
        summary: `Sent a test email to ${to}`,
        at: new Date(),
      });
    } catch {
      /* ignore */
    }

    return { ok: true, messageId: result.messageId ?? null };
  }
);

// ---------------------------------------------------------------------------
// getMailConfigStatus, diagnostics without revealing the key
// ---------------------------------------------------------------------------

/**
 * Reports whether the mail path is configured, and validates the key against
 * Brevo's account endpoint. Returns no secret material.
 */
export const getMailConfigStatus = onCall(
  { region: REGION, secrets: [BREVO_API_KEY], cors: true },
  async (request) => {
    await requireRole(request.auth, ["admin"]);

    const key = BREVO_API_KEY.value();
    if (!key) {
      return {
        configured: false,
        message: "BREVO_API_KEY is not set. Run: firebase functions:secrets:set BREVO_API_KEY",
      };
    }

    try {
      const res = await fetch("https://api.brevo.com/v3/account", {
        headers: { "api-key": key, accept: "application/json" },
      });
      if (!res.ok) {
        return {
          configured: true,
          valid: false,
          message: `Brevo rejected the key (HTTP ${res.status}).`,
        };
      }
      const account = (await res.json()) as {
        email?: string;
        companyName?: string;
        plan?: Array<{ credits?: number; type?: string }>;
      };
      return {
        configured: true,
        valid: true,
        accountEmail: account.email ?? null,
        companyName: account.companyName ?? null,
        senderDomain: SENDER.email.split("@")[1] ?? null,
      };
    } catch (err) {
      return {
        configured: true,
        valid: false,
        message: err instanceof Error ? err.message : "Could not reach Brevo.",
      };
    }
  }
);

// ---------------------------------------------------------------------------
// External estimate review
// ---------------------------------------------------------------------------

// Re-exported so the review callables deploy with the rest of the codebase.
export {
  sendEstimateForReview,
  openEstimateReview,
  submitEstimateReview,
} from "./estimateReview";

// ---------------------------------------------------------------------------
// Invoice settlement
// ---------------------------------------------------------------------------

// Admin-only, and deliberately server-side: see invoicePayment.ts.
export { markInvoicePaid } from "./invoicePayment";

// ---------------------------------------------------------------------------
// Invoice documents
// ---------------------------------------------------------------------------

// Rendered server-side so the emailed PDF and the downloaded one are the same
// bytes from the same code path. See invoiceDocument.ts.
export { getInvoicePdf, emailInvoice } from "./invoiceDocument";

// ---------------------------------------------------------------------------
// Estimate documents
// ---------------------------------------------------------------------------

// Same server-side pdfkit path as the invoice, for the same reason: one renderer
// behind both the download and the emailed attachment. See estimateDocument.ts.
export { getEstimatePdf, emailEstimate } from "./estimateDocument";

// ---------------------------------------------------------------------------
// Operator access codes
// ---------------------------------------------------------------------------

// An operator reaches their work log with a short code rather than an email
// login. See operatorAccess.ts for why, and for what the code does and does not
// grant.
export {
  issueOperatorCode,
  revokeOperatorCode,
  redeemOperatorCode,
} from "./operatorAccess";

// ---------------------------------------------------------------------------
// Scheduled alerts
// ---------------------------------------------------------------------------

// One digest a morning, and nothing at all when there is nothing to report.
export { dailyOperationsDigest } from "./stockAlerts";

// ---------------------------------------------------------------------------
// Approval notifications
// ---------------------------------------------------------------------------

// "An email notification is sent to the administrator for every approved change" — stated twice in
// the brief. A Firestore trigger rather than a client call, so the notification follows from the
// record existing rather than from a browser completing a second step. See approvalAlerts.ts.
export { notifyApprovalDecision } from "./approvalAlerts";

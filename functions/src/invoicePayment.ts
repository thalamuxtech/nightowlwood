import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { defineSecret } from "firebase-functions/params";
import { BrevoMailer, ConsoleMailer, type Mailer } from "./mailer";
import { requireCapability, type Actor } from "./capabilities";
import {
  detailTable,
  paragraph,
  renderEmail,
  totalRow,
  type CompanyDetails,
} from "./emailTemplate";

/**
 * Marking an invoice paid.
 *
 * This is the most abusable action in the system: it declares a debt settled, so
 * a manager who could reach it could write off money owed. It lives in a Cloud
 * Function rather than the client for two reasons beyond the Firestore rules.
 *
 * First, the role is re-read from `users/{uid}` on the server, so a forged client
 * bundle cannot claim to be an admin. Second, the write and its audit entry
 * happen in one place that cannot be skipped: a client-side path could update the
 * document and simply never write the audit record.
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
 * Re-reads the caller's standing server-side. A token alone proves nothing here.
 *
 * Admin, or a role an admin has granted `invoice.markPaid` to. The Firestore rules
 * honour that grant, so refusing it here would leave the checkbox in Settings
 * doing nothing for the one action it most plainly describes.
 */
async function requireAdmin(
  auth: { uid: string; token: { email?: string } } | undefined
): Promise<Actor> {
  return requireCapability(
    auth,
    "invoice.markPaid",
    "You do not have permission to mark an invoice paid."
  );
}

function formatNaira(kobo: number): string {
  return new Intl.NumberFormat("en-NG", {
    style: "currency",
    currency: "NGN",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(kobo / 100);
}

export const markInvoicePaid = onCall(
  { region: REGION, secrets: [BREVO_API_KEY], cors: true },
  async (request) => {
    const actor = await requireAdmin(request.auth);
    const db = getFirestore();

    const invoiceId = String(request.data?.invoiceId ?? "");
    const sendReceipt = request.data?.sendReceipt !== false;
    if (!invoiceId) throw new HttpsError("invalid-argument", "invoiceId is required.");

    const ref = db.doc(`invoices/${invoiceId}`);

    // Transactional so two admins clicking at once cannot both mark it paid and
    // write two receipts.
    const result = await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists) throw new HttpsError("not-found", "Invoice not found.");
      const inv = snap.data() ?? {};

      if (inv.status === "paid") {
        throw new HttpsError("failed-precondition", "This invoice is already marked paid.");
      }
      if (inv.status === "void") {
        throw new HttpsError("failed-precondition", "A void invoice cannot be marked paid.");
      }
      if (inv.status === "draft") {
        throw new HttpsError(
          "failed-precondition",
          "Issue the invoice before marking it paid."
        );
      }

      const total = inv.totalKobo ?? 0;
      const previouslyPaid = inv.amountPaidKobo ?? 0;

      tx.update(ref, {
        status: "paid",
        // Settling means the full amount is accounted for, so the paid figure is
        // brought up to the total rather than left short.
        amountPaidKobo: total,
        balanceKobo: 0,
        paidAt: FieldValue.serverTimestamp(),
        paidBy: actor.uid,
      });

      return {
        invoiceNumber: inv.invoiceNumber ?? "",
        customerName: inv.customerName ?? "",
        totalKobo: total,
        previouslyPaid,
        settledKobo: total - previouslyPaid,
        reference: inv.reference ?? null,
      };
    });

    await db.collection("auditLog").add({
      actorUid: actor.uid,
      actorEmail: actor.email,
      // The real role, not a hardcoded "admin": a manager granted invoice.markPaid
      // now reaches this, and the log has to say who actually did it.
      actorRole: actor.role,
      action: "invoice_mark_paid",
      collectionName: "invoices",
      docId: invoiceId,
      summary:
        `Marked ${result.invoiceNumber} paid: ${result.settledKobo} kobo settled, ` +
        `total ${result.totalKobo} kobo`,
      after: { status: "paid", amountPaidKobo: result.totalKobo, balanceKobo: 0 },
      at: FieldValue.serverTimestamp(),
    });

    // A receipt failure must not undo a payment that has been recorded, so it is
    // attempted after the write and never allowed to throw.
    let receiptSent = false;
    if (sendReceipt) {
      try {
        const invSnap = await ref.get();
        const email = invSnap.data()?.customerEmail as string | undefined;
        if (email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
          const company = await companyDetails();
          const html = renderEmail({
            company,
            eyebrow: "Receipt",
            heading: "Payment received, thank you",
            body:
              paragraph(
                `We have received payment in full for invoice ${result.invoiceNumber}.`
              ) +
              detailTable([
                ["Invoice", result.invoiceNumber],
                ...(result.reference ? [["Reference", String(result.reference)] as [string, string]] : []),
                ["Paid on", new Date().toLocaleDateString("en-GB", {
                  day: "numeric",
                  month: "long",
                  year: "numeric",
                })],
              ]) +
              totalRow("Amount paid", formatNaira(result.totalKobo)) +
              paragraph("Keep this email as your receipt."),
            footerNote: "No further payment is due on this invoice.",
          });
          const sent = await mailer().send({
            to: [{ email, name: result.customerName }],
            subject: `Receipt for ${result.invoiceNumber}`,
            html,
            replyTo: { email: company.email, name: company.name },
            tags: ["receipt"],
          });
          receiptSent = sent.ok;
        }
      } catch {
        /* Recorded payment stands regardless. */
      }
    }

    return {
      ok: true,
      invoiceNumber: result.invoiceNumber,
      settledKobo: result.settledKobo,
      receiptSent,
    };
  }
);

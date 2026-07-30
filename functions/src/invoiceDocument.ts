import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { defineSecret } from "firebase-functions/params";
import { BrevoMailer, ConsoleMailer, type Mailer } from "./mailer";
import {
  detailTable,
  paragraph,
  renderEmail,
  totalRow,
  type CompanyDetails,
} from "./emailTemplate";
import { renderInvoicePdf, type PdfCompany, type PdfInvoice } from "./invoicePdf";

/**
 * Invoice as a document: rendered to PDF, downloaded, or emailed to the customer.
 *
 * The PDF is generated on the server rather than in the browser so that the file
 * a customer receives by email and the file an admin downloads are byte-identical,
 * produced by one code path. A client-side generator would drift from whatever the
 * email attaches, and the invoice is the document most likely to be disputed.
 *
 * Reading an invoice is allowed for admin and manager, matching the invoice screen.
 * Emailing one is admin-only: it is outbound contact with a customer in the
 * company's name, and it states what they owe.
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

type Role = "admin" | "manager" | "operator";

async function requireRole(
  auth: { uid: string; token: { email?: string } } | undefined,
  allowed: Role[]
): Promise<{ uid: string; email: string; role: Role }> {
  if (!auth) throw new HttpsError("unauthenticated", "Sign in first.");
  const snap = await getFirestore().doc(`users/${auth.uid}`).get();
  if (!snap.exists || snap.data()?.active === false) {
    throw new HttpsError("permission-denied", "This account is not active staff.");
  }
  const role = snap.data()?.role as Role | undefined;
  if (!role || !allowed.includes(role)) {
    throw new HttpsError("permission-denied", `Requires one of: ${allowed.join(", ")}.`);
  }
  return { uid: auth.uid, email: auth.token.email ?? snap.data()?.email ?? "", role };
}

function isEmail(value: unknown): value is string {
  return typeof value === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

/** Company details, including the bank block the invoice needs to be payable. */
async function companyForPdf(): Promise<PdfCompany> {
  try {
    const snap = await getFirestore().doc("settings/company").get();
    const d = snap.exists ? (snap.data() ?? {}) : {};
    return {
      name: d.name ?? FALLBACK_COMPANY.name,
      tagline: d.tagline ?? FALLBACK_COMPANY.tagline,
      email: d.email ?? FALLBACK_COMPANY.email,
      phone: d.phone || undefined,
      website: d.website || undefined,
      address: d.address || undefined,
      rcNumber: d.rcNumber || undefined,
      bankName: d.bankName || undefined,
      bankAccountName: d.bankAccountName || undefined,
      bankAccountNumber: d.bankAccountNumber || undefined,
    };
  } catch {
    return { ...FALLBACK_COMPANY };
  }
}

const ms = (v: unknown): number | null => {
  const t = v as { toMillis?: () => number } | null | undefined;
  return typeof t?.toMillis === "function" ? t.toMillis() : null;
};

/**
 * Loads an invoice into the PDF's shape.
 *
 * Lines live on the invoice document itself, written at creation time, so the PDF
 * reflects what was invoiced rather than what the underlying job costs today.
 */
async function loadInvoice(invoiceId: string): Promise<PdfInvoice> {
  const snap = await getFirestore().doc(`invoices/${invoiceId}`).get();
  if (!snap.exists) throw new HttpsError("not-found", "Invoice not found.");
  const d = snap.data() ?? {};

  const rawLines = Array.isArray(d.lines) ? d.lines : [];
  return {
    invoiceNumber: d.invoiceNumber ?? "",
    type: d.type === "project" ? "project" : "service",
    customerName: d.customerName ?? "",
    customerPhone: d.customerPhone || undefined,
    customerAddress: d.customerAddress || undefined,
    reference: d.reference || undefined,
    lines: rawLines.map((l: Record<string, unknown>) => ({
      description: String(l.description ?? ""),
      quantity: Number(l.quantity ?? 0),
      unitPriceKobo: Number(l.unitPriceKobo ?? 0),
      amountKobo: Number(l.amountKobo ?? 0),
    })),
    subtotalKobo: Number(d.subtotalKobo ?? 0),
    taxPercent: d.taxPercent ? Number(d.taxPercent) : undefined,
    taxKobo: Number(d.taxKobo ?? 0),
    taxLabel: d.taxLabel || undefined,
    totalKobo: Number(d.totalKobo ?? 0),
    amountPaidKobo: Number(d.amountPaidKobo ?? 0),
    balanceKobo: Number(d.balanceKobo ?? 0),
    status: d.status ?? "draft",
    issuedAtMs: ms(d.issuedAt),
    dueAtMs: ms(d.dueAt),
    notes: d.notes || undefined,
  };
}

/** Filename a customer can file without renaming. */
function pdfName(invoice: PdfInvoice): string {
  const safe = invoice.invoiceNumber.replace(/[^\w.-]+/g, "-") || "invoice";
  return `${safe}.pdf`;
}

// ---------------------------------------------------------------------------
// getInvoicePdf, for preview and download
// ---------------------------------------------------------------------------

/**
 * Returns the invoice PDF as base64.
 *
 * Base64 over a callable rather than a signed Storage URL: the document is small,
 * it is generated on demand from live data, and there is nothing to clean up
 * afterwards. A stored copy would need an expiry policy and could go stale against
 * the invoice it claims to represent.
 *
 * Admin and manager, matching who can see the invoice list.
 */
export const getInvoicePdf = onCall(
  { region: REGION, cors: true, memory: "512MiB" },
  async (request) => {
    await requireRole(request.auth, ["admin", "manager"]);

    const invoiceId = String(request.data?.invoiceId ?? "");
    if (!invoiceId) throw new HttpsError("invalid-argument", "invoiceId is required.");

    const invoice = await loadInvoice(invoiceId);
    const company = await companyForPdf();
    const pdf = await renderInvoicePdf(invoice, company);

    return {
      ok: true,
      filename: pdfName(invoice),
      invoiceNumber: invoice.invoiceNumber,
      base64: pdf.toString("base64"),
      bytes: pdf.length,
    };
  }
);

// ---------------------------------------------------------------------------
// emailInvoice, sends the PDF to the customer
// ---------------------------------------------------------------------------

/**
 * Emails the invoice with the PDF attached. Admin only.
 *
 * The recipient defaults to the address stored on the invoice, and an explicit
 * `to` may override it for a one-off (a client's accounts department, say). The
 * address actually used is recorded in the audit entry, because "we emailed it"
 * is worth nothing without knowing where.
 */
export const emailInvoice = onCall(
  { region: REGION, secrets: [BREVO_API_KEY], cors: true, memory: "512MiB" },
  async (request) => {
    const actor = await requireRole(request.auth, ["admin"]);
    const db = getFirestore();

    const invoiceId = String(request.data?.invoiceId ?? "");
    if (!invoiceId) throw new HttpsError("invalid-argument", "invoiceId is required.");

    const snap = await db.doc(`invoices/${invoiceId}`).get();
    if (!snap.exists) throw new HttpsError("not-found", "Invoice not found.");
    const stored = snap.data() ?? {};

    if (stored.status === "draft") {
      throw new HttpsError(
        "failed-precondition",
        "Issue the invoice before emailing it. A draft is not a request for payment."
      );
    }
    if (stored.status === "void") {
      throw new HttpsError("failed-precondition", "A void invoice cannot be emailed.");
    }

    const override = request.data?.to;
    const recipient = isEmail(override) ? override : stored.customerEmail;
    if (!isEmail(recipient)) {
      throw new HttpsError(
        "failed-precondition",
        "No valid email address for this customer. Add one to the invoice, or supply an address to send to."
      );
    }

    const invoice = await loadInvoice(invoiceId);
    const company = await companyForPdf();
    const pdf = await renderInvoicePdf(invoice, company);

    const settled = invoice.balanceKobo <= 0 && invoice.totalKobo > 0;
    const overdue =
      invoice.balanceKobo > 0 && invoice.dueAtMs !== null && invoice.dueAtMs < Date.now();
    const due = invoice.dueAtMs
      ? new Date(invoice.dueAtMs).toLocaleDateString("en-GB", {
          day: "numeric",
          month: "long",
          year: "numeric",
          timeZone: "Africa/Lagos",
        })
      : "";

    const message = String(request.data?.message ?? "").trim();

    const html = renderEmail({
      company: {
        name: company.name,
        tagline: company.tagline,
        email: company.email,
        phone: company.phone,
        website: company.website,
        address: company.address,
      },
      eyebrow: "Invoice",
      heading: settled
        ? `Invoice ${invoice.invoiceNumber}, paid in full`
        : `Invoice ${invoice.invoiceNumber}`,
      body:
        paragraph(
          settled
            ? `Please find invoice ${invoice.invoiceNumber} attached, settled in full. No payment is due.`
            : `Please find invoice ${invoice.invoiceNumber} attached as a PDF.`
        ) +
        (message ? paragraph(message) : "") +
        detailTable([
          ["Invoice", invoice.invoiceNumber],
          ...(invoice.reference
            ? [["Reference", invoice.reference] as [string, string]]
            : []),
          ...(due ? [[overdue ? "Was due" : "Due", due] as [string, string]] : []),
        ]) +
        totalRow(
          settled ? "Paid in full" : "Amount due",
          "₦" + Math.round(invoice.balanceKobo / 100).toLocaleString("en-US")
        ) +
        (settled
          ? paragraph("Keep the attached PDF as your record.")
          : paragraph(
              company.bankAccountNumber
                ? `Payment details are on the invoice. Please quote ${invoice.invoiceNumber} on the transfer so we can match it.`
                : `Please quote ${invoice.invoiceNumber} when paying.`
            )),
      footerNote: settled
        ? "No further payment is due on this invoice."
        : "Reply to this email with any questions about this invoice.",
    });

    const sent = await mailer().send({
      to: [{ email: recipient, name: invoice.customerName }],
      subject: settled
        ? `Invoice ${invoice.invoiceNumber} — paid in full`
        : `Invoice ${invoice.invoiceNumber} from ${company.name}`,
      html,
      replyTo: { email: company.email, name: company.name },
      tags: ["invoice"],
      attachments: [{ name: pdfName(invoice), content: pdf }],
    });

    if (!sent.ok) {
      // Surfaced rather than swallowed: unlike a receipt after a recorded payment,
      // nothing has happened yet, and the admin needs to know it did not send.
      throw new HttpsError(
        "internal",
        sent.error ?? "The invoice could not be emailed. Check the email settings."
      );
    }

    // Stamped on the invoice so the list can show that it went out, and to whom.
    await db.doc(`invoices/${invoiceId}`).update({
      lastEmailedAt: FieldValue.serverTimestamp(),
      lastEmailedTo: recipient,
    });

    await db.collection("auditLog").add({
      actorUid: actor.uid,
      actorEmail: actor.email,
      actorRole: actor.role,
      action: "invoice_email",
      collectionName: "invoices",
      docId: invoiceId,
      summary: `Emailed ${invoice.invoiceNumber} to ${recipient}`,
      after: { to: recipient, bytes: pdf.length },
      at: FieldValue.serverTimestamp(),
    });

    return {
      ok: true,
      to: recipient,
      invoiceNumber: invoice.invoiceNumber,
      messageId: sent.messageId,
    };
  }
);

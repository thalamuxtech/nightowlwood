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
import {
  renderEstimatePdf,
  type PdfCompany,
  type PdfEstimate,
  type PdfEstimateLine,
} from "./estimatePdf";

/**
 * Cost estimate as a document: rendered to PDF, downloaded, or emailed to the client.
 *
 * Mirrors invoiceDocument.ts deliberately. The estimate is drawn on the server for
 * the same reason the invoice is: one code path produces the file whether it is
 * downloaded by an admin or attached to a client's email, so the two cannot drift.
 *
 * Reading is admin and manager, matching who can see the project. Emailing is admin
 * only: it is outbound contact in the company's name quoting a price.
 */

const BREVO_API_KEY = defineSecret("BREVO_API_KEY");
const REGION = "europe-west1";
const SENDER = { email: "info@nightowl.com.ng", name: "Nightowl Woodworks" };

/** Days an estimate's prices are quoted as holding, absent a stored value. */
const DEFAULT_VALID_DAYS = 30;

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
    };
  } catch {
    return { ...FALLBACK_COMPANY };
  }
}

const ms = (v: unknown): number | null => {
  const t = v as { toMillis?: () => number } | null | undefined;
  return typeof t?.toMillis === "function" ? t.toMillis() : null;
};

/** Category slugs read back as the labels the client sees. */
const CATEGORY_LABELS: Record<string, string> = {
  kitchen: "Kitchen",
  doors: "Doors",
  frames: "Frames",
  tv_wall_panels: "TV Wall Panels",
  closets: "Closets",
  bedset: "Bedset",
};

/**
 * Loads an estimate and its lines into the PDF's shape.
 *
 * Reads the estimate's own `lines` subcollection rather than recomputing from the
 * project's live features. The estimate is a snapshot taken when it was created, and
 * a client holding v2 must see v2's figures even if someone has since repriced the
 * project. That is the whole point of snapshotting them.
 *
 * The project and customer are read for the header only. If the project has since
 * been deleted the estimate still renders, because a document that cannot be
 * reproduced is not much of a record.
 */
async function loadEstimate(estimateId: string): Promise<PdfEstimate> {
  const db = getFirestore();
  const snap = await db.doc(`estimates/${estimateId}`).get();
  if (!snap.exists) throw new HttpsError("not-found", "Estimate not found.");
  const d = snap.data() ?? {};

  const lineSnap = await db
    .collection(`estimates/${estimateId}/lines`)
    .orderBy("order", "asc")
    .get();

  // `addedByReviewer` is deliberately not carried through. Whether a line came from
  // this office or the reviewer we commissioned is internal provenance; the client is
  // being quoted one price by one company. The admin screen shows the distinction.
  const lines: PdfEstimateLine[] = lineSnap.docs.map((doc) => {
    const l = doc.data();
    const category = String(l.category ?? "");
    return {
      group: CATEGORY_LABELS[category] || category || "Items",
      item: String(l.item ?? ""),
      quantity: Number(l.quantity ?? 0),
      unitPriceKobo: Number(l.unitPriceKobo ?? 0),
      amountKobo: Number(l.amountKobo ?? 0),
    };
  });

  // A reviewer's zeroed-out lines are dropped rather than printed at nil. The
  // submit path zeroes an omitted line instead of deleting it so the change is
  // auditable, but a client has no use for a row the reviewer struck out.
  const priced = lines.filter((l) => l.amountKobo > 0);

  let projectTitle = "";
  let customerName = "";
  let customerPhone: string | undefined;
  let customerAddress: string | undefined;
  let location: string | undefined;

  if (d.projectId) {
    const proj = await db.doc(`projects/${d.projectId}`).get();
    if (proj.exists) {
      const p = proj.data() ?? {};
      projectTitle = String(p.title ?? "");
      customerName = String(p.customerName ?? "");
      location = p.location || undefined;

      if (p.customerId) {
        const cust = await db.doc(`customers/${p.customerId}`).get();
        if (cust.exists) {
          const c = cust.data() ?? {};
          customerPhone = c.phone || undefined;
          customerAddress = c.address || undefined;
        }
      }
    }
  }

  const createdAtMs = ms(d.createdAt);
  // Derived from the creation date rather than stored: the validity window is a
  // standing term of business, not something set per estimate.
  const validUntilMs =
    ms(d.validUntil) ??
    (createdAtMs ? createdAtMs + DEFAULT_VALID_DAYS * 86_400_000 : null);

  const subtotalKobo = Number(d.subtotalKobo ?? 0);
  const nightowlChargesKobo = Number(d.nightowlChargesKobo ?? 0);
  // Prefers the stored rate; falls back to the ratio only for estimates issued
  // before that field existed. Rounded to one decimal for display, because the
  // fallback is a float and "15.000000000000002%" is not a rate anyone quoted.
  const nightowlChargePercent =
    typeof d.nightowlChargePercent === "number"
      ? d.nightowlChargePercent
      : subtotalKobo > 0
        ? Math.round((nightowlChargesKobo / subtotalKobo) * 1000) / 10
        : 0;

  return {
    projectNumber: String(d.projectNumber ?? ""),
    projectTitle,
    version: Number(d.version ?? 1),
    status: String(d.status ?? "draft"),
    customerName,
    customerPhone,
    customerAddress,
    location,
    lines: priced,
    subtotalKobo,
    errorMarginPercent: Number(d.errorMarginPercent ?? 0),
    errorMarginKobo: Number(d.errorMarginKobo ?? 0),
    nightowlChargesKobo,
    nightowlChargePercent,
    totalKobo: Number(d.totalKobo ?? 0),
    createdAtMs,
    validUntilMs,
    notes: d.reviewNotes || d.notes || undefined,
  };
}

/** Filename a client can file without renaming. */
function pdfName(est: PdfEstimate): string {
  const safe = est.projectNumber.replace(/[^\w.-]+/g, "-") || "estimate";
  return `${safe}-estimate-v${est.version}.pdf`;
}

// ---------------------------------------------------------------------------
// getEstimatePdf, for preview and download
// ---------------------------------------------------------------------------

/**
 * Returns the estimate PDF as base64.
 *
 * Base64 over a callable rather than a signed Storage URL, for the same reasons as
 * the invoice: the document is small, generated on demand, and leaves nothing to
 * expire or go stale.
 */
export const getEstimatePdf = onCall(
  { region: REGION, cors: true, memory: "512MiB" },
  async (request) => {
    await requireRole(request.auth, ["admin", "manager"]);

    const estimateId = String(request.data?.estimateId ?? "");
    if (!estimateId) throw new HttpsError("invalid-argument", "estimateId is required.");

    const est = await loadEstimate(estimateId);
    const company = await companyForPdf();
    const pdf = await renderEstimatePdf(est, company);

    return {
      ok: true,
      filename: pdfName(est),
      projectNumber: est.projectNumber,
      version: est.version,
      base64: pdf.toString("base64"),
      bytes: pdf.length,
    };
  }
);

// ---------------------------------------------------------------------------
// emailEstimate, sends the PDF to the client
// ---------------------------------------------------------------------------

/**
 * Emails the estimate with the PDF attached. Admin only.
 *
 * Deliberately refuses an estimate that is still out for review: the whole point of
 * the review step is that a professional checks the figures before a client sees
 * them, and sending mid-review would make that step decorative. A superseded
 * estimate is refused too, since a newer version exists and quoting the old one
 * would be quoting a price the business has already moved on from.
 */
export const emailEstimate = onCall(
  { region: REGION, secrets: [BREVO_API_KEY], cors: true, memory: "512MiB" },
  async (request) => {
    const actor = await requireRole(request.auth, ["admin"]);
    const db = getFirestore();

    const estimateId = String(request.data?.estimateId ?? "");
    if (!estimateId) throw new HttpsError("invalid-argument", "estimateId is required.");

    const snap = await db.doc(`estimates/${estimateId}`).get();
    if (!snap.exists) throw new HttpsError("not-found", "Estimate not found.");
    const stored = snap.data() ?? {};

    if (stored.status === "in_review") {
      throw new HttpsError(
        "failed-precondition",
        "This estimate is still out for review. Wait for the reviewer to return it before sending it to the client."
      );
    }
    if (stored.status === "superseded") {
      throw new HttpsError(
        "failed-precondition",
        "This estimate has been superseded. Send the current version instead."
      );
    }

    const recipient = request.data?.to;
    if (!isEmail(recipient)) {
      throw new HttpsError(
        "invalid-argument",
        "A valid client email address is required."
      );
    }

    const est = await loadEstimate(estimateId);
    const company = await companyForPdf();
    const pdf = await renderEstimatePdf(est, company);

    const message = String(request.data?.message ?? "").trim();
    const validUntil = est.validUntilMs
      ? new Date(est.validUntilMs).toLocaleDateString("en-GB", {
          day: "numeric",
          month: "long",
          year: "numeric",
          timeZone: "Africa/Lagos",
        })
      : "";

    const html = renderEmail({
      company: {
        name: company.name,
        tagline: company.tagline,
        email: company.email,
        phone: company.phone,
        website: company.website,
        address: company.address,
      },
      eyebrow: "Cost estimate",
      heading: `Your estimate for ${est.projectTitle || est.projectNumber}`,
      body:
        paragraph(
          `Please find our cost estimate attached as a PDF${
            est.customerName ? `, ${est.customerName}` : ""
          }.`
        ) +
        (message ? paragraph(message) : "") +
        detailTable([
          ["Project", est.projectNumber],
          ...(est.projectTitle
            ? [["Title", est.projectTitle] as [string, string]]
            : []),
          ["Version", `v${est.version}`],
          ["Items", String(est.lines.length)],
          ...(validUntil ? [["Valid until", validUntil] as [string, string]] : []),
        ]) +
        totalRow(
          "Estimate total",
          "₦" + Math.round(est.totalKobo / 100).toLocaleString("en-US")
        ) +
        paragraph(
          "This is an estimate rather than an invoice, so no payment is due on it. Reply to this email to accept it or to ask about any line, and we will schedule the work once it is agreed."
        ),
      footerNote:
        "Board and timber prices move, so a later start may need requoting. Reply with any questions.",
    });

    const sent = await mailer().send({
      to: [{ email: recipient, name: est.customerName || undefined }],
      subject: `Cost estimate ${est.projectNumber} from ${company.name}`,
      html,
      replyTo: { email: company.email, name: company.name },
      tags: ["estimate"],
      attachments: [{ name: pdfName(est), content: pdf }],
    });

    if (!sent.ok) {
      throw new HttpsError(
        "internal",
        sent.error ?? "The estimate could not be emailed. Check the email settings."
      );
    }

    await db.doc(`estimates/${estimateId}`).update({
      lastEmailedAt: FieldValue.serverTimestamp(),
      lastEmailedTo: recipient,
    });

    await db.collection("auditLog").add({
      actorUid: actor.uid,
      actorEmail: actor.email,
      actorRole: actor.role,
      action: "estimate_email",
      collectionName: "estimates",
      docId: estimateId,
      summary: `Emailed estimate ${est.projectNumber} v${est.version} to ${recipient}`,
      after: { to: recipient, bytes: pdf.length },
      at: FieldValue.serverTimestamp(),
    });

    return {
      ok: true,
      to: recipient,
      projectNumber: est.projectNumber,
      version: est.version,
      messageId: sent.messageId,
    };
  }
);

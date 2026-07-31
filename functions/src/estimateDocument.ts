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

/*
 * Fallback rates for a project that has never had its own set.
 *
 * These must match DEFAULT_INVOICE_SETTINGS in src/lib/erp/settings.ts. They were
 * 0 here and the configured defaults there, so a project whose rates had never been
 * touched showed one total on the admin screen and printed a lower one on the
 * client's PDF — on a ₦5,000,000 subtotal, a ₦1,000,000 difference in the client's
 * favour, in writing. Duplicated rather than imported because functions/ compiles
 * independently of the Next app.
 */
const DEFAULT_ERROR_MARGIN_PERCENT = 5;
const DEFAULT_NIGHTOWL_CHARGE_PERCENT = 15;

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

/** Whether a feature belongs on the estimate. Mirrors src/lib/erp/projects.ts. */
function isIncluded(f: {
  included?: boolean | null;
  amountKobo?: number | null;
}): boolean {
  if (f.included === true) return true;
  if (f.included === false) return false;
  return (f.amountKobo ?? 0) > 0;
}

/**
 * Loads a project's estimate: its components, their ticked features, and its rates.
 *
 * Read live rather than from a snapshot, because there is no snapshot — the project
 * *is* its estimate. A price corrected on a component is corrected on the document,
 * which is the point. The consequence worth knowing: a client holding the PDF from
 * last week may hold different figures from the one generated today, so the version
 * and the preparation date on the page are what identify which is which.
 */
async function loadEstimate(projectId: string): Promise<PdfEstimate> {
  const db = getFirestore();
  const snap = await db.doc(`projects/${projectId}`).get();
  if (!snap.exists) throw new HttpsError("not-found", "Project not found.");
  const d = snap.data() ?? {};

  const comps = await db
    .collection(`projects/${projectId}/components`)
    .orderBy("order", "asc")
    .get();

  // Issued together: a templated project holds a component per room, each with its
  // own template rows, so serial reads got slower the more complete the project was.
  const featSnaps = await Promise.all(
    comps.docs.map((c) =>
      db
        .collection(`projects/${projectId}/components/${c.id}/features`)
        .orderBy("order", "asc")
        .get()
    )
  );

  // Grouped by the component's own name, not its category: a project with two
  // kitchens needs "Main kitchen" and "Pantry kitchen" told apart, and the category
  // label would print the same heading twice.
  //
  // `addedByReviewer` is deliberately not carried onto the page. Whether a line came
  // from this office or the fabricator we commissioned is internal provenance; the
  // client is being quoted one price by one company.
  const lines: PdfEstimateLine[] = [];
  comps.docs.forEach((c, i) => {
    const cd = c.data();
    const heading =
      String(cd.name ?? "").trim() ||
      CATEGORY_LABELS[String(cd.category ?? "")] ||
      "Items";
    for (const f of featSnaps[i].docs) {
      const x = f.data();
      // Only ticked lines. The template is a 178-row checklist of what a job of
      // this kind might involve; printing all of it would bury the work quoted for.
      if (!isIncluded(x)) continue;
      lines.push({
        group: heading,
        item: String(x.item ?? ""),
        quantity: Number(x.quantity ?? 0),
        unitPriceKobo: Number(x.unitPriceKobo ?? 0),
        amountKobo: Number(x.amountKobo ?? 0),
      });
    }
  });

  let customerPhone: string | undefined;
  let customerAddress: string | undefined;
  if (d.customerId) {
    const cust = await db.doc(`customers/${d.customerId}`).get();
    if (cust.exists) {
      const c = cust.data() ?? {};
      customerPhone = c.phone || undefined;
      customerAddress = c.address || undefined;
    }
  }

  // Totals are computed from the lines just read rather than from the project's
  // stored rollup, so the figures on the page always add up to the rows above them
  // even if a rollup has drifted.
  const subtotalKobo = lines.reduce((s, l) => s + l.amountKobo, 0);
  const errorMarginPercent = Number(
    d.errorMarginPercent ?? DEFAULT_ERROR_MARGIN_PERCENT
  );
  const nightowlChargePercent = Number(
    d.nightowlChargePercent ?? DEFAULT_NIGHTOWL_CHARGE_PERCENT
  );
  const errorMarginKobo = Math.round((subtotalKobo * errorMarginPercent) / 100);
  const nightowlChargesKobo = Math.round((subtotalKobo * nightowlChargePercent) / 100);

  /*
   * "Prepared" is the day these figures last went out.
   *
   * Most recent of the two sendings, not `reviewSentAt` alone: an estimate emailed
   * to a client but never sent for review had no send date at all and fell back to
   * the project's start, so a job begun two months ago printed "Valid until" a date
   * already in the past. The project's own dates remain the last resort, for a
   * document generated before it has been sent anywhere.
   */
  const sentMs = Math.max(ms(d.lastEmailedAt) ?? 0, ms(d.reviewSentAt) ?? 0);
  const createdAtMs = sentMs || ms(d.startDate) || ms(d.createdAt);
  const validUntilMs = createdAtMs
    ? createdAtMs + DEFAULT_VALID_DAYS * 86_400_000
    : null;

  return {
    projectNumber: String(d.projectNumber ?? ""),
    projectTitle: String(d.title ?? ""),
    version: Number(d.estimateVersion ?? 1) || 1,
    status: String(d.estimateStatus ?? "draft"),
    customerName: String(d.customerName ?? ""),
    customerPhone,
    customerAddress,
    location: d.location || undefined,
    lines,
    subtotalKobo,
    errorMarginPercent,
    errorMarginKobo,
    nightowlChargesKobo,
    nightowlChargePercent,
    totalKobo: subtotalKobo + errorMarginKobo + nightowlChargesKobo,
    createdAtMs,
    validUntilMs,
    notes: d.reviewNotes || d.estimateNotes || undefined,
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

    const projectId = String(request.data?.projectId ?? "");
    if (!projectId) throw new HttpsError("invalid-argument", "projectId is required.");

    const est = await loadEstimate(projectId);
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
 * them, and sending mid-review would make that step decorative.
 *
 * Sending bumps the version. The estimate is live, so the figures can move between
 * one email and the next, and without a bump two clients could hold two different
 * documents both labelled v1 — which is the one thing the version number exists to
 * prevent.
 */
export const emailEstimate = onCall(
  { region: REGION, secrets: [BREVO_API_KEY], cors: true, memory: "512MiB" },
  async (request) => {
    const actor = await requireRole(request.auth, ["admin"]);
    const db = getFirestore();

    const projectId = String(request.data?.projectId ?? "");
    if (!projectId) throw new HttpsError("invalid-argument", "projectId is required.");

    const snap = await db.doc(`projects/${projectId}`).get();
    if (!snap.exists) throw new HttpsError("not-found", "Project not found.");
    const stored = snap.data() ?? {};

    // Refused mid-review: the point of commissioning a professional is that they
    // check the figures before a client sees them, and sending now would make that
    // step decorative.
    if (stored.estimateStatus === "in_review") {
      throw new HttpsError(
        "failed-precondition",
        "This estimate is still out for review. Wait for the reviewer to return it before sending it to the client."
      );
    }

    const recipient = request.data?.to;
    if (!isEmail(recipient)) {
      throw new HttpsError(
        "invalid-argument",
        "A valid client email address is required."
      );
    }

    /*
     * An approved estimate may only be emailed while it still says what was agreed.
     *
     * Components stay editable after approval by design, but `contractValueKobo` is
     * frozen at the approved figure and is what invoices bill against. Emailing a
     * drifted estimate would hand the client written evidence of a total lower than
     * the one being billed — so the divergence has to be resolved deliberately,
     * either by reopening and re-approving or by putting the prices back.
     */
    if (stored.estimateStatus === "approved") {
      const agreed = Number(stored.contractValueKobo ?? 0);
      const live = (await loadEstimate(projectId)).totalKobo;
      if (agreed > 0 && live !== agreed) {
        throw new HttpsError(
          "failed-precondition",
          `This estimate has been edited since it was approved: it now totals ₦${Math.round(
            live / 100
          ).toLocaleString("en-US")} against an agreed ₦${Math.round(
            agreed / 100
          ).toLocaleString("en-US")}. Reopen and re-approve it, or restore the prices, before sending it to the client.`
        );
      }
    }

    /*
     * The version is bumped before the PDF is drawn, not after.
     *
     * `loadEstimate` reads it off the project, so bumping afterwards would attach a
     * file labelled with the previous version to the email announcing the new one —
     * the file and the record disagreeing about which document the client holds.
     */
    const version = Number(stored.estimateVersion ?? 0) + 1;
    await db.doc(`projects/${projectId}`).update({
      estimateVersion: version,
      lastEmailedAt: FieldValue.serverTimestamp(),
      lastEmailedTo: recipient,
    });

    const est = await loadEstimate(projectId);
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
      // The version was claimed before the PDF was drawn, so it has to be given
      // back: a bounced send is not a version the client has ever seen, and letting
      // failures consume numbers would leave gaps that look like lost documents.
      // Restored to what was actually stored rather than decremented, so a
      // concurrent send cannot be rolled back on top of.
      await db.doc(`projects/${projectId}`).update({
        estimateVersion: Number(stored.estimateVersion ?? 0),
        lastEmailedAt: stored.lastEmailedAt ?? null,
        lastEmailedTo: stored.lastEmailedTo ?? null,
      });
      throw new HttpsError(
        "internal",
        sent.error ?? "The estimate could not be emailed. Check the email settings."
      );
    }

    await db.collection("auditLog").add({
      actorUid: actor.uid,
      actorEmail: actor.email,
      actorRole: actor.role,
      action: "estimate_email",
      collectionName: "projects",
      docId: projectId,
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

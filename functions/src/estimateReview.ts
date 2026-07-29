import { randomBytes, createHash, timingSafeEqual } from "crypto";
import { getFirestore, FieldValue, Timestamp } from "firebase-admin/firestore";
import { HttpsError, onCall } from "firebase-functions/v2/https";
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
 * External estimate review.
 *
 * A quantity surveyor or fabricator reviews an estimate without being a user of
 * the system. They receive a link carrying a random token and, separately, a
 * six-digit passcode. Both must be presented to open the estimate.
 *
 * What is stored: SHA-256 hashes of the token and passcode, never the values.
 * A leaked database therefore does not yield working links. The token is 32
 * random bytes, which is far beyond guessing, and the passcode exists so that a
 * forwarded or logged URL alone is not enough.
 *
 * Why a Cloud Function and not Firestore rules: the reviewer has no Firebase
 * identity, so there is nothing for rules to key off. Every read and write goes
 * through these callables, which run with admin credentials and enforce the
 * token, the passcode, the expiry and the attempt limit themselves.
 */

const BREVO_API_KEY = defineSecret("BREVO_API_KEY");
const REGION = "europe-west1";

/** Wrong-passcode attempts before the link is locked. */
const MAX_ATTEMPTS = 5;

/** Default validity. Long enough to be useful, short enough to expire. */
const DEFAULT_VALID_DAYS = 7;

const SENDER = { email: "info@nightowl.com.ng", name: "Nightowl Woodworks" };

const FALLBACK_COMPANY: CompanyDetails = {
  name: "Nightowl Woodworks Ltd",
  tagline: "Precision in Every Cut",
  email: "info@nightowl.com.ng",
  website: "nightowl.com.ng",
};

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

/**
 * Constant-time comparison of two hex digests.
 *
 * A plain `===` on a secret leaks its prefix through timing. The lengths are
 * checked first because timingSafeEqual throws on a mismatch, and a length
 * difference is not secret anyway.
 */
function hashesMatch(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a, "hex"), Buffer.from(b, "hex"));
}

/** Six digits, uniformly distributed. */
function makePasscode(): string {
  // randomInt-style rejection is unnecessary here: reading 4 bytes and taking
  // the remainder over 1e6 leaves a bias below one part in four thousand, which
  // is immaterial against a 5-attempt lockout.
  const n = randomBytes(4).readUInt32BE(0) % 1_000_000;
  return String(n).padStart(6, "0");
}

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

async function requireOps(
  auth: { uid: string; token: { email?: string } } | undefined
): Promise<{ uid: string; email: string; role: string }> {
  if (!auth) throw new HttpsError("unauthenticated", "Sign in first.");
  const snap = await getFirestore().doc(`users/${auth.uid}`).get();
  if (!snap.exists || snap.data()?.active === false) {
    throw new HttpsError("permission-denied", "This account is not active staff.");
  }
  const role = snap.data()?.role as string | undefined;
  if (role !== "admin" && role !== "manager") {
    throw new HttpsError("permission-denied", "Requires manager or admin.");
  }
  return { uid: auth.uid, email: auth.token.email ?? snap.data()?.email ?? "", role };
}

// ---------------------------------------------------------------------------
// Send for review
// ---------------------------------------------------------------------------

export const sendEstimateForReview = onCall(
  { region: REGION, secrets: [BREVO_API_KEY], cors: true },
  async (request) => {
    const actor = await requireOps(request.auth);
    const db = getFirestore();

    const estimateId = String(request.data?.estimateId ?? "");
    const email = String(request.data?.email ?? "").trim();
    const reviewerName = String(request.data?.reviewerName ?? "").trim();
    const validDays = Number(request.data?.validDays ?? DEFAULT_VALID_DAYS);
    const message = String(request.data?.message ?? "").trim();

    if (!estimateId) throw new HttpsError("invalid-argument", "estimateId is required.");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw new HttpsError("invalid-argument", "A valid reviewer email is required.");
    }

    const estRef = db.doc(`estimates/${estimateId}`);
    const estSnap = await estRef.get();
    if (!estSnap.exists) throw new HttpsError("not-found", "Estimate not found.");
    const est = estSnap.data() ?? {};

    if (est.status === "approved") {
      throw new HttpsError(
        "failed-precondition",
        "This estimate is already approved, so it cannot be sent for review."
      );
    }

    const token = randomBytes(32).toString("hex");
    const passcode = makePasscode();
    const expiresAt = Timestamp.fromMillis(
      Date.now() + Math.max(1, Math.min(30, validDays)) * 86_400_000
    );

    // Only hashes are persisted. Sending a new link supersedes the previous one
    // because the stored hash is replaced, so an old URL stops working.
    await estRef.update({
      status: "in_review",
      reviewTokenHash: sha256(token),
      reviewPasscodeHash: sha256(passcode),
      reviewEmail: email,
      reviewerName: reviewerName || null,
      reviewSentAt: FieldValue.serverTimestamp(),
      reviewExpiresAt: expiresAt,
      reviewAttempts: 0,
      reviewedAt: null,
      updatedAt: FieldValue.serverTimestamp(),
      updatedBy: actor.uid,
    });

    const company = await companyDetails();
    const site = String(request.data?.siteUrl ?? "https://nightowl-woodworks.web.app");
    const link = `${site}/estimate-review/?t=${token}`;

    const html = renderEmail({
      company,
      eyebrow: "Estimate review",
      heading: "Please review a cost estimate",
      body:
        paragraph(
          reviewerName
            ? `${reviewerName}, we would like your review of the estimate below.`
            : "We would like your review of the estimate below."
        ) +
        (message ? paragraph(message) : "") +
        detailTable([
          ["Project", String(est.projectNumber ?? "")],
          ["Version", `v${est.version ?? 1}`],
          ["Lines to review", String(request.data?.lineCount ?? "")],
          [
            "Link expires",
            expiresAt.toDate().toLocaleDateString("en-GB", {
              day: "numeric",
              month: "long",
              year: "numeric",
            }),
          ],
        ]) +
        paragraph(
          "Open the link, enter the passcode below, then adjust quantities and prices or add anything missing."
        ) +
        calloutBox(passcode, true) +
        paragraph(
          "The passcode is shown here for convenience. If you would prefer it sent separately, ask us to resend."
        ),
      cta: { label: "Open the estimate", url: link },
      footerNote: `Sent by ${actor.email}. The link stops working once you submit, or after it expires.`,
    });

    const result = await mailer().send({
      to: [{ email, name: reviewerName || undefined }],
      subject: `Estimate review: ${est.projectNumber ?? "Nightowl project"}`,
      html,
      replyTo: { email: company.email, name: company.name },
      tags: ["estimate-review"],
    });

    if (!result.ok) {
      throw new HttpsError("internal", result.error ?? "Could not send the email.");
    }

    await db.collection("auditLog").add({
      actorUid: actor.uid,
      actorEmail: actor.email,
      actorRole: actor.role,
      action: "estimate_send_review",
      collectionName: "estimates",
      docId: estimateId,
      summary: `Sent estimate v${est.version ?? 1} to ${email} for review`,
      at: FieldValue.serverTimestamp(),
    });

    // The passcode is returned once so the sender can pass it on by phone if
    // they would rather not rely on the email carrying it.
    return { ok: true, passcode, expiresAtMs: expiresAt.toMillis(), link };
  }
);

// ---------------------------------------------------------------------------
// Reviewer: open
// ---------------------------------------------------------------------------

/**
 * Finds the estimate a token belongs to.
 *
 * Queries on the token *hash*, so the raw token never has to be stored to be
 * looked up.
 */
async function findByToken(token: string) {
  const db = getFirestore();
  const snap = await db
    .collection("estimates")
    .where("reviewTokenHash", "==", sha256(token))
    .limit(1)
    .get();
  return snap.empty ? null : snap.docs[0];
}

export const openEstimateReview = onCall(
  { region: REGION, cors: true },
  async (request) => {
    const token = String(request.data?.token ?? "");
    const passcode = String(request.data?.passcode ?? "");
    if (!token || !passcode) {
      throw new HttpsError("invalid-argument", "Token and passcode are both required.");
    }

    const doc = await findByToken(token);
    // The same message for an unknown token and a wrong passcode, so the
    // response cannot be used to discover which tokens exist.
    const rejected = () =>
      new HttpsError("permission-denied", "That link or passcode is not valid.");
    if (!doc) throw rejected();

    const est = doc.data();

    if (est.reviewedAt) {
      throw new HttpsError(
        "failed-precondition",
        "This review has already been submitted. Contact Nightowl if you need to change it."
      );
    }
    const expiresMs = est.reviewExpiresAt?.toMillis?.() ?? 0;
    if (!expiresMs || expiresMs < Date.now()) {
      throw new HttpsError("failed-precondition", "This link has expired.");
    }
    if ((est.reviewAttempts ?? 0) >= MAX_ATTEMPTS) {
      throw new HttpsError(
        "resource-exhausted",
        "Too many incorrect attempts. Ask Nightowl to resend the link."
      );
    }

    if (!hashesMatch(sha256(passcode), String(est.reviewPasscodeHash ?? ""))) {
      // Count the failure before rejecting, so the limit cannot be bypassed by
      // abandoning the request.
      await doc.ref.update({ reviewAttempts: FieldValue.increment(1) });
      throw rejected();
    }

    // Reset the counter on success: a genuine reviewer who mistyped twice should
    // not carry those attempts for the life of the link.
    await doc.ref.update({ reviewAttempts: 0 });

    const linesSnap = await doc.ref.collection("lines").orderBy("order", "asc").get();

    return {
      estimateId: doc.id,
      projectNumber: est.projectNumber ?? "",
      version: est.version ?? 1,
      reviewerName: est.reviewerName ?? null,
      subtotalKobo: est.subtotalKobo ?? 0,
      errorMarginPercent: est.errorMarginPercent ?? 0,
      nightowlChargesKobo: est.nightowlChargesKobo ?? 0,
      totalKobo: est.totalKobo ?? 0,
      expiresAtMs: expiresMs,
      lines: linesSnap.docs.map((d) => {
        const x = d.data();
        return {
          id: d.id,
          category: x.category ?? "",
          item: x.item ?? "",
          quantity: x.quantity ?? 0,
          unitPriceKobo: x.unitPriceKobo ?? 0,
          amountKobo: x.amountKobo ?? 0,
          addedByReviewer: x.addedByReviewer ?? false,
        };
      }),
    };
  }
);

// ---------------------------------------------------------------------------
// Reviewer: submit
// ---------------------------------------------------------------------------

interface SubmittedLine {
  id?: string;
  item: string;
  category?: string;
  quantity: number;
  unitPriceKobo: number;
  note?: string;
}

export const submitEstimateReview = onCall(
  { region: REGION, secrets: [BREVO_API_KEY], cors: true },
  async (request) => {
    const token = String(request.data?.token ?? "");
    const passcode = String(request.data?.passcode ?? "");
    const lines = (request.data?.lines ?? []) as SubmittedLine[];
    const note = String(request.data?.note ?? "").trim();

    if (!token || !passcode) {
      throw new HttpsError("invalid-argument", "Token and passcode are both required.");
    }

    // Authenticate BEFORE inspecting the payload. Validating the lines first
    // leaked whether a token existed: a bogus token with a non-empty payload
    // returned "No lines were submitted" only when the token was real, which is
    // enough to confirm a guess. Every pre-auth failure now returns the same
    // text, so a prober learns nothing from the response.
    const doc = await findByToken(token);
    const rejected = () =>
      new HttpsError("permission-denied", "That link or passcode is not valid.");
    if (!doc) throw rejected();

    const est = doc.data();
    if ((est.reviewAttempts ?? 0) >= MAX_ATTEMPTS) throw rejected();
    if (!hashesMatch(sha256(passcode), String(est.reviewPasscodeHash ?? ""))) {
      await doc.ref.update({ reviewAttempts: FieldValue.increment(1) });
      throw rejected();
    }

    // Past this point the caller holds a valid token and passcode, so specific
    // messages are safe and genuinely useful to a real reviewer.
    if (est.reviewedAt) {
      throw new HttpsError("failed-precondition", "This review has already been submitted.");
    }
    const expiresMs = est.reviewExpiresAt?.toMillis?.() ?? 0;
    if (!expiresMs || expiresMs < Date.now()) {
      throw new HttpsError("failed-precondition", "This link has expired.");
    }
    if (!Array.isArray(lines) || lines.length === 0) {
      throw new HttpsError("invalid-argument", "No lines were submitted.");
    }
    // A bound on the payload: a reviewer adding a few items is expected, tens of
    // thousands is not, and the batch has limits.
    if (lines.length > 400) {
      throw new HttpsError("invalid-argument", "Too many lines in one submission.");
    }

    const db = getFirestore();
    const existing = await doc.ref.collection("lines").get();
    const existingById = new Map(existing.docs.map((d) => [d.id, d]));

    let batch = db.batch();
    let ops = 0;
    let subtotal = 0;
    let changed = 0;
    let added = 0;

    const commitIfFull = async () => {
      if (ops >= 400) {
        await batch.commit();
        batch = db.batch();
        ops = 0;
      }
    };

    for (const line of lines) {
      const quantity = Number(line.quantity) || 0;
      const unitPriceKobo = Math.max(0, Math.round(Number(line.unitPriceKobo) || 0));
      const amountKobo = Math.round(quantity * unitPriceKobo);
      subtotal += amountKobo;

      if (line.id && existingById.has(line.id)) {
        const prev = existingById.get(line.id)!;
        const before = prev.data();
        if (before.quantity !== quantity || before.unitPriceKobo !== unitPriceKobo) {
          changed += 1;
        }
        batch.update(prev.ref, {
          quantity,
          unitPriceKobo,
          amountKobo,
          reviewerNote: line.note ?? null,
        });
        existingById.delete(line.id);
      } else {
        added += 1;
        batch.set(doc.ref.collection("lines").doc(), {
          category: line.category ?? est.lines?.[0]?.category ?? "kitchen",
          item: String(line.item ?? "").slice(0, 200),
          quantity,
          unitPriceKobo,
          amountKobo,
          order: 9000 + added,
          addedByReviewer: true,
          reviewerNote: line.note ?? null,
        });
      }
      ops += 1;
      await commitIfFull();
    }

    // Lines the reviewer omitted are zeroed rather than deleted: the estimate is
    // a record of what was proposed, and silently removing a line would hide
    // that the reviewer disagreed with it.
    for (const [, leftover] of existingById) {
      batch.update(leftover.ref, {
        quantity: 0,
        amountKobo: 0,
        reviewerNote: "Removed by reviewer",
      });
      ops += 1;
      await commitIfFull();
    }

    const errorMarginPercent = est.errorMarginPercent ?? 0;
    const nightowlPercent = est.nightowlChargesKobo && est.subtotalKobo
      ? Math.round((est.nightowlChargesKobo / est.subtotalKobo) * 100)
      : 0;
    // Both percentages apply to the subtotal only, never to each other, matching
    // computeEstimateTotals on the client.
    const errorMarginKobo = Math.round((subtotal * errorMarginPercent) / 100);
    const nightowlChargesKobo = Math.round((subtotal * nightowlPercent) / 100);

    batch.update(doc.ref, {
      status: "reviewed",
      subtotalKobo: subtotal,
      errorMarginKobo,
      nightowlChargesKobo,
      totalKobo: subtotal + errorMarginKobo + nightowlChargesKobo,
      reviewedAt: FieldValue.serverTimestamp(),
      reviewNotes: note || null,
      // The token is cleared so the link cannot be reused after submission.
      reviewTokenHash: FieldValue.delete(),
      reviewPasscodeHash: FieldValue.delete(),
    });
    await batch.commit();

    await db.collection("auditLog").add({
      actorUid: "external:reviewer",
      actorEmail: est.reviewEmail ?? "unknown",
      actorRole: "admin",
      action: "estimate_review_submit",
      collectionName: "estimates",
      docId: doc.id,
      summary:
        `Reviewer submitted: ${changed} line(s) changed, ${added} added, ` +
        `new total ${subtotal + errorMarginKobo + nightowlChargesKobo} kobo`,
      at: FieldValue.serverTimestamp(),
    });

    // Notify the business. A review nobody hears about is a review that stalls.
    try {
      const company = await companyDetails();
      const html = renderEmail({
        company,
        eyebrow: "Estimate review",
        heading: "A reviewer has returned an estimate",
        body:
          paragraph(
            `${est.reviewerName || est.reviewEmail || "The reviewer"} has submitted their review of ${est.projectNumber ?? "an estimate"}.`
          ) +
          detailTable([
            ["Project", String(est.projectNumber ?? "")],
            ["Version", `v${est.version ?? 1}`],
            ["Lines changed", String(changed)],
            ["Lines added", String(added)],
          ]) +
          (note ? paragraph(`Reviewer note: ${note}`) : ""),
        footerNote: "Open the project in the admin dashboard to accept or adjust.",
      });
      await mailer().send({
        to: [{ email: company.email, name: company.name }],
        subject: `Estimate reviewed: ${est.projectNumber ?? "project"}`,
        html,
        tags: ["estimate-review"],
      });
    } catch {
      // A notification failure must not fail the submission the reviewer just made.
    }

    return { ok: true, changed, added, totalKobo: subtotal + errorMarginKobo + nightowlChargesKobo };
  }
);

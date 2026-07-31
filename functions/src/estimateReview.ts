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
  totalRow,
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

/*
 * Fallback rates for a project that has never had its own set. Must match
 * DEFAULT_INVOICE_SETTINGS in src/lib/erp/settings.ts and the same pair in
 * estimateDocument.ts: defaulting to 0 here would quote the reviewer a total
 * lower than the admin screen shows, on the very figures they are checking.
 */
const DEFAULT_ERROR_MARGIN_PERCENT = 5;
const DEFAULT_NIGHTOWL_CHARGE_PERCENT = 15;

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

    const projectId = String(request.data?.projectId ?? "");
    const email = String(request.data?.email ?? "").trim();
    const reviewerName = String(request.data?.reviewerName ?? "").trim();
    const validDays = Number(request.data?.validDays ?? DEFAULT_VALID_DAYS);
    const message = String(request.data?.message ?? "").trim();
    const componentIds: string[] = Array.isArray(request.data?.componentIds)
      ? request.data.componentIds.map(String)
      : [];

    if (!projectId) throw new HttpsError("invalid-argument", "projectId is required.");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw new HttpsError("invalid-argument", "A valid reviewer email is required.");
    }

    const projRef = db.doc(`projects/${projectId}`);
    const projSnap = await projRef.get();
    if (!projSnap.exists) throw new HttpsError("not-found", "Project not found.");
    const est = projSnap.data() ?? {};

    if (est.estimateStatus === "approved") {
      throw new HttpsError(
        "failed-precondition",
        "This estimate is already approved. Reopen it for requoting before sending it out for review."
      );
    }

    // Counted here rather than trusted from the caller: the figure goes in the
    // reviewer's email, and the server is the one that knows what it will show them.
    const scoped = await loadFeatures(projectId, componentIds);
    const lineCount = scoped.length;
    if (lineCount === 0) {
      throw new HttpsError(
        "failed-precondition",
        "Those components have no line items, so there is nothing to review."
      );
    }

    const token = randomBytes(32).toString("hex");
    const passcode = makePasscode();
    const expiresAt = Timestamp.fromMillis(
      Date.now() + Math.max(1, Math.min(30, validDays)) * 86_400_000
    );

    // Only hashes are persisted. Sending a new link supersedes the previous one
    // because the stored hash is replaced, so an old URL stops working.
    //
    // The version is bumped here: sending is what makes an estimate something a
    // reviewer or client can cite, and editing between sendings is expected.
    const version = Number(est.estimateVersion ?? 0) + 1;
    await projRef.update({
      estimateStatus: "in_review",
      estimateVersion: version,
      reviewTokenHash: sha256(token),
      reviewPasscodeHash: sha256(passcode),
      reviewEmail: email,
      reviewerName: reviewerName || null,
      reviewComponentIds: componentIds,
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
          ["Version", `v${version}`],
          ["Lines to review", String(lineCount)],
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
      collectionName: "projects",
      docId: projectId,
      summary:
        `Sent ${est.projectNumber ?? "project"} estimate v${version} to ${email} ` +
        `for review (${lineCount} lines across ${componentIds.length || "all"} components)`,
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
 * Whether a feature belongs on the estimate.
 *
 * Duplicated from `src/lib/erp/projects.ts` because `functions/` compiles
 * independently. Both must agree: this is the rule that decides what a client is
 * quoted, and two versions of it that disagree would show one figure on screen and
 * another on the PDF.
 */
function isIncluded(f: {
  included?: boolean | null;
  amountKobo?: number | null;
}): boolean {
  if (f.included === true) return true;
  if (f.included === false) return false;
  return (f.amountKobo ?? 0) > 0;
}

/** A feature, with the path needed to write back to it. */
interface FeatureRef {
  componentId: string;
  componentName: string;
  category: string;
  featureId: string;
  item: string;
  quantity: number;
  unitPriceKobo: number;
  amountKobo: number;
  included: boolean;
  order: number;
  addedByReviewer: boolean;
}

/**
 * Reads a project's components and their features.
 *
 * `componentIds` narrows to what the reviewer was asked to look at. The composite
 * id sent to the browser is `componentId:featureId`, because a feature lives two
 * levels down and a flat id could not be written back.
 */
async function loadFeatures(
  projectId: string,
  componentIds: string[] | null
): Promise<FeatureRef[]> {
  const db = getFirestore();
  const comps = await db
    .collection(`projects/${projectId}/components`)
    .orderBy("order", "asc")
    .get();

  const wanted = comps.docs.filter(
    (c) => !componentIds || componentIds.length === 0 || componentIds.includes(c.id)
  );

  // Issued together: a templated project carries a component per room and each
  // holds its own template rows, so serial reads got slower the more complete the
  // project was.
  const featSnaps = await Promise.all(
    wanted.map((c) =>
      db
        .collection(`projects/${projectId}/components/${c.id}/features`)
        .orderBy("order", "asc")
        .get()
    )
  );

  const out: FeatureRef[] = [];
  wanted.forEach((c, i) => {
    const cd = c.data();
    for (const f of featSnaps[i].docs) {
      const x = f.data();
      out.push({
        componentId: c.id,
        componentName: String(cd.name ?? ""),
        category: String(cd.category ?? ""),
        featureId: f.id,
        item: String(x.item ?? ""),
        quantity: Number(x.quantity ?? 0),
        unitPriceKobo: Number(x.unitPriceKobo ?? 0),
        amountKobo: Number(x.amountKobo ?? 0),
        included: isIncluded(x),
        order: Number(x.order ?? 0),
        addedByReviewer: x.addedByReviewer === true,
      });
    }
  });
  return out;
}

/** Recomputes a component's subtotal and the project's, from what is ticked. */
async function rollUp(projectId: string): Promise<number> {
  const db = getFirestore();
  const comps = await db.collection(`projects/${projectId}/components`).get();

  let projectTotal = 0;
  for (const c of comps.docs) {
    const feats = await db
      .collection(`projects/${projectId}/components/${c.id}/features`)
      .get();
    const total = feats.docs
      .filter((f) => isIncluded(f.data()))
      .reduce((s, f) => s + Number(f.data().amountKobo ?? 0), 0);
    if (total !== Number(c.data().estimatedCostKobo ?? 0)) {
      await c.ref.update({ estimatedCostKobo: total });
    }
    projectTotal += total;
  }

  await db.doc(`projects/${projectId}`).update({
    estimatedCostKobo: projectTotal,
    updatedAt: FieldValue.serverTimestamp(),
  });
  return projectTotal;
}

/**
 * Finds the project a token belongs to.
 *
 * Queries on the token *hash*, so the raw token never has to be stored to be
 * looked up. The token now lives on the project, since there is no estimate
 * document to hang it on.
 */
async function findByToken(token: string) {
  const db = getFirestore();
  const snap = await db
    .collection("projects")
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

    const p = doc.data();

    if (p.reviewedAt) {
      throw new HttpsError(
        "failed-precondition",
        "This review has already been submitted. Contact Nightowl if you need to change it."
      );
    }
    const expiresMs = p.reviewExpiresAt?.toMillis?.() ?? 0;
    if (!expiresMs || expiresMs < Date.now()) {
      throw new HttpsError("failed-precondition", "This link has expired.");
    }
    if ((p.reviewAttempts ?? 0) >= MAX_ATTEMPTS) {
      throw new HttpsError(
        "resource-exhausted",
        "Too many incorrect attempts. Ask Nightowl to resend the link."
      );
    }

    if (!hashesMatch(sha256(passcode), String(p.reviewPasscodeHash ?? ""))) {
      // Count the failure before rejecting, so the limit cannot be bypassed by
      // abandoning the request.
      await doc.ref.update({ reviewAttempts: FieldValue.increment(1) });
      throw rejected();
    }

    // Reset the counter on success: a genuine reviewer who mistyped twice should
    // not carry those attempts for the life of the link.
    await doc.ref.update({ reviewAttempts: 0 });

    const scope: string[] = Array.isArray(p.reviewComponentIds)
      ? p.reviewComponentIds.map(String)
      : [];
    const features = await loadFeatures(doc.id, scope);

    const subtotal = features
      .filter((f) => f.included)
      .reduce((s, f) => s + f.amountKobo, 0);
    const errorMarginPercent = Number(p.errorMarginPercent ?? DEFAULT_ERROR_MARGIN_PERCENT);
    const nightowlPercent = Number(p.nightowlChargePercent ?? DEFAULT_NIGHTOWL_CHARGE_PERCENT);

    return {
      projectId: doc.id,
      projectNumber: p.projectNumber ?? "",
      version: p.estimateVersion ?? 1,
      reviewerName: p.reviewerName ?? null,
      subtotalKobo: subtotal,
      errorMarginPercent,
      nightowlChargesKobo: Math.round((subtotal * nightowlPercent) / 100),
      totalKobo:
        subtotal +
        Math.round((subtotal * errorMarginPercent) / 100) +
        Math.round((subtotal * nightowlPercent) / 100),
      expiresAtMs: expiresMs,
      // Every line is sent, ticked or not, so the reviewer sees the whole
      // checklist and can tick something the office missed rather than only
      // adjusting what was already priced.
      lines: features.map((f) => ({
        id: `${f.componentId}:${f.featureId}`,
        category: f.category,
        component: f.componentName,
        item: f.item,
        quantity: f.quantity,
        unitPriceKobo: f.unitPriceKobo,
        amountKobo: f.amountKobo,
        included: f.included,
        addedByReviewer: f.addedByReviewer,
      })),
    };
  }
);

// ---------------------------------------------------------------------------
// Reviewer: submit
// ---------------------------------------------------------------------------

interface SubmittedLine {
  /** `componentId:featureId` for an existing line; absent for a new one. */
  id?: string;
  item: string;
  /** Which component a new line belongs to. */
  componentId?: string;
  quantity: number;
  unitPriceKobo: number;
  included?: boolean;
  note?: string;
}

export const submitEstimateReview = onCall(
  { region: REGION, secrets: [BREVO_API_KEY], cors: true },
  async (request) => {
    const token = String(request.data?.token ?? "");
    const passcode = String(request.data?.passcode ?? "");
    const db = getFirestore();

    // Authenticated before the payload is looked at. Validating lines first
    // leaked whether a token existed, via which error came back.
    if (!token || !passcode) {
      throw new HttpsError("invalid-argument", "Token and passcode are both required.");
    }
    const doc = await findByToken(token);
    const rejected = () =>
      new HttpsError("permission-denied", "That link or passcode is not valid.");
    if (!doc) throw rejected();

    const p = doc.data();
    if (p.reviewedAt) {
      throw new HttpsError("failed-precondition", "This review has already been submitted.");
    }
    const expiresMs = p.reviewExpiresAt?.toMillis?.() ?? 0;
    if (!expiresMs || expiresMs < Date.now()) {
      throw new HttpsError("failed-precondition", "This link has expired.");
    }
    if ((p.reviewAttempts ?? 0) >= MAX_ATTEMPTS) {
      throw new HttpsError("resource-exhausted", "Too many incorrect attempts.");
    }
    if (!hashesMatch(sha256(passcode), String(p.reviewPasscodeHash ?? ""))) {
      await doc.ref.update({ reviewAttempts: FieldValue.increment(1) });
      throw rejected();
    }

    const lines: SubmittedLine[] = Array.isArray(request.data?.lines)
      ? request.data.lines
      : [];
    const note = String(request.data?.note ?? "").trim();
    if (lines.length === 0) {
      throw new HttpsError("invalid-argument", "Send at least one line.");
    }
    if (lines.length > 400) {
      throw new HttpsError("invalid-argument", "Too many lines in one submission.");
    }

    const scope: string[] = Array.isArray(p.reviewComponentIds)
      ? p.reviewComponentIds.map(String)
      : [];
    const existing = await loadFeatures(doc.id, scope);
    const byKey = new Map(existing.map((f) => [`${f.componentId}:${f.featureId}`, f]));

    let batch = db.batch();
    let ops = 0;
    let changed = 0;
    let added = 0;
    const commitIfFull = async () => {
      if (ops >= 400) {
        await batch.commit();
        batch = db.batch();
        ops = 0;
      }
    };

    const seen = new Set<string>();

    for (const line of lines) {
      const quantity = Math.max(0, Number(line.quantity) || 0);
      const unitPriceKobo = Math.max(0, Math.round(Number(line.unitPriceKobo) || 0));
      const amountKobo = quantity * unitPriceKobo;
      const included = line.included !== false;

      const prev = line.id ? byKey.get(line.id) : undefined;
      if (prev) {
        seen.add(line.id!);
        const moved =
          prev.quantity !== quantity ||
          prev.unitPriceKobo !== unitPriceKobo ||
          prev.included !== included;
        if (moved) changed += 1;

        batch.update(
          db.doc(
            `projects/${doc.id}/components/${prev.componentId}/features/${prev.featureId}`
          ),
          {
            quantity,
            unitPriceKobo,
            amountKobo,
            included,
            // Only stamped when the figure actually moved, so an untouched line is
            // not flagged for the admin's attention.
            ...(moved
              ? {
                  reviewerNote: line.note ?? null,
                  reviewedFromKobo: prev.amountKobo,
                  reviewedByExternal: true,
                }
              : {}),
          }
        );
        ops += 1;
        await commitIfFull();
        continue;
      }

      /*
       * A new line needs a component to live under, and the reviewer says which.
       *
       * Checked against what they were actually shown, so a component id cannot be
       * used to write into part of the project outside the review's scope. Falling
       * back to "the first component" was wrong: the client sends the group the
       * reviewer clicked "Add to" under, and quietly filing a closet handle beneath
       * the kitchen is worse than refusing, because nobody would notice.
       *
       * The single-component case still falls through, since there is only one
       * answer it could be.
       */
      const requested =
        line.componentId &&
        existing.find((f) => f.componentId === line.componentId)?.componentId;
      const onlyOne =
        existing.length > 0 &&
        existing.every((f) => f.componentId === existing[0].componentId)
          ? existing[0].componentId
          : undefined;
      const target = requested || onlyOne;
      if (!target) {
        throw new HttpsError(
          "invalid-argument",
          `Could not tell which component "${String(line.item ?? "a new line").slice(0, 60)}" belongs to. Reload the link and add it again.`
        );
      }

      added += 1;
      batch.set(
        db.collection(`projects/${doc.id}/components/${target}/features`).doc(),
        {
          item: String(line.item ?? "").slice(0, 200),
          kind: "material",
          actualQuantity: null,
          quantity,
          unitPriceKobo,
          amountKobo,
          included,
          order: 9000 + added,
          addedByReviewer: true,
          reviewerNote: line.note ?? null,
          createdAt: FieldValue.serverTimestamp(),
          createdBy: "external:reviewer",
        }
      );
      ops += 1;
      await commitIfFull();
    }

    // A line the reviewer left out is unticked rather than deleted: the office
    // wrote it for a reason, and removing it outright would hide the disagreement.
    for (const f of existing) {
      const key = `${f.componentId}:${f.featureId}`;
      if (seen.has(key) || !f.included) continue;
      batch.update(
        db.doc(`projects/${doc.id}/components/${f.componentId}/features/${f.featureId}`),
        {
          included: false,
          reviewerNote: "Excluded by reviewer",
          reviewedFromKobo: f.amountKobo,
          reviewedByExternal: true,
        }
      );
      ops += 1;
      changed += 1;
      await commitIfFull();
    }

    if (ops > 0) await batch.commit();

    // Totals are rebuilt from what is now ticked, rather than from the submitted
    // payload, so the stored figure is the sum of the rows that actually exist.
    const subtotal = await rollUp(doc.id);
    const errorMarginPercent = Number(p.errorMarginPercent ?? DEFAULT_ERROR_MARGIN_PERCENT);
    const nightowlPercent = Number(p.nightowlChargePercent ?? DEFAULT_NIGHTOWL_CHARGE_PERCENT);
    const errorMarginKobo = Math.round((subtotal * errorMarginPercent) / 100);
    const nightowlChargesKobo = Math.round((subtotal * nightowlPercent) / 100);

    await doc.ref.update({
      estimateStatus: "reviewed",
      reviewedAt: FieldValue.serverTimestamp(),
      reviewNotes: note || null,
      // The token is cleared so the link cannot be reused after submission.
      reviewTokenHash: FieldValue.delete(),
      reviewPasscodeHash: FieldValue.delete(),
    });

    await db.collection("auditLog").add({
      actorUid: "external:reviewer",
      actorEmail: String(p.reviewEmail ?? ""),
      actorRole: "reviewer",
      action: "estimate_review_submit",
      collectionName: "projects",
      docId: doc.id,
      summary:
        `Reviewer returned ${p.projectNumber ?? "a project"}: ` +
        `${changed} changed, ${added} added, ` +
        `new total ${subtotal + errorMarginKobo + nightowlChargesKobo} kobo`,
      at: FieldValue.serverTimestamp(),
    });

    // Best effort: a mail failure must not fail a submission that has been written.
    try {
      const company = await companyDetails();
      const html = renderEmail({
        company,
        eyebrow: "Estimate review",
        heading: "A reviewer has returned an estimate",
        body:
          paragraph(
            `${p.reviewerName || p.reviewEmail || "A reviewer"} has submitted their review of ${
              p.projectNumber ?? "a project"
            }.`
          ) +
          detailTable([
            ["Project", String(p.projectNumber ?? "")],
            ["Lines changed", String(changed)],
            ["Lines added", String(added)],
          ]) +
          totalRow(
            "Revised total",
            "₦" +
              Math.round(
                (subtotal + errorMarginKobo + nightowlChargesKobo) / 100
              ).toLocaleString("en-US")
          ) +
          (note ? paragraph(`Their note: ${note}`) : ""),
        footerNote: "Open the project in the admin to see what changed.",
      });
      await mailer().send({
        to: [{ email: company.email, name: company.name }],
        subject: `Estimate reviewed: ${p.projectNumber ?? "project"}`,
        html,
        tags: ["estimate-review"],
      });
    } catch {
      // Logged by the mailer; the review is already saved.
    }

    return {
      ok: true,
      changed,
      added,
      totalKobo: subtotal + errorMarginKobo + nightowlChargesKobo,
    };
  }
);

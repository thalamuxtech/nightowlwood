/**
 * Backfills components and estimates that carry a total but no line items.
 *
 * The demo data was seeded with `estimatedCostKobo` written straight onto each
 * component and no features beneath it, and estimates snapshotted from that state
 * came out with totals and zero lines. On screen a kitchen read "0 of 0 items
 * included" above ₦960,000, and an estimate sent for review arrived as an empty
 * table — there was nothing for the reviewer to price because nothing had ever
 * been written.
 *
 * This walks every component with a total and no features, writes the category's
 * template rows, and spreads the existing total across them so the figure the
 * component already advertised is preserved and traceable. Then it rebuilds each
 * estimate's `lines` subcollection from those features.
 *
 * Spreading rather than zeroing is deliberate for demo data specifically: the
 * totals are already quoted on approved estimates and referenced as contract
 * values, so replacing them with zero would make the dashboard disagree with
 * itself. Weighting is by a fixed profile rather than evenly, because 33 identical
 * amounts looks obviously synthetic and nobody would trust the screen.
 *
 * Idempotent: a component that already has features is skipped, so re-running
 * cannot double up.
 *
 *   GOOGLE_APPLICATION_CREDENTIALS=... node scripts/backfill-estimate-lines.js [--apply]
 *
 * Dry by default. Pass --apply to write.
 */

const admin = require("firebase-admin");
const { ESTIMATE_TEMPLATES } = require("./estimateTemplatesData");

const APPLY = process.argv.includes("--apply");

admin.initializeApp();
const db = admin.firestore();

/**
 * How a component's total is split across its template rows.
 *
 * Derived lines are handled separately — Error Margin and Nightowl Charges are
 * percentages held on the estimate, not line items, so they stay at zero here or
 * the margin would be counted twice. The lump sums (Labour, Transport, Fuel,
 * Cutting & Edging) take a fixed share because they genuinely are a large and
 * roughly predictable slice of a real job; the rest is spread over the materials.
 */
const LUMP_SHARE = 0.35;
const LUMP_ITEMS = new Set([
  "Labour",
  "Transport",
  "Fuel",
  "Cutting & Edging",
  "Transport & Wrapping",
]);

/** Percentages that live on the estimate, never as a priced row. */
const PERCENT_ITEMS = new Set(["Error Margin", "Nightowl Charges"]);

/** Round to whole naira so the UI never shows a fractional kobo price. */
const toWholeNaira = (kobo) => Math.round(kobo / 100) * 100;

/**
 * Splits a total across items, giving the earlier materials more weight.
 *
 * A kitchen's board and high-gloss cost far more than its screws, so a flat split
 * would put ₦29,000 of nails in the estimate. The 1/(i+2) curve is arbitrary but
 * monotonic, which is enough to look like a real bill of materials.
 */
function weighted(items, totalKobo) {
  if (items.length === 0 || totalKobo <= 0) return new Map();
  const weights = items.map((_, i) => 1 / (i + 2));
  const sum = weights.reduce((a, b) => a + b, 0);

  const out = new Map();
  let allocated = 0;
  items.forEach((item, i) => {
    const share =
      i === items.length - 1
        ? totalKobo - allocated // last row absorbs the rounding
        : toWholeNaira((totalKobo * weights[i]) / sum);
    out.set(item, Math.max(0, share));
    allocated += share;
  });
  return out;
}

/** Quantity and unit price that multiply back to exactly `amountKobo`. */
function priceRow(amountKobo) {
  if (amountKobo <= 0) return { quantity: 0, unitPriceKobo: 0, amountKobo: 0 };
  // Quantities are kept small and the unit price carries the value, so the
  // arithmetic on screen is exact rather than a repeating decimal.
  for (const q of [4, 3, 2, 6, 8, 1]) {
    if (amountKobo % (q * 100) === 0) {
      return { quantity: q, unitPriceKobo: amountKobo / q, amountKobo };
    }
  }
  return { quantity: 1, unitPriceKobo: amountKobo, amountKobo };
}

async function backfillComponent(projectId, compDoc) {
  const cd = compDoc.data();
  const featsRef = db.collection(
    `projects/${projectId}/components/${compDoc.id}/features`
  );
  const existing = await featsRef.get();
  if (!existing.empty) {
    return { skipped: true, reason: `already has ${existing.size} features` };
  }

  const template = ESTIMATE_TEMPLATES[cd.category];
  if (!template) return { skipped: true, reason: `unknown category ${cd.category}` };

  const total = cd.estimatedCostKobo ?? 0;

  const materials = template.items.filter(
    (t) => !LUMP_ITEMS.has(t.item) && !PERCENT_ITEMS.has(t.item)
  );
  const lumps = template.items.filter((t) => LUMP_ITEMS.has(t.item));

  const lumpTotal = lumps.length ? toWholeNaira(total * LUMP_SHARE) : 0;
  const materialTotal = total - lumpTotal;

  const amounts = new Map([
    ...weighted(
      materials.map((t) => t.item),
      materialTotal
    ),
    ...weighted(
      lumps.map((t) => t.item),
      lumpTotal
    ),
  ]);

  let batch = db.batch();
  let ops = 0;
  let included = 0;
  let checkSum = 0;

  for (let i = 0; i < template.items.length; i++) {
    const t = template.items[i];
    const amount = amounts.get(t.item) ?? 0;
    const priced = priceRow(amount);
    // Percentage rows are written so the checklist is complete, but never priced
    // or included: the estimate holds those rates itself.
    const isPercent = PERCENT_ITEMS.has(t.item);
    const include = !isPercent && priced.amountKobo > 0;
    if (include) {
      included += 1;
      checkSum += priced.amountKobo;
    }

    batch.set(featsRef.doc(), {
      item: t.item,
      kind: t.kind,
      actualQuantity: null,
      quantity: isPercent ? 0 : priced.quantity,
      unitPriceKobo: isPercent ? 0 : priced.unitPriceKobo,
      amountKobo: isPercent ? 0 : priced.amountKobo,
      included: include,
      order: i,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      createdBy: "backfill",
    });
    ops += 1;
    if (ops >= 400) {
      if (APPLY) await batch.commit();
      batch = db.batch();
      ops = 0;
    }
  }
  if (ops > 0 && APPLY) await batch.commit();

  // The component total is restated from what was actually written, so the header
  // and the rows agree even where rounding moved a naira.
  if (APPLY) {
    await compDoc.ref.update({ estimatedCostKobo: checkSum });
  }

  return {
    skipped: false,
    written: template.items.length,
    included,
    was: total,
    now: checkSum,
  };
}

/**
 * Rebuilds an estimate's line snapshot from the project's included features.
 *
 * Some seeded estimates carry no `projectId`, and others point at a project that
 * no longer exists, so the link is repaired from `projectNumber` first. Without
 * that the estimate can never render: the PDF reads the client and title off the
 * project, and the reviewer gets a document with no lines and no name on it.
 */
async function rebuildEstimate(estDoc, projectsByNumber) {
  const d = estDoc.data();
  const linesRef = db.collection(`estimates/${estDoc.id}/lines`);
  const existing = await linesRef.get();
  if (!existing.empty) {
    return { skipped: true, reason: `already has ${existing.size} lines` };
  }

  let projectId = d.projectId;
  let relinked = false;
  const byNumber = projectsByNumber.get(d.projectNumber);
  if (!projectId || !projectsByNumber.has(d.projectNumber) || projectId !== byNumber) {
    // Trust the project number over a stale or missing id: the number is what the
    // document quotes and what a person matches it by.
    if (!byNumber) return { skipped: true, reason: `no project for ${d.projectNumber}` };
    if (projectId !== byNumber) {
      projectId = byNumber;
      relinked = true;
      if (APPLY) await estDoc.ref.update({ projectId });
    }
  }

  const comps = await db.collection(`projects/${projectId}/components`).get();
  const rows = [];
  for (const c of comps.docs) {
    const feats = await db
      .collection(`projects/${projectId}/components/${c.id}/features`)
      .orderBy("order", "asc")
      .get();
    for (const f of feats.docs) {
      const x = f.data();
      const isIncluded =
        x.included === true || (x.included === undefined && (x.amountKobo ?? 0) > 0);
      if (!isIncluded) continue;
      rows.push({
        category: c.data().category,
        item: x.item ?? "",
        quantity: x.quantity ?? 0,
        unitPriceKobo: x.unitPriceKobo ?? 0,
        amountKobo: x.amountKobo ?? 0,
        actualQuantity: null,
        order: rows.length,
      });
    }
  }
  if (rows.length === 0) return { skipped: true, reason: "no included features" };

  const subtotal = rows.reduce((s, r) => s + r.amountKobo, 0);
  const errPct = d.errorMarginPercent ?? 0;
  // Prefer the stored rate; fall back to the ratio these older documents carry.
  const nowPct =
    typeof d.nightowlChargePercent === "number"
      ? d.nightowlChargePercent
      : d.subtotalKobo > 0
        ? ((d.nightowlChargesKobo ?? 0) / d.subtotalKobo) * 100
        : 0;

  const errorMarginKobo = Math.round((subtotal * errPct) / 100);
  const nightowlChargesKobo = Math.round((subtotal * nowPct) / 100);

  let batch = db.batch();
  let ops = 0;
  for (const r of rows) {
    batch.set(linesRef.doc(), r);
    ops += 1;
    if (ops >= 400) {
      if (APPLY) await batch.commit();
      batch = db.batch();
      ops = 0;
    }
  }
  if (ops > 0 && APPLY) await batch.commit();

  if (APPLY) {
    await estDoc.ref.update({
      subtotalKobo: subtotal,
      errorMarginKobo,
      nightowlChargePercent: nowPct,
      nightowlChargesKobo,
      totalKobo: subtotal + errorMarginKobo + nightowlChargesKobo,
    });
  }

  return {
    skipped: false,
    relinked,
    lines: rows.length,
    was: d.totalKobo,
    now: subtotal + errorMarginKobo + nightowlChargesKobo,
  };
}

(async () => {
  console.log(APPLY ? "APPLYING changes\n" : "DRY RUN (pass --apply to write)\n");

  const projects = await db.collection("projects").get();
  for (const p of projects.docs) {
    const comps = await db.collection(`projects/${p.id}/components`).get();
    if (comps.empty) continue;
    console.log(`${p.data().projectNumber} — ${p.data().title}`);

    let projectTotal = 0;
    for (const c of comps.docs) {
      const r = await backfillComponent(p.id, c);
      const name = c.data().name;
      if (r.skipped) {
        console.log(`   · ${name}: skipped (${r.reason})`);
        projectTotal += c.data().estimatedCostKobo ?? 0;
      } else {
        console.log(
          `   + ${name}: ${r.written} rows, ${r.included} included, ` +
            `₦${(r.was / 100).toLocaleString()} → ₦${(r.now / 100).toLocaleString()}`
        );
        projectTotal += r.now;
      }
    }
    if (APPLY) await p.ref.update({ estimatedCostKobo: projectTotal });
    console.log(`   = project total ₦${(projectTotal / 100).toLocaleString()}\n`);
  }

  // Built after the component pass so the features it wrote are visible.
  const projectsByNumber = new Map();
  for (const p of (await db.collection("projects").get()).docs) {
    projectsByNumber.set(p.data().projectNumber, p.id);
  }

  console.log("Estimates:");
  const estimates = await db.collection("estimates").get();
  for (const e of estimates.docs) {
    const r = await rebuildEstimate(e, projectsByNumber);
    const label = `${e.data().projectNumber} v${e.data().version} (${e.data().status})`;
    if (r.skipped) console.log(`   · ${label}: skipped (${r.reason})`);
    else
      console.log(
        `   + ${label}: ${r.lines} lines, ` +
          `₦${((r.was ?? 0) / 100).toLocaleString()} → ₦${(r.now / 100).toLocaleString()}` +
          (r.relinked ? "  [relinked to project]" : "")
      );
  }

  console.log(APPLY ? "\nDone." : "\nDry run complete. Re-run with --apply.");
})().catch((e) => {
  console.error("FAILED:", e);
  process.exit(1);
});

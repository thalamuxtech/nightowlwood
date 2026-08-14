import {
  collection,
  deleteDoc,
  doc,
  getDocs,
  serverTimestamp,
  setDoc,
  writeBatch,
  type Firestore,
} from "firebase/firestore";
import { COL } from "./collections";
import { writeAudit, type AuditActor } from "./audit";
import { PRODUCT_CATEGORIES, type BoardType, type ProductCategory } from "./enums";
import {
  ESTIMATE_TEMPLATES,
  type CategoryTemplate,
  type EstimateItemKind,
  type TemplateItem,
} from "./estimateTemplates";

/**
 * Estimate templates, editable by an admin.
 *
 * They were a hard-coded TypeScript constant, so changing a line or a price meant changing code and
 * redeploying — which is not a thing the workshop can do. Now they live in Firestore and are edited
 * on a screen, and a project picks up the change the next time a component is added.
 *
 * ## The code constant is still here, as the seed and the fallback
 *
 * `ESTIMATE_TEMPLATES` remains the starting point: it seeds the collection on first use, and it is
 * what `loadTemplates` falls back to when nothing has been saved. That means a fresh project, or one
 * where somebody deleted every template, still offers the six the workshop actually uses rather than
 * an empty picker.
 *
 * ## Prices
 *
 * A template line can carry a default unit price, which the estimate pre-fills. The old templates
 * carried names only, so every figure was typed on every project — the same eight board prices, over
 * and over, from memory. A default is not a fixed price: whoever builds the estimate types over it
 * when a supplier moves.
 *
 * ## Boards
 *
 * `isBoard` marks a line as boards, which is what feeds the cutting-and-edging quantity. The lines
 * are itemised per material — MDF, Egger, MFC 9×7 Starwood, and so on — rather than one generic
 * "Board", because they are bought at genuinely different prices and cut at genuinely different
 * rates, and one blended line hides both.
 */

export interface StoredTemplateItem extends TemplateItem {
  /** Pre-filled on the estimate. Zero means "no default", not "free". */
  defaultPriceKobo?: number;
  /** True when this line is boards, so its quantity feeds the cutting charge. */
  isBoard?: boolean;
  /** Which board, when it is one — this is what prices the cutting per material. */
  boardType?: BoardType;
}

export interface StoredTemplate {
  category: ProductCategory;
  label: string;
  items: StoredTemplateItem[];
  updatedAtMs: number | null;
}

/**
 * Default prices from the workshop's own cost-estimate spreadsheet, in kobo.
 *
 * Keyed by the item name as it appears on the template. These are the figures the workshop was
 * already using on paper, so a seeded estimate starts from what they actually pay rather than from
 * zero. They are a starting point and every one is editable.
 */
const SHEET_PRICES: Record<string, number> = {
  // Boards, per sheet.
  MDF: 28_000_00,
  "High Glossy": 38_000_00,
  Egger: 32_000_00,
  "MFC (9x7) Starwood": 155_000_00,
  "MFC (9x7) Starwood SNK": 169_000_00,
  "MFC (9x4) Gizir": 239_500_00,
  "Quarter Normal": 6_500_00,
  "Quarter Original": 13_000_00,
  "Quarter Plywood": 13_000_00,
  Kwali: 23_000_00,
  "Aluko board": 22_000_00,
  "Wall Board": 27_000_00,
  PVC: 7_000_00,
  // Consumables and fittings.
  "Edge Tape": 17_000_00,
  Rollers: 4_500_00,
  Angles: 6_000_00,
  Nails: 20_000_00,
  "super glue": 1_000_00,
  Hinges: 800_00,
  "Hydraulic Lift": 1_500_00,
  "Screw 2 inches": 3_000_00,
  "Screw 1 and 1/4": 2_500_00,
  "Screws 5/8": 5_000_00,
  "Screw 2 1/2 inch": 2_000_00,
  "Screws3 inch": 7_000_00,
  Fisher: 1_000_00,
  "Marble top": 85_000_00,
  Glass: 100_000_00,
  Mirror: 100_000_00,
  LED: 18_500_00,
  "LED Profile": 8_000_00,
  "Copper Cable": 500_00,
  "Pressing Gum": 8_000_00,
  "Push to Open": 900_00,
  Handle: 2_000_00,
  Handles: 2_000_00,
  "Angle Rubber Wall Mount": 5_000_00,
  Legs: 8_000_00,
  Colish: 2_000_00,
  // Lump sums and services.
  "Cutting & Edging": 3_200_00,
  Transport: 300_000_00,
  "Transport & Wrapping": 300_000_00,
  Fuel: 1_380_00,
  Labour: 350_000_00,
};

/**
 * Board lines, itemised per material.
 *
 * Replaces the single generic "Board" row. Each carries the board type, so the cutting charge is
 * priced at that material's own rate — MFC 9×7 at ₦6,400 a board against Kwali at ₦1,500 — rather
 * than at one blended figure that is wrong for both.
 */
const BOARD_LINES: Array<{ item: string; boardType: BoardType }> = [
  { item: "MDF", boardType: "mdf" },
  { item: "High Glossy", boardType: "high_glossy" },
  { item: "Egger", boardType: "egger" },
  { item: "MFC (9x7) Starwood", boardType: "mfc_9x7" },
  { item: "MFC (9x7) Starwood SNK", boardType: "mfc_9x7" },
  { item: "MFC (9x4) Gizir", boardType: "mfc_9x4" },
  { item: "Quarter Normal", boardType: "quarter" },
  { item: "Quarter Original", boardType: "quarter" },
  { item: "Kwali", boardType: "kwali" },
];

/** Item names in the code templates that the itemised board lines replace. */
const GENERIC_BOARD_ITEMS = new Set(["board", "quarter plywood", "wall board"]);

const norm = (s: string) => s.trim().toLowerCase();

/**
 * The code template, enriched into what gets stored.
 *
 * Three changes on the way through: the generic "Board" row becomes one row per material, every row
 * gains its spreadsheet price where there is one, and board rows are marked so they feed the cutting
 * charge.
 */
export function enrichTemplate(
  category: ProductCategory,
  base: CategoryTemplate
): StoredTemplateItem[] {
  const out: StoredTemplateItem[] = [];
  let boardsInserted = false;

  /*
   * Names already placed by the board expansion.
   *
   * Several templates name a board explicitly *as well as* carrying the generic "Board" row —
   * "High Glossy" is in every one of them. Without this the expansion inserts High Glossy and then
   * the template's own row inserts it again, so the estimate carries the same material twice and
   * whoever prices it fills in one of them.
   */
  const placed = new Set<string>();

  for (const item of base.items) {
    if (GENERIC_BOARD_ITEMS.has(norm(item.item))) {
      /*
       * The generic board row expands into the itemised list, once.
       *
       * A template naming both "Board" and "Quarter Plywood" would otherwise insert the whole board
       * list twice. The expansion happens at the position of the first one, which keeps the
       * spreadsheet's ordering — boards at the top.
       */
      if (boardsInserted) continue;
      boardsInserted = true;
      for (const b of BOARD_LINES) {
        out.push({
          item: b.item,
          kind: "material",
          isBoard: true,
          boardType: b.boardType,
          defaultPriceKobo: SHEET_PRICES[b.item],
        });
        placed.add(norm(b.item));
      }
      continue;
    }

    // Already inserted by the board expansion — a template naming High Glossy directly as well as
    // carrying the generic row would otherwise list it twice.
    if (placed.has(norm(item.item))) continue;

    out.push({
      item: item.item,
      kind: item.kind,
      defaultPriceKobo: SHEET_PRICES[item.item],
    });
    placed.add(norm(item.item));
  }

  return out;
}

/** The six code templates, enriched — the seed and the fallback. */
export function defaultTemplates(): StoredTemplate[] {
  return PRODUCT_CATEGORIES.map((category) => ({
    category,
    label: ESTIMATE_TEMPLATES[category].label,
    items: enrichTemplate(category, ESTIMATE_TEMPLATES[category]),
    updatedAtMs: null,
  }));
}

/**
 * Every template, from Firestore, falling back to the code defaults.
 *
 * The fallback is per template rather than all-or-nothing: a workshop that has edited the kitchen
 * and never touched the others gets their edited kitchen and the five defaults, rather than losing
 * the five because one was saved.
 */
export async function loadTemplates(db: Firestore): Promise<StoredTemplate[]> {
  const snap = await getDocs(collection(db, COL.estimateTemplates));
  const stored = new Map<string, StoredTemplate>();

  for (const d of snap.docs) {
    const x = d.data();
    stored.set(d.id, {
      category: d.id as ProductCategory,
      label: (x.label as string) ?? d.id,
      items: ((x.items as StoredTemplateItem[]) ?? []).map((i) => ({
        item: i.item ?? "",
        kind: (i.kind as EstimateItemKind) ?? "material",
        defaultPriceKobo: i.defaultPriceKobo ?? undefined,
        isBoard: i.isBoard ?? false,
        boardType: i.boardType ?? undefined,
      })),
      updatedAtMs:
        (x.updatedAt as { toMillis?: () => number } | undefined)?.toMillis?.() ?? null,
    });
  }

  return defaultTemplates().map((fallback) => stored.get(fallback.category) ?? fallback);
}

/** Writes one template. */
export async function saveTemplate(
  db: Firestore,
  actor: AuditActor,
  template: StoredTemplate
): Promise<void> {
  if (!template.label.trim()) throw new Error("A template needs a name.");
  if (template.items.length === 0) {
    throw new Error("A template with no lines would add an empty component.");
  }
  for (const item of template.items) {
    if (!item.item.trim()) throw new Error("Every line needs a name.");
    if (item.defaultPriceKobo !== undefined && item.defaultPriceKobo < 0) {
      throw new Error(`${item.item} has a negative price.`);
    }
  }

  await setDoc(
    doc(db, COL.estimateTemplates, template.category),
    {
      label: template.label.trim(),
      items: template.items.map((i) => ({
        item: i.item.trim(),
        kind: i.kind,
        // Written as null rather than omitted, so a price cleared on the screen is cleared in the
        // document rather than falling back to whatever was there before.
        defaultPriceKobo: i.defaultPriceKobo ?? null,
        isBoard: i.isBoard ?? false,
        boardType: i.boardType ?? null,
      })),
      updatedAt: serverTimestamp(),
      updatedBy: actor.uid,
    },
    { merge: true }
  );

  await writeAudit(db, {
    actor,
    action: "settings_change",
    collectionName: COL.estimateTemplates,
    docId: template.category,
    summary: `Estimate template "${template.label.trim()}" saved with ${template.items.length} line(s)`,
    after: { label: template.label.trim(), items: template.items.length },
  });
}

/**
 * Restores one template to the code default.
 *
 * Deleting the document rather than writing the defaults back, so `loadTemplates` falls through to
 * the code — which means a later change to the shipped defaults reaches a workshop that reset,
 * instead of freezing them at whatever the defaults were on the day they pressed the button.
 */
export async function resetTemplate(
  db: Firestore,
  actor: AuditActor,
  category: ProductCategory
): Promise<void> {
  await deleteDoc(doc(db, COL.estimateTemplates, category));
  await writeAudit(db, {
    actor,
    action: "settings_change",
    collectionName: COL.estimateTemplates,
    docId: category,
    summary: `Estimate template "${category}" reset to the standard list`,
  });
}

/** Seeds every template that has not been saved yet. Idempotent. */
export async function seedTemplates(
  db: Firestore,
  actor: AuditActor
): Promise<{ created: number }> {
  const snap = await getDocs(collection(db, COL.estimateTemplates));
  const have = new Set(snap.docs.map((d) => d.id));

  const batch = writeBatch(db);
  let created = 0;
  for (const t of defaultTemplates()) {
    if (have.has(t.category)) continue;
    batch.set(doc(db, COL.estimateTemplates, t.category), {
      label: t.label,
      items: t.items.map((i) => ({
        item: i.item,
        kind: i.kind,
        defaultPriceKobo: i.defaultPriceKobo ?? null,
        isBoard: i.isBoard ?? false,
        boardType: i.boardType ?? null,
      })),
      createdAt: serverTimestamp(),
      createdBy: actor.uid,
    });
    created += 1;
  }

  if (created > 0) {
    await batch.commit();
    await writeAudit(db, {
      actor,
      action: "settings_change",
      collectionName: COL.estimateTemplates,
      docId: "seed",
      summary: `Seeded ${created} estimate template(s) from the standard list`,
    });
  }

  return { created };
}

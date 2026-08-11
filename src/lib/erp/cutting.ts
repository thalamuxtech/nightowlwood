import {
  collection,
  doc,
  getDoc,
  getDocs,
  serverTimestamp,
  setDoc,
  updateDoc,
  type Firestore,
} from "firebase/firestore";
import { COL, componentsPath, featuresPath } from "./collections";
import { isIncluded, saveFeature } from "./projects";
import {
  BOARD_TYPE_LABELS,
  CE_RATED_BOARD_TYPES,
  type BoardType,
} from "./enums";
import { lineAmountKobo, sumKobo } from "./money";
import {
  DEFAULT_BOARD_RATE_CARD,
  SETTINGS_DOC,
  type BoardRateCardSettings,
} from "./settings";
import { writeAudit, type AuditActor } from "./audit";

/**
 * The cutting & edging charge, priced from the board counts.
 *
 * This exists because C&E was being typed twice: once as a service job line and again as a
 * cost item on the project estimate, at whatever figure whoever was quoting remembered.
 * The two disagreed, and the estimate is the document the client sees.
 *
 * So the estimate's cutting line is **derived, not entered**: its quantity is the boards
 * the user actually put in, and its rate is the one the Services rate card holds for that
 * board. Nobody types the figure, so nobody can type a different one.
 *
 * One line per board type rather than a blended rate, because the rates genuinely differ —
 * Bangaji is more than twice MDF. A single average would overcharge the cheap boards and
 * undercharge the dear ones, which on a mixed job is a real error in both directions.
 */

export interface CuttingLine {
  boardType: BoardType;
  label: string;
  quantity: number;
  ratePerBoardKobo: number;
  amountKobo: number;
  /** True when the rate card has no figure for this board, so it prices at zero. */
  rateMissing: boolean;
}

export interface CuttingCharge {
  lines: CuttingLine[];
  totalBoards: number;
  totalKobo: number;
  /** Board types present on the job that the rate card does not price. */
  unratedBoardTypes: BoardType[];
}

/** The C&E rate card, falling back to the seeded figures. */
export async function boardRateCard(
  db: Firestore
): Promise<BoardRateCardSettings> {
  try {
    const snap = await getDoc(doc(db, COL.settings, SETTINGS_DOC.boardRateCard));
    if (!snap.exists()) return DEFAULT_BOARD_RATE_CARD;
    const d = snap.data();
    return {
      ratesKobo: {
        // Seeded rates underneath the saved ones, so a board type added to the system
        // after the card was last saved still prices rather than silently costing nothing.
        ...DEFAULT_BOARD_RATE_CARD.ratesKobo,
        ...((d.ratesKobo ?? {}) as Partial<Record<BoardType, number>>),
      },
      allowManualOverride:
        d.allowManualOverride ?? DEFAULT_BOARD_RATE_CARD.allowManualOverride,
    };
  } catch {
    return DEFAULT_BOARD_RATE_CARD;
  }
}

/**
 * Prices cutting & edging from a set of board counts.
 *
 * Pure, so the estimate screen can show the figure as counts are typed and the write path
 * can compute the same one — the two cannot disagree because there is only one function.
 *
 * A board type with a count but no rate is reported in `unratedBoardTypes` rather than
 * quietly priced at zero. Zero would put the boards on the estimate for nothing, and the
 * first anyone knew of it would be the invoice.
 */
export function computeCuttingCharge(
  counts: Partial<Record<BoardType, number>>,
  ratesKobo: Partial<Record<BoardType, number>>
): CuttingCharge {
  const lines: CuttingLine[] = [];
  const unrated: BoardType[] = [];

  // Rate-card order, so the estimate lists boards the way they are quoted rather than in
  // whatever order the counts object happens to enumerate.
  const ordered: BoardType[] = [
    ...CE_RATED_BOARD_TYPES,
    // Anything counted that the card does not list, so it is visible rather than dropped.
    ...(Object.keys(counts) as BoardType[]).filter(
      (t) => !(CE_RATED_BOARD_TYPES as readonly string[]).includes(t)
    ),
  ];

  for (const boardType of ordered) {
    const quantity = counts[boardType] ?? 0;
    if (!Number.isFinite(quantity) || quantity <= 0) continue;

    const ratePerBoardKobo = ratesKobo[boardType] ?? 0;
    const rateMissing = ratePerBoardKobo <= 0;
    if (rateMissing) unrated.push(boardType);

    lines.push({
      boardType,
      label: BOARD_TYPE_LABELS[boardType] ?? boardType,
      quantity,
      ratePerBoardKobo,
      amountKobo: lineAmountKobo(quantity, ratePerBoardKobo),
      rateMissing,
    });
  }

  return {
    lines,
    totalBoards: lines.reduce((s, l) => s + l.quantity, 0),
    totalKobo: sumKobo(lines.map((l) => l.amountKobo)),
    unratedBoardTypes: unrated,
  };
}

/**
 * The project's board totals, read from the cost items ticked as boards.
 *
 * This is where the quantity for cutting & edging comes from. The alternative — a separate
 * board count typed on the project — meant the same boards were entered twice and the two
 * figures disagreed, so the cutting charge was computed against a number nobody had checked
 * against the items actually being bought.
 *
 * Only *included* lines count, matching how the estimate totals work: a line the client
 * turned down is not boards anybody is cutting.
 */
export async function boardCountsFromCostItems(
  db: Firestore,
  projectId: string
): Promise<{
  counts: Partial<Record<BoardType, number>>;
  /** Ticked-as-board lines with no material set, which cannot be priced. */
  untypedLines: Array<{ componentName: string; item: string; quantity: number }>;
}> {
  const compSnap = await getDocs(collection(db, componentsPath(projectId)));
  const counts: Partial<Record<BoardType, number>> = {};
  const untypedLines: Array<{ componentName: string; item: string; quantity: number }> = [];

  for (const comp of compSnap.docs) {
    const componentName = (comp.data().name as string) ?? "Component";
    const featSnap = await getDocs(collection(db, featuresPath(projectId, comp.id)));

    for (const f of featSnap.docs) {
      const x = f.data();
      if (x.isBoard !== true) continue;

      // Same inclusion rule as the estimate rollups: an unticked line is not being bought,
      // so its boards are not being cut.
      if (!isIncluded({ included: x.included, amountKobo: x.amountKobo })) continue;

      const quantity = Number(x.quantity) || 0;
      if (quantity <= 0) continue;

      const boardType = x.boardType as BoardType | undefined;
      if (!boardType) {
        // Reported rather than dropped: a board line with no material silently contributes
        // nothing to the cutting charge, and the estimate would be short by its whole value.
        untypedLines.push({ componentName, item: (x.item as string) ?? "line", quantity });
        continue;
      }

      counts[boardType] = (counts[boardType] ?? 0) + quantity;
    }
  }

  return { counts, untypedLines };
}

/**
 * Prices cutting & edging from the project's own cost items.
 *
 * The composed operation the estimate screen actually wants: read the board lines, price
 * them, write the charge onto the cutting line. Nobody enters a board count separately, so
 * there is only one set of board figures on the project and it is the one being bought.
 */
export async function refreshCuttingFromCostItems(
  db: Firestore,
  actor: AuditActor,
  projectId: string
): Promise<
  CuttingCharge & {
    billedToComponent?: string;
    untypedLines: Array<{ componentName: string; item: string; quantity: number }>;
  }
> {
  const { counts, untypedLines } = await boardCountsFromCostItems(db, projectId);
  const saved = await saveProjectBoardCounts(db, actor, projectId, counts);
  return { ...saved, untypedLines };
}

/**
 * Saves a project's board counts and writes the charge onto its cutting line.
 *
 * The charge is computed here rather than accepted from the caller, which is the whole
 * point: the estimate's cutting figure is the board counts times the Services rate card,
 * and nothing else. A screen that could pass its own number would be able to make the
 * estimate disagree with the job again.
 *
 * **The figure is written to the component's "Cutting & Edging" feature row**, which is
 * what makes it reach the estimate and the invoice. Storing it only on the project — as
 * this first did — left it displayed on screen and billed nowhere: the six category
 * templates already seed a hand-priced `Cutting & Edging` row, so cutting was either
 * charged at whatever somebody typed there or not charged at all. Driving that same row
 * means there is exactly one cutting figure, it is derived, and it flows through the
 * rollup that already exists.
 *
 * `cuttingChargeKobo` on the project is kept as a cached read for the panel, never as the
 * billing source. The feature row is the billing source, so nothing double-counts.
 */
export async function saveProjectBoardCounts(
  db: Firestore,
  actor: AuditActor,
  projectId: string,
  counts: Partial<Record<BoardType, number>>
): Promise<CuttingCharge & { billedToComponent?: string }> {
  const card = await boardRateCard(db);
  const charge = computeCuttingCharge(counts, card.ratesKobo);

  // Zeroes are dropped rather than stored: a board type the job does not use should be
  // absent, not present-and-zero, so the stored counts read like the form was filled in.
  const cleaned: Record<string, number> = {};
  for (const [k, v] of Object.entries(counts)) {
    if (Number.isFinite(v) && (v as number) > 0) cleaned[k] = v as number;
  }

  await updateDoc(doc(db, COL.projects, projectId), {
    boardCounts: cleaned,
    cuttingChargeKobo: charge.totalKobo,
    updatedAt: serverTimestamp(),
    updatedBy: actor.uid,
  });

  // Push the figure onto the cutting row so it is actually billed.
  const billedTo = await applyCuttingToFeature(db, actor, projectId, charge.totalKobo);

  await writeAudit(db, {
    actor,
    action: "update",
    collectionName: COL.projects,
    docId: projectId,
    summary:
      `Set board counts: ${charge.totalBoards} board(s), ` +
      `cutting & edging ${charge.totalKobo} kobo` +
      (billedTo ? ` billed on "${billedTo}"` : " — no cutting line found to bill it on") +
      (charge.unratedBoardTypes.length
        ? ` (${charge.unratedBoardTypes.length} board type(s) have no rate)`
        : ""),
    after: { boardCounts: cleaned, cuttingChargeKobo: charge.totalKobo },
  });

  return { ...charge, billedToComponent: billedTo };
}

/**
 * Writes the cutting charge onto the project's `Cutting & Edging` feature row.
 *
 * Finds the row by name across the project's components — `isCuttingFeature` matches the
 * spellings the templates and hand-entry produce. The first component that has one wins,
 * and every other cutting row is zeroed and unticked, so the charge appears exactly once
 * however many components carry the template row. Without that sweep, a two-component
 * project would bill cutting twice.
 *
 * Goes through `saveFeature`, not a direct write, so the component and project rollups
 * move by the delta the same way any other priced line does. Re-implementing the rollup
 * here is what would let the totals drift.
 */
async function applyCuttingToFeature(
  db: Firestore,
  actor: AuditActor,
  projectId: string,
  totalKobo: number
): Promise<string | undefined> {
  const compSnap = await getDocs(collection(db, componentsPath(projectId)));

  let billedTo: string | undefined;

  for (const comp of compSnap.docs) {
    const featSnap = await getDocs(
      collection(db, featuresPath(projectId, comp.id))
    );
    const cuttingRows = featSnap.docs.filter((f) =>
      isCuttingFeature(f.data().item as string | undefined)
    );
    if (cuttingRows.length === 0) continue;

    for (const row of cuttingRows) {
      // The first cutting row found carries the whole charge; any others are cleared so
      // the same work cannot be billed twice on one estimate.
      const isTheOne = billedTo === undefined && row.id === cuttingRows[0].id;
      const amount = isTheOne ? totalKobo : 0;

      await saveFeature(db, actor, projectId, comp.id, row.id, {
        quantity: 1,
        unitPriceKobo: amount,
        // Ticked only when it carries a figure: a zero cutting line on the estimate is
        // noise, and an unticked one is excluded from the rollup entirely.
        included: amount > 0,
      });

      if (isTheOne) billedTo = (comp.data().name as string) ?? "component";
    }
  }

  return billedTo;
}

/**
 * Saves the cutting & edging rate card.
 *
 * One card, read by the service job line and the project estimate alike. Changing a rate
 * affects what is quoted from now on and never restates an invoice already raised, because
 * an invoice stores its own line amounts.
 */
export async function saveBoardRateCard(
  db: Firestore,
  actor: AuditActor,
  next: BoardRateCardSettings
): Promise<void> {
  for (const [board, kobo] of Object.entries(next.ratesKobo)) {
    if ((kobo ?? 0) < 0) {
      throw new Error(`The rate for ${board} cannot be negative.`);
    }
  }

  await setDoc(doc(db, COL.settings, SETTINGS_DOC.boardRateCard), next, {
    merge: true,
  });

  await writeAudit(db, {
    actor,
    action: "settings_change",
    collectionName: COL.settings,
    docId: SETTINGS_DOC.boardRateCard,
    summary: "Updated the cutting & edging rate card",
    after: { ratesKobo: next.ratesKobo, allowManualOverride: next.allowManualOverride },
  });
}

/**
 * The feature row name the locked cutting line uses.
 *
 * Matched on to find and refresh the line rather than storing a flag, because template
 * rows arrive from `estimateTemplates` and one of them is already called this. Recognising
 * the name means an existing estimate's cutting row becomes the managed one rather than
 * ending up alongside a duplicate.
 */
export const CUTTING_FEATURE_ITEM = "Cutting & Edging";

/** True when a feature row is the managed cutting line. */
export function isCuttingFeature(item: string | undefined | null): boolean {
  if (!item) return false;
  const slug = item.toLowerCase().replace(/[^a-z]/g, "");
  // Covers "Cutting & Edging", "Cutting and Edging", "C&E", "cutting/edging".
  return (
    slug === "cuttingedging" ||
    slug === "cuttingandedging" ||
    slug === "ce" ||
    slug === "cuttingedgingservice"
  );
}

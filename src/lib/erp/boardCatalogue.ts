import { doc, getDoc, serverTimestamp, setDoc, type Firestore } from "firebase/firestore";
import { COL } from "./collections";
import { writeAudit, type AuditActor } from "./audit";
import { BOARD_TYPE_LABELS, BOARD_TYPES, type BoardType } from "./enums";

/**
 * The board catalogue — what each material looks like, for the public site.
 *
 * Boards were text-only everywhere: a customer filling in a cutting list picked "MFC 9×7
 * (Bangaji)" from a dropdown with nothing to look at, and the site described the workshop's
 * materials in prose. For a business whose product is a sheet of board, that is the one thing
 * worth showing.
 *
 * ## Why the image is a URL and not an upload here
 *
 * This module stores a *reference*. The generated swatches under `/images/boards/` ship with
 * the app and are the default, so every board has something to show from the first deploy; an
 * admin replaces one by pointing it at a real photograph — uploaded through Storage, or hosted
 * anywhere. Keeping it a URL means the catalogue does not depend on Storage being configured,
 * and a broken link degrades to the swatch rather than to a blank card.
 *
 * ## Why it is settings rather than a collection
 *
 * There are twelve boards and the list is fixed by `BOARD_TYPES`. A collection would let
 * someone create a thirteenth that no rate card, cutting calculation or reconciliation knows
 * about. One document keyed by board type cannot drift from the enum.
 */

export interface BoardCatalogueEntry {
  /** What the customer sees. Defaults to the workshop's own label for the type. */
  displayName: string;
  /** One line, for a card on the site. */
  blurb: string;
  /** Image URL. Defaults to the generated swatch that ships with the app. */
  imageUrl: string;
  /** Typical sheet size as sold, e.g. "8ft × 4ft". Free text — sizes vary by supplier. */
  sheetSize?: string;
  /** Common thicknesses, e.g. "18mm, 15mm". */
  thickness?: string;
  /** Shown on the public site. Off for a board the workshop no longer stocks. */
  published: boolean;
}

export interface BoardCatalogueSettings {
  /** Whether the materials section appears on the public site at all. */
  enabled: boolean;
  entries: Partial<Record<BoardType, BoardCatalogueEntry>>;
}

/** The swatch that ships with the app for a board type. */
export function defaultBoardImage(type: BoardType): string {
  // `other` has no swatch — it is a catch-all for a material nobody named, so there is
  // nothing to draw. It falls back to MDF, the plainest of the sheets.
  const slug = type === "other" ? "mdf" : type;
  return `/images/boards/${slug}.svg`;
}

/**
 * True for a URL that is safe to put in an `src`.
 *
 * A path or an http(s) address only. `saveBoardCatalogue` rejects anything else, but this is
 * checked again at read time because the save path is not the only way a value can arrive — a
 * document written directly, or restored from a backup, bypasses it entirely. Belt and braces on
 * a string that ends up in an attribute on a public page.
 */
export function isSafeImageUrl(url: string): boolean {
  const trimmed = url.trim();
  return (
    trimmed.startsWith("/") ||
    trimmed.startsWith("https://") ||
    trimmed.startsWith("http://")
  );
}

/**
 * Starting descriptions.
 *
 * Written from what the workshop actually sells and what a contractor needs to know to choose:
 * where it is used and what it costs relative to the others. Editable, because the person at
 * the saw knows this better than a default does.
 */
const SEED_BLURBS: Partial<Record<BoardType, string>> = {
  egger: "Hard-wearing decorative faced board. The usual choice for kitchen carcasses and shop fittings that take daily use.",
  mdf: "Smooth, dense and paint-ready. Best where the finish is sprayed or wrapped rather than left as the board face.",
  hdf: "Denser than MDF and stiffer over a span. Used for doors and panels that must not bow.",
  mfc_9x7: "Melamine faced chipboard in the larger sheet — what the workshop calls Bangaji. The workhorse for wardrobes and full-height units.",
  mfc_9x4: "The same melamine face in the smaller sheet, for narrower runs with less offcut.",
  kwali: "Cost-effective plywood for backing, framing and anywhere the face will be covered.",
  quarter: "Thin plywood for cabinet backs, drawer bottoms and templates.",
  high_glossy: "Mirror-finish faced board for statement kitchen fronts and reception joinery.",
  marine: "Moisture-resistant plywood for kitchens, bathrooms and anywhere near water.",
  aluko: "Locally milled hardwood board, for structural and rustic work.",
  glass: "Cut and fitted glass for cabinet fronts, splashbacks and display units.",
  tape: "Matching edge banding, applied hot on the edge bander for a sealed, factory edge.",
};

/** Sheet sizes as sold here, where they are standard. */
const SEED_SIZES: Partial<Record<BoardType, string>> = {
  egger: "8ft × 4ft",
  mdf: "8ft × 4ft",
  hdf: "8ft × 4ft",
  mfc_9x7: "9ft × 7ft",
  mfc_9x4: "9ft × 4ft",
  kwali: "8ft × 4ft",
  quarter: "8ft × 4ft",
  high_glossy: "8ft × 4ft",
  marine: "8ft × 4ft",
};

/**
 * The catalogue as it stands before anyone edits it.
 *
 * Every board type gets an entry so none is missing from the admin screen. `published` is true
 * for the sheets the workshop sells and false for `other` — a catch-all is not a product — and
 * false for `glass`, which is bought in rather than cut from stock, so the workshop can decide
 * whether to advertise it.
 */
export function defaultBoardCatalogue(): BoardCatalogueSettings {
  const entries: Partial<Record<BoardType, BoardCatalogueEntry>> = {};
  for (const type of BOARD_TYPES) {
    entries[type] = {
      displayName: BOARD_TYPE_LABELS[type],
      blurb: SEED_BLURBS[type] ?? "",
      imageUrl: defaultBoardImage(type),
      sheetSize: SEED_SIZES[type],
      published: type !== "other" && type !== "glass",
    };
  }
  return { enabled: true, entries };
}

const CATALOGUE_DOC = "boardCatalogue";

/**
 * Reads the catalogue, filling any gap from the defaults.
 *
 * Merged per entry rather than per document, so a board type added to `BOARD_TYPES` after the
 * catalogue was last saved still appears — with its swatch and its seed text — instead of being
 * silently absent from both the admin screen and the site.
 */
export async function loadBoardCatalogue(db: Firestore): Promise<BoardCatalogueSettings> {
  const fallback = defaultBoardCatalogue();
  const snap = await getDoc(doc(db, COL.settings, CATALOGUE_DOC));
  if (!snap.exists()) return fallback;

  const saved = snap.data() as Partial<BoardCatalogueSettings>;
  const entries: Partial<Record<BoardType, BoardCatalogueEntry>> = {};
  for (const type of BOARD_TYPES) {
    const base = fallback.entries[type]!;
    const stored = saved.entries?.[type];
    entries[type] = stored
      ? {
          ...base,
          ...stored,
          /*
           * An empty or unsafe image falls back to the swatch.
           *
           * Empty would render a broken picture; unsafe would put an arbitrary scheme into an
           * `src` on a public page. The swatch is always a better answer than either, and doing
           * the check here means every reader gets it without having to remember.
           */
          imageUrl:
            stored.imageUrl && isSafeImageUrl(stored.imageUrl)
              ? stored.imageUrl.trim()
              : base.imageUrl,
          displayName: stored.displayName?.trim() || base.displayName,
        }
      : base;
  }

  return { enabled: saved.enabled ?? fallback.enabled, entries };
}

export async function saveBoardCatalogue(
  db: Firestore,
  actor: AuditActor,
  next: BoardCatalogueSettings
): Promise<void> {
  for (const [type, entry] of Object.entries(next.entries)) {
    if (!entry) continue;
    if (!entry.displayName.trim()) {
      throw new Error(`${BOARD_TYPE_LABELS[type as BoardType]} needs a name to show.`);
    }
    /*
     * Only a path or an http(s) URL.
     *
     * These strings end up in an `src`, and this document is written by staff and read by the
     * public site. Rejecting anything else keeps `javascript:` and `data:` out of a public
     * page — the one place a settings document could turn into script.
     */
    if (!isSafeImageUrl(entry.imageUrl)) {
      throw new Error(
        `The image for ${entry.displayName} must be a path starting with "/" or a full https:// address.`
      );
    }
  }

  const published = Object.values(next.entries).filter((e) => e?.published).length;

  /*
   * No `updatedBy` on this document, unlike every other settings write.
   *
   * It is publicly readable — the website renders from it — so a staff member's auth UID stored
   * here would be world-readable at a predictable path. Not a credential, but not something to
   * publish either. Who changed it is in the audit entry below, which is staff-only.
   */
  await setDoc(
    doc(db, COL.settings, CATALOGUE_DOC),
    { ...next, updatedAt: serverTimestamp() },
    { merge: true }
  );

  await writeAudit(db, {
    actor,
    action: "settings_change",
    collectionName: COL.settings,
    docId: CATALOGUE_DOC,
    summary: `Board catalogue updated — ${published} board(s) shown on the site${
      next.enabled ? "" : ", section hidden"
    }`,
    after: { enabled: next.enabled, published },
  });
}

/** The boards to show on the public site, in the workshop's own ordering. */
export function publishedBoards(
  catalogue: BoardCatalogueSettings
): Array<{ type: BoardType; entry: BoardCatalogueEntry }> {
  if (!catalogue.enabled) return [];
  return BOARD_TYPES.filter((t) => catalogue.entries[t]?.published).map((t) => ({
    type: t,
    entry: catalogue.entries[t]!,
  }));
}

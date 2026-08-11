import {
  addDoc,
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  serverTimestamp,
  Timestamp,
  updateDoc,
  where,
  type Firestore,
} from "firebase/firestore";
import { COL, COUNTER } from "./collections";
import { BOARD_TYPE_LABELS, type BoardType } from "./enums";
import { allocateDocNumber } from "./numbering";
import { writeAudit, type AuditActor } from "./audit";

/**
 * Cutting lists.
 *
 * The document a customer brings in describing every panel they want cut: part name, width,
 * length, quantity, which edges get banded. It arrives on paper, it is the only record of
 * what was agreed, and losing it means the job cannot be re-cut and the customer cannot be
 * answered. So it is captured here instead — fillable by the customer themselves through a
 * public link, then held against their record.
 *
 * Two things it computes that the paper cannot:
 *
 * - **Edge banding length**, per tape width. The banding is bought by the metre and quoted by
 *   the metre, and totalling it by hand across forty parts is where the arithmetic goes.
 * - **Boards required**, from the total panel area against a board's area, plus a waste
 *   allowance. A cutting list that does not say how many boards it needs is a list somebody
 *   has to estimate from twice.
 */

// ---------------------------------------------------------------------------
// Edge codes
// ---------------------------------------------------------------------------

/**
 * Which edges of a panel get banded, as the workshop's own shorthand.
 *
 * Taken from the paper form's legend. The letter is a picture of the edges: `L` is two
 * adjacent sides, `=` is two opposite sides, `U` is three, `O` is all four. Kept as codes
 * rather than four booleans because that is what the cutter reads off the sheet, and a
 * translation layer between the two is somewhere for a mistake to live.
 */
export const EDGE_CODES = ["I", "L", "=", "U", "C", "O", "none"] as const;
export type EdgeCode = (typeof EDGE_CODES)[number];

export interface EdgeCodeMeta {
  code: EdgeCode;
  label: string;
  /** How many of the panel's four edges are banded. Drives the tape length. */
  edges: number;
  /** Which edges, for the printed guide. */
  detail: string;
}

export const EDGE_CODE_META: Record<EdgeCode, EdgeCodeMeta> = {
  I: { code: "I", label: "I", edges: 1, detail: "One side" },
  L: { code: "L", label: "L", edges: 2, detail: "Two adjacent — left + right, or top + one side" },
  "=": { code: "=", label: "=", edges: 2, detail: "Two opposite — top + bottom, or left + right" },
  U: { code: "U", label: "U", edges: 3, detail: "Three sides" },
  C: { code: "C", label: "C", edges: 3, detail: "Three sides — top, bottom + one side" },
  O: { code: "O", label: "O", edges: 4, detail: "All four sides" },
  none: { code: "none", label: "—", edges: 0, detail: "No banding" },
};

/**
 * Which dimension each banded edge runs along.
 *
 * The distinction that makes the tape total right. A panel 600 × 400 banded on two opposite
 * long sides needs 1,200mm of tape; banded on two opposite short sides it needs 800mm.
 * Treating every edge as the same length — which a naive `edges × perimeter / 4` does —
 * is wrong on every panel that is not square.
 *
 * `widthEdges` and `lengthEdges` are how many edges run along each dimension.
 */
const EDGE_LAYOUT: Record<EdgeCode, { widthEdges: number; lengthEdges: number }> = {
  // One side: taken as a width edge, the common case for a shelf front.
  I: { widthEdges: 1, lengthEdges: 0 },
  // Two adjacent: one of each.
  L: { widthEdges: 1, lengthEdges: 1 },
  // Two opposite: assumed the two width edges (front and back of a shelf).
  "=": { widthEdges: 2, lengthEdges: 0 },
  // Three sides: both widths and one length.
  U: { widthEdges: 2, lengthEdges: 1 },
  // Three sides the other way: both lengths and one width.
  C: { widthEdges: 1, lengthEdges: 2 },
  O: { widthEdges: 2, lengthEdges: 2 },
  none: { widthEdges: 0, lengthEdges: 0 },
};

// ---------------------------------------------------------------------------
// Parts
// ---------------------------------------------------------------------------

export interface CuttingListPart {
  id: string;
  /** What the panel is, in the customer's words: "Side Panel", "Shelf", "Door". */
  part: string;
  /** Millimetres. Width runs horizontally, length vertically — as the form states. */
  widthMm: number;
  lengthMm: number;
  quantity: number;
  /** The board this panel is cut from. */
  boardType?: BoardType;
  /** Free-text colour or finish, since the same board comes in many. */
  boardColour?: string;
  edgeCode: EdgeCode;
  /** Banding width in millimetres — 18mm single, 36mm double, in the workshop's stock. */
  edgeTapeMm: number;
  /** Which face is the show face, where it matters. */
  facing?: string;
  notes?: string;
}

export interface CuttingListTotals {
  partCount: number;
  /** Panels, counting quantity. */
  panelCount: number;
  /** Total banding length in metres, split by tape width because they are bought apart. */
  tapeMetresByWidth: Record<number, number>;
  totalTapeMetres: number;
  /** Panel area in square metres. */
  totalAreaM2: number;
  /** Boards needed per material, with the waste allowance applied. */
  boardsByType: Array<{
    boardType: BoardType;
    label: string;
    areaM2: number;
    boardsRequired: number;
  }>;
  totalBoardsRequired: number;
}

/**
 * A standard board's usable size, in millimetres.
 *
 * 2440 × 1220 is the sheet the workshop buys. Used to turn panel area into a board count,
 * which is an estimate rather than a nesting calculation — proper nesting depends on the
 * cutting pattern and is what the saw operator decides. The waste allowance is what covers
 * the difference.
 */
export const BOARD_WIDTH_MM = 1220;
export const BOARD_LENGTH_MM = 2440;
const BOARD_AREA_M2 = (BOARD_WIDTH_MM / 1000) * (BOARD_LENGTH_MM / 1000);

/**
 * Default waste allowance, as a percentage.
 *
 * 15% covers the offcuts a real cutting pattern leaves. Quoting the bare area figure would
 * under-order boards on nearly every job, because panels do not tile a sheet exactly.
 */
export const DEFAULT_WASTE_PERCENT = 15;

/**
 * Totals a cutting list.
 *
 * Pure, so the public form previews exactly what gets saved and the printed sheet shows the
 * same numbers. Every figure the paper form has a box for is computed here rather than in
 * three places.
 */
export function computeCuttingListTotals(
  parts: CuttingListPart[],
  wastePercent = DEFAULT_WASTE_PERCENT
): CuttingListTotals {
  const tapeMetresByWidth: Record<number, number> = {};
  const areaByType = new Map<BoardType, number>();

  let panelCount = 0;
  let totalAreaM2 = 0;

  for (const p of parts) {
    const qty = Number.isFinite(p.quantity) ? Math.max(0, p.quantity) : 0;
    const w = Number.isFinite(p.widthMm) ? Math.max(0, p.widthMm) : 0;
    const l = Number.isFinite(p.lengthMm) ? Math.max(0, p.lengthMm) : 0;
    if (qty <= 0 || w <= 0 || l <= 0) continue;

    panelCount += qty;

    const areaM2 = (w / 1000) * (l / 1000) * qty;
    totalAreaM2 += areaM2;

    if (p.boardType) {
      areaByType.set(p.boardType, (areaByType.get(p.boardType) ?? 0) + areaM2);
    }

    // Banding, by which dimension each edge runs along — see EDGE_LAYOUT.
    const layout = EDGE_LAYOUT[p.edgeCode] ?? EDGE_LAYOUT.none;
    const mm = (layout.widthEdges * w + layout.lengthEdges * l) * qty;
    if (mm > 0) {
      const width = p.edgeTapeMm > 0 ? p.edgeTapeMm : 18;
      tapeMetresByWidth[width] =
        Math.round(((tapeMetresByWidth[width] ?? 0) + mm / 1000) * 100) / 100;
    }
  }

  const allowance = 1 + Math.max(0, wastePercent) / 100;

  const boardsByType = [...areaByType.entries()]
    .map(([boardType, areaM2]) => ({
      boardType,
      label: BOARD_TYPE_LABELS[boardType] ?? boardType,
      areaM2: Math.round(areaM2 * 100) / 100,
      // Rounded up: you cannot buy two thirds of a board.
      boardsRequired: Math.ceil((areaM2 * allowance) / BOARD_AREA_M2),
    }))
    .sort((a, b) => b.boardsRequired - a.boardsRequired);

  return {
    partCount: parts.filter((p) => p.part.trim() !== "").length,
    panelCount,
    tapeMetresByWidth,
    totalTapeMetres:
      Math.round(
        Object.values(tapeMetresByWidth).reduce((s, m) => s + m, 0) * 100
      ) / 100,
    totalAreaM2: Math.round(totalAreaM2 * 100) / 100,
    boardsByType,
    totalBoardsRequired: boardsByType.reduce((s, b) => s + b.boardsRequired, 0),
  };
}

// ---------------------------------------------------------------------------
// Documents
// ---------------------------------------------------------------------------

export type CuttingListStatus = "draft" | "submitted" | "in_production" | "completed";

export const CUTTING_LIST_STATUS_LABELS: Record<CuttingListStatus, string> = {
  draft: "Draft",
  submitted: "Submitted",
  in_production: "In production",
  completed: "Completed",
};

/**
 * A reference for a list submitted through the public link.
 *
 * `CL-YYMMDD-XXXX`, where the suffix is four random characters from an alphabet with no `0/O`
 * or `1/I` — those are the pairs somebody misreads off a phone screen when quoting it at the
 * counter. Prefixed the same way as sequenced lists so it reads as the same kind of thing, and
 * dated so a list from three months ago is obvious at a glance.
 */
function publicReference(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const stamp = `${String(now.getFullYear()).slice(2)}${pad(now.getMonth() + 1)}${pad(
    now.getDate()
  )}`;

  const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let suffix = "";
  for (let i = 0; i < 4; i += 1) {
    suffix += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  }

  return `CL-${stamp}-${suffix}`;
}

export interface NewCuttingList {
  /** Named on the form. A customer filling the public link may not have an id yet. */
  customerName: string;
  customerPhone?: string;
  customerId?: string;
  /** Linked to a job where one exists, so the list sits with the work it describes. */
  jobId?: string;
  jobNumber?: string;
  title?: string;
  parts: CuttingListPart[];
  wastePercent?: number;
  /**
   * Blade allowance in millimetres, added to each cut.
   *
   * The saw removes material — typically 3mm — so forty panels cut from one board need forty
   * kerfs of clearance. The offset is recorded because the operator needs it and because a
   * list cut without it comes out short on the last panel.
   */
  offsetMm?: number;
  notes?: string;
}

/**
 * Saves a cutting list and allocates its number.
 *
 * Totals are computed and stored alongside the parts rather than only derived on read. The
 * list is a document that gets printed and handed to a cutter, and the figures on the paper
 * have to be the figures it was submitted with — recomputing on read means a later change to
 * the waste allowance would silently restate a sheet already on the saw.
 */
export async function createCuttingList(
  db: Firestore,
  actor: AuditActor | null,
  input: NewCuttingList
): Promise<{ id: string; listNumber: string }> {
  /*
   * Validated here to the same bounds the rules enforce.
   *
   * The rules are the real gate, but a rule rejection surfaces as "Missing or insufficient
   * permissions" — which tells a customer nothing about the two-character name or the
   * four-digit phone number that caused it. Checking the same limits here means the message
   * names the field.
   */
  const name = input.customerName.trim();
  if (name.length < 2) {
    throw new Error("Please give your full name so we know whose list this is.");
  }
  if (name.length >= 200) throw new Error("That name is too long.");

  const phone = input.customerPhone?.trim() ?? "";
  if (phone.length <= 5) {
    throw new Error("Please give a full phone number so we can reach you about the list.");
  }
  if (phone.length >= 40) throw new Error("That phone number is too long.");

  if ((input.notes?.length ?? 0) >= 2000) {
    throw new Error("Please shorten the notes — they are longer than we can store.");
  }
  if ((input.title?.length ?? 0) >= 200) {
    throw new Error("Please shorten what the list is for.");
  }

  const parts = input.parts.filter(
    (p) => p.part.trim() !== "" && p.quantity > 0 && p.widthMm > 0 && p.lengthMm > 0
  );
  if (parts.length === 0) {
    throw new Error("Add at least one part with a size and a quantity.");
  }
  if (parts.length > 300) {
    throw new Error(
      "That is more than 300 parts. Please split it into two lists so we can handle each one."
    );
  }

  const wastePercent = input.wastePercent ?? DEFAULT_WASTE_PERCENT;
  const totals = computeCuttingListTotals(parts, wastePercent);

  /*
   * The reference number.
   *
   * Staff submissions take one from the shared counter, so their lists run in a clean sequence
   * like every other document. A public submission cannot: the counter is a staff-only
   * document, and opening it to the world would let anyone burn through the sequence — a
   * gap-riddled invoice-style numbering is exactly what an auditor asks about.
   *
   * So a public list gets a self-contained reference instead: date plus a short random suffix.
   * It is unique enough to quote at the counter, obviously distinguishable from a sequenced
   * number, and needs no shared state to mint.
   */
  const listNumber = actor
    ? (await allocateDocNumber(db, COUNTER.cuttingList)).formatted
    : publicReference();

  const ref = await addDoc(collection(db, COL.cuttingLists), {
    listNumber,
    customerName: name,
    // The validated value, never `null`: the rule requires a string, and normalising an
    // absent phone to null was a guaranteed permission failure with no useful message.
    customerPhone: phone,
    customerId: input.customerId ?? null,
    jobId: input.jobId ?? null,
    jobNumber: input.jobNumber ?? null,
    title: input.title?.trim() || null,
    parts,
    wastePercent,
    offsetMm: input.offsetMm ?? 3,
    totals,
    status: "submitted" satisfies CuttingListStatus,
    notes: input.notes?.trim() || null,
    submittedAt: serverTimestamp(),
    /*
     * Who filled it in.
     *
     * Null when it came through the public link, which is the point of that link — a customer
     * has no login. `submittedByCustomer` records which path it arrived by, so staff know
     * whether to check the figures with somebody.
     */
    submittedByCustomer: actor === null,
    createdAt: serverTimestamp(),
    createdBy: actor?.uid ?? null,
  });

  if (actor) {
    await writeAudit(db, {
      actor,
      action: "create",
      collectionName: COL.cuttingLists,
      docId: ref.id,
      summary:
        `Cutting list ${listNumber} for ${input.customerName.trim()}: ` +
        `${totals.panelCount} panel(s), ${totals.totalBoardsRequired} board(s), ` +
        `${totals.totalTapeMetres}m tape`,
      after: {
        listNumber,
        panelCount: totals.panelCount,
        boardsRequired: totals.totalBoardsRequired,
      },
    });
  }

  return { id: ref.id, listNumber };
}

/** Moves a list through production. */
export async function setCuttingListStatus(
  db: Firestore,
  actor: AuditActor,
  listId: string,
  listNumber: string,
  status: CuttingListStatus
): Promise<void> {
  await updateDoc(doc(db, COL.cuttingLists, listId), {
    status,
    ...(status === "completed" ? { completedAt: serverTimestamp() } : {}),
    updatedAt: serverTimestamp(),
    updatedBy: actor.uid,
  });

  await writeAudit(db, {
    actor,
    action: "status_change",
    collectionName: COL.cuttingLists,
    docId: listId,
    summary: `${listNumber} → ${CUTTING_LIST_STATUS_LABELS[status]}`,
    after: { status },
  });
}

/** Links a list to a customer and job once staff have matched it up. */
export async function linkCuttingList(
  db: Firestore,
  actor: AuditActor,
  listId: string,
  link: {
    customerId?: string;
    customerName?: string;
    jobId?: string;
    jobNumber?: string;
  }
): Promise<void> {
  await updateDoc(doc(db, COL.cuttingLists, listId), {
    ...(link.customerId ? { customerId: link.customerId } : {}),
    ...(link.customerName ? { customerName: link.customerName } : {}),
    ...(link.jobId ? { jobId: link.jobId } : {}),
    ...(link.jobNumber ? { jobNumber: link.jobNumber } : {}),
    updatedAt: serverTimestamp(),
    updatedBy: actor.uid,
  });

  await writeAudit(db, {
    actor,
    action: "update",
    collectionName: COL.cuttingLists,
    docId: listId,
    summary:
      `Linked a cutting list to ` +
      [link.customerName, link.jobNumber].filter(Boolean).join(" · "),
    after: link,
  });
}

export interface CuttingListRow extends NewCuttingList {
  id: string;
  listNumber: string;
  status: CuttingListStatus;
  totals: CuttingListTotals;
  offsetMm: number;
  wastePercent: number;
  submittedAtMs: number | null;
  submittedByCustomer: boolean;
}

/**
 * Re-derives a list's totals and reports whether the stored ones agree.
 *
 * The stored totals are what the document was submitted with, and that is deliberate — the
 * printed sheet has to match what the customer sent. But a public submission is
 * attacker-controllable: the rules can check that `totals` is a map and nothing more, because
 * they cannot loop over the parts to recompute it. So anything that came in through the public
 * link is recomputed here, and a divergence is surfaced rather than acted on.
 *
 * The realistic case is not malice but a stale figure — a list edited after its totals were
 * calculated. Either way, ordering two boards for a job that needs two hundred is the failure
 * being prevented.
 */
export function verifyCuttingListTotals(list: CuttingListRow): {
  recomputed: CuttingListTotals;
  agrees: boolean;
  /** What disagrees, in words, for the screen to show. */
  differences: string[];
} {
  const recomputed = computeCuttingListTotals(list.parts, list.wastePercent);
  const differences: string[] = [];

  if (recomputed.panelCount !== list.totals.panelCount) {
    differences.push(
      `panels: submitted ${list.totals.panelCount}, actually ${recomputed.panelCount}`
    );
  }
  if (recomputed.totalBoardsRequired !== list.totals.totalBoardsRequired) {
    differences.push(
      `boards: submitted ${list.totals.totalBoardsRequired}, actually ${recomputed.totalBoardsRequired}`
    );
  }
  // Tape is compared with a tolerance: it is a rounded decimal, and a hundredth of a metre
  // apart is a rounding artefact rather than a discrepancy worth flagging.
  if (Math.abs(recomputed.totalTapeMetres - list.totals.totalTapeMetres) > 0.05) {
    differences.push(
      `banding: submitted ${list.totals.totalTapeMetres}m, actually ${recomputed.totalTapeMetres}m`
    );
  }

  return { recomputed, agrees: differences.length === 0, differences };
}

/** Recent lists, newest first. */
export async function loadCuttingLists(
  db: Firestore,
  max = 100
): Promise<CuttingListRow[]> {
  const snap = await getDocs(
    query(collection(db, COL.cuttingLists), orderBy("submittedAt", "desc"), limit(max))
  );
  return snap.docs.map((d) => {
    const x = d.data();
    return {
      id: d.id,
      listNumber: x.listNumber ?? "",
      customerName: x.customerName ?? "",
      customerPhone: x.customerPhone ?? undefined,
      customerId: x.customerId ?? undefined,
      jobId: x.jobId ?? undefined,
      jobNumber: x.jobNumber ?? undefined,
      title: x.title ?? undefined,
      parts: (x.parts ?? []) as CuttingListPart[],
      wastePercent: x.wastePercent ?? DEFAULT_WASTE_PERCENT,
      offsetMm: x.offsetMm ?? 3,
      totals: (x.totals ?? computeCuttingListTotals([])) as CuttingListTotals,
      status: (x.status as CuttingListStatus) ?? "submitted",
      notes: x.notes ?? undefined,
      submittedAtMs: x.submittedAt?.toMillis?.() ?? null,
      submittedByCustomer: x.submittedByCustomer === true,
    };
  });
}

/** One list by id, for the printed sheet. */
export async function loadCuttingList(
  db: Firestore,
  listId: string
): Promise<CuttingListRow | null> {
  const snap = await getDoc(doc(db, COL.cuttingLists, listId));
  if (!snap.exists()) return null;
  const x = snap.data();
  return {
    id: snap.id,
    listNumber: x.listNumber ?? "",
    customerName: x.customerName ?? "",
    customerPhone: x.customerPhone ?? undefined,
    customerId: x.customerId ?? undefined,
    jobId: x.jobId ?? undefined,
    jobNumber: x.jobNumber ?? undefined,
    title: x.title ?? undefined,
    parts: (x.parts ?? []) as CuttingListPart[],
    wastePercent: x.wastePercent ?? DEFAULT_WASTE_PERCENT,
    offsetMm: x.offsetMm ?? 3,
    totals: (x.totals ?? computeCuttingListTotals([])) as CuttingListTotals,
    status: (x.status as CuttingListStatus) ?? "submitted",
    notes: x.notes ?? undefined,
    submittedAtMs: x.submittedAt?.toMillis?.() ?? null,
    submittedByCustomer: x.submittedByCustomer === true,
  };
}

/** Lists for one customer, for their profile. */
export async function loadCustomerCuttingLists(
  db: Firestore,
  customerId: string
): Promise<CuttingListRow[]> {
  const snap = await getDocs(
    query(collection(db, COL.cuttingLists), where("customerId", "==", customerId))
  );
  return snap.docs
    .map((d) => {
      const x = d.data();
      return {
        id: d.id,
        listNumber: x.listNumber ?? "",
        customerName: x.customerName ?? "",
        customerPhone: x.customerPhone ?? undefined,
        customerId: x.customerId ?? undefined,
        jobId: x.jobId ?? undefined,
        jobNumber: x.jobNumber ?? undefined,
        title: x.title ?? undefined,
        parts: (x.parts ?? []) as CuttingListPart[],
        wastePercent: x.wastePercent ?? DEFAULT_WASTE_PERCENT,
        offsetMm: x.offsetMm ?? 3,
        totals: (x.totals ?? computeCuttingListTotals([])) as CuttingListTotals,
        status: (x.status as CuttingListStatus) ?? "submitted",
        notes: x.notes ?? undefined,
        submittedAtMs: x.submittedAt?.toMillis?.() ?? null,
        submittedByCustomer: x.submittedByCustomer === true,
      };
    })
    .sort((a, b) => (b.submittedAtMs ?? 0) - (a.submittedAtMs ?? 0));
}

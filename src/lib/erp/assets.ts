import {
  addDoc,
  collection,
  doc,
  getDoc,
  getDocs,
  orderBy,
  query,
  serverTimestamp,
  Timestamp,
  updateDoc,
  type Firestore,
} from "firebase/firestore";
import { COL } from "./collections";
import { writeAudit, type AuditActor } from "./audit";

/**
 * The fixed assets register.
 *
 * The brief lists it as its own inventory, separate from consumables and returnable tools:
 * "Permanent company assets with ID/QR, value, and depreciation. Examples: Edge banding machine,
 * sliding saw, compressor, AVR, generator, furniture, TV, computers, CCTV."
 *
 * Why it cannot live in the stock inventory: the questions are different. Stock asks "how many are
 * left" and its answer changes daily. An asset asks "what do we own, what is it worth now, and when
 * does it need replacing" — there is exactly one of each, it is never issued, and its value falls on
 * a schedule rather than when somebody takes it off a shelf.
 *
 * ## Depreciation
 *
 * Straight line, which is what a workshop of this size needs and what its accountant will expect:
 * the same amount written off every year until the asset reaches its residual value.
 *
 *   annual charge = (cost − residual) / useful life in years
 *
 * Computed on read rather than posted monthly. A depreciation figure stored on the document would
 * need a scheduled job to keep current, and a stored figure that silently stops updating is worse
 * than one derived from the purchase date every time it is asked for. Nothing here posts to the
 * expense ledger — depreciation is a book entry the accountant makes, not cash the workshop paid,
 * and inventing expense records for it would double-count against the original purchase.
 */

export const ASSET_CATEGORIES = [
  "machine",
  "vehicle",
  "power",
  "furniture",
  "computer",
  "security",
  "other",
] as const;
export type AssetCategory = (typeof ASSET_CATEGORIES)[number];

export const ASSET_CATEGORY_LABELS: Record<AssetCategory, string> = {
  machine: "Machine",
  vehicle: "Vehicle",
  power: "Power / generator",
  furniture: "Furniture & fittings",
  computer: "Computer & IT",
  security: "Security",
  other: "Other",
};

/**
 * Typical useful life in years, by category.
 *
 * Defaults for the form, not rules — the life of a particular machine is a judgement about that
 * machine. Chosen conservatively: a sliding saw run daily in a Nigerian workshop does not last as
 * long as the same saw in a hobby shed.
 */
export const ASSET_DEFAULT_LIFE_YEARS: Record<AssetCategory, number> = {
  machine: 10,
  vehicle: 8,
  power: 8,
  furniture: 10,
  computer: 4,
  security: 5,
  other: 5,
};

export const ASSET_STATUSES = ["in_use", "under_repair", "idle", "disposed"] as const;
export type AssetStatus = (typeof ASSET_STATUSES)[number];

export const ASSET_STATUS_LABELS: Record<AssetStatus, string> = {
  in_use: "In use",
  under_repair: "Under repair",
  idle: "Idle",
  disposed: "Disposed of",
};

export interface NewAsset {
  name: string;
  category: AssetCategory;
  /** What it cost, in kobo. The basis for every figure below. */
  costKobo: number;
  /** `yyyy-mm-dd`. Depreciation runs from here. */
  acquiredOn: string;
  /** Years of useful life. Defaults per category. */
  usefulLifeYears: number;
  /** What it will be worth at the end of that life. Often zero. */
  residualKobo?: number;
  /** Where it lives, so a stock-take can find it. */
  location?: string;
  serialNumber?: string;
  supplier?: string;
  notes?: string;
}

export interface FixedAsset extends NewAsset {
  id: string;
  /** Human-readable tag for the label stuck on the machine, e.g. `NW-MACH-004`. */
  assetTag: string;
  status: AssetStatus;
  residualKobo: number;
  disposedOn?: string;
  disposalNote?: string;
  createdAtMs: number | null;
}

export interface AssetDepreciation {
  /** Whole and part years elapsed since acquisition. */
  ageYears: number;
  /** The straight-line charge for a full year. */
  annualChargeKobo: number;
  /** Written off so far, never more than cost less residual. */
  accumulatedKobo: number;
  /** What it is worth on the books today. */
  bookValueKobo: number;
  /** True once it has reached residual — fully written down but often still working. */
  fullyDepreciated: boolean;
  /** Years left of its useful life, floored at zero. */
  remainingYears: number;
}

/** `yyyy-mm-dd` → local-noon Date, immune to daylight-saving edges. */
function dateFromKey(dateKey: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateKey.trim());
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12);
}

/**
 * Straight-line depreciation as at `asOf`.
 *
 * A pure function, so it can be checked against a worked example without a database — which matters
 * for a figure that ends up in a set of accounts.
 */
export function depreciationOf(
  asset: Pick<
    FixedAsset,
    "costKobo" | "acquiredOn" | "usefulLifeYears" | "residualKobo" | "status" | "disposedOn"
  >,
  asOf: Date = new Date()
): AssetDepreciation {
  const start = dateFromKey(asset.acquiredOn);
  const life = Math.max(0, asset.usefulLifeYears);
  const depreciable = Math.max(0, asset.costKobo - (asset.residualKobo ?? 0));

  if (!start || life <= 0 || depreciable <= 0) {
    // Nothing to write off: no date, no life, or it cost no more than its residual.
    return {
      ageYears: 0,
      annualChargeKobo: 0,
      accumulatedKobo: 0,
      bookValueKobo: asset.costKobo,
      fullyDepreciated: false,
      remainingYears: life,
    };
  }

  /*
   * A disposed asset stops depreciating on the day it went.
   *
   * Otherwise its book value would keep falling after the workshop no longer owned it, and the
   * register would understate what was disposed of.
   */
  const end =
    asset.status === "disposed" && asset.disposedOn
      ? (dateFromKey(asset.disposedOn) ?? asOf)
      : asOf;

  /*
   * Age in whole months, then converted to years.
   *
   * Not `elapsed milliseconds / 365.25 days`. That treats a year as 365.25 days, so an exact
   * three-year anniversary computes as 3.0007 years and the accumulated figure lands ₦821 above the
   * round number — on a ₦12,000,000 machine written off over ten years. An accountant reconciling
   * the register against their own schedule queries that, and rightly.
   *
   * Counting calendar months makes the anniversary exact: 36 months is 3.0 years, always. The part
   * month is deliberately not pro-rated to the day — straight-line depreciation is conventionally
   * charged by the month, and a figure that changes every morning is not one anybody can tie to a
   * period.
   */
  const months =
    (end.getFullYear() - start.getFullYear()) * 12 +
    (end.getMonth() - start.getMonth()) -
    // Not yet reached the day of the month, so the current month has not completed.
    (end.getDate() < start.getDate() ? 1 : 0);

  const ageYears = Math.max(0, months / 12);
  const annualChargeKobo = Math.round(depreciable / life);

  // Capped at the depreciable amount: an asset older than its life is written down to residual, not
  // past it. Without the cap a ten-year-old machine on a five-year life would show a negative value.
  const accumulatedKobo = Math.min(depreciable, Math.round((depreciable * ageYears) / life));

  return {
    ageYears: Math.round(ageYears * 10) / 10,
    annualChargeKobo,
    accumulatedKobo,
    bookValueKobo: asset.costKobo - accumulatedKobo,
    fullyDepreciated: accumulatedKobo >= depreciable,
    remainingYears: Math.max(0, Math.round((life - ageYears) * 10) / 10),
  };
}

/**
 * The tag that goes on the label stuck to the machine.
 *
 * `NW-MACH-004`: company, category, sequence. Readable aloud over a phone, which a document id is
 * not — and the whole point of tagging an asset is that somebody standing in front of it can say
 * which one it is. The sequence is per category and derived from what exists, so it is stable and
 * needs no counter document.
 */
export function assetTagFor(category: AssetCategory, existingCount: number): string {
  const code = category.slice(0, 4).toUpperCase();
  return `NW-${code}-${String(existingCount + 1).padStart(3, "0")}`;
}

export async function createAsset(
  db: Firestore,
  actor: AuditActor,
  input: NewAsset
): Promise<{ id: string; assetTag: string }> {
  if (!input.name.trim()) throw new Error("What is it? Give the asset a name.");
  if (!(input.costKobo > 0)) throw new Error("What did it cost? An asset with no cost cannot be depreciated.");
  if (!input.acquiredOn) throw new Error("When was it acquired? Depreciation runs from that date.");
  if (!(input.usefulLifeYears > 0)) throw new Error("How many years of use? It must be more than zero.");

  const residualKobo = input.residualKobo ?? 0;
  if (residualKobo < 0) throw new Error("A residual value cannot be negative.");
  if (residualKobo > input.costKobo) {
    throw new Error("The residual value cannot be more than what it cost.");
  }

  // Counted for the tag. One extra read at creation, which buys a tag anyone can read out loud.
  const existing = await getDocs(
    query(collection(db, COL.fixedAssets), orderBy("createdAt", "asc"))
  );
  const sameCategory = existing.docs.filter((d) => d.data().category === input.category).length;
  const assetTag = assetTagFor(input.category, sameCategory);

  const ref = await addDoc(collection(db, COL.fixedAssets), {
    name: input.name.trim(),
    category: input.category,
    assetTag,
    costKobo: input.costKobo,
    acquiredOn: input.acquiredOn,
    usefulLifeYears: input.usefulLifeYears,
    residualKobo,
    location: input.location?.trim() || null,
    serialNumber: input.serialNumber?.trim() || null,
    supplier: input.supplier?.trim() || null,
    notes: input.notes?.trim() || null,
    status: "in_use" satisfies AssetStatus,
    disposedOn: null,
    disposalNote: null,
    createdAt: serverTimestamp(),
    createdBy: actor.uid,
  });

  await writeAudit(db, {
    actor,
    action: "create",
    collectionName: COL.fixedAssets,
    docId: ref.id,
    summary: `Registered ${assetTag} — ${input.name.trim()} at ${input.costKobo} kobo`,
    after: {
      assetTag,
      costKobo: input.costKobo,
      acquiredOn: input.acquiredOn,
      usefulLifeYears: input.usefulLifeYears,
    },
  });

  return { id: ref.id, assetTag };
}

export async function updateAsset(
  db: Firestore,
  actor: AuditActor,
  assetId: string,
  patch: Partial<NewAsset> & { status?: AssetStatus }
): Promise<void> {
  const ref = doc(db, COL.fixedAssets, assetId);
  const snap = await getDoc(ref);
  if (!snap.exists()) throw new Error("That asset is no longer on the register.");
  const before = snap.data();

  const clean: Record<string, unknown> = {
    updatedAt: serverTimestamp(),
    updatedBy: actor.uid,
  };
  if (patch.name !== undefined) clean.name = patch.name.trim();
  if (patch.category !== undefined) clean.category = patch.category;
  if (patch.costKobo !== undefined) {
    if (!(patch.costKobo > 0)) throw new Error("A cost must be greater than zero.");
    clean.costKobo = patch.costKobo;
  }
  if (patch.acquiredOn !== undefined) clean.acquiredOn = patch.acquiredOn;
  if (patch.usefulLifeYears !== undefined) {
    if (!(patch.usefulLifeYears > 0)) throw new Error("Useful life must be more than zero years.");
    clean.usefulLifeYears = patch.usefulLifeYears;
  }
  if (patch.residualKobo !== undefined) clean.residualKobo = Math.max(0, patch.residualKobo);
  if (patch.location !== undefined) clean.location = patch.location.trim() || null;
  if (patch.serialNumber !== undefined) clean.serialNumber = patch.serialNumber.trim() || null;
  if (patch.supplier !== undefined) clean.supplier = patch.supplier.trim() || null;
  if (patch.notes !== undefined) clean.notes = patch.notes.trim() || null;
  if (patch.status !== undefined) clean.status = patch.status;

  await updateDoc(ref, clean);

  await writeAudit(db, {
    actor,
    action: "update",
    collectionName: COL.fixedAssets,
    docId: assetId,
    summary: `Updated ${before.assetTag ?? "asset"}: ${Object.keys(clean)
      .filter((k) => k !== "updatedAt" && k !== "updatedBy")
      .join(", ")}`,
    before: {
      costKobo: before.costKobo ?? 0,
      usefulLifeYears: before.usefulLifeYears ?? 0,
      status: before.status ?? "in_use",
    },
    after: clean,
  });
}

/**
 * Records a disposal.
 *
 * Never a deletion. An asset that was owned and sold is part of the register's history — the
 * accounts need to show what left and when — and deleting it would make the depreciation charged in
 * previous years unexplainable.
 */
export async function disposeAsset(
  db: Firestore,
  actor: AuditActor,
  assetId: string,
  disposedOn: string,
  note: string
): Promise<void> {
  if (!disposedOn) throw new Error("When was it disposed of?");
  if (!note.trim()) throw new Error("Say what happened to it — sold, scrapped, stolen.");

  const ref = doc(db, COL.fixedAssets, assetId);
  const snap = await getDoc(ref);
  if (!snap.exists()) throw new Error("That asset is no longer on the register.");

  await updateDoc(ref, {
    status: "disposed" satisfies AssetStatus,
    disposedOn,
    disposalNote: note.trim(),
    updatedAt: serverTimestamp(),
    updatedBy: actor.uid,
  });

  await writeAudit(db, {
    actor,
    action: "update",
    collectionName: COL.fixedAssets,
    docId: assetId,
    summary: `Disposed of ${snap.data().assetTag ?? "asset"} on ${disposedOn}: ${note.trim()}`,
    after: { status: "disposed", disposedOn, note: note.trim() },
  });
}

function assetFrom(id: string, x: Record<string, unknown>): FixedAsset {
  return {
    id,
    name: (x.name as string) ?? "",
    category: (x.category as AssetCategory) ?? "other",
    assetTag: (x.assetTag as string) ?? "",
    costKobo: (x.costKobo as number) ?? 0,
    acquiredOn: (x.acquiredOn as string) ?? "",
    usefulLifeYears: (x.usefulLifeYears as number) ?? 0,
    residualKobo: (x.residualKobo as number) ?? 0,
    location: (x.location as string) ?? undefined,
    serialNumber: (x.serialNumber as string) ?? undefined,
    supplier: (x.supplier as string) ?? undefined,
    notes: (x.notes as string) ?? undefined,
    status: (x.status as AssetStatus) ?? "in_use",
    disposedOn: (x.disposedOn as string) ?? undefined,
    disposalNote: (x.disposalNote as string) ?? undefined,
    createdAtMs:
      (x.createdAt as { toMillis?: () => number } | undefined)?.toMillis?.() ?? null,
  };
}

export interface AssetWithDepreciation extends FixedAsset {
  depreciation: AssetDepreciation;
}

/** The whole register, with each asset's depreciation as at today. */
export async function loadAssets(db: Firestore): Promise<AssetWithDepreciation[]> {
  const snap = await getDocs(query(collection(db, COL.fixedAssets), orderBy("name", "asc")));
  return snap.docs
    .map((d) => assetFrom(d.id, d.data()))
    .map((a) => ({ ...a, depreciation: depreciationOf(a) }));
}

export interface RegisterTotals {
  count: number;
  /** What everything cost when bought. */
  costKobo: number;
  /** What it is worth on the books now. */
  bookValueKobo: number;
  /** Written off to date. */
  accumulatedKobo: number;
  /** This year's charge across everything still depreciating. */
  annualChargeKobo: number;
  fullyDepreciated: number;
  disposed: number;
}

/**
 * The register's totals.
 *
 * Disposed assets are excluded from the value figures but counted separately: they are history the
 * register keeps, not property the workshop still holds, and adding their cost to "what we own"
 * would overstate it.
 */
export function registerTotals(assets: AssetWithDepreciation[]): RegisterTotals {
  const held = assets.filter((a) => a.status !== "disposed");
  return {
    count: held.length,
    costKobo: held.reduce((s, a) => s + a.costKobo, 0),
    bookValueKobo: held.reduce((s, a) => s + a.depreciation.bookValueKobo, 0),
    accumulatedKobo: held.reduce((s, a) => s + a.depreciation.accumulatedKobo, 0),
    annualChargeKobo: held
      .filter((a) => !a.depreciation.fullyDepreciated)
      .reduce((s, a) => s + a.depreciation.annualChargeKobo, 0),
    fullyDepreciated: held.filter((a) => a.depreciation.fullyDepreciated).length,
    disposed: assets.filter((a) => a.status === "disposed").length,
  };
}

/**
 * Money handling for the ERP.
 *
 * Every monetary value is stored as an **integer number of kobo** (1 naira =
 * 100 kobo). Floats are never persisted: `0.1 + 0.2 !== 0.3` in IEEE-754, and
 * on a payroll run over hundreds of line items that drift becomes real money
 * that doesn't reconcile.
 *
 * Naming convention: any field or variable holding kobo ends in `Kobo`.
 */

/** 1 naira in kobo. */
export const KOBO = 100;

/** Naira (possibly fractional, e.g. from a form) → integer kobo. */
export function toKobo(naira: number): number {
  if (!Number.isFinite(naira)) return 0;
  return Math.round(naira * KOBO);
}

/** Integer kobo → naira as a float. For display/arithmetic only, never storage. */
export function toNaira(kobo: number): number {
  return kobo / KOBO;
}

/**
 * Formats kobo as Nigerian naira.
 * `decimals: false` (the default) drops the kobo part, which is how these
 * amounts appear on the paper forms, ₦57,450 not ₦57,450.00.
 */
export function formatNaira(kobo: number, opts: { decimals?: boolean } = {}): string {
  const { decimals = false } = opts;
  return new Intl.NumberFormat("en-NG", {
    style: "currency",
    currency: "NGN",
    minimumFractionDigits: decimals ? 2 : 0,
    maximumFractionDigits: decimals ? 2 : 0,
  }).format(toNaira(kobo));
}

/** Compact form for dashboard tiles: ₦1.2M, ₦57.5k. */
export function formatNairaCompact(kobo: number): string {
  const naira = toNaira(kobo);
  const abs = Math.abs(naira);
  if (abs >= 1_000_000) return `₦${(naira / 1_000_000).toFixed(abs >= 10_000_000 ? 0 : 1)}M`;
  if (abs >= 1_000) return `₦${(naira / 1_000).toFixed(abs >= 10_000 ? 0 : 1)}k`;
  return `₦${Math.round(naira)}`;
}

/**
 * quantity × unit price, in kobo.
 *
 * Quantity may legitimately be fractional, the legacy Inventory sheet records
 * `2.5` rolls of S/Tape, so the product is rounded once, at the end, rather
 * than truncating the inputs.
 */
export function lineAmountKobo(quantity: number, unitPriceKobo: number): number {
  if (!Number.isFinite(quantity) || !Number.isFinite(unitPriceKobo)) return 0;
  return Math.round(quantity * unitPriceKobo);
}

/** Sums kobo values, guarding against NaN/undefined entries. */
export function sumKobo(values: Array<number | null | undefined>): number {
  return values.reduce<number>((total, v) => total + (Number.isFinite(v) ? (v as number) : 0), 0);
}

/**
 * Applies a percentage (e.g. an 8% error margin) to a kobo base.
 * Percent is expressed as a human number: `8` means 8%.
 */
export function applyPercentKobo(baseKobo: number, percent: number): number {
  if (!Number.isFinite(percent)) return 0;
  return Math.round((baseKobo * percent) / 100);
}

/**
 * Splits a kobo amount evenly N ways without losing or inventing kobo.
 * The remainder is distributed one kobo at a time to the earliest shares, so
 * `splitKobo(100, 3)` → `[34, 33, 33]` and the parts always sum to the whole.
 */
export function splitKobo(totalKobo: number, parts: number): number[] {
  if (parts <= 0) return [];
  const base = Math.floor(totalKobo / parts);
  let remainder = totalKobo - base * parts;
  return Array.from({ length: parts }, () => {
    const extra = remainder > 0 ? 1 : 0;
    remainder -= extra;
    return base + extra;
  });
}

/** Parses user input ("₦2,000", "2000.50", "2 000") into kobo. */
export function parseNairaInput(raw: string): number {
  const cleaned = raw.replace(/[₦,\s]/g, "");
  const value = Number.parseFloat(cleaned);
  return Number.isFinite(value) ? toKobo(value) : 0;
}

/**
 * The tax already contained within a gross amount.
 *
 * For an inclusive rate the tax is *not* `gross × percent`: at 7.5% a ₦1,075 gross
 * contains ₦75 of tax, not ₦80.63. The correct extraction is
 * `gross × percent / (100 + percent)`, which is the algebraic inverse of adding
 * the rate on. Getting this wrong overstates the tax and understates the net on
 * every inclusive invoice, which is the kind of error a tax authority finds.
 */
export function taxWithinKobo(grossKobo: number, percent: number): number {
  if (!Number.isFinite(percent) || percent <= 0) return 0;
  return Math.round((grossKobo * percent) / (100 + percent));
}

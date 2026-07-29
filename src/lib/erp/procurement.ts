import type { ConsumableCycle, Purchase, PurchaseLine } from "./types";

/**
 * Supplier and consumable-brand performance scoring.
 *
 * The point is purchasing decisions, so the headline figure is never the
 * sticker price. The legacy `Gum & Blade Cycle` sheet shows Infrawood blades
 * lasting ~4 days against Freud's ~14, a blade at half the price that dies in
 * a third of the time is the more expensive blade. `costPerUnitProcessedKobo`
 * (and `costPerDayKobo`) express that directly.
 *
 * All functions are pure so they can run either in a Cloud Function on write or
 * on the client for an ad-hoc view.
 */

const MS_PER_DAY = 86_400_000;

function toMillis(value: { toMillis?: () => number } | null | undefined): number | null {
  if (!value?.toMillis) return null;
  const ms = value.toMillis();
  return Number.isFinite(ms) ? ms : null;
}

/** Whole days between two timestamps, or null if either is missing. */
export function daysBetween(
  from: { toMillis?: () => number } | null | undefined,
  to: { toMillis?: () => number } | null | undefined
): number | null {
  const a = toMillis(from);
  const b = toMillis(to);
  if (a === null || b === null) return null;
  return Math.max(0, Math.round((b - a) / MS_PER_DAY));
}

function mean(values: number[]): number | undefined {
  if (!values.length) return undefined;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function percent(part: number, whole: number): number | undefined {
  if (whole <= 0) return undefined;
  return Math.round((part / whole) * 1000) / 10; // one decimal place
}

// ---------------------------------------------------------------------------
// Supplier scorecard
// ---------------------------------------------------------------------------

export interface SupplierScorecard {
  purchaseCount: number;
  totalSpendKobo: number;
  avgLeadTimeDays?: number;
  onTimeRatePercent?: number;
  defectRatePercent?: number;
  lastPurchaseAtMs?: number;
}

/**
 * Rolls a supplier's purchase history into a scorecard.
 *
 * - **Lead time** uses ordered → received, so it measures what we actually
 *   waited, not what was promised.
 * - **On-time** compares received against *promised*; purchases with no
 *   promised date are excluded rather than counted as successes, which would
 *   flatter suppliers who never commit to a date.
 * - **Defect rate** is line-weighted (rejected ÷ received quantity), so one bad
 *   line in a large order doesn't score the same as a wholly bad order.
 */
export function scoreSupplier(
  purchases: Purchase[],
  linesByPurchase: Record<string, PurchaseLine[]> = {}
): SupplierScorecard {
  const settled = purchases.filter((p) => p.status !== "cancelled");

  const leadTimes: number[] = [];
  let promisedCount = 0;
  let onTimeCount = 0;
  let receivedQty = 0;
  let rejectedQty = 0;
  let totalSpendKobo = 0;
  let lastPurchaseAtMs: number | undefined;

  for (const p of settled) {
    totalSpendKobo += p.totalKobo ?? 0;

    const receivedMs = toMillis(p.receivedAt);
    if (receivedMs !== null) {
      const lead = daysBetween(p.orderedAt, p.receivedAt);
      if (lead !== null) leadTimes.push(lead);

      const promisedMs = toMillis(p.promisedAt);
      if (promisedMs !== null) {
        promisedCount += 1;
        // End-of-day grace: arriving on the promised date counts as on time.
        if (receivedMs <= promisedMs + MS_PER_DAY - 1) onTimeCount += 1;
      }

      if (lastPurchaseAtMs === undefined || receivedMs > lastPurchaseAtMs) {
        lastPurchaseAtMs = receivedMs;
      }
    }

    for (const line of linesByPurchase[p.id] ?? []) {
      receivedQty += line.quantityReceived ?? 0;
      rejectedQty += line.quantityRejected ?? 0;
    }
  }

  const avgLead = mean(leadTimes);

  return {
    purchaseCount: settled.length,
    totalSpendKobo,
    avgLeadTimeDays: avgLead === undefined ? undefined : Math.round(avgLead * 10) / 10,
    onTimeRatePercent: percent(onTimeCount, promisedCount),
    // Denominator is received + rejected: goods inspected, not goods ordered.
    defectRatePercent: percent(rejectedQty, receivedQty + rejectedQty),
    lastPurchaseAtMs,
  };
}

// ---------------------------------------------------------------------------
// Consumable brand scorecard
// ---------------------------------------------------------------------------

export interface BrandScorecard {
  cyclesRecorded: number;
  avgLifespanDays?: number;
  avgUnitsProcessed?: number;
  avgUnitCostKobo?: number;
  /** The decision metric: cost ÷ boards processed. Lower is better. */
  costPerUnitProcessedKobo?: number;
  /** Fallback when units aren't tracked: cost ÷ days of service life. */
  costPerDayKobo?: number;
  earlyFailureRatePercent?: number;
}

/**
 * Rolls closed cycles for one brand into a scorecard.
 *
 * Only **closed** cycles (those with an `endDate`) count toward lifespan, an
 * in-service blade has an unknown life, and including it would drag every
 * average down toward zero.
 */
export function scoreConsumableBrand(cycles: ConsumableCycle[]): BrandScorecard {
  const closed = cycles.filter((c) => c.endDate);

  const lifespans: number[] = [];
  const unitCosts: number[] = [];
  const unitsProcessed: number[] = [];
  let earlyFailures = 0;

  for (const c of closed) {
    const life = c.lifespanDays ?? daysBetween(c.startDate, c.endDate);
    if (life !== null && life !== undefined) lifespans.push(life);
    if (Number.isFinite(c.costKobo)) unitCosts.push(c.costKobo as number);
    if (Number.isFinite(c.unitsProcessed)) unitsProcessed.push(c.unitsProcessed as number);
    if (c.retiredReason === "broke_early") earlyFailures += 1;
  }

  const avgLifespan = mean(lifespans);
  const avgCost = mean(unitCosts);
  const avgUnits = mean(unitsProcessed);

  return {
    cyclesRecorded: closed.length,
    avgLifespanDays: avgLifespan === undefined ? undefined : Math.round(avgLifespan * 10) / 10,
    avgUnitsProcessed: avgUnits === undefined ? undefined : Math.round(avgUnits),
    avgUnitCostKobo: avgCost === undefined ? undefined : Math.round(avgCost),
    costPerUnitProcessedKobo:
      avgCost !== undefined && avgUnits !== undefined && avgUnits > 0
        ? Math.round(avgCost / avgUnits)
        : undefined,
    costPerDayKobo:
      avgCost !== undefined && avgLifespan !== undefined && avgLifespan > 0
        ? Math.round(avgCost / avgLifespan)
        : undefined,
    earlyFailureRatePercent: percent(earlyFailures, closed.length),
  };
}

// ---------------------------------------------------------------------------
// Comparison / recommendation
// ---------------------------------------------------------------------------

export interface BrandComparisonRow {
  brandId: string;
  brandName: string;
  score: BrandScorecard;
}

/**
 * Ranks brands best-first on true cost of ownership, preferring
 * cost-per-unit-processed and falling back to cost-per-day, then lifespan.
 * Brands with too few cycles to judge sort last, with two data points, a
 * flattering average is noise, not evidence.
 */
export function rankBrands(rows: BrandComparisonRow[], minCycles = 3): BrandComparisonRow[] {
  const rank = (r: BrandComparisonRow): number => {
    const s = r.score;
    if (s.cyclesRecorded < minCycles) return Number.POSITIVE_INFINITY;
    if (s.costPerUnitProcessedKobo !== undefined) return s.costPerUnitProcessedKobo;
    if (s.costPerDayKobo !== undefined) return s.costPerDayKobo;
    // No cost data: fall back to durability, negated so longer life ranks better.
    if (s.avgLifespanDays !== undefined) return -s.avgLifespanDays;
    return Number.POSITIVE_INFINITY;
  };
  return [...rows].sort((a, b) => rank(a) - rank(b));
}

/**
 * Plain-language purchasing observations for the dashboard. Only fires when
 * there is enough evidence, so the admin isn't told to switch brands on the
 * strength of one lucky blade.
 */
export function brandObservations(rows: BrandComparisonRow[], minCycles = 3): string[] {
  const out: string[] = [];
  const judged = rows.filter((r) => r.score.cyclesRecorded >= minCycles);
  if (judged.length < 2) return out;

  const ranked = rankBrands(judged, minCycles);
  const best = ranked[0];
  const worst = ranked[ranked.length - 1];

  const bestLife = best.score.avgLifespanDays;
  const worstLife = worst.score.avgLifespanDays;
  if (best.brandId !== worst.brandId && bestLife && worstLife && worstLife > 0) {
    const ratio = bestLife / worstLife;
    if (ratio >= 1.5) {
      out.push(
        `${best.brandName} lasts ${ratio.toFixed(1)}× longer than ${worst.brandName} ` +
          `(${bestLife} vs ${worstLife} days average), favour it on the next order.`
      );
    }
  }

  const bestCost = best.score.costPerUnitProcessedKobo;
  const worstCost = worst.score.costPerUnitProcessedKobo;
  if (bestCost !== undefined && worstCost !== undefined && bestCost > 0 && worstCost > bestCost) {
    const saving = Math.round(((worstCost - bestCost) / worstCost) * 100);
    if (saving >= 10) {
      out.push(
        `Per board processed, ${best.brandName} costs ${saving}% less than ${worst.brandName} ` +
          `even before downtime.`
      );
    }
  }

  for (const r of judged) {
    const fail = r.score.earlyFailureRatePercent;
    if (fail !== undefined && fail >= 25) {
      out.push(
        `${r.brandName} failed early in ${fail}% of cycles, raise it with the supplier ` +
          `or stop buying it.`
      );
    }
  }

  return out;
}

/** Plain-language supplier observations. */
export function supplierObservations(
  rows: Array<{ supplierId: string; supplierName: string; score: SupplierScorecard }>
): string[] {
  const out: string[] = [];
  for (const { supplierName, score } of rows) {
    if (score.purchaseCount < 3) continue;

    if (score.onTimeRatePercent !== undefined && score.onTimeRatePercent < 70) {
      out.push(
        `${supplierName} hit the promised date on only ${score.onTimeRatePercent}% of ` +
          `${score.purchaseCount} orders, build slack into schedules that depend on them.`
      );
    }
    if (score.defectRatePercent !== undefined && score.defectRatePercent >= 5) {
      out.push(
        `${supplierName} short-delivered or failed inspection on ${score.defectRatePercent}% ` +
          `of goods received, inspect on arrival.`
      );
    }
    if (score.avgLeadTimeDays !== undefined && score.avgLeadTimeDays > 14) {
      out.push(
        `${supplierName} averages ${score.avgLeadTimeDays} days to deliver, order earlier ` +
          `or find a second source.`
      );
    }
  }
  return out;
}

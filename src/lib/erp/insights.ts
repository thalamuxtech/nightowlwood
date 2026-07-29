import { formatNaira, formatNairaCompact } from "./money";

/**
 * Plain-language observations derived from operating data.
 *
 * Two rules keep these useful rather than noisy:
 *
 *  1. **Every observation states a number and what to do about it.** "Revenue is
 *     down" is not actionable; "wage cost was 48% of service revenue, against a
 *     33% average" is.
 *  2. **Nothing fires on thin evidence.** Each check has a minimum sample, so a
 *     single quiet week or one lucky blade cannot produce advice. A confident
 *     wrong statement about money is worse than silence.
 */

export type InsightTone = "good" | "warn" | "danger" | "info";

export interface Insight {
  id: string;
  tone: InsightTone;
  title: string;
  detail: string;
  /** What to do, when there is a clear next step. */
  action?: string;
}

export interface InsightInput {
  jobs: Array<{
    status: string;
    totalKobo: number;
    paidKobo: number;
    balanceKobo: number;
    receivedAtMs: number | null;
    completedAtMs: number | null;
    customerName: string;
  }>;
  expenses: Array<{ amountKobo: number; dateMs: number | null; category: string }>;
  wageRuns: Array<{
    grandTotalKobo: number;
    periodStartMs: number | null;
    periodEndMs: number | null;
    status: string;
  }>;
  invoices: Array<{
    totalKobo: number;
    balanceKobo: number;
    status: string;
    issuedAtMs: number | null;
    dueAtMs: number | null;
    customerName: string;
  }>;
  inventory: Array<{ name: string; quantityOnHand: number; reorderLevel: number }>;
  loans: Array<{ staffName: string; outstandingKobo: number; status: string }>;
  cycles: Array<{
    brandName?: string;
    lifespanDays?: number;
    costKobo?: number;
    unitsProcessed?: number;
    retiredReason?: string;
    endDateMs: number | null;
  }>;
  toolRequests: Array<{
    jobName: string;
    status: string;
    expectedReturnMs: number | null;
  }>;
  serviceInventory: Array<{ customerName: string; quantity: number; status: string; receivedAtMs: number | null }>;
}

const DAY = 86_400_000;

function pct(part: number, whole: number): number | null {
  if (whole <= 0) return null;
  return Math.round((part / whole) * 1000) / 10;
}

function mean(values: number[]): number | null {
  if (!values.length) return null;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

/**
 * Builds the observation list, most important first.
 *
 * Ordering is by consequence, not by category: money at risk outranks a
 * favourable trend, because the first needs a decision today.
 */
export function buildInsights(input: InsightInput): Insight[] {
  const out: Insight[] = [];
  const now = Date.now();

  // --- Receivables ---------------------------------------------------------
  const uncollected = input.jobs.filter(
    (j) => j.status === "ready_for_pickup" && j.balanceKobo > 0
  );
  const staleUncollected = uncollected.filter(
    (j) => j.receivedAtMs !== null && now - j.receivedAtMs > 14 * DAY
  );
  if (staleUncollected.length >= 2) {
    const value = staleUncollected.reduce((s, j) => s + j.balanceKobo, 0);
    out.push({
      id: "stale-pickup",
      tone: "danger",
      title: `${formatNairaCompact(value)} in finished work uncollected over 14 days`,
      detail: `${staleUncollected.length} jobs are finished and unpaid, held on your floor. That is your money and your space.`,
      action: "Call the customers, or apply a storage charge.",
    });
  }

  const overdueInvoices = input.invoices.filter(
    (i) =>
      i.balanceKobo > 0 &&
      i.status !== "void" &&
      i.dueAtMs !== null &&
      i.dueAtMs < now
  );
  if (overdueInvoices.length > 0) {
    const value = overdueInvoices.reduce((s, i) => s + i.balanceKobo, 0);
    const worst = [...overdueInvoices].sort((a, b) => b.balanceKobo - a.balanceKobo)[0];
    out.push({
      id: "overdue-invoices",
      tone: "danger",
      title: `${formatNairaCompact(value)} overdue across ${overdueInvoices.length} invoice${overdueInvoices.length === 1 ? "" : "s"}`,
      detail: `Largest is ${worst.customerName} at ${formatNaira(worst.balanceKobo)}.`,
      action: "Chase the largest first.",
    });
  }

  // --- Wage cost against revenue ------------------------------------------
  // Needs at least three runs: a single week's ratio swings wildly with when
  // jobs happen to be logged, and would produce advice from noise.
  const paidRuns = input.wageRuns.filter((r) => r.status !== "draft");
  if (paidRuns.length >= 3) {
    const ratios: number[] = [];
    for (const run of paidRuns) {
      if (run.periodStartMs === null || run.periodEndMs === null) continue;
      const revenue = input.jobs
        .filter(
          (j) =>
            j.receivedAtMs !== null &&
            j.receivedAtMs >= run.periodStartMs! &&
            j.receivedAtMs <= run.periodEndMs!
        )
        .reduce((s, j) => s + j.totalKobo, 0);
      const r = pct(run.grandTotalKobo, revenue);
      if (r !== null && Number.isFinite(r)) ratios.push(r);
    }

    const avg = mean(ratios);
    const latest = ratios[0];
    if (avg !== null && latest !== undefined) {
      if (latest > avg * 1.25 && latest > 40) {
        out.push({
          id: "wage-ratio-high",
          tone: "warn",
          title: `Wage cost was ${latest.toFixed(0)}% of service revenue last period`,
          detail: `Your average across ${ratios.length} periods is ${avg.toFixed(0)}%. Either prices are too low for the work done, or the work took longer than it should.`,
          action: "Check the rate card against the jobs in that week.",
        });
      } else if (latest < avg * 0.8) {
        out.push({
          id: "wage-ratio-good",
          tone: "good",
          title: `Wage cost fell to ${latest.toFixed(0)}% of revenue`,
          detail: `Below your ${avg.toFixed(0)}% average, so that period was more profitable per naira of wages.`,
        });
      }
    }
  }

  // --- Consumable brands ---------------------------------------------------
  const byBrand = new Map<string, { lives: number[]; costs: number[]; units: number[]; early: number }>();
  for (const c of input.cycles) {
    if (!c.brandName || c.endDateMs === null) continue;
    const e = byBrand.get(c.brandName) ?? { lives: [], costs: [], units: [], early: 0 };
    if (c.lifespanDays) e.lives.push(c.lifespanDays);
    if (c.costKobo) e.costs.push(c.costKobo);
    if (c.unitsProcessed) e.units.push(c.unitsProcessed);
    if (c.retiredReason === "broke_early") e.early += 1;
    byBrand.set(c.brandName, e);
  }

  const ranked = [...byBrand.entries()]
    .filter(([, v]) => v.lives.length >= 3)
    .map(([name, v]) => {
      const life = mean(v.lives)!;
      const cost = mean(v.costs);
      const units = mean(v.units);
      return {
        name,
        life,
        costPerUnit: cost !== null && units !== null && units > 0 ? cost / units : null,
        early: pct(v.early, v.lives.length),
      };
    })
    .sort((a, b) => (a.costPerUnit ?? Infinity) - (b.costPerUnit ?? Infinity));

  if (ranked.length >= 2) {
    const best = ranked[0];
    const worst = ranked[ranked.length - 1];
    if (best.costPerUnit !== null && worst.costPerUnit !== null && worst.costPerUnit > 0) {
      const saving = Math.round(((worst.costPerUnit - best.costPerUnit) / worst.costPerUnit) * 100);
      if (saving >= 15) {
        out.push({
          id: "brand-choice",
          tone: "info",
          title: `${best.name} costs ${saving}% less per board than ${worst.name}`,
          detail: `${best.name} averages ${best.life.toFixed(0)} days per unit against ${worst.name}'s ${worst.life.toFixed(0)}. The cheaper sticker price is the more expensive blade.`,
          action: `Standardise on ${best.name}.`,
        });
      }
    }
  }
  for (const b of ranked) {
    if (b.early !== null && b.early >= 30) {
      out.push({
        id: `brand-fail-${b.name}`,
        tone: "warn",
        title: `${b.name} failed early in ${b.early}% of cycles`,
        detail: "Premature failure means unplanned downtime, not just replacement cost.",
        action: "Raise it with the supplier or stop buying it.",
      });
    }
  }

  // --- Stock ---------------------------------------------------------------
  const low = input.inventory.filter(
    (i) => i.reorderLevel > 0 && i.quantityOnHand <= i.reorderLevel
  );
  if (low.length > 0) {
    const out_ = low.filter((i) => i.quantityOnHand === 0);
    out.push({
      id: "low-stock",
      tone: out_.length > 0 ? "danger" : "warn",
      title:
        out_.length > 0
          ? `${out_.length} item${out_.length === 1 ? "" : "s"} out of stock, ${low.length} at or below reorder level`
          : `${low.length} item${low.length === 1 ? "" : "s"} at or below reorder level`,
      detail: low
        .slice(0, 4)
        .map((i) => `${i.name} (${i.quantityOnHand})`)
        .join(", "),
      action: "Raise a purchase order.",
    });
  }

  // --- Tools off site ------------------------------------------------------
  const overdueTools = input.toolRequests.filter(
    (t) =>
      (t.status === "issued" || t.status === "partially_returned") &&
      t.expectedReturnMs !== null &&
      t.expectedReturnMs < now
  );
  if (overdueTools.length > 0) {
    out.push({
      id: "tools-overdue",
      tone: "warn",
      title: `${overdueTools.length} tool request${overdueTools.length === 1 ? "" : "s"} overdue for return`,
      detail: overdueTools.map((t) => t.jobName).slice(0, 3).join(", "),
      action: "Chase the site before the tools are lost.",
    });
  }

  // --- Customer boards held ------------------------------------------------
  const held = input.serviceInventory.filter((s) => s.status === "held");
  const staleHeld = held.filter(
    (s) => s.receivedAtMs !== null && now - s.receivedAtMs > 21 * DAY
  );
  if (staleHeld.length > 0) {
    const boards = staleHeld.reduce((s, x) => s + x.quantity, 0);
    out.push({
      id: "boards-held",
      tone: "info",
      title: `${boards} customer board${boards === 1 ? "" : "s"} held over 21 days`,
      detail: `From ${new Set(staleHeld.map((s) => s.customerName)).size} customer(s). These occupy floor space and are not yours to use.`,
      action: "Confirm collection dates.",
    });
  }

  // --- Loans ---------------------------------------------------------------
  const outstanding = input.loans
    .filter((l) => l.status === "disbursed" || l.status === "repaying")
    .reduce((s, l) => s + l.outstandingKobo, 0);
  if (outstanding > 0) {
    out.push({
      id: "loans-outstanding",
      tone: "info",
      title: `${formatNairaCompact(outstanding)} in staff loans outstanding`,
      detail: "Deducted automatically from wage runs until settled.",
    });
  }

  // --- Expense concentration ----------------------------------------------
  if (input.expenses.length >= 10) {
    const byCategory = new Map<string, number>();
    let total = 0;
    for (const e of input.expenses) {
      byCategory.set(e.category, (byCategory.get(e.category) ?? 0) + e.amountKobo);
      total += e.amountKobo;
    }
    const top = [...byCategory.entries()].sort((a, b) => b[1] - a[1])[0];
    const share = pct(top[1], total);
    if (share !== null && share >= 35) {
      out.push({
        id: "expense-concentration",
        tone: "info",
        title: `${top[0]} is ${share}% of all spend`,
        detail: `${formatNairaCompact(top[1])} of ${formatNairaCompact(total)}. A single category this dominant is where a saving would matter most.`,
      });
    }
  }

  // --- Throughput ----------------------------------------------------------
  const completed = input.jobs.filter(
    (j) => j.completedAtMs !== null && j.receivedAtMs !== null
  );
  if (completed.length >= 5) {
    const turnarounds = completed.map((j) => (j.completedAtMs! - j.receivedAtMs!) / DAY);
    const avg = mean(turnarounds)!;
    out.push({
      id: "turnaround",
      tone: avg <= 3 ? "good" : "info",
      title: `Average turnaround is ${avg.toFixed(1)} days`,
      detail: `Across ${completed.length} completed jobs, from boards in to collected.`,
    });
  }

  return out;
}

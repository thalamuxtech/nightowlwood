import { WAGE_WORK_TYPES, type WageWorkType } from "./enums";
import { lineAmountKobo, sumKobo, toKobo } from "./money";
import type { WageRate, WorkLog } from "./types";

/**
 * Piece-rate wage engine.
 *
 * Two rules drive everything here, both confirmed against the legacy sheets:
 *
 * 1. **Operators** are paid per unit of work they personally completed.
 * 2. **Assistants** are paid *per the work they actually assisted on* — NOT an
 *    even split of a pooled total. The old `Wage payment` sheet computed one
 *    "Total/Person" and multiplied it by the number of assistants, which
 *    silently pays an assistant who worked one day the same as one who worked
 *    six. Every work log therefore names its assistants, and each assistant
 *    earns the assistant rate on exactly the units they were present for.
 *
 * All rates are versioned and editable; a wage run snapshots the rates it used
 * so re-opening an old week can never be rewritten by a later rate change.
 */

// ---------------------------------------------------------------------------
// Default rates — seeds only
// ---------------------------------------------------------------------------

/**
 * Starting rates, read from the `Wage payment` sheet. These seed the
 * `wageRates` collection on first run and are editable from Settings
 * thereafter; nothing in the engine reads these constants at runtime.
 *
 * Rates marked ESTIMATED had no rate row in the source sheet and need
 * confirming — they are flagged in the UI until an admin saves them.
 */
export const DEFAULT_WAGE_RATES: Array<{
  workType: WageWorkType;
  operatorRateNaira: number;
  assistantRateNaira: number;
  estimated?: boolean;
  note?: string;
}> = [
  { workType: "board", operatorRateNaira: 350, assistantRateNaira: 50 },
  { workType: "door", operatorRateNaira: 1500, assistantRateNaira: 50 },
  {
    workType: "double_door",
    operatorRateNaira: 3000,
    assistantRateNaira: 100,
    estimated: true,
    note: "Charged at ~1.8× a single door (₦18,000 vs ₦10,000); set at 2× the single-door rate pending confirmation.",
  },
  { workType: "frame", operatorRateNaira: 650, assistantRateNaira: 50 },
  {
    workType: "special_frame",
    operatorRateNaira: 1300,
    assistantRateNaira: 50,
    estimated: true,
    note: "No rate row in the source sheet. Seeded at 2× the standard frame rate.",
  },
  { workType: "only_cutting", operatorRateNaira: 200, assistantRateNaira: 0 },
  {
    workType: "grooving",
    operatorRateNaira: 0.25,
    assistantRateNaira: 0,
    note: "Per millimetre of groove run — units in the source sheet reach 5,000, consistent with mm not pieces.",
  },
  { workType: "glass", operatorRateNaira: 0.25, assistantRateNaira: 0 },
  { workType: "gyara", operatorRateNaira: 0.25, assistantRateNaira: 0 },
  {
    workType: "special_board",
    operatorRateNaira: 700,
    assistantRateNaira: 50,
    estimated: true,
    note: "No rate row in the source sheet. Seeded at 2× the board rate.",
  },
  {
    workType: "mortise",
    operatorRateNaira: 500,
    assistantRateNaira: 50,
    estimated: true,
    note: "No rate row in the source sheet. Confirm before the first payroll run.",
  },
];

/** Work types whose seeded rate is a guess and needs admin confirmation. */
export const ESTIMATED_RATE_WORK_TYPES: WageWorkType[] = DEFAULT_WAGE_RATES.filter(
  (r) => r.estimated
).map((r) => r.workType);

// ---------------------------------------------------------------------------
// Rate resolution
// ---------------------------------------------------------------------------

export interface ResolvedRate {
  workType: WageWorkType;
  operatorRateKobo: number;
  assistantRateKobo: number;
}

/**
 * Picks the rate in force for each work type at `atMs`.
 *
 * A rate applies when `effectiveFrom <= atMs` and it has either no
 * `effectiveTo` or one after `atMs`. Where several match, the latest
 * `effectiveFrom` wins — so superseding a rate is an insert, not an overwrite,
 * and history stays intact.
 */
export function resolveRates(rates: WageRate[], atMs: number): Map<WageWorkType, ResolvedRate> {
  const best = new Map<WageWorkType, { fromMs: number; rate: ResolvedRate }>();

  for (const r of rates) {
    const fromMs = r.effectiveFrom?.toMillis?.() ?? 0;
    const toMs = r.effectiveTo?.toMillis?.() ?? Number.POSITIVE_INFINITY;
    if (fromMs > atMs || toMs <= atMs) continue;

    const current = best.get(r.workType);
    if (!current || fromMs > current.fromMs) {
      best.set(r.workType, {
        fromMs,
        rate: {
          workType: r.workType,
          operatorRateKobo: r.operatorRateKobo,
          assistantRateKobo: r.assistantRateKobo,
        },
      });
    }
  }

  const out = new Map<WageWorkType, ResolvedRate>();
  for (const [workType, { rate }] of best) out.set(workType, rate);
  return out;
}

/** Seed rate set as kobo, for first-run initialisation. */
export function defaultResolvedRates(): ResolvedRate[] {
  return DEFAULT_WAGE_RATES.map((r) => ({
    workType: r.workType,
    operatorRateKobo: toKobo(r.operatorRateNaira),
    assistantRateKobo: toKobo(r.assistantRateNaira),
  }));
}

// ---------------------------------------------------------------------------
// Wage calculation
// ---------------------------------------------------------------------------

export interface ComputedWageLine {
  staffId: string;
  staffName: string;
  role: "operator" | "assistant";
  workType: WageWorkType;
  units: number;
  rateKobo: number;
  amountKobo: number;
}

export interface ComputedWageRun {
  lines: ComputedWageLine[];
  /** Per-person totals, so each worker's pay traces to their own work. */
  perStaff: Array<{
    staffId: string;
    staffName: string;
    operatorKobo: number;
    assistantKobo: number;
    totalKobo: number;
  }>;
  operatorTotalKobo: number;
  assistantTotalKobo: number;
  grandTotalKobo: number;
  /** Work types found in the logs that have no rate in force. */
  missingRates: WageWorkType[];
}

type Key = string;
const key = (staffId: string, workType: WageWorkType, role: string): Key =>
  `${staffId}|${workType}|${role}`;

/**
 * Computes a wage run from work logs.
 *
 * Assistants are credited from each log's `assistantIds`, so a log with three
 * named assistants pays each of them the assistant rate on that log's units.
 * `assistantCount` is used only as a fallback for legacy logs that recorded a
 * head count without names — those cannot be attributed per person, so they are
 * reported in `unattributedAssistantKobo` rather than silently divided.
 */
export function computeWageRun(
  logs: WorkLog[],
  rates: Map<WageWorkType, ResolvedRate>,
  staffNames: Map<string, string> = new Map()
): ComputedWageRun & { unattributedAssistantKobo: number } {
  const acc = new Map<Key, ComputedWageLine>();
  const missing = new Set<WageWorkType>();
  let unattributedAssistantKobo = 0;

  const nameFor = (id: string, fallback?: string) =>
    staffNames.get(id) ?? fallback ?? id;

  function add(
    staffId: string,
    staffName: string,
    role: "operator" | "assistant",
    workType: WageWorkType,
    units: number,
    rateKobo: number
  ) {
    if (units <= 0 || rateKobo <= 0) return;
    const k = key(staffId, workType, role);
    const existing = acc.get(k);
    if (existing) {
      existing.units += units;
      existing.amountKobo = lineAmountKobo(existing.units, rateKobo);
    } else {
      acc.set(k, {
        staffId,
        staffName,
        role,
        workType,
        units,
        rateKobo,
        amountKobo: lineAmountKobo(units, rateKobo),
      });
    }
  }

  for (const log of logs) {
    const rate = rates.get(log.workType);
    if (!rate) {
      missing.add(log.workType);
      continue;
    }
    const units = Number.isFinite(log.units) ? log.units : 0;
    if (units <= 0) continue;

    // Operator: paid on their own units.
    add(
      log.staffId,
      nameFor(log.staffId, log.staffName),
      "operator",
      log.workType,
      units,
      rate.operatorRateKobo
    );

    // Assistants: each named assistant earns the rate on these same units.
    const ids = log.assistantIds?.filter(Boolean) ?? [];
    if (ids.length > 0) {
      for (const id of ids) {
        add(id, nameFor(id), "assistant", log.workType, units, rate.assistantRateKobo);
      }
    } else if ((log.assistantCount ?? 0) > 0 && rate.assistantRateKobo > 0) {
      // Legacy/unnamed: record the cost but don't attribute it to anyone.
      unattributedAssistantKobo +=
        lineAmountKobo(units, rate.assistantRateKobo) * (log.assistantCount as number);
    }
  }

  const lines = [...acc.values()].sort(
    (a, b) =>
      a.staffName.localeCompare(b.staffName) ||
      a.role.localeCompare(b.role) ||
      a.workType.localeCompare(b.workType)
  );

  const perStaffMap = new Map<
    string,
    { staffId: string; staffName: string; operatorKobo: number; assistantKobo: number }
  >();
  for (const l of lines) {
    const row =
      perStaffMap.get(l.staffId) ??
      { staffId: l.staffId, staffName: l.staffName, operatorKobo: 0, assistantKobo: 0 };
    if (l.role === "operator") row.operatorKobo += l.amountKobo;
    else row.assistantKobo += l.amountKobo;
    perStaffMap.set(l.staffId, row);
  }

  const perStaff = [...perStaffMap.values()]
    .map((r) => ({ ...r, totalKobo: r.operatorKobo + r.assistantKobo }))
    .sort((a, b) => b.totalKobo - a.totalKobo);

  const operatorTotalKobo = sumKobo(
    lines.filter((l) => l.role === "operator").map((l) => l.amountKobo)
  );
  const assistantTotalKobo = sumKobo(
    lines.filter((l) => l.role === "assistant").map((l) => l.amountKobo)
  );

  return {
    lines,
    perStaff,
    operatorTotalKobo,
    assistantTotalKobo,
    grandTotalKobo: operatorTotalKobo + assistantTotalKobo + unattributedAssistantKobo,
    missingRates: [...missing],
    unattributedAssistantKobo,
  };
}

// ---------------------------------------------------------------------------
// Deductions
// ---------------------------------------------------------------------------

export interface DeductionInput {
  staffId: string;
  outstandingKobo: number;
  /** Optional cap so a large loan doesn't consume a whole week's pay. */
  maxPerRunKobo?: number;
}

export interface AppliedDeduction {
  staffId: string;
  deductedKobo: number;
  remainingKobo: number;
}

/**
 * Applies loan/advance deductions against each staff member's gross.
 *
 * A deduction never exceeds the gross earned, so net pay cannot go negative —
 * the unpaid balance simply carries to the next run.
 */
export function applyDeductions(
  perStaff: Array<{ staffId: string; totalKobo: number }>,
  deductions: DeductionInput[]
): { applied: AppliedDeduction[]; totalDeductedKobo: number } {
  const byStaff = new Map(deductions.map((d) => [d.staffId, d]));
  const applied: AppliedDeduction[] = [];

  for (const staff of perStaff) {
    const d = byStaff.get(staff.staffId);
    if (!d || d.outstandingKobo <= 0) continue;

    const cap = d.maxPerRunKobo ?? d.outstandingKobo;
    const deducted = Math.max(0, Math.min(staff.totalKobo, d.outstandingKobo, cap));
    if (deducted <= 0) continue;

    applied.push({
      staffId: staff.staffId,
      deductedKobo: deducted,
      remainingKobo: d.outstandingKobo - deducted,
    });
  }

  return {
    applied,
    totalDeductedKobo: sumKobo(applied.map((a) => a.deductedKobo)),
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Week boundaries (Mon 00:00 → Sun 23:59:59.999) containing `date`. */
export function weekBounds(date: Date): { start: Date; end: Date } {
  const start = new Date(date);
  const dow = start.getDay(); // 0 = Sunday
  const backToMonday = dow === 0 ? 6 : dow - 1;
  start.setDate(start.getDate() - backToMonday);
  start.setHours(0, 0, 0, 0);

  const end = new Date(start);
  end.setDate(end.getDate() + 6);
  end.setHours(23, 59, 59, 999);

  return { start, end };
}

/** True when `workType` is a known wage work type. */
export function isWageWorkType(value: string): value is WageWorkType {
  return (WAGE_WORK_TYPES as readonly string[]).includes(value);
}

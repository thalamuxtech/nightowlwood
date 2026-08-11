import {
  WAGE_WORK_TYPES,
  WAGE_WORK_TYPE_LABELS,
  type DeductionType,
  type WageWorkType,
} from "./enums";
import { lineAmountKobo, sumKobo, toKobo } from "./money";
import type { StaffRate, WageRate, WorkLog } from "./types";
import { itemsFrom } from "./workLogs";

/**
 * Piece-rate wage engine.
 *
 * Two rules drive everything here, both confirmed against the legacy sheets:
 *
 * 1. **Operators** are paid per unit of work they personally completed.
 * 2. **Assistants** are paid *per the work they actually assisted on*, NOT an
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
// Default rates, seeds only
// ---------------------------------------------------------------------------

/**
 * Starting rates, read from the `Wage payment` sheet. These seed the
 * `wageRates` collection on first run and are editable from Settings
 * thereafter; nothing in the engine reads these constants at runtime.
 *
 * Rates marked ESTIMATED had no rate row in the source sheet and need
 * confirming, they are flagged in the UI until an admin saves them.
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
    note: "Per millimetre of groove run, units in the source sheet reach 5,000, consistent with mm not pieces.",
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
 * `effectiveFrom` wins, so superseding a rate is an insert, not an overwrite,
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
// Per-person rates
// ---------------------------------------------------------------------------

/**
 * A person's rate, keyed by role and optionally by work type.
 *
 * `${staffId}|${role}|${workType ?? '*'}` — the `*` slot is a rate that applies to
 * every kind of work, which is how most overrides are set up ("Musa is on ₦400 a
 * board" is rare; "Musa gets 15% more than standard" is not expressible as a rate,
 * so it lands as a per-type figure, while a straight uplift lands on `*`).
 */
export type PersonalRates = Map<string, number>;

const personalKey = (
  staffId: string,
  role: "operator" | "assistant",
  workType: WageWorkType | null | undefined
) => `${staffId}|${role}|${workType ?? "*"}`;

/**
 * Picks the per-person rates in force at `atMs`.
 *
 * Same versioning rule as `resolveRates`: a row applies when `effectiveFrom <= atMs`
 * and it has no `effectiveTo` or one after `atMs`, and the latest `effectiveFrom`
 * wins. Raising someone's rate is an insert, so an old wage run stays reproducible.
 */
export function resolveStaffRates(rates: StaffRate[], atMs: number): PersonalRates {
  const best = new Map<string, { fromMs: number; rateKobo: number }>();

  for (const r of rates) {
    if (!r.staffId || !r.role) continue;
    const fromMs = r.effectiveFrom?.toMillis?.() ?? 0;
    const toMs = r.effectiveTo?.toMillis?.() ?? Number.POSITIVE_INFINITY;
    if (fromMs > atMs || toMs <= atMs) continue;
    if (!Number.isFinite(r.rateKobo) || r.rateKobo < 0) continue;

    const k = personalKey(r.staffId, r.role, r.workType);
    const current = best.get(k);
    if (!current || fromMs > current.fromMs) {
      best.set(k, { fromMs, rateKobo: r.rateKobo });
    }
  }

  const out: PersonalRates = new Map();
  for (const [k, { rateKobo }] of best) out.set(k, rateKobo);
  return out;
}

/**
 * What one person is paid for one kind of work.
 *
 * Precedence, most specific first: a rate for this person *and* this work type, then
 * a rate for this person across all work, then the work-type rate everyone gets.
 * Anything else would make a general uplift silently override a deliberate
 * per-type exception.
 *
 * Returns `personal` so the run can show which figures were overridden — a payslip
 * that cannot explain why two operators on the same work were paid differently is
 * the thing that starts the argument.
 */
export function rateFor(
  staffId: string,
  role: "operator" | "assistant",
  workType: WageWorkType,
  workTypeRate: ResolvedRate | undefined,
  personal: PersonalRates
): { rateKobo: number; personal: boolean } {
  const specific = personal.get(personalKey(staffId, role, workType));
  if (specific !== undefined) return { rateKobo: specific, personal: true };

  const general = personal.get(personalKey(staffId, role, null));
  if (general !== undefined) return { rateKobo: general, personal: true };

  const base =
    role === "operator"
      ? workTypeRate?.operatorRateKobo
      : workTypeRate?.assistantRateKobo;
  return { rateKobo: base ?? 0, personal: false };
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
  /** True when this rate came from a per-person override. */
  personalRate?: boolean;
}

export interface ComputedStaffRow {
  staffId: string;
  staffName: string;
  operatorKobo: number;
  assistantKobo: number;
  totalKobo: number;
  /** This person's own pay lines, so a payslip can show the working. */
  rateLines: Array<{
    role: "operator" | "assistant";
    workType: WageWorkType;
    units: number;
    rateKobo: number;
    amountKobo: number;
    personalRate?: boolean;
  }>;
}

export interface ComputedWageRun {
  lines: ComputedWageLine[];
  /** Per-person totals, so each worker's pay traces to their own work. */
  perStaff: ComputedStaffRow[];
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
 * Three rules, each of which was a real defect in the sheets this replaces:
 *
 * - **Every work type on a log is paid.** A log carries several kinds of work with
 *   their own counts, and each is priced at its own rate. Reading only the first
 *   would pay an operator for the boards and not the doors.
 * - **Assistants are credited from `assistantIds`**, so a log with three named
 *   assistants pays each of them on that log's units. `assistantCount` is a
 *   fallback for legacy logs that recorded a head count without names; those cannot
 *   be attributed, so they are reported in `unattributedAssistantKobo` rather than
 *   silently divided.
 * - **A person's own rate beats the work-type rate**, so raising one operator does
 *   not raise everyone. See `rateFor`.
 */
export function computeWageRun(
  logs: WorkLog[],
  rates: Map<WageWorkType, ResolvedRate>,
  staffNames: Map<string, string> = new Map(),
  personalRates: PersonalRates = new Map()
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
    rateKobo: number,
    personal: boolean
  ) {
    if (units <= 0 || rateKobo <= 0) return;
    const k = key(staffId, workType, role);
    const existing = acc.get(k);
    if (existing) {
      existing.units += units;
      existing.amountKobo = lineAmountKobo(existing.units, existing.rateKobo);
    } else {
      acc.set(k, {
        staffId,
        staffName,
        role,
        workType,
        units,
        rateKobo,
        amountKobo: lineAmountKobo(units, rateKobo),
        personalRate: personal,
      });
    }
  }

  for (const log of logs) {
    // Every kind of work on the entry, whichever era the entry was written in.
    const items = itemsFrom(log);
    const ids = log.assistantIds?.filter(Boolean) ?? [];

    for (const item of items) {
      const workTypeRate = rates.get(item.workType);
      const units = Number.isFinite(item.units) ? item.units : 0;
      if (units <= 0) continue;

      // A work type with no rate at all is reported rather than paid at zero, so a
      // forgotten rate surfaces as a warning instead of as someone's missing wage.
      // A *personal* rate is enough on its own: it fully determines the pay.
      const operator = rateFor(
        log.staffId,
        "operator",
        item.workType,
        workTypeRate,
        personalRates
      );
      if (!workTypeRate && !operator.personal) {
        missing.add(item.workType);
        continue;
      }

      add(
        log.staffId,
        nameFor(log.staffId, log.staffName),
        "operator",
        item.workType,
        units,
        operator.rateKobo,
        operator.personal
      );

      if (ids.length > 0) {
        for (const id of ids) {
          const assistant = rateFor(
            id,
            "assistant",
            item.workType,
            workTypeRate,
            personalRates
          );
          add(
            id,
            nameFor(id),
            "assistant",
            item.workType,
            units,
            assistant.rateKobo,
            assistant.personal
          );
        }
      } else if (
        (log.assistantCount ?? 0) > 0 &&
        (workTypeRate?.assistantRateKobo ?? 0) > 0
      ) {
        // Legacy/unnamed: record the cost but don't attribute it to anyone.
        unattributedAssistantKobo +=
          lineAmountKobo(units, workTypeRate!.assistantRateKobo) *
          (log.assistantCount as number);
      }
    }
  }

  const lines = [...acc.values()].sort(
    (a, b) =>
      a.staffName.localeCompare(b.staffName) ||
      a.role.localeCompare(b.role) ||
      a.workType.localeCompare(b.workType)
  );

  const perStaffMap = new Map<string, ComputedStaffRow>();
  for (const l of lines) {
    const row =
      perStaffMap.get(l.staffId) ??
      ({
        staffId: l.staffId,
        staffName: l.staffName,
        operatorKobo: 0,
        assistantKobo: 0,
        totalKobo: 0,
        rateLines: [],
      } satisfies ComputedStaffRow);
    if (l.role === "operator") row.operatorKobo += l.amountKobo;
    else row.assistantKobo += l.amountKobo;
    row.rateLines.push({
      role: l.role,
      workType: l.workType,
      units: l.units,
      rateKobo: l.rateKobo,
      amountKobo: l.amountKobo,
      personalRate: l.personalRate,
    });
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

/** A deduction raised at the work log, awaiting a run to apply it. */
export interface PendingDeduction {
  id: string;
  staffId: string;
  type: DeductionType;
  amountKobo: number;
  reason?: string;
}

export interface AppliedStaffDeductions {
  staffId: string;
  loanDeductionKobo: number;
  /** The work-log deductions taken, in the order they were applied. */
  taken: Array<{
    id: string;
    type: DeductionType;
    amountKobo: number;
    reason?: string;
  }>;
  otherDeductionKobo: number;
  totalDeductionKobo: number;
}

/**
 * Applies loan/advance deductions against each staff member's gross.
 *
 * A deduction never exceeds the gross earned, so net pay cannot go negative -
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

/**
 * Applies loan repayments *and* work-log deductions to each person's gross.
 *
 * Order matters: loans first, then work-log deductions. A loan is money the business
 * has already handed over and is the more certain debt, so it gets first claim on
 * what is available. A penalty that cannot be taken in full this week is simply not
 * claimed and stays pending for the next run — which is why only the deductions
 * actually `taken` are reported back, and why the run marks precisely those as
 * applied rather than all of them.
 *
 * Net pay is never negative. Withholding more than someone earned would mean the
 * business claiming a worker owes it labour, and the correct behaviour is to carry
 * the remainder forward.
 *
 * A deduction is taken whole or not at all. Splitting a ₦5,000 penalty into ₦3,000
 * now and ₦2,000 later would need part-payment state on the deduction document, and
 * without it the second run would re-take the full amount.
 */
export function applyAllDeductions(
  perStaff: Array<{ staffId: string; totalKobo: number }>,
  loans: DeductionInput[],
  pending: PendingDeduction[]
): {
  byStaff: Map<string, AppliedStaffDeductions>;
  loanApplied: AppliedDeduction[];
  appliedDeductionIds: string[];
  totalDeductedKobo: number;
} {
  const { applied: loanApplied } = applyDeductions(perStaff, loans);
  const loanByStaff = new Map(loanApplied.map((a) => [a.staffId, a.deductedKobo]));

  const pendingByStaff = new Map<string, PendingDeduction[]>();
  for (const d of pending) {
    if (d.amountKobo <= 0) continue;
    const list = pendingByStaff.get(d.staffId) ?? [];
    list.push(d);
    pendingByStaff.set(d.staffId, list);
  }

  const byStaff = new Map<string, AppliedStaffDeductions>();
  const appliedDeductionIds: string[] = [];

  for (const staff of perStaff) {
    const loanDeductionKobo = loanByStaff.get(staff.staffId) ?? 0;
    let remainingGross = Math.max(0, staff.totalKobo - loanDeductionKobo);

    const taken: AppliedStaffDeductions["taken"] = [];
    // Smallest first, so a week's pay clears as many separate matters as it can
    // rather than being consumed by one large penalty that then blocks the rest.
    const queue = [...(pendingByStaff.get(staff.staffId) ?? [])].sort(
      (a, b) => a.amountKobo - b.amountKobo
    );

    for (const d of queue) {
      if (d.amountKobo > remainingGross) continue;
      taken.push({
        id: d.id,
        type: d.type,
        amountKobo: d.amountKobo,
        reason: d.reason,
      });
      appliedDeductionIds.push(d.id);
      remainingGross -= d.amountKobo;
    }

    const otherDeductionKobo = sumKobo(taken.map((t) => t.amountKobo));
    if (loanDeductionKobo === 0 && otherDeductionKobo === 0) continue;

    byStaff.set(staff.staffId, {
      staffId: staff.staffId,
      loanDeductionKobo,
      taken,
      otherDeductionKobo,
      totalDeductionKobo: loanDeductionKobo + otherDeductionKobo,
    });
  }

  return {
    byStaff,
    loanApplied,
    appliedDeductionIds,
    totalDeductedKobo: sumKobo(
      [...byStaff.values()].map((s) => s.totalDeductionKobo)
    ),
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

/** True when `workType` is one of the built-in wage work types. */
export function isWageWorkType(value: string): value is WageWorkType {
  return (WAGE_WORK_TYPES as readonly string[]).includes(value);
}

// ---------------------------------------------------------------------------
// The effective work-type list
// ---------------------------------------------------------------------------

export interface ResolvedWorkType {
  id: string;
  label: string;
  /** False for a type the workshop added itself. */
  builtIn: boolean;
}

/**
 * Every work type currently in use: the built-ins the workshop has not hidden, plus its
 * own additions.
 *
 * One function so the rates screen, the work log picker and the wage run all offer the
 * same vocabulary. Hidden built-ins are dropped from *pickers* only — `labelForWorkType`
 * still resolves them, because a work log from last year references one and has to keep
 * rendering a name rather than a raw id.
 */
export function resolveWorkTypes(settings: {
  custom?: Array<{ id: string; label: string }>;
  hidden?: string[];
}): ResolvedWorkType[] {
  const hidden = new Set(settings.hidden ?? []);

  const builtIns: ResolvedWorkType[] = WAGE_WORK_TYPES.filter(
    (t) => !hidden.has(t)
  ).map((t) => ({ id: t, label: WAGE_WORK_TYPE_LABELS[t], builtIn: true }));

  const custom: ResolvedWorkType[] = (settings.custom ?? [])
    .filter((c) => c.id && c.label && !hidden.has(c.id))
    // A custom entry that collides with a built-in id would shadow it and price the same
    // work twice under one name, so the built-in wins.
    .filter((c) => !(WAGE_WORK_TYPES as readonly string[]).includes(c.id))
    .map((c) => ({ id: c.id, label: c.label, builtIn: false }));

  return [...builtIns, ...custom];
}

/**
 * A work type's label, whatever its origin and whether or not it is still offered.
 *
 * Falls back to the raw id rather than to "Unknown", because a wage line reading
 * `special_jig` is at least traceable while one reading "Unknown" is not.
 */
export function labelForWorkType(
  id: string,
  custom: Array<{ id: string; label: string }> = []
): string {
  if (isWageWorkType(id)) return WAGE_WORK_TYPE_LABELS[id];
  return custom.find((c) => c.id === id)?.label ?? id;
}

/**
 * Turns a typed name into an id: "Special Jig" → "special_jig".
 *
 * Ids are stable and stored on every work log and wage line, so they are derived from the
 * name once, at creation, and never recomputed — renaming a type later changes its label
 * and leaves the id alone, which is what keeps historical records attached to it.
 */
export function workTypeIdFrom(label: string): string {
  return label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

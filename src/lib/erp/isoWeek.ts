/**
 * ISO-8601 calendar weeks.
 *
 * The workshop groups its work logs by week number, and the brief pins down exactly which
 * definition it means with a worked example: "Calendar week 1 of 2026 ran from Monday, December 29,
 * 2025, to Sunday, January 4, 2026." That is ISO-8601 — weeks start on Monday, and week 1 is the one
 * containing the year's first Thursday — and it is why a naive "divide the day-of-year by seven"
 * cannot be used: by that reckoning 29 December 2025 is week 52 of 2025, not week 1 of 2026.
 *
 * The consequence worth knowing: **a week belongs to a year that may not be the calendar year of its
 * dates.** The last days of December often belong to week 1 of the next year, and the first days of
 * January often belong to week 52 or 53 of the previous one. So a week is identified by a *pair* —
 * `{ isoYear, week }` — and using the calendar year with the week number produces a label that is
 * wrong for a few days every December.
 *
 * A year has 53 ISO weeks when it starts on a Thursday, or when it is a leap year starting on a
 * Wednesday. Everything else has 52. That is the reason the brief says "Week 1–53".
 */

/** A day at local noon, which is immune to daylight-saving shifts either side of midnight. */
function atNoon(y: number, m: number, d: number): Date {
  return new Date(y, m - 1, d, 12, 0, 0, 0);
}

/** Parses `yyyy-mm-dd` to a local-noon Date, or null if unusable. */
export function dateFromKey(dateKey: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateKey.trim());
  if (!match) return null;
  const d = atNoon(Number(match[1]), Number(match[2]), Number(match[3]));
  return Number.isNaN(d.getTime()) ? null : d;
}

/** `yyyy-mm-dd` for a Date, in local time. */
export function keyFromDate(date: Date): string {
  return date.toLocaleDateString("en-CA");
}

export interface IsoWeek {
  /** The year the week belongs to, which is not always the calendar year of its dates. */
  isoYear: number;
  /** 1 to 53. */
  week: number;
}

/**
 * The ISO week a date falls in.
 *
 * The standard trick: move to the Thursday of the same week, and that Thursday's calendar year is
 * the ISO year by definition — because week 1 is the week containing the first Thursday. The week
 * number is then how many weeks that Thursday is past the first Thursday of its year.
 */
export function isoWeekOf(date: Date): IsoWeek {
  // Monday-based day index: Mon 0 … Sun 6. `getDay()` is Sunday-based, hence the shift.
  const dayIndex = (date.getDay() + 6) % 7;

  const thursday = new Date(date);
  thursday.setDate(date.getDate() - dayIndex + 3);

  const isoYear = thursday.getFullYear();

  // The first Thursday of that ISO year, found from 4 January — which is always in week 1.
  const jan4 = atNoon(isoYear, 1, 4);
  const jan4Index = (jan4.getDay() + 6) % 7;
  const firstThursday = new Date(jan4);
  firstThursday.setDate(jan4.getDate() - jan4Index + 3);

  const week =
    Math.round((thursday.getTime() - firstThursday.getTime()) / (7 * 86_400_000)) + 1;

  return { isoYear, week };
}

/** The ISO week for a `yyyy-mm-dd` key, or null when the key is unusable. */
export function isoWeekOfKey(dateKey: string): IsoWeek | null {
  const d = dateFromKey(dateKey);
  return d ? isoWeekOf(d) : null;
}

/** The Monday that starts a given ISO week. */
export function isoWeekStart(isoYear: number, week: number): Date {
  const jan4 = atNoon(isoYear, 1, 4);
  const jan4Index = (jan4.getDay() + 6) % 7;
  // Monday of week 1, then forward by whole weeks.
  const monday = new Date(jan4);
  monday.setDate(jan4.getDate() - jan4Index + (week - 1) * 7);
  return monday;
}

/** The Sunday that ends a given ISO week. */
export function isoWeekEnd(isoYear: number, week: number): Date {
  const end = isoWeekStart(isoYear, week);
  end.setDate(end.getDate() + 6);
  return end;
}

/**
 * How many ISO weeks a year has — 52 or 53.
 *
 * Derived rather than tabulated: 28 December is always in the last week of its ISO year, so its week
 * number *is* the count.
 */
export function isoWeeksInYear(isoYear: number): number {
  return isoWeekOf(atNoon(isoYear, 12, 28)).week;
}

/** A sortable key for a week, so weeks order correctly across a year boundary. */
export function isoWeekKey(w: IsoWeek): string {
  return `${w.isoYear}-W${String(w.week).padStart(2, "0")}`;
}

/** `Week 32` — for a list already scoped to one year. */
export function isoWeekLabel(w: IsoWeek): string {
  return `Week ${w.week}`;
}

/**
 * `Week 32 · 3–9 Aug 2026` — the label with the dates it covers.
 *
 * The dates matter: "Week 32" alone is a number nobody can check against a paper record, and the
 * whole reason for grouping this way is to match how the workshop already talks about its weeks.
 */
export function isoWeekRangeLabel(w: IsoWeek): string {
  const start = isoWeekStart(w.isoYear, w.week);
  const end = isoWeekEnd(w.isoYear, w.week);

  const sameMonth = start.getMonth() === end.getMonth();
  const sameYear = start.getFullYear() === end.getFullYear();

  const day = (d: Date) => d.getDate();
  const mon = (d: Date) => d.toLocaleDateString("en-GB", { month: "short" });
  const yr = (d: Date) => d.getFullYear();

  // Collapsed where the parts repeat: "3–9 Aug 2026", not "3 Aug 2026–9 Aug 2026".
  const range = sameMonth && sameYear
    ? `${day(start)}–${day(end)} ${mon(end)} ${yr(end)}`
    : sameYear
      ? `${day(start)} ${mon(start)} – ${day(end)} ${mon(end)} ${yr(end)}`
      : `${day(start)} ${mon(start)} ${yr(start)} – ${day(end)} ${mon(end)} ${yr(end)}`;

  return `Week ${w.week} · ${range}`;
}

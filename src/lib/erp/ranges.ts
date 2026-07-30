/**
 * Reporting ranges.
 *
 * The dashboard originally hardcoded five windows ending at 12 months, which
 * silently caps what the business can look at: once there are three years of
 * records, "all time" is unreachable and a year-on-year comparison is impossible.
 *
 * Ranges are now data, and an admin can add their own from Settings. The presets
 * below are only the starting set.
 */

export interface ReportRange {
  key: string;
  label: string;
  /** Days back from today. `null` means everything on record. */
  days: number | null;
}

/**
 * Default ranges.
 *
 * "All time" is included from the outset rather than added when the data grows,
 * because the failure it prevents is invisible: without it a chart looks complete
 * while quietly excluding the oldest records.
 */
export const DEFAULT_RANGES: ReportRange[] = [
  { key: "1d", label: "Today", days: 1 },
  { key: "7d", label: "7 days", days: 7 },
  { key: "30d", label: "30 days", days: 30 },
  { key: "90d", label: "90 days", days: 90 },
  { key: "1y", label: "12 months", days: 365 },
  { key: "2y", label: "2 years", days: 730 },
  { key: "5y", label: "5 years", days: 1825 },
  { key: "all", label: "All time", days: null },
];

/** Range the dashboard opens on. */
export const DEFAULT_RANGE_KEY = "30d";

/**
 * Bucket size for a range.
 *
 * Plotting five years by day gives roughly 1,800 points, which is unreadable and
 * slow to render. The granularity therefore follows the span: days for short
 * windows, months for a year or more, quarters beyond three years.
 */
export type Bucket = "day" | "week" | "month" | "quarter";

export function bucketFor(days: number | null): Bucket {
  if (days === null) return "quarter";
  if (days <= 31) return "day";
  if (days <= 120) return "week";
  if (days <= 1095) return "month";
  return "quarter";
}

/** Stable key for grouping a timestamp into its bucket. */
export function bucketKey(ms: number, bucket: Bucket): string {
  const d = new Date(ms);
  const y = d.getFullYear();
  switch (bucket) {
    case "day":
      return `${y}-${d.getMonth()}-${d.getDate()}`;
    case "week": {
      // ISO-ish week start (Monday), so a week bucket is a real trading week.
      const day = d.getDay();
      const monday = new Date(d);
      monday.setDate(d.getDate() - (day === 0 ? 6 : day - 1));
      return `${monday.getFullYear()}-w${monday.getMonth()}-${monday.getDate()}`;
    }
    case "month":
      return `${y}-${d.getMonth()}`;
    case "quarter":
      return `${y}-q${Math.floor(d.getMonth() / 3)}`;
  }
}

/** Human label for a bucket, sized to the granularity. */
export function bucketLabel(ms: number, bucket: Bucket): string {
  const d = new Date(ms);
  switch (bucket) {
    case "day":
      return d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
    case "week":
      return d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
    case "month":
      return d.toLocaleDateString("en-GB", { month: "short", year: "2-digit" });
    case "quarter":
      return `Q${Math.floor(d.getMonth() / 3) + 1} ${String(d.getFullYear()).slice(2)}`;
  }
}

/**
 * Validates an admin-entered range.
 *
 * Returns an error string rather than throwing, so the settings form can show it
 * against the field. A range with no label or a non-positive span would render as
 * a blank, unusable chip.
 */
export function validateRange(input: {
  label: string;
  days: number | null;
}): string | null {
  if (!input.label.trim()) return "Give the range a label.";
  if (input.label.trim().length > 24) return "Keep the label under 24 characters.";
  if (input.days !== null) {
    if (!Number.isFinite(input.days) || input.days < 1) {
      return "Days must be 1 or more, or blank for all time.";
    }
    // ~55 years. Beyond this the bucket maths is fine but the intent is a typo.
    if (input.days > 20000) return "That looks like a typo. Use 'all time' instead.";
  }
  return null;
}

/** Stable key from a label, for a newly added range. */
export function rangeKeyFrom(label: string, existing: ReportRange[]): string {
  const base = label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 16) || "range";
  let key = base;
  let n = 2;
  while (existing.some((r) => r.key === key)) key = `${base}-${n++}`;
  return key;
}

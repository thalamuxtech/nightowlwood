/**
 * Shared chart styling for the admin dashboards.
 *
 * Recharts tooltips need three separate style props, and `contentStyle` alone is
 * not enough:
 *
 *  - `contentStyle` styles the box, and the category label inherits from it.
 *  - `itemStyle` styles each series row. This is the one that matters: recharts
 *    writes the *series colour* inline on every row, so a dark series renders as
 *    dark text on the dark tooltip and cannot be read. Measured against the
 *    tooltip background, the "expenses" brown came out at 3.82:1, under the 4.5:1
 *    needed for normal text; cream lifts it to 14.36:1.
 *  - `labelStyle` is set explicitly rather than relied upon, so the label does not
 *    depend on inheritance that a future recharts version may change.
 *
 * The colour coding is not lost: recharts still draws the series swatch beside
 * each row, which is where colour belongs.
 */

export const CHART = {
  /** Muted cream, for axis ticks and legends. */
  axis: "#8e8781",
  /** Hairline for axes and grid lines. */
  line: "#2a2520",
  grid: "#241f19",
} as const;

/** The tooltip box. */
export const TOOLTIP_CONTENT = {
  background: "#14100b",
  border: "1px solid #3a332b",
  borderRadius: 12,
  fontSize: 12,
  // Applies to any text recharts does not colour itself.
  color: "#faf7f2",
  boxShadow: "0 10px 30px rgba(0,0,0,0.45)",
} as const;

/** The category label. Set explicitly rather than left to inheritance. */
export const TOOLTIP_LABEL = {
  color: "#f5efe6",
  fontWeight: 600,
  marginBottom: 4,
} as const;

/**
 * Each series row.
 *
 * Cream rather than the series colour: on a dark panel several of the brand
 * colours are too dark to read as small text, and the swatch recharts draws
 * beside each row already carries the colour coding.
 */
export const TOOLTIP_ITEM = {
  color: "#e8dfd2",
} as const;

/** Spread onto every `<Tooltip>` so no chart can drift from the others. */
export const TOOLTIP_PROPS = {
  contentStyle: TOOLTIP_CONTENT,
  labelStyle: TOOLTIP_LABEL,
  itemStyle: TOOLTIP_ITEM,
  /** Keeps the highlight subtle instead of a bright block over the bars. */
  cursor: { fill: "rgba(192,138,62,0.10)", stroke: "rgba(192,138,62,0.35)" },
} as const;

/** Legend text, which shares the tooltip's readability problem. */
export const LEGEND_STYLE = { fontSize: 12, color: CHART.axis } as const;

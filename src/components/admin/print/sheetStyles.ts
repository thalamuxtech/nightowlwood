/**
 * Shared design language for the printed documents.
 *
 * These sheets go to customers, staff and site supervisors, so they are the most
 * public artefacts the system produces. Three decisions drive the look:
 *
 *  1. **A brass rule under a dark header band.** The Job Order Tracker used
 *     decorative corner swooshes, which consumed roughly a fifth of an A4 sheet
 *     and cost ink on every print. A single band carries the same brand weight in
 *     a fraction of the space and survives a monochrome printer.
 *  2. **One accent, used sparingly.** Brass marks the header rule, the total row
 *     and section labels. Colouring more than that flattens the hierarchy and the
 *     eye stops finding the total.
 *  3. **Tabular figures and right-aligned money.** Digits of differing width make
 *     a column of amounts impossible to scan; aligning on the decimal is what
 *     lets someone check a total by eye.
 *
 * Everything is in pt and mm. Print engines resolve px inconsistently, and a
 * sheet that measures right on screen can come out a few millimetres off.
 */

export const SHEET = {
  brown: "#5c3f22",
  brownLight: "#8a6a45",
  brass: "#c08a3e",
  brassPale: "#f2e7d5",
  ink: "#161310",
  muted: "#6f665d",
  faint: "#a09689",
  border: "#ded3c3",
  borderSoft: "#eee7dc",
  panel: "#faf7f2",
  /** Font stack chosen for U+20A6: the naira sign is missing from several
   *  common printer fonts and prints as an empty box without a fallback. */
  font: '"DejaVu Sans", "Segoe UI", Tahoma, Helvetica, Arial, sans-serif',
} as const;

/**
 * Rules shared by every sheet.
 *
 * Emitted inside each sheet's own `@media print` block and again, scoped, for the
 * on-screen preview, so the preview and the paper agree.
 */
export const SHEET_BASE_CSS = `
  /* Header band: brand on the left, document identity on the right. */
  .sh-band {
    display: flex; align-items: flex-start; justify-content: space-between;
    padding: 0 0 7pt;
    border-bottom: 3pt solid ${SHEET.brown};
    position: relative;
  }
  /* A thin brass line directly under the brown gives the header depth without
     a second block of ink. */
  .sh-band::after {
    content: ""; position: absolute; left: 0; right: 0; bottom: -4.5pt;
    height: 1pt; background: ${SHEET.brass};
  }
  .sh-brand { display: flex; align-items: center; gap: 9pt; }
  .sh-co {
    font-size: 12.5pt; font-weight: bold; color: ${SHEET.brown};
    text-transform: uppercase; letter-spacing: 0.7pt; line-height: 1.15;
  }
  .sh-tag {
    font-size: 6pt; letter-spacing: 1.8pt; color: ${SHEET.muted};
    text-transform: uppercase; margin-top: 2pt;
  }
  .sh-doc { text-align: right; }
  .sh-kind {
    font-size: 7pt; letter-spacing: 2.4pt; text-transform: uppercase;
    color: ${SHEET.muted};
  }
  .sh-ref {
    font-size: 15pt; font-weight: bold; color: ${SHEET.ink};
    letter-spacing: 0.3pt; line-height: 1.1; font-variant-numeric: tabular-nums;
  }
  .sh-sub { font-size: 8pt; color: ${SHEET.muted}; margin-top: 1pt; }

  /* Status chip, outlined rather than filled so it costs almost no ink. */
  .sh-chip {
    display: inline-block; margin-top: 3pt; padding: 1.5pt 7pt;
    border: 0.75pt solid ${SHEET.brass}; border-radius: 9pt;
    font-size: 6.5pt; text-transform: uppercase; letter-spacing: 1pt;
    color: ${SHEET.brown};
  }

  /* Section heading: small caps over a hairline. */
  .sh-h2 {
    font-size: 7pt; font-weight: bold; letter-spacing: 1.6pt;
    text-transform: uppercase; color: ${SHEET.brown};
    border-bottom: 0.5pt solid ${SHEET.border};
    padding-bottom: 2.5pt; margin: 0 0 5pt;
  }

  .sh-block { margin-top: 11pt; break-inside: avoid; }
  .sh-cols { display: flex; gap: 16pt; }
  .sh-cols > div { flex: 1; min-width: 0; }

  /* Label / value pair. */
  .sh-row { display: flex; gap: 6pt; padding: 1.5pt 0; font-size: 8.5pt; }
  .sh-label { color: ${SHEET.muted}; min-width: 62pt; }
  .sh-value { color: ${SHEET.ink}; font-weight: 600; }

  /* Tables. A tinted header and hairline body keep long lists readable without
     heavy rules on every cell. */
  .sh-table { width: 100%; border-collapse: collapse; margin-top: 3pt; }
  .sh-table thead { display: table-header-group; }
  .sh-table th {
    background: ${SHEET.brassPale}; color: ${SHEET.brown};
    font-size: 7pt; text-transform: uppercase; letter-spacing: 0.8pt;
    text-align: left; padding: 4.5pt 5pt;
    border-bottom: 0.75pt solid ${SHEET.brass};
  }
  .sh-table td {
    padding: 4.5pt 5pt; font-size: 8.5pt; color: ${SHEET.ink};
    border-bottom: 0.5pt solid ${SHEET.borderSoft};
  }
  /* Zebra striping at very low contrast: enough to follow a row across a wide
     table, light enough not to grey the page. */
  .sh-table tbody tr:nth-child(even) td { background: #fcfaf6; }
  .sh-num { text-align: right; font-variant-numeric: tabular-nums; }
  .sh-blank td { height: 15pt; }
  .sh-empty {
    color: ${SHEET.faint}; font-style: italic; text-align: center; padding: 7pt;
  }

  /* Totals: only the final line is filled, so the eye lands on it. */
  .sh-totals {
    margin-left: auto; margin-top: 7pt; border-collapse: collapse; min-width: 200pt;
  }
  .sh-totals td { padding: 3.5pt 9pt; font-size: 9pt; color: ${SHEET.muted}; }
  .sh-totals td:last-child {
    text-align: right; font-weight: bold; color: ${SHEET.ink};
    min-width: 84pt; font-variant-numeric: tabular-nums;
  }
  .sh-grand td {
    background: ${SHEET.brassPale}; color: ${SHEET.brown};
    font-size: 11.5pt; font-weight: bold;
    border-top: 1pt solid ${SHEET.brass};
  }
  .sh-grand td:last-child { color: ${SHEET.brown}; }

  /* Signature line. */
  .sh-sign { display: flex; align-items: flex-end; gap: 6pt; margin-top: 10pt; }
  .sh-sign > span:first-child {
    color: ${SHEET.muted}; min-width: 52pt; font-size: 8pt;
  }
  .sh-rule { flex: 1; border-bottom: 0.5pt solid #8c8378; height: 12pt; }

  .sh-note { margin-top: 7pt; font-size: 7pt; color: ${SHEET.faint}; line-height: 1.5; }

  /* Footer, with a hairline above rather than a filled bar. */
  .sh-foot {
    display: flex; justify-content: space-between;
    margin-top: 13pt; padding-top: 5pt;
    border-top: 0.5pt solid ${SHEET.border};
    font-size: 7pt; color: ${SHEET.faint};
  }
`;

/**
 * Prefixes every selector in `css` with `.print-preview`.
 *
 * Walks the string tracking brace depth rather than matching lines with a
 * regular expression. A line-based approach cannot tell a selector from a
 * declaration: `display: flex;` sits at the start of a line just as `.sh-brand {`
 * does, and prefixing it produces `.print-preview display: flex;`, which
 * silently breaks the rule. Depth tracking also handles single-line rules and
 * declarations that share a line with a brace.
 */
function scopeCss(css: string, root: string): string {
  // Comments are stripped first. Left in, a comment sitting above a rule becomes
  // part of the pending selector, so it gets prefixed and any comma inside it
  // splits into bogus selectors. The print copy keeps the comments; the scoped
  // copy is generated output that nobody reads.
  const source = css.replace(/\/\*[\s\S]*?\*\//g, "");

  let out = "";
  let buffer = "";
  let depth = 0;

  const flushSelector = () => {
    const sel = buffer.trim();
    buffer = "";
    if (!sel) return "";
    // Leave at-rules alone: they take a prelude, not a selector.
    if (sel.startsWith("@")) return `${sel} {`;
    const parts = sel
      .split(",")
      .map((p) => p.trim())
      .filter(Boolean)
      // The root itself is matched both as the `.print-preview` element and as a
      // descendant of it. PrintPreview puts the class on a wrapper and renders the
      // sheet inside it, while the download window puts it on <body>; requiring
      // both classes on one element matched neither.
      .flatMap((p) =>
        p === root
          ? [`.print-preview${root}`, `.print-preview ${root}`]
          : [`.print-preview ${p}`]
      );
    return `${parts.join(", ")} {`;
  };

  for (const ch of source) {
    if (ch === "{") {
      if (depth === 0) {
        out += flushSelector();
      } else {
        out += buffer + "{";
        buffer = "";
      }
      depth += 1;
      continue;
    }
    if (ch === "}") {
      out += buffer;
      buffer = "";
      depth = Math.max(0, depth - 1);
      out += "}";
      continue;
    }
    // Inside a block, characters pass through; outside, they accumulate into
    // the pending selector.
    if (depth > 0) {
      out += ch;
    } else {
      buffer += ch;
    }
  }
  return out + buffer;
}

/**
 * Wraps sheet CSS for both print and the on-screen preview.
 *
 * The same declarations are emitted twice: once inside `@media print`, and once
 * scoped under `.print-preview`. Generating both from one source is what stops
 * the preview drifting from the printed result, which would make it worse than
 * no preview at all.
 */
export function sheetCss(options: {
  /** Root class of the sheet, e.g. `.job-sheet`. */
  root: string;
  /** `A4` or `A4 landscape`. */
  page: string;
  /** Rules specific to this sheet, on top of SHEET_BASE_CSS. */
  own: string;
  /** Base font size in pt. */
  fontSize?: number;
}): string {
  const { root, page, own, fontSize = 9 } = options;

  const rootRules = `
    background: #fff;
    color: ${SHEET.ink};
    font-family: ${SHEET.font};
    font-size: ${fontSize}pt;
    line-height: 1.45;
  `;

  const body = SHEET_BASE_CSS + own;
  const scoped = scopeCss(body, root);

  return `
${root} { display: none; }

@media print {
  /* Hide the dashboard, but never an ancestor of the sheet.
     Hiding every top-level child printed a blank page: the sheet renders deep
     inside the admin shell, so the wrapper above it was hidden and the sheet
     collapsed with it. display:block on the sheet cannot resurrect it once an
     ancestor is gone. :has() hides only the branches that do not contain the
     sheet, so the chain down to it survives. Those ancestors are then flattened
     to plain blocks, because the shell's flex layout, padding and sticky
     sidebar would otherwise inset and clip the printed page. */
  body > *:not(:has(${root})):not(${root}) { display: none !important; }
  body { background: #fff !important; }

  /* Anything asking not to print is excluded deliberately.
     The on-screen preview overlay holds its own copy of the sheet, so it matched
     :has() and was forced back to display:block, overriding the print:hidden class
     it carries. That printed a dark full-screen panel over the document and a
     second copy of the sheet with it, which is what looked like a blank page. An
     element that has asked not to print must stay hidden even when it contains a
     sheet.

     Matched by attribute rather than as a class, because Tailwind's class name
     contains a colon and escaping it inside this template literal is not worth
     the confusion. */
  body :has(${root}):not([class*="print:hidden"]) {
    display: block !important;
    position: static !important;
    overflow: visible !important;
    margin: 0 !important;
    padding: 0 !important;
    width: auto !important;
    max-width: none !important;
    background: #fff !important;
    border: 0 !important;
  }

  /* Anything alongside the sheet inside those ancestors still goes, or the
     dashboard's own chrome prints above it. */
  body :has(${root}) > *:not(:has(${root})):not(${root}) { display: none !important; }

  /* A sheet inside a print:hidden subtree is a preview copy, never the one to
     print. Without this the overlay's own sheet still lays out and prints. */
  [class*="print:hidden"] ${root} { display: none !important; }

  ${root}, ${root} * { display: revert; }
  ${root} {
    display: block !important;
    position: static !important;
    ${rootRules}
  }
  @page { size: ${page}; margin: 13mm; }
${body}
}

/* On-screen preview: same measurements, scoped so nothing reaches the dashboard.

   Both selectors are needed, and the missing one is what made every preview-based
   download come out blank. PrintPreview puts the print-preview class on a wrapper
   div and renders the sheet inside it, so the both-classes-on-one-element form
   never matched, and the sheet stayed at the display:none declared at the top of
   this stylesheet. The download window puts the class on the body element, so the
   descendant form is the one that matters there.

   Forced, because the hide rule above sits at equal specificity and appears
   earlier; adding the descendant selector alone would still lose on position. */
.print-preview${root},
.print-preview ${root} {
  display: block !important;
  ${rootRules}
}
${scoped}
`;
}

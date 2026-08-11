"use client";

import { useEffect } from "react";
import { PAYMENT_METHOD_LABELS, type PaymentMethod } from "@/lib/erp/enums";
import { formatNaira } from "@/lib/erp/money";

/**
 * 80mm thermal receipt, for an Xprinter-class counter printer.
 *
 * A genuinely different document from the A4 sheet, not a scaled copy. Thermal paper is
 * 80mm wide with roughly 72mm printable, continuous-feed with no page height, and the
 * printer has no colour and a coarse dot pitch. So:
 *
 * - **No table borders, no fills, no tints.** A solid rectangle on thermal paper is a wide
 *   black band that drains the head and smears; separation is done with dashed rules and
 *   whitespace, which is what receipts have always used.
 * - **Monospace, and one column of money.** Proportional digits at this width make a
 *   column of amounts unreadable, and the whole document is scanned for one number.
 * - **`@page { size: 80mm auto }`.** The height is whatever the content needs; giving it a
 *   fixed page would either cut the total off or feed a foot of blank paper after every
 *   sale.
 * - **Long item names wrap rather than truncate.** "MDF 18mm white one side" has to be
 *   identifiable on a receipt a customer brings back, and an ellipsis loses exactly the
 *   part that distinguishes it from the next line.
 */

export interface ThermalLine {
  item: string;
  quantity: number;
  unitPriceKobo: number;
  amountKobo: number;
}

export interface ThermalReceiptData {
  /** "Sales Receipt" or "Invoice" — the same layout serves both. */
  heading: string;
  reference: string;
  lines: ThermalLine[];
  subtotalKobo: number;
  discountKobo?: number;
  taxKobo?: number;
  taxLabel?: string;
  /** Set when tax is inside the total, so the line can say so. */
  taxInclusive?: boolean;
  totalKobo: number;
  amountPaidKobo?: number;
  balanceKobo?: number;
  method?: PaymentMethod;
  tenderedKobo?: number;
  changeKobo?: number;
  customerName?: string;
  customerPhone?: string;
  servedBy?: string;
  atMs: number;
  footerNote?: string;
}

export interface ThermalCompany {
  name: string;
  address?: string;
  phone?: string;
  altPhone?: string;
  email?: string;
  rcNumber?: string;
}

export function ThermalReceipt({
  data,
  company,
  onDone,
  autoPrint = true,
}: {
  data: ThermalReceiptData;
  company: ThermalCompany;
  onDone: () => void;
  autoPrint?: boolean;
}) {
  useEffect(() => {
    if (!autoPrint) return;
    const t = setTimeout(() => {
      window.print();
      onDone();
    }, 250);
    return () => clearTimeout(t);
  }, [onDone, autoPrint]);

  const when = new Date(data.atMs).toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

  return (
    <>
      <style>{CSS}</style>
      <div className="tr80">
        <div className="tr80-head">
          <div className="tr80-co">{company.name.toUpperCase()}</div>
          {company.address && <div className="tr80-sm">{company.address}</div>}
          {(company.phone || company.altPhone) && (
            <div className="tr80-sm">
              {[company.phone, company.altPhone].filter(Boolean).join(" · ")}
            </div>
          )}
          {company.rcNumber && <div className="tr80-sm">RC {company.rcNumber}</div>}
        </div>

        <div className="tr80-rule" />

        <div className="tr80-kind">{data.heading.toUpperCase()}</div>
        <div className="tr80-meta">
          <span>{data.reference}</span>
          <span>{when}</span>
        </div>
        {data.customerName && (
          <div className="tr80-meta">
            <span>{data.customerName}</span>
            {data.customerPhone && <span>{data.customerPhone}</span>}
          </div>
        )}

        <div className="tr80-rule" />

        {/* Two rows per item: the name on its own line so it can wrap, then the
            arithmetic aligned right. Cramming both onto one 72mm line is what forces
            the truncation this avoids. */}
        {data.lines.map((l, i) => (
          <div className="tr80-item" key={`${l.item}-${i}`}>
            <div className="tr80-name">{l.item}</div>
            <div className="tr80-calc">
              <span>
                {l.quantity} × {formatNaira(l.unitPriceKobo)}
              </span>
              <span className="tr80-amt">{formatNaira(l.amountKobo)}</span>
            </div>
          </div>
        ))}

        <div className="tr80-rule" />

        <Row label="Subtotal" value={formatNaira(data.subtotalKobo)} />
        {(data.discountKobo ?? 0) > 0 && (
          <Row label="Less discount" value={formatNaira(data.discountKobo ?? 0)} />
        )}
        {(data.taxKobo ?? 0) > 0 && (
          <Row
            label={`${data.taxLabel ?? "Tax"}${data.taxInclusive ? " (incl)" : ""}`}
            value={formatNaira(data.taxKobo ?? 0)}
          />
        )}

        <div className="tr80-rule" />
        <div className="tr80-total">
          <span>TOTAL</span>
          <span>{formatNaira(data.totalKobo)}</span>
        </div>
        <div className="tr80-rule" />

        {data.method && (
          <Row label="Paid by" value={PAYMENT_METHOD_LABELS[data.method]} />
        )}
        {(data.tenderedKobo ?? 0) > 0 && (
          <>
            <Row label="Cash given" value={formatNaira(data.tenderedKobo ?? 0)} />
            <Row label="Change" value={formatNaira(data.changeKobo ?? 0)} />
          </>
        )}
        {/* An invoice-shaped receipt: what has been paid and what is still owed. A
            counter sale leaves these unset, since it is settled on the spot. */}
        {(data.amountPaidKobo ?? 0) > 0 && data.balanceKobo !== undefined && (
          <>
            <Row label="Paid" value={formatNaira(data.amountPaidKobo ?? 0)} />
            <Row
              label={data.balanceKobo > 0 ? "Balance due" : "Settled"}
              value={formatNaira(Math.abs(data.balanceKobo))}
            />
          </>
        )}

        {data.servedBy && (
          <div className="tr80-sm tr80-served">Served by {data.servedBy}</div>
        )}

        <div className="tr80-foot">
          {data.footerNote && <div>{data.footerNote}</div>}
          <div className="tr80-thanks">Thank you</div>
        </div>

        {/* Feed past the tear bar. Without it the total sits under the cutter and is
            torn through on every sale. */}
        <div className="tr80-feed" />
      </div>
    </>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="tr80-row">
      <span>{label}</span>
      <span className="tr80-amt">{value}</span>
    </div>
  );
}

/**
 * Print CSS.
 *
 * The visual rules are deliberately *not* built on `sheetStyles`: those are designed for
 * A4 — brown header band, tinted panels, hairline borders — and every one of those choices
 * is wrong on thermal paper.
 *
 * The **scoping** rules, however, are taken from `sheetCss` verbatim, because getting them
 * wrong prints a blank page. The sheet renders deep inside the admin shell, so hiding
 * every top-level sibling hides an ancestor and collapses the sheet with it; `:has()`
 * hides only the branches that do not contain the receipt, then flattens the surviving
 * ancestors so the shell's flex layout and sticky sidebar cannot inset the paper. The
 * `print:hidden` exclusion matters too: the preview overlay holds its own copy of this
 * component, and without it that overlay is forced visible and printed over the receipt.
 */
const ROOT = ".tr80";

/**
 * The receipt's own layout rules.
 *
 * Emitted *after* the `display: revert` reset inside `@media print`, exactly as `sheetCss`
 * orders them — the reset undoes the shell's inherited display values, and these rules
 * then reassert the flex rows. Reversing the order would flatten every money row into
 * stacked blocks on paper while looking correct on screen.
 */
const LAYOUT = `
  .tr80-head { text-align: center; }
  .tr80-co { font-size: 11pt; font-weight: bold; letter-spacing: 0.02em; }
  .tr80-sm { font-size: 7.5pt; }
  .tr80-kind {
    text-align: center; font-weight: bold; font-size: 9.5pt;
    letter-spacing: 0.12em; margin: 1mm 0;
  }
  /* Dashed, not solid: a solid rule at this width prints as a heavy band. */
  .tr80-rule { border-top: 1px dashed #000; margin: 1.5mm 0; }
  .tr80-meta {
    display: flex; justify-content: space-between; gap: 3mm; font-size: 7.5pt;
  }
  .tr80-item { margin-bottom: 1mm; }
  .tr80-name { word-break: break-word; }
  .tr80-calc, .tr80-row {
    display: flex; justify-content: space-between; gap: 3mm; font-size: 8.5pt;
  }
  .tr80-calc { padding-left: 3mm; }
  /* Tabular figures so the money column aligns on the digits. */
  .tr80-amt { font-variant-numeric: tabular-nums; white-space: nowrap; }
  .tr80-total {
    display: flex; justify-content: space-between; gap: 3mm;
    font-size: 11pt; font-weight: bold; font-variant-numeric: tabular-nums;
  }
  .tr80-served { margin-top: 1.5mm; text-align: center; }
  .tr80-foot { margin-top: 2mm; text-align: center; font-size: 7.5pt; }
  .tr80-thanks { margin-top: 1mm; font-weight: bold; }
  /* Blank tail so the total clears the tear bar. */
  .tr80-feed { height: 12mm; }
`;

/** The paper itself: 72mm of printable width inside 80mm stock. */
const ROOT_RULES = `
  width: 72mm;
  margin: 0 auto;
  background: #fff;
  color: #000;
  font-family: "DejaVu Sans Mono", "Consolas", "Courier New", monospace;
  font-size: 9pt;
  line-height: 1.35;
  padding: 2mm 0 0;
`;

/**
 * Prefixes every selector in a block, so one set of layout rules serves both the printed
 * page and the on-screen preview.
 *
 * The preview copy has to be scoped under `.print-preview`, or these rules would style the
 * live dashboard behind the modal. Written once and prefixed mechanically rather than
 * maintained as two copies, which is how a preview drifts from the paper and becomes worse
 * than no preview at all.
 */
function scopeSelectors(css: string, prefix: string): string {
  return css.replace(/(^|\n)\s*(\.[\w-]+(?:\s*,\s*\.[\w-]+)*)\s*\{/g, (_m, lead, sel) => {
    const scoped = String(sel)
      .split(",")
      .map((s) => `${prefix} ${s.trim()}`)
      .join(", ");
    return `${lead}${scoped} {`;
  });
}

const CSS = `
  /* Hidden by default, revealed only for the real print job or inside the preview
     wrapper — the same contract the A4 sheets use. Without it the receipt renders into
     the live page behind the modal. */
  ${ROOT} { display: none; }

  /* On-screen preview. Both selector forms are needed: PrintPreview puts the class on a
     wrapper and renders the sheet inside it, while the download window puts it on body. */
  .print-preview${ROOT},
  .print-preview ${ROOT} {
    display: block !important;
    ${ROOT_RULES}
  }

${scopeSelectors(LAYOUT, ".print-preview")}

  @media print {
    /* Continuous feed: the height is whatever the receipt needs. A fixed page either
       clips the total or spits out a foot of blank paper per sale. */
    @page { size: 80mm auto; margin: 0; }
    html, body { width: 80mm; margin: 0; padding: 0; background: #fff !important; }

    /* Hide every branch that does not contain the receipt — but never an ancestor of
       it, and never something that asked not to print. See the note above. */
    body > *:not(:has(${ROOT})):not(${ROOT}) { display: none !important; }
    body :has(${ROOT}):not([class*="print:hidden"]) {
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

    /* Chrome sitting alongside the receipt inside those surviving ancestors still goes,
       or the shell's own furniture prints above it. */
    body :has(${ROOT}) > *:not(:has(${ROOT})):not(${ROOT}) { display: none !important; }

    /* A receipt inside a print:hidden subtree is the preview's copy, never the one to
       print. Without this the overlay's copy lays out and prints too. */
    [class*="print:hidden"] ${ROOT} { display: none !important; }

    /* Undo the shell's inherited display values inside the receipt, then reassert the
       layout below. The order matters: LAYOUT must come *after* this reset or the flex
       money rows would be flattened into stacked blocks on paper while still looking
       right on screen. */
    ${ROOT}, ${ROOT} * { display: revert; }
    ${ROOT} {
      display: block !important;
      position: static !important;
      ${ROOT_RULES}
      padding: 2mm 4mm 0;
    }

${LAYOUT}
  }
`;

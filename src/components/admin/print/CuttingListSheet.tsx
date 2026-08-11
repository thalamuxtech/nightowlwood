"use client";

import { useEffect } from "react";
import { BOARD_TYPE_LABELS } from "@/lib/erp/enums";
import {
  BOARD_LENGTH_MM,
  BOARD_WIDTH_MM,
  EDGE_CODES,
  EDGE_CODE_META,
  verifyCuttingListTotals,
  type CuttingListRow,
} from "@/lib/erp/cuttingList";
import { SHEET, sheetCss } from "./sheetStyles";

/**
 * Printable cutting list, A4.
 *
 * This one goes to the saw, so it is laid out for someone standing at a machine rather than
 * reading at a desk: large figures, one row per part, and the edge-code legend on the same page
 * because that is where it is needed. A cutter should never have to turn the sheet over or
 * remember what `U` means.
 *
 * The blade offset is printed prominently. A list cut without allowing for the kerf comes out
 * short on the last panel of every board, and the number is useless in a system nobody at the
 * saw can see.
 */

const LOGO = "/brand/owl-mark-email.png";

export function CuttingListSheet({
  list,
  onDone,
  autoPrint = true,
}: {
  list: CuttingListRow;
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

  const when = list.submittedAtMs
    ? new Date(list.submittedAtMs).toLocaleDateString("en-GB", {
        day: "numeric",
        month: "long",
        year: "numeric",
      })
    : "—";

  /*
   * The figures the sheet prints.
   *
   * Recomputed from the parts for a customer-submitted list rather than taken as stored: the
   * stored totals came in over a public form and cannot be verified by the security rules, and
   * this is the sheet somebody cuts from. Ordering two boards for a job that needs two hundred
   * is the failure being prevented.
   *
   * A staff list uses its stored totals, which this same function produced on the way in.
   */
  const check = list.submittedByCustomer ? verifyCuttingListTotals(list) : null;
  const totals = check ? check.recomputed : list.totals;

  return (
    <>
      <style>{CSS}</style>
      <div className="cl-sheet">
        <header className="sh-band">
          <div className="sh-brand">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={LOGO} alt="" width={52} height={35} />
            <div>
              <div className="sh-co">Nightowl Woodworks Ltd</div>
              <div className="sh-tag">Precision in Every Cut</div>
            </div>
          </div>
          <div className="sh-doc">
            <div className="sh-kind">Cutting List</div>
            <div className="sh-ref">{list.listNumber}</div>
          </div>
        </header>

        <section className="sh-block cl-meta">
          <div>
            <span className="cl-label">Customer</span>
            <span className="cl-strong">{list.customerName}</span>
            {list.customerPhone && <span> · {list.customerPhone}</span>}
          </div>
          <div>
            <span className="cl-label">Job</span>
            <span>{list.jobNumber ?? "Not linked"}</span>
          </div>
          <div>
            <span className="cl-label">Received</span>
            <span>{when}</span>
          </div>
          {list.title && (
            <div>
              <span className="cl-label">For</span>
              <span>{list.title}</span>
            </div>
          )}
        </section>

        {/* The blade offset, given its own box. A list cut without it is short on the last
            panel of every board. */}
        <section className="cl-callouts">
          <div className="cl-callout">
            <span className="cl-calloutlabel">Blade offset</span>
            <span className="cl-calloutvalue">{list.offsetMm}mm</span>
            <span className="cl-calloutnote">allow on every cut</span>
          </div>
          <div className="cl-callout">
            <span className="cl-calloutlabel">Panels</span>
            <span className="cl-calloutvalue">{totals.panelCount}</span>
            <span className="cl-calloutnote">{list.parts.length} part types</span>
          </div>
          <div className="cl-callout">
            <span className="cl-calloutlabel">Boards</span>
            <span className="cl-calloutvalue">{totals.totalBoardsRequired}</span>
            <span className="cl-calloutnote">incl. {list.wastePercent}% waste</span>
          </div>
          <div className="cl-callout">
            <span className="cl-calloutlabel">Banding</span>
            <span className="cl-calloutvalue">{totals.totalTapeMetres}m</span>
            <span className="cl-calloutnote">
              {Object.entries(totals.tapeMetresByWidth)
                .map(([w, m]) => `${m}m @ ${w}mm`)
                .join(" · ") || "none"}
            </span>
          </div>
        </section>

        <section className="sh-block">
          <h2 className="sh-h2">Parts</h2>
          <table className="sh-table cl-parts">
            <thead>
              <tr>
                <th style={{ width: "5%" }}>#</th>
                <th>Part</th>
                <th style={{ width: "10%" }} className="sh-num">
                  W
                </th>
                <th style={{ width: "10%" }} className="sh-num">
                  L
                </th>
                <th style={{ width: "7%" }} className="sh-num">
                  Qty
                </th>
                <th style={{ width: "18%" }}>Board</th>
                <th style={{ width: "8%" }}>Edge</th>
                <th style={{ width: "8%" }} className="sh-num">
                  Tape
                </th>
                <th style={{ width: "6%" }}>✓</th>
              </tr>
            </thead>
            <tbody>
              {list.parts.map((p, i) => (
                <tr key={p.id}>
                  <td>{i + 1}</td>
                  <td>
                    {p.part}
                    {p.notes && <div className="cl-note">{p.notes}</div>}
                  </td>
                  <td className="sh-num cl-dim">{p.widthMm}</td>
                  <td className="sh-num cl-dim">{p.lengthMm}</td>
                  <td className="sh-num cl-dim">{p.quantity}</td>
                  <td>
                    {p.boardType ? BOARD_TYPE_LABELS[p.boardType] : "—"}
                    {p.boardColour && <div className="cl-note">{p.boardColour}</div>}
                  </td>
                  <td className="cl-edge">
                    {EDGE_CODE_META[p.edgeCode]?.label ?? "—"}
                  </td>
                  <td className="sh-num">
                    {p.edgeCode === "none" ? "—" : `${p.edgeTapeMm}`}
                  </td>
                  {/* A tick box per row: the cutter marks off what is done, which is how a
                      part-finished list gets picked back up correctly after a break. */}
                  <td className="cl-tick" />
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <section className="sh-block cl-bottom">
          <div>
            <h2 className="sh-h2">Boards required</h2>
            <table className="cl-mini">
              <tbody>
                {totals.boardsByType.map((b) => (
                  <tr key={b.boardType}>
                    <td>{b.label}</td>
                    <td className="sh-num">{b.areaM2} m²</td>
                    <td className="sh-num cl-strong">{b.boardsRequired}</td>
                  </tr>
                ))}
                <tr className="cl-total">
                  <td>Total</td>
                  <td className="sh-num">{totals.totalAreaM2} m²</td>
                  <td className="sh-num">{totals.totalBoardsRequired}</td>
                </tr>
              </tbody>
            </table>
            <p className="cl-fine">
              From panel area on a {BOARD_WIDTH_MM}×{BOARD_LENGTH_MM}mm sheet plus{" "}
              {list.wastePercent}% waste. An estimate for ordering, not a nesting plan.
            </p>
          </div>

          <div>
            <h2 className="sh-h2">Edge codes</h2>
            <table className="cl-mini">
              <tbody>
                {EDGE_CODES.filter((c) => c !== "none").map((c) => (
                  <tr key={c}>
                    <td className="cl-edge">{EDGE_CODE_META[c].label}</td>
                    <td>{EDGE_CODE_META[c].detail}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {list.notes && (
          <section className="sh-block">
            <h2 className="sh-h2">Customer notes</h2>
            <p className="cl-customernotes">{list.notes}</p>
          </section>
        )}

        <footer className="cl-sign">
          <div>
            <div className="cl-sigline" />
            <div className="cl-fine">Cut by — name &amp; date</div>
          </div>
          <div>
            <div className="cl-sigline" />
            <div className="cl-fine">Checked by — name &amp; date</div>
          </div>
        </footer>

        {/* Said on the paper when the printed figures differ from what was submitted, so the
            cutter knows the sheet was corrected rather than wondering which to trust. */}
        {check && !check.agrees && (
          <p className="cl-corrected">
            Boards and banding above were recalculated from the parts — the figures submitted
            with this list did not match ({check.differences.join("; ")}). Confirm with the
            customer before cutting.
          </p>
        )}

        <p className="cl-fine cl-allmm">
          All dimensions in millimetres. W = width (across), L = length (down).
        </p>
      </div>
    </>
  );
}

const CSS = sheetCss({
  root: ".cl-sheet",
  page: "A4",
  fontSize: 9,
  own: `
    .cl-meta { display: flex; flex-direction: column; gap: 3pt; }
    .cl-meta > div { display: flex; gap: 8pt; }
    .cl-label {
      color: ${SHEET.muted}; min-width: 54pt; text-transform: uppercase;
      font-size: 7pt; letter-spacing: 0.06em; padding-top: 1pt;
    }
    .cl-strong { font-weight: bold; color: ${SHEET.ink}; }

    /* The four figures a cutter needs before touching the saw. */
    .cl-callouts {
      display: flex; gap: 8pt; margin-top: 12pt;
    }
    .cl-callout {
      flex: 1; display: flex; flex-direction: column;
      padding: 6pt 8pt; background: ${SHEET.panel};
      border-left: 2pt solid ${SHEET.brass};
    }
    .cl-calloutlabel {
      font-size: 6.5pt; text-transform: uppercase; letter-spacing: 0.08em;
      color: ${SHEET.muted};
    }
    .cl-calloutvalue {
      font-size: 15pt; font-weight: bold; color: ${SHEET.brown}; line-height: 1.15;
    }
    .cl-calloutnote { font-size: 6.5pt; color: ${SHEET.muted}; }

    /* Dimensions large and tabular: these are read at arm's length off a machine. */
    .cl-parts td { vertical-align: top; }
    .cl-dim {
      font-size: 11pt; font-weight: bold; font-variant-numeric: tabular-nums;
    }
    .cl-edge {
      font-family: monospace; font-size: 11pt; font-weight: bold;
      color: ${SHEET.brown}; text-align: center;
    }
    .cl-note { font-size: 6.5pt; color: ${SHEET.muted}; }
    /* An empty box, drawn so it is obviously a box to tick. */
    .cl-tick {
      border: 0.75pt solid ${SHEET.faint} !important;
      height: 14pt;
    }

    .cl-bottom {
      display: grid; grid-template-columns: 1fr 1fr; gap: 16pt;
      page-break-inside: avoid;
    }
    .cl-mini { width: 100%; border-collapse: collapse; margin-top: 4pt; }
    .cl-mini td {
      padding: 2.5pt 4pt; border-bottom: 0.5pt solid ${SHEET.borderSoft};
      font-size: 8pt;
    }
    .cl-total td {
      font-weight: bold; border-top: 0.75pt solid ${SHEET.brown};
      border-bottom: none;
    }
    .cl-fine { font-size: 6.5pt; color: ${SHEET.muted}; margin-top: 4pt; line-height: 1.4; }
    .cl-customernotes {
      padding: 6pt 8pt; background: ${SHEET.panel};
      border-left: 2pt solid ${SHEET.brownLight};
      font-size: 8.5pt; line-height: 1.5;
    }

    .cl-sign {
      display: flex; gap: 24pt; margin-top: 22pt; page-break-inside: avoid;
    }
    .cl-sign > div { flex: 1; }
    .cl-sigline { border-top: 0.75pt solid ${SHEET.ink}; margin-bottom: 3pt; }
    .cl-allmm { text-align: center; margin-top: 10pt; }

    /* Loud on paper: the cutter is about to work from figures that were corrected. */
    .cl-corrected {
      margin-top: 12pt; padding: 6pt 8pt; font-size: 8pt; line-height: 1.45;
      border: 1pt solid ${SHEET.brown}; background: ${SHEET.panel};
      font-weight: bold; color: ${SHEET.brown};
    }
  `,
});

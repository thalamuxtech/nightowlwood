"use client";

import { useEffect } from "react";
import { WAGE_WORK_TYPE_LABELS, type WageWorkType } from "@/lib/erp/enums";
import { SHEET, sheetCss } from "@/components/admin/print/sheetStyles";

/**
 * Printable work log, A4 landscape.
 *
 * Landscape because the useful version of this sheet is wide: date, operator,
 * work type, units and the named assistants all need to sit on one row, and
 * portrait forces the assistant column so narrow that names wrap and become
 * unreadable.
 *
 * The assistant names are the point of the document. A supervisor checking a
 * week's work needs to see who was credited, since that is what decides who gets
 * paid, and a count alone cannot be checked against anyone's memory of the week.
 */

export interface WorkLogPrintRow {
  id: string;
  staffName: string;
  /** Every kind of work on the entry, each with its own count. */
  items: Array<{ workType: WageWorkType; units: number }>;
  workDateMs: number | null;
  assistantNames: string[];
  assistantCount: number;
  jobNumber?: string;
}

const LOGO = "/brand/owl-mark-email.png";

/** Blank rows so the week can be continued by hand on the printed sheet. */
const MIN_ROWS = 12;

export function WorkLogSheet({
  rows,
  periodLabel,
  onDone,
  autoPrint = true,
}: {
  rows: WorkLogPrintRow[];
  periodLabel: string;
  onDone: () => void;
  /** False when embedded in the preview, which prints on demand. */
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

  const blanks = Math.max(0, MIN_ROWS - rows.length);

  const totalUnits = rows.reduce(
    (s, r) => s + r.items.reduce((n, i) => n + i.units, 0),
    0
  );
  const unnamed = rows.filter(
    (r) => r.assistantNames.length === 0 && r.assistantCount > 0
  ).length;

  // Units by work type, so the sheet reconciles against the wage run. Summed across
  // every item on every entry, since one entry can carry several types.
  const byType = new Map<WageWorkType, number>();
  for (const r of rows) {
    for (const i of r.items) {
      byType.set(i.workType, (byType.get(i.workType) ?? 0) + i.units);
    }
  }

  return (
    <>
      <style>{PRINT_CSS}</style>
      <div className="wl-sheet">
        <header className="sh-band">
          <div className="sh-brand">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={LOGO} alt="" width={46} height={31} />
            <div>
              <div className="sh-co">Nightowl Woodworks Ltd</div>
              <div className="sh-tag">Precision in Every Cut</div>
            </div>
          </div>
          <div className="sh-doc">
            <div className="sh-kind">Work Log</div>
            <div className="sh-ref">{periodLabel}</div>
            <div className="sh-sub">
              {rows.length} entr{rows.length === 1 ? "y" : "ies"}
            </div>
          </div>
        </header>

        <table className="sh-table">
          <thead>
            <tr>
              <th style={{ width: "5%" }}>#</th>
              <th style={{ width: "10%" }}>Date</th>
              <th style={{ width: "20%" }}>Operator</th>
              <th style={{ width: "16%" }}>Work</th>
              <th style={{ width: "8%" }} className="sh-num">
                Units
              </th>
              <th style={{ width: "11%" }}>Job</th>
              <th>Assistants credited</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.id}>
                <td>{i + 1}</td>
                <td>
                  {r.workDateMs
                    ? new Date(r.workDateMs).toLocaleDateString("en-GB", {
                        day: "2-digit",
                        month: "short",
                      })
                    : ""}
                </td>
                <td>{r.staffName}</td>
                {/* Stacked within the cell rather than split across rows, so the
                    date, operator and assistants stay stated once per entry — a
                    repeated operator name reads as two separate shifts. */}
                <td>
                  {r.items.map((i, n) => (
                    <div key={`${i.workType}-${n}`}>
                      {WAGE_WORK_TYPE_LABELS[i.workType]}
                    </div>
                  ))}
                </td>
                <td className="sh-num">
                  {r.items.map((i, n) => (
                    <div key={`${i.workType}-${n}`}>{i.units}</div>
                  ))}
                </td>
                <td>{r.jobNumber ?? ""}</td>
                <td>
                  {r.assistantNames.length > 0 ? (
                    r.assistantNames.join(", ")
                  ) : r.assistantCount > 0 ? (
                    <span className="wl-flag">{r.assistantCount} unnamed</span>
                  ) : (
                    ""
                  )}
                </td>
              </tr>
            ))}
            {Array.from({ length: blanks }, (_, i) => (
              <tr key={`b-${i}`} className="sh-blank">
                <td>{rows.length + i + 1}</td>
                <td />
                <td />
                <td />
                <td />
                <td />
                <td />
              </tr>
            ))}
          </tbody>
        </table>

        <section className="sh-block sh-cols">
          <div>
            <h2 className="sh-h2">Units by work type</h2>
            <table className="wl-summary">
              <tbody>
                {[...byType.entries()].map(([type, units]) => (
                  <tr key={type}>
                    <td>{WAGE_WORK_TYPE_LABELS[type]}</td>
                    <td className="sh-num">{units}</td>
                  </tr>
                ))}
                <tr className="wl-total">
                  <td>Total units</td>
                  <td className="sh-num">{totalUnits}</td>
                </tr>
              </tbody>
            </table>
            {unnamed > 0 && (
              <p className="wl-warn">
                {unnamed} entr{unnamed === 1 ? "y has" : "ies have"} an assistant count
                with no names. That pay cannot be attributed until the names are added.
              </p>
            )}
          </div>
          <div>
            <h2 className="sh-h2">Verification</h2>
            <div className="sh-sign">
              <span>Compiled by</span>
              <span className="sh-rule" />
            </div>
            <div className="sh-sign">
              <span>Checked by</span>
              <span className="sh-rule" />
            </div>
            <div className="sh-sign">
              <span>Date</span>
              <span className="sh-rule" />
            </div>
            <p className="sh-note">
              Signing confirms the operators, units and named assistants above are
              correct for this period. Wages are calculated from these figures.
            </p>
          </div>
        </section>

        <footer className="sh-foot">
          <span>Nightowl Woodworks Ltd &nbsp;&middot;&nbsp; info@nightowl.com.ng</span>
          <span>Work Log &nbsp;&middot;&nbsp; {periodLabel}</span>
        </footer>
      </div>
    </>
  );
}

const PRINT_CSS = sheetCss({
  root: ".wl-sheet",
  page: "A4 landscape",
  fontSize: 8.5,
  own: `
  /* Landscape: date, operator, work, units and the named assistants all need to
     sit on one row. Portrait squeezes the assistant column until names wrap and
     stop being checkable, and those names decide who gets paid. */
  .wl-summary { width: 100%; border-collapse: collapse; max-width: 250pt; }
  .wl-summary td {
    padding: 3.5pt 6pt; font-size: 8.5pt; border-bottom: 0.5pt dotted ${SHEET.border};
  }
  .wl-summary td:last-child {
    text-align: right; font-variant-numeric: tabular-nums; font-weight: 600;
  }
  .wl-summary .wl-total td {
    background: ${SHEET.brassPale}; color: ${SHEET.brown}; font-weight: bold;
    border-top: 1pt solid ${SHEET.brass}; border-bottom: none;
  }

  /* Unattributed assistant pay is real money belonging to nobody, so it is
     called out in the row and again under the summary. */
  .wl-flag { color: ${SHEET.brownLight}; font-style: italic; }
  .wl-warn {
    margin-top: 7pt; font-size: 7.5pt; color: ${SHEET.brownLight}; max-width: 270pt;
    line-height: 1.5;
  }
`,
});

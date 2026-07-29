"use client";

import { useEffect } from "react";
import { WAGE_WORK_TYPE_LABELS, type WageWorkType } from "@/lib/erp/enums";

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
  workType: WageWorkType;
  units: number;
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
}: {
  rows: WorkLogPrintRow[];
  periodLabel: string;
  onDone: () => void;
}) {
  useEffect(() => {
    const t = setTimeout(() => {
      window.print();
      onDone();
    }, 250);
    return () => clearTimeout(t);
  }, [onDone]);

  const blanks = Math.max(0, MIN_ROWS - rows.length);

  const totalUnits = rows.reduce((s, r) => s + r.units, 0);
  const unnamed = rows.filter(
    (r) => r.assistantNames.length === 0 && r.assistantCount > 0
  ).length;

  // Units by work type, so the sheet reconciles against the wage run.
  const byType = new Map<WageWorkType, number>();
  for (const r of rows) byType.set(r.workType, (byType.get(r.workType) ?? 0) + r.units);

  return (
    <>
      <style>{PRINT_CSS}</style>
      <div className="wl-sheet">
        <header className="wl-head">
          <div className="wl-brand">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={LOGO} alt="" width={46} height={31} />
            <div>
              <div className="wl-co">Nightowl Woodworks Ltd</div>
              <div className="wl-tag">Precision in Every Cut</div>
            </div>
          </div>
          <div className="wl-doc">
            <div className="wl-title">Work Log</div>
            <div className="wl-period">{periodLabel}</div>
            <div className="wl-count">
              {rows.length} entr{rows.length === 1 ? "y" : "ies"}
            </div>
          </div>
        </header>

        <table className="wl-table">
          <thead>
            <tr>
              <th style={{ width: "5%" }}>#</th>
              <th style={{ width: "10%" }}>Date</th>
              <th style={{ width: "20%" }}>Operator</th>
              <th style={{ width: "16%" }}>Work</th>
              <th style={{ width: "8%" }} className="wl-num">
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
                <td>{WAGE_WORK_TYPE_LABELS[r.workType]}</td>
                <td className="wl-num">{r.units}</td>
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
              <tr key={`b-${i}`} className="wl-blank">
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

        <section className="wl-foot-grid">
          <div>
            <h2 className="wl-h2">Units by work type</h2>
            <table className="wl-summary">
              <tbody>
                {[...byType.entries()].map(([type, units]) => (
                  <tr key={type}>
                    <td>{WAGE_WORK_TYPE_LABELS[type]}</td>
                    <td className="wl-num">{units}</td>
                  </tr>
                ))}
                <tr className="wl-total">
                  <td>Total units</td>
                  <td className="wl-num">{totalUnits}</td>
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
            <h2 className="wl-h2">Verification</h2>
            <div className="wl-sign">
              <span>Compiled by</span>
              <span className="wl-rule" />
            </div>
            <div className="wl-sign">
              <span>Checked by</span>
              <span className="wl-rule" />
            </div>
            <div className="wl-sign">
              <span>Date</span>
              <span className="wl-rule" />
            </div>
            <p className="wl-note">
              Signing confirms the operators, units and named assistants above are
              correct for this period. Wages are calculated from these figures.
            </p>
          </div>
        </section>

        <footer className="wl-foot">
          <span>Nightowl Woodworks Ltd &nbsp;&middot;&nbsp; info@nightowl.com.ng</span>
          <span>Work Log &nbsp;&middot;&nbsp; {periodLabel}</span>
        </footer>
      </div>
    </>
  );
}

const PRINT_CSS = `
.wl-sheet { display: none; }

@media print {
  body > * { display: none !important; }
  body { background: #fff !important; }
  .wl-sheet, .wl-sheet * { display: revert; }
  .wl-sheet {
    display: block !important;
    position: absolute;
    inset: 0;
    background: #fff;
    color: #1c1917;
    /* Stack chosen for U+20A6 and consistency with the other print sheets. */
    font-family: "DejaVu Sans", "Segoe UI", Tahoma, Helvetica, Arial, sans-serif;
    font-size: 9pt;
    line-height: 1.4;
  }

  /* Landscape: the assistant column needs the width or names wrap illegibly. */
  @page { size: A4 landscape; margin: 12mm; }

  .wl-head {
    display: flex; align-items: flex-start; justify-content: space-between;
    border-bottom: 2.5pt solid #6b4a2b; padding-bottom: 6pt;
  }
  .wl-brand { display: flex; align-items: center; gap: 9pt; }
  .wl-co {
    font-size: 12.5pt; font-weight: bold; color: #6b4a2b;
    text-transform: uppercase; letter-spacing: 0.6pt;
  }
  .wl-tag {
    font-size: 6.5pt; letter-spacing: 1.6pt; color: #6b6560;
    text-transform: uppercase; margin-top: 1pt;
  }
  .wl-doc { text-align: right; }
  .wl-title {
    font-size: 7.5pt; letter-spacing: 2pt; text-transform: uppercase; color: #6b6560;
  }
  .wl-period { font-size: 13pt; font-weight: bold; color: #1c1917; }
  .wl-count { font-size: 8pt; color: #6b6560; }

  .wl-table { width: 100%; border-collapse: collapse; margin-top: 9pt; }
  .wl-table th {
    background: #f0e6d6; color: #6b4a2b; font-size: 7.5pt;
    text-transform: uppercase; letter-spacing: 0.7pt; text-align: left;
    padding: 4pt 5pt; border: 0.5pt solid #dcd0bd;
  }
  .wl-table td {
    padding: 4pt 5pt; border: 0.5pt solid #e6ddd0; font-size: 8.5pt;
  }
  /* Repeat the header if the table runs onto a second sheet. */
  .wl-table thead { display: table-header-group; }
  .wl-num { text-align: right; }
  .wl-blank td { height: 14pt; }
  .wl-flag { color: #8a5a2b; font-style: italic; }

  .wl-foot-grid {
    display: flex; gap: 20pt; margin-top: 12pt; break-inside: avoid;
  }
  .wl-foot-grid > div { flex: 1; }

  .wl-h2 {
    font-size: 7.5pt; font-weight: bold; letter-spacing: 1.4pt;
    text-transform: uppercase; color: #6b4a2b;
    border-bottom: 0.5pt solid #e6ddd0; padding-bottom: 2.5pt; margin-bottom: 5pt;
  }

  .wl-summary { width: 100%; border-collapse: collapse; max-width: 240pt; }
  .wl-summary td {
    padding: 3pt 6pt; font-size: 8.5pt; border-bottom: 0.5pt dotted #cfc4b4;
  }
  .wl-summary .wl-total td {
    background: #f0e6d6; color: #6b4a2b; font-weight: bold;
    border-top: 1pt solid #dba95f; border-bottom: none;
  }

  .wl-warn {
    margin-top: 6pt; font-size: 7.5pt; color: #8a5a2b; max-width: 260pt;
  }

  .wl-sign { display: flex; align-items: flex-end; gap: 5pt; margin-top: 10pt; }
  .wl-sign > span:first-child {
    color: #6b6560; min-width: 56pt; font-size: 8.5pt;
  }
  .wl-rule { flex: 1; border-bottom: 0.5pt solid #8a8079; height: 11pt; }
  .wl-note {
    margin-top: 8pt; font-size: 7pt; color: #9a938c; line-height: 1.5;
  }

  .wl-foot {
    display: flex; justify-content: space-between;
    margin-top: 12pt; padding-top: 5pt; border-top: 0.5pt solid #e6ddd0;
    font-size: 7pt; color: #9a938c;
  }
}
`;

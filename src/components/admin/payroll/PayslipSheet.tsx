"use client";

import { useEffect } from "react";
import { formatNaira } from "@/lib/erp/money";
import { SHEET, sheetCss } from "@/components/admin/print/sheetStyles";

/**
 * Printable payslips, one per staff member.
 *
 * Two fit on an A4 sheet with a cut line between them, because printing one
 * slip per page would waste half the paper on a workforce paid weekly.
 *
 * Each slip states the gross split between operator and assistant work, any
 * loan deduction, and the net. Showing the split matters: an assistant who
 * worked fewer days is paid less than one who worked more, and the slip is
 * where that becomes visible to the person being paid.
 */

export interface PayslipStaff {
  staffId: string;
  staffName: string;
  operatorKobo: number;
  assistantKobo: number;
  totalKobo: number;
  deductionKobo: number;
  netKobo: number;
}

const LOGO = "/brand/owl-mark-email.png";

export function PayslipSheet({
  periodStartMs,
  periodEndMs,
  perStaff,
  onDone,
  autoPrint = true,
}: {
  periodStartMs: number | null;
  periodEndMs: number | null;
  perStaff: PayslipStaff[];
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

  const period = `${fmt(periodStartMs)} to ${fmt(periodEndMs)}`;

  return (
    <>
      <style>{PRINT_CSS}</style>
      <div className="payslips">
        {perStaff.map((s, i) => (
          <article key={s.staffId} className={`ps ${i % 2 === 1 ? "ps-second" : ""}`}>
            <header className="sh-band">
              <div className="sh-brand">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={LOGO} alt="" width={40} height={27} />
                <div>
                  <div className="sh-co">Nightowl Woodworks Ltd</div>
                  <div className="sh-tag">Precision in Every Cut</div>
                </div>
              </div>
              <div className="sh-doc">
                <div className="sh-kind">Payslip</div>
                <div className="sh-ref">{period}</div>
              </div>
            </header>

            <div className="ps-who">
              <div>
                <div className="ps-label">Paid to</div>
                <div className="ps-name">{s.staffName}</div>
              </div>
              <div className="ps-period">
                <div className="ps-label">Week ending</div>
                <div className="ps-period-value">{fmt(periodEndMs)}</div>
              </div>
            </div>

            {/* Earnings and the net sit side by side rather than stacked. The net is
                the figure the worker checks first, so it gets its own panel instead
                of being the last row of a list they have to read down. */}
            <div className="ps-body">
              <table className="ps-table">
                <tbody>
                  <tr>
                    <td>Operator work</td>
                    <td className="sh-num">{formatNaira(s.operatorKobo)}</td>
                  </tr>
                  <tr>
                    <td>Assistant work</td>
                    <td className="sh-num">{formatNaira(s.assistantKobo)}</td>
                  </tr>
                  <tr className="ps-sub">
                    <td>Gross earnings</td>
                    <td className="sh-num">{formatNaira(s.totalKobo)}</td>
                  </tr>
                  {s.deductionKobo > 0 ? (
                    <tr className="ps-deduct">
                      <td>Loan / advance repayment</td>
                      <td className="sh-num">&minus;{formatNaira(s.deductionKobo)}</td>
                    </tr>
                  ) : (
                    <tr className="ps-deduct">
                      <td>Deductions</td>
                      <td className="sh-num">None</td>
                    </tr>
                  )}
                </tbody>
              </table>

              <div className="ps-net-panel">
                <div className="ps-net-label">Net pay</div>
                <div className="ps-net-value">{formatNaira(s.netKobo)}</div>
                <div className="ps-net-foot">
                  {s.deductionKobo > 0
                    ? `${formatNaira(s.totalKobo)} less ${formatNaira(s.deductionKobo)}`
                    : "Paid in full, nothing deducted"}
                </div>
              </div>
            </div>

            <div className="sh-cols ps-signs">
              <div className="sh-sign">
                <span>Received by</span>
                <span className="sh-rule" />
              </div>
              <div className="sh-sign">
                <span>Date</span>
                <span className="sh-rule" />
              </div>
            </div>

            <p className="ps-note">
              Piece rates are paid on the work logged in your name for this week.
              Query anything that looks wrong before the next run.
            </p>

            {/* Cut line between the two slips on a sheet */}
            {i % 2 === 0 && i !== perStaff.length - 1 && <div className="ps-cut" />}
          </article>
        ))}
      </div>
    </>
  );
}

function fmt(ms: number | null): string {
  if (!ms) return "?";
  return new Date(ms).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

const PRINT_CSS = sheetCss({
  root: ".payslips",
  page: "A4",
  fontSize: 9.5,
  own: `
  /* Two slips per sheet: a weekly workforce would otherwise waste half a page
     each. The second breaks to a new page so pairs stay together. */
  .ps { break-inside: avoid; padding: 4mm 0 3mm; }
  .ps-second { break-after: page; }

  /* A filled band rather than the shared rule-under-text header. A payslip is
     handed to a person and often kept, so it should carry the same brand weight
     as the invoice a client receives, not read as an internal printout. */
  .ps > .sh-band {
    background: ${SHEET.brown}; border-bottom: 2pt solid ${SHEET.brass};
    padding: 7pt 10pt; align-items: center;
  }
  .ps > .sh-band .sh-co { color: #fff; font-size: 11pt; }
  .ps > .sh-band .sh-tag { color: ${SHEET.brass}; }
  .ps > .sh-band .sh-kind { color: ${SHEET.brass}; }
  .ps > .sh-band .sh-ref { color: #fff; }

  /* Name on the left, period on the right, so the two facts that identify the
     slip sit on one line instead of the period hiding up in the band. */
  .ps-who {
    display: flex; justify-content: space-between; align-items: flex-end;
    gap: 12pt; margin-top: 10pt; padding-bottom: 6pt;
    border-bottom: 0.5pt solid ${SHEET.border};
  }
  .ps-label {
    font-size: 6.5pt; font-weight: bold; letter-spacing: 1pt;
    text-transform: uppercase; color: ${SHEET.brown};
  }
  .ps-name {
    margin-top: 2pt; font-size: 15pt; font-weight: bold; color: ${SHEET.ink};
    letter-spacing: -0.2pt;
  }
  .ps-period { text-align: right; }
  .ps-period-value {
    margin-top: 2pt; font-size: 10.5pt; font-weight: bold; color: ${SHEET.ink};
  }

  /* Earnings table and net panel side by side. */
  .ps-body {
    display: flex; gap: 14pt; margin-top: 10pt; align-items: flex-start;
  }
  .ps-table { flex: 1 1 auto; border-collapse: collapse; width: auto; }
  .ps-table td {
    padding: 4.5pt 6pt; border-bottom: 0.5pt solid ${SHEET.borderSoft};
    font-size: 9pt;
  }
  .ps-table .sh-num { text-align: right; font-weight: 600; white-space: nowrap; }
  .ps-sub td {
    border-top: 0.5pt solid ${SHEET.border}; border-bottom: none; font-weight: bold;
  }
  .ps-deduct td { color: ${SHEET.brownLight}; border-bottom: none; }

  /* The net is what the worker checks first, so it is the one filled block. */
  .ps-net-panel {
    flex: 0 0 44mm; background: ${SHEET.brown}; color: #fff;
    padding: 8pt 10pt 7pt; border-radius: 2pt;
  }
  .ps-net-label {
    font-size: 6.5pt; font-weight: bold; letter-spacing: 1pt;
    text-transform: uppercase; color: ${SHEET.brass};
  }
  .ps-net-value {
    margin-top: 2pt; font-size: 17pt; font-weight: bold; letter-spacing: -0.4pt;
  }
  .ps-net-foot {
    margin-top: 3pt; font-size: 6.5pt; color: ${SHEET.brassPale};
  }

  .ps-signs { margin-top: 13pt; gap: 18pt; }

  .ps-note {
    margin: 8pt 0 0; font-size: 6.5pt; color: ${SHEET.faint};
    max-width: 110mm;
  }

  /* Cut line between the pair on a sheet. */
  .ps-cut { margin-top: 7mm; border-top: 0.5pt dashed #b8afa4; }
`,
});

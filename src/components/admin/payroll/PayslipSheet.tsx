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

            <div className="ps-name">{s.staffName}</div>

            <table className="sh-table ps-table">
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
                  <td>Gross</td>
                  <td className="sh-num">{formatNaira(s.totalKobo)}</td>
                </tr>
                {s.deductionKobo > 0 && (
                  <tr className="ps-deduct">
                    <td>Loan / advance repayment</td>
                    <td className="sh-num">-{formatNaira(s.deductionKobo)}</td>
                  </tr>
                )}
                <tr className="ps-net">
                  <td>Net pay</td>
                  <td className="sh-num">{formatNaira(s.netKobo)}</td>
                </tr>
              </tbody>
            </table>

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

  .ps-name {
    margin-top: 9pt; font-size: 15pt; font-weight: bold; color: ${SHEET.ink};
    letter-spacing: -0.2pt;
  }

  /* A payslip is a two-column statement, so the label column carries no rules
     and the figures sit against a hairline. */
  .ps-table { margin-top: 8pt; }
  .ps-table td { padding: 4.5pt 6pt; border-bottom: 0.5pt solid ${SHEET.borderSoft}; }
  .ps-table tbody tr:nth-child(even) td { background: transparent; }
  .ps-table .sh-num { width: 36%; font-weight: 600; }
  .ps-sub td { border-top: 0.5pt solid ${SHEET.border}; font-weight: bold; }
  .ps-deduct td { color: ${SHEET.brownLight}; }
  .ps-net td {
    background: ${SHEET.brassPale}; color: ${SHEET.brown}; font-size: 12.5pt;
    font-weight: bold; border-top: 1pt solid ${SHEET.brass}; border-bottom: none;
  }

  .ps-signs { margin-top: 13pt; gap: 18pt; }

  /* Cut line between the pair on a sheet. */
  .ps-cut { margin-top: 7mm; border-top: 0.5pt dashed #b8afa4; }
`,
});

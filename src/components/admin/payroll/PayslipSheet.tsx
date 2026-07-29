"use client";

import { useEffect } from "react";
import { formatNaira } from "@/lib/erp/money";

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
}: {
  periodStartMs: number | null;
  periodEndMs: number | null;
  perStaff: PayslipStaff[];
  onDone: () => void;
}) {
  useEffect(() => {
    const t = setTimeout(() => {
      window.print();
      onDone();
    }, 250);
    return () => clearTimeout(t);
  }, [onDone]);

  const period = `${fmt(periodStartMs)} to ${fmt(periodEndMs)}`;

  return (
    <>
      <style>{PRINT_CSS}</style>
      <div className="payslips">
        {perStaff.map((s, i) => (
          <article key={s.staffId} className={`ps ${i % 2 === 1 ? "ps-second" : ""}`}>
            <header className="ps-head">
              <div className="ps-brand">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={LOGO} alt="" width={40} height={27} />
                <div>
                  <div className="ps-co">Nightowl Woodworks Ltd</div>
                  <div className="ps-tag">Precision in Every Cut</div>
                </div>
              </div>
              <div className="ps-doc">
                <div className="ps-title">Payslip</div>
                <div className="ps-period">{period}</div>
              </div>
            </header>

            <div className="ps-name">{s.staffName}</div>

            <table className="ps-table">
              <tbody>
                <tr>
                  <td>Operator work</td>
                  <td className="ps-num">{formatNaira(s.operatorKobo)}</td>
                </tr>
                <tr>
                  <td>Assistant work</td>
                  <td className="ps-num">{formatNaira(s.assistantKobo)}</td>
                </tr>
                <tr className="ps-sub">
                  <td>Gross</td>
                  <td className="ps-num">{formatNaira(s.totalKobo)}</td>
                </tr>
                {s.deductionKobo > 0 && (
                  <tr className="ps-deduct">
                    <td>Loan / advance repayment</td>
                    <td className="ps-num">-{formatNaira(s.deductionKobo)}</td>
                  </tr>
                )}
                <tr className="ps-net">
                  <td>Net pay</td>
                  <td className="ps-num">{formatNaira(s.netKobo)}</td>
                </tr>
              </tbody>
            </table>

            <div className="ps-signs">
              <div className="ps-sign">
                <span>Received by</span>
                <span className="ps-rule" />
              </div>
              <div className="ps-sign">
                <span>Date</span>
                <span className="ps-rule" />
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

const PRINT_CSS = `
.payslips { display: none; }

@media print {
  body > * { display: none !important; }
  body { background: #fff !important; }
  .payslips, .payslips * { display: revert; }
  .payslips {
    display: block !important;
    position: absolute;
    inset: 0;
    background: #fff;
    color: #1c1917;
    /* Stack chosen for U+20A6: the naira sign is absent from several common
       printer fonts and renders as a blank box without a fallback. */
    font-family: "DejaVu Sans", "Segoe UI", Tahoma, Helvetica, Arial, sans-serif;
  }

  @page { size: A4; margin: 12mm; }

  /* Two slips per sheet: break after every second one. */
  .ps {
    break-inside: avoid;
    padding: 6mm 0 4mm;
  }
  .ps-second { break-after: page; }

  .ps-head {
    display: flex; align-items: flex-start; justify-content: space-between;
    border-bottom: 1.5pt solid #6b4a2b; padding-bottom: 5pt;
  }
  .ps-brand { display: flex; align-items: center; gap: 7pt; }
  .ps-co {
    font-size: 10.5pt; font-weight: bold; color: #6b4a2b;
    text-transform: uppercase; letter-spacing: 0.5pt;
  }
  .ps-tag {
    font-size: 6pt; letter-spacing: 1.4pt; color: #6b6560;
    text-transform: uppercase; margin-top: 1pt;
  }
  .ps-doc { text-align: right; }
  .ps-title {
    font-size: 8pt; letter-spacing: 2pt; text-transform: uppercase; color: #6b6560;
  }
  .ps-period { font-size: 9.5pt; font-weight: bold; color: #1c1917; }

  .ps-name {
    margin-top: 8pt; font-size: 14pt; font-weight: bold; color: #1c1917;
  }

  .ps-table {
    width: 100%; border-collapse: collapse; margin-top: 7pt; font-size: 9.5pt;
  }
  .ps-table td { padding: 4pt 6pt; border-bottom: 0.5pt solid #e6ddd0; }
  .ps-num { text-align: right; font-weight: 600; width: 34%; }
  .ps-sub td { border-top: 0.5pt solid #cfc4b4; font-weight: bold; }
  .ps-deduct td { color: #8a5a2b; }
  .ps-net td {
    background: #f0e6d6; color: #6b4a2b; font-size: 12pt;
    font-weight: bold; border-top: 1pt solid #dba95f;
  }

  .ps-signs { display: flex; gap: 18pt; margin-top: 12pt; }
  .ps-sign { flex: 1; display: flex; align-items: flex-end; gap: 5pt; font-size: 8.5pt; }
  .ps-sign > span:first-child { color: #6b6560; min-width: 48pt; }
  .ps-rule { flex: 1; border-bottom: 0.5pt solid #8a8079; height: 11pt; }

  .ps-cut {
    margin-top: 8mm; border-top: 0.5pt dashed #b5aca2;
  }
}
`;

"use client";

import { useEffect } from "react";
import {
  BOARD_TYPE_LABELS,
  JOB_STATUS_LABELS,
  PAYMENT_METHOD_LABELS,
  SERVICE_TYPE_LABELS,
  type BoardType,
  type JobStatus,
  type PaymentMethod,
  type ServiceType,
} from "@/lib/erp/enums";
import { formatNaira } from "@/lib/erp/money";
import type { BoardBreakdown } from "@/lib/erp/types";

/**
 * Printable job sheet, A4.
 *
 * A deliberate reworking of the paper Job Order Tracker rather than a copy of
 * it. What the original lacked and this adds:
 *
 *  - a job number, so a sheet can be matched to a record;
 *  - the priced work itself, which the paper form never captured;
 *  - totals, paid and balance, so the customer sees what is owed at handover;
 *  - room to write, since the paper version crammed fields onto one line.
 *
 * What it drops: the decorative corner swooshes. They consumed roughly a fifth
 * of an A4 sheet and cost ink on every print for no information.
 *
 * Layout uses absolute mm units and avoids CSS the print engines mishandle:
 * no flex gap in table cells, no CSS grid for the tabular sections, and
 * `break-inside: avoid` on each block so a section is never split across pages.
 */

interface JobLike {
  jobNumber: string;
  customerId: string;
  customerName: string;
  customerPhone?: string;
  staffName?: string;
  boards: BoardBreakdown;
  accessories?: string;
  repName?: string;
  repPhone?: string;
  status: JobStatus;
  totalKobo: number;
  paidKobo: number;
  balanceKobo: number;
  notes?: string;
  receivedAtMs: number | null;
}

interface LineLike {
  id: string;
  serviceType: ServiceType;
  boardType?: BoardType;
  quantity: number;
  unitPriceKobo: number;
  amountKobo: number;
}

interface PaymentLike {
  id: string;
  dateMs: number | null;
  description: string;
  amountKobo: number;
  method: PaymentMethod;
}

const LOGO = "/brand/owl-mark-email.png";

/** Blank rows keep the table a consistent height and leave space to write. */
const MIN_PAYMENT_ROWS = 6;

export function JobSheet({
  job,
  lines,
  payments,
  onDone,
}: {
  job: JobLike;
  lines: LineLike[];
  payments: PaymentLike[];
  onDone: () => void;
}) {
  // Print once mounted, then hand control back so the dialog can't reopen on
  // every re-render.
  useEffect(() => {
    const t = setTimeout(() => {
      window.print();
      onDone();
    }, 250);
    return () => clearTimeout(t);
  }, [onDone]);

  const boards = Object.entries(job.boards).filter(
    ([, v]) => typeof v === "number" && v > 0
  ) as Array<[string, number]>;

  const blankPayments = Math.max(0, MIN_PAYMENT_ROWS - payments.length);

  const received = job.receivedAtMs
    ? new Date(job.receivedAtMs).toLocaleDateString("en-GB", {
        day: "numeric",
        month: "long",
        year: "numeric",
      })
    : "";

  return (
    <>
      <style>{PRINT_CSS}</style>
      <div className="job-sheet">
        {/* Header */}
        <header className="js-head">
          <div className="js-brand">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={LOGO} alt="" width={54} height={36} />
            <div>
              <div className="js-name">Nightowl Woodworks Ltd</div>
              <div className="js-tag">Precision in Every Cut</div>
            </div>
          </div>
          <div className="js-doc">
            <div className="js-doctitle">Job Order</div>
            <div className="js-jobno">{job.jobNumber}</div>
            <div className="js-status">{JOB_STATUS_LABELS[job.status]}</div>
          </div>
        </header>

        {/* Parties */}
        <section className="js-block js-cols">
          <div>
            <h2 className="js-h2">Customer</h2>
            <Row label="Name" value={job.customerName} />
            <Row label="Phone" value={job.customerPhone} />
            <Row label="Customer ID" value={job.customerId.slice(0, 8).toUpperCase()} />
          </div>
          <div>
            <h2 className="js-h2">Received</h2>
            <Row label="Date" value={received} />
            <Row label="By" value={job.staffName} />
            <Row label="Client / rep" value={job.repName} />
            <Row label="Rep phone" value={job.repPhone} />
          </div>
        </section>

        {/* Materials */}
        <section className="js-block">
          <h2 className="js-h2">Materials received</h2>
          {boards.length > 0 ? (
            <table className="js-table js-boards">
              <thead>
                <tr>
                  {boards.map(([k]) => (
                    <th key={k}>{BOARD_TYPE_LABELS[k as BoardType] ?? k}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                <tr>
                  {boards.map(([k, v]) => (
                    <td key={k} className="js-num">
                      {v}
                    </td>
                  ))}
                </tr>
              </tbody>
            </table>
          ) : (
            <p className="js-empty">None recorded.</p>
          )}
          {job.accessories && <Row label="Accessories" value={job.accessories} />}
        </section>

        {/* Work, the section the paper form was missing entirely */}
        <section className="js-block">
          <h2 className="js-h2">Work carried out</h2>
          <table className="js-table">
            <thead>
              <tr>
                <th style={{ width: "8%" }}>#</th>
                <th>Service</th>
                <th style={{ width: "16%" }}>Board</th>
                <th style={{ width: "10%" }} className="js-num">
                  Qty
                </th>
                <th style={{ width: "16%" }} className="js-num">
                  Unit
                </th>
                <th style={{ width: "18%" }} className="js-num">
                  Amount
                </th>
              </tr>
            </thead>
            <tbody>
              {lines.map((l, i) => (
                <tr key={l.id}>
                  <td>{i + 1}</td>
                  <td>{SERVICE_TYPE_LABELS[l.serviceType]}</td>
                  <td>{l.boardType ? BOARD_TYPE_LABELS[l.boardType] : ""}</td>
                  <td className="js-num">{l.quantity}</td>
                  <td className="js-num">{formatNaira(l.unitPriceKobo)}</td>
                  <td className="js-num">{formatNaira(l.amountKobo)}</td>
                </tr>
              ))}
              {lines.length === 0 && (
                <tr>
                  <td colSpan={6} className="js-empty">
                    No work lines recorded.
                  </td>
                </tr>
              )}
            </tbody>
          </table>

          <table className="js-totals">
            <tbody>
              <tr>
                <td>Total</td>
                <td className="js-num">{formatNaira(job.totalKobo)}</td>
              </tr>
              <tr>
                <td>Paid</td>
                <td className="js-num">{formatNaira(job.paidKobo)}</td>
              </tr>
              <tr className="js-balance">
                <td>Balance due</td>
                <td className="js-num">{formatNaira(job.balanceKobo)}</td>
              </tr>
            </tbody>
          </table>
        </section>

        {/* Payments */}
        <section className="js-block">
          <h2 className="js-h2">Payment history</h2>
          <table className="js-table">
            <thead>
              <tr>
                <th style={{ width: "8%" }}>#</th>
                <th style={{ width: "20%" }}>Date</th>
                <th>Description</th>
                <th style={{ width: "16%" }}>Method</th>
                <th style={{ width: "18%" }} className="js-num">
                  Amount
                </th>
              </tr>
            </thead>
            <tbody>
              {payments.map((p, i) => (
                <tr key={p.id}>
                  <td>{i + 1}</td>
                  <td>{p.dateMs ? new Date(p.dateMs).toLocaleDateString("en-GB") : ""}</td>
                  <td>{p.description}</td>
                  <td>{PAYMENT_METHOD_LABELS[p.method]}</td>
                  <td className="js-num">{formatNaira(p.amountKobo)}</td>
                </tr>
              ))}
              {/* Blank rows so further payments can be written on the sheet */}
              {Array.from({ length: blankPayments }, (_, i) => (
                <tr key={`blank-${i}`} className="js-blank">
                  <td>{payments.length + i + 1}</td>
                  <td />
                  <td />
                  <td />
                  <td />
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        {/* Quality control and handover */}
        <section className="js-block js-cols">
          <div>
            <h2 className="js-h2">Quality control</h2>
            <div className="js-check">
              <span>Quantity check</span>
              <span className="js-yn">YES &nbsp;/&nbsp; NO</span>
            </div>
            <div className="js-check">
              <span>Quality check</span>
              <span className="js-yn">YES &nbsp;/&nbsp; NO</span>
            </div>
            <SignLine label="Q.O signature" />
          </div>
          <div>
            <h2 className="js-h2">Collected by</h2>
            <SignLine label="Name" />
            <SignLine label="Phone" />
            <SignLine label="Signature" />
            <SignLine label="Date" />
          </div>
        </section>

        {job.notes && (
          <section className="js-block">
            <h2 className="js-h2">Notes</h2>
            <p className="js-notes">{job.notes}</p>
          </section>
        )}

        <footer className="js-foot">
          <span>Nightowl Woodworks Ltd &nbsp;·&nbsp; info@nightowl.com.ng</span>
          <span>{job.jobNumber}</span>
        </footer>
      </div>
    </>
  );
}

function Row({ label, value }: { label: string; value?: string }) {
  return (
    <div className="js-row">
      <span className="js-label">{label}</span>
      <span className="js-value">{value || ""}</span>
    </div>
  );
}

/** Ruled line for a wet signature. */
function SignLine({ label }: { label: string }) {
  return (
    <div className="js-sign">
      <span className="js-label">{label}</span>
      <span className="js-rule" />
    </div>
  );
}

const PRINT_CSS = `
.job-sheet { display: none; }

@media print {
  /* Hide the app chrome and show only the sheet. */
  body > * { display: none !important; }
  body { background: #fff !important; }
  .job-sheet,
  .job-sheet * { display: revert; }
  .job-sheet {
    display: block !important;
    position: absolute;
    inset: 0;
    background: #fff;
    color: #1c1917;
    /* Stack chosen for U+20A6: the naira sign is absent from several common
       printer fonts and renders as a blank box without a fallback. */
    font-family: "DejaVu Sans", "Segoe UI", Tahoma, Helvetica, Arial, sans-serif;
    font-size: 9.5pt;
    line-height: 1.45;
    padding: 0;
  }

  @page { size: A4; margin: 14mm 13mm; }

  .js-head {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    border-bottom: 2.5pt solid #6b4a2b;
    padding-bottom: 7pt;
  }
  .js-brand { display: flex; align-items: center; gap: 9pt; }
  .js-name {
    font-size: 13pt; font-weight: bold; color: #6b4a2b;
    letter-spacing: 0.6pt; text-transform: uppercase;
  }
  .js-tag {
    font-size: 6.5pt; letter-spacing: 1.6pt; color: #6b6560;
    text-transform: uppercase; margin-top: 1pt;
  }
  .js-doc { text-align: right; }
  .js-doctitle {
    font-size: 7.5pt; letter-spacing: 2pt; text-transform: uppercase; color: #6b6560;
  }
  .js-jobno {
    font-size: 16pt; font-weight: bold; color: #1c1917; letter-spacing: 0.4pt;
  }
  .js-status {
    display: inline-block; margin-top: 2pt; padding: 1.5pt 6pt;
    border: 0.75pt solid #dba95f; border-radius: 8pt;
    font-size: 7pt; text-transform: uppercase; letter-spacing: 0.8pt; color: #6b4a2b;
  }

  /* Never split a section across a page break. */
  .js-block { margin-top: 11pt; break-inside: avoid; }
  .js-cols { display: flex; gap: 16pt; }
  .js-cols > div { flex: 1; }

  .js-h2 {
    font-size: 7.5pt; font-weight: bold; letter-spacing: 1.4pt;
    text-transform: uppercase; color: #6b4a2b;
    border-bottom: 0.5pt solid #e6ddd0; padding-bottom: 2.5pt; margin-bottom: 5pt;
  }

  .js-row { display: flex; gap: 6pt; padding: 1.5pt 0; }
  .js-label { color: #6b6560; min-width: 62pt; font-size: 8.5pt; }
  .js-value { color: #1c1917; font-weight: 600; }

  .js-table { width: 100%; border-collapse: collapse; margin-top: 3pt; }
  .js-table th {
    background: #f0e6d6; color: #6b4a2b; font-size: 7.5pt;
    text-transform: uppercase; letter-spacing: 0.7pt; text-align: left;
    padding: 4pt 5pt; border: 0.5pt solid #dcd0bd;
  }
  .js-table td {
    padding: 4.5pt 5pt; border: 0.5pt solid #e6ddd0; font-size: 9pt;
  }
  .js-num { text-align: right; }
  .js-boards td { font-weight: bold; }
  .js-blank td { height: 15pt; }
  .js-empty { color: #9a938c; font-style: italic; text-align: center; padding: 6pt; }

  .js-totals {
    margin-left: auto; margin-top: 6pt; border-collapse: collapse; min-width: 190pt;
  }
  .js-totals td { padding: 3.5pt 8pt; font-size: 9.5pt; }
  .js-totals td:last-child { text-align: right; font-weight: bold; min-width: 80pt; }
  .js-totals .js-balance td {
    background: #f0e6d6; color: #6b4a2b; font-size: 11pt;
    font-weight: bold; border-top: 1pt solid #dba95f;
  }

  .js-check {
    display: flex; justify-content: space-between;
    padding: 3pt 0; border-bottom: 0.5pt dotted #cfc4b4; font-size: 9pt;
  }
  .js-yn { letter-spacing: 0.5pt; color: #6b4a2b; font-weight: bold; }

  .js-sign { display: flex; align-items: flex-end; gap: 5pt; margin-top: 9pt; }
  .js-sign .js-label { min-width: 48pt; }
  .js-rule { flex: 1; border-bottom: 0.5pt solid #8a8079; height: 11pt; }

  .js-notes {
    border: 0.5pt solid #e6ddd0; padding: 6pt; min-height: 26pt; font-size: 9pt;
  }

  .js-foot {
    display: flex; justify-content: space-between;
    margin-top: 14pt; padding-top: 5pt; border-top: 0.5pt solid #e6ddd0;
    font-size: 7.5pt; color: #9a938c;
  }
}
`;

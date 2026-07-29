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
import { SHEET, sheetCss } from "@/components/admin/print/sheetStyles";

/**
 * Printable job order, A4.
 *
 * A reworking of the paper Job Order Tracker rather than a copy. What the
 * original lacked and this adds: a job number so a sheet can be matched to a
 * record, the priced work itself, totals and balance so the customer sees what is
 * owed at handover, and room to write where the paper crammed fields onto one
 * line. What it drops: the decorative corner swooshes, which consumed roughly a
 * fifth of an A4 sheet in ink and carried no information.
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
const MIN_PAYMENT_ROWS = 5;

export function JobSheet({
  job,
  lines,
  payments,
  onDone,
  autoPrint = true,
}: {
  job: JobLike;
  lines: LineLike[];
  payments: PaymentLike[];
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

  const boards = Object.entries(job.boards).filter(
    ([, v]) => typeof v === "number" && v > 0
  ) as Array<[string, number]>;

  const blankPayments = Math.max(0, MIN_PAYMENT_ROWS - payments.length);
  const settled = job.balanceKobo <= 0 && job.totalKobo > 0;

  const received = job.receivedAtMs
    ? new Date(job.receivedAtMs).toLocaleDateString("en-GB", {
        day: "numeric",
        month: "long",
        year: "numeric",
      })
    : "";

  return (
    <>
      <style>{CSS}</style>
      <div className="job-sheet">
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
            <div className="sh-kind">Job Order</div>
            <div className="sh-ref">{job.jobNumber}</div>
            <div className="sh-chip">{JOB_STATUS_LABELS[job.status]}</div>
          </div>
        </header>

        <section className="sh-block sh-cols">
          <div>
            <h2 className="sh-h2">Customer</h2>
            <Row label="Name" value={job.customerName} />
            <Row label="Phone" value={job.customerPhone} />
            <Row label="Reference" value={job.customerId.slice(0, 8).toUpperCase()} />
          </div>
          <div>
            <h2 className="sh-h2">Received</h2>
            <Row label="Date" value={received} />
            <Row label="By" value={job.staffName} />
            <Row label="Client / rep" value={job.repName} />
            <Row label="Rep phone" value={job.repPhone} />
          </div>
        </section>

        <section className="sh-block">
          <h2 className="sh-h2">Materials received</h2>
          {boards.length > 0 ? (
            <table className="sh-table js-boards">
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
                    <td key={k} className="sh-num">
                      {v}
                    </td>
                  ))}
                </tr>
              </tbody>
            </table>
          ) : (
            <p className="sh-empty">None recorded.</p>
          )}
          {job.accessories && <Row label="Accessories" value={job.accessories} />}
        </section>

        <section className="sh-block">
          <h2 className="sh-h2">Work carried out</h2>
          <table className="sh-table">
            <thead>
              <tr>
                <th style={{ width: "7%" }}>#</th>
                <th>Service</th>
                <th style={{ width: "15%" }}>Board</th>
                <th style={{ width: "10%" }} className="sh-num">
                  Qty
                </th>
                <th style={{ width: "16%" }} className="sh-num">
                  Unit
                </th>
                <th style={{ width: "18%" }} className="sh-num">
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
                  <td className="sh-num">{l.quantity}</td>
                  <td className="sh-num">{formatNaira(l.unitPriceKobo)}</td>
                  <td className="sh-num">{formatNaira(l.amountKobo)}</td>
                </tr>
              ))}
              {lines.length === 0 && (
                <tr>
                  <td colSpan={6} className="sh-empty">
                    No work lines recorded.
                  </td>
                </tr>
              )}
            </tbody>
          </table>

          <table className="sh-totals">
            <tbody>
              <tr>
                <td>Total</td>
                <td>{formatNaira(job.totalKobo)}</td>
              </tr>
              <tr>
                <td>Paid</td>
                <td>{formatNaira(job.paidKobo)}</td>
              </tr>
              <tr className="sh-grand">
                <td>{settled ? "Settled in full" : "Balance due"}</td>
                <td>{formatNaira(job.balanceKobo)}</td>
              </tr>
            </tbody>
          </table>
        </section>

        <section className="sh-block">
          <h2 className="sh-h2">Payment history</h2>
          <table className="sh-table">
            <thead>
              <tr>
                <th style={{ width: "7%" }}>#</th>
                <th style={{ width: "18%" }}>Date</th>
                <th>Description</th>
                <th style={{ width: "16%" }}>Method</th>
                <th style={{ width: "18%" }} className="sh-num">
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
                  <td className="sh-num">{formatNaira(p.amountKobo)}</td>
                </tr>
              ))}
              {/* Blank rows so further payments can be written on the sheet */}
              {Array.from({ length: blankPayments }, (_, i) => (
                <tr key={`blank-${i}`} className="sh-blank">
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

        <section className="sh-block sh-cols">
          <div>
            <h2 className="sh-h2">Quality control</h2>
            <div className="js-check">
              <span>Quantity check</span>
              <span className="js-yn">YES &nbsp;/&nbsp; NO</span>
            </div>
            <div className="js-check">
              <span>Quality check</span>
              <span className="js-yn">YES &nbsp;/&nbsp; NO</span>
            </div>
            <div className="sh-sign">
              <span>Q.O signature</span>
              <span className="sh-rule" />
            </div>
          </div>
          <div>
            <h2 className="sh-h2">Collected by</h2>
            <div className="sh-sign">
              <span>Name</span>
              <span className="sh-rule" />
            </div>
            <div className="sh-sign">
              <span>Phone</span>
              <span className="sh-rule" />
            </div>
            <div className="sh-sign">
              <span>Signature</span>
              <span className="sh-rule" />
            </div>
            <div className="sh-sign">
              <span>Date</span>
              <span className="sh-rule" />
            </div>
          </div>
        </section>

        {job.notes && (
          <section className="sh-block">
            <h2 className="sh-h2">Notes</h2>
            <p className="js-notes">{job.notes}</p>
          </section>
        )}

        <footer className="sh-foot">
          <span>Nightowl Woodworks Ltd &nbsp;&middot;&nbsp; info@nightowl.com.ng</span>
          <span>{job.jobNumber}</span>
        </footer>
      </div>
    </>
  );
}

function Row({ label, value }: { label: string; value?: string }) {
  return (
    <div className="sh-row">
      <span className="sh-label">{label}</span>
      <span className="sh-value">{value || ""}</span>
    </div>
  );
}

const CSS = sheetCss({
  root: ".job-sheet",
  page: "A4",
  fontSize: 9,
  own: `
  /* Board counts read as figures, so they carry the emphasis. */
  .js-boards td { font-weight: bold; font-size: 10pt; }

  .js-check {
    display: flex; justify-content: space-between;
    padding: 3.5pt 0; border-bottom: 0.5pt dotted ${SHEET.border}; font-size: 8.5pt;
  }
  .js-yn { letter-spacing: 0.6pt; color: ${SHEET.brown}; font-weight: bold; }

  .js-notes {
    border: 0.5pt solid ${SHEET.border}; background: ${SHEET.panel};
    padding: 7pt; min-height: 26pt; font-size: 8.5pt; margin: 0;
  }
`,
});

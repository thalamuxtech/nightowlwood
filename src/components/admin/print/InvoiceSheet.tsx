"use client";

import { useEffect } from "react";
import { INVOICE_STATUS_LABELS, type InvoiceStatus } from "@/lib/erp/enums";
import { formatNaira } from "@/lib/erp/money";
import { SHEET, sheetCss } from "./sheetStyles";

/**
 * Printable invoice, A4.
 *
 * The most externally visible document the system produces, so it carries the
 * things a customer and their accounts department actually need: an invoice
 * number, issue and due dates, bank details to pay into, and a single
 * unambiguous amount due.
 *
 * A PAID watermark is drawn when the balance is clear. That is deliberate rather
 * than decorative: a settled invoice and an outstanding one look identical at a
 * glance otherwise, and the difference is the whole point of the document.
 */

export interface InvoiceLineLike {
  id: string;
  description: string;
  quantity: number;
  unitPriceKobo: number;
  amountKobo: number;
}

export interface InvoiceLike {
  invoiceNumber: string;
  type: "service" | "project";
  customerName: string;
  customerPhone?: string;
  customerAddress?: string;
  reference?: string;
  lines: InvoiceLineLike[];
  subtotalKobo: number;
  taxPercent?: number;
  taxKobo: number;
  taxLabel?: string;
  totalKobo: number;
  amountPaidKobo: number;
  balanceKobo: number;
  status: InvoiceStatus;
  issuedAtMs: number | null;
  dueAtMs: number | null;
  notes?: string;
}

export interface CompanyLike {
  name: string;
  tagline: string;
  address?: string;
  phone?: string;
  email: string;
  website?: string;
  rcNumber?: string;
  bankName?: string;
  bankAccountName?: string;
  bankAccountNumber?: string;
}

const LOGO = "/brand/owl-mark-email.png";

/** Blank rows keep short invoices from looking unfinished. */
const MIN_LINES = 4;

export function InvoiceSheet({
  invoice,
  company,
  onDone,
  autoPrint = true,
}: {
  invoice: InvoiceLike;
  company: CompanyLike;
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

  const settled = invoice.balanceKobo <= 0 && invoice.totalKobo > 0;
  const blanks = Math.max(0, MIN_LINES - invoice.lines.length);
  const overdue =
    invoice.balanceKobo > 0 && invoice.dueAtMs !== null && invoice.dueAtMs < Date.now();

  const fmtDate = (ms: number | null) =>
    ms
      ? new Date(ms).toLocaleDateString("en-GB", {
          day: "numeric",
          month: "long",
          year: "numeric",
        })
      : "";

  const hasBank =
    company.bankName || company.bankAccountName || company.bankAccountNumber;

  return (
    <>
      <style>{CSS}</style>
      <div className="inv-sheet">
        {settled && <div className="inv-stamp">Paid</div>}

        <header className="sh-band">
          <div className="sh-brand">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={LOGO} alt="" width={52} height={35} />
            <div>
              <div className="sh-co">{company.name}</div>
              <div className="sh-tag">{company.tagline}</div>
            </div>
          </div>
          <div className="sh-doc">
            <div className="sh-kind">Invoice</div>
            <div className="sh-ref">{invoice.invoiceNumber}</div>
            <div className={`sh-chip ${overdue ? "inv-chip-late" : ""}`}>
              {overdue ? "Overdue" : INVOICE_STATUS_LABELS[invoice.status]}
            </div>
          </div>
        </header>

        <section className="sh-block sh-cols">
          <div>
            <h2 className="sh-h2">Billed to</h2>
            <p className="inv-party">{invoice.customerName}</p>
            {invoice.customerAddress && (
              <p className="inv-party-line">{invoice.customerAddress}</p>
            )}
            {invoice.customerPhone && (
              <p className="inv-party-line">{invoice.customerPhone}</p>
            )}
          </div>
          <div>
            <h2 className="sh-h2">Details</h2>
            <Row label="Issued" value={fmtDate(invoice.issuedAtMs)} />
            <Row label="Due" value={fmtDate(invoice.dueAtMs)} />
            <Row
              label="For"
              value={invoice.type === "service" ? "Service work" : "Project work"}
            />
            {invoice.reference && <Row label="Reference" value={invoice.reference} />}
          </div>
        </section>

        <section className="sh-block">
          <h2 className="sh-h2">Items</h2>
          <table className="sh-table">
            <thead>
              <tr>
                <th style={{ width: "7%" }}>#</th>
                <th>Description</th>
                <th style={{ width: "11%" }} className="sh-num">
                  Qty
                </th>
                <th style={{ width: "18%" }} className="sh-num">
                  Unit price
                </th>
                <th style={{ width: "20%" }} className="sh-num">
                  Amount
                </th>
              </tr>
            </thead>
            <tbody>
              {invoice.lines.map((l, i) => (
                <tr key={l.id}>
                  <td>{i + 1}</td>
                  <td>{l.description}</td>
                  <td className="sh-num">{l.quantity}</td>
                  <td className="sh-num">{formatNaira(l.unitPriceKobo)}</td>
                  <td className="sh-num">{formatNaira(l.amountKobo)}</td>
                </tr>
              ))}
              {Array.from({ length: blanks }, (_, i) => (
                <tr key={`b-${i}`} className="sh-blank">
                  <td>{invoice.lines.length + i + 1}</td>
                  <td />
                  <td />
                  <td />
                  <td />
                </tr>
              ))}
            </tbody>
          </table>

          <table className="sh-totals">
            <tbody>
              <tr>
                <td>Subtotal</td>
                <td>{formatNaira(invoice.subtotalKobo)}</td>
              </tr>
              {invoice.taxKobo > 0 && (
                <tr>
                  <td>
                    {invoice.taxLabel ?? "Tax"}
                    {invoice.taxPercent ? ` (${invoice.taxPercent}%)` : ""}
                  </td>
                  <td>{formatNaira(invoice.taxKobo)}</td>
                </tr>
              )}
              <tr>
                <td>Total</td>
                <td>{formatNaira(invoice.totalKobo)}</td>
              </tr>
              {invoice.amountPaidKobo > 0 && (
                <tr>
                  <td>Paid</td>
                  <td>{formatNaira(invoice.amountPaidKobo)}</td>
                </tr>
              )}
              <tr className="sh-grand">
                <td>{settled ? "Paid in full" : "Amount due"}</td>
                <td>{formatNaira(invoice.balanceKobo)}</td>
              </tr>
            </tbody>
          </table>
        </section>

        <section className="sh-block sh-cols">
          {hasBank && (
            <div>
              <h2 className="sh-h2">Payment details</h2>
              <Row label="Bank" value={company.bankName} />
              <Row label="Account name" value={company.bankAccountName} />
              <Row label="Account no." value={company.bankAccountNumber} />
              <p className="sh-note">
                Please quote {invoice.invoiceNumber} on the transfer so payment can be
                matched to this invoice.
              </p>
            </div>
          )}
          <div>
            <h2 className="sh-h2">Received by</h2>
            <div className="sh-sign">
              <span>Name</span>
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

        {invoice.notes && (
          <section className="sh-block">
            <h2 className="sh-h2">Notes</h2>
            <p className="inv-notes">{invoice.notes}</p>
          </section>
        )}

        <footer className="sh-foot">
          <span>
            {company.name}
            {company.rcNumber ? ` · RC ${company.rcNumber}` : ""}
            {company.phone ? ` · ${company.phone}` : ""} &middot; {company.email}
          </span>
          <span>{invoice.invoiceNumber}</span>
        </footer>
      </div>
    </>
  );
}

function Row({ label, value }: { label: string; value?: string }) {
  if (!value) return null;
  return (
    <div className="sh-row">
      <span className="sh-label">{label}</span>
      <span className="sh-value">{value}</span>
    </div>
  );
}

const CSS = sheetCss({
  root: ".inv-sheet",
  page: "A4",
  fontSize: 9,
  own: `
  /* Positioning context for the PAID stamp. */
  .inv-sheet { position: relative; }

  /* Drawn at low opacity behind the content: unmistakable at a glance, but it
     must never obscure a figure someone needs to read. */
  .inv-stamp {
    position: absolute; top: 42%; left: 50%;
    transform: translate(-50%, -50%) rotate(-18deg);
    font-size: 62pt; font-weight: bold; letter-spacing: 6pt;
    text-transform: uppercase; color: ${SHEET.brass};
    opacity: 0.13; pointer-events: none; z-index: 0;
  }
  .inv-sheet > header, .inv-sheet > section, .inv-sheet > footer {
    position: relative; z-index: 1;
  }

  .inv-party {
    margin: 0; font-size: 11pt; font-weight: bold; color: ${SHEET.ink};
  }
  .inv-party-line { margin: 1pt 0 0; font-size: 8.5pt; color: ${SHEET.muted}; }

  /* An overdue invoice is the one case worth a second colour. */
  .inv-chip-late { border-color: #9c3d2a; color: #9c3d2a; }

  .inv-notes {
    border: 0.5pt solid ${SHEET.border}; background: ${SHEET.panel};
    padding: 7pt; font-size: 8.5pt; margin: 0;
  }
`,
});

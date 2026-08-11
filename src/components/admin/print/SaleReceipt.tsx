"use client";

import { useEffect } from "react";
import { PAYMENT_METHOD_LABELS, type PaymentMethod } from "@/lib/erp/enums";
import { formatNaira } from "@/lib/erp/money";
import { SHEET, sheetCss } from "./sheetStyles";

/**
 * Counter-sale receipt, A4.
 *
 * A4 rather than a till-roll width, because the workshop has an A4 printer and not a
 * thermal one, and a receipt nobody can print is not a receipt. It is laid out narrow
 * and top-aligned so it can be guillotined down to a slip if wanted.
 *
 * The change given is printed. A cash customer checks their change against the paper,
 * and a receipt that shows the total but not what was handed over cannot settle the
 * only dispute a counter sale usually produces.
 */

export interface SaleReceiptLine {
  item: string;
  quantity: number;
  unitPriceKobo: number;
  amountKobo: number;
}

export interface SaleReceiptLike {
  receiptNumber: string;
  lines: SaleReceiptLine[];
  subtotalKobo: number;
  discountKobo: number;
  taxKobo: number;
  taxLabel: string;
  totalKobo: number;
  method: PaymentMethod;
  tenderedKobo: number;
  changeKobo: number;
  customerName?: string;
  /*
   * Present only when the goods went out on account. A receipt that says "paid in full" for
   * goods that were not paid for is the document the customer will hold up later, so the slip
   * has to state the balance as plainly as the total.
   */
  amountPaidKobo?: number;
  balanceKobo?: number;
  soldAtMs: number;
}

const LOGO = "/brand/owl-mark-email.png";

export function SaleReceipt({
  sale,
  footerNote,
  onDone,
  autoPrint = true,
}: {
  sale: SaleReceiptLike;
  footerNote?: string;
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

  const when = new Date(sale.soldAtMs).toLocaleString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

  return (
    <>
      <style>{CSS}</style>
      <div className="rc-sheet">
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
            <div className="sh-kind">Sales Receipt</div>
            <div className="sh-ref">{sale.receiptNumber}</div>
          </div>
        </header>

        <section className="sh-block rc-meta">
          <div>
            <span className="rc-label">Date</span>
            <span>{when}</span>
          </div>
          <div>
            <span className="rc-label">Sold to</span>
            <span>{sale.customerName ?? "Cash sale"}</span>
          </div>
          <div>
            <span className="rc-label">Paid by</span>
            <span>{PAYMENT_METHOD_LABELS[sale.method]}</span>
          </div>
        </section>

        <section className="sh-block">
          <table className="sh-table">
            <thead>
              <tr>
                <th>Item</th>
                <th style={{ width: "12%" }} className="sh-num">
                  Qty
                </th>
                <th style={{ width: "20%" }} className="sh-num">
                  Price
                </th>
                <th style={{ width: "22%" }} className="sh-num">
                  Amount
                </th>
              </tr>
            </thead>
            <tbody>
              {sale.lines.map((l, i) => (
                <tr key={`${l.item}-${i}`}>
                  <td>{l.item}</td>
                  <td className="sh-num">{l.quantity}</td>
                  <td className="sh-num">{formatNaira(l.unitPriceKobo)}</td>
                  <td className="sh-num">{formatNaira(l.amountKobo)}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <table className="sh-totals">
            <tbody>
              <tr>
                <td>Subtotal</td>
                <td>{formatNaira(sale.subtotalKobo)}</td>
              </tr>
              {sale.discountKobo > 0 && (
                <tr>
                  <td>Less discount</td>
                  <td>{formatNaira(sale.discountKobo)}</td>
                </tr>
              )}
              {sale.taxKobo > 0 && (
                <tr>
                  <td>{sale.taxLabel}</td>
                  <td>{formatNaira(sale.taxKobo)}</td>
                </tr>
              )}
              <tr className="sh-grand">
                <td>Total</td>
                <td>{formatNaira(sale.totalKobo)}</td>
              </tr>
              {/* Cash only: a transfer or card is for the exact amount, so
                  "tendered" and "change" would be noise on those. */}
              {sale.method === "cash" && sale.tenderedKobo > 0 && (
                <>
                  <tr>
                    <td>Cash given</td>
                    <td>{formatNaira(sale.tenderedKobo)}</td>
                  </tr>
                  <tr>
                    <td>Change</td>
                    <td>{formatNaira(sale.changeKobo)}</td>
                  </tr>
                </>
              )}
              {sale.balanceKobo !== undefined && (
                <>
                  <tr>
                    <td>Paid</td>
                    <td>{formatNaira(sale.amountPaidKobo ?? 0)}</td>
                  </tr>
                  <tr className="sh-grand">
                    <td>{sale.balanceKobo > 0 ? "Balance due" : "Settled"}</td>
                    <td>{formatNaira(sale.balanceKobo)}</td>
                  </tr>
                </>
              )}
            </tbody>
          </table>
        </section>

        <footer className="rc-foot">
          {footerNote && <p>{footerNote}</p>}
          <p className="rc-thanks">Thank you for your custom.</p>
        </footer>
      </div>
    </>
  );
}

const CSS = sheetCss({
  root: ".rc-sheet",
  page: "A4",
  fontSize: 9.5,
  own: `
    /* Narrow column, top-aligned: a receipt is a short document and stretching
       it across A4 leaves the figures marooned from the header. */
    .rc-sheet { max-width: 118mm; }

    .rc-meta {
      display: flex; flex-direction: column; gap: 3pt;
    }
    .rc-meta > div { display: flex; gap: 8pt; }
    .rc-label {
      color: ${SHEET.muted};
      min-width: 52pt;
      text-transform: uppercase;
      font-size: 7.5pt;
      letter-spacing: 0.06em;
      padding-top: 1pt;
    }

    .rc-foot {
      margin-top: 14pt;
      padding-top: 8pt;
      border-top: 1pt solid ${SHEET.border};
      color: ${SHEET.muted};
      font-size: 8pt;
    }
    .rc-thanks { margin-top: 4pt; color: ${SHEET.brown}; font-weight: bold; }
  `,
});

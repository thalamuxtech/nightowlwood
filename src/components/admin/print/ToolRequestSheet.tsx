"use client";

import { useEffect } from "react";
import { TOOL_REQUEST_STATUS_LABELS, type ToolRequestStatus } from "@/lib/erp/enums";
import { SHEET, sheetCss } from "./sheetStyles";

/**
 * Printable tools request, A4.
 *
 * Follows the paper Tools Request Form, with the same three-part structure:
 * request, issue, return. What it adds is a request number so a sheet can be
 * matched to a record, a due-back date, and an outstanding column so an
 * incomplete return is visible on the paper rather than only in the system.
 *
 * The two signature blocks are kept because the sheet travels with the tools:
 * whoever hands them over and whoever brings them back both sign the same
 * document, which is what makes it evidence rather than a note.
 */

export interface ToolItemLike {
  id: string;
  name: string;
  description?: string;
  quantityRequested: number;
  quantityIssued?: number | null;
  quantityReturned?: number | null;
  remarks?: string;
}

export interface ToolRequestLike {
  requestNumber: string;
  jobName: string;
  jobLocation?: string;
  requestedByName: string;
  status: ToolRequestStatus;
  requestDateMs: number | null;
  expectedReturnMs: number | null;
  issuedByName?: string;
  returnedByName?: string;
  returnedDateMs: number | null;
}

const LOGO = "/brand/owl-mark-email.png";

/** Blank rows so tools can be added by hand on site. */
const MIN_ROWS = 8;

export function ToolRequestSheet({
  request,
  items,
  onDone,
  autoPrint = true,
}: {
  request: ToolRequestLike;
  items: ToolItemLike[];
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

  const blanks = Math.max(0, MIN_ROWS - items.length);
  const outstanding = items.reduce(
    (s, i) => s + Math.max(0, (i.quantityIssued ?? 0) - (i.quantityReturned ?? 0)),
    0
  );

  const fmtDate = (ms: number | null) =>
    ms
      ? new Date(ms).toLocaleDateString("en-GB", {
          day: "numeric",
          month: "long",
          year: "numeric",
        })
      : "";

  return (
    <>
      <style>{CSS}</style>
      <div className="tr-sheet">
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
            <div className="sh-kind">Tools Request</div>
            <div className="sh-ref">{request.requestNumber}</div>
            <div className="sh-chip">{TOOL_REQUEST_STATUS_LABELS[request.status]}</div>
          </div>
        </header>

        <section className="sh-block sh-cols">
          <div>
            <h2 className="sh-h2">Job</h2>
            <Row label="Job name" value={request.jobName} />
            <Row label="Location" value={request.jobLocation} />
          </div>
          <div>
            <h2 className="sh-h2">Request</h2>
            <Row label="Requested by" value={request.requestedByName} />
            <Row label="Date" value={fmtDate(request.requestDateMs)} />
            <Row label="Due back" value={fmtDate(request.expectedReturnMs)} />
          </div>
        </section>

        <section className="sh-block">
          <h2 className="sh-h2">Tools</h2>
          <table className="sh-table">
            <thead>
              <tr>
                <th style={{ width: "6%" }}>#</th>
                <th style={{ width: "26%" }}>Tool</th>
                <th>Description</th>
                <th style={{ width: "10%" }} className="sh-num">
                  Req.
                </th>
                <th style={{ width: "10%" }} className="sh-num">
                  Issued
                </th>
                <th style={{ width: "10%" }} className="sh-num">
                  Back
                </th>
                <th style={{ width: "11%" }} className="sh-num">
                  Out
                </th>
              </tr>
            </thead>
            <tbody>
              {items.map((i, n) => {
                const out = Math.max(0, (i.quantityIssued ?? 0) - (i.quantityReturned ?? 0));
                return (
                  <tr key={i.id}>
                    <td>{n + 1}</td>
                    <td>{i.name}</td>
                    <td>{i.description ?? ""}</td>
                    <td className="sh-num">{i.quantityRequested}</td>
                    <td className="sh-num">{i.quantityIssued ?? ""}</td>
                    <td className="sh-num">{i.quantityReturned ?? ""}</td>
                    <td className={`sh-num ${out > 0 ? "tr-out" : ""}`}>
                      {out > 0 ? out : ""}
                    </td>
                  </tr>
                );
              })}
              {Array.from({ length: blanks }, (_, i) => (
                <tr key={`b-${i}`} className="sh-blank">
                  <td>{items.length + i + 1}</td>
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

          {outstanding > 0 && (
            <p className="tr-warn">
              {outstanding} item{outstanding === 1 ? "" : "s"} still outstanding. This
              request stays open until every issued tool is accounted for.
            </p>
          )}
        </section>

        <section className="sh-block sh-cols">
          <div>
            <h2 className="sh-h2">Issued</h2>
            <Row label="Issued by" value={request.issuedByName} />
            <div className="sh-sign">
              <span>Signature</span>
              <span className="sh-rule" />
            </div>
            <div className="sh-sign">
              <span>Date</span>
              <span className="sh-rule" />
            </div>
          </div>
          <div>
            <h2 className="sh-h2">Returned</h2>
            <Row label="Returned by" value={request.returnedByName} />
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

        <p className="sh-note">
          Tools remain the property of Nightowl Woodworks Ltd. Loss or damage is the
          responsibility of the person named above until the return is signed.
        </p>

        <footer className="sh-foot">
          <span>Nightowl Woodworks Ltd &nbsp;&middot;&nbsp; info@nightowl.com.ng</span>
          <span>{request.requestNumber}</span>
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
  root: ".tr-sheet",
  page: "A4",
  fontSize: 9,
  own: `
  /* An outstanding count is the one figure worth colouring: it means a tool is
     unaccounted for. */
  .tr-out { color: ${SHEET.brownLight}; font-weight: bold; }

  .tr-warn {
    margin-top: 7pt; padding: 6pt 8pt;
    border: 0.5pt solid ${SHEET.brass}; background: ${SHEET.brassPale};
    font-size: 8pt; color: ${SHEET.brown};
  }
`,
});

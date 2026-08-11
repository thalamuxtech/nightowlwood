"use client";

import { useEffect } from "react";
import { SHEET, sheetCss } from "./sheetStyles";

/**
 * Staff ID card, printed two-up on A4 at credit-card size (85.6 × 54mm).
 *
 * Front and back on one sheet so a single print produces a whole card: cut both out, put
 * them back to back, laminate. Printing them on separate pages is how workshops end up
 * with a stack of fronts and no backs.
 *
 * Cut marks rather than borders. A printed border has to be cut exactly on the line to
 * look right, and it never is; corner marks sit *outside* the card so the cut can be
 * slightly off without showing.
 */

export interface StaffIdCardData {
  staffName: string;
  jobTitle: string;
  staffNumber: string;
  photoUrl?: string;
  phone?: string;
  idNumber?: string;
  issuedAtMs: number;
  expiresAtMs?: number | null;
  nextOfKinName?: string;
  nextOfKinPhone?: string;
  bloodGroup?: string;
  returnNote: string;
}

export interface CardCompany {
  name: string;
  address?: string;
  phone?: string;
  website?: string;
}

const LOGO = "/brand/owl-mark-email.png";

export function StaffIdCard({
  data,
  company,
  onDone,
  autoPrint = true,
}: {
  data: StaffIdCardData;
  company: CardCompany;
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

  const fmt = (ms: number | null | undefined) =>
    ms
      ? new Date(ms).toLocaleDateString("en-GB", {
          month: "short",
          year: "numeric",
        })
      : "—";

  return (
    <>
      <style>{CSS}</style>
      <div className="id-sheet">
        <p className="id-hint">
          Cut along the marks, place back to back and laminate.
        </p>

        {/* --- Front --- */}
        <div className="id-card id-front">
          <div className="id-marks" aria-hidden />
          <div className="id-band">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={LOGO} alt="" width={26} height={18} />
            <span className="id-co">{company.name}</span>
          </div>

          <div className="id-body">
            <div className="id-photo">
              {data.photoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={data.photoUrl} alt="" />
              ) : (
                // A ruled box rather than nothing: a card with a blank space reads as
                // unfinished, while one that says PHOTO is plainly awaiting one.
                <span className="id-nophoto">PHOTO</span>
              )}
            </div>
            <div className="id-facts">
              <div className="id-name">{data.staffName}</div>
              <div className="id-role">{data.jobTitle}</div>
              <dl className="id-dl">
                <div>
                  <dt>ID</dt>
                  <dd>{data.staffNumber || "—"}</dd>
                </div>
                <div>
                  <dt>Issued</dt>
                  <dd>{fmt(data.issuedAtMs)}</dd>
                </div>
                {data.expiresAtMs && (
                  <div>
                    <dt>Valid to</dt>
                    <dd>{fmt(data.expiresAtMs)}</dd>
                  </div>
                )}
              </dl>
            </div>
          </div>

          <div className="id-sig">
            <span className="id-sigline" />
            <span className="id-siglabel">Holder&rsquo;s signature</span>
          </div>
        </div>

        {/* --- Back --- */}
        <div className="id-card id-back">
          <div className="id-marks" aria-hidden />
          <div className="id-backhead">{company.name}</div>

          {/* The back carries what matters in an emergency, which is the only time
              anyone reads the back of an ID card. */}
          <dl className="id-backdl">
            {data.phone && (
              <div>
                <dt>Holder&rsquo;s phone</dt>
                <dd>{data.phone}</dd>
              </div>
            )}
            {data.idNumber && (
              <div>
                <dt>NIN</dt>
                <dd>{data.idNumber}</dd>
              </div>
            )}
            {data.bloodGroup && (
              <div>
                <dt>Blood group</dt>
                <dd>{data.bloodGroup}</dd>
              </div>
            )}
            {data.nextOfKinName && (
              <div>
                <dt>In emergency</dt>
                <dd>
                  {data.nextOfKinName}
                  {data.nextOfKinPhone && ` · ${data.nextOfKinPhone}`}
                </dd>
              </div>
            )}
          </dl>

          <div className="id-return">{data.returnNote}</div>
          <div className="id-addr">
            {[company.address, company.phone, company.website]
              .filter(Boolean)
              .join(" · ")}
          </div>
        </div>
      </div>
    </>
  );
}

const CARD_W = "85.6mm";
const CARD_H = "54mm";

const CSS = sheetCss({
  root: ".id-sheet",
  page: "A4",
  fontSize: 8,
  own: `
    .id-hint {
      font-size: 7.5pt; color: ${SHEET.muted}; margin-bottom: 6mm;
    }

    .id-card {
      position: relative;
      width: ${CARD_W};
      height: ${CARD_H};
      /* Fixed size in mm: a card that scales with the viewport is not a card. */
      box-sizing: border-box;
      padding: 3mm;
      margin-bottom: 10mm;
      background: #fff;
      /* A hairline guide, kept very light so a slightly-off cut does not show a
         heavy line down one edge. */
      outline: 0.25pt solid ${SHEET.border};
      page-break-inside: avoid;
      overflow: hidden;
    }

    /* Corner cut marks, drawn outside the card edge. */
    .id-marks::before, .id-marks::after {
      content: ""; position: absolute; width: 4mm; height: 4mm;
      border-color: ${SHEET.faint}; border-style: solid;
    }
    .id-marks::before {
      top: -1px; left: -1px; border-width: 0.5pt 0 0 0.5pt;
    }
    .id-marks::after {
      bottom: -1px; right: -1px; border-width: 0 0.5pt 0.5pt 0;
    }

    .id-band {
      display: flex; align-items: center; gap: 2mm;
      padding-bottom: 1.5mm; margin-bottom: 2mm;
      border-bottom: 1pt solid ${SHEET.brown};
    }
    .id-co {
      font-size: 8pt; font-weight: bold; color: ${SHEET.brown};
      letter-spacing: 0.01em;
    }

    .id-body { display: flex; gap: 3mm; }

    .id-photo {
      width: 20mm; height: 25mm; flex-shrink: 0;
      border: 0.5pt solid ${SHEET.border};
      display: flex; align-items: center; justify-content: center;
      overflow: hidden; background: ${SHEET.panel};
    }
    .id-photo img { width: 100%; height: 100%; object-fit: cover; }
    .id-nophoto {
      font-size: 6pt; letter-spacing: 0.1em; color: ${SHEET.faint};
    }

    .id-facts { min-width: 0; flex: 1; }
    .id-name {
      font-size: 10pt; font-weight: bold; color: ${SHEET.ink}; line-height: 1.15;
    }
    .id-role {
      font-size: 7.5pt; color: ${SHEET.brownLight}; margin-top: 0.5mm;
      text-transform: uppercase; letter-spacing: 0.04em;
    }
    .id-dl { margin-top: 2mm; }
    .id-dl > div { display: flex; gap: 2mm; margin-bottom: 0.6mm; }
    .id-dl dt {
      font-size: 6pt; text-transform: uppercase; letter-spacing: 0.06em;
      color: ${SHEET.muted}; min-width: 12mm;
    }
    .id-dl dd { font-size: 7pt; font-weight: bold; color: ${SHEET.ink}; }

    .id-sig {
      position: absolute; bottom: 3mm; left: 3mm; right: 3mm;
      display: flex; flex-direction: column;
    }
    .id-sigline {
      border-top: 0.5pt solid ${SHEET.faint}; margin-bottom: 0.5mm;
    }
    .id-siglabel { font-size: 5.5pt; color: ${SHEET.muted}; }

    /* --- Back --- */
    .id-backhead {
      font-size: 7.5pt; font-weight: bold; color: ${SHEET.brown};
      padding-bottom: 1.5mm; margin-bottom: 2mm;
      border-bottom: 1pt solid ${SHEET.brown};
    }
    .id-backdl > div { display: flex; gap: 2mm; margin-bottom: 1mm; }
    .id-backdl dt {
      font-size: 6pt; text-transform: uppercase; letter-spacing: 0.06em;
      color: ${SHEET.muted}; min-width: 20mm; flex-shrink: 0;
    }
    .id-backdl dd { font-size: 7pt; color: ${SHEET.ink}; }

    .id-return {
      position: absolute; bottom: 7mm; left: 3mm; right: 3mm;
      font-size: 6pt; color: ${SHEET.muted}; line-height: 1.35;
    }
    .id-addr {
      position: absolute; bottom: 3mm; left: 3mm; right: 3mm;
      font-size: 5.5pt; color: ${SHEET.faint};
      border-top: 0.25pt solid ${SHEET.borderSoft}; padding-top: 1mm;
    }
  `,
});

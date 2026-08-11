"use client";

import { useEffect } from "react";
import { EMPLOYMENT_TYPE_LABELS, type EmploymentType } from "@/lib/erp/enums";
import { formatNaira } from "@/lib/erp/money";
import { SHEET, sheetCss } from "./sheetStyles";

/**
 * Appointment letter, A4.
 *
 * A formal document the employee keeps, and often the only written record they hold of
 * what was agreed. It therefore states the four things that get disputed later — the
 * role, the start date, the pay basis, and who to report to — rather than being a
 * welcome note.
 *
 * Pay is stated as a *basis* rather than only a figure: a piece-rate operator has no
 * monthly salary to print, and a letter claiming one would be wrong in a way that matters
 * if it were ever produced in an argument.
 */

export interface AppointmentLetterData {
  reference: string;
  staffName: string;
  address?: string;
  jobTitle: string;
  employmentType: EmploymentType;
  monthlySalaryKobo?: number;
  startDateMs: number | null;
  issuedAtMs: number;
  reportsTo?: string;
  /** Extra clauses the workshop wants on the letter. */
  terms?: string[];
  signatoryName: string;
  signatoryTitle: string;
}

export interface LetterCompany {
  name: string;
  address?: string;
  phone?: string;
  email?: string;
  website?: string;
  rcNumber?: string;
}

const LOGO = "/brand/owl-mark-email.png";

/**
 * Standing terms.
 *
 * Deliberately plain and short. A letter nobody reads protects nobody, and these are the
 * clauses the workshop actually relies on: that piece-rate pay follows recorded work, and
 * that deductions are only ever what was recorded and agreed.
 */
const DEFAULT_TERMS = [
  "Your appointment takes effect from the start date shown above.",
  "Pay is calculated from the work recorded in the company's work log for the period, and is paid on the company's normal pay cycle.",
  "Any advance, penalty or absence deduction will be recorded against you in writing and shown on your pay record for that period.",
  "Company tools and materials issued to you remain company property and must be accounted for.",
  "Either party may end this appointment by giving the notice required under the terms agreed at engagement.",
];

export function AppointmentLetter({
  data,
  company,
  onDone,
  autoPrint = true,
}: {
  data: AppointmentLetterData;
  company: LetterCompany;
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

  const fmtDate = (ms: number | null) =>
    ms
      ? new Date(ms).toLocaleDateString("en-GB", {
          day: "numeric",
          month: "long",
          year: "numeric",
        })
      : "—";

  const terms = data.terms?.length ? data.terms : DEFAULT_TERMS;

  return (
    <>
      <style>{CSS}</style>
      <div className="al-sheet">
        <header className="sh-band">
          <div className="sh-brand">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={LOGO} alt="" width={52} height={35} />
            <div>
              <div className="sh-co">{company.name}</div>
              <div className="sh-tag">Precision in Every Cut</div>
            </div>
          </div>
          <div className="sh-doc">
            <div className="sh-kind">Letter of Appointment</div>
            <div className="sh-ref">{data.reference}</div>
          </div>
        </header>

        <div className="al-company">
          {company.address && <div>{company.address}</div>}
          <div>
            {[company.phone, company.email].filter(Boolean).join(" · ")}
            {company.rcNumber && ` · RC ${company.rcNumber}`}
          </div>
        </div>

        <div className="al-date">{fmtDate(data.issuedAtMs)}</div>

        <div className="al-to">
          <div className="al-name">{data.staffName}</div>
          {data.address && <div>{data.address}</div>}
        </div>

        <p className="al-salutation">Dear {data.staffName.split(" ")[0]},</p>

        <h1 className="al-subject">Offer of Appointment</h1>

        <p className="al-body">
          Following our discussions, we are pleased to offer you appointment with{" "}
          {company.name} on the terms set out below.
        </p>

        {/* The four things that get argued about, in a table so none can be missed. */}
        <table className="al-terms">
          <tbody>
            <tr>
              <th>Position</th>
              <td>{data.jobTitle}</td>
            </tr>
            <tr>
              <th>Start date</th>
              <td>{fmtDate(data.startDateMs)}</td>
            </tr>
            <tr>
              <th>Pay basis</th>
              <td>
                {EMPLOYMENT_TYPE_LABELS[data.employmentType]}
                {data.employmentType === "salary" &&
                  (data.monthlySalaryKobo ?? 0) > 0 && (
                    <>
                      {" — "}
                      <strong>{formatNaira(data.monthlySalaryKobo ?? 0)}</strong> per month
                    </>
                  )}
                {data.employmentType === "wage" && (
                  <> — at the rates in force for the work recorded</>
                )}
              </td>
            </tr>
            {data.reportsTo && (
              <tr>
                <th>Reports to</th>
                <td>{data.reportsTo}</td>
              </tr>
            )}
          </tbody>
        </table>

        <h2 className="sh-h2 al-h2">Terms</h2>
        <ol className="al-list">
          {terms.map((t, i) => (
            <li key={i}>{t}</li>
          ))}
        </ol>

        <p className="al-body">
          Please sign and return the copy of this letter to confirm your acceptance.
        </p>

        {/* Two signatures, because the letter is evidence only once both are on it. */}
        <div className="al-signatures">
          <div>
            <div className="al-sigline" />
            <div className="al-signame">{data.signatoryName || " "}</div>
            <div className="al-sigrole">{data.signatoryTitle}</div>
            <div className="al-sigrole">For: {company.name}</div>
          </div>
          <div>
            <div className="al-sigline" />
            <div className="al-signame">{data.staffName}</div>
            <div className="al-sigrole">Accepted — signature &amp; date</div>
          </div>
        </div>
      </div>
    </>
  );
}

const CSS = sheetCss({
  root: ".al-sheet",
  page: "A4",
  fontSize: 10,
  own: `
    .al-company { margin-top: 10pt; font-size: 8pt; color: ${SHEET.muted}; }
    .al-date { margin-top: 16pt; font-size: 9.5pt; color: ${SHEET.muted}; }
    .al-to { margin-top: 12pt; }
    .al-name { font-weight: bold; color: ${SHEET.ink}; }
    .al-salutation { margin-top: 14pt; }
    .al-subject {
      margin-top: 12pt; font-size: 12pt; font-weight: bold;
      color: ${SHEET.brown}; text-transform: uppercase; letter-spacing: 0.04em;
    }
    .al-body { margin-top: 10pt; line-height: 1.6; }

    /* A table, not prose: the position, date and pay basis are the clauses people come
       back to, and burying them in a paragraph is how they get misremembered. */
    .al-terms {
      width: 100%; margin-top: 14pt; border-collapse: collapse;
    }
    .al-terms th, .al-terms td {
      text-align: left; vertical-align: top; padding: 5pt 8pt;
      border-bottom: 0.5pt solid ${SHEET.borderSoft};
    }
    .al-terms th {
      width: 26%; color: ${SHEET.muted}; font-weight: normal;
      text-transform: uppercase; font-size: 7.5pt; letter-spacing: 0.06em;
    }

    .al-h2 { margin-top: 18pt; }
    .al-list { margin: 8pt 0 0 14pt; padding: 0; }
    .al-list li { margin-bottom: 5pt; line-height: 1.55; }

    .al-signatures {
      display: flex; gap: 24pt; margin-top: 34pt;
      /* Kept whole: a signature block split across a page break is not signable. */
      page-break-inside: avoid;
    }
    .al-signatures > div { flex: 1; }
    .al-sigline { border-top: 0.75pt solid ${SHEET.ink}; margin-bottom: 4pt; }
    .al-signame { font-weight: bold; font-size: 9.5pt; }
    .al-sigrole { font-size: 8pt; color: ${SHEET.muted}; }
  `,
});

/**
 * Branded email shell.
 *
 * Built with tables and inline styles rather than modern CSS, because Outlook
 * and several Android clients ignore flexbox, grid and `<style>` blocks. The
 * palette follows the Job Order Tracker: brown/brass on cream, "PRECISION IN
 * EVERY CUT" under the wordmark.
 *
 * Email clients strip external CSS and often block remote images, so the owl
 * mark is inline SVG and every rule is on the element.
 */

const BRASS = "#dba95f";
const BROWN = "#6b4a2b";
const INK = "#1c1917";
const MUTED = "#6b6560";
const CREAM = "#faf7f2";
const BORDER = "#e6ddd0";

/** Inline owl mark, simplified for email rendering. */
const OWL_SVG = `<svg width="46" height="32" viewBox="0 0 516 349" xmlns="http://www.w3.org/2000/svg" style="display:block;">
  <path fill="${BROWN}" d="M259.5 19 L276.5 46 L306.5 29 L312 28 L308 50.5 L312.5 54 Q330 58 349.5 69 L382 96.5 L403 124.5 L354.5 122 Q320 128 291 156.5 L263.5 194 L254.5 196 L231 164.5 L213.5 145 Q185 128 161.5 122 L111.5 126 L125 105.5 L162.5 70 Q185 58 204.5 54 L209 50.5 L204 28.5 L210.5 29 L241 47 L259.5 19 Z"/>
  <path fill="${BROWN}" d="M70.5 157 Q120 162 195.5 181 L248.5 217 L261.5 217 Q300 192 443.5 157 Q447 200 447 245.5 Q443 262 448.5 270 Q480 292 501 330.5 L11.5 331 Q30 296 69 266.5 Q64 230 70.5 157 Z"/>
  <circle cx="181" cy="222" r="30" fill="${CREAM}"/>
  <circle cx="328" cy="225" r="28" fill="${CREAM}"/>
  <circle cx="181" cy="222" r="15" fill="${BROWN}"/>
  <circle cx="328" cy="225" r="14" fill="${BROWN}"/>
</svg>`;

export interface CompanyDetails {
  name: string;
  tagline: string;
  phone?: string;
  email: string;
  website?: string;
  address?: string;
}

export interface EmailShellInput {
  company: CompanyDetails;
  /** Small label above the heading, e.g. "Invoice" or "Estimate review". */
  eyebrow?: string;
  heading: string;
  /** Body HTML — use the helpers below rather than raw markup. */
  body: string;
  cta?: { label: string; url: string };
  footerNote?: string;
}

/**
 * Wraps body content in the branded shell.
 *
 * The outer table is 100% wide with a fixed-width inner table, which is the
 * only layout that centres reliably across Outlook, Gmail and Apple Mail.
 */
export function renderEmail(input: EmailShellInput): string {
  const { company, eyebrow, heading, body, cta, footerNote } = input;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(heading)}</title>
</head>
<body style="margin:0;padding:0;background:#f2ede4;font-family:Helvetica,Arial,sans-serif;-webkit-font-smoothing:antialiased;">
  <!-- Preheader: shown in the inbox preview, hidden in the body. -->
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;">${escapeHtml(heading)}</div>

  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f2ede4;padding:24px 12px;">
    <tr>
      <td align="center">
        <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:600px;max-width:100%;background:${CREAM};border:1px solid ${BORDER};border-radius:14px;overflow:hidden;">

          <!-- Header -->
          <tr>
            <td style="padding:26px 30px 20px;border-bottom:2px solid ${BRASS};">
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
                <tr>
                  <td width="52" valign="middle">${OWL_SVG}</td>
                  <td valign="middle" style="padding-left:12px;">
                    <div style="font-size:19px;font-weight:bold;letter-spacing:1.5px;color:${BROWN};text-transform:uppercase;">${escapeHtml(company.name)}</div>
                    <div style="font-size:9px;letter-spacing:2.4px;color:${MUTED};text-transform:uppercase;margin-top:3px;">${escapeHtml(company.tagline)}</div>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="padding:30px;">
              ${
                eyebrow
                  ? `<div style="font-size:10px;letter-spacing:2.6px;text-transform:uppercase;color:${BRASS};font-weight:bold;margin-bottom:10px;">${escapeHtml(eyebrow)}</div>`
                  : ""
              }
              <h1 style="margin:0 0 18px;font-size:23px;line-height:1.3;color:${INK};font-weight:bold;">${escapeHtml(heading)}</h1>
              <div style="font-size:15px;line-height:1.65;color:#3f3a35;">${body}</div>
              ${
                cta
                  ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:26px 0 6px;">
                      <tr><td style="background:${BROWN};border-radius:8px;">
                        <a href="${escapeAttr(cta.url)}" style="display:inline-block;padding:13px 26px;font-size:15px;font-weight:bold;color:${CREAM};text-decoration:none;">${escapeHtml(cta.label)}</a>
                      </td></tr>
                    </table>`
                  : ""
              }
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding:20px 30px 26px;border-top:1px solid ${BORDER};background:#f6f1e8;">
              ${
                footerNote
                  ? `<p style="margin:0 0 12px;font-size:12px;line-height:1.6;color:${MUTED};">${escapeHtml(footerNote)}</p>`
                  : ""
              }
              <p style="margin:0;font-size:12px;line-height:1.7;color:${MUTED};">
                ${company.address ? `${escapeHtml(company.address)}<br>` : ""}
                ${company.phone ? `${escapeHtml(company.phone)} &nbsp;·&nbsp; ` : ""}<a href="mailto:${escapeAttr(company.email)}" style="color:${BROWN};text-decoration:none;">${escapeHtml(company.email)}</a>
                ${company.website ? `<br><a href="https://${escapeAttr(company.website)}" style="color:${BROWN};text-decoration:none;">${escapeHtml(company.website)}</a>` : ""}
              </p>
            </td>
          </tr>
        </table>

        <p style="margin:16px 0 0;font-size:11px;color:#8e8781;">This message was sent by ${escapeHtml(company.name)}.</p>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

// ---------------------------------------------------------------------------
// Body helpers
// ---------------------------------------------------------------------------

export function paragraph(text: string): string {
  return `<p style="margin:0 0 14px;">${escapeHtml(text)}</p>`;
}

/** Label/value rows — used for invoice and job summaries. */
export function detailTable(rows: Array<[string, string]>): string {
  const body = rows
    .map(
      ([label, value]) =>
        `<tr>
          <td style="padding:9px 0;font-size:13px;color:${MUTED};border-bottom:1px solid ${BORDER};">${escapeHtml(label)}</td>
          <td style="padding:9px 0;font-size:14px;color:${INK};text-align:right;font-weight:bold;border-bottom:1px solid ${BORDER};">${escapeHtml(value)}</td>
        </tr>`
    )
    .join("");
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:18px 0;">${body}</table>`;
}

/** Emphasised total row. */
export function totalRow(label: string, value: string): string {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:6px 0 18px;">
    <tr>
      <td style="padding:12px 14px;background:#f0e6d6;border-radius:8px;font-size:14px;color:${BROWN};font-weight:bold;">${escapeHtml(label)}</td>
      <td style="padding:12px 14px;background:#f0e6d6;border-radius:8px;font-size:18px;color:${BROWN};text-align:right;font-weight:bold;">${escapeHtml(value)}</td>
    </tr>
  </table>`;
}

/** Callout box for a passcode or warning. */
export function calloutBox(text: string, mono = false): string {
  return `<div style="margin:18px 0;padding:14px 16px;background:#fff;border:1px dashed ${BRASS};border-radius:8px;text-align:center;">
    <span style="font-size:${mono ? "22px" : "14px"};${mono ? "letter-spacing:5px;font-family:Courier,monospace;" : ""}color:${INK};font-weight:bold;">${escapeHtml(text)}</span>
  </div>`;
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function escapeAttr(value: string): string {
  return escapeHtml(value).replace(/`/g, "&#96;");
}

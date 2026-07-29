import { OWL_MARK_PNG_DATA_URI, OWL_MARK_WIDTH, OWL_MARK_HEIGHT } from "./emailLogo";

/**
 * Branded email shell.
 *
 * Built with tables and inline styles rather than modern CSS, because Outlook
 * and several Android clients ignore flexbox, grid and `<style>` blocks. The
 * palette follows the Job Order Tracker: brown/brass on cream, "PRECISION IN
 * EVERY CUT" under the wordmark.
 *
 * Email clients strip external CSS, so every rule is on the element. They also
 * block remote images by default, so the owl mark is an inlined data URI — see
 * emailLogo.ts for why that beats both SVG and a hosted file here.
 */

const BRASS = "#dba95f";
const BROWN = "#6b4a2b";
const INK = "#1c1917";
const MUTED = "#6b6560";
const CREAM = "#faf7f2";
const BORDER = "#e6ddd0";

/**
 * Owl mark as an <img>.
 *
 * `display:block` avoids the descender gap that inline images pick up in
 * Outlook, and explicit width/height stop the layout jumping before the image
 * decodes. Width is halved from the asset's native size for retina sharpness.
 */
const OWL_IMG = `<img src="${OWL_MARK_PNG_DATA_URI}" width="${OWL_MARK_WIDTH / 2}" height="${Math.round(OWL_MARK_HEIGHT / 2)}" alt="" style="display:block;border:0;outline:none;text-decoration:none;">`;

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
                  <td width="72" valign="middle">${OWL_IMG}</td>
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

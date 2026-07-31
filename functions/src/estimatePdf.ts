import PDFDocument from "pdfkit";
import { join } from "path";
import { existsSync } from "fs";

/**
 * Server-side cost estimate PDF.
 *
 * Built on the same pdfkit approach as invoicePdf.ts, and deliberately so: that is
 * the one document path in this system proven to produce a file that actually opens
 * and prints. The HTML print sheets download blank often enough not to be trusted
 * with something a client sees.
 *
 * The layout mirrors the invoice — same brass-on-brown letterhead band, same column
 * geometry, same totals panel — because an estimate and the invoice that follows it
 * are the same conversation, and they should look like it. What differs is what the
 * document says: lines are grouped by component so a client reads "Main kitchen"
 * before its parts, the totals show the error margin and Nightowl charge as separate
 * lines against the subtotal, and the foot carries validity and acceptance rather
 * than bank details. An estimate is not a request for payment, so it does not carry
 * the means to pay one.
 *
 * The naira sign trap from invoicePdf.ts applies identically: U+20A6 is absent from
 * the standard 14 fonts and WinAnsi degrades it to a broken bar, so DejaVu Sans is
 * embedded for its glyph.
 */

// Matches SHEET in src/components/admin/print/sheetStyles.ts and the invoice PDF.
// Kept as literals rather than imported: functions/ compiles independently.
const C = {
  brown: "#5c3f22",
  brass: "#c08a3e",
  brassPale: "#f2e7d5",
  ink: "#161310",
  muted: "#6f665d",
  faint: "#a09689",
  border: "#ded3c3",
  panel: "#faf7f2",
  white: "#ffffff",
} as const;

const PAGE = { width: 595.28, height: 841.89 };
const MARGIN = 34;
const CONTENT_W = PAGE.width - MARGIN * 2;

const FONT_DIR = join(__dirname, "..", "assets", "fonts");
const REGULAR = join(FONT_DIR, "DejaVuSans.ttf");
const BOLD = join(FONT_DIR, "DejaVuSans-Bold.ttf");

export interface PdfEstimateLine {
  /** Component heading this line sits under, e.g. "Main kitchen". */
  group: string;
  item: string;
  quantity: number;
  unitPriceKobo: number;
  amountKobo: number;
}

export interface PdfEstimate {
  projectNumber: string;
  projectTitle: string;
  version: number;
  status: string;
  customerName: string;
  customerPhone?: string;
  customerAddress?: string;
  location?: string;
  lines: PdfEstimateLine[];
  subtotalKobo: number;
  errorMarginPercent: number;
  errorMarginKobo: number;
  nightowlChargesKobo: number;
  nightowlChargePercent: number;
  totalKobo: number;
  createdAtMs: number | null;
  /** How long the quoted prices hold. Timber and board prices move. */
  validUntilMs: number | null;
  notes?: string;
}

export interface PdfCompany {
  name: string;
  tagline: string;
  address?: string;
  phone?: string;
  email: string;
  website?: string;
  rcNumber?: string;
}

const STATUS_LABELS: Record<string, string> = {
  draft: "Draft",
  in_review: "In Review",
  reviewed: "Reviewed",
  approved: "Approved",
};

type Doc = PDFKit.PDFDocument;

/** Digits only; the sign is drawn by drawMoney. See invoicePdf.ts for why. */
function nairaDigits(kobo: number): string {
  return Math.round(kobo / 100).toLocaleString("en-US");
}

function drawMoney(
  doc: Doc,
  kobo: number,
  x: number,
  y: number,
  width: number,
  opts: { bold?: boolean; size?: number; color?: string } = {}
): void {
  const { bold = false, size = 8.5, color = C.ink } = opts;
  doc.font(bold ? BOLD : REGULAR).fontSize(size).fillColor(color);
  doc.text("₦" + nairaDigits(kobo), x, y, { width, align: "right", lineBreak: false });
}

function fmtDate(ms: number | null): string {
  if (!ms) return "";
  return new Date(ms).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "Africa/Lagos",
  });
}

/** Header band, full-bleed letterhead. Matches the invoice. */
function drawHeader(doc: Doc, est: PdfEstimate, company: PdfCompany): number {
  const BAND_H = 92;
  doc.rect(0, 0, PAGE.width, BAND_H).fill(C.brown);
  doc.rect(0, BAND_H, PAGE.width, 3).fill(C.brass);

  const logo = join(__dirname, "..", "assets", "owl-mark.png");
  let textX = MARGIN;
  if (existsSync(logo)) {
    try {
      doc.image(logo, MARGIN, 26, { height: 40 });
      textX = MARGIN + 62;
    } catch {
      // A missing logo must not cost the client their estimate.
    }
  }

  doc.font(BOLD).fontSize(16).fillColor(C.white);
  doc.text(company.name, textX, 30, { width: 300, lineBreak: false });
  doc.font(REGULAR).fontSize(8).fillColor(C.brass);
  doc.text(company.tagline.toUpperCase(), textX, 52, {
    width: 300,
    lineBreak: false,
    characterSpacing: 1.4,
  });

  const rightW = 220;
  const rightX = PAGE.width - MARGIN - rightW;

  doc.font(REGULAR).fontSize(8.5).fillColor(C.brass);
  doc.text("COST ESTIMATE", rightX, 26, {
    width: rightW,
    align: "right",
    characterSpacing: 3,
  });
  doc.font(BOLD).fontSize(19).fillColor(C.white);
  doc.text(est.projectNumber, rightX, 40, { width: rightW, align: "right" });

  // Version is on the chip rather than buried in the details column: an estimate
  // that has been revised twice is a different document from the first one, and the
  // client may well be holding the earlier version.
  const label = `${STATUS_LABELS[est.status] ?? est.status} · v${est.version}`;
  doc.font(BOLD).fontSize(7);
  const chipW = doc.widthOfString(label.toUpperCase(), { characterSpacing: 0.8 }) + 16;
  const chipX = PAGE.width - MARGIN - chipW;
  const chipY = 66;
  doc.roundedRect(chipX, chipY, chipW, 14, 3).lineWidth(0.8).strokeColor(C.brass).stroke();
  doc.fillColor(C.brass);
  doc.text(label.toUpperCase(), chipX, chipY + 4, {
    width: chipW,
    align: "center",
    characterSpacing: 0.8,
  });

  return BAND_H + 3 + 22;
}

function sectionHeading(doc: Doc, text: string, x: number, y: number, w: number): number {
  doc.font(BOLD).fontSize(7.5).fillColor(C.brown);
  doc.text(text.toUpperCase(), x, y, { width: w, characterSpacing: 1.1 });
  const yy = y + 11;
  doc.moveTo(x, yy).lineTo(x + w, yy).lineWidth(0.5).strokeColor(C.border).stroke();
  return yy + 7;
}

function row(doc: Doc, label: string, value: string, x: number, y: number, w: number): number {
  if (!value) return y;
  doc.font(REGULAR).fontSize(8).fillColor(C.muted);
  doc.text(label, x, y, { width: w * 0.42, lineBreak: false });
  doc.font(BOLD).fontSize(8).fillColor(C.ink);
  doc.text(value, x + w * 0.42, y, { width: w * 0.58, lineBreak: false });
  return y + 12;
}

function drawParties(doc: Doc, est: PdfEstimate, y: number): number {
  const colW = (CONTENT_W - 24) / 2;
  const rightX = MARGIN + colW + 24;

  let ly = sectionHeading(doc, "Prepared for", MARGIN, y, colW);
  doc.font(BOLD).fontSize(12).fillColor(C.ink);
  doc.text(est.customerName, MARGIN, ly, { width: colW });
  ly = doc.y + 3;
  doc.font(REGULAR).fontSize(8).fillColor(C.muted);
  for (const line of [est.customerAddress, est.customerPhone]) {
    if (!line) continue;
    doc.text(line, MARGIN, ly, { width: colW });
    ly = doc.y + 1;
  }

  let ry = sectionHeading(doc, "Project", rightX, y, colW);
  ry = row(doc, "Title", est.projectTitle, rightX, ry, colW);
  if (est.location) ry = row(doc, "Location", est.location, rightX, ry, colW);
  ry = row(doc, "Prepared", fmtDate(est.createdAtMs), rightX, ry, colW);
  if (est.validUntilMs) {
    ry = row(doc, "Valid until", fmtDate(est.validUntilMs), rightX, ry, colW);
  }

  return Math.max(ly, ry) + 10;
}

/** Column geometry, shared by the header row and the body so they cannot drift. */
const COLS = [
  { key: "n", label: "#", w: 0.06, align: "left" as const },
  { key: "desc", label: "Item", w: 0.45, align: "left" as const },
  { key: "qty", label: "Qty", w: 0.11, align: "right" as const },
  { key: "unit", label: "Unit price", w: 0.18, align: "right" as const },
  { key: "amt", label: "Amount", w: 0.2, align: "right" as const },
];

/** Reserved for totals, acceptance panel and the footer. */
const TAIL_RESERVE = 250;

/**
 * The priced lines, grouped under their component.
 *
 * Grouped rather than a flat run of items because that is how the work is sold: a
 * client approving a kitchen and two closets wants each one's cost, and a flat list
 * of eighty parts hides exactly the figure they would ask for. Each group carries
 * its own subtotal for that reason.
 *
 * Numbering restarts within each group, so "item 4 of the kitchen" is a thing that
 * can be said on the phone.
 */
function drawLines(doc: Doc, est: PdfEstimate, startY: number): number {
  let y = sectionHeading(doc, "Scope and costs", MARGIN, startY, CONTENT_W);

  const xs: number[] = [];
  let acc = MARGIN;
  for (const c of COLS) {
    xs.push(acc);
    acc += c.w * CONTENT_W;
  }

  const drawHeadRow = (yy: number): number => {
    doc.rect(MARGIN, yy, CONTENT_W, 16).fill(C.panel);
    doc.font(BOLD).fontSize(7.5).fillColor(C.brown);
    COLS.forEach((c, i) => {
      doc.text(c.label, xs[i] + 4, yy + 5, {
        width: c.w * CONTENT_W - 8,
        align: c.align,
        lineBreak: false,
      });
    });
    return yy + 16;
  };

  const breakIfNeeded = (yy: number, needed: number): number => {
    if (yy + needed <= PAGE.height - MARGIN - TAIL_RESERVE) return yy;
    doc.addPage();
    return drawHeadRow(MARGIN);
  };

  y = drawHeadRow(y);

  // Preserves the order the lines arrive in, which is the component order the
  // estimator built. Sorting alphabetically would scramble a deliberate sequence.
  const groups: Array<{ name: string; lines: PdfEstimateLine[] }> = [];
  for (const line of est.lines) {
    const last = groups[groups.length - 1];
    if (last && last.name === line.group) last.lines.push(line);
    else groups.push({ name: line.group, lines: [line] });
  }

  for (const group of groups) {
    // A heading stranded at the foot of a page with its items overleaf is worse
    // than a slightly short page, so it breaks with at least one row of company.
    y = breakIfNeeded(y, 34);

    doc.rect(MARGIN, y, CONTENT_W, 17).fill(C.brassPale);
    doc.font(BOLD).fontSize(8.5).fillColor(C.brown);
    doc.text(group.name, xs[0] + 4, y + 5, {
      width: CONTENT_W * 0.7,
      lineBreak: false,
    });
    const groupTotal = group.lines.reduce((sum, l) => sum + l.amountKobo, 0);
    drawMoney(doc, groupTotal, MARGIN + CONTENT_W * 0.7, y + 5, CONTENT_W * 0.3 - 6, {
      bold: true,
      color: C.brown,
    });
    y += 17;

    group.lines.forEach((line, i) => {
      y = breakIfNeeded(y, 18);

      doc.font(REGULAR).fontSize(8.5).fillColor(C.ink);
      const descW = COLS[1].w * CONTENT_W - 8;
      const descH = doc.heightOfString(line.item, { width: descW });
      const rowH = Math.max(15, descH + 7);

      // Zebra banding lets the eye track a description to its amount.
      if (i % 2 === 1) doc.rect(MARGIN, y, CONTENT_W, rowH).fill(C.panel);

      doc.font(REGULAR).fontSize(8.5).fillColor(C.faint);
      doc.text(String(i + 1), xs[0] + 4, y + 5, {
        width: COLS[0].w * CONTENT_W - 8,
        lineBreak: false,
      });
      doc.fillColor(C.ink);
      doc.text(line.item, xs[1] + 4, y + 5, { width: descW });
      doc.text(String(line.quantity), xs[2] + 4, y + 5, {
        width: COLS[2].w * CONTENT_W - 8,
        align: "right",
        lineBreak: false,
      });
      drawMoney(doc, line.unitPriceKobo, xs[3] + 6, y + 5, COLS[3].w * CONTENT_W - 12, {
        color: C.muted,
      });
      drawMoney(doc, line.amountKobo, xs[4] + 6, y + 5, COLS[4].w * CONTENT_W - 12, {
        bold: true,
      });

      y += rowH;
      doc
        .moveTo(MARGIN, y)
        .lineTo(MARGIN + CONTENT_W, y)
        .lineWidth(0.4)
        .strokeColor(C.border)
        .stroke();
    });
  }

  if (groups.length === 0) {
    doc.font(REGULAR).fontSize(8.5).fillColor(C.muted);
    doc.text("No items have been included on this estimate yet.", MARGIN + 4, y + 6, {
      width: CONTENT_W - 8,
    });
    y += 22;
  }

  return y + 10;
}

/**
 * Subtotal, margin, charge and total.
 *
 * The two percentages are shown as their own lines against the subtotal rather than
 * folded into it. They apply to the subtotal only and never compound — the same rule
 * computeEstimateTotals enforces — and a client who can see both figures can ask
 * about them, which is better than a total nobody can account for.
 */
function drawTotals(doc: Doc, est: PdfEstimate, y: number): number {
  const boxW = 250;
  const x = MARGIN + CONTENT_W - boxW;
  const PAD = 12;

  const entries: Array<[string, number]> = [["Materials & labour", est.subtotalKobo]];
  if (est.errorMarginKobo > 0) {
    entries.push([`Error margin (${est.errorMarginPercent}%)`, est.errorMarginKobo]);
  }
  if (est.nightowlChargesKobo > 0) {
    entries.push([
      `Nightowl charge (${est.nightowlChargePercent}%)`,
      est.nightowlChargesKobo,
    ]);
  }

  const top = y + 10;
  const rowsH = entries.length * 15;
  const dueH = 34;

  doc.rect(x, top, boxW, rowsH + PAD).fill(C.panel);
  doc.rect(x, top, 2.5, rowsH + PAD).fill(C.brass);

  let yy = top + PAD * 0.5;
  for (const [label, value] of entries) {
    doc
      .font(REGULAR)
      .fontSize(8.5)
      .fillColor(C.muted)
      .text(label, x + PAD, yy, { width: boxW * 0.55, lineBreak: false });
    drawMoney(doc, value, x + boxW * 0.55, yy, boxW * 0.45 - PAD, { color: C.muted });
    yy += 15;
  }

  const totalY = top + rowsH + PAD;
  doc.rect(x, totalY, boxW, dueH).fill(C.brown);
  doc.font(BOLD).fontSize(9).fillColor(C.brass);
  doc.text("ESTIMATE TOTAL", x + PAD, totalY + 14, {
    width: boxW * 0.42,
    lineBreak: false,
    characterSpacing: 1.2,
  });
  drawMoney(doc, est.totalKobo, x + boxW * 0.42, totalY + 10, boxW * 0.58 - PAD, {
    bold: true,
    size: 14,
    color: C.white,
  });

  return totalY + dueH + 18;
}

/**
 * Validity terms and the acceptance block.
 *
 * Where the invoice puts bank details, an estimate puts what the client has to do
 * next. Pinned to the foot of the page for the same reason as the invoice panel: a
 * short estimate and a long one should both look composed rather than truncated.
 *
 * A signature line is not decoration. An approved estimate becomes the contract
 * value in this system, and a countersigned copy is what makes that defensible.
 */
function drawFooterBlocks(doc: Doc, est: PdfEstimate, y: number): number {
  const PANEL_H = 96;
  const footerTop = PAGE.height - MARGIN - 26;
  const top = Math.max(y, footerTop - PANEL_H);

  const PAD = 14;
  const colW = (CONTENT_W - PAD * 3) / 2;
  const leftX = MARGIN + PAD;
  const rightX = MARGIN + PAD * 2 + colW;

  doc
    .roundedRect(MARGIN, top, CONTENT_W, PANEL_H, 4)
    .lineWidth(0.6)
    .strokeColor(C.border)
    .stroke();

  let ly = top + PAD;
  doc.font(BOLD).fontSize(7.5).fillColor(C.brown);
  doc.text("TERMS", leftX, ly, { width: colW, characterSpacing: 1.1 });
  ly += 13;
  doc.font(REGULAR).fontSize(7.2).fillColor(C.muted);
  const terms = [
    est.validUntilMs
      ? `Prices hold until ${fmtDate(est.validUntilMs)}. Board and timber prices move, so a later start may need requoting.`
      : "Board and timber prices move; ask us to confirm before work is scheduled.",
    "This is an estimate, not an invoice. No payment is due on it.",
    "Work begins once this estimate is accepted in writing.",
  ];
  for (const t of terms) {
    doc.text("· " + t, leftX, ly, { width: colW });
    ly = doc.y + 2;
  }

  let ry = top + PAD;
  doc.font(BOLD).fontSize(7.5).fillColor(C.brown);
  doc.text("ACCEPTED BY", rightX, ry, { width: colW, characterSpacing: 1.1 });
  ry += 15;
  for (const label of ["Name", "Signature", "Date"]) {
    doc.font(REGULAR).fontSize(7.5).fillColor(C.muted);
    doc.text(label, rightX, ry, { width: 48, lineBreak: false });
    doc
      .moveTo(rightX + 50, ry + 8)
      .lineTo(rightX + colW, ry + 8)
      .lineWidth(0.5)
      .strokeColor(C.border)
      .stroke();
    ry += 19;
  }

  return top + PANEL_H + 10;
}

/**
 * Renders the estimate and resolves to the finished PDF bytes.
 *
 * Buffered rather than streamed: the caller either returns it as base64 or attaches
 * it to an email, and both need the whole document.
 */
export function renderEstimatePdf(
  est: PdfEstimate,
  company: PdfCompany
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({
        size: "A4",
        margin: MARGIN,
        bufferPages: true,
        info: {
          Title: `Cost estimate ${est.projectNumber} v${est.version}`,
          Author: company.name,
          Subject: `Cost estimate for ${est.customerName}: ${est.projectTitle}`,
        },
      });

      const chunks: Buffer[] = [];
      doc.on("data", (c: Buffer) => chunks.push(c));
      doc.on("end", () => resolve(Buffer.concat(chunks)));
      doc.on("error", reject);

      doc.registerFont("body", REGULAR);
      doc.registerFont("bodyBold", BOLD);

      let y = drawHeader(doc, est, company);
      y = drawParties(doc, est, y);
      y = drawLines(doc, est, y);

      // Totals and the terms belong together; push both to a new page rather than
      // splitting the figure from the conditions attached to it.
      if (y > PAGE.height - MARGIN - 260) {
        doc.addPage();
        y = MARGIN;
      }
      y = drawTotals(doc, est, y);

      if (est.notes) {
        doc.font(BOLD).fontSize(7.5).fillColor(C.brown);
        doc.text("NOTES", MARGIN, y, { width: CONTENT_W, characterSpacing: 1.1 });
        doc.font(REGULAR).fontSize(8).fillColor(C.muted);
        doc.text(est.notes, MARGIN, y + 13, { width: CONTENT_W * 0.62 });
        y = doc.y + 12;
      }

      drawFooterBlocks(doc, est, y);

      // Footer on every page, so a detached sheet is still identifiable.
      const range = doc.bufferedPageRange();
      for (let i = 0; i < range.count; i++) {
        doc.switchToPage(range.start + i);
        const fy = PAGE.height - MARGIN - 12;
        doc
          .moveTo(MARGIN, fy)
          .lineTo(MARGIN + CONTENT_W, fy)
          .lineWidth(0.5)
          .strokeColor(C.border)
          .stroke();
        doc.font(REGULAR).fontSize(6.5).fillColor(C.faint);
        const left =
          company.name +
          (company.rcNumber ? ` · RC ${company.rcNumber}` : "") +
          (company.phone ? ` · ${company.phone}` : "") +
          ` · ${company.email}`;
        doc.text(left, MARGIN, fy + 4, { width: CONTENT_W * 0.7, lineBreak: false });
        doc.text(
          `${est.projectNumber} v${est.version}   ${i + 1}/${range.count}`,
          MARGIN + CONTENT_W * 0.7,
          fy + 4,
          { width: CONTENT_W * 0.3, align: "right", lineBreak: false }
        );
      }

      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}

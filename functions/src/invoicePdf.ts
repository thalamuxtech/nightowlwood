import PDFDocument from "pdfkit";
import { join } from "path";
import { existsSync } from "fs";

/**
 * Server-side invoice PDF.
 *
 * Drawn with pdfkit rather than by printing HTML in a headless browser. Chromium
 * would let the existing print sheet be reused verbatim, but it adds roughly
 * 300MB to the deployment and turns a sub-second call into a 5-10 second cold
 * start. An invoice is a fixed, known layout, so the browser buys very little
 * here and costs a great deal.
 *
 * The layout deliberately mirrors InvoiceSheet.tsx: same brass-on-brown header
 * band, same column order, same PAID stamp. A customer who receives the emailed
 * PDF and later sees a printed copy should not notice they came from different
 * code.
 *
 * The naira sign is the one real trap. U+20A6 is absent from the PDF standard 14
 * fonts, and WinAnsi silently truncates it to 0xA6, the broken bar, so every
 * amount would print as "¦ 250,000" instead of "₦ 250,000". Verified by reading
 * the encoded bytes, not by trusting the absence of an error. DejaVu Sans is
 * embedded because it carries the glyph and its licence permits redistribution.
 */

// Matches SHEET in src/components/admin/print/sheetStyles.ts. Kept as literals
// rather than imported: functions/ compiles independently of the Next app.
const C = {
  brown: "#5c3f22",
  brass: "#c08a3e",
  brassPale: "#f2e7d5",
  ink: "#161310",
  muted: "#6f665d",
  faint: "#a09689",
  border: "#ded3c3",
  panel: "#faf7f2",
  late: "#9c3d2a",
  white: "#ffffff",
} as const;

/** A4 in PostScript points, with the same 12mm margin the print sheet uses. */
const PAGE = { width: 595.28, height: 841.89 };
const MARGIN = 34;
const CONTENT_W = PAGE.width - MARGIN * 2;

const FONT_DIR = join(__dirname, "..", "assets", "fonts");
const REGULAR = join(FONT_DIR, "DejaVuSans.ttf");
const BOLD = join(FONT_DIR, "DejaVuSans-Bold.ttf");

export interface PdfInvoiceLine {
  description: string;
  quantity: number;
  unitPriceKobo: number;
  amountKobo: number;
}

export interface PdfInvoice {
  invoiceNumber: string;
  type: "service" | "project" | "standalone";
  customerName: string;
  customerPhone?: string;
  customerAddress?: string;
  reference?: string;
  lines: PdfInvoiceLine[];
  subtotalKobo: number;
  discountPercent?: number;
  discountKobo?: number;
  /** Decides whether the tax line adds to the total or sits inside it. */
  taxMode?: "none" | "exclusive" | "inclusive";
  taxPercent?: number;
  taxKobo: number;
  taxLabel?: string;
  /*
   * Commission is deliberately absent, matching the on-screen sheet: it is a cost to
   * the business rather than a charge to the customer, and it must not appear on the
   * document the customer receives.
   */
  totalKobo: number;
  amountPaidKobo: number;
  balanceKobo: number;
  status: string;
  issuedAtMs: number | null;
  dueAtMs: number | null;
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
  bankName?: string;
  bankAccountName?: string;
  bankAccountNumber?: string;
}

const STATUS_LABELS: Record<string, string> = {
  draft: "Draft",
  sent: "Sent",
  partial: "Part Paid",
  paid: "Paid",
  void: "Void",
};

/**
 * The digits of an amount, without the currency sign.
 *
 * Intl is not used for the symbol: its output for NGN varies by ICU build (some
 * emit "NGN", some "₦"), and an invoice cannot look different depending on which
 * runtime rendered it. The sign is drawn separately by drawMoney.
 */
function nairaDigits(kobo: number): string {
  return Math.round(kobo / 100).toLocaleString("en-US");
}

/**
 * Writes an amount right-aligned, with the sign kept against its digits.
 *
 * An earlier attempt pinned the ₦ to the left of the column and the digits to the
 * right to get a perfect column of numerals. It read badly: on a wide column the
 * sign ends up stranded an inch from the number it belongs to. Keeping them
 * together and right-aligning the pair is what printed invoices actually do, and
 * the digits still line up closely enough to scan because the sign is a fixed
 * width in this font.
 */
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
  doc.text("₦" + nairaDigits(kobo), x, y, {
    width,
    align: "right",
    lineBreak: false,
  });
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

type Doc = PDFKit.PDFDocument;

/**
 * Header band, bled to the paper edges.
 *
 * Full-bleed rather than inset within the margin: a band that stops short on three
 * sides reads as a box sitting on the page, whereas one that runs to the edges reads
 * as letterhead. It also gives the mark room to be seen at a glance, which a 28pt
 * logo inside a margin did not.
 */
function drawHeader(doc: Doc, invoice: PdfInvoice, company: PdfCompany): number {
  const BAND_H = 92;
  doc.rect(0, 0, PAGE.width, BAND_H).fill(C.brown);
  // The brass rule under the band is what makes it read as letterhead rather
  // than a block of colour.
  doc.rect(0, BAND_H, PAGE.width, 3).fill(C.brass);

  const logo = join(__dirname, "..", "assets", "owl-mark.png");
  let textX = MARGIN;
  if (existsSync(logo)) {
    try {
      doc.image(logo, MARGIN, 26, { height: 40 });
      textX = MARGIN + 62;
    } catch {
      // A missing or unreadable logo must not cost the customer their invoice.
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

  const overdue =
    invoice.balanceKobo > 0 && invoice.dueAtMs !== null && invoice.dueAtMs < Date.now();
  const rightW = 200;
  const rightX = PAGE.width - MARGIN - rightW;

  doc.font(REGULAR).fontSize(8.5).fillColor(C.brass);
  doc.text("INVOICE", rightX, 26, {
    width: rightW,
    align: "right",
    characterSpacing: 3.5,
  });
  doc.font(BOLD).fontSize(19).fillColor(C.white);
  doc.text(invoice.invoiceNumber, rightX, 40, { width: rightW, align: "right" });

  const label = overdue ? "OVERDUE" : (STATUS_LABELS[invoice.status] ?? invoice.status);
  doc.font(BOLD).fontSize(7);
  const chipW = doc.widthOfString(label.toUpperCase(), { characterSpacing: 0.8 }) + 16;
  const chipX = PAGE.width - MARGIN - chipW;
  const chipY = 66;
  // Filled for an overdue invoice rather than outlined: it is the one state that
  // should be impossible to miss on a glance across a desk.
  if (overdue) {
    doc.roundedRect(chipX, chipY, chipW, 14, 3).fill(C.late);
    doc.fillColor(C.white);
  } else {
    doc.roundedRect(chipX, chipY, chipW, 14, 3).lineWidth(0.8).strokeColor(C.brass).stroke();
    doc.fillColor(C.brass);
  }
  doc.text(label.toUpperCase(), chipX, chipY + 4, {
    width: chipW,
    align: "center",
    characterSpacing: 0.8,
  });

  return BAND_H + 3 + 22;
}

/** Small caps-ish section heading with a hairline under it. */
function sectionHeading(doc: Doc, text: string, x: number, y: number, w: number): number {
  doc.font(BOLD).fontSize(7.5).fillColor(C.brown);
  doc.text(text.toUpperCase(), x, y, { width: w, characterSpacing: 1.1 });
  const yy = y + 11;
  doc.moveTo(x, yy).lineTo(x + w, yy).lineWidth(0.5).strokeColor(C.border).stroke();
  return yy + 7;
}

/** Label/value pair, label muted and value in ink. */
function row(doc: Doc, label: string, value: string, x: number, y: number, w: number): number {
  if (!value) return y;
  doc.font(REGULAR).fontSize(8).fillColor(C.muted);
  doc.text(label, x, y, { width: w * 0.42, lineBreak: false });
  doc.font(BOLD).fontSize(8).fillColor(C.ink);
  doc.text(value, x + w * 0.42, y, { width: w * 0.58, lineBreak: false });
  return y + 12;
}

function drawParties(doc: Doc, invoice: PdfInvoice, y: number): number {
  const colW = (CONTENT_W - 24) / 2;
  const rightX = MARGIN + colW + 24;

  let ly = sectionHeading(doc, "Billed to", MARGIN, y, colW);
  // Larger than the surrounding body text: on a document that gets filed by
  // client, the client's name is what someone scans for.
  doc.font(BOLD).fontSize(12).fillColor(C.ink);
  doc.text(invoice.customerName, MARGIN, ly, { width: colW });
  ly = doc.y + 3;
  doc.font(REGULAR).fontSize(8).fillColor(C.muted);
  for (const line of [invoice.customerAddress, invoice.customerPhone]) {
    if (!line) continue;
    doc.text(line, MARGIN, ly, { width: colW });
    ly = doc.y + 1;
  }

  let ry = sectionHeading(doc, "Details", rightX, y, colW);
  ry = row(doc, "Issued", fmtDate(invoice.issuedAtMs), rightX, ry, colW);
  ry = row(doc, "Due", fmtDate(invoice.dueAtMs), rightX, ry, colW);
  ry = row(
    doc,
    "For",
    invoice.type === "service" ? "Service work" : "Project work",
    rightX,
    ry,
    colW
  );
  if (invoice.reference) ry = row(doc, "Reference", invoice.reference, rightX, ry, colW);

  return Math.max(ly, ry) + 10;
}

/** Column geometry, shared by the header row and the body so they cannot drift. */
const COLS = [
  { key: "n", label: "#", w: 0.06, align: "left" as const },
  { key: "desc", label: "Description", w: 0.45, align: "left" as const },
  { key: "qty", label: "Qty", w: 0.11, align: "right" as const },
  { key: "unit", label: "Unit price", w: 0.18, align: "right" as const },
  { key: "amt", label: "Amount", w: 0.2, align: "right" as const },
];

/**
 * Blank rows drawn beneath a short item list.
 *
 * Twelve rather than four. The payment panel is pinned to the foot of the page, so
 * a four-line invoice left a hand's width of empty paper between the notes and that
 * panel, which reads as a document that was truncated. Ruled blank rows fill the
 * space the way a paper invoice book does, and they also stop anyone adding a line
 * by hand after the fact without it being obvious.
 */
const MIN_LINES = 12;
/** Reserved for totals, payment details and the footer. */
const TAIL_RESERVE = 250;

function drawLines(doc: Doc, invoice: PdfInvoice, startY: number): number {
  let y = sectionHeading(doc, "Items", MARGIN, startY, CONTENT_W);

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

  y = drawHeadRow(y);

  const blanks = Math.max(0, MIN_LINES - invoice.lines.length);
  const rows: Array<PdfInvoiceLine | null> = [
    ...invoice.lines,
    ...Array.from({ length: blanks }, () => null),
  ];

  rows.forEach((line, i) => {
    // A long item list must continue onto a second page rather than run off the
    // first: an invoice that silently loses lines is worse than a two-page one.
    if (y > PAGE.height - MARGIN - TAIL_RESERVE) {
      doc.addPage();
      y = MARGIN;
      y = drawHeadRow(y);
    }

    doc.font(REGULAR).fontSize(8.5).fillColor(C.ink);
    const desc = line?.description ?? "";
    const descH = line
      ? doc.heightOfString(desc, { width: COLS[1].w * CONTENT_W - 8 })
      : 0;
    const rowH = Math.max(15, descH + 7);

    // Zebra banding on alternate rows. Across a long item list this is what lets
    // the eye track a description to its amount without a ruler.
    if (line && i % 2 === 1) {
      doc.rect(MARGIN, y, CONTENT_W, rowH).fill(C.panel);
    }

    doc.font(REGULAR).fontSize(8.5);
    if (line) {
      doc.fillColor(C.faint);
      doc.text(String(i + 1), xs[0] + 4, y + 5, {
        width: COLS[0].w * CONTENT_W - 8,
        lineBreak: false,
      });
      doc.fillColor(C.ink);
      doc.text(desc, xs[1] + 4, y + 5, { width: COLS[1].w * CONTENT_W - 8 });
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
    } else {
      doc.fillColor(C.faint);
      doc.text(String(i + 1), xs[0] + 4, y + 5, {
        width: COLS[0].w * CONTENT_W - 8,
        lineBreak: false,
      });
    }

    y += rowH;
    doc.moveTo(MARGIN, y).lineTo(MARGIN + CONTENT_W, y).lineWidth(0.4).strokeColor(C.border).stroke();
  });

  return y + 10;
}

function drawTotals(doc: Doc, invoice: PdfInvoice, y: number): number {
  const boxW = 250;
  const x = MARGIN + CONTENT_W - boxW;
  const settled = invoice.balanceKobo <= 0 && invoice.totalKobo > 0;
  const PAD = 12;

  const entries: Array<[string, number]> = [["Subtotal", invoice.subtotalKobo]];
  // A discount the customer was given has to appear, or the document cannot explain
  // why the total is lower than the lines add up to.
  if ((invoice.discountKobo ?? 0) > 0) {
    // "Less" carries the sign, matching how the paid row reads: the amount column is
    // drawn as an absolute value, so a bare minus would be lost.
    const label =
      "Less discount" +
      (invoice.discountPercent ? ` (${invoice.discountPercent}%)` : "");
    entries.push([label, -(invoice.discountKobo ?? 0)]);
  }
  if (invoice.taxKobo > 0) {
    const label =
      (invoice.taxLabel ?? "Tax") +
      (invoice.taxPercent ? ` (${invoice.taxPercent}%)` : "") +
      // Marked, because an inclusive figure is part of the total rather than added
      // to it, and a reader tallying the column would otherwise find it short.
      (invoice.taxMode === "inclusive" ? " incl." : "");
    entries.push([label, invoice.taxKobo]);
  }
  entries.push(["Total", invoice.totalKobo]);
  if (invoice.amountPaidKobo > 0) {
    entries.push(["Less paid", -invoice.amountPaidKobo]);
  }

  // Clear of the last item row, so the totals read as a summary of the table
  // rather than another line in it.
  const top = y + 10;
  const rowsH = entries.length * 15;
  const dueH = 34;

  // A tinted panel groups the working figures, and the amount due sits in solid
  // brown beneath it. Previously both were loose text and the one number the
  // recipient is looking for had no more weight than the subtotal.
  doc.rect(x, top, boxW, rowsH + PAD).fill(C.panel);
  doc.rect(x, top, 2.5, rowsH + PAD).fill(C.brass);

  let yy = top + PAD * 0.5;
  for (const [label, value] of entries) {
    const isTotal = label === "Total";
    doc
      .font(isTotal ? BOLD : REGULAR)
      .fontSize(8.5)
      .fillColor(isTotal ? C.ink : C.muted)
      .text(label, x + PAD, yy, { width: boxW * 0.5, lineBreak: false });
    drawMoney(doc, Math.abs(value), x + boxW * 0.5, yy, boxW * 0.5 - PAD, {
      bold: isTotal,
      color: isTotal ? C.ink : C.muted,
    });
    yy += 15;
  }

  const dueY = top + rowsH + PAD;
  doc.rect(x, dueY, boxW, dueH).fill(C.brown);
  doc.font(BOLD).fontSize(9).fillColor(C.brass);
  doc.text(settled ? "PAID IN FULL" : "AMOUNT DUE", x + PAD, dueY + 14, {
    width: boxW * 0.4,
    lineBreak: false,
    characterSpacing: 1.2,
  });
  // A settled invoice shows what was paid, not the zero balance. "Paid in full:
  // ₦0" is technically the outstanding figure but reads as though nothing was
  // ever charged, which is the opposite of what the document is confirming.
  drawMoney(
    doc,
    settled ? invoice.totalKobo : invoice.balanceKobo,
    x + boxW * 0.4,
    dueY + 10,
    boxW * 0.6 - PAD,
    { bold: true, size: 14, color: C.white }
  );

  return dueY + dueH + 18;
}

/**
 * Payment details and the signature block, as a single panel.
 *
 * Anchored to the foot of the page rather than left to follow the totals. On a
 * short invoice the old flow left this floating mid-page with a hand's width of
 * blank paper beneath it, which reads as a document that was cut off. Pinning it
 * low means a two-line invoice and a twenty-line one both look composed.
 */
function drawFooterBlocks(
  doc: Doc,
  invoice: PdfInvoice,
  company: PdfCompany,
  y: number
): number {
  const PANEL_H = 96;
  const footerTop = PAGE.height - MARGIN - 26;
  // Sits at the foot unless the items have already run down that far, in which
  // case it follows them and the page breaks naturally.
  const top = Math.max(y, footerTop - PANEL_H);

  const PAD = 14;
  const colW = (CONTENT_W - PAD * 3) / 2;
  const leftX = MARGIN + PAD;
  const rightX = MARGIN + PAD * 2 + colW;
  const hasBank = company.bankName || company.bankAccountName || company.bankAccountNumber;

  doc
    .roundedRect(MARGIN, top, CONTENT_W, PANEL_H, 4)
    .lineWidth(0.6)
    .strokeColor(C.border)
    .stroke();

  let ly = top + PAD;
  if (hasBank) {
    doc.font(BOLD).fontSize(7.5).fillColor(C.brown);
    doc.text("PAYMENT DETAILS", leftX, ly, { width: colW, characterSpacing: 1.1 });
    ly += 13;
    ly = row(doc, "Bank", company.bankName ?? "", leftX, ly, colW);
    ly = row(doc, "Account name", company.bankAccountName ?? "", leftX, ly, colW);
    ly = row(doc, "Account no.", company.bankAccountNumber ?? "", leftX, ly, colW);
    doc.font(REGULAR).fontSize(6.8).fillColor(C.faint);
    doc.text(`Quote ${invoice.invoiceNumber} on the transfer.`, leftX, ly + 1, {
      width: colW,
    });
  }

  // Signature block: a PDF that reaches a site office often gets printed and
  // signed on delivery.
  let ry = top + PAD;
  doc.font(BOLD).fontSize(7.5).fillColor(C.brown);
  doc.text("RECEIVED BY", rightX, ry, { width: colW, characterSpacing: 1.1 });
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
 * Drawn last so it sits over the content, like a real rubber stamp.
 *
 * Centred by measuring the string and placing it, rather than by handing pdfkit a
 * full-page width with align:"center". Under a rotation the text box is measured
 * in the rotated frame, and character spacing is added after the centring, so the
 * combination drifts left of the page by several centimetres.
 */
function drawPaidStamp(doc: Doc): void {
  const SIZE = 62;
  const SPACING = 6;
  const cx = PAGE.width / 2;
  const cy = PAGE.height * 0.44;

  doc.save();
  doc.rotate(-18, { origin: [cx, cy] });
  doc.font(BOLD).fontSize(SIZE).fillColor(C.brass).opacity(0.12);

  const label = "PAID";
  // widthOfString excludes the trailing letter's added spacing, so the visual
  // width is the measured width plus one gap per inter-letter position.
  const w = doc.widthOfString(label, { characterSpacing: SPACING });
  doc.text(label, cx - w / 2, cy - SIZE * 0.62, {
    lineBreak: false,
    characterSpacing: SPACING,
  });

  doc.opacity(1).restore();
}

/**
 * Renders the invoice and resolves to the finished PDF bytes.
 *
 * Buffered rather than streamed because the caller either attaches it to an email
 * or returns it as base64; both need the whole document anyway.
 */
export function renderInvoicePdf(
  invoice: PdfInvoice,
  company: PdfCompany
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({
        size: "A4",
        margin: MARGIN,
        bufferPages: true,
        info: {
          Title: `Invoice ${invoice.invoiceNumber}`,
          Author: company.name,
          Subject: `Invoice ${invoice.invoiceNumber} for ${invoice.customerName}`,
        },
      });

      const chunks: Buffer[] = [];
      doc.on("data", (c: Buffer) => chunks.push(c));
      doc.on("end", () => resolve(Buffer.concat(chunks)));
      doc.on("error", reject);

      doc.registerFont("body", REGULAR);
      doc.registerFont("bodyBold", BOLD);

      const settled = invoice.balanceKobo <= 0 && invoice.totalKobo > 0;

      // Behind the content, matching the print sheet's z-index: 0. Drawn over the
      // top it dulls the amount-due block, and no figure on an invoice should be
      // harder to read than it needs to be.
      if (settled) drawPaidStamp(doc);

      let y = drawHeader(doc, invoice, company);
      y = drawParties(doc, invoice, y);
      y = drawLines(doc, invoice, y);

      // Totals and the payment block belong together; push them to a new page
      // rather than splitting the amount due away from how to pay it.
      if (y > PAGE.height - MARGIN - 260) {
        doc.addPage();
        y = MARGIN;
      }
      y = drawTotals(doc, invoice, y);

      // Notes come before the payment panel, because that panel is pinned to the
      // foot of the page and anything after it would be printed on top of it.
      if (invoice.notes) {
        doc.font(BOLD).fontSize(7.5).fillColor(C.brown);
        doc.text("NOTES", MARGIN, y, { width: CONTENT_W, characterSpacing: 1.1 });
        doc.font(REGULAR).fontSize(8).fillColor(C.muted);
        doc.text(invoice.notes, MARGIN, y + 13, { width: CONTENT_W * 0.62 });
        y = doc.y + 12;
      }

      drawFooterBlocks(doc, invoice, company, y);

      // Footer on every page, so a detached second sheet is still identifiable.
      const range = doc.bufferedPageRange();
      for (let i = 0; i < range.count; i++) {
        doc.switchToPage(range.start + i);
        const fy = PAGE.height - MARGIN - 12;
        doc.moveTo(MARGIN, fy).lineTo(MARGIN + CONTENT_W, fy).lineWidth(0.5).strokeColor(C.border).stroke();
        doc.font(REGULAR).fontSize(6.5).fillColor(C.faint);
        const left =
          company.name +
          (company.rcNumber ? ` · RC ${company.rcNumber}` : "") +
          (company.phone ? ` · ${company.phone}` : "") +
          ` · ${company.email}`;
        doc.text(left, MARGIN, fy + 4, { width: CONTENT_W * 0.7, lineBreak: false });
        doc.text(
          `${invoice.invoiceNumber}   ${i + 1}/${range.count}`,
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

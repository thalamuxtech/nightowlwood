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
  type: "service" | "project";
  customerName: string;
  customerPhone?: string;
  customerAddress?: string;
  reference?: string;
  lines: PdfInvoiceLine[];
  subtotalKobo: number;
  taxPercent?: number;
  taxKobo: number;
  taxLabel?: string;
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
 * Money, formatted for print.
 *
 * Intl is not used for the symbol: its output for NGN varies by ICU build (some
 * emit "NGN", some "₦"), and an invoice cannot look different depending on which
 * runtime rendered it. The sign is written explicitly.
 */
function naira(kobo: number): string {
  const whole = Math.round(kobo / 100);
  return "₦" + whole.toLocaleString("en-US");
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

/** Header band: logo and company on the left, document identity on the right. */
function drawHeader(doc: Doc, invoice: PdfInvoice, company: PdfCompany): number {
  const BAND_H = 58;
  doc.rect(MARGIN, MARGIN, CONTENT_W, BAND_H).fill(C.brown);
  // The brass rule under the band is what makes it read as letterhead rather
  // than a block of colour.
  doc.rect(MARGIN, MARGIN + BAND_H, CONTENT_W, 2.5).fill(C.brass);

  const logo = join(__dirname, "..", "assets", "owl-mark.png");
  let textX = MARGIN + 14;
  if (existsSync(logo)) {
    try {
      doc.image(logo, MARGIN + 14, MARGIN + 15, { height: 28 });
      textX = MARGIN + 14 + 44;
    } catch {
      // A missing or unreadable logo must not cost the customer their invoice.
    }
  }

  doc.font(BOLD).fontSize(13).fillColor(C.white);
  doc.text(company.name, textX, MARGIN + 16, { width: 300, lineBreak: false });
  doc.font(REGULAR).fontSize(7.5).fillColor(C.brassPale);
  doc.text(company.tagline, textX, MARGIN + 34, { width: 300, lineBreak: false });

  const overdue =
    invoice.balanceKobo > 0 && invoice.dueAtMs !== null && invoice.dueAtMs < Date.now();
  const rightW = 170;
  const rightX = MARGIN + CONTENT_W - rightW - 14;

  doc.font(REGULAR).fontSize(8).fillColor(C.brassPale);
  doc.text("INVOICE", rightX, MARGIN + 13, {
    width: rightW,
    align: "right",
    characterSpacing: 2,
  });
  doc.font(BOLD).fontSize(14).fillColor(C.white);
  doc.text(invoice.invoiceNumber, rightX, MARGIN + 26, { width: rightW, align: "right" });

  const label = overdue ? "OVERDUE" : (STATUS_LABELS[invoice.status] ?? invoice.status);
  doc.font(BOLD).fontSize(7);
  const chipW = doc.widthOfString(label) + 12;
  const chipX = MARGIN + CONTENT_W - 14 - chipW;
  const chipY = MARGIN + 44;
  doc
    .roundedRect(chipX, chipY, chipW, 12, 2)
    .lineWidth(0.7)
    .strokeColor(overdue ? C.late : C.brass)
    .stroke();
  doc.fillColor(overdue ? "#ffd9cf" : C.brassPale);
  doc.text(label, chipX, chipY + 3.2, { width: chipW, align: "center" });

  return MARGIN + BAND_H + 2.5 + 18;
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
  doc.font(BOLD).fontSize(10.5).fillColor(C.ink);
  doc.text(invoice.customerName, MARGIN, ly, { width: colW });
  ly = doc.y + 2;
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

const MIN_LINES = 4;
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

    const cells = line
      ? [
          String(i + 1),
          desc,
          String(line.quantity),
          naira(line.unitPriceKobo),
          naira(line.amountKobo),
        ]
      : [String(i + 1), "", "", "", ""];

    COLS.forEach((c, ci) => {
      doc.fillColor(ci === 0 ? C.faint : C.ink);
      doc.text(cells[ci], xs[ci] + 4, y + 4, {
        width: c.w * CONTENT_W - 8,
        align: c.align,
      });
    });

    y += rowH;
    doc.moveTo(MARGIN, y).lineTo(MARGIN + CONTENT_W, y).lineWidth(0.4).strokeColor(C.border).stroke();
  });

  return y + 10;
}

function drawTotals(doc: Doc, invoice: PdfInvoice, y: number): number {
  const boxW = 210;
  const x = MARGIN + CONTENT_W - boxW;
  const settled = invoice.balanceKobo <= 0 && invoice.totalKobo > 0;

  const entries: Array<[string, string]> = [["Subtotal", naira(invoice.subtotalKobo)]];
  if (invoice.taxKobo > 0) {
    const label =
      (invoice.taxLabel ?? "Tax") +
      (invoice.taxPercent ? ` (${invoice.taxPercent}%)` : "");
    entries.push([label, naira(invoice.taxKobo)]);
  }
  entries.push(["Total", naira(invoice.totalKobo)]);
  if (invoice.amountPaidKobo > 0) {
    entries.push(["Paid", naira(invoice.amountPaidKobo)]);
  }

  // Clear of the last item row. Without this the totals crowd the table and read
  // as another line of it rather than a summary of it.
  let yy = y + 6;
  doc.fontSize(8.5);
  for (const [label, value] of entries) {
    doc.font(REGULAR).fillColor(C.muted).text(label, x, yy, { width: boxW * 0.55 });
    doc
      .font(BOLD)
      .fillColor(C.ink)
      .text(value, x + boxW * 0.55, yy, { width: boxW * 0.45, align: "right" });
    yy += 13;
  }

  // The amount due is the one number the recipient is looking for, so it gets
  // the only filled block on the page.
  const gh = 24;
  doc.rect(x, yy + 2, boxW, gh).fill(C.brown);
  doc.font(BOLD).fontSize(9).fillColor(C.brassPale);
  doc.text(settled ? "Paid in full" : "Amount due", x + 8, yy + 9, { width: boxW * 0.5 });
  doc.fontSize(11).fillColor(C.white);
  // A settled invoice shows what was paid, not the zero balance. "Paid in full:
  // ₦0" is technically the outstanding figure but reads as though nothing was
  // ever charged, which is the opposite of what the document is confirming.
  doc.text(naira(settled ? invoice.totalKobo : invoice.balanceKobo), x + boxW * 0.5, yy + 7, {
    width: boxW * 0.5 - 8,
    align: "right",
  });

  return yy + gh + 14;
}

function drawFooterBlocks(doc: Doc, invoice: PdfInvoice, company: PdfCompany, y: number): number {
  const colW = (CONTENT_W - 24) / 2;
  const rightX = MARGIN + colW + 24;
  const hasBank = company.bankName || company.bankAccountName || company.bankAccountNumber;

  let ly = y;
  if (hasBank) {
    ly = sectionHeading(doc, "Payment details", MARGIN, y, colW);
    ly = row(doc, "Bank", company.bankName ?? "", MARGIN, ly, colW);
    ly = row(doc, "Account name", company.bankAccountName ?? "", MARGIN, ly, colW);
    ly = row(doc, "Account no.", company.bankAccountNumber ?? "", MARGIN, ly, colW);
    doc.font(REGULAR).fontSize(7).fillColor(C.muted);
    doc.text(
      `Please quote ${invoice.invoiceNumber} on the transfer so payment can be matched to this invoice.`,
      MARGIN,
      ly + 2,
      { width: colW }
    );
    ly = doc.y;
  }

  // Signature block: the printed sheet has one, and a PDF that reaches a site
  // office often gets printed and signed on delivery.
  let ry = sectionHeading(doc, "Received by", rightX, y, colW);
  for (const label of ["Name", "Signature", "Date"]) {
    doc.font(REGULAR).fontSize(8).fillColor(C.muted);
    doc.text(label, rightX, ry, { width: 52, lineBreak: false });
    doc
      .moveTo(rightX + 54, ry + 9)
      .lineTo(rightX + colW, ry + 9)
      .lineWidth(0.5)
      .strokeColor(C.border)
      .stroke();
    ry += 20;
  }

  return Math.max(ly, ry) + 8;
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
      if (y > PAGE.height - MARGIN - 200) {
        doc.addPage();
        y = MARGIN;
      }
      y = drawTotals(doc, invoice, y);
      y = drawFooterBlocks(doc, invoice, company, y);

      if (invoice.notes) {
        y = sectionHeading(doc, "Notes", MARGIN, y, CONTENT_W);
        doc.font(REGULAR).fontSize(8).fillColor(C.ink);
        doc.text(invoice.notes, MARGIN, y, { width: CONTENT_W });
      }

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

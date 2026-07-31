"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { motion } from "framer-motion";
import { Download, Printer, TriangleAlert, X, ZoomIn, ZoomOut } from "lucide-react";
import { Button } from "@/components/admin/ui/Fields";

/**
 * On-screen preview of a print sheet.
 *
 * The sheets keep their own `@media print` rules for the real print job. For the
 * preview they are rendered inside `.print-preview`, and each sheet ships a
 * matching screen block scoped to that class, so the same measurements are used
 * on screen as on paper. Duplicating the rules is deliberate: an iframe would
 * isolate the styling but cannot see the React tree, and stringifying the sheet
 * to inject it would mean the preview no longer renders the component the
 * printer receives.
 *
 * Zoom scales the whole sheet rather than reflowing it, so nothing moves between
 * what is previewed and what prints.
 */

export type PaperSize = "a4-portrait" | "a4-landscape";

/** Millimetres, matching the `@page size` each sheet declares. */
const PAPER: Record<PaperSize, { w: number; h: number }> = {
  "a4-portrait": { w: 210, h: 297 },
  "a4-landscape": { w: 297, h: 210 },
};

export function PrintPreview({
  title,
  paper = "a4-portrait",
  onPrint,
  onClose,
  children,
}: {
  title: string;
  paper?: PaperSize;
  onPrint: () => void;
  onClose: () => void;
  children: ReactNode;
}) {
  const [zoom, setZoom] = useState(0.8);
  /** Set when the download window was blocked, so the user is told what to do. */
  const [blocked, setBlocked] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [onClose]);

  const size = PAPER[paper];

  /**
   * Opens the sheet on its own so the browser can save it as a PDF.
   *
   * The sheet's markup and its `<style>` block are copied into a blank window, which
   * is then printed. That window contains nothing but the document, so none of the
   * dashboard-hiding rules are needed and the result cannot be affected by the
   * admin chrome around the preview.
   *
   * Deliberately not a canvas or an image: the text stays selectable and the
   * vectors stay sharp, which matters for something a client or a member of staff
   * may keep.
   */
  function download() {
    const sheet = boxRef.current?.firstElementChild as HTMLElement | null;
    if (!sheet) return;

    // The sheet's rules are scoped to `.print-preview`, so that class travels with
    // it or the copy would render unstyled.
    const styles = [...sheet.querySelectorAll("style")]
      .map((s) => s.textContent ?? "")
      .join("\n");

    /*
     * The sheet's own <style> tags are stripped from the copied markup.
     *
     * They sit as siblings of the sheet root inside this container, so innerHTML
     * carries them along, and they were landing in the new document's body *after*
     * the identical rules written into its head. Each sheet's CSS opens with
     * `<root> { display: none }` — the sheet is hidden until print media or the
     * preview class reveals it — so that duplicate re-hid the sheet at equal
     * specificity but a later position, and the downloaded page came out blank.
     * The head copy is the one that matters, because the reveal rule below has to
     * be able to override it.
     */
    const markup = [...sheet.children]
      .filter((el) => el.tagName !== "STYLE")
      .map((el) => el.outerHTML)
      .join("");

    const win = window.open("", "_blank", "width=900,height=1200");
    if (!win) {
      // Pop-up blocked. Printing is still available, so say which one to use.
      setBlocked(true);
      return;
    }

    // The sheet's own CSS hides its root outside print media, so the window would
    // show a blank page until the print dialog opened. `.print-preview<root>` is the
    // selector that reveals it on screen, and the class is already on the body, but
    // the root element itself needs it too because that selector takes both classes
    // on one element. Rather than guess the root class, every element in the copied
    // body is revealed.
    //
    // `:where()` keeps the selector at zero specificity so the sheet's own scoped
    // rules still decide layout, while `display` is forced with !important because
    // the only thing being overridden is the blanket hide.
    win.document.write(
      `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title>` +
        `<style>${styles}\n` +
        `@page { size: ${paper === "a4-landscape" ? "A4 landscape" : "A4"}; margin: 13mm; }\n` +
        `html,body { margin:0; padding:0; background:#fff; }\n` +
        `:where(body.print-preview > *) { display: block !important; }\n` +
        `@media screen { body { padding: 12mm; } }\n` +
        `</style></head><body class="print-preview">${markup}</body></html>`
    );
    win.document.close();

    // Waits for the copied images and fonts, or the PDF can be written before the
    // logo has loaded.
    //
    // Guarded rather than relying on onload alone: document.write followed by
    // close() can finish loading before this handler is attached, in which case
    // onload never fires and the print dialog never opens. The readyState check
    // catches that, and printOnce keeps the two paths from both firing.
    let printed = false;
    const printOnce = () => {
      if (printed || win.closed) return;
      printed = true;
      win.focus();
      win.print();
    };

    if (win.document.readyState === "complete") {
      // A frame's grace for the images the sheet just declared.
      win.setTimeout(printOnce, 300);
    } else {
      win.onload = printOnce;
      // Backstop: a logo that 404s can leave load pending indefinitely, and a
      // document that never prints looks exactly like the blank-page bug.
      win.setTimeout(printOnce, 2500);
    }
  }

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      role="dialog"
      aria-modal="true"
      aria-label={`${title} preview`}
      className="fixed inset-0 z-[80] flex flex-col bg-night-950/95 backdrop-blur-sm print:hidden"
    >
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-night-700/60 bg-night-900 px-5 py-3">
        <div>
          <p className="text-sm text-cream-100">{title}</p>
          <p className="text-xs text-cream-500">
            {paper === "a4-landscape" ? "A4 landscape" : "A4 portrait"}, as it will print
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setZoom((z) => Math.max(0.4, Math.round((z - 0.15) * 100) / 100))}
            aria-label="Zoom out"
            className="flex h-9 w-9 cursor-pointer items-center justify-center rounded-lg border border-night-600 text-cream-300 transition-colors hover:border-brass-500/60 hover:text-brass-300"
          >
            <ZoomOut size={15} />
          </button>
          <span className="w-12 text-center text-xs tabular-nums text-cream-400">
            {Math.round(zoom * 100)}%
          </span>
          <button
            type="button"
            onClick={() => setZoom((z) => Math.min(1.6, Math.round((z + 0.15) * 100) / 100))}
            aria-label="Zoom in"
            className="flex h-9 w-9 cursor-pointer items-center justify-center rounded-lg border border-night-600 text-cream-300 transition-colors hover:border-brass-500/60 hover:text-brass-300"
          >
            <ZoomIn size={15} />
          </button>
          {/* Download is the primary action. Printing was the only way to get any
              of these documents out, which meant there was no way to keep or send
              a copy: a payslip or job sheet usually needs filing or emailing, not
              putting on paper. Save as PDF from the dialog still prints. */}
          <Button onClick={download}>
            <span className="flex items-center gap-2">
              <Download size={15} /> Download PDF
            </span>
          </Button>
          <Button variant="secondary" onClick={onPrint}>
            <span className="flex items-center gap-2">
              <Printer size={15} /> Print
            </span>
          </Button>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close preview"
            className="flex h-9 w-9 cursor-pointer items-center justify-center rounded-lg text-cream-400 transition-colors hover:text-brass-300"
          >
            <X size={18} />
          </button>
        </div>
      </div>

      {blocked && (
        <p
          role="alert"
          className="flex items-center justify-center gap-2 border-b border-amber-500/30 bg-amber-500/10 px-5 py-3 text-sm text-amber-200"
        >
          <TriangleAlert size={15} /> Your browser blocked the download window. Allow
          pop-ups for this site, or use Print and choose &ldquo;Save as PDF&rdquo;.
        </p>
      )}

      <div className="flex-1 overflow-auto p-6">
        {/* Outer box reserves the scaled footprint so the scrollbars are right;
            the inner element is what actually scales. */}
        <div
          ref={boxRef}
          className="mx-auto"
          style={{ width: `${size.w * zoom}mm`, height: `${size.h * zoom}mm` }}
        >
          <div
            className="print-preview bg-white shadow-card"
            style={{
              width: `${size.w}mm`,
              minHeight: `${size.h}mm`,
              padding: "12mm",
              boxSizing: "border-box",
              transform: `scale(${zoom})`,
              transformOrigin: "top left",
            }}
          >
            {children}
          </div>
        </div>
      </div>
    </motion.div>
  );
}

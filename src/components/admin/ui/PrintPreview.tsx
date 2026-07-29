"use client";

import { useEffect, useState, type ReactNode } from "react";
import { motion } from "framer-motion";
import { Printer, X, ZoomIn, ZoomOut } from "lucide-react";
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
          <Button onClick={onPrint}>
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

      <div className="flex-1 overflow-auto p-6">
        {/* Outer box reserves the scaled footprint so the scrollbars are right;
            the inner element is what actually scales. */}
        <div
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

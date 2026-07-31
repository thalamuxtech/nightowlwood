"use client";

import { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { getFunctions, httpsCallable } from "firebase/functions";
import { Download, Loader2, Mail, TriangleAlert, X } from "lucide-react";
import { getFirebaseApp } from "@/lib/firebase";
import { Button } from "@/components/admin/ui/Fields";

const REGION = "europe-west1";

/**
 * The estimate PDF, as the client will receive it.
 *
 * The same arrangement as InvoicePdfModal, and for the same reason: the file shown
 * here is the one the server generated, not an HTML approximation of it, so what is
 * reviewed is what gets sent. The browser's own PDF viewer is used through a blob
 * URL, which brings paging, zoom, text selection and printing without
 * reimplementing any of them.
 */

interface PdfResult {
  ok: boolean;
  filename: string;
  projectNumber: string;
  version: number;
  base64: string;
  bytes: number;
}

/** Turns the base64 payload into a blob URL the viewer can load. */
function toBlobUrl(base64: string): string {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }));
}

export function EstimatePdfModal({
  estimateId,
  projectNumber,
  version,
  customerEmail,
  canEmail,
  onClose,
  onEmailed,
}: {
  estimateId: string;
  projectNumber: string;
  version: number;
  customerEmail?: string;
  /** False while the estimate is out for review, and for anyone but an admin. */
  canEmail: boolean;
  onClose: () => void;
  onEmailed: (to: string) => void;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const [result, setResult] = useState<PdfResult | null>(null);
  const [error, setError] = useState("");
  const [sending, setSending] = useState(false);
  const [askingEmail, setAskingEmail] = useState(false);
  const [to, setTo] = useState(customerEmail ?? "");
  const [message, setMessage] = useState("");

  const functions = useMemo(() => getFunctions(getFirebaseApp(), REGION), []);

  useEffect(() => {
    let revoked = false;
    let objectUrl: string | null = null;

    const fn = httpsCallable<{ estimateId: string }, PdfResult>(
      functions,
      "getEstimatePdf"
    );
    fn({ estimateId })
      .then((res) => {
        if (revoked) return;
        objectUrl = toBlobUrl(res.data.base64);
        setResult(res.data);
        setUrl(objectUrl);
      })
      .catch((e: unknown) => {
        if (revoked) return;
        setError(
          e && typeof e === "object" && "message" in e
            ? String((e as { message: unknown }).message)
            : "The estimate PDF could not be generated."
        );
      });

    return () => {
      revoked = true;
      // Blob URLs pin their data until revoked, so a few previews in one session
      // would otherwise hold every PDF at once.
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [functions, estimateId]);

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

  function download() {
    if (!url || !result) return;
    const a = document.createElement("a");
    a.href = url;
    a.download = result.filename;
    a.click();
  }

  async function send() {
    const address = to.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)) {
      setError("Enter a valid email address.");
      return;
    }
    setSending(true);
    setError("");
    try {
      const fn = httpsCallable<
        { estimateId: string; to: string; message: string },
        { ok: boolean; to: string; projectNumber: string; version: number }
      >(functions, "emailEstimate");
      const res = await fn({ estimateId, to: address, message: message.trim() });
      onEmailed(res.data.to);
      onClose();
    } catch (e: unknown) {
      setError(
        e && typeof e === "object" && "message" in e
          ? String((e as { message: unknown }).message)
          : "The estimate could not be emailed."
      );
    } finally {
      setSending(false);
    }
  }

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      role="dialog"
      aria-modal="true"
      aria-label={`Estimate ${projectNumber} v${version} PDF`}
      className="fixed inset-0 z-[80] flex flex-col bg-night-950/95 backdrop-blur-sm"
    >
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-night-700/60 bg-night-900 px-5 py-3">
        <div className="min-w-0">
          <p className="truncate text-sm text-cream-100">
            Estimate {projectNumber} v{version}
          </p>
          <p className="text-xs text-cream-500">
            {result
              ? `PDF, ${Math.max(1, Math.round(result.bytes / 1024))} KB, exactly as the client receives it`
              : "Generating the PDF…"}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="secondary" onClick={download} disabled={!url}>
            <span className="flex items-center gap-2">
              <Download size={15} /> Download
            </span>
          </Button>
          {canEmail && (
            <Button onClick={() => setAskingEmail((v) => !v)} disabled={!url}>
              <span className="flex items-center gap-2">
                <Mail size={15} /> Email to client
              </span>
            </Button>
          )}
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

      {askingEmail && canEmail && (
        <div className="border-b border-night-700/60 bg-night-900/70 px-5 py-4">
          <div className="mx-auto grid max-w-3xl gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
            <label className="block">
              <span className="mb-1.5 block text-sm text-cream-300">Send to</span>
              <input
                type="email"
                value={to}
                onChange={(e) => setTo(e.target.value)}
                placeholder="name@example.com"
                className="w-full rounded-xl border border-night-600 bg-night-950/60 px-4 py-2.5 text-sm text-cream-100 outline-none transition-colors focus:border-brass-500"
              />
            </label>
            <label className="block">
              <span className="mb-1.5 block text-sm text-cream-300">
                Note (optional)
              </span>
              <input
                type="text"
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder="Added to the email body"
                className="w-full rounded-xl border border-night-600 bg-night-950/60 px-4 py-2.5 text-sm text-cream-100 outline-none transition-colors focus:border-brass-500"
              />
            </label>
            <Button onClick={send} busy={sending}>
              <span className="flex items-center gap-2">
                <Mail size={15} /> Send
              </span>
            </Button>
          </div>
          {!customerEmail && (
            <p className="mx-auto mt-2 max-w-3xl text-xs text-cream-500">
              This client has no email on record. Sending here does not save it; add it
              to the customer to keep it.
            </p>
          )}
        </div>
      )}

      {error && (
        <p
          role="alert"
          className="flex items-center justify-center gap-2 border-b border-red-500/30 bg-red-500/10 px-5 py-3 text-sm text-red-300"
        >
          <TriangleAlert size={15} /> {error}
        </p>
      )}

      <div className="flex-1 overflow-hidden bg-night-950">
        {url ? (
          <iframe
            src={url}
            title={`Estimate ${projectNumber} v${version}`}
            className="h-full w-full border-0"
          />
        ) : (
          !error && (
            <div className="flex h-full items-center justify-center">
              <Loader2
                className="animate-spin text-brass-400"
                size={28}
                aria-label="Loading"
              />
            </div>
          )
        )}
      </div>
    </motion.div>
  );
}

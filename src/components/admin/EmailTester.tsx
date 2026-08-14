"use client";

import { useEffect, useState } from "react";
import { getFunctions, httpsCallable } from "firebase/functions";
import { CheckCircle2, Eye, Mail, ShieldAlert, X, XCircle } from "lucide-react";
import { getFirebaseApp } from "@/lib/firebase";
import { Button, TextField } from "@/components/admin/ui/Fields";
import { useErpSession } from "@/components/admin/ErpAuthProvider";
import { roleAtLeast } from "@/lib/erp/enums";

/** Must match the region the functions are deployed to. */
const REGION = "europe-west1";

/**
 * Test send for the transactional email path. Admin only.
 *
 * Kept separate from business flows on purpose: if a customer invoice fails to
 * send, this tells you whether the cause is credentials/DNS or the invoice code.
 */
export function EmailTester() {
  const session = useErpSession();
  const [to, setTo] = useState(session.user?.email ?? "");
  const [sending, setSending] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [previewHtml, setPreviewHtml] = useState<string | null>(null);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);

  // Admin or above: an exact match on "admin" would have excluded the super admin.
  const isAdmin = roleAtLeast(session.role, "admin");

  async function preview() {
    setPreviewing(true);
    setResult(null);
    try {
      const fn = httpsCallable<void, { subject: string; html: string }>(
        getFunctions(getFirebaseApp(), REGION),
        "previewTestEmail"
      );
      const res = await fn();
      setPreviewHtml(res.data.html);
    } catch (e) {
      setResult({ ok: false, message: describeError(e) });
    } finally {
      setPreviewing(false);
    }
  }

  async function sendTest() {
    setSending(true);
    setResult(null);
    try {
      const fn = httpsCallable<{ to: string }, { ok: boolean; messageId: string | null }>(
        getFunctions(getFirebaseApp(), REGION),
        "sendTestEmail"
      );
      await fn({ to: to.trim() });
      setResult({ ok: true, message: `Test email sent to ${to.trim()}.` });
    } catch (e) {
      setResult({ ok: false, message: describeError(e) });
    } finally {
      setSending(false);
    }
  }

  if (!isAdmin) {
    return (
      <div className="rounded-3xl border border-red-500/30 bg-red-500/5 p-6 text-center">
        <ShieldAlert className="mx-auto text-red-400" size={26} />
        <p className="mt-3 text-sm text-cream-400">Email testing is admin only.</p>
      </div>
    );
  }

  return (
    <section className="rounded-3xl border border-night-700/60 bg-night-900/40 p-6">
      <h2 className="flex items-center gap-2 font-display text-lg text-cream-100">
        <Mail size={18} className="text-brass-400" /> Transactional email
      </h2>
      <div className="mt-5">
        <Button variant="secondary" onClick={preview} busy={previewing}>
          <span className="flex items-center gap-2">
            <Eye size={15} /> Preview email
          </span>
        </Button>
      </div>

      <div className="mt-6 grid gap-4 sm:grid-cols-[1fr_auto] sm:items-end">
        <TextField
          id="test-email-to"
          label="Send a test to"
          type="email"
          value={to}
          onChange={setTo}
          placeholder="you@example.com"
        />
        <Button onClick={sendTest} busy={sending} disabled={!to.trim()}>
          Send test email
        </Button>
      </div>

      {previewHtml !== null && (
        <EmailPreviewModal html={previewHtml} onClose={() => setPreviewHtml(null)} />
      )}

      {result && (
        <p
          role="status"
          className={`mt-4 flex items-start gap-2 text-sm ${
            result.ok ? "text-emerald-300" : "text-red-400"
          }`}
        >
          {result.ok ? (
            <CheckCircle2 size={16} className="mt-0.5 shrink-0" />
          ) : (
            <XCircle size={16} className="mt-0.5 shrink-0" />
          )}
          <span>{result.message}</span>
        </p>
      )}
    </section>
  );
}

/**
 * Shows the rendered email exactly as it will be delivered.
 *
 * The email carries its own <html> and inline styles, so it goes into an iframe
 * via srcDoc rather than the page: injected directly, its rules would leak into
 * the dashboard and the dashboard's reset would leak back. `sandbox` with no
 * allow-scripts also means nothing in the template can execute.
 */
function EmailPreviewModal({ html, onClose }: { html: string; onClose: () => void }) {
  // Escape closes, which is expected for an overlay this size.
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

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Email preview"
      onClick={onClose}
      className="fixed inset-0 z-[80] flex flex-col items-center justify-center bg-night-950/90 p-3 backdrop-blur-sm sm:p-8"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex h-full w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-night-700/60 bg-night-900"
      >
        <div className="flex items-center justify-between gap-3 border-b border-night-700/60 px-5 py-3">
          <div>
            <p className="text-sm text-cream-100">Email preview</p>
            <p className="text-xs text-cream-500">
              Rendered from the same template the send uses.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close preview"
            className="cursor-pointer text-cream-400 transition-colors hover:text-brass-300"
          >
            <X size={18} />
          </button>
        </div>
        <iframe
          title="Email preview"
          srcDoc={html}
          sandbox=""
          className="h-full min-h-[60vh] w-full flex-1 bg-white"
        />
      </div>
    </div>
  );
}

/** Turns Firebase callable errors into something a human can act on. */
function describeError(e: unknown): string {
  if (typeof e === "object" && e !== null && "code" in e) {
    const code = String((e as { code: string }).code);
    const message = "message" in e ? String((e as { message: string }).message) : "";
    if (code.includes("not-found") || code.includes("internal")) {
      return (
        message ||
        "Function not found. Deploy the functions first: firebase deploy --only functions"
      );
    }
    if (code.includes("unauthenticated")) return "Sign in again, your session expired.";
    if (code.includes("permission-denied")) return message || "Admin access required.";
    return message || code;
  }
  return e instanceof Error ? e.message : "Unknown error.";
}

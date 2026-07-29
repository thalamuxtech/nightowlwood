"use client";

import { useState } from "react";
import { getFunctions, httpsCallable } from "firebase/functions";
import { CheckCircle2, Mail, ShieldAlert, XCircle } from "lucide-react";
import { getFirebaseApp } from "@/lib/firebase";
import { Button, TextField } from "@/components/admin/ui/Fields";
import { useErpSession } from "@/components/admin/ErpAuthProvider";

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
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);

  const isAdmin = session.role === "admin";

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
      <p className="mt-2 text-sm text-cream-400">
        Verifies the Brevo path used for invoices, estimate review links and stock
        alerts. The API key lives in Secret Manager and is never sent to the browser.
      </p>

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

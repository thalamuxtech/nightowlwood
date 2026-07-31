"use client";

import { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { getFunctions, httpsCallable } from "firebase/functions";
import { Check, Copy, Send, TriangleAlert, X } from "lucide-react";
import { getFirebaseApp } from "@/lib/firebase";
import { formatNaira } from "@/lib/erp/money";
import {
  Button,
  NumberField,
  TextAreaField,
  TextField,
} from "@/components/admin/ui/Fields";

const REGION = "europe-west1";

/**
 * Sends an estimate to an outside professional for review.
 *
 * The reviewer is a quantity surveyor or fabricator with no account here, so they
 * get a one-time link carrying a random token plus a six-digit passcode. Only
 * hashes are stored server-side; see functions/src/estimateReview.ts.
 *
 * The passcode is returned once, by the call that creates it, and shown here so it
 * can be read out over the phone. It cannot be recovered afterwards — the server
 * keeps only its hash — so the panel says so plainly rather than letting someone
 * close the dialog assuming they can look it up later. Sending again issues a fresh
 * link and passcode, which is the recovery path.
 */

interface SendResult {
  ok: boolean;
  passcode: string;
  expiresAtMs: number;
  link: string;
}

export function SendForReviewModal({
  projectId,
  projectNumber,
  version,
  components,
  onClose,
  onSent,
}: {
  projectId: string;
  projectNumber: string;
  version: number;
  components: Array<{ id: string; name: string; estimatedCostKobo: number }>;
  onClose: () => void;
  onSent: () => void;
}) {
  const [email, setEmail] = useState("");
  const [reviewerName, setReviewerName] = useState("");
  const [validDays, setValidDays] = useState("7");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [sent, setSent] = useState<SendResult | null>(null);
  const [copied, setCopied] = useState<"link" | "code" | null>(null);
  /**
   * Which components the reviewer is asked to look at.
   *
   * All of them by default, since that is the usual case. Narrowing matters when the
   * reviewer is a specialist — a kitchen fabricator has no useful opinion on the
   * door schedule, and sending them the lot invites edits outside their competence.
   */
  const [scope, setScope] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(components.map((c) => [c.id, true]))
  );

  const chosen = components.filter((c) => scope[c.id]);

  const functions = useMemo(() => getFunctions(getFirebaseApp(), REGION), []);

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

  async function copy(what: "link" | "code", value: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(what);
      setTimeout(() => setCopied(null), 2000);
    } catch {
      // Clipboard access can be refused. Both values are on screen and
      // selectable, so there is nothing to recover from.
    }
  }

  async function submit() {
    const address = email.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)) {
      setError("Enter a valid email address for the reviewer.");
      return;
    }
    if (chosen.length === 0) {
      setError("Pick at least one component for the reviewer to look at.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const fn = httpsCallable<
        {
          projectId: string;
          email: string;
          reviewerName: string;
          validDays: number;
          message: string;
          siteUrl: string;
          componentIds: string[];
        },
        SendResult
      >(functions, "sendEstimateForReview");
      const res = await fn({
        projectId,
        email: address,
        reviewerName: reviewerName.trim(),
        validDays: Math.max(1, Math.min(30, Number(validDays) || 7)),
        message: message.trim(),
        // The link has to point at wherever this admin is being used, or a
        // reviewer opens a URL on the wrong host.
        siteUrl: window.location.origin,
        // Empty would be ambiguous server-side, so all-selected is sent explicitly.
        componentIds: chosen.map((c) => c.id),
      });
      setSent(res.data);
      onSent();
    } catch (e: unknown) {
      setError(
        e && typeof e === "object" && "message" in e
          ? String((e as { message: unknown }).message)
          : "The estimate could not be sent for review."
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      role="dialog"
      aria-modal="true"
      aria-label="Send estimate for review"
      className="fixed inset-0 z-[80] flex items-start justify-center overflow-y-auto bg-night-950/95 p-4 backdrop-blur-sm sm:p-8"
    >
      <div className="w-full max-w-xl rounded-3xl border border-brass-500/30 bg-night-900 p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-eyebrow">
              {projectNumber} · v{version}
            </p>
            <h2 className="font-display mt-1.5 text-lg text-cream-100">
              {sent ? "Sent for review" : "Send for professional review"}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-lg text-cream-400 transition-colors hover:text-brass-300"
          >
            <X size={18} />
          </button>
        </div>

        {error && (
          <p
            role="alert"
            className="mt-5 flex items-start gap-2 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300"
          >
            <TriangleAlert size={15} className="mt-0.5 shrink-0" /> {error}
          </p>
        )}

        {sent ? (
          <div className="mt-5">
            <p className="text-sm text-cream-300">
              The reviewer has been emailed a link and the passcode below. They can
              adjust quantities and prices, add anything missing, and return it. The
              link stops working once they submit.
            </p>

            <div className="mt-5 rounded-2xl border border-brass-500/30 bg-night-950/50 p-5">
              <p className="text-xs uppercase tracking-wider text-cream-500">
                Access code
              </p>
              <div className="mt-2 flex items-center gap-3">
                <span className="font-display text-3xl tracking-[0.3em] text-brass-300">
                  {sent.passcode}
                </span>
                <button
                  type="button"
                  onClick={() => copy("code", sent.passcode)}
                  className="flex cursor-pointer items-center gap-1.5 rounded-lg border border-night-600 px-3 py-1.5 text-xs text-cream-300 transition-colors hover:border-brass-500/60 hover:text-brass-300"
                >
                  {copied === "code" ? <Check size={13} /> : <Copy size={13} />}
                  {copied === "code" ? "Copied" : "Copy"}
                </button>
              </div>
              {/* Said here rather than in a tooltip: the one moment this matters is
                  the moment before someone closes the dialog. */}
              <p className="mt-3 text-xs text-cream-500">
                Shown once. Only a hash is stored, so it cannot be looked up again —
                send the estimate for review a second time to issue a new code.
              </p>
            </div>

            <div className="mt-4">
              <p className="text-xs uppercase tracking-wider text-cream-500">
                Review link
              </p>
              <div className="mt-2 flex items-center gap-2">
                <code className="min-w-0 flex-1 truncate rounded-xl border border-night-700 bg-night-950/60 px-3 py-2.5 text-xs text-cream-400">
                  {sent.link}
                </code>
                <button
                  type="button"
                  onClick={() => copy("link", sent.link)}
                  className="flex shrink-0 cursor-pointer items-center gap-1.5 rounded-lg border border-night-600 px-3 py-2 text-xs text-cream-300 transition-colors hover:border-brass-500/60 hover:text-brass-300"
                >
                  {copied === "link" ? <Check size={13} /> : <Copy size={13} />}
                  {copied === "link" ? "Copied" : "Copy"}
                </button>
              </div>
              <p className="mt-2 text-xs text-cream-500">
                Expires{" "}
                {new Date(sent.expiresAtMs).toLocaleDateString("en-GB", {
                  day: "numeric",
                  month: "long",
                  year: "numeric",
                })}
                .
              </p>
            </div>

            <div className="mt-6">
              <Button onClick={onClose}>Done</Button>
            </div>
          </div>
        ) : (
          <>
            <p className="mt-4 text-sm text-cream-400">
              The reviewer gets a private link and a six-digit access code by email.
              They can change quantities and prices and add missing items, but not the
              error margin or the Nightowl charge. Nothing goes to the client until you
              send it.
            </p>

            <div className="mt-5 grid gap-4 sm:grid-cols-2">
              <TextField
                id="rev-email"
                label="Reviewer email"
                type="email"
                value={email}
                onChange={setEmail}
                placeholder="surveyor@example.com"
                required
                autoFocus
              />
              <TextField
                id="rev-name"
                label="Reviewer name"
                value={reviewerName}
                onChange={setReviewerName}
                placeholder="Optional"
              />
            </div>
            <div className="mt-4 sm:w-1/2">
              <NumberField
                id="rev-days"
                label="Link valid for (days)"
                value={validDays}
                onChange={setValidDays}
                min={1}
                step={1}
                hint="1–30"
              />
            </div>
            <div className="mt-4">
              <TextAreaField
                id="rev-message"
                label="Message to the reviewer"
                value={message}
                onChange={setMessage}
                rows={3}
                placeholder="Anything they should know — a deadline, a section to focus on."
              />
            </div>

            <div className="mt-5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm text-cream-300">What should they review?</p>
                <button
                  type="button"
                  onClick={() =>
                    setScope(
                      Object.fromEntries(
                        components.map((c) => [c.id, chosen.length !== components.length])
                      )
                    )
                  }
                  className="cursor-pointer text-xs text-cream-400 transition-colors hover:text-brass-300"
                >
                  {chosen.length === components.length ? "Clear all" : "Select all"}
                </button>
              </div>
              <div className="mt-2 space-y-1.5">
                {components.map((c) => (
                  <label
                    key={c.id}
                    htmlFor={`scope-${c.id}`}
                    className="flex cursor-pointer items-center gap-3 rounded-xl border border-night-700/50 bg-night-950/40 px-3 py-2 text-sm text-cream-200"
                  >
                    <input
                      id={`scope-${c.id}`}
                      type="checkbox"
                      checked={!!scope[c.id]}
                      onChange={(e) =>
                        setScope((p) => ({ ...p, [c.id]: e.target.checked }))
                      }
                      className="h-4 w-4 cursor-pointer accent-brass-500"
                    />
                    <span className="flex-1 truncate">{c.name}</span>
                    <span className="text-xs text-cream-500">
                      {formatNaira(c.estimatedCostKobo)}
                    </span>
                  </label>
                ))}
              </div>
              {components.length === 0 && (
                <p className="mt-2 text-xs text-amber-300">
                  This project has no components yet, so there is nothing to review.
                </p>
              )}
            </div>

            <p className="mt-4 text-xs text-cream-500">
              Sending replaces any earlier review link for this project.
            </p>

            <div className="mt-6 flex flex-wrap gap-3">
              <Button onClick={submit} busy={busy}>
                <span className="flex items-center gap-2">
                  <Send size={15} /> Send for review
                </span>
              </Button>
              <Button variant="ghost" onClick={onClose}>
                Cancel
              </Button>
            </div>
          </>
        )}
      </div>
    </motion.div>
  );
}

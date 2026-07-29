"use client";

import { useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { getFunctions, httpsCallable } from "firebase/functions";
import {
  CheckCircle2,
  Loader2,
  Lock,
  Plus,
  ShieldAlert,
  Trash2,
} from "lucide-react";
import { getFirebaseApp } from "@/lib/firebase";
import { formatNaira, parseNairaInput, toNaira } from "@/lib/erp/money";
import { OwlMark } from "@/components/site/OwlMark";

/** Must match the region the functions are deployed to. */
const REGION = "europe-west1";

interface ReviewLine {
  id?: string;
  category?: string;
  item: string;
  quantity: number;
  unitPriceKobo: number;
  amountKobo: number;
  addedByReviewer?: boolean;
}

interface OpenedEstimate {
  estimateId: string;
  projectNumber: string;
  version: number;
  reviewerName: string | null;
  errorMarginPercent: number;
  expiresAtMs: number;
  lines: ReviewLine[];
}

interface DraftLine extends ReviewLine {
  key: string;
  qty: string;
  price: string;
  removed?: boolean;
}

let seq = 0;

/**
 * External estimate review.
 *
 * Public page, reached only with a token in the URL plus a passcode. It is
 * deliberately standalone: the reviewer is a professional doing Nightowl a
 * service, not a customer being sold to, so there is no site navigation, no
 * marketing and nothing to click away into.
 *
 * Every read and write goes through a Cloud Function. The reviewer has no
 * Firebase identity, so there is nothing for Firestore rules to authorise
 * against, and the token, passcode, expiry and attempt limit are all enforced
 * server-side.
 */
export function EstimateReview() {
  const params = useSearchParams();
  const token = params.get("t") ?? "";

  const [passcode, setPasscode] = useState("");
  const [opening, setOpening] = useState(false);
  const [estimate, setEstimate] = useState<OpenedEstimate | null>(null);
  const [lines, setLines] = useState<DraftLine[]>([]);
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState<{ changed: number; added: number } | null>(
    null
  );
  const [error, setError] = useState("");

  async function open() {
    if (passcode.trim().length < 4) {
      setError("Enter the passcode from the email.");
      return;
    }
    setOpening(true);
    setError("");
    try {
      const fn = httpsCallable<
        { token: string; passcode: string },
        OpenedEstimate
      >(getFunctions(getFirebaseApp(), REGION), "openEstimateReview");
      const res = await fn({ token, passcode: passcode.trim() });
      setEstimate(res.data);
      setLines(
        res.data.lines.map((l) => ({
          ...l,
          key: `k${seq++}`,
          qty: l.quantity ? String(l.quantity) : "",
          price: l.unitPriceKobo ? String(toNaira(l.unitPriceKobo)) : "",
        }))
      );
    } catch (e) {
      setError(describeError(e));
    } finally {
      setOpening(false);
    }
  }

  const subtotal = useMemo(
    () =>
      lines
        .filter((l) => !l.removed)
        .reduce((s, l) => s + (Number(l.qty) || 0) * parseNairaInput(l.price), 0),
    [lines]
  );

  async function submit() {
    setSubmitting(true);
    setError("");
    try {
      const fn = httpsCallable<
        {
          token: string;
          passcode: string;
          lines: Array<{
            id?: string;
            item: string;
            category?: string;
            quantity: number;
            unitPriceKobo: number;
          }>;
          note?: string;
        },
        { changed: number; added: number }
      >(getFunctions(getFirebaseApp(), REGION), "submitEstimateReview");

      const res = await fn({
        token,
        passcode: passcode.trim(),
        // Removed lines are simply omitted; the function zeroes them rather than
        // deleting, so the record still shows the reviewer disagreed.
        lines: lines
          .filter((l) => !l.removed)
          .map((l) => ({
            id: l.id,
            item: l.item,
            category: l.category,
            quantity: Number(l.qty) || 0,
            unitPriceKobo: parseNairaInput(l.price),
          })),
        note: note.trim() || undefined,
      });
      setSubmitted(res.data);
    } catch (e) {
      setError(describeError(e));
    } finally {
      setSubmitting(false);
    }
  }

  // --- No token in the URL -------------------------------------------------
  if (!token) {
    return (
      <Shell>
        <Panel>
          <ShieldAlert className="mx-auto text-amber-400" size={28} />
          <h1 className="mt-4 text-center font-display text-xl text-cream-100">
            This link is incomplete
          </h1>
          <p className="mt-2 text-center text-sm text-cream-400">
            Open the estimate using the full link from the email. If it was
            shortened or split across lines, ask us to resend it.
          </p>
        </Panel>
      </Shell>
    );
  }

  // --- Submitted -----------------------------------------------------------
  if (submitted) {
    return (
      <Shell>
        <Panel>
          <CheckCircle2 className="mx-auto text-emerald-400" size={30} />
          <h1 className="mt-4 text-center font-display text-xl text-cream-100">
            Thank you, your review has been sent
          </h1>
          <p className="mt-2 text-center text-sm text-cream-400">
            {submitted.changed} line{submitted.changed === 1 ? "" : "s"} changed and{" "}
            {submitted.added} added. Nightowl has been notified.
          </p>
          <p className="mt-4 text-center text-xs text-cream-600">
            This link has now been used and will no longer open.
          </p>
        </Panel>
      </Shell>
    );
  }

  // --- Passcode gate -------------------------------------------------------
  if (!estimate) {
    return (
      <Shell>
        <Panel>
          <Lock className="mx-auto text-brass-400" size={26} />
          <h1 className="mt-4 text-center font-display text-xl text-cream-100">
            Enter your passcode
          </h1>
          <p className="mt-2 text-center text-sm text-cream-400">
            The six-digit code is in the email that carried this link.
          </p>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              open();
            }}
            className="mt-6"
          >
            <label htmlFor="passcode" className="sr-only">
              Passcode
            </label>
            <input
              id="passcode"
              value={passcode}
              onChange={(e) => setPasscode(e.target.value.replace(/\D/g, "").slice(0, 6))}
              inputMode="numeric"
              autoComplete="one-time-code"
              placeholder="000000"
              autoFocus
              className="w-full rounded-xl border border-night-600 bg-night-800/60 px-4 py-4 text-center font-mono text-2xl tracking-[0.4em] text-cream-100 placeholder:text-cream-700 focus:border-brass-500 focus:outline-none"
            />
            {error && (
              <p role="alert" className="mt-3 text-center text-sm text-red-400">
                {error}
              </p>
            )}
            <button
              type="submit"
              disabled={opening}
              className="mt-5 w-full cursor-pointer rounded-xl bg-brass-500 py-3.5 font-medium text-night-950 transition-colors duration-300 hover:bg-brass-400 disabled:opacity-60"
            >
              {opening ? "Opening…" : "Open the estimate"}
            </button>
          </form>
          <p className="mt-4 text-center text-xs text-cream-600">
            After five incorrect attempts the link locks and we will need to send a
            new one.
          </p>
        </Panel>
      </Shell>
    );
  }

  // --- Review --------------------------------------------------------------
  const expires = new Date(estimate.expiresAtMs).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
  });

  return (
    <Shell wide>
      <header className="text-center">
        <p className="text-eyebrow">Estimate review</p>
        <h1 className="text-title mt-3 text-cream-50">{estimate.projectNumber}</h1>
        <p className="mt-2 text-sm text-cream-400">
          Version {estimate.version}
          {estimate.reviewerName ? ` · for ${estimate.reviewerName}` : ""} · link
          expires {expires}
        </p>
      </header>

      <p className="mx-auto mt-6 max-w-2xl text-center text-sm leading-relaxed text-cream-400">
        Adjust any quantity or price, remove a line you disagree with, or add
        something missing. Nothing is saved until you submit.
      </p>

      {error && (
        <p
          role="alert"
          className="mx-auto mt-6 max-w-2xl rounded-xl border border-red-500/30 bg-red-500/5 px-4 py-3 text-center text-sm text-red-400"
        >
          {error}
        </p>
      )}

      <div className="mt-8 space-y-2">
        {lines.map((l, i) => (
          <div
            key={l.key}
            className={`grid items-end gap-3 rounded-2xl border p-4 sm:grid-cols-[1fr_5rem_8rem_8rem_2.5rem] ${
              l.removed
                ? "border-night-800 bg-night-900/20 opacity-50"
                : "border-night-700/60 bg-night-900/40"
            }`}
          >
            <div className="min-w-0">
              <p className="text-xs uppercase tracking-wider text-cream-600">
                {i + 1}
                {l.addedByReviewer ? " · added" : ""}
              </p>
              {l.id ? (
                <p className="mt-0.5 truncate text-sm text-cream-100">{l.item}</p>
              ) : (
                <input
                  value={l.item}
                  onChange={(e) =>
                    setLines((p) =>
                      p.map((x) => (x.key === l.key ? { ...x, item: e.target.value } : x))
                    )
                  }
                  placeholder="Item description"
                  aria-label="Item description"
                  className="mt-0.5 w-full rounded-lg border border-night-600 bg-night-800/60 px-3 py-2 text-sm text-cream-100 focus:border-brass-500 focus:outline-none"
                />
              )}
            </div>

            <Field
              label="Qty"
              value={l.qty}
              disabled={l.removed}
              onChange={(v) =>
                setLines((p) => p.map((x) => (x.key === l.key ? { ...x, qty: v } : x)))
              }
            />
            <Field
              label="Unit (₦)"
              value={l.price}
              disabled={l.removed}
              onChange={(v) =>
                setLines((p) => p.map((x) => (x.key === l.key ? { ...x, price: v } : x)))
              }
            />
            <div>
              <p className="mb-1.5 text-xs text-cream-500">Amount</p>
              <p className="py-2 text-right text-sm text-brass-300">
                {formatNaira((Number(l.qty) || 0) * parseNairaInput(l.price))}
              </p>
            </div>
            <button
              type="button"
              onClick={() =>
                setLines((p) =>
                  p.map((x) => (x.key === l.key ? { ...x, removed: !x.removed } : x))
                )
              }
              aria-label={l.removed ? `Restore ${l.item}` : `Remove ${l.item}`}
              title={l.removed ? "Restore" : "Remove"}
              className="mb-2 cursor-pointer justify-self-end text-cream-500 transition-colors hover:text-red-400"
            >
              <Trash2 size={15} />
            </button>
          </div>
        ))}
      </div>

      <button
        type="button"
        onClick={() =>
          setLines((p) => [
            ...p,
            {
              key: `k${seq++}`,
              item: "",
              quantity: 0,
              unitPriceKobo: 0,
              amountKobo: 0,
              qty: "",
              price: "",
              addedByReviewer: true,
            },
          ])
        }
        className="mt-4 flex cursor-pointer items-center gap-2 text-sm text-brass-300 transition-colors hover:text-brass-200"
      >
        <Plus size={15} /> Add a missing item
      </button>

      <div className="mt-8 rounded-2xl border border-brass-500/30 bg-brass-500/5 p-5">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <span className="text-sm text-cream-300">Revised subtotal</span>
          <span className="font-display text-2xl text-brass-300">
            {formatNaira(subtotal)}
          </span>
        </div>
        <p className="mt-2 text-xs text-cream-500">
          Nightowl adds its error margin and charges to this figure; those are not
          yours to set.
        </p>
      </div>

      <div className="mt-6">
        <label htmlFor="review-note" className="mb-1.5 block text-sm text-cream-300">
          Anything we should know
        </label>
        <textarea
          id="review-note"
          rows={3}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Optional. Assumptions, concerns, alternatives."
          className="w-full resize-y rounded-xl border border-night-600 bg-night-800/60 px-4 py-3 text-cream-100 placeholder:text-cream-600 focus:border-brass-500 focus:outline-none"
        />
      </div>

      <button
        type="button"
        onClick={submit}
        disabled={submitting}
        className="mt-6 w-full cursor-pointer rounded-xl bg-brass-500 py-4 font-medium text-night-950 transition-colors duration-300 hover:bg-brass-400 disabled:opacity-60"
      >
        {submitting ? "Sending…" : "Submit review"}
      </button>
      <p className="mt-3 text-center text-xs text-cream-600">
        Submitting closes this link. Contact Nightowl if you need to change
        anything afterwards.
      </p>
    </Shell>
  );
}

function Shell({ children, wide }: { children: React.ReactNode; wide?: boolean }) {
  return (
    <main className="flex min-h-svh flex-col items-center bg-night-950 px-5 py-12">
      <span className="text-brass-400">
        <OwlMark size={64} animate={false} />
      </span>
      <div className={`mt-8 w-full ${wide ? "max-w-3xl" : "max-w-md"}`}>{children}</div>
      <p className="mt-12 text-xs text-cream-600">
        Nightowl Woodworks Ltd &middot; Precision in Every Cut
      </p>
    </main>
  );
}

function Panel({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-3xl border border-night-700/60 bg-night-900/50 p-8">
      {children}
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  disabled,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
}) {
  return (
    <div>
      <p className="mb-1.5 text-xs text-cream-500">{label}</p>
      <input
        type="number"
        inputMode="decimal"
        min={0}
        step="any"
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        aria-label={label}
        className="w-full rounded-lg border border-night-600 bg-night-800/60 px-3 py-2 text-sm text-cream-100 focus:border-brass-500 focus:outline-none disabled:opacity-50"
      />
    </div>
  );
}

/** Turns callable errors into something a non-technical reviewer can act on. */
function describeError(e: unknown): string {
  if (typeof e === "object" && e !== null && "message" in e) {
    const message = String((e as { message: string }).message);
    if (message.toLowerCase().includes("internal")) {
      return "Something went wrong at our end. Please try again shortly.";
    }
    return message;
  }
  return "Something went wrong. Please try again.";
}

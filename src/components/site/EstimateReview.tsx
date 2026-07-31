"use client";

import { useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { getFunctions, httpsCallable } from "firebase/functions";
import { CheckCircle2, Loader2, Lock, Plus, ShieldAlert } from "lucide-react";
import { getFirebaseApp } from "@/lib/firebase";
import { formatNaira, parseNairaInput, toNaira } from "@/lib/erp/money";
import { OwlMark } from "@/components/site/OwlMark";

/** Must match the region the functions are deployed to. */
const REGION = "europe-west1";

/**
 * Category slugs as the reviewer should read them.
 *
 * Duplicated from `@/lib/erp/enums` rather than imported: this is a public page
 * reached without a login, and pulling the ERP enum module in would ship the
 * admin's vocabulary — statuses, roles, capabilities — to anyone with the link.
 */
const CATEGORY_LABELS: Record<string, string> = {
  kitchen: "Kitchen",
  doors: "Doors",
  frames: "Frames",
  tv_wall_panels: "TV Wall Panels",
  closets: "Closets",
  bedset: "Bedset",
};

interface ReviewLine {
  /** `componentId:featureId`. Absent on a line the reviewer is adding. */
  id?: string;
  category?: string;
  /** The component this line sits under, e.g. "Main kitchen". */
  component?: string;
  /** Which component a line the reviewer adds should be filed under. */
  componentId?: string;
  item: string;
  quantity: number;
  unitPriceKobo: number;
  amountKobo: number;
  /** Whether it is currently on the estimate. */
  included?: boolean;
  addedByReviewer?: boolean;
}

interface OpenedEstimate {
  projectId: string;
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
          // The whole checklist arrives, ticked or not, so an item the office
          // missed can be brought in rather than only repriced.
          removed: l.included === false,
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

  const kept = useMemo(() => lines.filter((l) => !l.removed), [lines]);

  /**
   * The components a new line may be filed under.
   *
   * Taken from the lines that arrived rather than a separate list, because those are
   * exactly the components this reviewer was given — narrowing the scope on sending
   * must narrow where they can add, or a kitchen fabricator could file work against
   * a closet they were never shown.
   */
  const addTargets = useMemo(() => {
    const seen = new Map<string, string>();
    for (const l of lines) {
      if (!l.id) continue;
      const componentId = l.id.split(":")[0];
      if (!componentId || seen.has(componentId)) continue;
      seen.set(componentId, l.component || l.category || "this component");
    }
    return [...seen].map(([componentId, label]) => ({ componentId, label }));
  }, [lines]);

  /**
   * Lines grouped under the component they were estimated for.
   *
   * Grouped by the component's own name rather than its category, so a project with
   * a main kitchen and a pantry kitchen shows two headings instead of one repeated.
   * Runs are kept in the order they arrived rather than sorted, because that order
   * is the estimator's own sequence and a reviewer working from the paper template
   * reads down the same list. Lines the reviewer adds collect at the end under their
   * own heading, so a new item is never silently filed under someone else's kitchen.
   */
  const groups = useMemo(() => {
    const numbered = lines.map((l, i) => ({ ...l, index: i + 1 }));
    // Keyed on the component id where there is one, so a line the reviewer adds
    // joins the group it was added to instead of collecting in a separate bucket
    // the server would then have to guess a home for.
    const keyOf = (row: (typeof numbered)[number]) =>
      row.id?.split(":")[0] || row.componentId || row.component || row.category || "";
    const out: Array<{ key: string; label: string; rows: typeof numbered }> = [];
    for (const row of numbered) {
      const key = keyOf(row);
      const last = out[out.length - 1];
      if (last && last.key === key) last.rows.push(row);
      else
        out.push({
          key,
          label:
            row.component ||
            CATEGORY_LABELS[row.category ?? ""] ||
            row.category ||
            "Items",
          rows: [row],
        });
    }
    return out;
  }, [lines]);

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
            componentId?: string;
            quantity: number;
            unitPriceKobo: number;
            included: boolean;
          }>;
          note?: string;
        },
        { changed: number; added: number }
      >(getFunctions(getFirebaseApp(), REGION), "submitEstimateReview");

      const res = await fn({
        token,
        passcode: passcode.trim(),
        // Every line is sent with its tick, unticked ones included. Omitting them
        // would be indistinguishable from never having seen them, and the server
        // needs the difference: an untick is a judgement worth recording, and a
        // line the reviewer never touched should keep whatever it already said.
        lines: lines
          // A blank row the reviewer opened and abandoned is not a line.
          .filter((l) => l.id || l.item.trim())
          .map((l) => ({
            id: l.id,
            item: l.item,
            // Only meaningful on an added line; the server reads the component from
            // the composite id for anything that already exists.
            componentId: l.componentId,
            quantity: Number(l.qty) || 0,
            unitPriceKobo: parseNairaInput(l.price),
            included: !l.removed,
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
        Every line is listed below, grouped as it was estimated. Untick anything that
        does not belong, adjust any quantity or price, and add whatever is missing.
        Nothing is saved until you submit.
      </p>

      {error && (
        <p
          role="alert"
          className="mx-auto mt-6 max-w-2xl rounded-xl border border-red-500/30 bg-red-500/5 px-4 py-3 text-center text-sm text-red-400"
        >
          {error}
        </p>
      )}

      <div className="mt-6 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-night-700/60 bg-night-900/40 px-4 py-3">
        <p className="text-sm text-cream-400">
          <span className="text-cream-100">{kept.length}</span> of {lines.length} lines
          included
        </p>
        <div className="flex gap-4">
          <button
            type="button"
            onClick={() => setLines((p) => p.map((x) => ({ ...x, removed: false })))}
            className="cursor-pointer text-xs text-cream-400 transition-colors hover:text-brass-300"
          >
            Include all
          </button>
          <button
            type="button"
            onClick={() => setLines((p) => p.map((x) => ({ ...x, removed: true })))}
            className="cursor-pointer text-xs text-cream-400 transition-colors hover:text-brass-300"
          >
            Clear all
          </button>
        </div>
      </div>

      {/* Grouped by the component the line was estimated under, so the reviewer
          reads "Kitchen" before its parts rather than 59 items in a single run. */}
      <div className="mt-6 space-y-6">
        {groups.map((g) => (
          <div key={g.key}>
            <div className="flex items-center justify-between gap-3 rounded-xl bg-night-800/50 px-4 py-2.5">
              <span className="text-xs font-medium uppercase tracking-wider text-brass-300">
                {g.label}
              </span>
              <span className="text-xs text-cream-300">
                {formatNaira(
                  g.rows
                    .filter((r) => !r.removed)
                    .reduce(
                      (s, r) => s + (Number(r.qty) || 0) * parseNairaInput(r.price),
                      0
                    )
                )}
              </span>
            </div>

            <div className="mt-2 space-y-2">
              {g.rows.map((l) => (
                <div
                  key={l.key}
                  className={`grid items-end gap-3 rounded-2xl border p-4 sm:grid-cols-[1.5rem_1fr_5rem_8rem_8rem] ${
                    l.removed
                      ? "border-night-800 bg-night-900/20"
                      : l.addedByReviewer
                        ? "border-amber-500/30 bg-amber-500/5"
                        : "border-night-700/60 bg-night-900/40"
                  }`}
                >
                  {/* A checkbox rather than a bin: including a line is a judgement
                      the reviewer makes item by item, and a tick shows the current
                      answer at a glance where an icon only offers an action. */}
                  <div className="flex items-center pb-2.5">
                    <input
                      id={`inc-${l.key}`}
                      type="checkbox"
                      checked={!l.removed}
                      onChange={(e) =>
                        setLines((p) =>
                          p.map((x) =>
                            x.key === l.key ? { ...x, removed: !e.target.checked } : x
                          )
                        )
                      }
                      aria-label={`Include ${l.item || "this line"}`}
                      title={l.removed ? "Not on the estimate" : "Included"}
                      className="h-4 w-4 cursor-pointer accent-brass-500"
                    />
                  </div>

                  <div className={`min-w-0 ${l.removed ? "opacity-50" : ""}`}>
                    <p className="text-xs uppercase tracking-wider text-cream-600">
                      {l.addedByReviewer ? "Added by you" : `Line ${l.index}`}
                    </p>
                    {l.id ? (
                      <p
                        className={`mt-0.5 text-sm text-cream-100 ${
                          l.removed ? "line-through" : ""
                        }`}
                      >
                        {l.item}
                      </p>
                    ) : (
                      <input
                        value={l.item}
                        onChange={(e) =>
                          setLines((p) =>
                            p.map((x) =>
                              x.key === l.key ? { ...x, item: e.target.value } : x
                            )
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
                      setLines((p) =>
                        p.map((x) => (x.key === l.key ? { ...x, qty: v } : x))
                      )
                    }
                  />
                  <Field
                    label="Unit (₦)"
                    value={l.price}
                    disabled={l.removed}
                    onChange={(v) =>
                      setLines((p) =>
                        p.map((x) => (x.key === l.key ? { ...x, price: v } : x))
                      )
                    }
                  />
                  <div>
                    <p className="mb-1.5 text-xs text-cream-500">Amount</p>
                    <p
                      className={`py-2 text-right text-sm ${
                        l.removed ? "text-cream-600 line-through" : "text-brass-300"
                      }`}
                    >
                      {formatNaira(
                        (Number(l.qty) || 0) * parseNairaInput(l.price)
                      )}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* Adding is offered per component, not once at the foot of the page. A new
          line has to belong somewhere, and the group the reviewer clicked under is
          the only reliable statement of where — a single button at the bottom left
          the server guessing, and it guessed the first component every time. */}
      <div className="mt-6 flex flex-wrap gap-2">
        {addTargets.map((t) => (
          <button
            key={t.componentId}
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
                  componentId: t.componentId,
                  component: t.label,
                },
              ])
            }
            className="flex cursor-pointer items-center gap-2 rounded-xl border border-night-600 bg-night-900/40 px-3.5 py-2 text-sm text-brass-300 transition-colors hover:border-brass-500/50 hover:text-brass-200"
          >
            <Plus size={14} /> Add to {t.label}
          </button>
        ))}
      </div>

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

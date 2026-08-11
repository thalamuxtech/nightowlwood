"use client";

import { useEffect, useState } from "react";
import { getDb } from "@/lib/firebase";
import { JOB_STATUS_LABELS, type JobStatus } from "@/lib/erp/enums";
import { formatNaira } from "@/lib/erp/money";
import { loadCustomerProfile, type CustomerProfile } from "@/lib/erp/customers";
import { BOARD_TYPE_LABELS, COUNTED_BOARD_TYPES } from "@/lib/erp/enums";
import { Loader2 } from "lucide-react";

/**
 * One customer's whole position: money, their stock, and a history.
 *
 * The question asked at the counter is "where do we stand with this man?", and answering it
 * previously meant opening jobs, invoices, payments and the board stack separately and
 * holding four numbers in your head. In practice nobody did, so the answer was whatever
 * somebody remembered.
 *
 * Loaded on demand rather than for every row in the directory: the profile reads six
 * collections, and doing that for a list of hundreds would be hundreds of round trips to
 * render a page nobody asked to see in detail.
 */
export function CustomerProfilePanel({ customerId }: { customerId: string }) {
  const [profile, setProfile] = useState<CustomerProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let live = true;
    setLoading(true);
    loadCustomerProfile(getDb(), customerId)
      .then((p) => {
        if (live) setProfile(p);
      })
      .catch((e) => {
        if (live) {
          setError(
            e instanceof Error ? e.message : "Could not read this customer's record."
          );
        }
      })
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
    };
  }, [customerId]);

  if (loading) {
    return (
      <div className="mt-4 flex justify-center border-t border-night-800 py-6">
        <Loader2 className="animate-spin text-brass-400" size={20} aria-label="Loading" />
      </div>
    );
  }

  if (error) {
    return (
      <p className="mt-4 border-t border-night-800 pt-4 text-sm text-red-400">{error}</p>
    );
  }

  if (!profile) {
    return (
      <p className="mt-4 border-t border-night-800 pt-4 text-sm text-cream-500">
        Nothing recorded for this customer yet.
      </p>
    );
  }

  const { netBalanceKobo } = profile;

  return (
    <div className="mt-4 space-y-5 border-t border-night-800 pt-4">
      {/* Money, both ways. A customer who overpaid is a creditor, and that is a real
          liability rather than a rounding oddity. */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Figure
          label={netBalanceKobo >= 0 ? "Owes us" : "We owe them"}
          value={formatNaira(Math.abs(netBalanceKobo))}
          tone={netBalanceKobo > 0 ? "warn" : netBalanceKobo < 0 ? "danger" : undefined}
          hint={
            profile.owedToUsFromUninvoicedJobsKobo > 0
              ? `${formatNaira(profile.owedToUsFromInvoicesKobo)} invoiced · ${formatNaira(
                  profile.owedToUsFromUninvoicedJobsKobo
                )} not yet billed`
              : undefined
          }
        />
        <Figure
          label="Boards held"
          value={String(profile.totalRemainingBoards)}
          hint={
            profile.totalRemainingTape > 0
              ? `${profile.totalRemainingTape} roll(s) of tape`
              : undefined
          }
        />
        <Figure
          label="Charged to date"
          value={formatNaira(profile.lifetimeChargedKobo)}
          hint={`${profile.counts.jobs} job(s) · ${profile.counts.invoices} invoice(s)`}
        />
        <Figure
          label="Paid to date"
          value={formatNaira(profile.lifetimePaidKobo)}
          hint={
            profile.counts.openJobs > 0
              ? `${profile.counts.openJobs} job(s) still open`
              : undefined
          }
        />
      </div>

      {/* Their stock, per job. Their property, which the workshop is answerable for. */}
      {profile.stock.length > 0 && (
        <div>
          <p className="text-xs uppercase tracking-wider text-cream-500">
            Their boards on site
          </p>
          <div className="mt-2 overflow-x-auto">
            <table className="w-full min-w-[34rem] text-left text-xs">
              <thead className="text-cream-600">
                <tr>
                  <th className="pb-2 font-medium">Job</th>
                  <th className="pb-2 font-medium">What came in</th>
                  <th className="pb-2 text-right font-medium">In</th>
                  <th className="pb-2 text-right font-medium">Used</th>
                  <th className="pb-2 text-right font-medium">Left</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-night-800/70">
                {profile.stock.map((s) => (
                  <tr key={s.jobId}>
                    <td className="py-2 text-cream-300">
                      {s.jobNumber}
                      <span className="mt-0.5 block text-cream-600">
                        {JOB_STATUS_LABELS[s.status as JobStatus] ?? s.status}
                      </span>
                    </td>
                    {/* The per-material breakdown, in counting order — this is what a
                        customer reads back when they collect. */}
                    <td className="py-2 text-cream-500">
                      {COUNTED_BOARD_TYPES.filter(
                        (t) => (s.boards[t] ?? 0) > 0
                      )
                        .map((t) => `${s.boards[t]} ${BOARD_TYPE_LABELS[t]}`)
                        .join(", ") || "—"}
                    </td>
                    <td className="py-2 text-right tabular-nums text-cream-300">
                      {s.receivedBoards}
                    </td>
                    <td className="py-2 text-right tabular-nums text-cream-300">
                      {s.cutBoards}
                    </td>
                    <td className="py-2 text-right">
                      <span
                        className={`font-medium tabular-nums ${
                          s.remainingBoards > 0 ? "text-brass-300" : "text-cream-600"
                        }`}
                      >
                        {s.remainingBoards}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* The history, in one timeline. A dispute can be walked through in order rather
          than reconstructed from four screens. */}
      {profile.ledger.length > 0 && (
        <div>
          <p className="text-xs uppercase tracking-wider text-cream-500">History</p>
          <ul className="mt-2 space-y-1.5">
            {profile.ledger.slice(0, 40).map((e) => (
              <li
                key={`${e.kind}-${e.id}`}
                className="flex flex-wrap items-baseline justify-between gap-3 text-xs"
              >
                <span className="min-w-0 text-cream-400">
                  <span className="text-cream-600">
                    {e.at
                      ? new Date(e.at).toLocaleDateString("en-GB", {
                          day: "numeric",
                          month: "short",
                          year: "2-digit",
                        })
                      : "—"}
                  </span>
                  <span className="mx-1.5 text-cream-700">·</span>
                  {e.reference && (
                    <span className="text-cream-300">{e.reference} </span>
                  )}
                  {e.description}
                </span>
                <span className="tabular-nums">
                  {e.chargeKobo > 0 && (
                    <span className="text-cream-300">{formatNaira(e.chargeKobo)}</span>
                  )}
                  {e.paidKobo > 0 && (
                    <span className="ml-3 text-emerald-300">
                      +{formatNaira(e.paidKobo)}
                    </span>
                  )}
                </span>
              </li>
            ))}
          </ul>
          {profile.ledger.length > 40 && (
            <p className="mt-2 text-xs text-cream-600">
              Showing the 40 most recent of {profile.ledger.length} entries.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function Figure({
  label,
  value,
  tone,
  hint,
}: {
  label: string;
  value: string;
  tone?: "warn" | "danger";
  hint?: string;
}) {
  const colour =
    tone === "danger" ? "text-red-300" : tone === "warn" ? "text-amber-300" : "text-cream-50";
  return (
    <div className="rounded-xl border border-night-700/60 bg-night-950/40 p-3">
      <p className="text-[0.65rem] uppercase tracking-wider text-cream-600">{label}</p>
      <p className={`mt-1 font-display text-lg ${colour}`}>{value}</p>
      {hint && <p className="mt-0.5 text-[0.65rem] leading-snug text-cream-600">{hint}</p>}
    </div>
  );
}

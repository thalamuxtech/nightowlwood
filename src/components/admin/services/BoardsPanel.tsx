"use client";

import { Fragment, useCallback, useEffect, useState } from "react";
import { AlertTriangle, Layers, Loader2, RefreshCw } from "lucide-react";
import { getDb } from "@/lib/firebase";
import { reconcileBoards, type JobBoardRow } from "@/lib/erp/boards";
import type { BoardReconciliation } from "@/lib/erp/types";
import { EmptyState } from "@/components/admin/ui/Fields";

/**
 * Boards received against boards cut, per customer.
 *
 * These boards belong to the customer — the workshop is holding them — and "how many of
 * mine have you still got?" previously had no answer except walking to the stack and
 * counting it.
 *
 * Everything here is derived: received from the jobs' board counts, cut from the work
 * logs against those jobs. Nothing is stored, because a stored remainder would drift
 * from the two records it is the difference between, and drift in a figure about
 * someone else's property is the worst kind to have.
 */
export function BoardsPanel() {
  const [byCustomer, setByCustomer] = useState<BoardReconciliation[]>([]);
  const [byJob, setByJob] = useState<JobBoardRow[]>([]);
  const [unattributed, setUnattributed] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const r = await reconcileBoards(getDb());
      setByCustomer(r.byCustomer);
      setByJob(r.byJob);
      setUnattributed(r.unattributedCutBoards);
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Could not work out the board figures."
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const overCut = byCustomer.filter((c) => (c.overCut ?? 0) > 0);

  return (
    <section className="mt-10">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 font-display text-lg text-cream-100">
            <Layers size={18} className="text-brass-400" /> Boards held per customer
          </h2>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-cream-400">
            Received minus cut. Worked out from the job records and the work logs, so it
            always agrees with both.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          disabled={loading}
          className="flex cursor-pointer items-center gap-1.5 text-xs text-cream-400 transition-colors hover:text-brass-300 disabled:opacity-50"
        >
          <RefreshCw size={13} className={loading ? "animate-spin" : ""} /> Refresh
        </button>
      </div>

      {error && (
        <p role="alert" className="mt-4 text-sm text-red-400">
          {error}
        </p>
      )}

      {/* A customer whose cut count exceeds what they brought in is a data fault, not
          a fact about boards. Surfaced rather than clamped away, because the cause is
          usually a mis-keyed unit count that is still correctable. */}
      {overCut.length > 0 && (
        <p className="mt-4 flex items-start gap-2 rounded-xl border border-amber-500/40 bg-amber-500/5 px-4 py-3 text-sm text-amber-300">
          <AlertTriangle size={16} className="mt-0.5 shrink-0" />
          <span>
            More boards are logged as cut than were received for{" "}
            {overCut.map((c) => c.customerName).join(", ")}. Check the unit counts on
            those work logs, or whether boards were received without being entered.
          </span>
        </p>
      )}

      {unattributed > 0 && (
        <p className="mt-3 text-xs leading-relaxed text-cream-500">
          {unattributed} board{unattributed === 1 ? "" : "s"} were cut on work logs with
          no job attached, so they cannot be set against any customer&rsquo;s stack.
          Selecting a job when logging work is what makes those count.
        </p>
      )}

      {loading ? (
        <div className="mt-6 flex justify-center py-8">
          <Loader2 className="animate-spin text-brass-400" size={22} aria-label="Loading" />
        </div>
      ) : byCustomer.length === 0 ? (
        <div className="mt-5">
          <EmptyState
            title="No boards recorded"
            hint="Board counts come from the job intake form. Once jobs record what came in, the remainder appears here."
          />
        </div>
      ) : (
        <div className="mt-5 overflow-x-auto rounded-3xl border border-night-700/60">
          <table className="w-full min-w-[40rem] text-left text-sm">
            <thead className="bg-night-900/70 text-xs uppercase tracking-wider text-cream-500">
              <tr>
                <th className="px-5 py-3 font-medium">Customer</th>
                <th className="px-5 py-3 text-right font-medium">Received</th>
                <th className="px-5 py-3 text-right font-medium">Cut</th>
                <th className="px-5 py-3 text-right font-medium">Remaining</th>
                <th className="px-5 py-3 text-right font-medium">Jobs</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-night-800">
              {byCustomer.map((c) => {
                const open = expanded === c.customerId;
                const jobs = byJob.filter((j) => j.customerId === c.customerId);
                return (
                  <Fragment key={c.customerId}>
                    <tr
                      onClick={() => setExpanded(open ? null : c.customerId)}
                      className="cursor-pointer transition-colors hover:bg-night-900/40"
                    >
                      <td className="px-5 py-3.5 text-cream-100">
                        {c.customerName}
                        {(c.overCut ?? 0) > 0 && (
                          <span className="mt-0.5 flex items-center gap-1 text-xs text-amber-300">
                            <AlertTriangle size={11} /> {c.overCut} over-cut
                          </span>
                        )}
                      </td>
                      <td className="px-5 py-3.5 text-right tabular-nums text-cream-300">
                        {c.receivedBoards}
                      </td>
                      <td className="px-5 py-3.5 text-right tabular-nums text-cream-300">
                        {c.cutBoards}
                      </td>
                      <td className="px-5 py-3.5 text-right">
                        <span
                          className={`font-display text-lg ${
                            c.remainingBoards > 0 ? "text-brass-300" : "text-cream-500"
                          }`}
                        >
                          {c.remainingBoards}
                        </span>
                      </td>
                      <td className="px-5 py-3.5 text-right text-xs text-cream-500">
                        {c.jobCount}
                        {c.openJobCount > 0 && (
                          <span className="text-cream-400"> · {c.openJobCount} open</span>
                        )}
                      </td>
                    </tr>
                    {/* Per job, so a discrepancy can be traced to the job that caused
                        it rather than only to the customer. */}
                    {open && jobs.length > 0 && (
                      <tr className="bg-night-950/40">
                        <td colSpan={5} className="px-5 py-3">
                          <ul className="space-y-1.5 text-xs">
                            {jobs.map((j) => (
                              <li
                                key={j.jobId}
                                className="flex flex-wrap justify-between gap-3"
                              >
                                <span className="text-cream-400">
                                  {j.jobNumber}
                                  <span className="ml-2 text-cream-600">{j.status}</span>
                                </span>
                                <span className="tabular-nums text-cream-400">
                                  {j.receivedBoards} in · {j.cutBoards} cut ·{" "}
                                  <span className="text-cream-200">
                                    {j.remainingBoards} left
                                  </span>
                                  {j.overCut > 0 && (
                                    <span className="ml-2 text-amber-300">
                                      {j.overCut} over
                                    </span>
                                  )}
                                </span>
                              </li>
                            ))}
                          </ul>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <p className="mt-4 text-xs leading-relaxed text-cream-600">
        Only board-consuming work counts as cutting one: cutting, cutting &amp; edging
        and special boards. Grooving and glass are measured in millimetres of run, and a
        mortise is an operation on a board already counted, so including them would
        subtract thousands of &ldquo;boards&rdquo; from a stack of forty. Edge tape is
        measured in rolls and is not counted as a board.
      </p>
    </section>
  );
}

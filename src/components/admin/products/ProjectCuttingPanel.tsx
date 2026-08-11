"use client";

import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Lock, Scissors } from "lucide-react";
import { getDb } from "@/lib/firebase";
import {
  BOARD_TYPE_LABELS,
  CE_RATED_BOARD_TYPES,
  type BoardType,
} from "@/lib/erp/enums";
import { formatNaira } from "@/lib/erp/money";
import {
  boardRateCard,
  computeCuttingCharge,
  refreshCuttingFromCostItems,
} from "@/lib/erp/cutting";
import type { BoardBreakdown } from "@/lib/erp/types";
import type { BoardRateCardSettings } from "@/lib/erp/settings";
import { Button } from "@/components/admin/ui/Fields";

/**
 * Cutting &amp; edging on the estimate: derived, not typed.
 *
 * The one cost item nobody prices by hand. Its quantity is the boards entered here and its
 * rate comes from the Services cutting &amp; edging card, so the estimate charges whatever
 * the job charges — which is the point. Before this, C&amp;E was keyed twice at whatever
 * figure the person quoting remembered, and the two disagreed on the document the client
 * sees.
 *
 * One line per material rather than a blended rate, because the rates genuinely differ:
 * Bangaji is more than twice MDF. Averaging them would overcharge the cheap boards and
 * undercharge the dear ones on every mixed job.
 */
export function ProjectCuttingPanel({
  projectId,
  boardCounts,
  canEdit,
  actor,
  onError,
  onSaved,
}: {
  projectId: string;
  boardCounts?: BoardBreakdown;
  canEdit: boolean;
  actor: { uid: string; email: string; role: "admin" | "manager" | "operator" };
  onError: (m: string) => void;
  onSaved?: (m: string) => void;
}) {
  const [card, setCard] = useState<BoardRateCardSettings | null>(null);
  const [busy, setBusy] = useState(false);
  /** Which component's cutting line the charge was written onto, after a recount. */
  const [billedTo, setBilledTo] = useState<string | undefined>(undefined);
  const [saved, setSaved] = useState(false);
  /** Board lines with no material chosen, which cannot be priced. */
  const [untyped, setUntyped] = useState<
    Array<{ componentName: string; item: string; quantity: number }>
  >([]);

  useEffect(() => {
    boardRateCard(getDb()).then(setCard).catch(() => {});
  }, []);

  /**
   * The charge, computed from the counts stored on the project.
   *
   * Same function the write path uses, so what is shown is what was billed. The counts come
   * from the last recount rather than from live edits — there is nothing to type here.
   */
  const charge = useMemo(() => {
    if (!card) return null;
    const asNumbers: Partial<Record<BoardType, number>> = {};
    for (const [k, v] of Object.entries(
      (boardCounts ?? {}) as Record<string, number>
    )) {
      if (Number.isFinite(v) && v > 0) asNumbers[k as BoardType] = v;
    }
    return computeCuttingCharge(asNumbers, card.ratesKobo);
  }, [boardCounts, card]);

  /**
   * Recounts the boards from the cost items and reprices the cutting line.
   *
   * Manual entry is gone: the boards are the ones ticked on the cost items, so there is one
   * set of board figures on the project and it is the set being bought. Recounting is
   * explicit rather than automatic on every keystroke, because it rewrites a priced estimate
   * line and that should happen when somebody says so.
   */
  async function recount() {
    setBusy(true);
    try {
      const res = await refreshCuttingFromCostItems(getDb(), actor, projectId);
      setBilledTo(res.billedToComponent);
      setUntyped(res.untypedLines);
      setSaved(true);
      onSaved?.(
        `${res.totalBoards} board(s) · cutting & edging ${formatNaira(res.totalKobo)}` +
          (res.billedToComponent
            ? ` billed on ${res.billedToComponent}.`
            : " — but no cutting line exists to bill it on.")
      );
    } catch (e) {
      onError(e instanceof Error ? e.message : "Could not recount the boards.");
    } finally {
      setBusy(false);
    }
  }

  const hasCounts = (charge?.totalBoards ?? 0) > 0;

  return (
    <section className="mt-8 rounded-3xl border border-night-700/60 bg-night-900/30 p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 font-display text-lg text-cream-100">
            <Scissors size={18} className="text-brass-400" /> Cutting &amp; edging
            <span
              title="Derived from the board cost items and the Services rate card. Not typed."
              className="flex items-center gap-1 rounded-full border border-night-600 px-2 py-0.5 text-[11px] font-normal text-cream-500"
            >
              <Lock size={10} /> derived
            </span>
          </h2>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-cream-400">
            Counted from the cost items ticked as <span className="text-cream-200">Boards</span>{" "}
            above, priced at the cutting rate for each material from Services. Nothing here is
            typed, so the estimate and the job cannot disagree.
          </p>
        </div>
        {canEdit && (
          <Button variant="secondary" busy={busy} onClick={recount}>
            Recount from cost items
          </Button>
        )}
      </div>

      {/* A line ticked as boards with no material chosen contributes nothing to the charge,
          and the estimate would be short by its whole value. Named so it can be fixed. */}
      {untyped.length > 0 && (
        <p className="mt-4 flex items-start gap-2 rounded-xl border border-amber-500/50 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
          <AlertTriangle size={16} className="mt-0.5 shrink-0" />
          <span>
            {untyped.length} line{untyped.length === 1 ? "" : "s"} ticked as boards with no
            material chosen, so {untyped.length === 1 ? "it is" : "they are"} not being priced:{" "}
            {untyped
              .slice(0, 4)
              .map((u) => `${u.item} (${u.componentName})`)
              .join(", ")}
            {untyped.length > 4 && `, and ${untyped.length - 4} more`}. Pick the board type on
            those lines and recount.
          </span>
        </p>
      )}

      {!hasCounts ? (
        <p className="mt-5 text-sm text-cream-500">
          No cost items are ticked as boards yet, so there is no cutting charge. Tick{" "}
          <span className="text-cream-300">Boards</span> on the board lines above, choose the
          material, then recount.
        </p>
      ) : (
        <>
          <div className="mt-5 overflow-x-auto">
            <table className="w-full min-w-[30rem] text-left text-sm">
              <thead className="text-xs uppercase tracking-wider text-cream-500">
                <tr>
                  <th className="pb-3 font-medium">Board</th>
                  <th className="pb-3 text-right font-medium">Boards</th>
                  <th className="pb-3 text-right font-medium">Rate</th>
                  <th className="pb-3 text-right font-medium">Amount</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-night-800">
                {charge?.lines.map((l) => (
                  <tr key={l.boardType}>
                    <td className="py-2.5 text-cream-200">{l.label}</td>
                    <td className="py-2.5 text-right tabular-nums text-cream-300">
                      {l.quantity}
                    </td>
                    <td className="py-2.5 text-right tabular-nums text-cream-400">
                      {l.rateMissing ? (
                        <span className="text-amber-300">no rate</span>
                      ) : (
                        formatNaira(l.ratePerBoardKobo)
                      )}
                    </td>
                    <td className="py-2.5 text-right tabular-nums text-cream-100">
                      {formatNaira(l.amountKobo)}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t border-night-700">
                  <td className="pt-3 text-cream-300">
                    {charge?.totalBoards} board{charge?.totalBoards === 1 ? "" : "s"}
                  </td>
                  <td />
                  <td />
                  <td className="pt-3 text-right">
                    <span className="font-display text-lg text-brass-300">
                      {formatNaira(charge?.totalKobo ?? 0)}
                    </span>
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>

          {/* A board type with a count but no rate prices at nothing, and the first anyone
              would know is the invoice. Said plainly instead. */}
          {(charge?.unratedBoardTypes.length ?? 0) > 0 && (
            <p className="mt-4 flex items-start gap-2 rounded-xl border border-amber-500/40 bg-amber-500/5 px-4 py-3 text-sm text-amber-300">
              <AlertTriangle size={16} className="mt-0.5 shrink-0" />
              <span>
                No cutting rate is set for{" "}
                {charge?.unratedBoardTypes
                  .map((t) => BOARD_TYPE_LABELS[t])
                  .join(", ")}
                , so those boards are priced at nothing. Set the rate under Settings →
                Cutting &amp; edging.
              </span>
            </p>
          )}

          {/* Where the figure lands. Saying so matters: it *is* part of the estimate
              total, written onto the component's cutting line, which is what makes it
              reach the invoice. */}
          <p className="mt-4 text-xs leading-relaxed text-cream-600">
            {billedTo
              ? `Written onto the "Cutting & Edging" line on ${billedTo}, so it is part of the estimate total and is billed with it. `
              : "This is written onto the project's “Cutting & Edging” line when saved, which is what puts it on the estimate and the invoice. "}
            Change it by changing the board counts or the rate card, never by typing over
            the line itself.
          </p>

          {/* A project with no cutting row anywhere has nothing to bill the charge on.
              Components created from a category template always have one; a hand-built
              component may not. */}
          {saved && !billedTo && (
            <p className="mt-3 flex items-start gap-2 rounded-xl border border-amber-500/40 bg-amber-500/5 px-4 py-3 text-sm text-amber-300">
              <AlertTriangle size={16} className="mt-0.5 shrink-0" />
              <span>
                No &ldquo;Cutting &amp; Edging&rdquo; line exists on any component, so this
                charge is recorded but <strong className="font-medium">not billed</strong>.
                Add a line called &ldquo;Cutting &amp; Edging&rdquo; to a component and save
                the boards again.
              </span>
            </p>
          )}
        </>
      )}
    </section>
  );
}

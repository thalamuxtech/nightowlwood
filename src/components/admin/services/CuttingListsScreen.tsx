"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ExternalLink, Loader2, Printer, Ruler, ShieldAlert } from "lucide-react";
import { getDb } from "@/lib/firebase";
import { BOARD_TYPE_LABELS } from "@/lib/erp/enums";
import {
  CUTTING_LIST_STATUS_LABELS,
  EDGE_CODE_META,
  loadCuttingLists,
  verifyCuttingListTotals,
  setCuttingListStatus,
  type CuttingListRow,
  type CuttingListStatus,
} from "@/lib/erp/cuttingList";
import { StatusPill } from "@/components/admin/ui/StatusPill";
import { Button, EmptyState } from "@/components/admin/ui/Fields";
import { PrintPreview } from "@/components/admin/ui/PrintPreview";
import { CuttingListSheet } from "@/components/admin/print/CuttingListSheet";
import { useAuditActor, useErpSession } from "@/components/admin/ErpAuthProvider";

const STATUS_TONE: Record<CuttingListStatus, "neutral" | "info" | "progress" | "positive"> = {
  draft: "neutral",
  submitted: "info",
  in_production: "progress",
  completed: "positive",
};

/**
 * Cutting lists that have come in.
 *
 * Mostly submitted by customers through the public link, which is the point — the list arrives
 * complete, in their own words, and does not depend on a piece of paper surviving the journey.
 * Staff read it, print it for the saw, and move it through production.
 */
export function CuttingListsScreen() {
  const session = useErpSession();
  const canEdit = session.can("job.edit");

  const [rows, setRows] = useState<CuttingListRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const [filter, setFilter] = useState<CuttingListStatus | "all">("submitted");
  const [printing, setPrinting] = useState<CuttingListRow | null>(null);
  const [printNow, setPrintNow] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setRows(await loadCuttingLists(getDb()));
      setError("");
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Could not load the cutting lists."
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const actor = useAuditActor();

  const visible = useMemo(
    () => (filter === "all" ? rows : rows.filter((r) => r.status === filter)),
    [rows, filter]
  );

  /**
   * Recomputed totals for the lists that came in through the public link.
   *
   * The stored totals are attacker-controllable on those, and the rules cannot recompute them —
   * so they are checked here. Staff lists are skipped: their totals were computed by this same
   * code on the way in, and re-checking them would only add noise.
   */
  const checked = useMemo(() => {
    const map = new Map<string, ReturnType<typeof verifyCuttingListTotals>>();
    for (const r of rows) {
      if (r.submittedByCustomer) map.set(r.id, verifyCuttingListTotals(r));
    }
    return map;
  }, [rows]);

  const waiting = rows.filter((r) => r.status === "submitted").length;

  async function move(row: CuttingListRow, status: CuttingListStatus) {
    try {
      await setCuttingListStatus(getDb(), actor, row.id, row.listNumber, status);
      setNotice(`${row.listNumber} → ${CUTTING_LIST_STATUS_LABELS[status]}.`);
      setTimeout(() => setNotice(""), 5000);
      void load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not update the list.");
    }
  }

  if (!session.ready) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center">
        <Loader2 className="animate-spin text-brass-400" size={28} aria-label="Loading" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl pb-20">
      {printing && (
        <PrintPreview
          title={`Cutting list ${printing.listNumber}`}
          paper="a4-portrait"
          onPrint={() => setPrintNow(true)}
          onClose={() => setPrinting(null)}
        >
          <CuttingListSheet list={printing} autoPrint={false} onDone={() => {}} />
        </PrintPreview>
      )}
      {printNow && printing && (
        <CuttingListSheet
          list={printing}
          onDone={() => {
            setPrintNow(false);
            setPrinting(null);
          }}
        />
      )}

      <div className="print:hidden">
        <header className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-eyebrow">Services</p>
            <h1 className="text-title mt-3 text-cream-50">Cutting lists</h1>
            <p className="mt-3 max-w-2xl text-sm leading-relaxed text-cream-400">
              Panel lists sent in by customers, with the boards and banding already worked out.
              Print one for the saw and move it through as it is cut.
            </p>
          </div>
          <a
            href="/cutting-list/"
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-1.5 text-xs text-cream-400 transition-colors hover:text-brass-300"
          >
            <ExternalLink size={13} /> Open the customer form
          </a>
        </header>

        {error && (
          <p
            role="alert"
            className="mt-6 flex items-start gap-2 rounded-xl border border-red-500/30 bg-red-500/5 px-4 py-3 text-sm text-red-400"
          >
            <ShieldAlert size={16} className="mt-0.5 shrink-0" /> {error}
          </p>
        )}
        {notice && (
          <p role="status" className="mt-6 text-sm text-emerald-300">
            {notice}
          </p>
        )}

        <div className="mt-8 flex flex-wrap gap-2">
          <Chip
            active={filter === "submitted"}
            onClick={() => setFilter("submitted")}
            label={waiting > 0 ? `Waiting (${waiting})` : "Waiting"}
          />
          <Chip
            active={filter === "in_production"}
            onClick={() => setFilter("in_production")}
            label="In production"
          />
          <Chip
            active={filter === "completed"}
            onClick={() => setFilter("completed")}
            label="Completed"
          />
          <Chip active={filter === "all"} onClick={() => setFilter("all")} label="All" />
        </div>

        {loading ? (
          <div className="mt-10 flex justify-center py-10">
            <Loader2 className="animate-spin text-brass-400" size={26} aria-label="Loading" />
          </div>
        ) : visible.length === 0 ? (
          <div className="mt-8">
            <EmptyState
              title={rows.length === 0 ? "No cutting lists yet" : "Nothing at this stage"}
              hint={
                rows.length === 0
                  ? "Customers can send one from the link in the website footer, and it appears here complete."
                  : undefined
              }
            />
          </div>
        ) : (
          <ul className="mt-6 space-y-3">
            {visible.map((r) => (
              <li
                key={r.id}
                className="rounded-2xl border border-night-700/60 bg-night-900/40 p-5"
              >
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div className="min-w-0">
                    <p className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-sm text-brass-300">
                        {r.listNumber}
                      </span>
                      <StatusPill tone={STATUS_TONE[r.status]}>
                        {CUTTING_LIST_STATUS_LABELS[r.status]}
                      </StatusPill>
                      {/* Worth knowing: a customer-typed list may need its figures
                          confirmed before anything is cut. */}
                      {r.submittedByCustomer && (
                        <span className="rounded-full border border-night-600 px-2 py-0.5 text-[11px] text-cream-500">
                          from customer
                        </span>
                      )}
                      {/* A customer-submitted list whose stored totals do not match its
                          parts. Flagged loudly, because ordering two boards for a job that
                          needs two hundred is what happens if the figure is believed. */}
                      {checked.get(r.id)?.agrees === false && (
                        <StatusPill tone="warn">figures disagree</StatusPill>
                      )}
                    </p>
                    <p className="mt-1.5 text-sm text-cream-200">
                      {r.customerName}
                      {r.customerPhone && (
                        <span className="text-cream-500"> · {r.customerPhone}</span>
                      )}
                    </p>
                    <p className="mt-0.5 text-xs text-cream-500">
                      {r.title ? `${r.title} · ` : ""}
                      {r.totals.panelCount} panel
                      {r.totals.panelCount === 1 ? "" : "s"} ·{" "}
                      {r.totals.totalBoardsRequired} board
                      {r.totals.totalBoardsRequired === 1 ? "" : "s"} ·{" "}
                      {r.totals.totalTapeMetres}m banding
                      {r.submittedAtMs
                        ? ` · ${new Date(r.submittedAtMs).toLocaleDateString("en-GB", {
                            day: "numeric",
                            month: "short",
                          })}`
                        : ""}
                    </p>
                  </div>

                  <div className="flex flex-wrap items-center gap-3">
                    <button
                      type="button"
                      onClick={() => setOpenId(openId === r.id ? null : r.id)}
                      className="cursor-pointer text-xs text-cream-400 transition-colors hover:text-brass-300"
                    >
                      {openId === r.id ? "Hide parts" : `${r.parts.length} parts`}
                    </button>
                    <button
                      type="button"
                      aria-label={`Print ${r.listNumber}`}
                      onClick={() => setPrinting(r)}
                      className="cursor-pointer text-cream-400 transition-colors hover:text-brass-300"
                    >
                      <Printer size={15} />
                    </button>
                    {canEdit && r.status === "submitted" && (
                      <Button
                        variant="secondary"
                        onClick={() => move(r, "in_production")}
                      >
                        Start cutting
                      </Button>
                    )}
                    {canEdit && r.status === "in_production" && (
                      <Button onClick={() => move(r, "completed")}>Mark cut</Button>
                    )}
                  </div>
                </div>

                {/* What disagrees, and the figures to trust. Shown outside the parts panel
                    so it is visible without expanding the row. */}
                {checked.get(r.id)?.agrees === false && (
                  <p className="mt-3 flex items-start gap-2 rounded-xl border border-amber-500/50 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
                    <ShieldAlert size={16} className="mt-0.5 shrink-0" />
                    <span>
                      The totals sent with this list do not match its parts —{" "}
                      {checked.get(r.id)!.differences.join("; ")}. Work from the recomputed
                      figures:{" "}
                      <strong className="font-medium">
                        {checked.get(r.id)!.recomputed.totalBoardsRequired} board(s),{" "}
                        {checked.get(r.id)!.recomputed.totalTapeMetres}m banding
                      </strong>
                      . Confirm with the customer before cutting.
                    </span>
                  </p>
                )}

                {openId === r.id && (
                  <div className="mt-4 overflow-x-auto border-t border-night-800 pt-4">
                    <table className="w-full min-w-[40rem] text-left text-xs">
                      <thead className="text-cream-600">
                        <tr>
                          <th className="pb-2 font-medium">Part</th>
                          <th className="pb-2 text-right font-medium">W×L (mm)</th>
                          <th className="pb-2 text-right font-medium">Qty</th>
                          <th className="pb-2 font-medium">Board</th>
                          <th className="pb-2 font-medium">Edges</th>
                          <th className="pb-2 text-right font-medium">Tape</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-night-800/70">
                        {r.parts.map((p) => (
                          <tr key={p.id}>
                            <td className="py-2 text-cream-200">{p.part}</td>
                            <td className="py-2 text-right tabular-nums text-cream-300">
                              {p.widthMm} × {p.lengthMm}
                            </td>
                            <td className="py-2 text-right tabular-nums text-cream-300">
                              {p.quantity}
                            </td>
                            <td className="py-2 text-cream-400">
                              {p.boardType
                                ? BOARD_TYPE_LABELS[p.boardType]
                                : "—"}
                              {p.boardColour && (
                                <span className="text-cream-600"> {p.boardColour}</span>
                              )}
                            </td>
                            <td className="py-2 text-cream-400">
                              <span className="font-mono text-brass-300">
                                {EDGE_CODE_META[p.edgeCode]?.label ?? "—"}
                              </span>
                              <span className="ml-1.5 text-cream-600">
                                {EDGE_CODE_META[p.edgeCode]?.detail}
                              </span>
                            </td>
                            <td className="py-2 text-right text-cream-400">
                              {p.edgeCode === "none" ? "—" : `${p.edgeTapeMm}mm`}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>

                    <div className="mt-4 flex flex-wrap gap-x-8 gap-y-2 border-t border-night-800 pt-3 text-xs">
                      <Fig
                        label="Boards"
                        value={r.totals.boardsByType
                          .map((b) => `${b.boardsRequired} ${b.label}`)
                          .join(", ")}
                      />
                      <Fig
                        label="Banding"
                        value={Object.entries(r.totals.tapeMetresByWidth)
                          .map(([w, m]) => `${m}m @ ${w}mm`)
                          .join(", ")}
                      />
                      <Fig label="Blade offset" value={`${r.offsetMm}mm`} />
                      <Fig label="Waste allowance" value={`${r.wastePercent}%`} />
                    </div>

                    {r.notes && (
                      <p className="mt-3 rounded-xl border border-night-700/60 bg-night-950/40 p-3 text-xs text-cream-300">
                        {r.notes}
                      </p>
                    )}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}

        <p className="mt-8 flex items-start gap-2 text-xs leading-relaxed text-cream-600">
          <Ruler size={14} className="mt-0.5 shrink-0" />
          Boards required is an estimate from panel area plus the waste allowance, not a nesting
          calculation — the real count depends on how the operator lays the cuts out. Treat it as
          what to order, not what to cut to.
        </p>
      </div>
    </div>
  );
}

function Fig({ label, value }: { label: string; value: string }) {
  if (!value) return null;
  return (
    <div>
      <p className="text-cream-600">{label}</p>
      <p className="mt-0.5 text-cream-300">{value}</p>
    </div>
  );
}

function Chip({
  active,
  onClick,
  label,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`cursor-pointer rounded-full border px-4 py-2 text-xs font-medium transition-all duration-300 ${
        active
          ? "border-brass-500 bg-brass-500 text-night-950"
          : "border-night-600 text-cream-300 hover:border-brass-500/60 hover:text-brass-300"
      }`}
    >
      {label}
    </button>
  );
}

"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { collection, limit, onSnapshot, orderBy, query } from "firebase/firestore";
import {
  AlertTriangle,
  CheckCircle2,
  Loader2,
  PenLine,
  Printer,
  RefreshCw,
  ShieldAlert,
  Trash2,
  Wallet,
} from "lucide-react";
import { getDb } from "@/lib/firebase";
import { COL } from "@/lib/erp/collections";
import { WAGE_WORK_TYPE_LABELS, type WageRunStatus } from "@/lib/erp/enums";
import { formatNaira, parseNairaInput } from "@/lib/erp/money";
import {
  adjustWageRunStaff,
  approveWageRun,
  deleteDraftWageRun,
  markWageRunPaid,
  previewWageRun,
  saveDraftWageRun,
  type RunPreview,
} from "@/lib/erp/payroll";
import { weekBounds } from "@/lib/erp/wages";
import { WAGE_RUN_STATUS_TONE } from "@/lib/erp/statusTone";
import { StatusPill } from "@/components/admin/ui/StatusPill";
import { Button, EmptyState, NumberField } from "@/components/admin/ui/Fields";
import { useErpSession } from "@/components/admin/ErpAuthProvider";
import { PayslipSheet } from "./PayslipSheet";
import { PrintPreview } from "@/components/admin/ui/PrintPreview";

interface RunRow {
  id: string;
  periodStartMs: number | null;
  periodEndMs: number | null;
  status: WageRunStatus;
  grandTotalKobo: number;
  deductionsKobo: number;
  netPayableKobo: number;
  perStaff: Array<{
    staffId: string;
    staffName: string;
    operatorKobo: number;
    assistantKobo: number;
    totalKobo: number;
    deductionKobo: number;
    netKobo: number;
  }>;
}

function toDateInput(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * Weekly wage run. Admin only.
 *
 * Defaults to last week rather than the current one: a run is prepared after
 * the week's work is logged, so the current week is always incomplete.
 */
export function WageRunScreen() {
  const session = useErpSession();
  const isAdmin = session.role === "admin";

  const lastWeek = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() - 7);
    return weekBounds(d);
  }, []);

  const [start, setStart] = useState(toDateInput(lastWeek.start));
  const [end, setEnd] = useState(toDateInput(lastWeek.end));
  const [preview, setPreview] = useState<RunPreview | null>(null);
  const [runs, setRuns] = useState<RunRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  /** The draft whose per-staff figures are open for adjustment. */
  const [editRunId, setEditRunId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [previewRun, setPreviewRun] = useState<RunRow | null>(null);
  const [printRun, setPrintRun] = useState<RunRow | null>(null);

  useEffect(() => {
    if (!isAdmin) return;
    const q = query(
      collection(getDb(), COL.wageRuns),
      orderBy("periodStart", "desc"),
      limit(26)
    );
    return onSnapshot(
      q,
      (snap) =>
        setRuns(
          snap.docs.map((d) => {
            const x = d.data();
            return {
              id: d.id,
              periodStartMs: x.periodStart?.toMillis?.() ?? null,
              periodEndMs: x.periodEnd?.toMillis?.() ?? null,
              status: (x.status as WageRunStatus) ?? "draft",
              grandTotalKobo: x.grandTotalKobo ?? 0,
              deductionsKobo: x.deductionsKobo ?? 0,
              netPayableKobo: x.netPayableKobo ?? 0,
              perStaff: x.perStaff ?? [],
            };
          })
        ),
      (e) => setError(e.message)
    );
  }, [isAdmin]);

  const actor = useMemo(
    () => ({
      uid: session.user?.uid ?? "",
      email: session.user?.email ?? "",
      role: "admin" as const,
    }),
    [session.user]
  );

  const runPreview = useCallback(async () => {
    setLoading(true);
    setError("");
    setPreview(null);
    try {
      const p = await previewWageRun(getDb(), {
        periodStart: new Date(`${start}T00:00:00`),
        periodEnd: new Date(`${end}T23:59:59.999`),
      });
      setPreview(p);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not calculate the run.");
    } finally {
      setLoading(false);
    }
  }, [start, end]);

  async function saveDraft() {
    if (!preview) return;
    setBusy(true);
    setError("");
    try {
      await saveDraftWageRun(
        getDb(),
        actor,
        {
          periodStart: new Date(`${start}T00:00:00`),
          periodEnd: new Date(`${end}T23:59:59.999`),
        },
        preview
      );
      setPreview(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save the run.");
    } finally {
      setBusy(false);
    }
  }

  async function approve(id: string) {
    setBusy(true);
    setError("");
    try {
      await approveWageRun(getDb(), actor, id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not approve the run.");
    } finally {
      setBusy(false);
    }
  }

  async function discard(id: string) {
    setBusy(true);
    setError("");
    try {
      await deleteDraftWageRun(getDb(), actor, id);
      setEditRunId(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not discard the run.");
    } finally {
      setBusy(false);
    }
  }

  async function pay(id: string) {
    setBusy(true);
    setError("");
    try {
      await markWageRunPaid(getDb(), actor, id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not mark as paid.");
    } finally {
      setBusy(false);
    }
  }

  if (!session.ready) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center">
        <Loader2 className="animate-spin text-brass-400" size={28} aria-label="Loading" />
      </div>
    );
  }

  if (!isAdmin) {
    return (
      <div className="mx-auto max-w-lg rounded-3xl border border-red-500/30 bg-red-500/5 p-8 text-center">
        <ShieldAlert className="mx-auto text-red-400" size={30} />
        <h1 className="mt-4 font-display text-xl text-cream-100">Admin only</h1>
        <p className="mt-2 text-sm text-cream-400">
          Payroll is restricted to administrators.
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl pb-20">
      {previewRun && (
        <PrintPreview
          title="Payslips"
          paper="a4-portrait"
          onPrint={() => setPrintRun(previewRun)}
          onClose={() => setPreviewRun(null)}
        >
          <PayslipSheet
            periodStartMs={previewRun.periodStartMs}
            periodEndMs={previewRun.periodEndMs}
            perStaff={previewRun.perStaff}
            autoPrint={false}
            onDone={() => {}}
          />
        </PrintPreview>
      )}

      {printRun && (
        <PayslipSheet
          periodStartMs={printRun.periodStartMs}
          periodEndMs={printRun.periodEndMs}
          perStaff={printRun.perStaff}
          onDone={() => {
            setPrintRun(null);
            setPreviewRun(null);
          }}
        />
      )}

      <div className="print:hidden">
        <header>
          <p className="text-eyebrow">Payroll</p>
          <h1 className="text-title mt-3 text-cream-50">Wage runs</h1>
          <p className="mt-3 max-w-2xl text-sm leading-relaxed text-cream-400">
            Piece-rate wages for the week. Assistants are paid for the work they
            actually assisted on, taken from the named assistants on each work log.
          </p>
        </header>

        {error && (
          <p
            role="alert"
            className="mt-6 flex items-start gap-2 rounded-xl border border-red-500/30 bg-red-500/5 px-4 py-3 text-sm text-red-400"
          >
            <ShieldAlert size={16} className="mt-0.5 shrink-0" /> {error}
          </p>
        )}

        {/* Period picker */}
        <section className="mt-8 rounded-3xl border border-night-700/60 bg-night-900/30 p-6">
          <h2 className="font-display text-lg text-cream-100">Calculate a run</h2>
          <div className="mt-5 flex flex-wrap items-end gap-4">
            <div>
              <label htmlFor="run-start" className="mb-1.5 block text-sm text-cream-300">
                From
              </label>
              <input
                id="run-start"
                type="date"
                value={start}
                onChange={(e) => setStart(e.target.value)}
                className="rounded-xl border border-night-600 bg-night-800/60 px-4 py-3 text-cream-100 focus:border-brass-500 focus:outline-none"
              />
            </div>
            <div>
              <label htmlFor="run-end" className="mb-1.5 block text-sm text-cream-300">
                To
              </label>
              <input
                id="run-end"
                type="date"
                value={end}
                onChange={(e) => setEnd(e.target.value)}
                className="rounded-xl border border-night-600 bg-night-800/60 px-4 py-3 text-cream-100 focus:border-brass-500 focus:outline-none"
              />
            </div>
            <Button onClick={runPreview} busy={loading}>
              <span className="flex items-center gap-2">
                <RefreshCw size={15} /> Calculate
              </span>
            </Button>
          </div>
        </section>

        {preview && <PreviewPanel preview={preview} onSave={saveDraft} busy={busy} />}

        {/* Saved runs */}
        <section className="mt-10">
          <h2 className="font-display text-lg text-cream-100">Saved runs</h2>
          {runs.length === 0 ? (
            <div className="mt-5">
              <EmptyState
                title="No wage runs yet"
                hint="Calculate a period above, review it, then save it as a draft."
              />
            </div>
          ) : (
            <div className="mt-5 space-y-3">
              {runs.map((r) => (
                <div
                  key={r.id}
                  className="rounded-2xl border border-night-700/60 bg-night-900/40 p-5"
                >
                  <div className="flex flex-wrap items-center justify-between gap-4">
                    <div>
                      <p className="text-sm text-cream-100">
                        {r.periodStartMs
                          ? new Date(r.periodStartMs).toLocaleDateString("en-GB", {
                              day: "numeric",
                              month: "short",
                            })
                          : "?"}{" "}
                        to{" "}
                        {r.periodEndMs
                          ? new Date(r.periodEndMs).toLocaleDateString("en-GB", {
                              day: "numeric",
                              month: "short",
                              year: "numeric",
                            })
                          : "?"}
                      </p>
                      <p className="mt-1 text-xs text-cream-500">
                        {r.perStaff.length} staff · gross {formatNaira(r.grandTotalKobo)}
                        {r.deductionsKobo > 0 && ` · less ${formatNaira(r.deductionsKobo)}`}
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-3">
                      <span className="font-display text-xl text-cream-50">
                        {formatNaira(r.netPayableKobo)}
                      </span>
                      <StatusPill tone={WAGE_RUN_STATUS_TONE[r.status]}>
                        {r.status}
                      </StatusPill>
                      <button
                        type="button"
                        onClick={() => setPreviewRun(r)}
                        aria-label="Preview and print payslips"
                        className="cursor-pointer text-cream-400 transition-colors hover:text-brass-300"
                      >
                        <Printer size={16} />
                      </button>
                      {/* Only a draft is editable: approving is the point at which
                          the figures become a decision already taken. */}
                      {r.status === "draft" && (
                        <>
                          <button
                            type="button"
                            aria-label="Edit this draft"
                            onClick={() => setEditRunId(editRunId === r.id ? null : r.id)}
                            className="cursor-pointer text-cream-400 transition-colors hover:text-brass-300"
                          >
                            <PenLine size={16} />
                          </button>
                          <button
                            type="button"
                            aria-label="Discard this draft"
                            onClick={() => discard(r.id)}
                            className="cursor-pointer text-cream-500 transition-colors hover:text-red-400"
                          >
                            <Trash2 size={16} />
                          </button>
                          <Button onClick={() => approve(r.id)} busy={busy}>
                            Approve
                          </Button>
                        </>
                      )}
                      {r.status === "approved" && (
                        <Button variant="secondary" onClick={() => pay(r.id)} busy={busy}>
                          Mark paid
                        </Button>
                      )}
                    </div>
                  </div>

                  {editRunId === r.id && r.status === "draft" && (
                    <DraftEditor
                      run={r}
                      actor={actor}
                      onError={setError}
                      onDone={() => setEditRunId(null)}
                    />
                  )}
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

/**
 * Adjusts a draft run person by person.
 *
 * A run is calculated from the work logs, so this is for the cases the logs cannot
 * express: an agreed bonus, a corrected figure someone spotted after the fact. The
 * deduction is shown but not editable, because it comes from outstanding loans and
 * changing it here would write off a debt with no repayment recorded against it.
 */
function DraftEditor({
  run,
  actor,
  onError,
  onDone,
}: {
  run: RunRow;
  actor: { uid: string; email: string; role: "admin" };
  onError: (message: string) => void;
  onDone: () => void;
}) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [operator, setOperator] = useState("");
  const [assistant, setAssistant] = useState("");
  const [saving, setSaving] = useState(false);

  function begin(s: RunRow["perStaff"][number]) {
    setEditingId(s.staffId);
    setOperator(String(s.operatorKobo / 100));
    setAssistant(String(s.assistantKobo / 100));
  }

  async function save(staffId: string) {
    setSaving(true);
    try {
      await adjustWageRunStaff(getDb(), actor, run.id, staffId, {
        operatorKobo: parseNairaInput(operator),
        assistantKobo: parseNairaInput(assistant),
      });
      setEditingId(null);
    } catch (e) {
      onError(e instanceof Error ? e.message : "Could not adjust the pay.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mt-4 border-t border-night-700/60 pt-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs uppercase tracking-wider text-cream-500">
          Adjust this draft
        </p>
        <button
          type="button"
          onClick={onDone}
          className="cursor-pointer text-xs text-cream-400 transition-colors hover:text-brass-300"
        >
          Done
        </button>
      </div>

      <ul className="mt-3 space-y-2">
        {run.perStaff.map((s) => (
          <li
            key={s.staffId}
            className="rounded-xl border border-night-700/50 bg-night-950/40 p-3"
          >
            {editingId === s.staffId ? (
              <div className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
                <NumberField
                  id={`op-${run.id}-${s.staffId}`}
                  label={`${s.staffName} · operator (₦)`}
                  value={operator}
                  onChange={setOperator}
                />
                <NumberField
                  id={`as-${run.id}-${s.staffId}`}
                  label="Assistant (₦)"
                  value={assistant}
                  onChange={setAssistant}
                />
                <div className="flex gap-2">
                  <Button onClick={() => save(s.staffId)} busy={saving}>
                    Save
                  </Button>
                  <Button variant="ghost" onClick={() => setEditingId(null)}>
                    Cancel
                  </Button>
                </div>
              </div>
            ) : (
              <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
                <span className="text-cream-100">{s.staffName}</span>
                <span className="flex flex-wrap items-center gap-3 text-xs text-cream-400">
                  <span>operator {formatNaira(s.operatorKobo)}</span>
                  <span>assistant {formatNaira(s.assistantKobo)}</span>
                  {s.deductionKobo > 0 && (
                    <span className="text-amber-300">
                      less {formatNaira(s.deductionKobo)}
                    </span>
                  )}
                  <span className="text-cream-100">net {formatNaira(s.netKobo)}</span>
                  <button
                    type="button"
                    aria-label={`Adjust pay for ${s.staffName}`}
                    onClick={() => begin(s)}
                    className="cursor-pointer text-cream-500 transition-colors hover:text-brass-300"
                  >
                    <PenLine size={14} />
                  </button>
                </span>
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

function PreviewPanel({
  preview,
  onSave,
  busy,
}: {
  preview: RunPreview;
  onSave: () => void;
  busy: boolean;
}) {
  const hasWork = preview.lines.length > 0;

  return (
    <section className="mt-6 rounded-3xl border border-brass-500/30 bg-night-900/40 p-6">
      <h2 className="flex items-center gap-2 font-display text-lg text-cream-100">
        <Wallet size={18} className="text-brass-400" /> Calculated run
      </h2>

      {/* Warnings that would silently distort the payroll */}
      {preview.missingRates.length > 0 && (
        <p className="mt-4 flex items-start gap-2 rounded-xl border border-amber-500/40 bg-amber-500/5 px-4 py-3 text-sm text-amber-300">
          <AlertTriangle size={16} className="mt-0.5 shrink-0" />
          <span>
            No rate in force for{" "}
            {preview.missingRates.map((w) => WAGE_WORK_TYPE_LABELS[w]).join(", ")}. That
            work is excluded until a rate is set.
          </span>
        </p>
      )}
      {preview.unattributedAssistantKobo > 0 && (
        <p className="mt-3 flex items-start gap-2 rounded-xl border border-amber-500/40 bg-amber-500/5 px-4 py-3 text-sm text-amber-300">
          <AlertTriangle size={16} className="mt-0.5 shrink-0" />
          <span>
            {formatNaira(preview.unattributedAssistantKobo)} of assistant pay comes from
            logs with a head count but no names, so it cannot be attributed to anyone.
            Name the assistants on those logs to include it.
          </span>
        </p>
      )}

      <div className="mt-5 grid gap-4 sm:grid-cols-4">
        <Tile label="Work logs" value={String(preview.logCount)} />
        <Tile label="Gross" value={formatNaira(preview.grandTotalKobo)} />
        <Tile
          label="Deductions"
          value={formatNaira(preview.deductionsKobo)}
          tone={preview.deductionsKobo > 0 ? "warn" : undefined}
        />
        <Tile label="Net payable" value={formatNaira(preview.netPayableKobo)} tone="good" />
      </div>

      {!hasWork ? (
        <p className="mt-5 text-sm text-cream-500">
          No work was logged in this period, so there is nothing to pay.
        </p>
      ) : (
        <>
          <div className="mt-6 overflow-x-auto">
            <table className="w-full min-w-[40rem] text-left text-sm">
              <thead className="text-xs uppercase tracking-wider text-cream-500">
                <tr>
                  <th className="pb-3 font-medium">Staff</th>
                  <th className="pb-3 text-right font-medium">Operator</th>
                  <th className="pb-3 text-right font-medium">Assistant</th>
                  <th className="pb-3 text-right font-medium">Gross</th>
                  <th className="pb-3 text-right font-medium">Deduction</th>
                  <th className="pb-3 text-right font-medium">Net</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-night-800">
                {preview.perStaff.map((s) => (
                  <tr key={s.staffId}>
                    <td className="py-3 text-cream-100">{s.staffName}</td>
                    <td className="py-3 text-right text-cream-400">
                      {s.operatorKobo > 0 ? formatNaira(s.operatorKobo) : "-"}
                    </td>
                    <td className="py-3 text-right text-cream-400">
                      {s.assistantKobo > 0 ? formatNaira(s.assistantKobo) : "-"}
                    </td>
                    <td className="py-3 text-right text-cream-200">
                      {formatNaira(s.totalKobo)}
                    </td>
                    <td className="py-3 text-right text-amber-300">
                      {s.deductionKobo > 0 ? `-${formatNaira(s.deductionKobo)}` : "-"}
                    </td>
                    <td className="py-3 text-right font-medium text-cream-50">
                      {formatNaira(s.netKobo)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="mt-6 flex flex-wrap items-center gap-4">
            <Button onClick={onSave} busy={busy}>
              <span className="flex items-center gap-2">
                <CheckCircle2 size={15} /> Save as draft
              </span>
            </Button>
            <p className="text-xs text-cream-500">
              Saving snapshots the rates used, so a later rate change cannot restate
              this run.
            </p>
          </div>
        </>
      )}
    </section>
  );
}

function Tile({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "good" | "warn";
}) {
  const colour =
    tone === "good" ? "text-emerald-300" : tone === "warn" ? "text-amber-300" : "text-cream-50";
  return (
    <div className="rounded-2xl border border-night-700/60 bg-night-950/40 p-4">
      <p className="text-xs uppercase tracking-wider text-cream-500">{label}</p>
      <p className={`mt-1.5 font-display text-xl ${colour}`}>{value}</p>
    </div>
  );
}

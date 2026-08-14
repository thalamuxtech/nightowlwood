"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { collection, limit, onSnapshot, orderBy, query } from "firebase/firestore";
import {
  AlertTriangle,
  CheckCircle2,
  Loader2,
  PenLine,
  RefreshCw,
  RotateCcw,
  ShieldAlert,
  Trash2,
  Users,
  Wallet,
} from "lucide-react";
import { getDb } from "@/lib/firebase";
import { COL } from "@/lib/erp/collections";
import {
  DEDUCTION_TYPE_LABELS,
  WAGE_WORK_TYPE_LABELS,
  type DeductionType,
  type WageRunStatus,
  type WageWorkType, type Role } from "@/lib/erp/enums";
import { formatNaira, parseNairaInput } from "@/lib/erp/money";
import {
  adjustWageRunStaff,
  approveWageRun,
  deleteDraftWageRun,
  markWageRunPaid,
  previewWageRun,
  reopenWageRun,
  saveDraftWageRun,
  type RunPreview,
} from "@/lib/erp/payroll";
import { weekBounds } from "@/lib/erp/wages";
import { WAGE_RUN_STATUS_TONE } from "@/lib/erp/statusTone";
import { StatusPill } from "@/components/admin/ui/StatusPill";
import { Button, DateField, EmptyState, NumberField } from "@/components/admin/ui/Fields";
import { useErpSession } from "@/components/admin/ErpAuthProvider";
import type { AuditActor } from "@/lib/erp/audit";
import { useConfirmBoolean } from "@/components/admin/ui/ConfirmDialog";

interface RunRow {
  id: string;
  periodStartMs: number | null;
  periodEndMs: number | null;
  status: WageRunStatus;
  grandTotalKobo: number;
  deductionsKobo: number;
  netPayableKobo: number;
  loanDeductionsKobo: number;
  otherDeductionsKobo: number;
  perStaff: Array<{
    staffId: string;
    staffName: string;
    operatorKobo: number;
    assistantKobo: number;
    totalKobo: number;
    deductionKobo: number;
    loanDeductionKobo?: number;
    /** Work-log deductions taken, so a payslip can state the reason. */
    otherDeductions?: Array<{
      id: string;
      type: DeductionType;
      amountKobo: number;
      reason?: string;
    }>;
    netKobo: number;
    /** What this person was paid at, work type by work type. */
    rateLines?: Array<{
      role: "operator" | "assistant";
      workType: WageWorkType;
      units: number;
      rateKobo: number;
      amountKobo: number;
      personalRate?: boolean;
    }>;
  }>;
}

function toDateInput(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * A run's period date, with the weekday named: "Mon 20 July 2026".
 *
 * The weekday is the point. A wage week runs Monday to Saturday, and a period that has
 * slipped by a day is invisible in "20 Jul" but obvious in "Sun 19 July" — and a
 * mis-dated period silently pays the wrong week's work.
 */
function fmtRunDate(ms: number | null): string {
  if (ms === null) return "?";
  return new Date(ms).toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

/**
 * Weekly wage run. Admin only.
 *
 * Defaults to last week rather than the current one: a run is prepared after
 * the week's work is logged, so the current week is always incomplete.
 */
export function WageRunScreen() {
  const { confirm, dialog } = useConfirmBoolean();
  const session = useErpSession();
  // Capability, not role: an admin can grant this, and a hardcoded role check
  // would leave that grant inert while the database allowed the work.
  const isAdmin = session.can("wage.run");
  // Reopening unwinds an approval, and for a paid run reverses a booked expense,
  // so it sits with approval rather than with ordinary editing.
  const canReopen = session.can("wage.approve");

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
  /** The run whose named payslip breakdown is expanded. */
  const [openRunId, setOpenRunId] = useState<string | null>(null);
  const [error, setError] = useState("");

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
              // Runs saved before the split carried loans only, so falling back to
              // the combined figure describes them correctly rather than as zero.
              loanDeductionsKobo: x.loanDeductionsKobo ?? x.deductionsKobo ?? 0,
              otherDeductionsKobo: x.otherDeductionsKobo ?? 0,
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
      // The caller.s real role: a granted manager reaching this writes audit
      // entries as a manager, not as an administrator they are not.
      role: (session.role ?? "manager") as Role,
    }),
    [session.user, session.role]
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

  async function reopen(id: string, from: string) {
    // Confirmed for a paid run specifically: undoing a payment record is not the
    // same kind of action as correcting a draft, and the expense reversal is the
    // part someone would not expect.
    if (from === "paid") {
      const ok = await confirm({
        title: "Reopen this paid run?",
        body: "It returns to draft and the payroll expense it booked is reversed. What it was paid at stays in the audit log.",
        confirmLabel: "Reopen run",
        tone: "warn",
      });
      if (!ok) return;
    }

    setBusy(true);
    setError("");
    try {
      await reopenWageRun(getDb(), actor, id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not reopen the run.");
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
            <DateField id="run-start" label="From" value={start} onChange={setStart} />
            <DateField id="run-end" label="To" value={end} onChange={setEnd} />
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
                      {/* The weekday is spelled out on both ends. A wage period runs
                          Monday to Saturday, and "20 Jul to 27 Jul" gives no way to
                          check that at a glance — an off-by-one period is the kind of
                          error that only shows up as somebody's short pay. */}
                      <p className="text-sm text-cream-100">
                        {fmtRunDate(r.periodStartMs)} to {fmtRunDate(r.periodEndMs)}
                      </p>
                      <p className="mt-1 text-xs text-cream-500">
                        {r.perStaff.length} staff · gross {formatNaira(r.grandTotalKobo)}
                        {r.deductionsKobo > 0 && ` · less ${formatNaira(r.deductionsKobo)}`}
                      </p>
                      {/* Loans and work-log deductions split apart. One is a debt
                          being repaid, the other is earnings being reduced, and a
                          single "deductions" figure cannot be queried by the person
                          it was taken from. */}
                      {r.otherDeductionsKobo > 0 && (
                        <p className="mt-0.5 text-xs text-cream-600">
                          {formatNaira(r.loanDeductionsKobo)} loan repayment ·{" "}
                          {formatNaira(r.otherDeductionsKobo)} other deductions
                        </p>
                      )}
                    </div>
                    <div className="flex flex-wrap items-center gap-3">
                      <span className="font-display text-xl text-cream-50">
                        {formatNaira(r.netPayableKobo)}
                      </span>
                      <StatusPill tone={WAGE_RUN_STATUS_TONE[r.status]}>
                        {r.status}
                      </StatusPill>
                      {/* A draft is edited in place. An approved or paid run is
                          reopened first — that is what reverses the payroll expense
                          and records what the run stood at, so a correction never
                          silently detaches money that left the business from the
                          record of it. */}
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
                            onClick={async () => {
                              const ok = await confirm({
                                title: "Discard this draft run?",
                                body: "The draft and all its lines go. Nothing has been paid, so no expense is affected. This cannot be undone.",
                                confirmLabel: "Discard draft",
                                tone: "danger",
                              });
                              if (!ok) return;
                              discard(r.id);
                            }}
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
                      {/* Nothing about payroll should be permanently stuck: a run
                          approved for the wrong week, or paid with a share missed,
                          has to be fixable. Reopening returns it to draft, and for
                          a paid run it also reverses the payroll expense that
                          payment booked — leaving that behind would overstate costs
                          and block the corrected run from booking its own. What it
                          stood at is recorded on the run and in the audit log. */}
                      {r.status !== "draft" && canReopen && (
                        <button
                          type="button"
                          aria-label="Reopen this run for editing"
                          title={
                            r.status === "paid"
                              ? "Reopen to edit. The payroll expense this run booked is reversed."
                              : "Reopen to edit."
                          }
                          onClick={() => reopen(r.id, r.status)}
                          className="flex cursor-pointer items-center gap-1.5 text-xs text-cream-400 transition-colors hover:text-amber-300"
                        >
                          <RotateCcw size={14} /> Reopen
                        </button>
                      )}
                      <button
                        type="button"
                        aria-expanded={openRunId === r.id}
                        onClick={() => setOpenRunId(openRunId === r.id ? null : r.id)}
                        className="flex cursor-pointer items-center gap-1.5 text-xs text-cream-400 transition-colors hover:text-brass-300"
                      >
                        <Users size={14} />
                        {openRunId === r.id ? "Hide" : "Who was paid"}
                      </button>
                    </div>
                  </div>

                  {/* The named breakdown. This is what a wage run is for: an
                      assistant cannot check a line that says "assistants ₦12,000",
                      and the figures only become auditable once each person, their
                      units and the rate they were paid at are on the page. */}
                  {openRunId === r.id && <PayslipBreakdown run={r} />}

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
      {dialog}
    </div>
  );
}

/**
 * Who was paid what, and why.
 *
 * The gap this closes: a run that reported "operators ₦84,000, assistants ₦12,000"
 * was not something either group could check. A payslip is only meaningful to the
 * person holding it if it names them, states the units they were credited with, the
 * rate applied, and every deduction with its reason.
 *
 * `rateLines` is absent on runs saved before it was recorded. Those still show the
 * per-person totals, which is what they stored — better than an empty panel implying
 * nobody was paid.
 */
function PayslipBreakdown({ run }: { run: RunRow }) {
  if (run.perStaff.length === 0) {
    return (
      <p className="mt-4 border-t border-night-700/60 pt-4 text-sm text-cream-500">
        This run has no per-person breakdown recorded.
      </p>
    );
  }

  return (
    <div className="mt-4 space-y-3 border-t border-night-700/60 pt-4">
      {run.perStaff.map((s) => (
        <div
          key={s.staffId}
          className="rounded-2xl border border-night-700/50 bg-night-950/40 p-4"
        >
          <div className="flex flex-wrap items-baseline justify-between gap-3">
            <p className="font-medium text-cream-100">{s.staffName}</p>
            <p className="font-display text-lg text-brass-300">
              {formatNaira(s.netKobo)}
            </p>
          </div>

          {/* The working: units × rate for each kind of work, in each role. */}
          {s.rateLines && s.rateLines.length > 0 && (
            <table className="mt-3 w-full text-left text-xs">
              <thead className="text-cream-600">
                <tr>
                  <th className="pb-1 font-medium">Work</th>
                  <th className="pb-1 font-medium">As</th>
                  <th className="pb-1 text-right font-medium">Units</th>
                  <th className="pb-1 text-right font-medium">Rate</th>
                  <th className="pb-1 text-right font-medium">Earned</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-night-800/70">
                {s.rateLines.map((l, i) => (
                  <tr key={`${l.role}-${l.workType}-${i}`}>
                    <td className="py-1.5 text-cream-300">
                      {WAGE_WORK_TYPE_LABELS[l.workType]}
                    </td>
                    <td className="py-1.5 capitalize text-cream-500">{l.role}</td>
                    <td className="py-1.5 text-right tabular-nums text-cream-300">
                      {l.units}
                    </td>
                    <td className="py-1.5 text-right tabular-nums text-cream-400">
                      {formatNaira(l.rateKobo)}
                      {/* Flagged, because two people on the same work showing
                          different rates otherwise looks like an error. */}
                      {l.personalRate && (
                        <span
                          className="ml-1 text-brass-400"
                          title="A rate set for this person specifically"
                        >
                          ★
                        </span>
                      )}
                    </td>
                    <td className="py-1.5 text-right tabular-nums text-cream-200">
                      {formatNaira(l.amountKobo)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          <dl className="mt-3 flex flex-wrap gap-x-6 gap-y-1 border-t border-night-800 pt-2 text-xs">
            <div className="flex gap-1.5">
              <dt className="text-cream-500">Gross</dt>
              <dd className="tabular-nums text-cream-200">
                {formatNaira(s.totalKobo)}
              </dd>
            </div>
            {(s.loanDeductionKobo ?? 0) > 0 && (
              <div className="flex gap-1.5">
                <dt className="text-cream-500">Loan repayment</dt>
                <dd className="tabular-nums text-amber-300">
                  −{formatNaira(s.loanDeductionKobo ?? 0)}
                </dd>
              </div>
            )}
            {/* Each deduction with its reason. "Less ₦5,000" is the line that
                starts an argument; "no show, 12 Aug" is the line that ends one. */}
            {(s.otherDeductions ?? []).map((d) => (
              <div key={d.id} className="flex gap-1.5">
                <dt className="text-cream-500">
                  {DEDUCTION_TYPE_LABELS[d.type]}
                  {d.reason && (
                    <span className="ml-1 text-cream-600">({d.reason})</span>
                  )}
                </dt>
                <dd className="tabular-nums text-amber-300">
                  −{formatNaira(d.amountKobo)}
                </dd>
              </div>
            ))}
            {/* A deduction the run recorded but did not itemise: older runs, or the
                combined figure. Shown so the totals always reconcile. */}
            {s.deductionKobo >
              (s.loanDeductionKobo ?? 0) +
                (s.otherDeductions ?? []).reduce((n, d) => n + d.amountKobo, 0) && (
              <div className="flex gap-1.5">
                <dt className="text-cream-500">Other deductions</dt>
                <dd className="tabular-nums text-amber-300">
                  −
                  {formatNaira(
                    s.deductionKobo -
                      (s.loanDeductionKobo ?? 0) -
                      (s.otherDeductions ?? []).reduce((n, d) => n + d.amountKobo, 0)
                  )}
                </dd>
              </div>
            )}
          </dl>
        </div>
      ))}
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
  actor: AuditActor;
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

      {/* What the deductions are made of. A loan repayment and a penalty are both
          money withheld, but only one of them reduces what somebody earned, and the
          run has to be able to say which. */}
      {preview.deductionsKobo > 0 && (
        <p className="mt-3 text-xs text-cream-500">
          Includes {formatNaira(preview.loanDeductionsKobo)} of loan repayment
          {preview.otherDeductionsKobo > 0 && (
            <>
              {" "}
              and {formatNaira(preview.otherDeductionsKobo)} of work-log deductions
              across{" "}
              {preview.perStaff.reduce(
                (n, s) => n + (s.otherDeductions?.length ?? 0),
                0
              )}{" "}
              entr
              {preview.perStaff.reduce(
                (n, s) => n + (s.otherDeductions?.length ?? 0),
                0
              ) === 1
                ? "y"
                : "ies"}
            </>
          )}
          . Work-log deductions are claimed when this run is approved, so a discarded
          draft leaves them pending.
        </p>
      )}

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

"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  collection,
  limit,
  onSnapshot,
  orderBy,
  query,
  where,
} from "firebase/firestore";
import {
  AlertTriangle,
  CalendarClock,
  CheckCircle2,
  Loader2,
  PenLine,
  RefreshCw,
  RotateCcw,
  ShieldAlert,
  Trash2,
} from "lucide-react";
import { getDb } from "@/lib/firebase";
import { COL } from "@/lib/erp/collections";
import { DEDUCTION_TYPE_LABELS, type WageRunStatus, type Role } from "@/lib/erp/enums";
import { formatNaira, parseNairaInput } from "@/lib/erp/money";
import {
  adjustSalaryLine,
  approveSalaryRun,
  deleteDraftSalaryRun,
  markSalaryRunPaid,
  previewSalaryRun,
  reopenSalaryRun,
  saveDraftSalaryRun,
  setMonthlySalary,
  DEFAULT_WORKING_DAYS,
  type SalaryLine,
  type SalaryRunPreview,
} from "@/lib/erp/salary";
import { WAGE_RUN_STATUS_TONE } from "@/lib/erp/statusTone";
import { StatusPill } from "@/components/admin/ui/StatusPill";
import { Button, EmptyState, NumberField, TextField } from "@/components/admin/ui/Fields";
import { useErpSession } from "@/components/admin/ErpAuthProvider";
import type { AuditActor } from "@/lib/erp/audit";

interface StaffRow {
  id: string;
  name: string;
  jobTitle?: string;
  monthlySalaryKobo: number;
  isSalaried: boolean;
}

interface SalaryRunRow {
  id: string;
  periodStartMs: number | null;
  periodEndMs: number | null;
  status: WageRunStatus;
  baseTotalKobo: number;
  bonusTotalKobo: number;
  unpaidTotalKobo: number;
  grossTotalKobo: number;
  deductionsKobo: number;
  netPayableKobo: number;
  lines: SalaryLine[];
}

/** The month a `<input type="month">` holds, as the two dates the run needs. */
function monthBounds(monthValue: string): { start: Date; end: Date } {
  const [year, month] = monthValue.split("-").map(Number);
  return {
    start: new Date(year, month - 1, 1, 0, 0, 0),
    // Day 0 of the following month is the last day of this one, which avoids
    // hard-coding month lengths and gets February right in a leap year.
    end: new Date(year, month, 0, 23, 59, 59, 999),
  };
}

function toMonthInput(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function formatMonth(ms: number | null): string {
  if (ms === null) return "?";
  return new Date(ms).toLocaleDateString("en-GB", { month: "long", year: "numeric" });
}

/**
 * Monthly salary runs and the salary register. Admin only.
 *
 * Defaults to the last complete month for the same reason the wage run defaults to
 * last week: a run is prepared once the period it covers has finished, so the
 * current month would always be a half-month nobody wants to pay from.
 */
export function SalaryRunScreen() {
  const session = useErpSession();
  // Capability, not role: see WageRunScreen.
  const isAdmin = session.can("wage.run");

  const [month, setMonth] = useState(() => {
    const d = new Date();
    d.setDate(1);
    d.setMonth(d.getMonth() - 1);
    return toMonthInput(d);
  });

  const [staff, setStaff] = useState<StaffRow[]>([]);
  const [runs, setRuns] = useState<SalaryRunRow[]>([]);
  const [preview, setPreview] = useState<SalaryRunPreview | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  /** The draft whose per-person figures are open for adjustment. */
  const [editRunId, setEditRunId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    if (!isAdmin) return;
    return onSnapshot(
      query(collection(getDb(), COL.staff), where("active", "==", true)),
      (snap) =>
        setStaff(
          snap.docs
            .map((d) => {
              const x = d.data();
              return {
                id: d.id,
                name: (x.name as string) ?? "",
                jobTitle: (x.jobTitle as string) ?? undefined,
                monthlySalaryKobo: x.monthlySalaryKobo ?? 0,
                isSalaried: x.isSalaried === true || (x.monthlySalaryKobo ?? 0) > 0,
              };
            })
            // Salaried first, so the people this screen pays are not buried under
            // the piece-rate workers it does not.
            .sort((a, b) =>
              a.isSalaried === b.isSalaried
                ? a.name.localeCompare(b.name)
                : a.isSalaried
                  ? -1
                  : 1
            )
        ),
      (e) => setError(e.message)
    );
  }, [isAdmin]);

  useEffect(() => {
    if (!isAdmin) return;
    const q = query(
      collection(getDb(), COL.salaryRuns),
      orderBy("periodStart", "desc"),
      limit(24)
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
              baseTotalKobo: x.baseTotalKobo ?? 0,
              bonusTotalKobo: x.bonusTotalKobo ?? 0,
              unpaidTotalKobo: x.unpaidTotalKobo ?? 0,
              grossTotalKobo: x.grossTotalKobo ?? 0,
              deductionsKobo: x.deductionsKobo ?? 0,
              netPayableKobo: x.netPayableKobo ?? 0,
              lines: (x.lines ?? []) as SalaryLine[],
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
      const { start, end } = monthBounds(month);
      setPreview(
        await previewSalaryRun(getDb(), { periodStart: start, periodEnd: end })
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not calculate the run.");
    } finally {
      setLoading(false);
    }
  }, [month]);

  async function saveDraft() {
    if (!preview) return;
    setBusy(true);
    setError("");
    try {
      const { start, end } = monthBounds(month);
      await saveDraftSalaryRun(
        getDb(),
        actor,
        { periodStart: start, periodEnd: end },
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
      await approveSalaryRun(getDb(), actor, id);
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
      await deleteDraftSalaryRun(getDb(), actor, id);
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
      await markSalaryRunPaid(getDb(), actor, id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not mark as paid.");
    } finally {
      setBusy(false);
    }
  }

  async function reopen(id: string, from: string) {
    // Confirmed for a paid run: undoing a payment record is a different kind of
    // action from correcting a draft, and the expense reversal is the part someone
    // would not expect.
    if (
      from === "paid" &&
      !window.confirm(
        "Reopen this paid run? It returns to draft and the payroll expense it booked is reversed. What it was paid at stays in the audit log."
      )
    )
      return;

    setBusy(true);
    setError("");
    try {
      await reopenSalaryRun(getDb(), actor, id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not reopen the run.");
    } finally {
      setBusy(false);
    }
  }

  /** `null` clears the figure, which returns the person to piece rate. */
  async function saveSalary(row: StaffRow, monthlySalaryKobo: number | null) {
    setBusy(true);
    setError("");
    try {
      await setMonthlySalary(getDb(), actor, row.id, monthlySalaryKobo, row.name);
      setNotice(
        monthlySalaryKobo === null
          ? `${row.name} is back on piece rate.`
          : `${row.name} is on ${formatNaira(monthlySalaryKobo)} a month.`
      );
      setTimeout(() => setNotice(""), 6000);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save the salary.");
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
          Salaries are restricted to administrators.
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl pb-20">
      <header>
        <p className="text-eyebrow">Payroll</p>
        <h1 className="text-title mt-3 text-cream-50">Salaries</h1>
        <p className="mt-3 max-w-2xl text-sm leading-relaxed text-cream-400">
          Fixed monthly pay for salaried staff. Unlike a wage run this owes nothing
          to the work logs: the figure is contracted in advance, and only unpaid
          days, an agreed bonus and loan repayments move it.
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
      {notice && (
        <p role="status" className="mt-6 text-sm text-emerald-300">
          {notice}
        </p>
      )}

      <SalarySetup staff={staff} busy={busy} onSave={saveSalary} />

      {/* Month picker */}
      <section className="mt-10 rounded-3xl border border-night-700/60 bg-night-900/30 p-6">
        <h2 className="font-display text-lg text-cream-100">Calculate a month</h2>
        <div className="mt-5 flex flex-wrap items-end gap-4">
          <div>
            <label htmlFor="salary-month" className="mb-1.5 block text-sm text-cream-300">
              Month
            </label>
            <input
              id="salary-month"
              type="month"
              value={month}
              onChange={(e) => setMonth(e.target.value)}
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
              title="No salary runs yet"
              hint="Calculate a month above, review it, then save it as a draft."
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
                    <p className="text-sm text-cream-100">{formatMonth(r.periodStartMs)}</p>
                    <p className="mt-1 text-xs text-cream-500">
                      {r.lines.length} staff · gross {formatNaira(r.grossTotalKobo)}
                      {r.unpaidTotalKobo > 0 &&
                        ` · unpaid ${formatNaira(r.unpaidTotalKobo)}`}
                      {r.bonusTotalKobo > 0 && ` · bonus ${formatNaira(r.bonusTotalKobo)}`}
                      {r.deductionsKobo > 0 && ` · less ${formatNaira(r.deductionsKobo)}`}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-3">
                    <span className="font-display text-xl text-cream-50">
                      {formatNaira(r.netPayableKobo)}
                    </span>
                    <StatusPill tone={WAGE_RUN_STATUS_TONE[r.status]}>{r.status}</StatusPill>
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
                    {/* Reopening returns the run to draft, and for a paid one also
                        reverses the payroll expense it booked. Nothing is stuck, and
                        the audit log keeps what it was paid at. */}
                    {r.status !== "draft" && (
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
  );
}

/**
 * The salary register: who is salaried, and for how much.
 *
 * It lists every active staff member rather than only the salaried ones, because
 * the decision being made here is which of the two payrolls a person belongs to,
 * and that cannot be made from a list that already hides one side of it.
 */
function SalarySetup({
  staff,
  busy,
  onSave,
}: {
  staff: StaffRow[];
  busy: boolean;
  onSave: (row: StaffRow, monthlySalaryKobo: number | null) => Promise<void>;
}) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [amount, setAmount] = useState("");

  function begin(row: StaffRow) {
    setEditingId(row.id);
    setAmount(row.monthlySalaryKobo > 0 ? String(row.monthlySalaryKobo / 100) : "");
  }

  const salariedCount = staff.filter((s) => s.isSalaried).length;

  return (
    <section className="mt-8 rounded-3xl border border-night-700/60 bg-night-900/30 p-6">
      <h2 className="font-display text-lg text-cream-100">Salary setup</h2>
      <p className="mt-2 max-w-2xl text-sm text-cream-400">
        {salariedCount} of {staff.length} active staff are on a monthly salary. The
        rest are paid per piece from the weekly wage run, so clearing a figure here
        moves that person back onto it.
      </p>

      {staff.length === 0 ? (
        <div className="mt-5">
          <EmptyState
            title="No active staff"
            hint="Add staff in the directory before setting salaries."
          />
        </div>
      ) : (
        <ul className="mt-5 space-y-2">
          {staff.map((s) => (
            <li
              key={s.id}
              className="rounded-xl border border-night-700/50 bg-night-950/40 p-4"
            >
              {editingId === s.id ? (
                <div className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
                  <NumberField
                    id={`salary-${s.id}`}
                    label={`${s.name} · monthly salary (₦)`}
                    value={amount}
                    onChange={setAmount}
                    hint="Leave empty to move back to piece rate"
                  />
                  <div className="flex gap-2">
                    <Button
                      onClick={() => {
                        const kobo = parseNairaInput(amount);
                        void onSave(s, amount.trim() === "" || kobo <= 0 ? null : kobo);
                        setEditingId(null);
                      }}
                      busy={busy}
                    >
                      Save
                    </Button>
                    <Button variant="ghost" onClick={() => setEditingId(null)}>
                      Cancel
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="flex flex-wrap items-center gap-2 text-sm text-cream-100">
                      {s.name}
                      {s.isSalaried ? (
                        <span className="rounded-full border border-brass-500/50 px-2 py-0.5 text-[11px] text-brass-300">
                          salaried
                        </span>
                      ) : (
                        <span className="rounded-full border border-night-600 px-2 py-0.5 text-[11px] text-cream-500">
                          piece rate
                        </span>
                      )}
                    </p>
                    {s.jobTitle && (
                      <p className="mt-1 text-xs text-cream-500">{s.jobTitle}</p>
                    )}
                  </div>
                  <div className="flex flex-wrap items-center gap-3">
                    <span className="text-sm text-cream-200">
                      {s.monthlySalaryKobo > 0 ? (
                        <>
                          {formatNaira(s.monthlySalaryKobo)}{" "}
                          <span className="text-xs text-cream-500">a month</span>
                        </>
                      ) : s.isSalaried ? (
                        // Flagged salaried with no figure: the preview will refuse
                        // to pay them, so say so before the run is calculated.
                        <span className="text-amber-300">no figure set</span>
                      ) : (
                        <span className="text-cream-500">-</span>
                      )}
                    </span>
                    <Button variant="secondary" onClick={() => begin(s)}>
                      <span className="flex items-center gap-1.5">
                        <PenLine size={14} />
                        {s.monthlySalaryKobo > 0 ? "Change" : "Set"}
                      </span>
                    </Button>
                    {s.monthlySalaryKobo > 0 && (
                      <button
                        type="button"
                        aria-label={`Move ${s.name} to piece rate`}
                        onClick={() => void onSave(s, null)}
                        className="cursor-pointer text-cream-500 transition-colors hover:text-red-400"
                      >
                        <Trash2 size={16} />
                      </button>
                    )}
                  </div>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/**
 * Adjusts a draft run person by person.
 *
 * Only unpaid days and a bonus are editable. The base is the contracted salary and
 * lives on the staff record, where changing it is a deliberate act that outlives
 * this month; the deduction comes from outstanding loans, so editing it here would
 * write off a debt with no repayment recorded against it.
 */
function DraftEditor({
  run,
  actor,
  onError,
  onDone,
}: {
  run: SalaryRunRow;
  actor: AuditActor;
  onError: (message: string) => void;
  onDone: () => void;
}) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [unpaidDays, setUnpaidDays] = useState("");
  const [bonus, setBonus] = useState("");
  const [bonusNote, setBonusNote] = useState("");
  const [saving, setSaving] = useState(false);

  function begin(l: SalaryLine) {
    setEditingId(l.staffId);
    setUnpaidDays(String(l.unpaidDays ?? 0));
    setBonus(String((l.bonusKobo ?? 0) / 100));
    setBonusNote(l.bonusNote ?? "");
  }

  async function save(staffId: string) {
    setSaving(true);
    try {
      await adjustSalaryLine(getDb(), actor, run.id, staffId, {
        unpaidDays: Math.max(0, Number.parseFloat(unpaidDays) || 0),
        bonusKobo: parseNairaInput(bonus),
        bonusNote: bonusNote.trim() || undefined,
      });
      setEditingId(null);
    } catch (e) {
      onError(e instanceof Error ? e.message : "Could not adjust the salary.");
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
        {run.lines.map((l) => (
          <li
            key={l.staffId}
            className="rounded-xl border border-night-700/50 bg-night-950/40 p-3"
          >
            {editingId === l.staffId ? (
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[1fr_1fr_1fr_auto] lg:items-end">
                <NumberField
                  id={`ud-${run.id}-${l.staffId}`}
                  label={`${l.staffName} · unpaid days`}
                  value={unpaidDays}
                  onChange={setUnpaidDays}
                  hint={`of ${l.workingDays ?? DEFAULT_WORKING_DAYS}`}
                />
                <NumberField
                  id={`bo-${run.id}-${l.staffId}`}
                  label="Bonus (₦)"
                  value={bonus}
                  onChange={setBonus}
                />
                <TextField
                  id={`bn-${run.id}-${l.staffId}`}
                  label="What the bonus is for"
                  value={bonusNote}
                  onChange={setBonusNote}
                  placeholder="Weekend installation"
                />
                <div className="flex gap-2">
                  <Button onClick={() => save(l.staffId)} busy={saving}>
                    Save
                  </Button>
                  <Button variant="ghost" onClick={() => setEditingId(null)}>
                    Cancel
                  </Button>
                </div>
              </div>
            ) : (
              <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
                <span className="text-cream-100">{l.staffName}</span>
                <span className="flex flex-wrap items-center gap-3 text-xs text-cream-400">
                  <span>base {formatNaira(l.baseKobo)}</span>
                  {l.unpaidDays > 0 && (
                    <span className="text-amber-300">
                      {l.unpaidDays} unpaid · -{formatNaira(l.unpaidKobo)}
                    </span>
                  )}
                  {l.bonusKobo > 0 && (
                    <span className="text-emerald-300">
                      bonus {formatNaira(l.bonusKobo)}
                    </span>
                  )}
                  {(l.loanDeductionKobo ?? 0) > 0 && (
                    <span className="text-amber-300">
                      loan -{formatNaira(l.loanDeductionKobo ?? 0)}
                    </span>
                  )}
                  {/* Each work-log deduction named. "Less ₦5,000" cannot be queried
                      by the person it was taken from; "no show" can. */}
                  {(l.otherDeductions ?? []).map((d) => (
                    <span key={d.id} className="text-amber-300">
                      {DEDUCTION_TYPE_LABELS[d.type].toLowerCase()} -
                      {formatNaira(d.amountKobo)}
                    </span>
                  ))}
                  {/* Anything the run deducted without itemising, so the figures
                      always reconcile against the net. */}
                  {l.deductionKobo >
                    (l.loanDeductionKobo ?? 0) +
                      (l.otherDeductions ?? []).reduce(
                        (n, d) => n + d.amountKobo,
                        0
                      ) && (
                    <span className="text-amber-300">
                      less{" "}
                      {formatNaira(
                        l.deductionKobo -
                          (l.loanDeductionKobo ?? 0) -
                          (l.otherDeductions ?? []).reduce(
                            (n, d) => n + d.amountKobo,
                            0
                          )
                      )}
                    </span>
                  )}
                  <span className="text-cream-100">net {formatNaira(l.netKobo)}</span>
                  <button
                    type="button"
                    aria-label={`Adjust the salary line for ${l.staffName}`}
                    onClick={() => begin(l)}
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
  preview: SalaryRunPreview;
  onSave: () => void;
  busy: boolean;
}) {
  const hasLines = preview.lines.length > 0;

  return (
    <section className="mt-6 rounded-3xl border border-brass-500/30 bg-night-900/40 p-6">
      <h2 className="flex items-center gap-2 font-display text-lg text-cream-100">
        <CalendarClock size={18} className="text-brass-400" /> Calculated month
      </h2>

      {/* Staff the workshop believes are salaried but has never priced. Left
          unsaid, they would simply be absent from the run and nobody would
          notice until they asked why they were not paid. */}
      {preview.missingSalary.length > 0 && (
        <p className="mt-4 flex items-start gap-2 rounded-xl border border-amber-500/40 bg-amber-500/5 px-4 py-3 text-sm text-amber-300">
          <AlertTriangle size={16} className="mt-0.5 shrink-0" />
          <span>
            {preview.missingSalary.join(", ")}{" "}
            {preview.missingSalary.length === 1 ? "is" : "are"} marked salaried with
            no figure set, so they are left out of this run and cannot be paid. Set a
            salary in the register above to include them.
          </span>
        </p>
      )}

      <div className="mt-5 grid gap-4 sm:grid-cols-4">
        <Tile label="Base" value={formatNaira(preview.baseTotalKobo)} />
        <Tile label="Gross" value={formatNaira(preview.grossTotalKobo)} />
        <Tile
          label="Deductions"
          value={formatNaira(preview.deductionsKobo)}
          tone={preview.deductionsKobo > 0 ? "warn" : undefined}
        />
        <Tile label="Net payable" value={formatNaira(preview.netPayableKobo)} tone="good" />
      </div>

      {!hasLines ? (
        <p className="mt-5 text-sm text-cream-500">
          No staff have a monthly salary set, so there is nothing to pay this month.
        </p>
      ) : (
        <>
          <div className="mt-6 overflow-x-auto">
            <table className="w-full min-w-[44rem] text-left text-sm">
              <thead className="text-xs uppercase tracking-wider text-cream-500">
                <tr>
                  <th className="pb-3 font-medium">Staff</th>
                  <th className="pb-3 text-right font-medium">Base</th>
                  <th className="pb-3 text-right font-medium">Unpaid</th>
                  <th className="pb-3 text-right font-medium">Bonus</th>
                  <th className="pb-3 text-right font-medium">Gross</th>
                  <th className="pb-3 text-right font-medium">Deduction</th>
                  <th className="pb-3 text-right font-medium">Net</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-night-800">
                {preview.lines.map((l) => (
                  <tr key={l.staffId}>
                    <td className="py-3 text-cream-100">{l.staffName}</td>
                    <td className="py-3 text-right text-cream-400">
                      {formatNaira(l.baseKobo)}
                    </td>
                    <td className="py-3 text-right text-amber-300">
                      {l.unpaidKobo > 0
                        ? `-${formatNaira(l.unpaidKobo)} (${l.unpaidDays}d)`
                        : "-"}
                    </td>
                    <td className="py-3 text-right text-emerald-300">
                      {l.bonusKobo > 0 ? formatNaira(l.bonusKobo) : "-"}
                    </td>
                    <td className="py-3 text-right text-cream-200">
                      {formatNaira(l.grossKobo)}
                    </td>
                    <td className="py-3 text-right text-amber-300">
                      {l.deductionKobo > 0 ? `-${formatNaira(l.deductionKobo)}` : "-"}
                    </td>
                    <td className="py-3 text-right font-medium text-cream-50">
                      {formatNaira(l.netKobo)}
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
              Saving snapshots each contracted figure, so a later salary change
              cannot restate this month. Unpaid days and bonuses are added on the
              draft.
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

"use client";

import { useEffect, useMemo, useState } from "react";
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
  ClipboardList,
  Loader2,
  Plus,
  Printer,
  ShieldAlert,
  Trash2,
  Users,
} from "lucide-react";
import { getDb } from "@/lib/firebase";
import { COL } from "@/lib/erp/collections";
import {
  WAGE_WORK_TYPES,
  WAGE_WORK_TYPE_LABELS,
  type WageWorkType,
} from "@/lib/erp/enums";
import { formatNaira } from "@/lib/erp/money";
import { resolveRates } from "@/lib/erp/wages";
import type { WageRate } from "@/lib/erp/types";
import {
  createWorkLog,
  deleteWorkLog,
  fromDateInputValue,
  toDateInputValue,
} from "@/lib/erp/workLogs";
import {
  Button,
  EmptyState,
  NumberField,
  SelectField,
  TextField,
} from "@/components/admin/ui/Fields";
import { useErpSession } from "@/components/admin/ErpAuthProvider";
import { StaffPicker, type PickedStaff } from "@/components/admin/services/StaffPicker";
import { WorkLogSheet } from "./WorkLogSheet";

interface StaffOption {
  id: string;
  name: string;
  isAssistant: boolean;
}

interface LogRow {
  id: string;
  staffId: string;
  staffName: string;
  workType: WageWorkType;
  units: number;
  workDateMs: number | null;
  assistantNames: string[];
  assistantCount: number;
  jobNumber?: string;
}

/**
 * Work log entry. This is the only input to payroll.
 *
 * Operators may log their own work; managers and admins may log for anyone. The
 * Firestore rules enforce that an operator's log carries their own staffId, so
 * units cannot be attributed to someone else.
 */
export function WorkLogScreen() {
  const session = useErpSession();
  const canLogForOthers = session.can("worklog.viewAll");
  const canLog = session.can("worklog.create");
  const isAdmin = session.role === "admin";

  const [rows, setRows] = useState<LogRow[]>([]);
  const [staff, setStaff] = useState<StaffOption[]>([]);
  const [rates, setRates] = useState<WageRate[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [printing, setPrinting] = useState(false);

  // Form state
  const [operator, setOperator] = useState<PickedStaff | null>(null);
  const [workType, setWorkType] = useState<WageWorkType | "">("");
  const [units, setUnits] = useState("");
  const [workDate, setWorkDate] = useState(toDateInputValue(new Date()));
  const [assistantIds, setAssistantIds] = useState<string[]>([]);
  const [jobNumber, setJobNumber] = useState("");

  useEffect(() => {
    const q = query(collection(getDb(), COL.staff), orderBy("name", "asc"));
    return onSnapshot(q, (snap) =>
      setStaff(
        snap.docs
          .filter((d) => d.data().active !== false)
          .map((d) => ({
            id: d.id,
            name: (d.data().name as string) ?? "",
            isAssistant: d.data().isAssistant === true,
          }))
      )
    );
  }, []);

  // Rates are read only to show an estimated value as work is entered.
  useEffect(() => {
    if (!isAdmin) return;
    return onSnapshot(
      collection(getDb(), COL.wageRates),
      (snap) =>
        setRates(snap.docs.map((d) => ({ id: d.id, ...d.data() })) as WageRate[]),
      () => {}
    );
  }, [isAdmin]);

  useEffect(() => {
    // Operators see only their own logs, which is also what the rules allow.
    const base = collection(getDb(), COL.workLogs);
    const q =
      canLogForOthers || !session.staffId
        ? query(base, orderBy("workDate", "desc"), limit(100))
        : query(
            base,
            where("staffId", "==", session.staffId),
            orderBy("workDate", "desc"),
            limit(100)
          );

    return onSnapshot(
      q,
      (snap) => {
        setRows(
          snap.docs.map((d) => {
            const x = d.data();
            return {
              id: d.id,
              staffId: x.staffId ?? "",
              staffName: x.staffName ?? "",
              workType: (x.workType as WageWorkType) ?? "board",
              units: x.units ?? 0,
              workDateMs: x.workDate?.toMillis?.() ?? null,
              assistantNames: (x.assistantNames as string[]) ?? [],
              assistantCount: x.assistantCount ?? 0,
              jobNumber: x.jobNumber ?? undefined,
            };
          })
        );
        setLoading(false);
      },
      (e) => {
        setError(e.message);
        setLoading(false);
      }
    );
  }, [canLogForOthers, session.staffId]);

  const actor = useMemo(
    () => ({
      uid: session.user?.uid ?? "",
      email: session.user?.email ?? "",
      role: session.role ?? "operator",
    }),
    [session.user, session.role]
  );

  const assistantPool = useMemo(() => staff.filter((s) => s.isAssistant), [staff]);

  /** Indicative value of the entry being typed, admin only. */
  const estimate = useMemo(() => {
    if (!isAdmin || !workType || !Number(units)) return null;
    const resolved = resolveRates(rates, fromDateInputValue(workDate).getTime());
    const rate = resolved.get(workType);
    if (!rate) return { missing: true, operatorKobo: 0, assistantKobo: 0 };
    const n = Number(units);
    return {
      missing: false,
      operatorKobo: Math.round(n * rate.operatorRateKobo),
      assistantKobo: Math.round(n * rate.assistantRateKobo) * assistantIds.length,
    };
  }, [isAdmin, workType, units, workDate, rates, assistantIds.length]);

  function toggleAssistant(id: string) {
    setAssistantIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  }

  async function submit() {
    const chosen = canLogForOthers
      ? operator
      : session.staffId
        ? { id: session.staffId, name: session.displayName }
        : null;

    if (!chosen) {
      setError(
        canLogForOthers
          ? "Select who did the work."
          : "Your login is not linked to a staff record, so work cannot be attributed. Ask an admin to link it."
      );
      return;
    }
    if (!workType) {
      setError("Select the type of work.");
      return;
    }
    if (!Number(units)) {
      setError("Enter the number of units.");
      return;
    }

    setBusy(true);
    setError("");
    try {
      await createWorkLog(getDb(), actor, {
        staffId: chosen.id,
        staffName: chosen.name,
        workType,
        units: Number(units),
        workDate: fromDateInputValue(workDate),
        assistantIds,
        assistantNames: assistantIds.map(
          (id) => staff.find((s) => s.id === id)?.name ?? id
        ),
        jobNumber: jobNumber.trim() || undefined,
      });
      setWorkType("");
      setUnits("");
      setAssistantIds([]);
      setJobNumber("");
      setAdding(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save the work log.");
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

  // The printed range is whatever is on screen, which is what the user just
  // filtered to; labelling it from the rows avoids claiming a period the sheet
  // does not actually cover.
  const printLabel = (() => {
    const dates = rows.map((r) => r.workDateMs).filter((m): m is number => m !== null);
    if (dates.length === 0) return "All entries";
    const f = (ms: number) =>
      new Date(ms).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
    return `${f(Math.min(...dates))} to ${f(Math.max(...dates))}`;
  })();

  return (
    <div className="mx-auto max-w-5xl pb-20">
      {printing && (
        <WorkLogSheet
          rows={rows}
          periodLabel={printLabel}
          onDone={() => setPrinting(false)}
        />
      )}

      <header className="flex flex-wrap items-end justify-between gap-4 print:hidden">
        <div>
          <p className="text-eyebrow">Payroll</p>
          <h1 className="text-title mt-3 text-cream-50">Work log</h1>
          <p className="mt-3 max-w-2xl text-sm leading-relaxed text-cream-400">
            Every unit of piece-rate work. This is what the weekly wage run reads,
            so an unlogged job is unpaid work.
          </p>
        </div>
        <div className="flex flex-wrap gap-3">
          {rows.length > 0 && (
            <Button variant="secondary" onClick={() => setPrinting(true)}>
              <span className="flex items-center gap-2">
                <Printer size={15} /> Print log
              </span>
            </Button>
          )}
          {canLog && !adding && (
            <Button onClick={() => setAdding(true)}>
              <span className="flex items-center gap-2">
                <Plus size={15} /> Log work
              </span>
            </Button>
          )}
        </div>
      </header>

      {error && (
        <p
          role="alert"
          className="mt-6 flex items-start gap-2 rounded-xl border border-red-500/30 bg-red-500/5 px-4 py-3 text-sm text-red-400"
        >
          <ShieldAlert size={16} className="mt-0.5 shrink-0" /> {error}
        </p>
      )}

      {adding && (
        <section className="mt-6 rounded-3xl border border-brass-500/30 print:hidden bg-night-900/40 p-6">
          <h2 className="flex items-center gap-2 font-display text-lg text-cream-100">
            <ClipboardList size={18} className="text-brass-400" /> New work log
          </h2>

          <div className="mt-5 grid gap-4 sm:grid-cols-2">
            {canLogForOthers ? (
              <StaffPicker
                value={operator}
                onChange={setOperator}
                createdBy={actor.uid}
                label="Work done by"
                required
              />
            ) : (
              <TextField
                id="wl-self"
                label="Work done by"
                value={session.displayName}
                disabled
              />
            )}
            <div>
              <label htmlFor="wl-date" className="mb-1.5 block text-sm text-cream-300">
                Date <span className="ml-1 text-brass-400">*</span>
              </label>
              <input
                id="wl-date"
                type="date"
                value={workDate}
                max={toDateInputValue(new Date())}
                onChange={(e) => setWorkDate(e.target.value)}
                className="w-full rounded-xl border border-night-600 bg-night-800/60 px-4 py-3 text-cream-100 focus:border-brass-500 focus:outline-none"
              />
            </div>
            <SelectField
              id="wl-type"
              label="Work type"
              value={workType}
              onChange={(v) => setWorkType(v as WageWorkType)}
              placeholder="Select…"
              required
              options={WAGE_WORK_TYPES.map((w) => ({
                value: w,
                label: WAGE_WORK_TYPE_LABELS[w],
              }))}
            />
            <NumberField
              id="wl-units"
              label="Units"
              value={units}
              onChange={setUnits}
              required
              hint={workType === "grooving" ? "millimetres" : undefined}
            />
            <div className="sm:col-span-2">
              <TextField
                id="wl-job"
                label="Job number (optional)"
                value={jobNumber}
                onChange={setJobNumber}
                placeholder="JOB-2026-0142"
              />
            </div>
          </div>

          {/* Assistants: named, not counted */}
          <fieldset className="mt-6">
            <legend className="mb-2 flex items-center gap-2 text-sm text-cream-300">
              <Users size={15} className="text-brass-400" /> Assistants on this work
            </legend>
            {assistantPool.length === 0 ? (
              <p className="text-xs text-cream-500">
                No staff are marked as assistants yet. Set the assistant flag on a
                staff record to list them here.
              </p>
            ) : (
              <>
                <div className="flex flex-wrap gap-2">
                  {assistantPool.map((a) => {
                    const on = assistantIds.includes(a.id);
                    return (
                      <button
                        key={a.id}
                        type="button"
                        onClick={() => toggleAssistant(a.id)}
                        aria-pressed={on}
                        className={`cursor-pointer rounded-full border px-4 py-2 text-xs font-medium transition-all duration-300 ${
                          on
                            ? "border-brass-500 bg-brass-500 text-night-950"
                            : "border-night-600 text-cream-300 hover:border-brass-500/60 hover:text-brass-300"
                        }`}
                      >
                        {a.name}
                      </button>
                    );
                  })}
                </div>
                <p className="mt-2 text-xs text-cream-500">
                  Each assistant selected earns the assistant rate on these units.
                  Naming them is what lets the wage run pay the right people.
                </p>
              </>
            )}
          </fieldset>

          {estimate && (
            <div className="mt-5 rounded-2xl border border-night-700/60 bg-night-950/40 p-4 text-sm">
              {estimate.missing ? (
                <p className="flex items-start gap-2 text-amber-300">
                  <AlertTriangle size={15} className="mt-0.5 shrink-0" />
                  No rate is in force for this work type, so it will be excluded
                  from the wage run until one is set.
                </p>
              ) : (
                <div className="flex flex-wrap gap-6">
                  <span className="text-cream-400">
                    Operator:{" "}
                    <span className="text-cream-100">
                      {formatNaira(estimate.operatorKobo)}
                    </span>
                  </span>
                  {estimate.assistantKobo > 0 && (
                    <span className="text-cream-400">
                      Assistants:{" "}
                      <span className="text-cream-100">
                        {formatNaira(estimate.assistantKobo)}
                      </span>
                    </span>
                  )}
                </div>
              )}
            </div>
          )}

          <div className="mt-6 flex gap-3">
            <Button onClick={submit} busy={busy}>
              Save log
            </Button>
            <Button variant="ghost" onClick={() => setAdding(false)}>
              Cancel
            </Button>
          </div>
        </section>
      )}

      <section className="mt-8 print:hidden">
        {loading ? (
          <div className="flex justify-center py-10">
            <Loader2 className="animate-spin text-brass-400" size={24} aria-label="Loading" />
          </div>
        ) : rows.length === 0 ? (
          <EmptyState
            title="No work logged yet"
            hint="Log the week's work here, then generate the wage run from Payroll."
          />
        ) : (
          <div className="overflow-x-auto rounded-3xl border border-night-700/60">
            <table className="w-full min-w-[46rem] text-left text-sm">
              <thead className="bg-night-900/70 text-xs uppercase tracking-wider text-cream-500">
                <tr>
                  <th className="px-5 py-3 font-medium">Date</th>
                  <th className="px-5 py-3 font-medium">Staff</th>
                  <th className="px-5 py-3 font-medium">Work</th>
                  <th className="px-5 py-3 text-right font-medium">Units</th>
                  <th className="px-5 py-3 font-medium">Assistants</th>
                  {isAdmin && <th className="px-5 py-3" />}
                </tr>
              </thead>
              <tbody className="divide-y divide-night-800">
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td className="px-5 py-4 text-cream-400">
                      {r.workDateMs
                        ? new Date(r.workDateMs).toLocaleDateString("en-GB", {
                            day: "numeric",
                            month: "short",
                          })
                        : "-"}
                    </td>
                    <td className="px-5 py-4">
                      <p className="text-cream-100">{r.staffName}</p>
                      {r.jobNumber && (
                        <p className="text-xs text-cream-500">{r.jobNumber}</p>
                      )}
                    </td>
                    <td className="px-5 py-4 text-cream-300">
                      {WAGE_WORK_TYPE_LABELS[r.workType]}
                    </td>
                    <td className="px-5 py-4 text-right text-cream-200">{r.units}</td>
                    <td className="px-5 py-4 text-xs">
                      {r.assistantNames.length > 0 ? (
                        <span className="text-cream-400">
                          {r.assistantNames.join(", ")}
                        </span>
                      ) : r.assistantCount > 0 ? (
                        <span className="flex items-center gap-1.5 text-amber-300">
                          <AlertTriangle size={12} />
                          {r.assistantCount} unnamed
                        </span>
                      ) : (
                        <span className="text-cream-600">None</span>
                      )}
                    </td>
                    {isAdmin && (
                      <td className="px-5 py-4 text-right">
                        <button
                          type="button"
                          aria-label="Delete log"
                          onClick={() =>
                            deleteWorkLog(
                              getDb(),
                              actor,
                              r.id,
                              `${r.staffName} ${r.units} × ${r.workType}`
                            ).catch((e) =>
                              setError(
                                e instanceof Error ? e.message : "Could not delete."
                              )
                            )
                          }
                          className="cursor-pointer text-cream-500 transition-colors hover:text-red-400"
                        >
                          <Trash2 size={15} />
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

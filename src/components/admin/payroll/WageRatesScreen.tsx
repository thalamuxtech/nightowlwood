"use client";

import { useEffect, useMemo, useState } from "react";
import { collection, doc, onSnapshot, query, where } from "firebase/firestore";
import {
  AlertTriangle,
  Coins,
  History,
  Loader2,
  PenLine,
  Plus,
  ShieldAlert,
  Trash2,
} from "lucide-react";
import { getDb } from "@/lib/firebase";
import { COL } from "@/lib/erp/collections";
import { WAGE_WORK_TYPES, WAGE_WORK_TYPE_LABELS, type WageWorkType } from "@/lib/erp/enums";
import { formatNaira, parseNairaInput, toKobo } from "@/lib/erp/money";
import {
  addWorkType,
  hideWorkType,
  setWageRate,
  unhideWorkType,
} from "@/lib/erp/payroll";
import {
  DEFAULT_WAGE_RATES,
  labelForWorkType,
  resolveWorkTypes,
} from "@/lib/erp/wages";
import {
  DEFAULT_WAGE_WORK_TYPE_SETTINGS,
  SETTINGS_DOC,
  type WageWorkTypeSettings,
} from "@/lib/erp/settings";
import { toDateInputValue, fromDateInputValue } from "@/lib/erp/workLogs";
import { Button, DateField, NumberField, TextField } from "@/components/admin/ui/Fields";
import { useErpSession } from "@/components/admin/ErpAuthProvider";
import { StaffRatesPanel } from "./StaffRatesPanel";

interface RateRow {
  id: string;
  workType: string;
  operatorRateKobo: number;
  assistantRateKobo: number;
  effectiveFromMs: number | null;
  effectiveToMs: number | null;
  estimated: boolean;
  note?: string;
}

/**
 * Piece-rate maintenance. Admin only.
 *
 * Every wage run is priced from these rates, and until now there was no screen for
 * them at all: `setWageRate` existed and was audited, but nothing called it, so a
 * rate change meant editing DEFAULT_WAGE_RATES and redeploying the site. Rates move
 * with the market, so that made the most business-critical numbers in the system
 * the hardest to change.
 *
 * Changes are effective-dated rather than overwritten. A wage run for last week
 * must price at last week's rate, so saving a new figure closes the old row and
 * opens a new one instead of editing history.
 */
export function WageRatesScreen() {
  const session = useErpSession();
  // Capability, not role: an admin may grant rate-keeping to a payroll clerk.
  const isAdmin = session.can("wage.editRates");

  const [rates, setRates] = useState<RateRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<string | null>(null);
  const [showHistory, setShowHistory] = useState<string | null>(null);
  const [operator, setOperator] = useState("");
  const [assistant, setAssistant] = useState("");
  const [effectiveFrom, setEffectiveFrom] = useState(toDateInputValue(new Date()));
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  /**
   * The workshop's own work types, and any built-ins it has stopped using.
   *
   * Read from settings rather than hardcoded, so a new machine or a new service can be
   * priced without a code change — which is what "ability to add or remove rates" needs.
   */
  const [workTypeSettings, setWorkTypeSettings] = useState<WageWorkTypeSettings>(
    DEFAULT_WAGE_WORK_TYPE_SETTINGS
  );
  const [newTypeLabel, setNewTypeLabel] = useState("");
  const [addingType, setAddingType] = useState(false);

  useEffect(() => {
    if (!isAdmin) return;
    return onSnapshot(
      doc(getDb(), COL.settings, SETTINGS_DOC.wageWorkTypes),
      (snap) => {
        const d = snap.data();
        setWorkTypeSettings({
          custom: (d?.custom ?? []) as Array<{ id: string; label: string }>,
          hidden: (d?.hidden ?? []) as string[],
        });
      },
      () => {}
    );
  }, [isAdmin]);

  useEffect(() => {
    if (!isAdmin) {
      setLoading(false);
      return;
    }
    return onSnapshot(
      query(collection(getDb(), COL.wageRates)),
      (snap) => {
        setRates(
          snap.docs.map((d) => {
            const x = d.data();
            return {
              id: d.id,
              workType: (x.workType as string) ?? "",
              operatorRateKobo: x.operatorRateKobo ?? 0,
              assistantRateKobo: x.assistantRateKobo ?? 0,
              effectiveFromMs: x.effectiveFrom?.toMillis?.() ?? null,
              effectiveToMs: x.effectiveTo?.toMillis?.() ?? null,
              estimated: x.estimated === true,
              note: x.note ?? undefined,
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
  }, [isAdmin]);

  /** The row in force for each work type: the one with no end date. */
  const current = useMemo(() => {
    const map = new Map<string, RateRow>();
    for (const r of rates) {
      if (r.effectiveToMs === null) map.set(r.workType, r);
    }
    return map;
  }, [rates]);

  const history = useMemo(() => {
    const map = new Map<string, RateRow[]>();
    for (const r of rates) {
      if (r.effectiveToMs === null) continue;
      const list = map.get(r.workType) ?? [];
      list.push(r);
      map.set(r.workType, list);
    }
    for (const list of map.values()) {
      list.sort((a, b) => (b.effectiveFromMs ?? 0) - (a.effectiveFromMs ?? 0));
    }
    return map;
  }, [rates]);

  const actor = useMemo(
    () => ({
      uid: session.user?.uid ?? "",
      email: session.user?.email ?? "",
      role: session.role ?? "admin",
    }),
    [session.user, session.role]
  );

  /** The types currently offered, built-in and custom together. */
  const activeTypes = useMemo(
    () => resolveWorkTypes(workTypeSettings),
    [workTypeSettings]
  );

  /**
   * Types that exist but are no longer offered.
   *
   * Shown with a way back, so it is clear they were hidden rather than lost — and that
   * historical runs still price against them.
   */
  const hiddenTypes = useMemo(
    () =>
      workTypeSettings.hidden.map((id) => ({
        id,
        label: labelForWorkType(id, workTypeSettings.custom),
      })),
    [workTypeSettings]
  );

  /** Seeded default, shown when a work type has no saved rate at all. */
  const fallbackFor = (wt: string) => DEFAULT_WAGE_RATES.find((d) => d.workType === wt);

  function beginEdit(wt: string) {
    const live = current.get(wt);
    const seed = fallbackFor(wt);
    setEditing(wt);
    setOperator(
      String(
        live ? live.operatorRateKobo / 100 : (seed?.operatorRateNaira ?? 0)
      )
    );
    setAssistant(
      String(
        live ? live.assistantRateKobo / 100 : (seed?.assistantRateNaira ?? 0)
      )
    );
    setEffectiveFrom(toDateInputValue(new Date()));
    setNote("");
    setError("");
  }

  async function save(wt: string) {
    const op = parseNairaInput(operator);
    const as = parseNairaInput(assistant);
    if (op <= 0) {
      setError("An operator rate is required.");
      return;
    }
    if (as < 0) {
      setError("An assistant rate cannot be negative.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await setWageRate(getDb(), actor, wt, {
        operatorRateKobo: op,
        assistantRateKobo: as,
        effectiveFrom: fromDateInputValue(effectiveFrom),
        note: note.trim() || undefined,
      });
      setNotice(
        `${labelForWorkType(wt, workTypeSettings.custom)} now ${formatNaira(op)} per unit, from ${effectiveFrom}.`
      );
      setEditing(null);
      setTimeout(() => setNotice(""), 6000);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save the rate.");
    } finally {
      setBusy(false);
    }
  }

  if (!session.ready || loading) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center">
        <Loader2 className="animate-spin text-brass-400" size={28} aria-label="Loading" />
      </div>
    );
  }

  if (!isAdmin) {
    return (
      <div className="mx-auto max-w-xl rounded-3xl border border-night-700/60 bg-night-900/40 p-8 text-center">
        <ShieldAlert className="mx-auto text-brass-400" size={26} />
        <h2 className="mt-3 font-display text-lg text-cream-100">Administrators only</h2>
        <p className="mt-2 text-sm text-cream-400">
          Piece rates decide what every worker is paid, so only an administrator can
          change them.
        </p>
      </div>
    );
  }

  const estimatedCount = [...current.values()].filter((r) => r.estimated).length;
  const missingCount = WAGE_WORK_TYPES.filter((wt) => !current.has(wt)).length;

  return (
    <div className="mx-auto max-w-5xl pb-20">
      <header>
        <h1 className="flex items-center gap-2.5 font-display text-2xl text-cream-100">
          <Coins size={22} className="text-brass-400" /> Piece rates
        </h1>
        <p className="mt-2 max-w-2xl text-sm text-cream-400">
          What each unit of work pays. A change takes effect from the date you give
          it and does not alter wage runs already generated, so last week is still
          priced at last week&rsquo;s rate.
        </p>
      </header>

      {(estimatedCount > 0 || missingCount > 0) && (
        <p className="mt-5 flex items-start gap-2.5 rounded-2xl border border-amber-500/40 bg-amber-500/5 px-4 py-3 text-sm text-amber-200">
          <AlertTriangle size={16} className="mt-0.5 shrink-0" />
          <span>
            {estimatedCount > 0 && (
              <>
                {estimatedCount} rate{estimatedCount === 1 ? "" : "s"} came from the old
                sheet as an estimate and need confirming.
              </>
            )}
            {estimatedCount > 0 && missingCount > 0 && " "}
            {missingCount > 0 && (
              <>
                {missingCount} work type{missingCount === 1 ? "" : "s"} has no saved rate
                and falls back to the seeded default.
              </>
            )}
          </span>
        </p>
      )}

      {error && (
        <p role="alert" className="mt-5 text-sm text-red-400">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="mt-5 text-sm text-emerald-300">
          {notice}
        </p>
      )}

      {/* Adding and removing kinds of work.
          The built-in list came from the legacy sheets; new work turns up, and previously
          pricing it meant a code change. A removed type is hidden rather than erased,
          because last year's work logs and wage runs still reference it. */}
      <section className="mt-8 rounded-3xl border border-night-700/60 bg-night-900/30 p-5">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-sm font-medium text-cream-200">Kinds of work</h2>
            <p className="mt-1 text-xs text-cream-500">
              {activeTypes.length} in use
              {hiddenTypes.length > 0 && ` · ${hiddenTypes.length} not offered`}
            </p>
          </div>
          {!addingType && (
            <Button variant="secondary" onClick={() => setAddingType(true)}>
              <span className="flex items-center gap-1.5">
                <Plus size={14} /> Add a kind of work
              </span>
            </Button>
          )}
        </div>

        {addingType && (
          <div className="mt-4 grid gap-3 sm:grid-cols-[1fr_auto_auto] sm:items-end">
            <TextField
              id="new-work-type"
              label="What is it called"
              value={newTypeLabel}
              onChange={setNewTypeLabel}
              placeholder="e.g. CNC routing"
            />
            <Button
              busy={busy}
              onClick={() => {
                setBusy(true);
                setError("");
                addWorkType(getDb(), actor, newTypeLabel)
                  .then(() => {
                    setNotice(
                      `Added "${newTypeLabel.trim()}". Set its rate below before logging work against it.`
                    );
                    setNewTypeLabel("");
                    setAddingType(false);
                    setTimeout(() => setNotice(""), 8000);
                  })
                  .catch((e) =>
                    setError(e instanceof Error ? e.message : "Could not add it.")
                  )
                  .finally(() => setBusy(false));
              }}
            >
              Add
            </Button>
            <Button variant="ghost" onClick={() => setAddingType(false)}>
              Cancel
            </Button>
          </div>
        )}

        {/* Hidden types, with a way back. Kept visible so it is clear they still exist and
            are still priced on historical runs. */}
        {hiddenTypes.length > 0 && (
          <div className="mt-4 border-t border-night-800 pt-4">
            <p className="text-xs text-cream-500">No longer offered:</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {hiddenTypes.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() =>
                    unhideWorkType(getDb(), actor, t.id, t.label).catch((e) =>
                      setError(e instanceof Error ? e.message : "Could not restore it.")
                    )
                  }
                  className="cursor-pointer rounded-full border border-night-600 px-3 py-1.5 text-xs text-cream-400 transition-colors hover:border-brass-500/60 hover:text-brass-300"
                >
                  {t.label} · offer again
                </button>
              ))}
            </div>
          </div>
        )}
      </section>

      <ul className="mt-6 space-y-3">
        {activeTypes.map((type) => {
          const wt = type.id;
          const live = current.get(wt);
          const seed = fallbackFor(wt);
          const past = history.get(wt) ?? [];
          const isEditing = editing === wt;

          return (
            <li
              key={wt}
              className="rounded-3xl border border-night-700/60 bg-night-900/40 p-5"
            >
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="min-w-0">
                  <p className="flex flex-wrap items-center gap-2 text-cream-100">
                    {type.label}
                    {!type.builtIn && (
                      <span className="rounded-full border border-night-600 px-2 py-0.5 text-[11px] text-cream-500">
                        added here
                      </span>
                    )}
                    {live?.estimated && (
                      <span className="rounded-full border border-amber-500/50 px-2 py-0.5 text-[11px] text-amber-300">
                        estimated
                      </span>
                    )}
                    {!live && (
                      <span className="rounded-full border border-night-600 px-2 py-0.5 text-[11px] text-cream-500">
                        default
                      </span>
                    )}
                  </p>
                  <p className="mt-1.5 text-sm text-cream-400">
                    Operator{" "}
                    <span className="text-cream-100">
                      {formatNaira(
                        live?.operatorRateKobo ?? toKobo(seed?.operatorRateNaira ?? 0)
                      )}
                    </span>
                    {"  ·  "}
                    Assistant{" "}
                    <span className="text-cream-100">
                      {formatNaira(
                        live?.assistantRateKobo ?? toKobo(seed?.assistantRateNaira ?? 0)
                      )}
                    </span>
                  </p>
                  {(live?.note ?? seed?.note) && (
                    <p className="mt-1.5 max-w-xl text-xs text-cream-500">
                      {live?.note ?? seed?.note}
                    </p>
                  )}
                </div>

                <div className="flex items-center gap-2">
                  {past.length > 0 && (
                    <button
                      type="button"
                      onClick={() => setShowHistory(showHistory === wt ? null : wt)}
                      className="flex cursor-pointer items-center gap-1.5 rounded-lg px-2.5 py-2 text-xs text-cream-400 transition-colors hover:text-brass-300"
                    >
                      <History size={13} /> {past.length} past
                    </button>
                  )}
                  {/* Removing a kind of work hides it from the pickers. Never deletes:
                      last year's work logs and wage runs reference it and have to keep
                      rendering a name, and the rate stays valid for reproducing them. */}
                  <button
                    type="button"
                    aria-label={`Stop offering ${type.label}`}
                    title="Stop offering this kind of work. Existing logs and rates keep it."
                    onClick={() => {
                      if (
                        !window.confirm(
                          `Stop offering "${type.label}"?\n\nIt disappears from the work log and rate pickers. Work already logged against it keeps its rate and still pays.`
                        )
                      )
                        return;
                      hideWorkType(getDb(), actor, wt, type.label)
                        .then(() => {
                          setNotice(`"${type.label}" is no longer offered.`);
                          setTimeout(() => setNotice(""), 6000);
                        })
                        .catch((e) =>
                          setError(
                            e instanceof Error ? e.message : "Could not remove it."
                          )
                        );
                    }}
                    className="cursor-pointer px-2 text-cream-500 transition-colors hover:text-red-400"
                  >
                    <Trash2 size={14} />
                  </button>
                  <Button variant="secondary" onClick={() => beginEdit(wt)}>
                    <span className="flex items-center gap-1.5">
                      <PenLine size={14} /> {live ? "Change" : "Set"}
                    </span>
                  </Button>
                </div>
              </div>

              {isEditing && (
                <div className="mt-4 grid gap-3 border-t border-night-700/60 pt-4 sm:grid-cols-2 lg:grid-cols-4 lg:items-end">
                  <NumberField
                    id={`op-${wt}`}
                    label="Operator (₦)"
                    value={operator}
                    onChange={setOperator}
                  />
                  <NumberField
                    id={`as-${wt}`}
                    label="Assistant (₦)"
                    value={assistant}
                    onChange={setAssistant}
                  />
                  <DateField
                    id={`from-${wt}`}
                    label="In force from"
                    value={effectiveFrom}
                    onChange={setEffectiveFrom}
                  />
                  <div className="flex gap-2">
                    <Button onClick={() => save(wt)} busy={busy}>
                      Save
                    </Button>
                    <Button variant="ghost" onClick={() => setEditing(null)}>
                      Cancel
                    </Button>
                  </div>
                  <div className="sm:col-span-2 lg:col-span-4">
                    <TextField
                      id={`note-${wt}`}
                      label="Why it changed (optional)"
                      value={note}
                      onChange={setNote}
                      placeholder="Agreed at the July review"
                    />
                  </div>
                </div>
              )}

              {showHistory === wt && past.length > 0 && (
                <ul className="mt-4 space-y-1.5 border-t border-night-700/60 pt-4 text-xs text-cream-500">
                  {past.map((p) => (
                    <li key={p.id} className="flex flex-wrap justify-between gap-2">
                      <span>
                        {p.effectiveFromMs
                          ? new Date(p.effectiveFromMs).toLocaleDateString("en-GB")
                          : "—"}
                        {" to "}
                        {p.effectiveToMs
                          ? new Date(p.effectiveToMs).toLocaleDateString("en-GB")
                          : "—"}
                      </span>
                      <span className="text-cream-400">
                        Operator {formatNaira(p.operatorRateKobo)} · Assistant{" "}
                        {formatNaira(p.assistantRateKobo)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </li>
          );
        })}
      </ul>

      {/* Rates for named people, which override the work-type rates above. */}
      <StaffRatesPanel />
    </div>
  );
}

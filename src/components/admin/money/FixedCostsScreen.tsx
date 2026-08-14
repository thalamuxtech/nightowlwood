"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  CalendarOff,
  CheckCircle2,
  Coins,
  PenLine,
  Plus,
  Receipt,
  ShieldAlert,
  Trash2,
} from "lucide-react";
import { getDb } from "@/lib/firebase";
import {
  EXPENSE_CATEGORIES,
  EXPENSE_CATEGORY_LABELS,
  type ExpenseCategory,
} from "@/lib/erp/enums";
import { formatNaira, parseNairaInput, toNaira } from "@/lib/erp/money";
import {
  createFixedCost,
  DEFAULT_FIXED_COSTS,
  deleteFixedCost,
  monthlyEquivalentKobo,
  payFixedCost,
  summariseFixedCosts,
  updateFixedCost,
  type FixedCostSummary,
} from "@/lib/erp/fixedCosts";
import { loadHolidays, setHoliday } from "@/lib/erp/hr";
import type { FixedCost, Holiday } from "@/lib/erp/types";
import {
  Button,
  CheckboxField,
  DateField,
  EmptyState,
  NairaField,
  NumberField,
  SelectField,
  TextField,
  todayIso,
  validDateKey,
} from "@/components/admin/ui/Fields";
import { StatusPill } from "@/components/admin/ui/StatusPill";
import { describeIso } from "@/components/admin/ui/DateField";
import { useAuditActor, useErpSession } from "@/components/admin/ErpAuthProvider";
import type { AuditActor } from "@/lib/erp/audit";

/**
 * Fixed costs and the closure calendar.
 *
 * Two things the workshop knows about the months ahead regardless of how much work comes
 * through: what it is committed to paying, and which days it will be shut. Both were in the
 * data layer with no way to see or set them.
 *
 * They sit on one screen because they answer the same question from two directions — what
 * does a month cost us even when nothing happens. Rent is owed on a day nobody worked, and a
 * week with three public holidays in it costs the same in salaries as a full one.
 */

const CADENCES = [
  { value: "monthly", label: "Every month" },
  { value: "quarterly", label: "Every quarter" },
  { value: "annual", label: "Once a year" },
] as const;

export function FixedCostsScreen() {
  const session = useErpSession();
  const canEdit = session.can("expense.create");
  const canDelete = session.can("record.delete");
  const canManageHolidays = session.can("holiday.manage");

  const [summary, setSummary] = useState<FixedCostSummary | null>(null);
  const [holidays, setHolidays] = useState<Holiday[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [version, setVersion] = useState(0);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<FixedCost | null>(null);

  // Holiday form.
  const [addingHoliday, setAddingHoliday] = useState(false);
  const [hName, setHName] = useState("");
  const [hFrom, setHFrom] = useState(todayIso());
  const [hTo, setHTo] = useState(todayIso());
  const [hKind, setHKind] = useState<"public" | "closure">("public");

  const actor = useAuditActor();

  const load = useCallback(() => {
    setLoading(true);
    /*
     * Holidays for the year around today.
     *
     * Wide enough to cover the season being planned and the one just past, which is what somebody
     * opening this screen is looking at. `loadHolidays` needs an explicit range.
     */
    const now = new Date();
    const from = new Date(now.getFullYear(), 0, 1);
    const to = new Date(now.getFullYear() + 1, 11, 31);

    Promise.all([summariseFixedCosts(getDb()), loadHolidays(getDb(), from, to)])
      .then(([s, h]) => {
        setSummary(s);
        setHolidays(h);
      })
      .catch((e) =>
        setError(e instanceof Error ? e.message : "Could not read the fixed costs.")
      )
      .finally(() => setLoading(false));
  }, []);

  useEffect(load, [load, version]);

  async function seed() {
    setError("");
    setBusy(true);
    try {
      let created = 0;
      const have = new Set(
        (summary?.costs ?? []).map((c) => c.name.trim().toLowerCase())
      );
      for (const cost of DEFAULT_FIXED_COSTS) {
        // Matched on name so a second run tops up rather than duplicating.
        if (have.has(cost.name.trim().toLowerCase())) continue;
        await createFixedCost(getDb(), actor, cost);
        created += 1;
      }
      setNotice(
        created > 0
          ? `${created} commitment(s) added. Check the figures against your own records.`
          : "Everything on the standard list is already here."
      );
      setTimeout(() => setNotice(""), 9000);
      setVersion((v) => v + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not add the standard costs.");
    } finally {
      setBusy(false);
    }
  }

  async function pay(cost: FixedCost) {
    const when = window.prompt(
      `Record a payment of ${formatNaira(cost.amountKobo)} for ${cost.name}?\n\nWhat date? (yyyy-mm-dd)`,
      todayIso()
    );
    if (when === null) return;

    /*
     * Validated before it reaches a money write.
     *
     * A prompt returns whatever was typed. `"garbage".split("-").map(Number)` is `[NaN]`, which
     * becomes an Invalid Date and then a corrupt timestamp on an expense nobody notices until a
     * month is short.
     */
    const dateKey = validDateKey(when.trim() || todayIso());
    if (!dateKey) {
      setError("That is not a date. Use yyyy-mm-dd, for example 2026-08-13.");
      return;
    }

    setError("");
    setBusy(true);
    try {
      const [y, m, d] = dateKey.split("-").map(Number);
      await payFixedCost(getDb(), actor, cost, { date: new Date(y, m - 1, d) });
      setNotice(`${cost.name} recorded as paid. It is now in the expense ledger.`);
      setTimeout(() => setNotice(""), 8000);
      setVersion((v) => v + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not record the payment.");
    } finally {
      setBusy(false);
    }
  }

  async function remove(cost: FixedCost) {
    const reason = window.prompt(
      `Remove ${cost.name} from the fixed costs?\n\nGive a reason — it is kept in the audit log.`
    );
    if (reason === null) return;
    setError("");
    setBusy(true);
    try {
      await deleteFixedCost(getDb(), actor, cost.id, cost.name, reason);
      setNotice(`${cost.name} removed.`);
      setTimeout(() => setNotice(""), 6000);
      setVersion((v) => v + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not remove it.");
    } finally {
      setBusy(false);
    }
  }

  async function saveHoliday() {
    setError("");
    if (!hName.trim()) {
      setError("Name the holiday or closure.");
      return;
    }
    if (hTo < hFrom) {
      setError("The last day is before the first.");
      return;
    }
    setBusy(true);
    try {
      const [fy, fm, fd] = hFrom.split("-").map(Number);
      const [ty, tm, td] = hTo.split("-").map(Number);
      await setHoliday(getDb(), actor, {
        name: hName,
        startDate: new Date(fy, fm - 1, fd),
        endDate: new Date(ty, tm - 1, td),
        kind: hKind,
      });
      setNotice(
        hFrom === hTo
          ? `${hName.trim()} marked for ${describeIso(hFrom)}.`
          : `${hName.trim()} marked from ${hFrom} to ${hTo}.`
      );
      setTimeout(() => setNotice(""), 8000);
      setAddingHoliday(false);
      setHName("");
      setVersion((v) => v + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save it.");
    } finally {
      setBusy(false);
    }
  }

  const active = (summary?.costs ?? []).filter((c) => c.active !== false);
  const inactive = (summary?.costs ?? []).filter((c) => c.active === false);

  return (
    <div>
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl text-cream-50">Fixed costs &amp; closures</h1>
          <p className="mt-1.5 max-w-2xl text-sm text-cream-400">
            What a month costs before a single board is cut, and the days the workshop will be
            shut. Both are true whether or not any work comes through.
          </p>
        </div>
        {canEdit && !adding && (
          <Button onClick={() => setAdding(true)}>
            <span className="flex items-center gap-1.5">
              <Plus size={15} /> Add a commitment
            </span>
          </Button>
        )}
      </header>

      {error && (
        <p
          role="alert"
          className="mt-6 flex items-start gap-2 rounded-xl border border-red-500/40 bg-red-500/5 px-4 py-3 text-sm text-red-300"
        >
          <ShieldAlert size={16} className="mt-0.5 shrink-0" /> {error}
        </p>
      )}
      {notice && (
        <p
          role="status"
          className="mt-6 flex items-start gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/5 px-4 py-3 text-sm text-emerald-300"
        >
          <CheckCircle2 size={16} className="mt-0.5 shrink-0" /> {notice}
        </p>
      )}

      {loading ? (
        <p className="mt-8 text-sm text-cream-500">Adding it up…</p>
      ) : !summary ? (
        <p className="mt-8 text-sm text-cream-500">Nothing on file.</p>
      ) : (
        <>
          {/* The monthly floor — the figure this screen exists to produce. */}
          <div className="mt-8 grid gap-4 sm:grid-cols-3">
            <Tile
              label="Commitments a month"
              value={formatNaira(summary.monthlyTotalKobo)}
              hint={`${active.length} active`}
            />
            <Tile
              label="Salaries a month"
              value={formatNaira(summary.salaryMonthlyKobo)}
              hint="read from staff records"
            />
            <Tile
              label="Monthly floor"
              value={formatNaira(summary.monthlyFloorKobo)}
              hint="what a month costs before any work"
              strong
            />
          </div>

          <p className="mt-4 max-w-2xl text-xs leading-relaxed text-cream-500">
            Annual and quarterly commitments are divided down so everything compares on one
            timescale — ₦4m of rent a year is ₦333,333 a month. Salaries come from the staff
            records rather than being entered here, because entering them twice is how a raise
            gets applied in one place and not the other.
          </p>

          {adding && canEdit && (
            <CostForm
              actor={actor}
              onClose={() => setAdding(false)}
              onSaved={() => {
                setNotice("Commitment added.");
                setTimeout(() => setNotice(""), 6000);
                setAdding(false);
                setVersion((v) => v + 1);
              }}
              onError={setError}
            />
          )}

          {/* Commitments */}
          <section className="mt-8">
            <div className="flex flex-wrap items-baseline justify-between gap-3">
              <h2 className="flex items-center gap-2 font-display text-lg text-cream-100">
                <Coins size={18} className="text-brass-400" /> Commitments
              </h2>
              {canEdit && active.length === 0 && (
                <Button variant="secondary" onClick={seed} busy={busy}>
                  Add the standard list
                </Button>
              )}
            </div>

            {active.length === 0 ? (
              <div className="mt-4">
                <EmptyState
                  title="No commitments recorded"
                  hint="Rent, water, subscriptions, contributions — the things owed whether or not the saw runs."
                />
              </div>
            ) : (
              <div className="mt-4 space-y-2">
                {active.map((c) => (
                  <div
                    key={c.id}
                    className="flex flex-wrap items-center gap-3 rounded-2xl border border-night-700/60 bg-night-900/30 p-4"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-cream-100">{c.name}</span>
                      <span className="mt-0.5 block text-xs text-cream-500">
                        {EXPENSE_CATEGORY_LABELS[c.category]} ·{" "}
                        {CADENCES.find((x) => x.value === c.cadence)?.label ?? c.cadence}
                        {c.dueDay ? ` · due on the ${c.dueDay}` : ""}
                      </span>
                    </span>

                    <span className="text-right">
                      <span className="block font-display text-lg text-cream-100">
                        {formatNaira(c.amountKobo)}
                      </span>
                      {c.cadence !== "monthly" && (
                        <span className="block text-xs text-cream-600">
                          {formatNaira(monthlyEquivalentKobo(c))} a month
                        </span>
                      )}
                    </span>

                    {canEdit && (
                      <span className="flex items-center gap-1">
                        <Button variant="ghost" onClick={() => pay(c)}>
                          <span className="flex items-center gap-1.5 text-xs">
                            <Receipt size={13} /> Paid
                          </span>
                        </Button>
                        <button
                          type="button"
                          onClick={() => setEditing(editing?.id === c.id ? null : c)}
                          className="cursor-pointer rounded-lg p-2 text-cream-600 transition-colors hover:text-brass-300"
                          aria-label={`Edit ${c.name}`}
                        >
                          <PenLine size={15} />
                        </button>
                        {canDelete && (
                          <button
                            type="button"
                            onClick={() => remove(c)}
                            className="cursor-pointer rounded-lg p-2 text-cream-600 transition-colors hover:text-red-300"
                            aria-label={`Remove ${c.name}`}
                          >
                            <Trash2 size={15} />
                          </button>
                        )}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            )}

            {editing && canEdit && (
              <CostForm
                actor={actor}
                editing={editing}
                onClose={() => setEditing(null)}
                onSaved={() => {
                  setNotice("Commitment updated.");
                  setTimeout(() => setNotice(""), 6000);
                  setEditing(null);
                  setVersion((v) => v + 1);
                }}
                onError={setError}
              />
            )}

            {inactive.length > 0 && (
              <p className="mt-4 text-xs text-cream-600">
                {inactive.length} inactive commitment
                {inactive.length === 1 ? "" : "s"} not counted in the floor:{" "}
                {inactive.map((c) => c.name).join(", ")}.
              </p>
            )}
          </section>

          {/* Closures */}
          <section className="mt-10">
            <div className="flex flex-wrap items-baseline justify-between gap-3">
              <div>
                <h2 className="flex items-center gap-2 font-display text-lg text-cream-100">
                  <CalendarOff size={18} className="text-brass-400" /> Holidays &amp; closures
                </h2>
                <p className="mt-1 max-w-2xl text-sm text-cream-400">
                  Recorded so an empty work log is explained. Without it, a public holiday and a
                  day nobody wrote anything down look identical — and that is always the first
                  question about a light week.
                </p>
              </div>
              {canManageHolidays && !addingHoliday && (
                <Button variant="secondary" onClick={() => setAddingHoliday(true)}>
                  <span className="flex items-center gap-1.5">
                    <Plus size={15} /> Mark days
                  </span>
                </Button>
              )}
            </div>

            {addingHoliday && canManageHolidays && (
              <div className="mt-5 rounded-3xl border border-brass-500/30 bg-night-900/40 p-6">
                <div className="grid gap-5 sm:grid-cols-2">
                  <TextField
                    id="hol-name"
                    label="What is it"
                    value={hName}
                    onChange={setHName}
                    required
                    placeholder="e.g. Eid el-Kabir"
                  />
                  <SelectField
                    id="hol-kind"
                    label="Kind"
                    value={hKind}
                    onChange={(v) => setHKind(v as "public" | "closure")}
                    options={[
                      { value: "public", label: "Public holiday" },
                      { value: "closure", label: "Workshop closure" },
                    ]}
                  />
                  <DateField id="hol-from" label="First day" value={hFrom} onChange={setHFrom} />
                  {/* A range, because Sallah is several days and marking each one separately is
                      how the last of them gets missed. */}
                  <DateField
                    id="hol-to"
                    label="Last day"
                    value={hTo}
                    onChange={setHTo}
                    min={hFrom}
                    hint="same as the first for a single day"
                  />
                </div>
                <div className="mt-6 flex flex-wrap gap-3">
                  <Button onClick={saveHoliday} busy={busy} disabled={!hName.trim()}>
                    Mark it
                  </Button>
                  <Button variant="ghost" onClick={() => setAddingHoliday(false)}>
                    Cancel
                  </Button>
                </div>
              </div>
            )}

            {holidays.length === 0 ? (
              <div className="mt-5">
                <EmptyState
                  title="No closures marked this year"
                  hint="Mark the public holidays and any days the workshop shuts."
                />
              </div>
            ) : (
              <div className="mt-5 space-y-2">
                {holidays.map((h) => {
                  const startMs = h.startDate?.toMillis?.() ?? null;
                  const endMs = h.endDate?.toMillis?.() ?? null;
                  const single = startMs !== null && endMs !== null && startMs === endMs;
                  const fmt = (ms: number) =>
                    new Date(ms).toLocaleDateString("en-GB", {
                      weekday: "short",
                      day: "numeric",
                      month: "short",
                      year: "numeric",
                    });
                  const days =
                    startMs !== null && endMs !== null
                      ? Math.round((endMs - startMs) / 86_400_000) + 1
                      : 1;

                  return (
                    <div
                      key={h.id}
                      className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-night-700/60 bg-night-900/30 p-4"
                    >
                      <span className="min-w-0">
                        <span className="block text-cream-100">{h.name}</span>
                        <span className="mt-0.5 block text-xs text-cream-500">
                          {startMs === null
                            ? "date not recorded"
                            : single
                              ? fmt(startMs)
                              : `${fmt(startMs)} to ${endMs !== null ? fmt(endMs) : "?"}`}
                          {days > 1 && ` · ${days} days`}
                        </span>
                      </span>
                      <StatusPill tone={h.kind === "public" ? "info" : "neutral"}>
                        {h.kind === "public" ? "Public holiday" : "Closure"}
                      </StatusPill>
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}

/** Add or correct one commitment. */
function CostForm({
  actor,
  editing,
  onClose,
  onSaved,
  onError,
}: {
  actor: AuditActor;
  editing?: FixedCost;
  onClose: () => void;
  onSaved: () => void;
  onError: (message: string) => void;
}) {
  const [name, setName] = useState(editing?.name ?? "");
  const [category, setCategory] = useState<ExpenseCategory>(editing?.category ?? "admin");
  const [amount, setAmount] = useState(editing ? String(toNaira(editing.amountKobo)) : "");
  const [cadence, setCadence] = useState<FixedCost["cadence"]>(editing?.cadence ?? "monthly");
  const [dueDay, setDueDay] = useState(editing?.dueDay ? String(editing.dueDay) : "");
  const [active, setActive] = useState(editing ? editing.active !== false : true);
  const [notes, setNotes] = useState(editing?.notes ?? "");
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    try {
      const input = {
        name,
        category,
        amountKobo: parseNairaInput(amount),
        cadence,
        dueDay: dueDay ? Number(dueDay) : undefined,
        active,
        notes: notes || undefined,
      };
      if (editing) {
        await updateFixedCost(getDb(), actor, editing.id, input);
      } else {
        await createFixedCost(getDb(), actor, input);
      }
      onSaved();
    } catch (e) {
      onError(e instanceof Error ? e.message : "Could not save it.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="mt-5 rounded-3xl border border-brass-500/30 bg-night-900/40 p-6">
      <h3 className="font-display text-lg text-cream-100">
        {editing ? `Edit ${editing.name}` : "New commitment"}
      </h3>
      <div className="mt-5 grid gap-5 sm:grid-cols-2">
        <TextField
          id="fc-name"
          label="What it is"
          value={name}
          onChange={setName}
          required
          placeholder="e.g. Rent"
        />
        <SelectField
          id="fc-category"
          label="Category"
          value={category}
          onChange={(v) => setCategory(v as ExpenseCategory)}
          options={EXPENSE_CATEGORIES.map((c) => ({
            value: c,
            label: EXPENSE_CATEGORY_LABELS[c],
          }))}
        />
        <NairaField id="fc-amount" label="Amount" valueKobo={amount} onChangeKobo={setAmount} />
        <SelectField
          id="fc-cadence"
          label="How often"
          value={cadence}
          onChange={(v) => setCadence(v as FixedCost["cadence"])}
          options={CADENCES.map((c) => ({ value: c.value, label: c.label }))}
        />
        <NumberField
          id="fc-due"
          label="Due on which day"
          value={dueDay}
          onChange={setDueDay}
          step={1}
          min={1}
          hint="optional, 1–31"
        />
        <TextField id="fc-notes" label="Notes" value={notes} onChange={setNotes} />
        {editing && (
          <div className="sm:col-span-2">
            <CheckboxField
              id="fc-active"
              label="Still committed to this"
              checked={active}
              onChange={setActive}
            />
            <p className="mt-2 text-xs text-cream-500">
              Turning it off leaves the record but drops it out of the monthly floor — for a
              subscription cancelled rather than one entered by mistake.
            </p>
          </div>
        )}
      </div>
      <div className="mt-6 flex flex-wrap gap-3">
        <Button onClick={save} busy={busy} disabled={!name.trim()}>
          {editing ? "Save changes" : "Add it"}
        </Button>
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
      </div>
    </section>
  );
}

function Tile({
  label,
  value,
  hint,
  strong,
}: {
  label: string;
  value: string;
  hint?: string;
  strong?: boolean;
}) {
  return (
    <div
      className={`rounded-3xl border p-5 ${
        strong ? "border-brass-500/40 bg-brass-500/5" : "border-night-700/60 bg-night-900/40"
      }`}
    >
      <p className="text-xs uppercase tracking-wider text-cream-500">{label}</p>
      <p
        className={`mt-2 font-display text-2xl ${
          strong ? "text-brass-300" : "text-cream-50"
        }`}
      >
        {value}
      </p>
      {hint && <p className="mt-1 text-xs text-cream-500">{hint}</p>}
    </div>
  );
}

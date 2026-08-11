"use client";

import { useEffect, useMemo, useState } from "react";
import { collection, onSnapshot, orderBy, query } from "firebase/firestore";
import {
  Loader2,
  Plus,
  ShieldAlert,
  UserCog,
  X,
} from "lucide-react";
import { getDb } from "@/lib/firebase";
import { COL } from "@/lib/erp/collections";
import {
  WAGE_WORK_TYPES,
  WAGE_WORK_TYPE_LABELS,
  type WageWorkType,
} from "@/lib/erp/enums";
import { formatNaira, parseNairaInput } from "@/lib/erp/money";
import { endStaffRate, setStaffRate } from "@/lib/erp/payroll";
import { resolveStaffRates } from "@/lib/erp/wages";
import type { StaffRate } from "@/lib/erp/types";
import { fromDateInputValue, toDateInputValue } from "@/lib/erp/workLogs";
import {
  Button,
  DateField,
  EmptyState,
  NairaField,
  SelectField,
  TextField,
} from "@/components/admin/ui/Fields";
import { useErpSession } from "@/components/admin/ErpAuthProvider";

interface StaffOption {
  id: string;
  name: string;
  isOperator: boolean;
  isAssistant: boolean;
}

interface RateRow extends StaffRate {
  effectiveFromMs: number | null;
  effectiveToMs: number | null;
}

/**
 * Rates for named individuals, overriding the standard piece rate.
 *
 * The piece rates above price a *kind of work*. This prices a *person doing it*,
 * which is the distinction the previous system could not express: two operators on
 * the same machine are not necessarily paid the same, and the only way to pay one of
 * them more was to raise the rate for everybody.
 *
 * A row with no work type is the common case — one person on a better rate across
 * the board. A row naming a work type takes precedence over it, so a general uplift
 * and a single deliberate exception can both be in force.
 */
export function StaffRatesPanel() {
  const session = useErpSession();
  const canEdit = session.can("wage.editRates");

  const [rates, setRates] = useState<RateRow[]>([]);
  const [staff, setStaff] = useState<StaffOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);

  // Form
  const [staffId, setStaffId] = useState("");
  const [role, setRole] = useState<"operator" | "assistant">("operator");
  const [workType, setWorkType] = useState<WageWorkType | "">("");
  const [amount, setAmount] = useState("");
  const [effectiveFrom, setEffectiveFrom] = useState(toDateInputValue(new Date()));
  const [note, setNote] = useState("");

  useEffect(() => {
    if (!canEdit) {
      setLoading(false);
      return;
    }
    return onSnapshot(
      query(collection(getDb(), COL.staffRates), orderBy("effectiveFrom", "desc")),
      (snap) => {
        setRates(
          snap.docs.map((d) => {
            const x = d.data() as StaffRate;
            return {
              ...x,
              id: d.id,
              effectiveFromMs: x.effectiveFrom?.toMillis?.() ?? null,
              effectiveToMs: x.effectiveTo?.toMillis?.() ?? null,
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
  }, [canEdit]);

  useEffect(() => {
    return onSnapshot(
      query(collection(getDb(), COL.staff), orderBy("name", "asc")),
      (snap) =>
        setStaff(
          snap.docs
            .filter((d) => d.data().active !== false)
            .map((d) => ({
              id: d.id,
              name: (d.data().name as string) ?? "",
              isOperator: d.data().isOperator === true,
              isAssistant: d.data().isAssistant === true,
            }))
        ),
      () => {}
    );
  }, []);

  const actor = useMemo(
    () => ({
      uid: session.user?.uid ?? "",
      email: session.user?.email ?? "",
      role: session.role ?? "admin",
    }),
    [session.user, session.role]
  );

  /** Only the rates in force now; superseded rows are history, not settings. */
  const live = useMemo(() => {
    const now = Date.now();
    return rates
      .filter((r) => {
        const from = r.effectiveFromMs ?? 0;
        const to = r.effectiveToMs ?? Number.POSITIVE_INFINITY;
        return from <= now && to > now;
      })
      .sort(
        (a, b) =>
          (a.staffName ?? "").localeCompare(b.staffName ?? "") ||
          a.role.localeCompare(b.role)
      );
  }, [rates]);

  /**
   * What the engine would actually resolve right now.
   *
   * Shown rather than assumed, because the precedence rule (a work-type row beats a
   * general one) is the part that surprises people: someone can save a general rate
   * and not see it apply to the one work type they already made an exception for.
   */
  const resolvedNow = useMemo(
    () => resolveStaffRates(rates as StaffRate[], Date.now()),
    [rates]
  );

  const eligible = useMemo(
    () =>
      staff.filter((s) =>
        role === "operator" ? s.isOperator || !s.isAssistant : s.isAssistant
      ),
    [staff, role]
  );

  async function save() {
    setError("");
    const person = staff.find((s) => s.id === staffId);
    if (!person) {
      setError("Choose who this rate is for.");
      return;
    }
    const rateKobo = parseNairaInput(amount);
    if (!(rateKobo > 0)) {
      setError("Enter the rate per unit.");
      return;
    }

    setBusyId("new");
    try {
      await setStaffRate(getDb(), actor, {
        staffId: person.id,
        staffName: person.name,
        role,
        workType: workType || null,
        rateKobo,
        effectiveFrom: fromDateInputValue(effectiveFrom),
        note,
      });
      setNotice(
        `${person.name} is now on ${formatNaira(rateKobo)} per unit for ` +
          `${workType ? WAGE_WORK_TYPE_LABELS[workType] : "all work"} as ${role}.`
      );
      setTimeout(() => setNotice(""), 6000);
      setAdding(false);
      setStaffId("");
      setAmount("");
      setWorkType("");
      setNote("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save the rate.");
    } finally {
      setBusyId(null);
    }
  }

  if (!canEdit) return null;

  return (
    <section className="mt-12">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 className="flex items-center gap-2 font-display text-lg text-cream-100">
            <UserCog size={18} className="text-brass-400" /> Rates for individuals
          </h2>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-cream-400">
            Pays one person differently from the standard rate, so raising one
            operator does not raise everybody. Anyone without a rate here is paid the
            piece rate above.
          </p>
        </div>
        {!adding && (
          <Button onClick={() => setAdding(true)}>
            <span className="flex items-center gap-2">
              <Plus size={15} /> Set a personal rate
            </span>
          </Button>
        )}
      </header>

      {error && (
        <p
          role="alert"
          className="mt-5 flex items-start gap-2 rounded-xl border border-red-500/30 bg-red-500/5 px-4 py-3 text-sm text-red-400"
        >
          <ShieldAlert size={16} className="mt-0.5 shrink-0" /> {error}
        </p>
      )}
      {notice && (
        <p role="status" className="mt-5 text-sm text-emerald-300">
          {notice}
        </p>
      )}

      {adding && (
        <div className="mt-6 rounded-3xl border border-brass-500/30 bg-night-900/40 p-6">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <SelectField
              id="sr-role"
              label="Paid as"
              value={role}
              onChange={(v) => setRole(v as "operator" | "assistant")}
              options={[
                { value: "operator", label: "Operator" },
                { value: "assistant", label: "Assistant" },
              ]}
            />
            <SelectField
              id="sr-staff"
              label="Person"
              value={staffId}
              onChange={setStaffId}
              placeholder={eligible.length ? "Select…" : "No matching staff"}
              required
              options={eligible.map((s) => ({ value: s.id, label: s.name }))}
            />
            <SelectField
              id="sr-worktype"
              label="Applies to"
              value={workType}
              onChange={(v) => setWorkType(v as WageWorkType)}
              placeholder="All kinds of work"
              options={WAGE_WORK_TYPES.map((w) => ({
                value: w,
                label: WAGE_WORK_TYPE_LABELS[w],
              }))}
            />
            <NairaField
              id="sr-amount"
              label="Rate per unit"
              valueKobo={amount}
              onChangeKobo={setAmount}
              required
            />
            <DateField
              id="sr-from"
              label="Effective from"
              value={effectiveFrom}
              onChange={setEffectiveFrom}
              required
            />
            <TextField
              id="sr-note"
              label="Why (optional)"
              value={note}
              onChange={setNote}
              placeholder="Agreed at the July review"
            />
          </div>

          <p className="mt-4 text-xs leading-relaxed text-cream-500">
            Saving closes whatever this person was on for the same role and work type,
            and opens a new rate from the date given. Wage runs already generated keep
            the rates they were priced at.
          </p>

          <div className="mt-5 flex gap-3">
            <Button onClick={save} busy={busyId === "new"}>
              Save rate
            </Button>
            <Button variant="ghost" onClick={() => setAdding(false)}>
              Cancel
            </Button>
          </div>
        </div>
      )}

      {loading ? (
        <div className="mt-6 flex justify-center py-8">
          <Loader2 className="animate-spin text-brass-400" size={22} aria-label="Loading" />
        </div>
      ) : live.length === 0 ? (
        <div className="mt-6">
          <EmptyState
            title="Everyone is on the standard rates"
            hint="Set a personal rate when one person is paid differently for the same work."
          />
        </div>
      ) : (
        <div className="mt-6 overflow-x-auto rounded-3xl border border-night-700/60">
          <table className="w-full min-w-[42rem] text-left text-sm">
            <thead className="bg-night-900/70 text-xs uppercase tracking-wider text-cream-500">
              <tr>
                <th className="px-5 py-3 font-medium">Person</th>
                <th className="px-5 py-3 font-medium">Paid as</th>
                <th className="px-5 py-3 font-medium">Applies to</th>
                <th className="px-5 py-3 text-right font-medium">Rate</th>
                <th className="px-5 py-3 font-medium">From</th>
                <th className="px-5 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-night-800">
              {live.map((r) => {
                // A general rate that a work-type rate for the same person and role
                // sits on top of. Flagged, because it looks inactive otherwise.
                const shadowed =
                  !r.workType &&
                  live.some(
                    (o) =>
                      o.staffId === r.staffId && o.role === r.role && o.workType
                  );
                return (
                  <tr key={r.id} className="transition-colors hover:bg-night-900/40">
                    <td className="px-5 py-3.5 text-cream-100">{r.staffName}</td>
                    <td className="px-5 py-3.5 capitalize text-cream-300">{r.role}</td>
                    <td className="px-5 py-3.5 text-cream-300">
                      {r.workType ? WAGE_WORK_TYPE_LABELS[r.workType] : "All work"}
                      {shadowed && (
                        <span className="mt-0.5 block text-xs text-cream-500">
                          overridden for some work types
                        </span>
                      )}
                    </td>
                    <td className="px-5 py-3.5 text-right tabular-nums text-cream-100">
                      {formatNaira(r.rateKobo)}
                    </td>
                    <td className="px-5 py-3.5 text-xs text-cream-500">
                      {r.effectiveFromMs
                        ? new Date(r.effectiveFromMs).toLocaleDateString("en-GB", {
                            day: "numeric",
                            month: "short",
                            year: "numeric",
                          })
                        : "—"}
                      {r.note && (
                        <span className="mt-0.5 block text-cream-600">{r.note}</span>
                      )}
                    </td>
                    <td className="px-5 py-3.5 text-right">
                      <button
                        type="button"
                        aria-label={`End the personal rate for ${r.staffName}`}
                        disabled={busyId === r.id}
                        onClick={() => {
                          setBusyId(r.id);
                          endStaffRate(getDb(), actor, r.id)
                            .then(() => {
                              setNotice(
                                `${r.staffName} is back on the standard rate.`
                              );
                              setTimeout(() => setNotice(""), 6000);
                            })
                            .catch((e) =>
                              setError(
                                e instanceof Error ? e.message : "Could not end the rate."
                              )
                            )
                            .finally(() => setBusyId(null));
                        }}
                        className="cursor-pointer text-cream-500 transition-colors hover:text-red-400 disabled:opacity-40"
                      >
                        <X size={15} />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {live.length > 0 && (
        <p className="mt-4 text-xs leading-relaxed text-cream-600">
          {resolvedNow.size} personal rate{resolvedNow.size === 1 ? "" : "s"} in force.
          Where a person has both a general rate and one for a specific kind of work,
          the specific one is used for that work and the general one for everything
          else.
        </p>
      )}
    </section>
  );
}

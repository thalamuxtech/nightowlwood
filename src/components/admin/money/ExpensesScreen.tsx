"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import {
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
} from "recharts";
import { collection, limit, onSnapshot, orderBy, query } from "firebase/firestore";
import { Loader2, PenLine, Plus, Receipt, ShieldAlert, Trash2 } from "lucide-react";
import { getDb } from "@/lib/firebase";
import { COL } from "@/lib/erp/collections";
import {
  EXPENSE_CATEGORIES,
  EXPENSE_CATEGORY_LABELS,
  type ExpenseCategory,
} from "@/lib/erp/enums";
import { formatNaira, formatNairaCompact, parseNairaInput, toNaira } from "@/lib/erp/money";
import { deleteExpense, recordExpense, updateExpense } from "@/lib/erp/ledgers";
import { fromDateInputValue, toDateInputValue } from "@/lib/erp/workLogs";
import { LiveCounter } from "@/components/admin/ui/LiveCounter";
import {
  Button,
  EmptyState,
  NumberField,
  SelectField,
  TextField,
} from "@/components/admin/ui/Fields";
import { useErpSession } from "@/components/admin/ErpAuthProvider";
import { TOOLTIP_PROPS } from "@/components/admin/ui/chartTheme";

/** Brand-derived series, reused from the dashboard palette. */
const SERIES = ["#c08a3e", "#8a6a45", "#d9b678", "#5c3f22", "#e0c99a", "#a08050"];

interface ExpenseRow {
  id: string;
  dateMs: number | null;
  payeeType: string;
  payeeName: string;
  purpose: string;
  category: ExpenseCategory;
  amountKobo: number;
}

type RangeKey = "30d" | "90d" | "all";

const RANGES: Array<{ key: RangeKey; label: string; days: number | null }> = [
  { key: "30d", label: "30 days", days: 30 },
  { key: "90d", label: "90 days", days: 90 },
  { key: "all", label: "All", days: null },
];

/**
 * Expense ledger, replacing the Daily Expenditure sheet.
 *
 * The sheet recorded a payee, purpose and amount with no category, so the only
 * question it could answer was "what did we spend". Categories are what let the
 * breakdown answer "on what", which is the question that leads to a decision.
 */
export function ExpensesScreen() {
  const session = useErpSession();
  const canRecord = session.can("expense.create");
  const isAdmin = session.role === "admin";

  const [rows, setRows] = useState<ExpenseRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [range, setRange] = useState<RangeKey>("30d");
  const [categoryFilter, setCategoryFilter] = useState<ExpenseCategory | "all">("all");

  useEffect(() => {
    const q = query(collection(getDb(), COL.expenses), orderBy("date", "desc"), limit(400));
    return onSnapshot(
      q,
      (snap) => {
        setRows(
          snap.docs.map((d) => {
            const x = d.data();
            return {
              id: d.id,
              dateMs: x.date?.toMillis?.() ?? null,
              payeeType: x.payeeType ?? "company",
              payeeName: x.payeeName ?? "",
              purpose: x.purpose ?? "",
              category: (x.category as ExpenseCategory) ?? "other",
              amountKobo: x.amountKobo ?? 0,
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
  }, []);

  const actor = useMemo(
    () => ({
      uid: session.user?.uid ?? "",
      email: session.user?.email ?? "",
      role: session.role ?? "manager",
    }),
    [session.user, session.role]
  );

  const days = RANGES.find((r) => r.key === range)?.days ?? null;

  const inRange = useMemo(() => {
    if (days === null) return rows;
    const cutoff = Date.now() - days * 86_400_000;
    return rows.filter((r) => r.dateMs !== null && r.dateMs >= cutoff);
  }, [rows, days]);

  const visible = useMemo(
    () =>
      categoryFilter === "all"
        ? inRange
        : inRange.filter((r) => r.category === categoryFilter),
    [inRange, categoryFilter]
  );

  const byCategory = useMemo(() => {
    const m = new Map<ExpenseCategory, number>();
    for (const r of inRange) m.set(r.category, (m.get(r.category) ?? 0) + r.amountKobo);
    return [...m.entries()]
      .map(([category, kobo]) => ({
        category,
        name: EXPENSE_CATEGORY_LABELS[category] ?? category,
        value: kobo / 100,
        kobo,
      }))
      .sort((a, b) => b.kobo - a.kobo);
  }, [inRange]);

  const total = inRange.reduce((s, r) => s + r.amountKobo, 0);
  const largest = byCategory[0];

  return (
    <div className="mx-auto max-w-6xl pb-20">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-eyebrow">Money</p>
          <h1 className="text-title mt-3 text-cream-50">Expenses</h1>
          <p className="mt-3 max-w-2xl text-sm leading-relaxed text-cream-400">
            Everything paid out, categorised so the breakdown answers what the
            money went on rather than only how much left.
          </p>
        </div>
        {canRecord && !adding && (
          <Button onClick={() => setAdding(true)}>
            <span className="flex items-center gap-2">
              <Plus size={15} /> Record expense
            </span>
          </Button>
        )}
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
        <ExpenseForm actor={actor} onClose={() => setAdding(false)} onError={setError} />
      )}

      <div className="mt-8 flex flex-wrap gap-2">
        {RANGES.map((r) => (
          <button
            key={r.key}
            type="button"
            onClick={() => setRange(r.key)}
            aria-pressed={range === r.key}
            className={`cursor-pointer rounded-full border px-4 py-2 text-xs font-medium transition-all duration-300 ${
              range === r.key
                ? "border-brass-500 bg-brass-500 text-night-950"
                : "border-night-600 text-cream-300 hover:border-brass-500/60 hover:text-brass-300"
            }`}
          >
            {r.label}
          </button>
        ))}
      </div>

      <div className="mt-6 grid gap-4 sm:grid-cols-3">
        <Tile
          label="Total spend"
          value={
            <LiveCounter
              value={total}
              format={(n) => formatNaira(n)}
              className="font-display text-2xl text-cream-50"
            />
          }
        />
        <Tile
          label="Entries"
          value={
            <LiveCounter value={inRange.length} className="font-display text-2xl text-cream-50" />
          }
        />
        <Tile
          label="Largest category"
          value={
            <span className="font-display text-2xl text-brass-300">
              {largest ? largest.name : "-"}
            </span>
          }
          hint={
            largest && total > 0
              ? `${Math.round((largest.kobo / total) * 100)}% of spend`
              : undefined
          }
        />
      </div>

      {byCategory.length > 0 && (
        <motion.section
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
          className="mt-6 grid gap-6 lg:grid-cols-[1fr_1.2fr]"
        >
          <div className="rounded-3xl border border-night-700/60 bg-night-900/40 p-6">
            <h2 className="font-display text-lg text-cream-100">Where it went</h2>
            <div className="mt-4">
              <ResponsiveContainer width="100%" height={230}>
                <PieChart>
                  <Pie
                    data={byCategory}
                    dataKey="value"
                    nameKey="name"
                    innerRadius={54}
                    outerRadius={92}
                    paddingAngle={2}
                    animationDuration={900}
                  >
                    {byCategory.map((_, i) => (
                      <Cell key={i} fill={SERIES[i % SERIES.length]} stroke="none" />
                    ))}
                  </Pie>
                  <Tooltip
                    {...TOOLTIP_PROPS}
                    formatter={(v: number) => formatNaira(Number(v) * 100)}
                  />
                </PieChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="rounded-3xl border border-night-700/60 bg-night-900/40 p-6">
            <h2 className="font-display text-lg text-cream-100">By category</h2>
            <ul className="mt-4 space-y-2.5">
              {byCategory.map((c, i) => (
                <li key={c.category}>
                  <button
                    type="button"
                    onClick={() =>
                      setCategoryFilter(categoryFilter === c.category ? "all" : c.category)
                    }
                    className="w-full cursor-pointer text-left"
                  >
                    <span className="flex items-baseline justify-between gap-3">
                      <span className="flex min-w-0 items-center gap-2">
                        <span
                          aria-hidden
                          className="h-2.5 w-2.5 shrink-0 rounded-sm"
                          style={{ background: SERIES[i % SERIES.length] }}
                        />
                        <span
                          className={`truncate text-sm ${
                            categoryFilter === c.category ? "text-brass-300" : "text-cream-300"
                          }`}
                        >
                          {c.name}
                        </span>
                      </span>
                      <span className="shrink-0 text-sm text-cream-100">
                        {formatNairaCompact(c.kobo)}
                      </span>
                    </span>
                    {/* Proportional bar: reading a share is faster than comparing figures */}
                    <span
                      aria-hidden
                      className="mt-1 block h-1 rounded-full bg-night-800"
                    >
                      <span
                        className="block h-1 rounded-full transition-all duration-500"
                        style={{
                          width: `${total > 0 ? (c.kobo / total) * 100 : 0}%`,
                          background: SERIES[i % SERIES.length],
                        }}
                      />
                    </span>
                  </button>
                </li>
              ))}
            </ul>
            {categoryFilter !== "all" && (
              <button
                type="button"
                onClick={() => setCategoryFilter("all")}
                className="mt-4 cursor-pointer text-xs text-cream-400 transition-colors hover:text-brass-300"
              >
                Clear filter
              </button>
            )}
          </div>
        </motion.section>
      )}

      <section className="mt-8">
        <h2 className="font-display text-lg text-cream-100">
          Entries{" "}
          {categoryFilter !== "all" && (
            <span className="text-cream-500">
              in {EXPENSE_CATEGORY_LABELS[categoryFilter] ?? categoryFilter}
            </span>
          )}
        </h2>

        {loading ? (
          <div className="mt-6 flex justify-center py-10">
            <Loader2 className="animate-spin text-brass-400" size={26} aria-label="Loading" />
          </div>
        ) : visible.length === 0 ? (
          <div className="mt-5">
            <EmptyState
              title={rows.length === 0 ? "No expenses recorded" : "Nothing in this range"}
              hint={
                rows.length === 0
                  ? "Record what the business pays out so the breakdown means something."
                  : "Try a wider range or clear the category filter."
              }
            />
          </div>
        ) : (
          <div className="mt-5 overflow-x-auto rounded-3xl border border-night-700/60">
            <table className="w-full min-w-[44rem] text-left text-sm">
              <thead className="bg-night-900/70 text-xs uppercase tracking-wider text-cream-500">
                <tr>
                  <th className="px-5 py-3 font-medium">Date</th>
                  <th className="px-5 py-3 font-medium">Paid to</th>
                  <th className="px-5 py-3 font-medium">Purpose</th>
                  <th className="px-5 py-3 font-medium">Category</th>
                  <th className="px-5 py-3 text-right font-medium">Amount</th>
                  {isAdmin && <th className="px-5 py-3" />}
                </tr>
              </thead>
              <tbody className="divide-y divide-night-800">
                {visible.map((r) => (
                  <Fragment key={r.id}>
                  <tr className="transition-colors hover:bg-night-900/40">
                    <td className="px-5 py-3.5 text-cream-400">
                      {r.dateMs
                        ? new Date(r.dateMs).toLocaleDateString("en-GB", {
                            day: "numeric",
                            month: "short",
                          })
                        : "-"}
                    </td>
                    <td className="px-5 py-3.5">
                      <span className="text-cream-100">{r.payeeName}</span>
                      <span className="block text-xs text-cream-500">{r.payeeType}</span>
                    </td>
                    <td className="px-5 py-3.5 text-cream-300">{r.purpose}</td>
                    <td className="px-5 py-3.5 text-xs text-cream-400">
                      {EXPENSE_CATEGORY_LABELS[r.category] ?? r.category}
                    </td>
                    <td className="px-5 py-3.5 text-right text-cream-100">
                      {formatNaira(r.amountKobo)}
                    </td>
                    {isAdmin && (
                      <td className="px-5 py-3.5 text-right">
                        <div className="flex justify-end gap-3">
                          <button
                            type="button"
                            aria-label={`Edit ${r.purpose}`}
                            onClick={() =>
                              setEditingId(editingId === r.id ? null : r.id)
                            }
                            className="cursor-pointer text-cream-600 transition-colors hover:text-brass-300"
                          >
                            <PenLine size={14} />
                          </button>
                          <button
                            type="button"
                            aria-label={`Delete ${r.purpose}`}
                            onClick={() =>
                              deleteExpense(
                                getDb(),
                                actor,
                                r.id,
                                `${r.payeeName}: ${r.purpose}`
                              ).catch((e) =>
                                setError(
                                  e instanceof Error ? e.message : "Could not delete."
                                )
                              )
                            }
                            className="cursor-pointer text-cream-600 transition-colors hover:text-red-400"
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </td>
                    )}
                  </tr>
                  {isAdmin && editingId === r.id && (
                    <tr>
                      {/* The form spans the row it corrects, so the entry being
                          changed stays visible directly above it. */}
                      <td colSpan={6} className="px-5 pb-5">
                        <ExpenseForm
                          actor={actor}
                          editing={r}
                          onClose={() => setEditingId(null)}
                          onError={setError}
                        />
                      </td>
                    </tr>
                  )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

/**
 * The one expense form, used to record and to correct.
 *
 * A correction has to offer exactly the fields the entry was created with,
 * otherwise something typed on the way in would have no way back out. Passing
 * the existing row switches it to editing rather than duplicating the fields.
 */
function ExpenseForm({
  actor,
  editing,
  onClose,
  onError,
}: {
  actor: { uid: string; email: string; role: "admin" | "manager" | "operator" };
  editing?: ExpenseRow;
  onClose: () => void;
  onError: (m: string) => void;
}) {
  const [date, setDate] = useState(
    toDateInputValue(editing?.dateMs ? new Date(editing.dateMs) : new Date())
  );
  const [payeeType, setPayeeType] = useState<"staff" | "company" | "vendor">(
    (editing?.payeeType as "staff" | "company" | "vendor") ?? "vendor"
  );
  const [payeeName, setPayeeName] = useState(editing?.payeeName ?? "");
  const [purpose, setPurpose] = useState(editing?.purpose ?? "");
  const [category, setCategory] = useState<ExpenseCategory>(
    editing?.category ?? "consumables"
  );
  const [amount, setAmount] = useState(
    editing ? String(toNaira(editing.amountKobo)) : ""
  );
  const [busy, setBusy] = useState(false);

  // Field ids are suffixed per row: two of these can be mounted at once when a
  // row is being corrected while the create form is open, and duplicate ids
  // would send the labels to the wrong input.
  const key = editing ? editing.id : "new";

  async function submit() {
    const kobo = parseNairaInput(amount);
    if (kobo <= 0) {
      onError("Enter an amount.");
      return;
    }
    if (!payeeName.trim()) {
      onError("Record who was paid.");
      return;
    }
    setBusy(true);
    try {
      const input = {
        date: fromDateInputValue(date),
        payeeType,
        payeeName,
        purpose,
        category,
        amountKobo: kobo,
      };
      if (editing) {
        await updateExpense(getDb(), actor, editing.id, input);
      } else {
        await recordExpense(getDb(), actor, input);
      }
      onClose();
    } catch (e) {
      onError(
        e instanceof Error
          ? e.message
          : editing
            ? "Could not save the expense."
            : "Could not record the expense."
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="mt-6 rounded-3xl border border-brass-500/30 bg-night-900/40 p-6">
      <h2 className="flex items-center gap-2 font-display text-lg text-cream-100">
        <Receipt size={18} className="text-brass-400" />{" "}
        {editing ? "Correct this expense" : "Record an expense"}
      </h2>
      <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <div>
          <label htmlFor={`exp-date-${key}`} className="mb-1.5 block text-sm text-cream-300">
            Date
          </label>
          <input
            id={`exp-date-${key}`}
            type="date"
            value={date}
            max={toDateInputValue(new Date())}
            onChange={(e) => setDate(e.target.value)}
            className="w-full rounded-xl border border-night-600 bg-night-800/60 px-4 py-3 text-cream-100 focus:border-brass-500 focus:outline-none"
          />
        </div>
        <SelectField
          id={`exp-payee-type-${key}`}
          label="Paid to"
          value={payeeType}
          onChange={(v) => setPayeeType(v as "staff" | "company" | "vendor")}
          options={[
            { value: "vendor", label: "Vendor or supplier" },
            { value: "staff", label: "Staff member" },
            { value: "company", label: "Company itself" },
          ]}
        />
        <TextField
          id={`exp-payee-${key}`}
          label="Name"
          value={payeeName}
          onChange={setPayeeName}
          required
        />
        <TextField
          id={`exp-purpose-${key}`}
          label="Purpose"
          value={purpose}
          onChange={setPurpose}
          placeholder="Diesel for generator"
        />
        <SelectField
          id={`exp-category-${key}`}
          label="Category"
          value={category}
          onChange={(v) => setCategory(v as ExpenseCategory)}
          options={EXPENSE_CATEGORIES.map((c) => ({
            value: c,
            label: EXPENSE_CATEGORY_LABELS[c] ?? c,
          }))}
        />
        <NumberField
          id={`exp-amount-${key}`}
          label="Amount (₦)"
          value={amount}
          onChange={setAmount}
        />
      </div>
      <div className="mt-5 flex gap-3">
        <Button onClick={submit} busy={busy}>
          {editing ? "Save changes" : "Record"}
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
}: {
  label: string;
  value: React.ReactNode;
  hint?: string;
}) {
  return (
    <div className="rounded-3xl border border-night-700/60 bg-night-900/40 p-5">
      <p className="text-xs uppercase tracking-wider text-cream-500">{label}</p>
      <p className="mt-2">{value}</p>
      {hint && <p className="mt-1 text-xs text-cream-500">{hint}</p>}
    </div>
  );
}

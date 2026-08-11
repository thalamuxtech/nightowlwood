"use client";

import { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  collection,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  Timestamp,
  where,
} from "firebase/firestore";
import {
  AlertTriangle,
  Gauge,
  Loader2,
  Plus,
  RefreshCw,
  ShieldAlert,
  Trash2,
} from "lucide-react";
import { getDb } from "@/lib/firebase";
import { COL } from "@/lib/erp/collections";
import { formatNaira, formatNairaCompact, toNaira } from "@/lib/erp/money";
import {
  conversionFactorFor,
  deleteMeterReading,
  loadMeters,
  meterCharge,
  recalculateMeterChain,
  recordMeterReading,
  type MeterConfigured,
} from "@/lib/erp/ledgers";
import { fromDateInputValue, toDateInputValue } from "@/lib/erp/workLogs";
import { LiveCounter } from "@/components/admin/ui/LiveCounter";
import {
  Button,
  DateField,
  EmptyState,
  NumberField,
  SelectField,
} from "@/components/admin/ui/Fields";
import { useErpSession } from "@/components/admin/ErpAuthProvider";
import { TOOLTIP_PROPS } from "@/components/admin/ui/chartTheme";

interface ReadingRow {
  id: string;
  meterName: string;
  dateMs: number | null;
  reading: number;
  previousReading?: number | null;
  actualConsumed: number;
  conversionFactor: number;
  billedUnits: number;
  ratePerUnitKobo: number;
  amountKobo: number;
  warning?: string | null;
}

/**
 * Utility meter readings, replacing the Meter sheet.
 *
 * That sheet computed consumption with a formula pointing at the row above, so
 * inserting or deleting a row produced `#VALUE!` errors. Here the delta is
 * derived on write from the actual previous reading for the same meter, and a
 * recompute rebuilds the chain after any correction.
 */
export function MetersScreen() {
  const session = useErpSession();
  // Correcting and removing meter readings.
  const isAdmin = session.can("record.delete");
  const canRecord = session.can("expense.create");

  const [rows, setRows] = useState<ReadingRow[]>([]);
  const [meters, setMeters] = useState<MeterConfigured[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [adding, setAdding] = useState(false);
  const [selected, setSelected] = useState<string>("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    loadMeters(getDb())
      .then((m) => {
        setMeters(m);
        if (m.length > 0) setSelected(m[0].name);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    const q = query(
      collection(getDb(), COL.meterReadings),
      orderBy("date", "desc"),
      limit(300)
    );
    return onSnapshot(
      q,
      (snap) => {
        setRows(
          snap.docs.map((d) => {
            const x = d.data();
            const consumed = x.actualConsumed ?? 0;
            const factor =
              Number.isFinite(x.conversionFactor) && x.conversionFactor > 0
                ? (x.conversionFactor as number)
                : 1;
            return {
              id: d.id,
              meterName: x.meterName ?? "",
              dateMs: x.date?.toMillis?.() ?? null,
              reading: x.reading ?? 0,
              previousReading: x.previousReading ?? null,
              actualConsumed: consumed,
              conversionFactor: factor,
              // Readings written before the field existed were billed on raw dial
              // units, which is a factor of 1 — so deriving it keeps their cost
              // consistent with what they were actually charged.
              billedUnits: x.billedUnits ?? Math.round(consumed * factor * 100) / 100,
              ratePerUnitKobo: x.ratePerUnitKobo ?? 0,
              amountKobo: x.amountKobo ?? 0,
              warning: x.warning ?? null,
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

  /** Meter names present in the data, so historic meters still appear. */
  const meterNames = useMemo(() => {
    const names = new Set<string>(meters.map((m) => m.name));
    for (const r of rows) if (r.meterName) names.add(r.meterName);
    return [...names];
  }, [meters, rows]);

  const forMeter = useMemo(
    () => rows.filter((r) => !selected || r.meterName === selected),
    [rows, selected]
  );

  /** Oldest first for the chart, since a consumption trend reads left to right. */
  const chart = useMemo(
    () =>
      [...forMeter]
        .filter((r) => r.dateMs !== null)
        .sort((a, b) => (a.dateMs ?? 0) - (b.dateMs ?? 0))
        .map((r) => ({
          label: new Date(r.dateMs as number).toLocaleDateString("en-GB", {
            day: "numeric",
            month: "short",
          }),
          consumed: r.actualConsumed,
          cost: r.amountKobo / 100,
        })),
    [forMeter]
  );

  const totals = useMemo(() => {
    const consumed = forMeter.reduce((s, r) => s + r.actualConsumed, 0);
    const billed = forMeter.reduce((s, r) => s + r.billedUnits, 0);
    const cost = forMeter.reduce((s, r) => s + r.amountKobo, 0);
    const flagged = forMeter.filter((r) => r.warning).length;
    // True when any reading on screen was scaled, which decides whether the
    // billed-units tile is worth the space.
    const converted = forMeter.some((r) => r.conversionFactor !== 1);
    return {
      consumed: Math.round(consumed * 100) / 100,
      billed: Math.round(billed * 100) / 100,
      cost,
      flagged,
      converted,
    };
  }, [forMeter]);

  async function recompute() {
    if (!selected) return;
    setBusy(true);
    setError("");
    try {
      const { updated } = await recalculateMeterChain(getDb(), actor, selected);
      setNotice(
        updated === 0
          ? "Every reading already agrees with its predecessor."
          : `Recomputed ${updated} reading${updated === 1 ? "" : "s"}.`
      );
      setTimeout(() => setNotice(""), 6000);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not recompute.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-6xl pb-20">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-eyebrow">Utilities</p>
          <h1 className="text-title mt-3 text-cream-50">Power meters</h1>
          <p className="mt-3 max-w-2xl text-sm leading-relaxed text-cream-400">
            Consumption is computed from the previous reading rather than typed,
            so it cannot break when an entry is corrected or removed.
          </p>
        </div>
        {canRecord && !adding && (
          <Button onClick={() => setAdding(true)}>
            <span className="flex items-center gap-2">
              <Plus size={15} /> Add reading
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
      {notice && (
        <p role="status" className="mt-6 text-sm text-emerald-300">
          {notice}
        </p>
      )}

      {adding && (
        <AddReadingForm
          meters={meters}
          actor={actor}
          onClose={() => setAdding(false)}
          onError={setError}
          onWarning={(w) => {
            setNotice(w);
            setTimeout(() => setNotice(""), 10000);
          }}
        />
      )}

      {meterNames.length > 1 && (
        <div className="mt-8 flex flex-wrap gap-2">
          {meterNames.map((name) => (
            <button
              key={name}
              type="button"
              onClick={() => setSelected(name)}
              aria-pressed={selected === name}
              className={`cursor-pointer rounded-full border px-4 py-2 text-xs font-medium transition-all duration-300 ${
                selected === name
                  ? "border-brass-500 bg-brass-500 text-night-950"
                  : "border-night-600 text-cream-300 hover:border-brass-500/60 hover:text-brass-300"
              }`}
            >
              {name}
            </button>
          ))}
        </div>
      )}

      <div
        className={`mt-6 grid gap-4 ${
          totals.converted ? "sm:grid-cols-2 lg:grid-cols-4" : "sm:grid-cols-3"
        }`}
      >
        <Tile
          label="Dial units"
          value={
            <LiveCounter
              value={totals.consumed}
              format={(n) => n.toFixed(2)}
              className="font-display text-2xl text-cream-50"
            />
          }
          hint={totals.converted ? "as read from the meter" : undefined}
        />
        {/* Only shown where a conversion is in force: on a meter that reads
            directly in billed units the two figures are identical, and two tiles
            with the same number reads as a bug. */}
        {totals.converted && (
          <Tile
            label="Billed units"
            value={
              <LiveCounter
                value={totals.billed}
                format={(n) => n.toFixed(2)}
                className="font-display text-2xl text-cream-50"
              />
            }
            hint="what the rate is applied to"
          />
        )}
        <Tile
          label="Power cost"
          value={
            <LiveCounter
              value={totals.cost}
              format={(n) => formatNaira(n)}
              className="font-display text-2xl text-cream-50"
            />
          }
        />
        <Tile
          label="Flagged readings"
          value={
            <span
              className={`font-display text-2xl ${
                totals.flagged > 0 ? "text-amber-300" : "text-cream-50"
              }`}
            >
              {totals.flagged}
            </span>
          }
          hint={totals.flagged > 0 ? "Lower than the reading before" : undefined}
        />
      </div>

      {chart.length > 1 && (
        <motion.section
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
          className="mt-6 rounded-3xl border border-night-700/60 bg-night-900/40 p-6"
        >
          <div className="flex flex-wrap items-baseline justify-between gap-3">
            <h2 className="font-display text-lg text-cream-100">Consumption trend</h2>
            {isAdmin && (
              <button
                type="button"
                onClick={recompute}
                disabled={busy}
                className="flex cursor-pointer items-center gap-1.5 text-xs text-cream-400 transition-colors hover:text-brass-300 disabled:opacity-50"
              >
                <RefreshCw size={13} className={busy ? "animate-spin" : ""} /> Recompute chain
              </button>
            )}
          </div>
          <div className="mt-4">
            <ResponsiveContainer width="100%" height={230}>
              <AreaChart data={chart} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="meterFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#c08a3e" stopOpacity={0.5} />
                    <stop offset="100%" stopColor="#c08a3e" stopOpacity={0.03} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#2a2520" vertical={false} />
                <XAxis
                  dataKey="label"
                  tick={{ fill: "#8e8781", fontSize: 11 }}
                  stroke="#2a2520"
                />
                <YAxis tick={{ fill: "#8e8781", fontSize: 11 }} stroke="#2a2520" />
                <Tooltip
                  {...TOOLTIP_PROPS}
                  formatter={(v: number, key) =>
                    key === "cost" ? formatNaira(Number(v) * 100) : `${v} units`
                  }
                />
                <Area
                  type="monotone"
                  dataKey="consumed"
                  stroke="#c08a3e"
                  strokeWidth={2}
                  fill="url(#meterFill)"
                  animationDuration={900}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </motion.section>
      )}

      <section className="mt-8">
        <h2 className="font-display text-lg text-cream-100">Readings</h2>
        {loading ? (
          <div className="mt-6 flex justify-center py-10">
            <Loader2 className="animate-spin text-brass-400" size={26} aria-label="Loading" />
          </div>
        ) : forMeter.length === 0 ? (
          <div className="mt-5">
            <EmptyState
              title="No readings recorded"
              hint="Add a reading for each meter. The first one sets the baseline and is not charged."
            />
          </div>
        ) : (
          <div className="mt-5 overflow-x-auto rounded-3xl border border-night-700/60">
            <table className="w-full min-w-[44rem] text-left text-sm">
              <thead className="bg-night-900/70 text-xs uppercase tracking-wider text-cream-500">
                <tr>
                  <th className="px-5 py-3 font-medium">Date</th>
                  <th className="px-5 py-3 font-medium">Meter</th>
                  <th className="px-5 py-3 text-right font-medium">Previous</th>
                  <th className="px-5 py-3 text-right font-medium">Reading</th>
                  <th className="px-5 py-3 text-right font-medium">Units</th>
                  {totals.converted && (
                    <th className="px-5 py-3 text-right font-medium">Billed</th>
                  )}
                  <th className="px-5 py-3 text-right font-medium">Rate</th>
                  <th className="px-5 py-3 text-right font-medium">Cost</th>
                  {isAdmin && <th className="px-5 py-3" />}
                </tr>
              </thead>
              <tbody className="divide-y divide-night-800">
                {forMeter.map((r) => (
                  <tr
                    key={r.id}
                    className={r.warning ? "bg-amber-500/5" : "transition-colors hover:bg-night-900/40"}
                  >
                    <td className="px-5 py-3.5 text-cream-400">
                      {r.dateMs
                        ? new Date(r.dateMs).toLocaleDateString("en-GB", {
                            day: "numeric",
                            month: "short",
                          })
                        : "-"}
                    </td>
                    <td className="px-5 py-3.5">
                      <span className="text-cream-100">{r.meterName}</span>
                      {r.warning && (
                        <span
                          className="mt-0.5 flex items-center gap-1 text-xs text-amber-300"
                          title={r.warning}
                        >
                          <AlertTriangle size={11} /> flagged
                        </span>
                      )}
                    </td>
                    <td className="px-5 py-3.5 text-right tabular-nums text-cream-500">
                      {r.previousReading ?? "—"}
                    </td>
                    <td className="px-5 py-3.5 text-right tabular-nums text-cream-200">
                      {r.reading}
                    </td>
                    <td className="px-5 py-3.5 text-right tabular-nums text-cream-100">
                      {r.actualConsumed}
                    </td>
                    {totals.converted && (
                      <td className="px-5 py-3.5 text-right tabular-nums text-cream-100">
                        {r.billedUnits}
                        {r.conversionFactor !== 1 && (
                          <span className="ml-1 text-[0.65rem] text-cream-600">
                            ×{r.conversionFactor}
                          </span>
                        )}
                      </td>
                    )}
                    <td className="px-5 py-3.5 text-right text-xs text-cream-500">
                      {formatNairaCompact(r.ratePerUnitKobo)}
                    </td>
                    <td className="px-5 py-3.5 text-right text-cream-100">
                      {formatNaira(r.amountKobo)}
                    </td>
                    {isAdmin && (
                      <td className="px-5 py-3.5 text-right">
                        <button
                          type="button"
                          aria-label={`Delete ${r.meterName} reading`}
                          onClick={() =>
                            deleteMeterReading(getDb(), actor, r.id, r.meterName)
                              .then(() =>
                                setNotice("Reading deleted and the chain recomputed.")
                              )
                              .catch((e) =>
                                setError(
                                  e instanceof Error ? e.message : "Could not delete."
                                )
                              )
                          }
                          className="cursor-pointer text-cream-600 transition-colors hover:text-red-400"
                        >
                          <Trash2 size={14} />
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

function AddReadingForm({
  meters,
  actor,
  onClose,
  onError,
  onWarning,
}: {
  meters: MeterConfigured[];
  actor: { uid: string; email: string; role: "admin" | "manager" | "operator" };
  onClose: () => void;
  onError: (m: string) => void;
  onWarning: (m: string) => void;
}) {
  const [meterName, setMeterName] = useState(meters[0]?.name ?? "");
  const [date, setDate] = useState(toDateInputValue(new Date()));
  const [reading, setReading] = useState("");
  const [busy, setBusy] = useState(false);
  /** The reading this one will be measured against, fetched for the preview. */
  const [previous, setPrevious] = useState<number | null>(null);
  const [previousKnown, setPreviousKnown] = useState(false);

  const meter = meters.find((m) => m.name === meterName);
  const rate = meter?.ratePerUnitKobo ?? 0;
  const factor = meter ? conversionFactorFor(meter) : 1;

  /*
   * The predecessor, looked up as the meter or date changes.
   *
   * Fetched rather than inferred so the preview shows the same figure the write
   * will use — including when the entry is back-dated, where the predecessor is
   * not the latest reading. Falls back to the configured opening reading, which is
   * what makes a first entry chargeable.
   */
  useEffect(() => {
    if (!meterName) {
      setPrevious(null);
      setPreviousKnown(false);
      return;
    }
    let live = true;
    setPreviousKnown(false);
    getDocs(
      query(
        collection(getDb(), COL.meterReadings),
        where("meterName", "==", meterName),
        where("date", "<=", Timestamp.fromDate(fromDateInputValue(date))),
        orderBy("date", "desc"),
        limit(1)
      )
    )
      .then((snap) => {
        if (!live) return;
        const recorded = snap.docs[0]?.data()?.reading;
        const opening = meter?.openingReading;
        setPrevious(
          typeof recorded === "number"
            ? recorded
            : typeof opening === "number"
              ? opening
              : null
        );
        setPreviousKnown(true);
      })
      .catch(() => {
        if (live) setPreviousKnown(false);
      });
    return () => {
      live = false;
    };
  }, [meterName, date, meter?.openingReading]);

  /** What this entry will cost, using the same function the write uses. */
  const preview = useMemo(() => {
    const value = Number(reading);
    if (reading.trim() === "" || !Number.isFinite(value) || !previousKnown) return null;
    return meterCharge({
      reading: value,
      previousReading: previous,
      conversionFactor: factor,
      ratePerUnitKobo: rate,
    });
  }, [reading, previous, previousKnown, factor, rate]);

  async function submit() {
    if (!meterName) {
      onError("Choose a meter.");
      return;
    }
    const value = Number(reading);
    if (!(value >= 0) || reading.trim() === "") {
      onError("Enter the meter reading.");
      return;
    }
    setBusy(true);
    try {
      const res = await recordMeterReading(getDb(), actor, {
        meterName,
        date: fromDateInputValue(date),
        reading: value,
        ratePerUnitKobo: rate,
        conversionFactor: factor,
        openingReading: meter?.openingReading,
      });
      if (res.warning) onWarning(res.warning);
      setReading("");
      onClose();
    } catch (e) {
      onError(e instanceof Error ? e.message : "Could not record the reading.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="mt-6 rounded-3xl border border-brass-500/30 bg-night-900/40 p-6">
      <h2 className="flex items-center gap-2 font-display text-lg text-cream-100">
        <Gauge size={18} className="text-brass-400" /> Add a reading
      </h2>
      <div className="mt-5 grid gap-4 sm:grid-cols-3">
        <SelectField
          id="meter-name"
          label="Meter"
          value={meterName}
          onChange={setMeterName}
          options={meters.map((m) => ({ value: m.name, label: m.name }))}
          placeholder={meters.length ? undefined : "No meters configured"}
        />
        <DateField
          id="meter-date"
          label="Date"
          value={date}
          max={toDateInputValue(new Date())}
          onChange={setDate}
        />
        <NumberField
          id="meter-reading"
          label="Reading on the dial"
          value={reading}
          onChange={setReading}
          hint={rate ? `at ${formatNairaCompact(rate)} per unit` : undefined}
        />
      </div>
      {/* The calculation, shown before it is committed.
          A meter reading is one number typed into a box that turns into a
          five-figure cost, and the only way to catch a mis-keyed digit is to see
          what it produces. Uses the same function as the write, so what is shown
          here is what gets saved. */}
      {preview && (
        <dl className="mt-5 flex flex-wrap gap-x-8 gap-y-2 rounded-2xl border border-night-700/60 bg-night-950/40 p-4 text-sm">
          <div>
            <dt className="text-xs uppercase tracking-wider text-cream-500">Previous</dt>
            <dd className="mt-0.5 tabular-nums text-cream-200">
              {previous ?? "none"}
            </dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wider text-cream-500">Units</dt>
            <dd className="mt-0.5 tabular-nums text-cream-200">
              {preview.consumedUnits}
            </dd>
          </div>
          {factor !== 1 && (
            <div>
              <dt className="text-xs uppercase tracking-wider text-cream-500">
                × {factor}
              </dt>
              <dd className="mt-0.5 tabular-nums text-cream-200">
                {preview.billedUnits}
              </dd>
            </div>
          )}
          <div>
            <dt className="text-xs uppercase tracking-wider text-cream-500">Cost</dt>
            <dd className="mt-0.5 font-display text-lg text-brass-300">
              {formatNaira(preview.amountKobo)}
            </dd>
          </div>
        </dl>
      )}

      <p className="mt-3 text-xs text-cream-500">
        Enter what the dial shows. Consumption is worked out from the last reading
        for this meter, so a back-dated entry compares against the right one.
        {factor !== 1 &&
          ` This meter's units are multiplied by ${factor} before the rate is applied.`}
      </p>
      <div className="mt-5 flex gap-3">
        <Button onClick={submit} busy={busy}>
          Record reading
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

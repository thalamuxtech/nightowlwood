"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Info, Loader2, RefreshCw, ShieldAlert, TrendingUp } from "lucide-react";
import { getDb } from "@/lib/firebase";
import {
  COST_GROUP_LABELS,
  EXPENSE_CATEGORY_LABELS,
  PROFIT_STREAM_LABELS,
  TRADING_STREAMS,
  type CostGroup,
  type ExpenseCategory,
} from "@/lib/erp/enums";
import { formatNaira, formatNairaCompact } from "@/lib/erp/money";
import { buildProfitReport, type ProfitReport } from "@/lib/erp/profit";
import { fromDateInputValue, toDateInputValue } from "@/lib/erp/workLogs";
import { Button, DateField, EmptyState } from "@/components/admin/ui/Fields";
import { TOOLTIP_PROPS } from "@/components/admin/ui/chartTheme";
import { useErpSession } from "@/components/admin/ErpAuthProvider";

/** Ready-made spans, since a P&L is nearly always asked for by month or quarter. */
const PRESETS: Array<{ key: string; label: string; days: number }> = [
  { key: "30", label: "Last 30 days", days: 30 },
  { key: "90", label: "Last quarter", days: 90 },
  { key: "180", label: "Last 6 months", days: 180 },
  { key: "365", label: "Last 12 months", days: 365 },
];

const GROUP_COLOURS: Record<CostGroup, string> = {
  labour: "#dba95f",
  materials: "#8b6a3f",
  power: "#c9a227",
  overhead: "#7a6ea8",
  tax: "#a8705a",
};

/**
 * Profit and loss.
 *
 * Revenue against every cost the business actually incurs: piece-rate wages, monthly
 * salaries, power, rent, materials, tax remitted and agent commission. The dashboard
 * already charted revenue, which flattered the picture — turnover without the labour
 * that earned it is not a result.
 *
 * The report explains where each figure comes from, on the page. A profit number
 * nobody can trace is a number nobody will act on, and the traps here are real: wages
 * are read from the expense ledger rather than the wage runs, because payroll books
 * itself there and counting both would double the largest cost in the business.
 */
export function ProfitScreen() {
  const session = useErpSession();

  const [preset, setPreset] = useState("90");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState(toDateInputValue(new Date()));
  const [report, setReport] = useState<ProfitReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  /** The window, from either the preset or the typed dates. */
  const range = useMemo(() => {
    if (preset === "custom" && customFrom) {
      const from = fromDateInputValue(customFrom);
      from.setHours(0, 0, 0, 0);
      const to = fromDateInputValue(customTo);
      to.setHours(23, 59, 59, 999);
      return { from, to };
    }
    const days = PRESETS.find((p) => p.key === preset)?.days ?? 90;
    const to = new Date();
    to.setHours(23, 59, 59, 999);
    const from = new Date();
    from.setDate(from.getDate() - (days - 1));
    from.setHours(0, 0, 0, 0);
    return { from, to };
  }, [preset, customFrom, customTo]);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      setReport(await buildProfitReport(getDb(), range.from, range.to));
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "Could not build the report. Check that you have permission to read expenses and sales."
      );
    } finally {
      setLoading(false);
    }
  }, [range.from, range.to]);

  useEffect(() => {
    void load();
  }, [load]);

  const costChart = useMemo(() => {
    if (!report) return [];
    return (Object.entries(report.costs.byGroup) as Array<[CostGroup, number]>)
      .filter(([, v]) => v > 0)
      .map(([group, kobo]) => ({
        label: COST_GROUP_LABELS[group],
        group,
        value: kobo / 100,
      }))
      .sort((a, b) => b.value - a.value);
  }, [report]);

  const categoryRows = useMemo(() => {
    if (!report) return [];
    return (
      Object.entries(report.costs.byCategory) as Array<[ExpenseCategory, number]>
    )
      .filter(([, v]) => (v ?? 0) > 0)
      .sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0));
  }, [report]);

  if (!session.ready) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center">
        <Loader2 className="animate-spin text-brass-400" size={28} aria-label="Loading" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl pb-20">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-eyebrow">Finance</p>
          <h1 className="text-title mt-3 text-cream-50">Profit &amp; loss</h1>
          <p className="mt-3 max-w-2xl text-sm leading-relaxed text-cream-400">
            What came in against everything that went out — wages, salaries, power,
            rent, materials, tax and commission.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          disabled={loading}
          className="flex cursor-pointer items-center gap-1.5 text-xs text-cream-400 transition-colors hover:text-brass-300 disabled:opacity-50"
        >
          <RefreshCw size={13} className={loading ? "animate-spin" : ""} /> Refresh
        </button>
      </header>

      {error && (
        <p
          role="alert"
          className="mt-6 flex items-start gap-2 rounded-xl border border-red-500/30 bg-red-500/5 px-4 py-3 text-sm text-red-400"
        >
          <ShieldAlert size={16} className="mt-0.5 shrink-0" /> {error}
        </p>
      )}

      {/* Period */}
      <div className="mt-8 flex flex-wrap items-end gap-2">
        {PRESETS.map((p) => (
          <button
            key={p.key}
            type="button"
            onClick={() => setPreset(p.key)}
            aria-pressed={preset === p.key}
            className={`cursor-pointer rounded-full border px-4 py-2 text-xs font-medium transition-all duration-300 ${
              preset === p.key
                ? "border-brass-500 bg-brass-500 text-night-950"
                : "border-night-600 text-cream-300 hover:border-brass-500/60 hover:text-brass-300"
            }`}
          >
            {p.label}
          </button>
        ))}
        <button
          type="button"
          onClick={() => setPreset("custom")}
          aria-pressed={preset === "custom"}
          className={`cursor-pointer rounded-full border px-4 py-2 text-xs font-medium transition-all duration-300 ${
            preset === "custom"
              ? "border-brass-500 bg-brass-500 text-night-950"
              : "border-night-600 text-cream-300 hover:border-brass-500/60 hover:text-brass-300"
          }`}
        >
          Choose dates
        </button>

        {preset === "custom" && (
          <div className="flex flex-wrap items-end gap-3">
            <DateField
              id="pl-from"
              compact
              label="From"
              value={customFrom}
              max={customTo}
              onChange={setCustomFrom}
            />
            <DateField
              id="pl-to"
              compact
              label="To"
              value={customTo}
              max={toDateInputValue(new Date())}
              onChange={setCustomTo}
            />
          </div>
        )}
      </div>

      {loading ? (
        <div className="mt-12 flex justify-center py-10">
          <Loader2 className="animate-spin text-brass-400" size={26} aria-label="Loading" />
        </div>
      ) : !report ? (
        <div className="mt-8">
          <EmptyState title="No report" hint="Choose a period above." />
        </div>
      ) : (
        <>
          {/* Headline */}
          <div className="mt-8 grid gap-4 sm:grid-cols-3">
            <Tile label="Revenue" value={formatNaira(report.revenue.totalKobo)} />
            <Tile label="Costs" value={formatNaira(report.costs.totalKobo)} tone="warn" />
            <Tile
              label={report.netKobo >= 0 ? "Profit" : "Loss"}
              value={formatNaira(Math.abs(report.netKobo))}
              tone={report.netKobo >= 0 ? "good" : "danger"}
              hint={
                report.marginPercent !== null
                  ? `${report.marginPercent}% of revenue`
                  : "no revenue in this period"
              }
            />
          </div>

          {report.revenue.totalKobo === 0 && report.costs.totalKobo === 0 && (
            <p className="mt-6 text-sm text-cream-500">
              Nothing was recorded in this period. Try a wider range.
            </p>
          )}

          {/* The three trades, each on its own cost base.
              Placed above the consolidated detail because it is the more useful question: a single
              net figure says whether the business made money, and this says which part of it did. */}
          <section className="mt-8">
            <h2 className="font-display text-lg text-cream-100">The three trades</h2>
            <p className="mt-1.5 max-w-2xl text-sm text-cream-400">
              Each carries only what it consumed. Cutting and edging takes the operator wages,
              power, gum and blades; projects take the boards and hardware; the counter takes the
              cost of what it sold. Nothing is charged to two of them.
            </p>

            <div className="mt-5 grid gap-4 lg:grid-cols-3">
              {TRADING_STREAMS.map((key) => {
                const s = report.streams[key];
                return (
                  <article
                    key={key}
                    className={`rounded-3xl border p-5 ${
                      s.grossKobo < 0
                        ? "border-red-500/40 bg-red-500/5"
                        : "border-night-700/60 bg-night-900/40"
                    }`}
                  >
                    <p className="text-xs uppercase tracking-wider text-cream-500">
                      {PROFIT_STREAM_LABELS[key]}
                    </p>
                    <p
                      className={`mt-2 font-display text-2xl ${
                        s.grossKobo < 0 ? "text-red-300" : "text-emerald-300"
                      }`}
                    >
                      {s.grossKobo < 0 ? "−" : ""}
                      {formatNaira(Math.abs(s.grossKobo))}
                    </p>
                    <p className="mt-1 text-xs text-cream-500">
                      {s.marginPercent === null
                        ? "no revenue in this period"
                        : `${s.marginPercent}% of ${formatNaira(s.revenueKobo)}`}
                    </p>

                    <dl className="mt-4 space-y-1.5 border-t border-night-700/60 pt-3 text-xs">
                      <div className="flex justify-between gap-3">
                        <dt className="text-cream-500">Revenue</dt>
                        <dd className="text-cream-200">{formatNaira(s.revenueKobo)}</dd>
                      </div>
                      <div className="flex justify-between gap-3">
                        <dt className="text-cream-500">Direct costs</dt>
                        <dd className="text-cream-200">−{formatNaira(s.directCostKobo)}</dd>
                      </div>
                      {/* The two costs that live outside the expense ledger, named where they land
                          so the figure can be checked against its parts. */}
                      {s.meteredPowerKobo > 0 && (
                        <div className="flex justify-between gap-3 pl-3">
                          <dt className="text-cream-600">of which metered power</dt>
                          <dd className="text-cream-400">
                            {formatNaira(s.meteredPowerKobo)}
                          </dd>
                        </div>
                      )}
                      {s.costOfGoodsKobo > 0 && (
                        <div className="flex justify-between gap-3 pl-3">
                          <dt className="text-cream-600">of which cost of goods</dt>
                          <dd className="text-cream-400">
                            {formatNaira(s.costOfGoodsKobo)}
                          </dd>
                        </div>
                      )}
                      {(
                        Object.entries(s.byCategory) as Array<[ExpenseCategory, number]>
                      )
                        .filter(([, v]) => v > 0)
                        .sort((a, b) => b[1] - a[1])
                        .map(([cat, v]) => (
                          <div key={cat} className="flex justify-between gap-3 pl-3">
                            <dt className="text-cream-600">
                              of which {EXPENSE_CATEGORY_LABELS[cat].toLowerCase()}
                            </dt>
                            <dd className="text-cream-400">{formatNaira(v)}</dd>
                          </div>
                        ))}
                    </dl>
                  </article>
                );
              })}
            </div>

            {/* Overheads, and the reconciliation to the figure at the top of the page. */}
            <div className="mt-4 rounded-3xl border border-night-700/60 bg-night-900/30 p-5">
              <div className="flex flex-wrap items-baseline justify-between gap-3">
                <div>
                  <p className="text-cream-200">{PROFIT_STREAM_LABELS.overhead}</p>
                  <p className="mt-1 max-w-xl text-xs leading-relaxed text-cream-500">
                    Rent, salaries, administration, tax and commission — owed whether or not a
                    board is cut. Never split across the three above: an apportionment nobody
                    agreed would make all three figures arguable instead of one honest.
                  </p>
                </div>
                <p className="font-display text-xl text-amber-300">
                  −{formatNaira(report.streams.overheadKobo)}
                </p>
              </div>

              <div className="mt-4 flex flex-wrap items-baseline justify-between gap-3 border-t border-night-700/60 pt-3">
                <p className="text-sm text-cream-300">
                  Three trades less overheads
                </p>
                <p
                  className={`font-display text-xl ${
                    report.streams.combinedNetKobo >= 0 ? "text-emerald-300" : "text-red-300"
                  }`}
                >
                  {report.streams.combinedNetKobo < 0 ? "−" : ""}
                  {formatNaira(Math.abs(report.streams.combinedNetKobo))}
                </p>
              </div>
              {/* A visible tripwire. The split is a re-arrangement of the same money, so if it ever
                  stops matching the consolidated net, one of them is wrong and the reader should
                  not have to notice by comparing two numbers on different parts of the page. */}
              {report.streams.combinedNetKobo !== report.netKobo && (
                <p className="mt-3 rounded-xl border border-red-500/40 bg-red-500/5 px-4 py-3 text-xs text-red-300">
                  This does not match the {report.netKobo >= 0 ? "profit" : "loss"} figure above,
                  which means a cost is being counted twice or missed. Please report this.
                </p>
              )}
            </div>
          </section>

          {/* Revenue detail */}
          <section className="mt-8 rounded-3xl border border-night-700/60 bg-night-900/40 p-6">
            <h2 className="font-display text-lg text-cream-100">Where revenue came from</h2>
            <dl className="mt-4 space-y-2.5 text-sm">
              <Line
                label={`Service jobs (${report.counts.jobs})`}
                value={report.revenue.serviceKobo}
              />
              <Line
                label={`Projects (${report.counts.projects})`}
                value={report.revenue.productKobo}
              />
              <Line
                label={`Counter sales (${report.counts.sales}), net of tax`}
                value={report.revenue.salesKobo}
              />
              {report.revenue.salesCostKobo > 0 && (
                <Line
                  label="Less what those goods cost"
                  value={-report.revenue.salesCostKobo}
                  tone="warn"
                />
              )}
              <div className="flex items-baseline justify-between gap-4 border-t border-night-700/60 pt-2.5">
                <dt className="text-cream-200">Total revenue</dt>
                <dd className="font-display text-lg text-cream-50">
                  {formatNaira(report.revenue.totalKobo)}
                </dd>
              </div>
            </dl>
            {report.revenue.salesTaxKobo > 0 && (
              <p className="mt-3 text-xs leading-relaxed text-cream-500">
                {formatNaira(report.revenue.salesTaxKobo)} of tax was collected at the
                counter. It is excluded from revenue because it is owed onward rather
                than earned.
              </p>
            )}
          </section>

          {/* Cost chart */}
          {costChart.length > 0 && (
            <section className="mt-6 rounded-3xl border border-night-700/60 bg-night-900/40 p-6">
              <h2 className="font-display text-lg text-cream-100">Costs by kind</h2>
              <div className="mt-4">
                <ResponsiveContainer width="100%" height={240}>
                  <BarChart
                    data={costChart}
                    margin={{ top: 4, right: 8, left: 0, bottom: 0 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" stroke="#2a2520" vertical={false} />
                    <XAxis
                      dataKey="label"
                      tick={{ fill: "#8e8781", fontSize: 11 }}
                      stroke="#2a2520"
                    />
                    <YAxis
                      tick={{ fill: "#8e8781", fontSize: 11 }}
                      stroke="#2a2520"
                      tickFormatter={(v: number) => formatNairaCompact(v * 100)}
                    />
                    <Tooltip
                      {...TOOLTIP_PROPS}
                      formatter={(v: number) => formatNaira(Number(v) * 100)}
                    />
                    <Bar dataKey="value" radius={[6, 6, 0, 0]} animationDuration={800}>
                      {costChart.map((c) => (
                        <Cell key={c.group} fill={GROUP_COLOURS[c.group]} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </section>
          )}

          {/* Cost detail */}
          <section className="mt-6 rounded-3xl border border-night-700/60 bg-night-900/40 p-6">
            <h2 className="font-display text-lg text-cream-100">
              What the money went on
            </h2>

            {categoryRows.length === 0 && report.costs.meteredPowerKobo === 0 ? (
              <p className="mt-4 text-sm text-cream-500">
                No costs recorded in this period.
              </p>
            ) : (
              <dl className="mt-4 space-y-2.5 text-sm">
                {categoryRows.map(([category, amount]) => (
                  <Line
                    key={category}
                    label={EXPENSE_CATEGORY_LABELS[category] ?? category}
                    value={amount ?? 0}
                  />
                ))}
                {report.costs.meteredPowerKobo > 0 && (
                  <Line
                    label={`Metered power (${report.counts.meterReadings} reading${
                      report.counts.meterReadings === 1 ? "" : "s"
                    })`}
                    value={report.costs.meteredPowerKobo}
                  />
                )}
                {report.costs.commissionKobo > 0 && (
                  <Line
                    label={`Commission on ${report.counts.invoicesWithCommission} invoice${
                      report.counts.invoicesWithCommission === 1 ? "" : "s"
                    }`}
                    value={report.costs.commissionKobo}
                  />
                )}
                <div className="flex items-baseline justify-between gap-4 border-t border-night-700/60 pt-2.5">
                  <dt className="text-cream-200">Total costs</dt>
                  <dd className="font-display text-lg text-cream-50">
                    {formatNaira(report.costs.totalKobo)}
                  </dd>
                </div>
              </dl>
            )}
          </section>

          {/* How the figures are built. A profit number nobody can trace is a number
              nobody acts on, and the double-counting traps are worth stating. */}
          <section className="mt-6 rounded-2xl border border-night-700/60 bg-night-950/30 p-5">
            <h2 className="flex items-center gap-2 text-sm font-medium text-cream-200">
              <Info size={15} className="text-brass-400" /> How this is worked out
            </h2>
            <ul className="mt-3 space-y-1.5 text-xs leading-relaxed text-cream-500">
              <li>
                Wages and salaries are taken from the expense ledger, where a paid
                payroll run books itself. They are never added again from the runs, as
                that would count the largest cost in the business twice.
              </li>
              <li>
                Project purchases are counted from the expense ledger for the same
                reason — saving a purchase books it there.
              </li>
              <li>
                Metered power is added from the meter readings, which are their own
                ledger and are not booked as expenses. A power bill typed in by hand is
                counted as well, because a diesel delivery is a real cost separate from
                metered consumption.
              </li>
              <li>
                What counter-sale goods cost is netted off sales revenue rather than
                added to costs, since buying that stock was already an expense.
              </li>
              <li>
                Service jobs are counted from the date the boards came in; projects from
                their start date, at contract value where one was agreed. Cancelled work
                is excluded.
              </li>
              <li>
                Piece-rate labour is not apportioned to individual projects — it is
                logged per operator per week, so any split would be a guess.
              </li>
            </ul>
          </section>
        </>
      )}
    </div>
  );
}

function Line({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone?: "warn";
}) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt className="text-cream-400">{label}</dt>
      <dd
        className={`tabular-nums ${tone === "warn" ? "text-amber-300" : "text-cream-200"}`}
      >
        {value < 0 ? `−${formatNaira(Math.abs(value))}` : formatNaira(value)}
      </dd>
    </div>
  );
}

function Tile({
  label,
  value,
  tone,
  hint,
}: {
  label: string;
  value: string;
  tone?: "good" | "warn" | "danger";
  hint?: string;
}) {
  const colour =
    tone === "danger"
      ? "text-red-300"
      : tone === "warn"
        ? "text-amber-300"
        : tone === "good"
          ? "text-emerald-300"
          : "text-cream-50";
  return (
    <div className="rounded-3xl border border-night-700/60 bg-night-900/40 p-5">
      <p className="text-xs uppercase tracking-wider text-cream-500">{label}</p>
      <p className={`mt-2 font-display text-2xl ${colour}`}>{value}</p>
      {hint && <p className="mt-1 text-xs text-cream-500">{hint}</p>}
    </div>
  );
}

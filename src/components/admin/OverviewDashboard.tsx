"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { ArrowRight, Loader2, TrendingUp } from "lucide-react";
import { collection, doc, getDoc, onSnapshot, orderBy, query } from "firebase/firestore";
import { getDb } from "@/lib/firebase";
import { COL } from "@/lib/erp/collections";
import { JOB_STATUS_LABELS, type JobStatus } from "@/lib/erp/enums";
import { formatNaira, formatNairaCompact } from "@/lib/erp/money";
import { LiveCounter } from "@/components/admin/ui/LiveCounter";
import { InsightsPanel } from "@/components/admin/InsightsPanel";
import { useErpSession } from "@/components/admin/ErpAuthProvider";
import {
  bucketFor,
  bucketKey,
  bucketLabel,
  DEFAULT_RANGES,
  DEFAULT_RANGE_KEY,
  type ReportRange,
} from "@/lib/erp/ranges";
import { OperatorDashboard } from "@/components/admin/dashboards/OperatorDashboard";

/** Selectable windows for the revenue chart. */


/** Brand palette. Ordered so adjacent slices stay distinguishable. */
const SERIES = ["#dba95f", "#8b6a3f", "#c9a227", "#6b8f71", "#7a6ea8", "#a8705a"];

interface JobPoint {
  id: string;
  status: JobStatus;
  totalKobo: number;
  paidKobo: number;
  balanceKobo: number;
  receivedAtMs: number | null;
  customerName: string;
}

interface ExpensePoint {
  amountKobo: number;
  dateMs: number | null;
  category: string;
}

/**
 * Admin overview.
 *
 * Chart-led rather than a grid of counters: the useful questions are about
 * direction and mix over time, which a number alone cannot answer. The few
 * figures that remain are the ones a manager acts on today, and they animate on
 * change so a live update is visible rather than silent.
 */
export function OverviewDashboard() {
  const session = useErpSession();
  /**
   * Finance figures are capability-gated, not merely hidden by nav.
   *
   * Revenue, collected and outstanding are company financials, which the
   * permission matrix reserves for admins. Before this the whole dashboard
   * rendered identically for every role, so a manager or operator who reached
   * /admin/ saw turnover and receivables regardless of what their role allowed.
   */
  const canSeeFinance = session.can("dashboard.view.finance");
  const [jobs, setJobs] = useState<JobPoint[]>([]);
  const [expenses, setExpenses] = useState<ExpensePoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [range, setRange] = useState<string>(DEFAULT_RANGE_KEY);
  /**
   * Ranges come from settings so an admin can add their own. The presets are the
   * starting set, not the limit: with five years of records "12 months" would
   * otherwise be the widest view available.
   */
  const [ranges, setRanges] = useState<ReportRange[]>(DEFAULT_RANGES);

  // An operator's view is a different screen, not a subset of this one: almost
  // every panel here is company-wide and none of it is theirs to see.
  const isOperator = session.ready && session.role === "operator";

  useEffect(() => {
    const q = query(collection(getDb(), COL.serviceJobs), orderBy("receivedAt", "desc"));
    return onSnapshot(
      q,
      (snap) => {
        setJobs(
          snap.docs.map((d) => {
            const x = d.data();
            return {
              id: d.id,
              status: (x.status as JobStatus) ?? "received",
              totalKobo: x.totalKobo ?? 0,
              paidKobo: x.paidKobo ?? 0,
              balanceKobo: x.balanceKobo ?? 0,
              receivedAtMs: x.receivedAt?.toMillis?.() ?? null,
              customerName: x.customerName ?? "",
            };
          })
        );
        setLoading(false);
      },
      () => setLoading(false)
    );
  }, []);

  useEffect(() => {
    return onSnapshot(
      collection(getDb(), COL.expenses),
      (snap) =>
        setExpenses(
          snap.docs.map((d) => ({
            amountKobo: d.data().amountKobo ?? 0,
            dateMs: d.data().date?.toMillis?.() ?? null,
            category: d.data().category ?? "other",
          }))
        ),
      () => {}
    );
  }, []);

  useEffect(() => {
    getDoc(doc(getDb(), COL.settings, "reporting"))
      .then((snap) => {
        const saved = snap.data()?.ranges as ReportRange[] | undefined;
        if (saved?.length) setRanges(saved);
      })
      .catch(() => {
        // Settings is staff-readable; a denial just leaves the presets in place.
      });
  }, []);

  const activeRange = ranges.find((r) => r.key === range) ?? ranges[0] ?? DEFAULT_RANGES[2];
  const days = activeRange?.days ?? null;
  const since = useMemo(() => {
    // null days means all time, so nothing is filtered out.
    if (days === null) return 0;
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - (days - 1));
    return d.getTime();
  }, [days]);

  const inRange = useMemo(
    () => jobs.filter((j) => j.receivedAtMs !== null && j.receivedAtMs >= since),
    [jobs, since]
  );

  /**
   * Revenue and expenses, bucketed to suit the span.
   *
   * Granularity follows the range rather than being fixed: five years by day
   * would be about 1,800 points, which is unreadable and slow. bucketFor picks
   * days, weeks, months or quarters accordingly.
   */
  const series = useMemo(() => {
    const bucket = bucketFor(days);
    const buckets = new Map<string, { label: string; revenue: number; expenses: number; at: number }>();

    // Pre-seed each bucket across the window so a quiet period reads as zero
    // rather than vanishing, which would make the line misleadingly smooth.
    // For all-time the seed starts at the oldest record rather than a fixed span.
    const earliest =
      days === null
        ? Math.min(
            ...[
              ...jobs.map((j) => j.receivedAtMs ?? Infinity),
              ...expenses.map((e) => e.dateMs ?? Infinity),
              Date.now(),
            ]
          )
        : since;

    const stepDays = bucket === "day" ? 1 : bucket === "week" ? 7 : bucket === "month" ? 28 : 90;
    for (let cursor = earliest; cursor <= Date.now(); cursor += stepDays * 86_400_000) {
      const k = bucketKey(cursor, bucket);
      if (!buckets.has(k)) {
        buckets.set(k, { label: bucketLabel(cursor, bucket), revenue: 0, expenses: 0, at: cursor });
      }
    }

    for (const j of jobs) {
      if (j.receivedAtMs === null || j.receivedAtMs < since) continue;
      const k = bucketKey(j.receivedAtMs, bucket);
      const b =
        buckets.get(k) ??
        buckets
          .set(k, {
            label: bucketLabel(j.receivedAtMs, bucket),
            revenue: 0,
            expenses: 0,
            at: j.receivedAtMs,
          })
          .get(k)!;
      b.revenue += j.totalKobo / 100;
    }
    for (const e of expenses) {
      if (e.dateMs === null || e.dateMs < since) continue;
      const k = bucketKey(e.dateMs, bucket);
      const b =
        buckets.get(k) ??
        buckets
          .set(k, { label: bucketLabel(e.dateMs, bucket), revenue: 0, expenses: 0, at: e.dateMs })
          .get(k)!;
      b.expenses += e.amountKobo / 100;
    }

    // Sorted by time: map insertion order is not chronological once a record
    // lands in a bucket that was not pre-seeded.
    return [...buckets.values()].sort((a, b) => a.at - b.at);
  }, [jobs, expenses, since, days]);

  const totals = useMemo(() => {
    const revenue = inRange.reduce((s, j) => s + j.totalKobo, 0);
    const collected = inRange.reduce((s, j) => s + j.paidKobo, 0);
    const outstanding = jobs.reduce((s, j) => s + j.balanceKobo, 0);
    const spend = expenses
      .filter((e) => e.dateMs !== null && e.dateMs >= since)
      .reduce((s, e) => s + e.amountKobo, 0);
    return { revenue, collected, outstanding, spend, jobCount: inRange.length };
  }, [inRange, jobs, expenses, since]);

  const statusMix = useMemo(() => {
    const counts = new Map<JobStatus, number>();
    for (const j of jobs) counts.set(j.status, (counts.get(j.status) ?? 0) + 1);
    return [...counts.entries()]
      .map(([status, value]) => ({ name: JOB_STATUS_LABELS[status], value }))
      .sort((a, b) => b.value - a.value);
  }, [jobs]);

  const topCustomers = useMemo(() => {
    const by = new Map<string, number>();
    for (const j of inRange) {
      if (!j.customerName) continue;
      by.set(j.customerName, (by.get(j.customerName) ?? 0) + j.totalKobo / 100);
    }
    return [...by.entries()]
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 6);
  }, [inRange]);

  // Returned before the company panels so an operator never renders them, even
  // briefly, and never subscribes to data they cannot read.
  if (isOperator) return <OperatorDashboard />;

  /** Job counts per customer, for the manager view that omits money. */
  const jobsPerCustomer = useMemo(() => {
    const by = new Map<string, number>();
    for (const j of inRange) {
      if (!j.customerName) continue;
      by.set(j.customerName, (by.get(j.customerName) ?? 0) + 1);
    }
    return [...by.entries()]
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 6);
  }, [inRange]);

  if (loading) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <Loader2 className="animate-spin text-brass-400" size={30} aria-label="Loading" />
      </div>
    );
  }

  const hasData = jobs.length > 0 || expenses.length > 0;

  return (
    <div className="mx-auto max-w-7xl pb-16">
      <header>
        <p className="text-eyebrow">Dashboard</p>
        <h1 className="text-title mt-3 text-cream-50">
          {greeting()}
          {session.displayName ? `, ${session.displayName.split(" ")[0]}` : ""}
        </h1>
      </header>

      {!hasData ? (
        <div className="mt-10 rounded-3xl border border-night-700/60 bg-night-900/40 p-12 text-center">
          <TrendingUp className="mx-auto text-brass-400" size={30} />
          <p className="mt-4 font-display text-lg text-cream-200">Nothing to chart yet</p>
          <p className="mx-auto mt-2 max-w-md text-sm text-cream-500">
            Create a service job, or use the Demo data button above to load a sample
            six weeks of activity.
          </p>
        </div>
      ) : (
        <>
          <InsightsPanel />

          {/* Range selector */}
          <div className="mt-8 flex flex-wrap items-center gap-2">
            {ranges.map((r) => (
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

          {/* Animated headline figures */}
          <div
            className={`mt-6 grid gap-4 sm:grid-cols-2 ${
              canSeeFinance ? "lg:grid-cols-4" : "lg:grid-cols-2"
            }`}
          >
            {canSeeFinance && (
              <>
                <Figure
                  label="Revenue"
                  value={totals.revenue}
                  format={(n) => formatNaira(n)}
                  accent
                />
                <Figure
                  label="Collected"
                  value={totals.collected}
                  format={(n) => formatNaira(n)}
                />
                <Figure
                  label="Outstanding"
                  value={totals.outstanding}
                  format={(n) => formatNaira(n)}
                  warn={totals.outstanding > 0}
                />
              </>
            )}
            <Figure label="Jobs" value={totals.jobCount} format={(n) => String(Math.round(n))} />
          </div>

          {/* Revenue vs expenses */}
          {canSeeFinance && (
          <Panel
            title="Revenue and spend"
            hint={days === null ? "All time" : days === 1 ? "Today" : `Last ${days} days`}
            delay={0.05}
          >
            <ResponsiveContainer width="100%" height={280}>
              <AreaChart data={series} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="revFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#dba95f" stopOpacity={0.45} />
                    <stop offset="100%" stopColor="#dba95f" stopOpacity={0.02} />
                  </linearGradient>
                  <linearGradient id="expFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#a8705a" stopOpacity={0.35} />
                    <stop offset="100%" stopColor="#a8705a" stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#2a2520" vertical={false} />
                <XAxis
                  dataKey="label"
                  tick={{ fill: "#8e8781", fontSize: 11 }}
                  stroke="#2a2520"
                  interval="preserveStartEnd"
                />
                <YAxis
                  tick={{ fill: "#8e8781", fontSize: 11 }}
                  stroke="#2a2520"
                  tickFormatter={(v) => formatNairaCompact(Number(v) * 100)}
                  width={58}
                />
                <Tooltip
                  contentStyle={TOOLTIP}
                  formatter={(v: number, name) => [formatNaira(Number(v) * 100), name]}
                />
                <Legend wrapperStyle={{ fontSize: 12, color: "#8e8781" }} />
                <Area
                  type="monotone"
                  dataKey="revenue"
                  name="Revenue"
                  stroke="#dba95f"
                  strokeWidth={2}
                  fill="url(#revFill)"
                  animationDuration={900}
                />
                <Area
                  type="monotone"
                  dataKey="expenses"
                  name="Spend"
                  stroke="#a8705a"
                  strokeWidth={2}
                  fill="url(#expFill)"
                  animationDuration={900}
                />
              </AreaChart>
            </ResponsiveContainer>
          </Panel>
          )}

          <div className="mt-6 grid gap-6 lg:grid-cols-2">
            <Panel title="Jobs by status" delay={0.1}>
              <ResponsiveContainer width="100%" height={250}>
                <PieChart>
                  <Pie
                    data={statusMix}
                    dataKey="value"
                    nameKey="name"
                    innerRadius={58}
                    outerRadius={92}
                    paddingAngle={3}
                    animationDuration={900}
                  >
                    {statusMix.map((_, i) => (
                      <Cell key={i} fill={SERIES[i % SERIES.length]} stroke="none" />
                    ))}
                  </Pie>
                  <Tooltip contentStyle={TOOLTIP} />
                  <Legend wrapperStyle={{ fontSize: 12, color: "#8e8781" }} />
                </PieChart>
              </ResponsiveContainer>
            </Panel>

            {canSeeFinance ? (
            <Panel title="Top customers" hint="by value in range" delay={0.15}>
              {topCustomers.length === 0 ? (
                <p className="py-16 text-center text-sm text-cream-500">
                  No jobs in this range.
                </p>
              ) : (
                <ResponsiveContainer width="100%" height={250}>
                  <BarChart
                    data={topCustomers}
                    layout="vertical"
                    margin={{ top: 4, right: 16, left: 0, bottom: 0 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" stroke="#2a2520" horizontal={false} />
                    <XAxis
                      type="number"
                      tick={{ fill: "#8e8781", fontSize: 11 }}
                      stroke="#2a2520"
                      tickFormatter={(v) => formatNairaCompact(Number(v) * 100)}
                    />
                    <YAxis
                      type="category"
                      dataKey="name"
                      tick={{ fill: "#cfc4b4", fontSize: 11 }}
                      stroke="#2a2520"
                      width={120}
                    />
                    <Tooltip
                      contentStyle={TOOLTIP}
                      formatter={(v: number) => formatNaira(Number(v) * 100)}
                    />
                    <Bar dataKey="value" radius={[0, 6, 6, 0]} animationDuration={900}>
                      {topCustomers.map((_, i) => (
                        <Cell key={i} fill={SERIES[i % SERIES.length]} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              )}
            </Panel>
            ) : (
              /* Managers get workload instead of value: the same customers, ranked
                 by how much work is in the building rather than by money. */
              <Panel title="Busiest customers" hint="by job count in range" delay={0.15}>
                {topCustomers.length === 0 ? (
                  <p className="py-16 text-center text-sm text-cream-500">
                    No jobs in this range.
                  </p>
                ) : (
                  <ul className="divide-y divide-night-800">
                    {jobsPerCustomer.map((c) => (
                      <li
                        key={c.name}
                        className="flex items-center justify-between gap-4 py-3"
                      >
                        <span className="min-w-0 truncate text-sm text-cream-200">
                          {c.name}
                        </span>
                        <span className="shrink-0 font-display text-lg text-cream-50">
                          {c.count}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </Panel>
            )}
          </div>

          <div className="mt-8 flex flex-wrap gap-3">
            <QuickLink href="/admin/jobs/" label="Service jobs" />
            <QuickLink href="/admin/worklog/" label="Work log" />
            <QuickLink href="/admin/payroll/" label="Payroll" />
            <QuickLink href="/admin/submissions/" label="Submissions" />
          </div>
        </>
      )}
    </div>
  );
}

const TOOLTIP = {
  background: "#14100b",
  border: "1px solid #3a332b",
  borderRadius: 12,
  color: "#faf7f2",
  fontSize: 12,
} as const;

function greeting(): string {
  const h = Number(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: "Africa/Lagos",
      hour: "numeric",
      hour12: false,
    }).format(new Date())
  );
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  return "Good evening";
}

function Figure({
  label,
  value,
  format,
  accent,
  warn,
}: {
  label: string;
  value: number;
  format: (n: number) => string;
  accent?: boolean;
  warn?: boolean;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
      className={`rounded-3xl border p-5 ${
        accent
          ? "border-brass-500/40 bg-brass-500/5"
          : "border-night-700/60 bg-night-900/40"
      }`}
    >
      <p className="text-xs uppercase tracking-wider text-cream-500">{label}</p>
      <LiveCounter
        value={value}
        format={format}
        className={`mt-2 block font-display text-2xl ${
          warn ? "text-amber-300" : accent ? "text-brass-300" : "text-cream-50"
        }`}
      />
    </motion.div>
  );
}

function Panel({
  title,
  hint,
  delay = 0,
  children,
}: {
  title: string;
  hint?: string;
  delay?: number;
  children: React.ReactNode;
}) {
  return (
    <motion.section
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.6, delay, ease: [0.22, 1, 0.36, 1] }}
      className="mt-6 rounded-3xl border border-night-700/60 bg-night-900/30 p-6"
    >
      <div className="mb-4 flex items-baseline justify-between gap-3">
        <h2 className="font-display text-lg text-cream-100">{title}</h2>
        {hint && <span className="text-xs text-cream-500">{hint}</span>}
      </div>
      {children}
    </motion.section>
  );
}

function QuickLink({ href, label }: { href: string; label: string }) {
  return (
    <Link
      href={href}
      className="group flex items-center gap-2 rounded-xl border border-night-600 bg-night-900/50 px-5 py-3 text-sm text-cream-200 transition-all duration-300 hover:border-brass-500/60 hover:text-brass-300"
    >
      {label}
      <ArrowRight
        size={14}
        className="transition-transform duration-300 group-hover:translate-x-0.5"
      />
    </Link>
  );
}

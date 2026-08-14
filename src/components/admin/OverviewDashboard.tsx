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
import {
  collection,
  doc,
  getDoc,
  onSnapshot,
  orderBy,
  query,
  Timestamp,
  where,
} from "firebase/firestore";
import { getDb } from "@/lib/firebase";
import { COL } from "@/lib/erp/collections";
import {
  JOB_STATUS_LABELS,
  type JobStatus,
  type ProjectStatus,
} from "@/lib/erp/enums";
import { formatNaira, formatNairaCompact } from "@/lib/erp/money";
import { LiveCounter } from "@/components/admin/ui/LiveCounter";
import { InsightsPanel } from "@/components/admin/InsightsPanel";
import { DashboardAlerts } from "@/components/admin/DashboardAlerts";
import { MeterSummaryPanel } from "@/components/admin/MeterSummaryPanel";
import { useErpSession } from "@/components/admin/ErpAuthProvider";
import {
  bucketFor,
  bucketKey,
  bucketLabel,
  DEFAULT_RANGES,
  DEFAULT_RANGE_KEY,
  type ReportRange,
} from "@/lib/erp/ranges";
import { WorkLogScreen } from "@/components/admin/payroll/WorkLogScreen";
import { LEGEND_STYLE, TOOLTIP_PROPS } from "@/components/admin/ui/chartTheme";


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
 * A project, as the dashboard needs it.
 *
 * Earned value is the contract figure where one was agreed, and the estimate
 * otherwise. An estimate is what the business expects to charge before the client
 * has signed, so using it keeps a project in the picture during pricing rather
 * than having it appear from nowhere on approval.
 */
interface ProjectPoint {
  id: string;
  status: ProjectStatus;
  valueKobo: number;
  startedAtMs: number | null;
  customerName: string;
}

/** A counter sale, reduced to what the dashboard needs. */
interface SalePoint {
  id: string;
  /**
   * Net of tax.
   *
   * Tax collected is held for the revenue service rather than earned, so including it would
   * overstate what the counter made. `profit.ts` nets it off the same way, and the two figures
   * have to agree or the dashboard and the P&L tell different stories about the same week.
   */
  netKobo: number;
  costKobo: number;
  soldAtMs: number | null;
  customerName: string;
}

/**
 * Which revenue line the figures cover.
 *
 * Three trades, and they were added one at a time as each turned out to be missing: the
 * dashboard first read only service jobs, so project earnings were invisible; then only those
 * two, so every naira taken at the counter was absent from the headline figure the screen opens
 * on. A fitted kitchen, a day's cutting and a sheet sold over the counter have different
 * rhythms, so they are worth seeing apart as well as together.
 */
type LineFilter = "all" | "service" | "product" | "retail";

const LINE_TABS: Array<{ key: LineFilter; label: string }> = [
  { key: "all", label: "All revenue" },
  { key: "service", label: "Services" },
  { key: "product", label: "Products" },
  { key: "retail", label: "Counter Sales" },
];

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
  const [projects, setProjects] = useState<ProjectPoint[]>([]);
  const [sales, setSales] = useState<SalePoint[]>([]);
  const [expenses, setExpenses] = useState<ExpensePoint[]>([]);
  const [loading, setLoading] = useState(true);
  /** Which revenue line the charts and tiles cover. */
  const [line, setLine] = useState<LineFilter>("all");
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

  // Derived above the subscriptions because they now query by this window. A
  // `const` read from an effect declared earlier in the file would sit in the
  // temporal dead zone on first render.
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

  useEffect(() => {
    // Bounded to the selected range rather than reading every job ever recorded.
    // "All time" still asks for everything, because that is what it means, but the
    // day-to-day views no longer pay for history they do not display.
    const jobsRef = collection(getDb(), COL.serviceJobs);
    const q =
      since > 0
        ? query(
            jobsRef,
            where("receivedAt", ">=", Timestamp.fromMillis(since)),
            orderBy("receivedAt", "desc")
          )
        : query(jobsRef, orderBy("receivedAt", "desc"));
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
    // Re-subscribes when the range changes, so the query window follows it.
  }, [since]);

  useEffect(() => {
    // Projects, the other half of the business. Bounded the same way as jobs.
    //
    // Cancelled projects are dropped: they were never earned, and leaving them in
    // would inflate revenue with work that will not happen. The filter is applied
    // client-side because excluding one value server-side needs a composite index
    // for a saving of a handful of documents.
    const projRef = collection(getDb(), COL.projects);
    const q =
      since > 0
        ? query(
            projRef,
            where("startDate", ">=", Timestamp.fromMillis(since)),
            orderBy("startDate", "desc")
          )
        : query(projRef, orderBy("startDate", "desc"));
    return onSnapshot(
      q,
      (snap) =>
        setProjects(
          snap.docs
            .filter((d) => d.data().status !== "cancelled")
            .map((d) => {
              const x = d.data();
              return {
                id: d.id,
                status: (x.status as ProjectStatus) ?? "enquiry",
                // The agreed contract figure where there is one, the current
                // estimate otherwise.
                valueKobo: x.contractValueKobo ?? x.estimatedCostKobo ?? 0,
                startedAtMs: x.startDate?.toMillis?.() ?? null,
                customerName: x.customerName ?? "",
              };
            })
        ),
      () => {}
    );
  }, [since]);

  useEffect(() => {
    /*
     * Counter sales, the third trade.
     *
     * Voided sales are dropped: those goods came back, so nothing was earned. Filtered
     * client-side for the same reason as cancelled projects — excluding one value server-side
     * would need a composite index to save a handful of documents.
     *
     * A sale on account still counts in full. The goods left and their cost was incurred, so
     * the revenue belongs to the day of the sale whether or not the money has arrived; what is
     * still owed is a receivable, shown on the counter screen. Using the amount collected
     * instead would report a loss on every credit sale and a windfall whenever it was settled.
     */
    const salesRef = collection(getDb(), COL.sales);
    const q =
      since > 0
        ? query(
            salesRef,
            where("soldAt", ">=", Timestamp.fromMillis(since)),
            orderBy("soldAt", "desc")
          )
        : query(salesRef, orderBy("soldAt", "desc"));
    return onSnapshot(
      q,
      (snap) =>
        setSales(
          snap.docs
            .filter((d) => d.data().status !== "voided")
            .map((d) => {
              const x = d.data();
              return {
                id: d.id,
                netKobo: (x.totalKobo ?? 0) - (x.taxKobo ?? 0),
                costKobo: x.costOfGoodsKobo ?? 0,
                soldAtMs: x.soldAt?.toMillis?.() ?? null,
                customerName: x.customerName ?? "",
              };
            })
        ),
      () => {}
    );
  }, [since]);

  useEffect(() => {
    const expensesRef = collection(getDb(), COL.expenses);
    const q =
      since > 0
        ? query(expensesRef, where("date", ">=", Timestamp.fromMillis(since)))
        : query(expensesRef);
    return onSnapshot(
      q,
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
  }, [since]);

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

  const inRange = useMemo(
    () => jobs.filter((j) => j.receivedAtMs !== null && j.receivedAtMs >= since),
    [jobs, since]
  );

  const projectsInRange = useMemo(
    () => projects.filter((p) => p.startedAtMs !== null && p.startedAtMs >= since),
    [projects, since]
  );

  const salesInRange = useMemo(
    () => sales.filter((s) => s.soldAtMs !== null && s.soldAtMs >= since),
    [sales, since]
  );

  /**
   * The earning events the selected line covers, reduced to a common shape.
   *
   * Both trades are flattened to {at, kobo} so the chart and the tiles read from one
   * list. A service job earns when the boards come in; a project earns from its
   * start date, which is the closest thing it has to a comparable moment.
   */
  const earnings = useMemo(() => {
    const svc = inRange.map((j) => ({ at: j.receivedAtMs!, kobo: j.totalKobo }));
    const prd = projectsInRange.map((p) => ({ at: p.startedAtMs!, kobo: p.valueKobo }));
    const ret = salesInRange.map((s) => ({ at: s.soldAtMs!, kobo: s.netKobo }));
    if (line === "service") return svc;
    if (line === "product") return prd;
    if (line === "retail") return ret;
    // "All" is all three. It previously summed only the first two, so every naira taken at
    // the counter was missing from the headline figure the dashboard opens on.
    return [...svc, ...prd, ...ret];
  }, [inRange, projectsInRange, salesInRange, line]);

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
              ...earnings.map((e) => e.at),
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

    for (const e of earnings) {
      if (e.at < since) continue;
      const k = bucketKey(e.at, bucket);
      const b =
        buckets.get(k) ??
        buckets
          .set(k, {
            label: bucketLabel(e.at, bucket),
            revenue: 0,
            expenses: 0,
            at: e.at,
          })
          .get(k)!;
      b.revenue += e.kobo / 100;
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
  }, [earnings, expenses, since, days]);

  const totals = useMemo(() => {
    const revenue = earnings.reduce((s, e) => s + e.kobo, 0);

    // Collected and outstanding come from service jobs only, whatever line is
    // selected, and the tiles say so. A project has no payment ledger of its own:
    // money against a project arrives through its invoice, so counting it here
    // would either miss it or double it depending on which side was read.
    const collected = inRange.reduce((s, j) => s + j.paidKobo, 0);
    const outstanding = jobs.reduce((s, j) => s + j.balanceKobo, 0);
    const spend = expenses
      .filter((e) => e.dateMs !== null && e.dateMs >= since)
      .reduce((s, e) => s + e.amountKobo, 0);
    /*
     * Each line's own revenue, regardless of which tab is showing.
     *
     * So the split can be read at a glance without clicking through all four tabs, and so the
     * three parts can be seen to add up to the total — a breakdown that does not reconcile with
     * the headline above it is worse than no breakdown.
     */
    const serviceRevenue = inRange.reduce((s, j) => s + j.totalKobo, 0);
    const productRevenue = projectsInRange.reduce((s, p) => s + p.valueKobo, 0);
    const retailRevenue = salesInRange.reduce((s, x) => s + x.netKobo, 0);

    return {
      revenue,
      serviceRevenue,
      productRevenue,
      retailRevenue,
      /*
       * All three lines summed, whatever tab is selected.
       *
       * `revenue` above follows the tab, so using it as the denominator for the split would
       * show the selected line as 100% of itself. This is the figure the percentages divide by.
       */
      allRevenue: serviceRevenue + productRevenue + retailRevenue,
      collected,
      outstanding,
      spend,
      jobCount: inRange.length,
      projectCount: projectsInRange.length,
      saleCount: salesInRange.length,
      earningCount: earnings.length,
    };
  }, [earnings, inRange, projectsInRange, salesInRange, jobs, expenses, since]);

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
  //
  // The work log itself, not a dashboard of it: logging work is the entirety of
  // what an operator is here to do, and a landing page whose only purpose is to
  // link onward to the one screen that matters is a step in the way. The shell
  // drops its navigation for this role for the same reason.
  if (isOperator) return <WorkLogScreen />;

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

  // Projects count as data too. Without them a workshop that had only taken on
  // project work would be told the dashboard was empty while its revenue sat in
  // the Products pipeline.
  const hasData = jobs.length > 0 || projects.length > 0 || expenses.length > 0;

  return (
    <div className="mx-auto max-w-7xl pb-16">
      <header>
        <p className="text-eyebrow">Dashboard</p>
        <h1 className="text-title mt-3 text-cream-50">
          {greeting()}
          {session.displayName ? `, ${session.displayName.split(" ")[0]}` : ""}
        </h1>
      </header>

      {/* Above the charts, and outside the `hasData` guard: a meter that has not been
          read today matters on a quiet week too, and it is the quiet weeks when the
          reading gets forgotten. Each block hides itself when it has nothing to say,
          so this is empty space rather than furniture most days. */}
      <div className="mt-8">
        <DashboardAlerts />
      </div>

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
          {/* Inside the finance guard, not above it. The panel subscribes to
              expenses, wage runs, invoices and loans, so rendering it outside
              defeated the gating around it: a manager was denied the revenue
              tiles and then handed an insights panel built from payroll and
              receivables. */}
          {canSeeFinance && <InsightsPanel />}

          {/* Revenue line selector. Sits above the range chips because it changes
              what is being measured, not merely over what period. */}
          {canSeeFinance && (
            <div className="mt-8 flex items-center gap-1 border-b border-night-700/60">
              {LINE_TABS.map((t) => (
                <button
                  key={t.key}
                  type="button"
                  onClick={() => setLine(t.key)}
                  aria-pressed={line === t.key}
                  className={`relative cursor-pointer px-4 py-2.5 text-sm font-medium transition-colors duration-300 ${
                    line === t.key
                      ? "text-brass-300"
                      : "text-cream-400 hover:text-cream-200"
                  }`}
                >
                  {t.label}
                  {line === t.key && (
                    <motion.span
                      layoutId="line-tab-underline"
                      className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-brass-500"
                    />
                  )}
                </button>
              ))}
            </div>
          )}

          {/* Range selector */}
          <div className="mt-5 flex flex-wrap items-center gap-2">
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
                  label={
                    line === "service"
                      ? "Service revenue"
                      : line === "product"
                        ? "Product revenue"
                        : line === "retail"
                          ? "Counter revenue"
                          : "Revenue, all three lines"
                  }
                  value={totals.revenue}
                  format={(n) => formatNaira(n)}
                  accent
                />
                {/* Both of these read the service payment ledger regardless of the
                    selected line, so the label says so rather than appearing to
                    change with the tab and quietly not doing. */}
                <Figure
                  label="Collected, services"
                  value={totals.collected}
                  format={(n) => formatNaira(n)}
                />
                <Figure
                  label="Outstanding, services"
                  value={totals.outstanding}
                  format={(n) => formatNaira(n)}
                  warn={totals.outstanding > 0}
                />
              </>
            )}
            <Figure
              label={
                line === "product" ? "Projects" : line === "retail" ? "Sales" : "Jobs"
              }
              value={
                line === "product"
                  ? totals.projectCount
                  : line === "retail"
                    ? totals.saleCount
                    : totals.jobCount
              }
              format={(n) => String(Math.round(n))}
            />
          </div>

          {/*
            * The split, always visible rather than only on the tab that shows it.
            *
            * Three trades with different rhythms — a fitted kitchen, a day's cutting, a sheet
            * sold over the counter — and the useful question is usually the mix rather than any
            * one line. Shown as a reconciliation: the three add to the headline above, so a
            * figure that does not add up is visible rather than hidden behind a tab.
            */}
          {canSeeFinance && totals.allRevenue > 0 && (
            <div className="mt-4 grid gap-3 sm:grid-cols-3">
              {(
                [
                  ["Services", totals.serviceRevenue, "service"],
                  ["Products", totals.productRevenue, "product"],
                  ["Counter", totals.retailRevenue, "retail"],
                ] as Array<[string, number, LineFilter]>
              ).map(([label, value, key]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setLine(key)}
                  className={`cursor-pointer rounded-2xl border px-4 py-3 text-left transition-all duration-300 ${
                    line === key
                      ? "border-brass-500/60 bg-brass-500/10"
                      : "border-night-700/60 bg-night-900/30 hover:border-brass-500/40"
                  }`}
                >
                  <p className="text-xs uppercase tracking-wide text-cream-500">{label}</p>
                  <p className="mt-1 font-display text-lg text-cream-100">
                    {formatNaira(value)}
                  </p>
                  <p className="mt-0.5 text-xs text-cream-600">
                    {Math.round((value / totals.allRevenue) * 100)}% of all revenue
                  </p>
                </button>
              ))}
            </div>
          )}

          {/*
            * Power, above the revenue chart.
            *
            * Metered power never reaches the expense ledger — the profit report adds it on
            * separately — so it was the one significant cost with no presence on this screen at
            * all. For a workshop whose machines are its main cost, that is the wrong thing to
            * leave out.
            */}
          {canSeeFinance && (
            <MeterSummaryPanel
              since={since}
              rangeLabel={
                days === null ? "All time" : days === 1 ? "Today" : `Last ${days} days`
              }
            />
          )}

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
                  {...TOOLTIP_PROPS}
                  formatter={(v: number, name) => [formatNaira(Number(v) * 100), name]}
                />
                <Legend wrapperStyle={LEGEND_STYLE} />
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
                  <Tooltip {...TOOLTIP_PROPS} />
                  <Legend wrapperStyle={LEGEND_STYLE} />
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
                      {...TOOLTIP_PROPS}
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

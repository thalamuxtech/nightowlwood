"use client";

import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  AlertTriangle,
  CircleCheck,
  Info,
  Lightbulb,
  TriangleAlert,
} from "lucide-react";
import {
  collection,
  limit,
  onSnapshot,
  orderBy,
  query,
  Timestamp,
  where,
} from "firebase/firestore";
import { getDb } from "@/lib/firebase";
import { COL } from "@/lib/erp/collections";
import { buildInsights, type Insight, type InsightTone } from "@/lib/erp/insights";

/**
 * How far back the dated checks look.
 *
 * The longest window any check uses is 21 days (customer boards held), and the
 * expense-concentration check wants a representative recent sample rather than
 * the whole ledger. 120 days covers both with room to spare, while keeping the
 * dashboard's read cost flat as the records build up instead of growing with
 * every job the business has ever done.
 */
const WINDOW_DAYS = 120;

/** Caps the unbounded-by-nature reads, so one runaway collection cannot dominate. */
const MAX_DOCS = 500;

const TONE_STYLE: Record<InsightTone, { border: string; text: string; icon: typeof Info }> = {
  danger: { border: "border-red-500/40 bg-red-500/5", text: "text-red-300", icon: TriangleAlert },
  warn: { border: "border-amber-500/40 bg-amber-500/5", text: "text-amber-300", icon: AlertTriangle },
  good: {
    border: "border-emerald-500/40 bg-emerald-500/5",
    text: "text-emerald-300",
    icon: CircleCheck,
  },
  info: { border: "border-night-700/60 bg-night-900/40", text: "text-brass-300", icon: Info },
};

/**
 * Computed observations about the business.
 *
 * Reads the collections the checks need and derives everything client-side.
 * That keeps the logic in one pure function that can be reasoned about, and
 * avoids maintaining a parallel set of aggregate documents that could fall out
 * of step with the records they summarise.
 */
export function InsightsPanel() {
  const [jobs, setJobs] = useState<Parameters<typeof buildInsights>[0]["jobs"]>([]);
  const [expenses, setExpenses] = useState<Parameters<typeof buildInsights>[0]["expenses"]>([]);
  const [wageRuns, setWageRuns] = useState<Parameters<typeof buildInsights>[0]["wageRuns"]>([]);
  const [invoices, setInvoices] = useState<Parameters<typeof buildInsights>[0]["invoices"]>([]);
  const [inventory, setInventory] = useState<Parameters<typeof buildInsights>[0]["inventory"]>([]);
  const [loans, setLoans] = useState<Parameters<typeof buildInsights>[0]["loans"]>([]);
  const [cycles, setCycles] = useState<Parameters<typeof buildInsights>[0]["cycles"]>([]);
  const [tools, setTools] = useState<Parameters<typeof buildInsights>[0]["toolRequests"]>([]);
  const [svcInv, setSvcInv] = useState<
    Parameters<typeof buildInsights>[0]["serviceInventory"]
  >([]);
  const [showAll, setShowAll] = useState(false);

  const ms = (v: { toMillis?: () => number } | null | undefined) => v?.toMillis?.() ?? null;

  useEffect(() => {
    const db = getDb();
    const since = Timestamp.fromMillis(Date.now() - WINDOW_DAYS * 86_400_000);

    /**
     * Recent documents by a date field.
     *
     * Every one of these listeners previously read its entire collection on each
     * change. The checks only ever look at open state or a recent window, so the
     * unbounded read bought nothing and its cost rose forever.
     */
    const recent = (name: string, dateField: string) =>
      query(
        collection(db, name),
        where(dateField, ">=", since),
        orderBy(dateField, "desc"),
        limit(MAX_DOCS)
      );

    /** Documents in one of a set of states, for checks that only see open items. */
    const inStates = (name: string, states: string[]) =>
      query(collection(db, name), where("status", "in", states), limit(MAX_DOCS));

    // A read denied by rules (a manager on an admin-only collection) resolves to
    // an empty list rather than an error, so the panel degrades to fewer
    // observations instead of failing.
    const subs = [
      onSnapshot(recent(COL.serviceJobs, "receivedAt"), (s) =>
        setJobs(
          s.docs.map((d) => {
            const x = d.data();
            return {
              status: x.status ?? "received",
              totalKobo: x.totalKobo ?? 0,
              paidKobo: x.paidKobo ?? 0,
              balanceKobo: x.balanceKobo ?? 0,
              receivedAtMs: ms(x.receivedAt),
              completedAtMs: ms(x.completedAt),
              customerName: x.customerName ?? "",
            };
          })
        ), () => {}),
      onSnapshot(recent(COL.expenses, "date"), (s) =>
        setExpenses(
          s.docs.map((d) => ({
            amountKobo: d.data().amountKobo ?? 0,
            dateMs: ms(d.data().date),
            category: d.data().category ?? "other",
          }))
        ), () => {}),
      // The wage-to-revenue ratio compares the most recent runs, so the newest
      // dozen is all it can use.
      onSnapshot(
        query(collection(db, COL.wageRuns), orderBy("periodEnd", "desc"), limit(12)),
        (s) =>
        setWageRuns(
          s.docs
            .map((d) => ({
              grandTotalKobo: d.data().grandTotalKobo ?? 0,
              periodStartMs: ms(d.data().periodStart),
              periodEndMs: ms(d.data().periodEnd),
              status: d.data().status ?? "draft",
            }))
            .sort((a, b) => (b.periodEndMs ?? 0) - (a.periodEndMs ?? 0))
        ), () => {}),
      // Only unsettled invoices matter: the check wants overdue balances, and a
      // paid or void invoice can never contribute one.
      onSnapshot(inStates(COL.invoices, ["draft", "sent", "partial"]), (s) =>
        setInvoices(
          s.docs.map((d) => ({
            totalKobo: d.data().totalKobo ?? 0,
            balanceKobo: d.data().balanceKobo ?? 0,
            status: d.data().status ?? "draft",
            issuedAtMs: ms(d.data().issuedAt),
            dueAtMs: ms(d.data().dueAt),
            customerName: d.data().customerName ?? "",
          }))
        ), () => {}),
      // Capped rather than filtered: the low-stock check compares quantityOnHand
      // against each item's own reorderLevel, and Firestore cannot compare two
      // fields of the same document. The item list is bounded by what the workshop
      // actually stocks, so the cap is a safety net rather than a real limit.
      onSnapshot(query(collection(db, COL.inventoryCompany), limit(MAX_DOCS)), (s) =>
        setInventory(
          s.docs.map((d) => ({
            name: d.data().name ?? "",
            quantityOnHand: d.data().quantityOnHand ?? 0,
            reorderLevel: d.data().reorderLevel ?? 0,
          }))
        ), () => {}),
      // Only live debt. Settled and rejected loans contribute nothing outstanding.
      onSnapshot(inStates(COL.loans, ["disbursed", "repaying"]), (s) =>
        setLoans(
          s.docs.map((d) => ({
            staffName: d.data().staffName ?? "",
            outstandingKobo: d.data().outstandingKobo ?? 0,
            status: d.data().status ?? "requested",
          }))
        ), () => {}),
      // Blade-life comparison needs retired cycles across brands, so this is
      // history rather than a recent window. Newest first, capped.
      onSnapshot(
        query(collection(db, COL.consumableCycles), orderBy("endDate", "desc"), limit(MAX_DOCS)),
        (s) =>
        setCycles(
          s.docs.map((d) => ({
            brandName: d.data().brandName ?? d.data().model,
            lifespanDays: d.data().lifespanDays,
            costKobo: d.data().costKobo,
            unitsProcessed: d.data().unitsProcessed,
            retiredReason: d.data().retiredReason,
            endDateMs: ms(d.data().endDate),
          }))
        ), () => {}),
      // Only tools still out can be overdue for return.
      onSnapshot(inStates(COL.toolRequests, ["issued", "partially_returned"]), (s) =>
        setTools(
          s.docs.map((d) => ({
            jobName: d.data().jobName ?? "",
            status: d.data().status ?? "requested",
            expectedReturnMs: ms(d.data().expectedReturnDate),
          }))
        ), () => {}),
      // Only boards still held can be held too long.
      onSnapshot(inStates(COL.inventoryService, ["held"]), (s) =>
        setSvcInv(
          s.docs.map((d) => ({
            customerName: d.data().customerName ?? "",
            quantity: d.data().quantity ?? 0,
            status: d.data().status ?? "held",
            receivedAtMs: ms(d.data().receivedAt),
          }))
        ), () => {}),
    ];
    return () => subs.forEach((u) => u());
  }, []);

  const insights = useMemo(
    () =>
      buildInsights({
        jobs,
        expenses,
        wageRuns,
        invoices,
        inventory,
        loans,
        cycles,
        toolRequests: tools,
        serviceInventory: svcInv,
      }),
    [jobs, expenses, wageRuns, invoices, inventory, loans, cycles, tools, svcInv]
  );

  if (insights.length === 0) return null;

  const visible = showAll ? insights : insights.slice(0, 4);

  return (
    <motion.section
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
      className="mt-8"
    >
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="flex items-center gap-2 font-display text-lg text-cream-100">
          <Lightbulb size={18} className="text-brass-400" /> What needs attention
        </h2>
        {insights.length > 4 && (
          <button
            type="button"
            onClick={() => setShowAll((v) => !v)}
            className="cursor-pointer text-xs text-cream-400 transition-colors hover:text-brass-300"
          >
            {showAll ? "Show less" : `Show all ${insights.length}`}
          </button>
        )}
      </div>

      <div className="mt-4 grid gap-3 lg:grid-cols-2">
        <AnimatePresence mode="popLayout">
          {visible.map((insight, i) => (
            <InsightCard key={insight.id} insight={insight} index={i} />
          ))}
        </AnimatePresence>
      </div>
    </motion.section>
  );
}

function InsightCard({ insight, index }: { insight: Insight; index: number }) {
  const style = TONE_STYLE[insight.tone];
  const Icon = style.icon;
  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.97 }}
      transition={{ duration: 0.4, delay: index * 0.05, ease: [0.22, 1, 0.36, 1] }}
      className={`rounded-2xl border p-5 ${style.border}`}
    >
      <p className={`flex items-start gap-2.5 text-sm font-medium ${style.text}`}>
        <Icon size={16} className="mt-0.5 shrink-0" />
        {insight.title}
      </p>
      <p className="mt-2 pl-[26px] text-xs leading-relaxed text-cream-400">
        {insight.detail}
      </p>
      {insight.action && (
        <p className="mt-2 pl-[26px] text-xs font-medium text-cream-200">
          {insight.action}
        </p>
      )}
    </motion.div>
  );
}

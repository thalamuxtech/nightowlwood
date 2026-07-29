"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import {
  ClipboardList,
  HandCoins,
  Loader2,
  TriangleAlert,
  Wrench,
} from "lucide-react";
import {
  collection,
  limit,
  onSnapshot,
  orderBy,
  query,
  where,
} from "firebase/firestore";
import { getDb } from "@/lib/firebase";
import { COL } from "@/lib/erp/collections";
import { WAGE_WORK_TYPE_LABELS, type WageWorkType } from "@/lib/erp/enums";
import { formatNaira } from "@/lib/erp/money";
import { resolveRates, weekBounds } from "@/lib/erp/wages";
import type { WageRate } from "@/lib/erp/types";
import { LiveCounter } from "@/components/admin/ui/LiveCounter";
import { EmptyState } from "@/components/admin/ui/Fields";
import { useErpSession } from "@/components/admin/ErpAuthProvider";

interface LogPoint {
  workType: WageWorkType;
  units: number;
  dateMs: number | null;
  assistantIds: string[];
}

/**
 * Operator's own view.
 *
 * Deliberately narrow: their work this week, an indicative figure for it, and
 * their own tool and loan requests. Nothing about company revenue, other
 * operators' output, or anyone else's pay.
 *
 * The wage figure is labelled as indicative rather than presented as an amount
 * owed. A payroll run applies loan deductions and can exclude work types with no
 * rate in force, so a number shown here as "your pay" would sometimes disagree
 * with the payslip, and the operator would be right to trust the payslip.
 */
export function OperatorDashboard() {
  const session = useErpSession();
  const staffId = session.staffId;

  const [logs, setLogs] = useState<LogPoint[]>([]);
  const [rates, setRates] = useState<WageRate[]>([]);
  const [tools, setTools] = useState<Array<{ id: string; jobName: string; status: string }>>([]);
  const [loans, setLoans] = useState<Array<{ id: string; type: string; status: string; outstandingKobo: number }>>([]);
  const [loading, setLoading] = useState(true);
  const [ratesDenied, setRatesDenied] = useState(false);

  const week = useMemo(() => weekBounds(new Date()), []);

  useEffect(() => {
    if (!staffId) {
      setLoading(false);
      return;
    }
    // Rules scope operators to their own logs, so this query matches what they
    // are permitted to read rather than relying on the UI to filter.
    return onSnapshot(
      query(
        collection(getDb(), COL.workLogs),
        where("staffId", "==", staffId),
        orderBy("workDate", "desc"),
        limit(120)
      ),
      (snap) => {
        setLogs(
          snap.docs.map((d) => ({
            workType: (d.data().workType as WageWorkType) ?? "board",
            units: d.data().units ?? 0,
            dateMs: d.data().workDate?.toMillis?.() ?? null,
            assistantIds: (d.data().assistantIds as string[]) ?? [],
          }))
        );
        setLoading(false);
      },
      () => setLoading(false)
    );
  }, [staffId]);

  // Rates are admin-only. A denial is expected for an operator, so it degrades
  // to hiding the estimate rather than showing an error.
  useEffect(() => {
    return onSnapshot(
      collection(getDb(), COL.wageRates),
      (snap) => setRates(snap.docs.map((d) => ({ id: d.id, ...d.data() })) as WageRate[]),
      () => setRatesDenied(true)
    );
  }, []);

  useEffect(() => {
    if (!staffId) return;
    return onSnapshot(
      query(collection(getDb(), COL.toolRequests), where("requestedByStaffId", "==", staffId)),
      (snap) =>
        setTools(
          snap.docs.map((d) => ({
            id: d.id,
            jobName: d.data().jobName ?? "",
            status: d.data().status ?? "requested",
          }))
        ),
      () => {}
    );
  }, [staffId]);

  useEffect(() => {
    if (!staffId) return;
    return onSnapshot(
      query(collection(getDb(), COL.loans), where("staffId", "==", staffId)),
      (snap) =>
        setLoans(
          snap.docs.map((d) => ({
            id: d.id,
            type: d.data().type ?? "advance",
            status: d.data().status ?? "requested",
            outstandingKobo: d.data().outstandingKobo ?? 0,
          }))
        ),
      () => {}
    );
  }, [staffId]);

  const thisWeek = useMemo(
    () =>
      logs.filter(
        (l) =>
          l.dateMs !== null &&
          l.dateMs >= week.start.getTime() &&
          l.dateMs <= week.end.getTime()
      ),
    [logs, week]
  );

  const byType = useMemo(() => {
    const m = new Map<WageWorkType, number>();
    for (const l of thisWeek) m.set(l.workType, (m.get(l.workType) ?? 0) + l.units);
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [thisWeek]);

  /** Indicative only: no deductions applied, missing rates simply omitted. */
  const indicative = useMemo(() => {
    if (ratesDenied || rates.length === 0) return null;
    const resolved = resolveRates(rates, week.end.getTime());
    let total = 0;
    let anyMissing = false;
    for (const [type, units] of byType) {
      const r = resolved.get(type);
      if (!r) {
        anyMissing = true;
        continue;
      }
      total += Math.round(units * r.operatorRateKobo);
    }
    return { total, anyMissing };
  }, [byType, rates, ratesDenied, week]);

  const outstandingLoan = loans
    .filter((l) => l.status === "disbursed" || l.status === "repaying")
    .reduce((s, l) => s + l.outstandingKobo, 0);

  const toolsOut = tools.filter(
    (t) => t.status === "issued" || t.status === "partially_returned"
  );

  if (!staffId) {
    return (
      <div className="mx-auto max-w-lg rounded-3xl border border-amber-500/40 bg-amber-500/5 p-8 text-center">
        <TriangleAlert className="mx-auto text-amber-400" size={28} />
        <h1 className="mt-4 font-display text-xl text-cream-100">
          Your login is not linked to a staff record
        </h1>
        <p className="mt-2 text-sm leading-relaxed text-cream-400">
          Work cannot be attributed to you until an admin links your account to a
          staff record, which also means it would not be paid. Ask an admin to
          set the staff link on your user.
        </p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center">
        <Loader2 className="animate-spin text-brass-400" size={28} aria-label="Loading" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl pb-20">
      <header>
        <p className="text-eyebrow">This week</p>
        <h1 className="text-title mt-3 text-cream-50">
          {session.displayName ? session.displayName.split(" ")[0] : "Your work"}
        </h1>
        <p className="mt-3 text-sm text-cream-400">
          {week.start.toLocaleDateString("en-GB", { day: "numeric", month: "short" })} to{" "}
          {week.end.toLocaleDateString("en-GB", { day: "numeric", month: "short" })}
        </p>
      </header>

      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
        className="mt-8 grid gap-4 sm:grid-cols-3"
      >
        <Tile
          label="Jobs logged"
          value={<LiveCounter value={thisWeek.length} className="font-display text-3xl text-cream-50" />}
        />
        <Tile
          label="Units of work"
          value={
            <LiveCounter
              value={thisWeek.reduce((s, l) => s + l.units, 0)}
              className="font-display text-3xl text-cream-50"
            />
          }
        />
        <Tile
          label="Tools off site"
          value={
            <span
              className={`font-display text-3xl ${
                toolsOut.length > 0 ? "text-amber-300" : "text-cream-50"
              }`}
            >
              {toolsOut.length}
            </span>
          }
        />
      </motion.div>

      {indicative && (
        <section className="mt-6 rounded-3xl border border-brass-500/30 bg-brass-500/5 p-6">
          <p className="text-xs uppercase tracking-wider text-brass-400">
            Indicative earnings for this week
          </p>
          <p className="mt-2 font-display text-3xl text-brass-300">
            {formatNaira(indicative.total)}
          </p>
          <p className="mt-3 text-xs leading-relaxed text-cream-500">
            An estimate of your operator work only. It does not include assistant
            work credited to you, loan or advance deductions, or any adjustment
            made during payroll. Your payslip is the figure that counts.
            {indicative.anyMissing &&
              " Some work has no rate set yet and is excluded."}
          </p>
        </section>
      )}

      <section className="mt-8">
        <h2 className="flex items-center gap-2 font-display text-lg text-cream-100">
          <ClipboardList size={18} className="text-brass-400" /> Work by type
        </h2>
        {byType.length === 0 ? (
          <div className="mt-4">
            <EmptyState
              title="Nothing logged this week"
              hint="Log your work so it counts toward the weekly wage run."
              action={
                <Link
                  href="/admin/worklog/"
                  className="rounded-xl bg-brass-500 px-5 py-2.5 text-sm font-medium text-night-950 transition-colors hover:bg-brass-400"
                >
                  Log work
                </Link>
              }
            />
          </div>
        ) : (
          <ul className="mt-4 divide-y divide-night-800 rounded-2xl border border-night-700/60 bg-night-900/40">
            {byType.map(([type, units]) => (
              <li key={type} className="flex items-center justify-between gap-4 px-5 py-3.5">
                <span className="text-sm text-cream-200">
                  {WAGE_WORK_TYPE_LABELS[type]}
                </span>
                <span className="font-display text-lg text-cream-50">{units}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {(toolsOut.length > 0 || outstandingLoan > 0) && (
        <section className="mt-8 grid gap-4 sm:grid-cols-2">
          {toolsOut.length > 0 && (
            <div className="rounded-2xl border border-amber-500/40 bg-amber-500/5 p-5">
              <p className="flex items-center gap-2 text-sm font-medium text-amber-300">
                <Wrench size={15} /> Tools you have out
              </p>
              <ul className="mt-2 space-y-1">
                {toolsOut.map((t) => (
                  <li key={t.id} className="text-xs text-cream-400">
                    {t.jobName}
                  </li>
                ))}
              </ul>
              <Link
                href="/admin/tools/"
                className="mt-3 inline-block text-xs text-brass-300 underline-offset-4 hover:underline"
              >
                View the tool log
              </Link>
            </div>
          )}
          {outstandingLoan > 0 && (
            <div className="rounded-2xl border border-night-700/60 bg-night-900/40 p-5">
              <p className="flex items-center gap-2 text-sm font-medium text-cream-200">
                <HandCoins size={15} className="text-brass-400" /> Outstanding advance
              </p>
              <p className="mt-2 font-display text-xl text-cream-50">
                {formatNaira(outstandingLoan)}
              </p>
              <p className="mt-2 text-xs text-cream-500">
                Deducted from your wages until settled.
              </p>
            </div>
          )}
        </section>
      )}
    </div>
  );
}

function Tile({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-3xl border border-night-700/60 bg-night-900/40 p-5">
      <p className="text-xs uppercase tracking-wider text-cream-500">{label}</p>
      <p className="mt-2">{value}</p>
    </div>
  );
}

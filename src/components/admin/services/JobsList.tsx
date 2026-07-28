"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { collection, limit, onSnapshot, orderBy, query } from "firebase/firestore";
import { Loader2, Plus, Search } from "lucide-react";
import { getDb } from "@/lib/firebase";
import { COL } from "@/lib/erp/collections";
import {
  BOARD_TYPE_LABELS,
  JOB_STATUSES,
  JOB_STATUS_LABELS,
  type JobStatus,
} from "@/lib/erp/enums";
import { formatNaira } from "@/lib/erp/money";
import { describeBoards } from "@/lib/erp/serviceJobs";
import { JOB_STATUS_TONE } from "@/lib/erp/statusTone";
import type { BoardBreakdown } from "@/lib/erp/types";
import { StatusPill } from "@/components/admin/ui/StatusPill";
import { Button, EmptyState } from "@/components/admin/ui/Fields";
import { useErpSession } from "@/components/admin/ErpAuthProvider";

interface JobRow {
  id: string;
  jobNumber: string;
  customerName: string;
  status: JobStatus;
  boards: BoardBreakdown;
  totalKobo: number;
  paidKobo: number;
  balanceKobo: number;
  receivedAtMs: number | null;
}

/** Statuses treated as still open, for the default filter. */
const OPEN_STATUSES: JobStatus[] = ["received", "in_progress", "qc", "ready_for_pickup"];

/**
 * Service jobs list.
 *
 * Defaults to open jobs rather than everything: the useful question at the
 * counter is "what is still here", not "what have we ever done". Collected jobs
 * are one click away.
 */
export function JobsList() {
  const session = useErpSession();
  const [rows, setRows] = useState<JobRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [statusFilter, setStatusFilter] = useState<JobStatus | "open" | "all">("open");
  const [term, setTerm] = useState("");

  useEffect(() => {
    // Ordered by receivedAt and capped: a counter list never needs the full
    // history, and an unbounded listener would grow without limit.
    const q = query(
      collection(getDb(), COL.serviceJobs),
      orderBy("receivedAt", "desc"),
      limit(200)
    );
    return onSnapshot(
      q,
      (snap) => {
        setRows(
          snap.docs.map((d) => {
            const data = d.data();
            return {
              id: d.id,
              jobNumber: (data.jobNumber as string) ?? "",
              customerName: (data.customerName as string) ?? "",
              status: (data.status as JobStatus) ?? "received",
              boards: (data.boards as BoardBreakdown) ?? {},
              totalKobo: (data.totalKobo as number) ?? 0,
              paidKobo: (data.paidKobo as number) ?? 0,
              balanceKobo: (data.balanceKobo as number) ?? 0,
              receivedAtMs: data.receivedAt?.toMillis?.() ?? null,
            };
          })
        );
        setLoading(false);
      },
      (err) => {
        setError(err.message);
        setLoading(false);
      }
    );
  }, []);

  const counts = useMemo(() => {
    const c: Partial<Record<JobStatus, number>> = {};
    for (const r of rows) c[r.status] = (c[r.status] ?? 0) + 1;
    return c;
  }, [rows]);

  const visible = useMemo(() => {
    const t = term.trim().toLowerCase();
    return rows.filter((r) => {
      const statusOk =
        statusFilter === "all"
          ? true
          : statusFilter === "open"
            ? OPEN_STATUSES.includes(r.status)
            : r.status === statusFilter;
      if (!statusOk) return false;
      if (!t) return true;
      return (
        r.jobNumber.toLowerCase().includes(t) || r.customerName.toLowerCase().includes(t)
      );
    });
  }, [rows, statusFilter, term]);

  const openValueKobo = useMemo(
    () =>
      rows
        .filter((r) => OPEN_STATUSES.includes(r.status))
        .reduce((sum, r) => sum + r.balanceKobo, 0),
    [rows]
  );

  const canCreate = session.can("job.create");

  return (
    <div className="mx-auto max-w-7xl">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-eyebrow">Services</p>
          <h1 className="text-title mt-3 text-cream-50">Service jobs</h1>
        </div>
        {canCreate && (
          <Link
            href="/admin/jobs/new/"
            className="flex items-center gap-2 rounded-xl bg-brass-500 px-5 py-3 text-sm font-medium text-night-950 transition-colors duration-300 hover:bg-brass-400"
          >
            <Plus size={17} /> New job
          </Link>
        )}
      </header>

      {/* Open-work summary */}
      <div className="mt-8 grid gap-4 sm:grid-cols-3">
        <Tile label="Open jobs" value={String(rows.filter((r) => OPEN_STATUSES.includes(r.status)).length)} />
        <Tile label="Awaiting pickup" value={String(counts.ready_for_pickup ?? 0)} tone="warn" />
        <Tile label="Uncollected value" value={formatNaira(openValueKobo)} />
      </div>

      {/* Filters */}
      <div className="mt-8 flex flex-wrap items-center gap-3">
        <FilterChip
          active={statusFilter === "open"}
          onClick={() => setStatusFilter("open")}
          label="Open"
        />
        {JOB_STATUSES.map((s) => (
          <FilterChip
            key={s}
            active={statusFilter === s}
            onClick={() => setStatusFilter(s)}
            label={`${JOB_STATUS_LABELS[s]}${counts[s] ? ` (${counts[s]})` : ""}`}
          />
        ))}
        <FilterChip
          active={statusFilter === "all"}
          onClick={() => setStatusFilter("all")}
          label="All"
        />

        <div className="relative ml-auto">
          <Search
            size={15}
            aria-hidden
            className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-cream-500"
          />
          <input
            type="search"
            value={term}
            onChange={(e) => setTerm(e.target.value)}
            placeholder="Job number or customer"
            aria-label="Search jobs"
            className="w-56 rounded-xl border border-night-600 bg-night-800/60 py-2.5 pl-9 pr-3 text-sm text-cream-100 placeholder:text-cream-600 focus:border-brass-500 focus:outline-none"
          />
        </div>
      </div>

      {error && (
        <p role="alert" className="mt-6 text-sm text-red-400">
          {error}
        </p>
      )}

      {loading ? (
        <div className="mt-10 flex justify-center py-10">
          <Loader2 className="animate-spin text-brass-400" size={26} aria-label="Loading" />
        </div>
      ) : visible.length === 0 ? (
        <div className="mt-8">
          <EmptyState
            title={rows.length === 0 ? "No jobs yet" : "Nothing matches this filter"}
            hint={
              rows.length === 0
                ? "Create the first job when a customer brings boards in."
                : "Try a different status or clear the search."
            }
            action={
              rows.length === 0 && canCreate ? (
                <Link href="/admin/jobs/new/">
                  <Button>Create the first job</Button>
                </Link>
              ) : undefined
            }
          />
        </div>
      ) : (
        <div className="mt-8 overflow-x-auto rounded-3xl border border-night-700/60">
          <table className="w-full min-w-[54rem] text-left text-sm">
            <thead className="bg-night-900/70 text-xs uppercase tracking-wider text-cream-500">
              <tr>
                <th className="px-5 py-3 font-medium">Job</th>
                <th className="px-5 py-3 font-medium">Customer</th>
                <th className="px-5 py-3 font-medium">Boards</th>
                <th className="px-5 py-3 font-medium">Status</th>
                <th className="px-5 py-3 text-right font-medium">Total</th>
                <th className="px-5 py-3 text-right font-medium">Balance</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-night-800">
              {visible.map((r) => (
                <tr key={r.id} className="transition-colors hover:bg-night-900/40">
                  <td className="px-5 py-4">
                    <Link
                      href={`/admin/jobs/detail/?id=${r.id}`}
                      className="font-medium text-brass-300 underline-offset-4 hover:underline"
                    >
                      {r.jobNumber}
                    </Link>
                    {r.receivedAtMs && (
                      <span className="block text-xs text-cream-500">
                        {new Date(r.receivedAtMs).toLocaleDateString("en-GB", {
                          day: "numeric",
                          month: "short",
                        })}
                      </span>
                    )}
                  </td>
                  <td className="px-5 py-4 text-cream-100">{r.customerName}</td>
                  <td className="px-5 py-4 text-xs text-cream-400">
                    {describeBoards(r.boards, BOARD_TYPE_LABELS)}
                  </td>
                  <td className="px-5 py-4">
                    <StatusPill tone={JOB_STATUS_TONE[r.status]}>
                      {JOB_STATUS_LABELS[r.status]}
                    </StatusPill>
                  </td>
                  <td className="px-5 py-4 text-right text-cream-200">
                    {formatNaira(r.totalKobo)}
                  </td>
                  <td className="px-5 py-4 text-right">
                    <span className={r.balanceKobo > 0 ? "text-amber-300" : "text-emerald-300"}>
                      {formatNaira(r.balanceKobo)}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function Tile({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "warn";
}) {
  return (
    <div className="rounded-3xl border border-night-700/60 bg-night-900/40 p-5">
      <p className="text-xs uppercase tracking-wider text-cream-500">{label}</p>
      <p
        className={`mt-2 font-display text-2xl ${
          tone === "warn" ? "text-amber-300" : "text-cream-50"
        }`}
      >
        {value}
      </p>
    </div>
  );
}

function FilterChip({
  active,
  onClick,
  label,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`cursor-pointer rounded-full border px-4 py-2 text-xs font-medium transition-all duration-300 ${
        active
          ? "border-brass-500 bg-brass-500 text-night-950"
          : "border-night-600 text-cream-300 hover:border-brass-500/60 hover:text-brass-300"
      }`}
    >
      {label}
    </button>
  );
}

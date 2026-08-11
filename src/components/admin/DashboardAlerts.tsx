"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { collection, onSnapshot } from "firebase/firestore";
import { AlertTriangle, ArrowRight, Gauge, Layers, Package } from "lucide-react";
import { getDb } from "@/lib/firebase";
import { COL } from "@/lib/erp/collections";
import { metersDueToday } from "@/lib/erp/ledgers";
import { reconcileBoards } from "@/lib/erp/boards";
import type { BoardReconciliation } from "@/lib/erp/types";
import { useErpSession } from "@/components/admin/ErpAuthProvider";

interface LowStockItem {
  id: string;
  name: string;
  quantityOnHand: number;
  reorderLevel: number;
  unit: string;
}

/**
 * The things somebody has to act on today.
 *
 * Deliberately a short list of *actionable* items, not a status board. Three kinds
 * qualify:
 *
 * - **Meters unread.** A gap in the consumption chain is unrecoverable — nobody can
 *   go back and see what the dial said on Tuesday — so a nudge on the day is the only
 *   thing that keeps the series complete, and a complete series is what makes a
 *   consumption spike visible at all.
 * - **Low stock.** Running out of gum or blades stops the machines. The reorder level
 *   is already on each item; nothing was ever surfacing it.
 * - **Boards held.** Customer property sitting on site, which the workshop is
 *   answerable for.
 *
 * Each block renders only when it has something to say. An alerts panel that is always
 * present becomes furniture, and then the one week it matters nobody reads it.
 */
export function DashboardAlerts() {
  const session = useErpSession();
  const canSeeMeters = session.can("expense.create");
  const canSeeStock = session.can("inventory.view");
  const canSeeJobs = session.can("job.view");

  const [metersDue, setMetersDue] = useState<Array<{ name: string; lastReadMs: number | null }>>([]);
  const [lowStock, setLowStock] = useState<LowStockItem[]>([]);
  const [boards, setBoards] = useState<BoardReconciliation[]>([]);

  useEffect(() => {
    if (!canSeeMeters) return;
    let live = true;
    metersDueToday(getDb())
      .then((due) => {
        if (live) setMetersDue(due);
      })
      .catch(() => {
        // A read failure must not turn a reminder into an error banner.
      });
    return () => {
      live = false;
    };
  }, [canSeeMeters]);

  useEffect(() => {
    if (!canSeeStock) return;
    return onSnapshot(
      collection(getDb(), COL.inventoryCompany),
      (snap) =>
        setLowStock(
          snap.docs
            .filter((d) => {
              const x = d.data();
              // A reorder level of zero means "not tracked", not "reorder always".
              return (
                x.active !== false &&
                (x.reorderLevel ?? 0) > 0 &&
                (x.quantityOnHand ?? 0) <= (x.reorderLevel ?? 0)
              );
            })
            .map((d) => {
              const x = d.data();
              return {
                id: d.id,
                name: x.name ?? "",
                quantityOnHand: x.quantityOnHand ?? 0,
                reorderLevel: x.reorderLevel ?? 0,
                unit: x.unit ?? "unit",
              };
            })
            .sort((a, b) => a.quantityOnHand - b.quantityOnHand)
        ),
      () => {}
    );
  }, [canSeeStock]);

  useEffect(() => {
    if (!canSeeJobs) return;
    let live = true;
    reconcileBoards(getDb())
      .then((r) => {
        if (!live) return;
        // Only customers with boards still held and a job still open. A customer whose
        // work is finished and collected is not something to act on.
        setBoards(
          r.byCustomer.filter((c) => c.remainingBoards > 0 && c.openJobCount > 0).slice(0, 6)
        );
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [canSeeJobs]);

  const nothing =
    metersDue.length === 0 && lowStock.length === 0 && boards.length === 0;
  if (nothing) return null;

  return (
    <section className="mb-8 space-y-3">
      {metersDue.length > 0 && (
        <Alert
          icon={<Gauge size={16} />}
          tone="amber"
          href="/admin/meters/"
          action="Record a reading"
        >
          <strong className="font-medium text-cream-100">
            {metersDue.length === 1
              ? `${metersDue[0].name} has not been read today.`
              : `${metersDue.length} meters have not been read today.`}
          </strong>{" "}
          {metersDue.some((m) => m.lastReadMs === null)
            ? "One has never been read."
            : `Last read ${describeLast(
                Math.max(...metersDue.map((m) => m.lastReadMs ?? 0))
              )}.`}{" "}
          A missed day cannot be recovered later.
        </Alert>
      )}

      {lowStock.length > 0 && (
        <Alert
          icon={<Package size={16} />}
          tone="amber"
          href="/admin/inventory/"
          action="Reorder"
        >
          <strong className="font-medium text-cream-100">
            {lowStock.length} item{lowStock.length === 1 ? "" : "s"} at or below the
            reorder level.
          </strong>{" "}
          {lowStock
            .slice(0, 4)
            .map((i) => `${i.name} (${i.quantityOnHand} ${i.unit})`)
            .join(", ")}
          {lowStock.length > 4 && `, and ${lowStock.length - 4} more`}.
        </Alert>
      )}

      {boards.length > 0 && (
        <Alert
          icon={<Layers size={16} />}
          tone="neutral"
          href="/admin/jobs/"
          action="View jobs"
        >
          <strong className="font-medium text-cream-100">
            Boards still held for {boards.length} customer
            {boards.length === 1 ? "" : "s"}.
          </strong>{" "}
          {boards
            .slice(0, 4)
            .map((c) => `${c.customerName} (${c.remainingBoards})`)
            .join(", ")}
          {boards.length > 4 && `, and ${boards.length - 4} more`}.
        </Alert>
      )}
    </section>
  );
}

function describeLast(ms: number): string {
  if (!ms) return "never";
  const days = Math.floor((Date.now() - ms) / 86_400_000);
  if (days <= 0) return "earlier today";
  if (days === 1) return "yesterday";
  return `${days} days ago`;
}

function Alert({
  icon,
  tone,
  href,
  action,
  children,
}: {
  icon: React.ReactNode;
  tone: "amber" | "neutral";
  href: string;
  action: string;
  children: React.ReactNode;
}) {
  const styles =
    tone === "amber"
      ? "border-amber-500/40 bg-amber-500/5 text-amber-300"
      : "border-night-700/60 bg-night-900/40 text-cream-400";
  return (
    <div
      className={`flex flex-wrap items-start justify-between gap-4 rounded-2xl border px-4 py-3.5 text-sm ${styles}`}
    >
      <p className="flex min-w-0 items-start gap-2.5">
        <span className="mt-0.5 shrink-0">{icon}</span>
        <span className="leading-relaxed text-cream-400">{children}</span>
      </p>
      <Link
        href={href}
        className="flex shrink-0 items-center gap-1.5 text-xs font-medium text-brass-300 transition-colors hover:text-brass-200"
      >
        {action} <ArrowRight size={13} />
      </Link>
    </div>
  );
}

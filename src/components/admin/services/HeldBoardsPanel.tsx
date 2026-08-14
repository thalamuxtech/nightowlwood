"use client";

import { useEffect, useMemo, useState } from "react";
import { collection, onSnapshot, query, where } from "firebase/firestore";
import { CheckCircle2, PackageOpen } from "lucide-react";
import { getDb } from "@/lib/firebase";
import { COL } from "@/lib/erp/collections";
import { BOARD_TYPE_LABELS, type BoardType } from "@/lib/erp/enums";
import { releaseServiceInventory } from "@/lib/erp/inventory";
import { useErpSession } from "@/components/admin/ErpAuthProvider";

interface HeldEntry {
  id: string;
  boardType: BoardType;
  quantity: number;
  description?: string;
  status: "held" | "released";
  receivedAtMs?: number;
  releasedAtMs?: number;
}

/**
 * The customer's own boards, taken in against this job.
 *
 * This is a custody record, not stock: the boards belong to the customer and the workshop is
 * holding them. Which is why it has to be closable — until it was, the only write was the one
 * that took the boards in, so every job ever booked showed its boards as still in our keeping
 * and the "held" figure on the dashboard could only ever climb.
 *
 * Kept separate from the derived board reconciliation on the services screen. That one is the
 * arithmetic of received-against-cut and is deliberately stored nowhere; this one is the signed
 * record of what came in and when it went back.
 */
export function HeldBoardsPanel({
  jobId,
  customerName,
}: {
  jobId: string;
  customerName: string;
}) {
  const session = useErpSession();
  // Signing boards back out is the same trust as editing the job they came in against.
  const canRelease = session.can("job.edit");

  const [entries, setEntries] = useState<HeldEntry[]>([]);
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState("");

  const actor = useMemo(
    () => ({
      uid: session.user?.uid ?? "",
      email: session.user?.email ?? "",
      role: session.role ?? "manager",
    }),
    [session.user, session.role]
  );

  useEffect(() => {
    if (!jobId) return;
    return onSnapshot(
      query(collection(getDb(), COL.inventoryService), where("jobId", "==", jobId)),
      (snap) => {
        setEntries(
          snap.docs
            .map((d) => {
              const x = d.data();
              return {
                id: d.id,
                boardType: (x.boardType ?? "other") as BoardType,
                quantity: x.quantity ?? 0,
                description: x.description ?? undefined,
                status: (x.status ?? "held") as HeldEntry["status"],
                receivedAtMs: x.receivedAt?.toMillis?.(),
                releasedAtMs: x.releasedAt?.toMillis?.(),
              };
            })
            // Still-held first: those are the ones needing a decision.
            .sort((a, b) => Number(a.status === "released") - Number(b.status === "released"))
        );
      },
      (e) => setError(e.message)
    );
  }, [jobId]);

  async function release(entry: HeldEntry) {
    setBusyId(entry.id);
    setError("");
    try {
      await releaseServiceInventory(getDb(), actor, entry.id, customerName);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not sign those boards back out.");
    } finally {
      setBusyId("");
    }
  }

  // Nothing was taken in against this job, so there is nothing to account for.
  if (entries.length === 0) return null;

  const held = entries.filter((e) => e.status === "held");

  return (
    <section className="mt-8 rounded-3xl border border-night-700/60 bg-night-900/30 p-6">
      <h2 className="flex items-center gap-2 font-display text-lg text-cream-100">
        <PackageOpen size={18} className="text-brass-400" /> {customerName}&apos;s boards
      </h2>
      <p className="mt-1 text-sm text-cream-500">
        {held.length > 0
          ? "Still in the workshop. Sign them out when the customer takes them away."
          : "All signed back out."}
      </p>

      {error && (
        <p role="alert" className="mt-3 text-sm text-red-400">
          {error}
        </p>
      )}

      <ul className="mt-4 space-y-2">
        {entries.map((e) => (
          <li
            key={e.id}
            className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-night-700/60 bg-night-950/40 px-4 py-3"
          >
            <div>
              <p className="text-sm text-cream-200">
                {e.quantity} × {BOARD_TYPE_LABELS[e.boardType] ?? e.boardType}
                {e.description ? ` · ${e.description}` : ""}
              </p>
              <p className="mt-0.5 text-xs text-cream-500">
                {e.status === "released" ? (
                  <span className="text-emerald-400/90">
                    Signed out
                    {e.releasedAtMs
                      ? ` ${new Date(e.releasedAtMs).toLocaleDateString("en-GB", {
                          day: "numeric",
                          month: "short",
                        })}`
                      : ""}
                  </span>
                ) : e.receivedAtMs ? (
                  `Taken in ${new Date(e.receivedAtMs).toLocaleDateString("en-GB", {
                    day: "numeric",
                    month: "short",
                  })}`
                ) : (
                  "In the workshop"
                )}
              </p>
            </div>

            {e.status === "held" && canRelease && (
              <button
                type="button"
                onClick={() => release(e)}
                disabled={busyId === e.id}
                className="cursor-pointer rounded-lg border border-night-600 px-3 py-1.5 text-xs text-cream-200 transition-all duration-300 hover:border-brass-500/60 hover:text-brass-300 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {busyId === e.id ? "Signing out…" : "Sign out to customer"}
              </button>
            )}
            {e.status === "released" && (
              <CheckCircle2 size={16} className="text-emerald-400/70" />
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

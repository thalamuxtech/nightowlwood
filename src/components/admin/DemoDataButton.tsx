"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Database, Loader2, Trash2, TriangleAlert, X } from "lucide-react";
import { getDb } from "@/lib/firebase";
import { clearDemoData, countDemoData, seedDemoData } from "@/lib/erp/demoData";
import { Button } from "@/components/admin/ui/Fields";
import { useErpSession } from "@/components/admin/ErpAuthProvider";

/**
 * Loads and clears the demo dataset. Admin only.
 *
 * Clearing is destructive, so it asks for confirmation and states the exact
 * count first. It only ever removes documents flagged `isDemo`, which is why it
 * is safe to expose in the header at all: it cannot reach real records.
 */
export function DemoDataButton() {
  const session = useErpSession();
  const [open, setOpen] = useState(false);
  const [count, setCount] = useState<number | null>(null);
  const [busy, setBusy] = useState<"seed" | "clear" | null>(null);
  const [step, setStep] = useState("");
  const [result, setResult] = useState("");
  const [error, setError] = useState("");
  const [confirming, setConfirming] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  /*
   * Super admin only, and judged on the real role.
   *
   * Seeding writes across nearly forty collections and clearing deletes everything it wrote, so
   * it is the most destructive control in the application — one mis-click on live data and a
   * workshop's records are gone. It also has to survive the role switcher: judged on the acting
   * role, the button would vanish the moment a super admin switched to admin to check something,
   * and reappear when they switched back, which reads as a bug.
   *
   * This was `session.role === "admin"` — an exact string match that a super admin would have
   * *failed*, hiding the control from the only person now meant to have it.
   */
  const isAdmin = session.realRole === "super_admin";
  /** Drives the trigger label: the action offered depends on what is loaded. */
  const loaded = (count ?? 0) > 0;

  // Counted on mount rather than on open, so the trigger can say whether demo
  // data is already loaded before the panel is ever expanded.
  useEffect(() => {
    if (!isAdmin) return;
    countDemoData(getDb())
      .then(setCount)
      .catch(() => setCount(null));
  }, [isAdmin, result]);

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setOpen(false);
        setConfirming(false);
      }
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  async function seed() {
    setBusy("seed");
    setError("");
    setResult("");
    try {
      const { written } = await seedDemoData(getDb(), session.user?.uid ?? "", setStep);
      setResult(`Loaded ${written} demo records.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load demo data.");
    } finally {
      setBusy(null);
      setStep("");
    }
  }

  async function clear() {
    setBusy("clear");
    setError("");
    setResult("");
    setConfirming(false);
    try {
      const { deleted } = await clearDemoData(getDb(), setStep);
      setResult(`Removed ${deleted} demo records.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not clear demo data.");
    } finally {
      setBusy(null);
      setStep("");
    }
  }

  if (!isAdmin) return null;

  return (
    <div ref={panelRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-label={loaded ? "Demo data loaded" : "Load demo data"}
        title={loaded ? `${count} demo records loaded` : "Load demo data"}
        className={`flex h-9 cursor-pointer items-center gap-2 rounded-xl border px-3 text-xs transition-colors ${
          loaded
            ? "border-brass-500/50 bg-brass-500/10 text-brass-300 hover:border-brass-500"
            : "border-night-700/60 bg-night-900/70 text-cream-300 hover:border-brass-500/60 hover:text-brass-300"
        }`}
      >
        {busy ? (
          <Loader2 size={14} className="animate-spin" />
        ) : loaded ? (
          <Trash2 size={14} />
        ) : (
          <Database size={14} />
        )}
        <span className="hidden sm:inline">{loaded ? "Clear demo" : "Demo data"}</span>
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -8, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, scale: 0.98 }}
            transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
            className="absolute right-0 z-50 mt-2 w-80 rounded-2xl border border-night-700/60 bg-night-900 p-5 shadow-card"
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="font-display text-base text-cream-100">Demo data</h2>
                <p className="mt-1 text-xs leading-relaxed text-cream-500">
                  Sample customers, staff, jobs, work logs, projects, expenses,
                  suppliers and inventory, spread over six weeks so the charts and
                  wage runs have something real to show.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close"
                className="cursor-pointer text-cream-500 transition-colors hover:text-cream-200"
              >
                <X size={16} />
              </button>
            </div>

            <p className="mt-3 text-xs text-cream-600">
              Does not touch the work gallery, users and roles, blog or submissions.
            </p>

            {count !== null && (
              <p className="mt-3 rounded-lg border border-night-700/60 bg-night-950/50 px-3 py-2 text-xs text-cream-400">
                {count === 0
                  ? "No demo records present."
                  : `${count} demo records currently loaded.`}
              </p>
            )}

            {busy && step && (
              <p className="mt-3 flex items-center gap-2 text-xs text-brass-300">
                <Loader2 size={13} className="animate-spin" /> {step}
              </p>
            )}

            {result && <p className="mt-3 text-xs text-emerald-300">{result}</p>}
            {error && <p className="mt-3 text-xs text-red-400">{error}</p>}

            <div className="mt-4 flex flex-wrap gap-2">
              <Button onClick={seed} busy={busy === "seed"} disabled={busy !== null}>
                Load demo data
              </Button>
              {!confirming ? (
                <Button
                  variant="secondary"
                  onClick={() => setConfirming(true)}
                  disabled={busy !== null || count === 0}
                >
                  <span className="flex items-center gap-1.5">
                    <Trash2 size={13} /> Clear
                  </span>
                </Button>
              ) : (
                <Button variant="danger" onClick={clear} busy={busy === "clear"}>
                  <span className="flex items-center gap-1.5">
                    <TriangleAlert size={13} /> Delete {count} records
                  </span>
                </Button>
              )}
            </div>

            {count !== null && count > 0 && !confirming && (
              <p className="mt-3 text-[0.65rem] leading-relaxed text-cream-600">
                Loading again adds a second set rather than replacing the first.
                Clear before reloading if you want a clean slate.
              </p>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

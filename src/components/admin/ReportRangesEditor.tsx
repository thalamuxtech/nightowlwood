"use client";

import { useEffect, useState } from "react";
import { doc, onSnapshot, serverTimestamp, setDoc } from "firebase/firestore";
import { CalendarRange, Loader2, Plus, RotateCcw, Trash2 } from "lucide-react";
import { getDb } from "@/lib/firebase";
import { COL } from "@/lib/erp/collections";
import {
  DEFAULT_RANGES,
  rangeKeyFrom,
  validateRange,
  type ReportRange,
} from "@/lib/erp/ranges";
import { writeAudit } from "@/lib/erp/audit";
import { Button, NumberField, TextField } from "@/components/admin/ui/Fields";
import { useErpSession } from "@/components/admin/ErpAuthProvider";
import { roleAtLeast } from "@/lib/erp/enums";

const SETTINGS_DOC_ID = "reporting";

/**
 * Reporting ranges. Admin only.
 *
 * The dashboard used to hardcode five windows ending at 12 months, which caps what
 * the business can look at as records accumulate: at three years there was no way
 * to see the whole picture. Ranges are now editable, and "All time" is present
 * from the outset because its absence is invisible, a chart looks complete while
 * quietly excluding the oldest records.
 */
export function ReportRangesEditor() {
  const session = useErpSession();
  // Admin or above: an exact match on "admin" would have excluded the super admin.
  const isAdmin = roleAtLeast(session.role, "admin");

  const [ranges, setRanges] = useState<ReportRange[]>(DEFAULT_RANGES);
  const [loaded, setLoaded] = useState(false);
  const [label, setLabel] = useState("");
  const [days, setDays] = useState("");
  const [allTime, setAllTime] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    return onSnapshot(
      doc(getDb(), COL.settings, SETTINGS_DOC_ID),
      (snap) => {
        const saved = snap.data()?.ranges as ReportRange[] | undefined;
        if (saved?.length) setRanges(saved);
        setLoaded(true);
      },
      () => setLoaded(true)
    );
  }, []);

  async function persist(next: ReportRange[], summary: string) {
    setBusy(true);
    setError("");
    try {
      await setDoc(
        doc(getDb(), COL.settings, SETTINGS_DOC_ID),
        { ranges: next, updatedAt: serverTimestamp(), updatedBy: session.user?.uid ?? "" },
        { merge: true }
      );
      await writeAudit(getDb(), {
        actor: {
          uid: session.user?.uid ?? "",
          email: session.user?.email ?? "",
          role: "admin",
        },
        action: "settings_change",
        collectionName: COL.settings,
        docId: SETTINGS_DOC_ID,
        summary,
        after: { count: next.length },
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 4000);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save the ranges.");
    } finally {
      setBusy(false);
    }
  }

  async function add() {
    const parsed = allTime ? null : Number(days);
    const problem = validateRange({ label, days: parsed });
    if (problem) {
      setError(problem);
      return;
    }
    const next = [
      ...ranges,
      { key: rangeKeyFrom(label, ranges), label: label.trim(), days: parsed },
    ];
    // Shortest first, with all time last, so the chips read as a progression.
    next.sort((a, b) => (a.days ?? Infinity) - (b.days ?? Infinity));
    await persist(next, `Added reporting range "${label.trim()}"`);
    setLabel("");
    setDays("");
    setAllTime(false);
  }

  async function remove(key: string) {
    if (ranges.length <= 1) {
      setError("Keep at least one range, or the dashboard has nothing to show.");
      return;
    }
    const target = ranges.find((r) => r.key === key);
    await persist(
      ranges.filter((r) => r.key !== key),
      `Removed reporting range "${target?.label ?? key}"`
    );
  }

  if (!isAdmin) return null;

  return (
    <section className="rounded-3xl border border-night-700/60 bg-night-900/40 p-6">
      <h2 className="flex items-center gap-2 font-display text-lg text-cream-100">
        <CalendarRange size={18} className="text-brass-400" /> Dashboard date ranges
      </h2>
      <p className="mt-2 text-sm text-cream-400">
        The windows offered on the dashboard. Add longer ones as the records build
        up, so a year-on-year view stays possible.
      </p>

      {!loaded ? (
        <div className="mt-5 flex justify-center py-6">
          <Loader2 className="animate-spin text-brass-400" size={22} aria-label="Loading" />
        </div>
      ) : (
        <ul className="mt-5 flex flex-wrap gap-2">
          {ranges.map((r) => (
            <li
              key={r.key}
              className="flex items-center gap-2 rounded-full border border-night-600 bg-night-800/60 pl-4 pr-2 py-1.5 text-xs"
            >
              <span className="text-cream-200">{r.label}</span>
              <span className="text-cream-600">
                {r.days === null ? "all" : `${r.days}d`}
              </span>
              <button
                type="button"
                onClick={() => remove(r.key)}
                disabled={busy}
                aria-label={`Remove ${r.label}`}
                className="cursor-pointer text-cream-600 transition-colors hover:text-red-400 disabled:opacity-40"
              >
                <Trash2 size={12} />
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-6 grid gap-4 sm:grid-cols-[1fr_8rem_auto] sm:items-end">
        <TextField
          id="range-label"
          label="Label"
          value={label}
          onChange={setLabel}
          placeholder="3 years"
        />
        <NumberField
          id="range-days"
          label="Days back"
          value={allTime ? "" : days}
          onChange={setDays}
          disabled={allTime}
          hint={allTime ? "all time" : undefined}
        />
        <Button onClick={add} busy={busy}>
          <span className="flex items-center gap-2">
            <Plus size={15} /> Add
          </span>
        </Button>
      </div>

      <label className="mt-3 flex cursor-pointer items-center gap-2.5 text-sm text-cream-300">
        <input
          type="checkbox"
          checked={allTime}
          onChange={(e) => setAllTime(e.target.checked)}
          className="h-4 w-4 cursor-pointer accent-brass-500"
        />
        Everything on record, with no cut-off
      </label>

      {error && (
        <p role="alert" className="mt-3 text-sm text-red-400">
          {error}
        </p>
      )}
      {saved && (
        <p role="status" className="mt-3 text-sm text-emerald-300">
          Saved.
        </p>
      )}

      {JSON.stringify(ranges) !== JSON.stringify(DEFAULT_RANGES) && (
        <button
          type="button"
          onClick={() => persist(DEFAULT_RANGES, "Reset reporting ranges to defaults")}
          disabled={busy}
          className="mt-4 flex cursor-pointer items-center gap-2 text-xs text-cream-400 transition-colors hover:text-brass-300 disabled:opacity-40"
        >
          <RotateCcw size={13} /> Reset to defaults
        </button>
      )}
    </section>
  );
}

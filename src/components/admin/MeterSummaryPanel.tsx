"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import { collection, onSnapshot, orderBy, query, Timestamp, where } from "firebase/firestore";
import { ArrowRight, Gauge } from "lucide-react";
import { getDb } from "@/lib/firebase";
import { COL } from "@/lib/erp/collections";
import { formatNaira } from "@/lib/erp/money";

interface Reading {
  id: string;
  meterName: string;
  dateMs: number | null;
  reading: number;
  billedUnits: number;
  amountKobo: number;
}

interface MeterLine {
  name: string;
  /** Units billed across the window, which is what the cost is charged on. */
  units: number;
  amountKobo: number;
  readingCount: number;
  latestReading: number;
  latestAtMs: number | null;
}

/**
 * Power consumption over the selected window, per meter.
 *
 * Metered power is the one cost that never reaches the expense ledger — `profit.ts` adds it
 * separately and says so — which meant it was also absent from the dashboard. A workshop whose
 * machines are its main cost could not see that cost on the screen it opens on, and diesel and
 * power together are usually the second line after wages.
 *
 * Per meter rather than one total because the meters answer different questions: the workshop
 * dial rises with cutting, the office dial should be roughly flat, and a flat workshop dial with
 * a busy week behind it means somebody has been running the generator instead.
 */
export function MeterSummaryPanel({
  since,
  rangeLabel,
}: {
  /** Epoch ms the dashboard's range starts at; 0 for all time. */
  since: number;
  rangeLabel: string;
}) {
  const [readings, setReadings] = useState<Reading[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const ref = collection(getDb(), COL.meterReadings);
    const q =
      since > 0
        ? query(ref, where("date", ">=", Timestamp.fromMillis(since)), orderBy("date", "desc"))
        : query(ref, orderBy("date", "desc"));
    return onSnapshot(
      q,
      (snap) => {
        setReadings(
          snap.docs.map((d) => {
            const x = d.data();
            return {
              id: d.id,
              meterName: x.meterName ?? "Unnamed meter",
              dateMs: x.date?.toMillis?.() ?? null,
              reading: x.reading ?? 0,
              /*
               * Billed units, falling back to the raw dial difference.
               *
               * Older readings predate `billedUnits` and carry no conversion factor, where the
               * dial already read in the billed unit — so `actualConsumed` is the right figure
               * for them rather than zero, which would have quietly shrunk the history.
               */
              billedUnits: x.billedUnits ?? x.actualConsumed ?? 0,
              amountKobo: x.amountKobo ?? 0,
            };
          })
        );
        setLoading(false);
      },
      () => setLoading(false)
    );
  }, [since]);

  const lines = useMemo(() => {
    const byMeter = new Map<string, MeterLine>();
    for (const r of readings) {
      const existing = byMeter.get(r.meterName);
      if (!existing) {
        byMeter.set(r.meterName, {
          name: r.meterName,
          units: r.billedUnits,
          amountKobo: r.amountKobo,
          readingCount: 1,
          latestReading: r.reading,
          latestAtMs: r.dateMs,
        });
        continue;
      }
      existing.units += r.billedUnits;
      existing.amountKobo += r.amountKobo;
      existing.readingCount += 1;
      // The query is newest-first, so the first row seen for a meter is its latest — but a null
      // date sorts unpredictably, so the comparison is explicit rather than assumed.
      if ((r.dateMs ?? 0) > (existing.latestAtMs ?? 0)) {
        existing.latestReading = r.reading;
        existing.latestAtMs = r.dateMs;
      }
    }
    return [...byMeter.values()].sort((a, b) => b.amountKobo - a.amountKobo);
  }, [readings]);

  const totalKobo = lines.reduce((s, l) => s + l.amountKobo, 0);
  const totalUnits = lines.reduce((s, l) => s + l.units, 0);

  return (
    <motion.section
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, delay: 0.05 }}
      className="mt-6 rounded-3xl border border-night-700/60 bg-night-900/30 p-6"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 font-display text-lg text-cream-100">
            <Gauge size={18} className="text-brass-400" /> Power meters
          </h2>
          <p className="mt-1 text-sm text-cream-500">
            {rangeLabel}. Charged on billed units, not the raw dial.
          </p>
        </div>
        <Link
          href="/admin/meters/"
          className="inline-flex items-center gap-1.5 text-sm text-brass-300 transition-colors duration-200 hover:text-brass-200"
        >
          Readings <ArrowRight size={14} />
        </Link>
      </div>

      {loading ? (
        <p className="mt-5 text-sm text-cream-500">Loading readings…</p>
      ) : lines.length === 0 ? (
        <p className="mt-5 text-sm text-cream-500">
          No readings in this period. Metered power is not in the expense ledger, so until a
          reading is entered this cost is missing from the profit report as well.
        </p>
      ) : (
        <>
          <div className="mt-5 grid gap-3 sm:grid-cols-2">
            {lines.map((l) => (
              <div
                key={l.name}
                className="rounded-2xl border border-night-700/60 bg-night-950/40 px-4 py-3"
              >
                <div className="flex items-baseline justify-between gap-3">
                  <p className="truncate text-sm text-cream-200">{l.name}</p>
                  <p className="shrink-0 font-display text-base text-cream-100">
                    {formatNaira(l.amountKobo)}
                  </p>
                </div>
                <p className="mt-1 text-xs text-cream-500">
                  {l.units.toLocaleString("en-NG")} units over {l.readingCount} reading
                  {l.readingCount === 1 ? "" : "s"}
                </p>
                <p className="mt-0.5 text-xs text-cream-600">
                  Dial at {l.latestReading.toLocaleString("en-NG")}
                  {l.latestAtMs
                    ? ` on ${new Date(l.latestAtMs).toLocaleDateString("en-GB", {
                        day: "numeric",
                        month: "short",
                      })}`
                    : ""}
                </p>
              </div>
            ))}
          </div>

          {/* Only worth a total line when there is more than one meter to add up. */}
          {lines.length > 1 && (
            <div className="mt-4 flex flex-wrap items-baseline justify-between gap-2 border-t border-night-700/60 pt-3">
              <p className="text-sm text-cream-400">
                {lines.length} meters · {totalUnits.toLocaleString("en-NG")} units
              </p>
              <p className="font-display text-lg text-cream-100">{formatNaira(totalKobo)}</p>
            </div>
          )}
        </>
      )}
    </motion.section>
  );
}

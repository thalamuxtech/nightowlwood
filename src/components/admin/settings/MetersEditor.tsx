"use client";

import { useEffect, useState } from "react";
import { doc, getDoc, setDoc } from "firebase/firestore";
import { CheckCircle2, Gauge, Plus, ShieldAlert, Trash2 } from "lucide-react";
import { getDb } from "@/lib/firebase";
import { COL } from "@/lib/erp/collections";
import { formatNaira, toKobo, toNaira } from "@/lib/erp/money";
import {
  DEFAULT_METER_CONVERSION_FACTOR,
  DEFAULT_UTILITY_SETTINGS,
  SETTINGS_DOC,
  type MeterConfig,
} from "@/lib/erp/settings";
import {
  Button,
  CheckboxField,
  NumberField,
  TextField,
} from "@/components/admin/ui/Fields";

/**
 * Meter configuration.
 *
 * Three things were previously hardcoded and are the reason power costs could not
 * be trusted: the tariff, whether the dial reading needs scaling before the tariff
 * applies, and what the very first reading should be measured against.
 *
 * The last is the least obvious and the most consequential. Without an opening
 * reading the first entry on a meter has no predecessor, so it is recorded as zero
 * consumption and that period's electricity is simply never billed. Setting the
 * dial value as at the day recording started makes it chargeable like any other.
 */

/** A meter as edited: naira in the boxes, kobo in the document. */
interface Draft {
  name: string;
  rateNaira: string;
  useConversion: boolean;
  conversionFactor: string;
  openingReading: string;
  active: boolean;
}

function toDraft(m: MeterConfig): Draft {
  return {
    name: m.name,
    rateNaira: String(toNaira(m.ratePerUnitKobo)),
    useConversion: m.useConversion === true,
    conversionFactor: String(m.conversionFactor ?? DEFAULT_METER_CONVERSION_FACTOR),
    openingReading: m.openingReading === undefined ? "" : String(m.openingReading),
    active: m.active !== false,
  };
}

export function MetersEditor() {
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    getDoc(doc(getDb(), COL.settings, SETTINGS_DOC.utility))
      .then((snap) => {
        const meters = snap.data()?.meters as MeterConfig[] | undefined;
        setDrafts((meters?.length ? meters : DEFAULT_UTILITY_SETTINGS.meters).map(toDraft));
      })
      .catch(() => setError("Could not load the meter settings."))
      .finally(() => setLoading(false));
  }, []);

  function patch(index: number, next: Partial<Draft>) {
    setDrafts((prev) => prev.map((d, i) => (i === index ? { ...d, ...next } : d)));
  }

  async function save() {
    setError("");

    const named = drafts.filter((d) => d.name.trim() !== "");
    if (named.length === 0) {
      setError("Give at least one meter a name.");
      return;
    }
    // Readings are keyed by meter *name*, so two meters sharing one would have
    // their consumption chains interleaved into nonsense.
    const names = named.map((d) => d.name.trim().toLowerCase());
    if (new Set(names).size !== names.length) {
      setError("Two meters have the same name. Each name must be unique.");
      return;
    }
    for (const d of named) {
      if (d.useConversion && !(Number(d.conversionFactor) > 0)) {
        setError(`Set a conversion factor above zero for ${d.name.trim()}, or turn the conversion off.`);
        return;
      }
    }

    setSaving(true);
    try {
      const meters: MeterConfig[] = named.map((d) => ({
        name: d.name.trim(),
        ratePerUnitKobo: toKobo(Number(d.rateNaira) || 0),
        useConversion: d.useConversion,
        conversionFactor: Number(d.conversionFactor) || DEFAULT_METER_CONVERSION_FACTOR,
        // Omitted rather than zeroed when left blank: zero is a legitimate opening
        // reading for a brand-new meter, so it must stay distinguishable from
        // "not configured", which is what suppresses the first-reading charge.
        ...(d.openingReading.trim() === ""
          ? {}
          : { openingReading: Number(d.openingReading) || 0 }),
        active: d.active,
      }));

      await setDoc(
        doc(getDb(), COL.settings, SETTINGS_DOC.utility),
        { meters },
        { merge: true }
      );
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch {
      setError("Save failed. Check permissions and try again.");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <section className="rounded-3xl border border-night-700/60 bg-night-900/40 p-6">
        <p className="text-sm text-cream-500">Loading meters…</p>
      </section>
    );
  }

  return (
    <section className="rounded-3xl border border-night-700/60 bg-night-900/40 p-6">
      <header>
        <h2 className="flex items-center gap-2 font-display text-lg text-cream-100">
          <Gauge size={18} className="text-brass-400" /> Power meters
        </h2>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-cream-400">
          A reading costs{" "}
          <span className="text-cream-200">
            (this reading − the one before) × conversion × rate
          </span>
          . The rate is per billed unit, so where a conversion is in force the rate
          is what one converted unit costs.
        </p>
      </header>

      {error && (
        <p
          role="alert"
          className="mt-5 flex items-start gap-2 rounded-xl border border-red-500/30 bg-red-500/5 px-4 py-3 text-sm text-red-400"
        >
          <ShieldAlert size={16} className="mt-0.5 shrink-0" /> {error}
        </p>
      )}

      <div className="mt-6 space-y-5">
        {drafts.map((d, i) => {
          const rateKobo = toKobo(Number(d.rateNaira) || 0);
          const factor = d.useConversion
            ? Number(d.conversionFactor) || DEFAULT_METER_CONVERSION_FACTOR
            : 1;
          return (
            <div
              key={i}
              className="rounded-2xl border border-night-700/60 bg-night-950/30 p-5"
            >
              <div className="grid gap-4 sm:grid-cols-2">
                <TextField
                  id={`meter-name-${i}`}
                  label="Meter name"
                  value={d.name}
                  onChange={(v) => patch(i, { name: v })}
                  placeholder="e.g. Shasan"
                />
                <NumberField
                  id={`meter-rate-${i}`}
                  label="Rate per billed unit (₦)"
                  value={d.rateNaira}
                  onChange={(v) => patch(i, { rateNaira: v })}
                />
                <NumberField
                  id={`meter-opening-${i}`}
                  label="Opening reading"
                  value={d.openingReading}
                  onChange={(v) => patch(i, { openingReading: v })}
                  hint="what the dial read when recording began"
                />
                <NumberField
                  id={`meter-factor-${i}`}
                  label="Conversion factor"
                  value={d.conversionFactor}
                  onChange={(v) => patch(i, { conversionFactor: v })}
                  disabled={!d.useConversion}
                />
              </div>

              <div className="mt-4 flex flex-wrap items-center gap-6">
                <CheckboxField
                  id={`meter-conv-${i}`}
                  label={`Multiply units by the conversion factor`}
                  checked={d.useConversion}
                  onChange={(v) => patch(i, { useConversion: v })}
                />
                <CheckboxField
                  id={`meter-active-${i}`}
                  label="In use"
                  checked={d.active}
                  onChange={(v) => patch(i, { active: v })}
                />
                <button
                  type="button"
                  aria-label={`Remove ${d.name || "this meter"}`}
                  onClick={() => setDrafts((prev) => prev.filter((_, x) => x !== i))}
                  className="ml-auto flex cursor-pointer items-center gap-1.5 text-xs text-cream-500 transition-colors hover:text-red-400"
                >
                  <Trash2 size={13} /> Remove
                </button>
              </div>

              {/* A worked example, because the interaction between the factor and
                  the rate is the part that gets set up wrongly: it makes clear
                  that the rate is per *converted* unit, not per dial unit. */}
              <p className="mt-4 border-t border-night-800 pt-3 text-xs text-cream-500">
                One dial unit here bills as{" "}
                <span className="text-cream-300">
                  {factor === 1 ? "1 unit" : `${factor} units`}
                </span>{" "}
                and costs{" "}
                <span className="text-cream-300">
                  {formatNaira(Math.round(rateKobo * factor))}
                </span>
                .
                {!d.openingReading.trim() &&
                  " No opening reading is set, so the first entry on this meter will not be charged."}
              </p>
            </div>
          );
        })}
      </div>

      <div className="mt-6 flex flex-wrap items-center gap-4">
        <Button onClick={save} busy={saving}>
          Save meters
        </Button>
        <Button
          variant="secondary"
          onClick={() =>
            setDrafts((prev) => [
              ...prev,
              {
                name: "",
                rateNaira: "0",
                useConversion: false,
                conversionFactor: String(DEFAULT_METER_CONVERSION_FACTOR),
                openingReading: "",
                active: true,
              },
            ])
          }
        >
          <span className="flex items-center gap-1.5">
            <Plus size={14} /> Add a meter
          </span>
        </Button>
        {saved && (
          <span
            role="status"
            className="inline-flex items-center gap-1.5 text-sm text-emerald-400"
          >
            <CheckCircle2 size={16} /> Saved
          </span>
        )}
      </div>

      <p className="mt-4 text-xs leading-relaxed text-cream-600">
        Changing a rate or a factor affects new readings only. Readings already
        recorded keep the terms they were billed under, so a tariff rise cannot
        restate a bill that has been paid. Use{" "}
        <span className="text-cream-400">Recompute chain</span> on the Power meters
        screen after correcting an opening reading.
      </p>
    </section>
  );
}

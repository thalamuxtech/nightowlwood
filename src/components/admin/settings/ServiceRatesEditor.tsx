"use client";

import { useEffect, useMemo, useState } from "react";
import { doc, getDoc, setDoc } from "firebase/firestore";
import { CheckCircle2, Hammer, ShieldAlert } from "lucide-react";
import { getDb } from "@/lib/firebase";
import { COL } from "@/lib/erp/collections";
import { SERVICE_TYPES, SERVICE_TYPE_LABELS, type ServiceType } from "@/lib/erp/enums";
import { formatNaira, toKobo, toNaira } from "@/lib/erp/money";
import {
  DEFAULT_SERVICE_RATE_CARD,
  SETTINGS_DOC,
  type ServiceRateCardEntry,
  type ServiceRateCardSettings,
} from "@/lib/erp/settings";
import { Button, CheckboxField, NumberField } from "@/components/admin/ui/Fields";

/**
 * Suggested prices for service work.
 *
 * These pre-fill a new job line — the operator can always type over them, which is the point:
 * the card is a starting point rather than a rule. The seeded figures came from the modal
 * prices across 363 historical jobs, and where the observed spread is wide it is shown next to
 * the field, because a single "correct" price for cutting and edging does not exist.
 *
 * Read by the job intake form and, until now, editable nowhere. A price list that can only be
 * changed by editing TypeScript is a price list that goes stale.
 */
export function ServiceRatesEditor() {
  const [card, setCard] = useState<ServiceRateCardSettings>(DEFAULT_SERVICE_RATE_CARD);
  /** Naira strings while editing, so a half-typed figure is not coerced to zero. */
  const [naira, setNaira] = useState<Record<string, string>>({});
  const [autofill, setAutofill] = useState(DEFAULT_SERVICE_RATE_CARD.autofillEnabled);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    getDoc(doc(getDb(), COL.settings, SETTINGS_DOC.serviceRateCard))
      .then((snap) => {
        const loaded = snap.exists()
          ? { ...DEFAULT_SERVICE_RATE_CARD, ...(snap.data() as ServiceRateCardSettings) }
          : DEFAULT_SERVICE_RATE_CARD;
        setCard(loaded);
        setAutofill(loaded.autofillEnabled);
        const seeded: Record<string, string> = {};
        for (const entry of loaded.entries) {
          seeded[entry.serviceType] = String(toNaira(entry.defaultPriceKobo));
        }
        setNaira(seeded);
      })
      .catch(() => setError("Could not load the service rates."))
      .finally(() => setLoading(false));
  }, []);

  /** Existing entries by type, so notes and observed ranges survive an edit to the price. */
  const byType = useMemo(() => {
    const map = new Map<string, ServiceRateCardEntry>();
    for (const e of card.entries) map.set(e.serviceType, e);
    return map;
  }, [card.entries]);

  async function save() {
    setError("");

    /*
     * Rebuilt from the enum rather than from the loaded entries.
     *
     * That means a service type added to the codebase since the card was last saved gains a
     * row here instead of being invisible for ever. A type with an empty box is dropped
     * rather than saved as zero — a zero suggested price would silently give the work away
     * when it autofilled.
     */
    const entries: ServiceRateCardEntry[] = [];
    for (const t of SERVICE_TYPES) {
      const raw = (naira[t] ?? "").trim();
      if (!raw) continue;
      const value = Number(raw);
      if (!Number.isFinite(value) || value < 0) {
        setError(`${SERVICE_TYPE_LABELS[t]} has a price that is not a number.`);
        return;
      }
      if (value === 0) continue;
      const existing = byType.get(t);
      entries.push({
        serviceType: t,
        defaultPriceKobo: toKobo(value),
        // Preserved: the observed range and note are historical context, not something this
        // form collects, and blanking them would throw away the reason a price is what it is.
        ...(existing?.observedRange ? { observedRange: existing.observedRange } : {}),
        ...(existing?.note ? { note: existing.note } : {}),
      });
    }

    if (entries.length === 0) {
      setError("Set at least one price, or the card has nothing to suggest.");
      return;
    }

    setSaving(true);
    try {
      const next: ServiceRateCardSettings = { autofillEnabled: autofill, entries };
      await setDoc(doc(getDb(), COL.settings, SETTINGS_DOC.serviceRateCard), next, {
        merge: true,
      });
      setCard(next);
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
        <p className="text-sm text-cream-500">Loading service rates…</p>
      </section>
    );
  }

  return (
    <section className="rounded-3xl border border-night-700/60 bg-night-900/40 p-6">
      <header>
        <h2 className="flex items-center gap-2 font-display text-lg text-cream-100">
          <Hammer size={18} className="text-brass-400" /> Service prices
        </h2>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-cream-400">
          What a new job line is pre-filled with. Always overridable on the job itself — this is
          a starting point, not a fixed tariff. Leave a box empty to stop suggesting a price for
          that service.
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

      <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {SERVICE_TYPES.map((t) => {
          const existing = byType.get(t);
          const range = existing?.observedRange;
          return (
            <NumberField
              key={t}
              id={`sr-${t}`}
              label={`${SERVICE_TYPE_LABELS[t]} (₦)`}
              value={naira[t] ?? ""}
              onChange={(v) => setNaira((prev) => ({ ...prev, [t]: v }))}
              hint={
                range && range.minKobo !== range.maxKobo
                  ? `seen ${formatNaira(range.minKobo)}–${formatNaira(range.maxKobo)}`
                  : undefined
              }
            />
          );
        })}
      </div>

      <div className="mt-5">
        <CheckboxField
          id="sr-autofill"
          label="Pre-fill the price on a new job line"
          checked={autofill}
          onChange={setAutofill}
        />
        <p className="mt-2 max-w-2xl text-xs leading-relaxed text-cream-500">
          On is recommended. Turning it off means every price is typed by hand, which is slower
          and drifts — but it is the right choice if the workshop prices every job individually
          and a suggested figure would be anchoring it wrongly.
        </p>
      </div>

      <div className="mt-6 flex flex-wrap items-center gap-4">
        <Button onClick={save} busy={saving}>
          Save service prices
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
    </section>
  );
}

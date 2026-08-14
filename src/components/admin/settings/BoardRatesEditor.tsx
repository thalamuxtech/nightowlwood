"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, Scissors, ShieldAlert } from "lucide-react";
import { getDb } from "@/lib/firebase";
import {
  BOARD_TYPE_LABELS,
  CE_RATED_BOARD_TYPES,
  type BoardType,
} from "@/lib/erp/enums";
import { formatNaira, toKobo, toNaira } from "@/lib/erp/money";
import { boardRateCard, saveBoardRateCard } from "@/lib/erp/cutting";
import type { BoardRateCardSettings } from "@/lib/erp/settings";
import { Button, CheckboxField, NumberField } from "@/components/admin/ui/Fields";
import { useAuditActor, useErpSession } from "@/components/admin/ErpAuthProvider";

/**
 * Cutting &amp; edging rates, by board.
 *
 * The single place C&amp;E is priced. Both the service job line and the project estimate's
 * locked cutting item read this card, which is what stops the two disagreeing about the
 * same work — a second copy of these figures anywhere would guarantee it.
 *
 * Rates differ per material by design: Bangaji is more than twice MDF. A single blended
 * figure would overcharge the cheap boards and undercharge the dear ones on every mixed job.
 */
export function BoardRatesEditor() {
  const session = useErpSession();
  const actor = useAuditActor();

  const [card, setCard] = useState<BoardRateCardSettings | null>(null);
  const [naira, setNaira] = useState<Record<string, string>>({});
  const [allowOverride, setAllowOverride] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    boardRateCard(getDb())
      .then((c) => {
        setCard(c);
        setAllowOverride(c.allowManualOverride);
        const seeded: Record<string, string> = {};
        for (const t of CE_RATED_BOARD_TYPES) {
          const kobo = c.ratesKobo[t];
          seeded[t] = kobo ? String(toNaira(kobo)) : "";
        }
        setNaira(seeded);
      })
      .catch(() => setError("Could not load the cutting rates."))
      .finally(() => setLoading(false));
  }, []);

  async function save() {
    setError("");
    setSaving(true);
    try {
      const ratesKobo: Partial<Record<BoardType, number>> = {
        // Anything already on the card that is not one of the priced types is preserved,
        // so saving this form cannot drop a rate set elsewhere for another board.
        ...(card?.ratesKobo ?? {}),
      };
      for (const t of CE_RATED_BOARD_TYPES) {
        const value = Number(naira[t]);
        if (Number.isFinite(value) && value > 0) ratesKobo[t] = toKobo(value);
        else delete ratesKobo[t];
      }

      await saveBoardRateCard(
        getDb(),
        actor,
        { ratesKobo, allowManualOverride: allowOverride }
      );
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed.");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <section className="rounded-3xl border border-night-700/60 bg-night-900/40 p-6">
        <p className="text-sm text-cream-500">Loading cutting rates…</p>
      </section>
    );
  }

  return (
    <section className="rounded-3xl border border-night-700/60 bg-night-900/40 p-6">
      <header>
        <h2 className="flex items-center gap-2 font-display text-lg text-cream-100">
          <Scissors size={18} className="text-brass-400" /> Cutting &amp; edging rates
        </h2>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-cream-400">
          Price per board, by material. Read by both the service job line and the project
          estimate&rsquo;s cutting item, so the two always agree.
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
        {CE_RATED_BOARD_TYPES.map((t) => (
          <NumberField
            key={t}
            id={`br-${t}`}
            label={`${BOARD_TYPE_LABELS[t]} (₦ per board)`}
            value={naira[t] ?? ""}
            onChange={(v) => setNaira((prev) => ({ ...prev, [t]: v }))}
          />
        ))}
      </div>

      {/* Worked through, because the effect on a real job is what the number means. */}
      <p className="mt-5 text-xs leading-relaxed text-cream-500">
        A job of 10 Egger and 5 MDF would be charged{" "}
        <span className="text-cream-300">
          {formatNaira(
            10 * toKobo(Number(naira.egger) || 0) + 5 * toKobo(Number(naira.mdf) || 0)
          )}
        </span>{" "}
        for cutting and edging.
      </p>

      <div className="mt-5">
        <CheckboxField
          id="br-override"
          label="Allow the estimate's cutting figure to be typed over"
          checked={allowOverride}
          onChange={setAllowOverride}
        />
        <p className="mt-2 max-w-2xl text-xs leading-relaxed text-cream-500">
          Off is recommended. That line exists so cutting is priced from one place, and a
          hand-typed figure is how the estimate and the job stop agreeing. Turn it on only
          for a job that genuinely needs an exception.
        </p>
      </div>

      <div className="mt-6 flex flex-wrap items-center gap-4">
        <Button onClick={save} busy={saving}>
          Save cutting rates
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
        Changing a rate affects what is quoted from now on. Invoices already raised keep
        their own line amounts, so nothing already sent to a customer is restated.
      </p>
    </section>
  );
}

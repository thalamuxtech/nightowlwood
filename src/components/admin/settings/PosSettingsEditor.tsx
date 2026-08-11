"use client";

import { useEffect, useState } from "react";
import { doc, getDoc, setDoc } from "firebase/firestore";
import { CheckCircle2, ShieldAlert, ShoppingCart } from "lucide-react";
import { getDb } from "@/lib/firebase";
import { COL } from "@/lib/erp/collections";
import { TAX_MODES, TAX_MODE_LABELS, type TaxMode } from "@/lib/erp/enums";
import {
  DEFAULT_POS_SETTINGS,
  SETTINGS_DOC,
  type PosSettings,
} from "@/lib/erp/settings";
import {
  Button,
  CheckboxField,
  NumberField,
  SelectField,
  TextField,
} from "@/components/admin/ui/Fields";

/**
 * Counter-sale defaults.
 *
 * Kept apart from the invoice settings because the counter and the invoice book are
 * genuinely different trades: over-the-counter board sales are usually quoted at the
 * price on the shelf (tax inclusive, if charged at all), while a corporate invoice
 * shows VAT as an addition. One shared tax setting would force the wrong treatment
 * on one of them.
 */
export function PosSettingsEditor() {
  const [s, setS] = useState<PosSettings>(DEFAULT_POS_SETTINGS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    getDoc(doc(getDb(), COL.settings, SETTINGS_DOC.pos))
      .then((snap) => {
        if (snap.exists()) {
          setS({ ...DEFAULT_POS_SETTINGS, ...(snap.data() as PosSettings) });
        }
      })
      .catch(() => setError("Could not load the counter settings."))
      .finally(() => setLoading(false));
  }, []);

  async function save() {
    setError("");
    if (s.taxMode !== "none" && !(s.taxPercent > 0)) {
      setError("Set a tax rate above zero, or choose “No tax”.");
      return;
    }
    setSaving(true);
    try {
      await setDoc(doc(getDb(), COL.settings, SETTINGS_DOC.pos), s, { merge: true });
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
        <p className="text-sm text-cream-500">Loading counter settings…</p>
      </section>
    );
  }

  return (
    <section className="rounded-3xl border border-night-700/60 bg-night-900/40 p-6">
      <header>
        <h2 className="flex items-center gap-2 font-display text-lg text-cream-100">
          <ShoppingCart size={18} className="text-brass-400" /> Counter sales
        </h2>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-cream-400">
          Defaults for selling boards, edge tape and accessories over the counter.
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

      <div className="mt-6 grid gap-4 sm:grid-cols-2">
        <SelectField
          id="pos-tax-mode"
          label="Tax treatment"
          value={s.taxMode}
          onChange={(v: TaxMode) => setS((p) => ({ ...p, taxMode: v }))}
          options={TAX_MODES.map((m) => ({ value: m, label: TAX_MODE_LABELS[m] }))}
        />
        <NumberField
          id="pos-tax-percent"
          label="Tax rate (%)"
          value={String(s.taxPercent)}
          onChange={(v) => setS((p) => ({ ...p, taxPercent: Number(v) || 0 }))}
          disabled={s.taxMode === "none"}
        />
        <TextField
          id="pos-tax-label"
          label="What the tax is called"
          value={s.taxLabel}
          onChange={(v) => setS((p) => ({ ...p, taxLabel: v }))}
          placeholder="VAT"
        />
        <TextField
          id="pos-receipt-footer"
          label="Receipt footer"
          value={s.receiptFooter}
          onChange={(v) => setS((p) => ({ ...p, receiptFooter: v }))}
        />
      </div>

      <div className="mt-5">
        <CheckboxField
          id="pos-negative-stock"
          label="Allow a sale that takes stock below zero"
          checked={s.allowNegativeStock}
          onChange={(v) => setS((p) => ({ ...p, allowNegativeStock: v }))}
        />
        <p className="mt-2 max-w-2xl text-xs leading-relaxed text-cream-500">
          Off is recommended. A negative count is never true — it means the recorded
          figure was already wrong — and blocking the sale puts that in front of
          whoever is at the counter, which is the only moment anyone can still go and
          count the stack. Turn it on only if the counter must never be held up.
        </p>
      </div>

      <div className="mt-6 flex flex-wrap items-center gap-4">
        <Button onClick={save} busy={saving}>
          Save counter settings
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

"use client";

import { useEffect, useMemo, useState } from "react";
import { doc, getDoc, setDoc } from "firebase/firestore";
import { CheckCircle2, ReceiptText, ShieldAlert } from "lucide-react";
import { getDb } from "@/lib/firebase";
import { COL } from "@/lib/erp/collections";
import { TAX_MODES, TAX_MODE_LABELS, type TaxMode } from "@/lib/erp/enums";
import { formatNaira, toKobo } from "@/lib/erp/money";
import { computeInvoiceTotals } from "@/lib/erp/invoices";
import {
  DEFAULT_INVOICE_SETTINGS,
  SETTINGS_DOC,
  type InvoiceSettings,
} from "@/lib/erp/settings";
import {
  Button,
  NumberField,
  SelectField,
  TextField,
} from "@/components/admin/ui/Fields";

/** A round figure to demonstrate the tax treatment against. */
const SAMPLE_KOBO = toKobo(100_000);

/**
 * Invoice defaults: tax treatment, terms and commission.
 *
 * Tax mode is the setting worth being careful with, which is why the screen shows
 * what each choice does to a real figure rather than only naming it. Inclusive and
 * exclusive are not two ways of describing the same invoice — at 7.5% on ₦100,000
 * one totals ₦107,500 and the other ₦100,000 — and picking the wrong one either
 * overcharges the customer or leaves the business paying the tax out of its margin.
 *
 * These are *defaults*, pre-filled on a new invoice. Each invoice stores the rate
 * and mode it was raised under, so changing anything here never restates a document
 * that has already been sent.
 */
export function InvoiceSettingsEditor() {
  const [s, setS] = useState<InvoiceSettings>(DEFAULT_INVOICE_SETTINGS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    getDoc(doc(getDb(), COL.settings, SETTINGS_DOC.invoice))
      .then((snap) => {
        if (!snap.exists()) return;
        const d = snap.data();
        setS({
          ...DEFAULT_INVOICE_SETTINGS,
          ...d,
          // Matches the reader in invoices.ts: a document predating `taxMode` was
          // charging exclusively if it had a rate, so it must keep doing that
          // rather than silently switching to "no tax" the first time this loads.
          taxMode:
            (d.taxMode as TaxMode) ?? ((d.taxPercent ?? 0) > 0 ? "exclusive" : "none"),
        } as InvoiceSettings);
      })
      .catch(() => setError("Could not load the invoice settings."))
      .finally(() => setLoading(false));
  }, []);

  /** The chosen treatment applied to a round number, so the effect is visible. */
  const sample = useMemo(
    () =>
      computeInvoiceTotals({
        subtotalKobo: SAMPLE_KOBO,
        taxMode: s.taxMode,
        taxPercent: s.taxPercent,
        commissionPercent: s.defaultCommissionPercent,
      }),
    [s.taxMode, s.taxPercent, s.defaultCommissionPercent]
  );

  async function save() {
    setError("");
    if (s.taxMode !== "none" && !(s.taxPercent > 0)) {
      setError("Set a tax rate above zero, or choose “No tax”.");
      return;
    }
    if (s.paymentTermsDays < 0) {
      setError("Payment terms cannot be negative.");
      return;
    }
    setSaving(true);
    try {
      await setDoc(doc(getDb(), COL.settings, SETTINGS_DOC.invoice), s, { merge: true });
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
        <p className="text-sm text-cream-500">Loading invoice settings…</p>
      </section>
    );
  }

  return (
    <section className="rounded-3xl border border-night-700/60 bg-night-900/40 p-6">
      <header>
        <h2 className="flex items-center gap-2 font-display text-lg text-cream-100">
          <ReceiptText size={18} className="text-brass-400" /> Invoices &amp; tax
        </h2>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-cream-400">
          Pre-filled on every new invoice. Each invoice keeps the rate and treatment
          it was raised under, so changing these never alters a document already sent.
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
          id="inv-tax-mode"
          label="Tax treatment"
          value={s.taxMode}
          onChange={(v) => setS((p) => ({ ...p, taxMode: v }))}
          options={TAX_MODES.map((m) => ({ value: m, label: TAX_MODE_LABELS[m] }))}
        />
        <NumberField
          id="inv-tax-percent"
          label="Tax rate (%)"
          value={String(s.taxPercent)}
          onChange={(v) => setS((p) => ({ ...p, taxPercent: Number(v) || 0 }))}
          disabled={s.taxMode === "none"}
          hint={s.taxMode === "none" ? "no tax is being charged" : undefined}
        />
        <TextField
          id="inv-tax-label"
          label="What the tax is called"
          value={s.taxLabel}
          onChange={(v) => setS((p) => ({ ...p, taxLabel: v }))}
          placeholder="VAT"
        />
        <NumberField
          id="inv-terms"
          label="Payment terms (days)"
          value={String(s.paymentTermsDays)}
          onChange={(v) => setS((p) => ({ ...p, paymentTermsDays: Number(v) || 0 }))}
        />
        <NumberField
          id="inv-commission"
          label="Default commission (%)"
          value={String(s.defaultCommissionPercent)}
          onChange={(v) =>
            setS((p) => ({ ...p, defaultCommissionPercent: Number(v) || 0 }))
          }
          hint="of the invoice total"
        />
        <TextField
          id="inv-footer"
          label="Footer note"
          value={s.footerNote}
          onChange={(v) => setS((p) => ({ ...p, footerNote: v }))}
        />
      </div>

      {/* The chosen treatment, worked through on ₦100,000. The difference between
          inclusive and exclusive is invisible when stated as words and obvious
          when stated as money. */}
      <div className="mt-6 rounded-2xl border border-night-700/60 bg-night-950/40 p-5">
        <p className="text-xs uppercase tracking-wider text-cream-500">
          On a {formatNaira(SAMPLE_KOBO)} invoice
        </p>
        <dl className="mt-3 flex flex-wrap gap-x-8 gap-y-2 text-sm">
          <div>
            <dt className="text-cream-500">Subtotal</dt>
            <dd className="mt-0.5 tabular-nums text-cream-200">
              {formatNaira(sample.subtotalKobo)}
            </dd>
          </div>
          <div>
            <dt className="text-cream-500">
              {s.taxLabel || "Tax"}
              {s.taxMode === "inclusive" ? " (within)" : ""}
            </dt>
            <dd className="mt-0.5 tabular-nums text-cream-200">
              {formatNaira(sample.taxKobo)}
            </dd>
          </div>
          <div>
            <dt className="text-cream-500">Customer pays</dt>
            <dd className="mt-0.5 font-display text-lg text-brass-300">
              {formatNaira(sample.totalKobo)}
            </dd>
          </div>
          {sample.commissionKobo > 0 && (
            <div>
              <dt className="text-cream-500">Commission (cost)</dt>
              <dd className="mt-0.5 tabular-nums text-amber-300">
                {formatNaira(sample.commissionKobo)}
              </dd>
            </div>
          )}
        </dl>
        {s.taxMode === "inclusive" && (
          <p className="mt-3 text-xs text-cream-500">
            Inclusive tax does not change what the customer pays — it states how much
            of the price is tax.
          </p>
        )}
        {sample.commissionKobo > 0 && (
          <p className="mt-3 text-xs text-cream-500">
            Commission is a cost to the business, not a charge to the customer, so it
            is recorded against the invoice but never added to the total.
          </p>
        )}
      </div>

      <div className="mt-6 flex flex-wrap items-center gap-4">
        <Button onClick={save} busy={saving}>
          Save invoice settings
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

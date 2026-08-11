"use client";

import { useEffect, useState } from "react";
import { doc, getDoc, setDoc } from "firebase/firestore";
import { Building2, CheckCircle2, ShieldAlert } from "lucide-react";
import { getDb } from "@/lib/firebase";
import { COL } from "@/lib/erp/collections";
import {
  DEFAULT_COMPANY_SETTINGS,
  SETTINGS_DOC,
  type CompanySettings,
} from "@/lib/erp/settings";
import { Button, TextField } from "@/components/admin/ui/Fields";

/**
 * The company's own details.
 *
 * These print on every document the business hands out — invoices, receipts, appointment
 * letters, staff ID cards, cutting sheets. Until now they were readable by all of those and
 * editable by none of them, which meant the defaults shipped in code were the letterhead: no
 * address, no RC number, no bank details. An invoice with no account number on it cannot be
 * paid by transfer, which is how most of these are paid.
 *
 * The bank block is the part worth getting right. It is grouped and labelled as what appears
 * on an invoice for payment, because that is the only reason to store it, and a wrong account
 * number here is money sent to a stranger.
 */
export function CompanySettingsEditor() {
  const [s, setS] = useState<CompanySettings>(DEFAULT_COMPANY_SETTINGS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    getDoc(doc(getDb(), COL.settings, SETTINGS_DOC.company))
      .then((snap) => {
        if (snap.exists()) {
          setS({ ...DEFAULT_COMPANY_SETTINGS, ...(snap.data() as CompanySettings) });
        }
      })
      .catch(() => setError("Could not load the company details."))
      .finally(() => setLoading(false));
  }, []);

  async function save() {
    setError("");
    if (!s.name.trim()) {
      setError("The company needs a name — it is the first line of every document.");
      return;
    }
    /*
     * A partly-filled bank block is worse than an empty one.
     *
     * An invoice showing a bank and an account name but no number tells the customer to pay
     * without saying where, which generates a phone call at best and a transfer to the wrong
     * account at worst. Either all three or none.
     */
    const bank = [s.bankName, s.bankAccountName, s.bankAccountNumber].map((v) => v?.trim() ?? "");
    const filled = bank.filter(Boolean).length;
    if (filled > 0 && filled < 3) {
      setError(
        "Give the bank name, account name and account number together, or leave all three empty. A half-filled block on an invoice cannot be paid."
      );
      return;
    }

    setSaving(true);
    try {
      await setDoc(doc(getDb(), COL.settings, SETTINGS_DOC.company), s, { merge: true });
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
        <p className="text-sm text-cream-500">Loading company details…</p>
      </section>
    );
  }

  return (
    <section className="rounded-3xl border border-night-700/60 bg-night-900/40 p-6">
      <header>
        <h2 className="flex items-center gap-2 font-display text-lg text-cream-100">
          <Building2 size={18} className="text-brass-400" /> Company details
        </h2>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-cream-400">
          What prints on invoices, receipts, appointment letters and ID cards. Anything left
          empty is simply absent from those documents.
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
        <TextField
          id="co-name"
          label="Registered name"
          value={s.name}
          onChange={(v) => setS((p) => ({ ...p, name: v }))}
          required
        />
        <TextField
          id="co-tagline"
          label="Tagline"
          value={s.tagline}
          onChange={(v) => setS((p) => ({ ...p, tagline: v }))}
          placeholder="Precision in Every Cut"
        />
        <div className="sm:col-span-2">
          <TextField
            id="co-address"
            label="Address"
            value={s.address}
            onChange={(v) => setS((p) => ({ ...p, address: v }))}
            placeholder="Street, area, city, state"
            hint="prints on every invoice and receipt"
          />
        </div>
        <TextField
          id="co-phone"
          label="Phone"
          type="tel"
          value={s.phone}
          onChange={(v) => setS((p) => ({ ...p, phone: v }))}
        />
        <TextField
          id="co-alt-phone"
          label="Second phone"
          type="tel"
          value={s.altPhone ?? ""}
          onChange={(v) => setS((p) => ({ ...p, altPhone: v }))}
          hint="optional"
        />
        <TextField
          id="co-email"
          label="Email"
          type="email"
          value={s.email}
          onChange={(v) => setS((p) => ({ ...p, email: v }))}
        />
        <TextField
          id="co-website"
          label="Website"
          value={s.website}
          onChange={(v) => setS((p) => ({ ...p, website: v }))}
        />
        <TextField
          id="co-rc"
          label="RC number"
          value={s.rcNumber ?? ""}
          onChange={(v) => setS((p) => ({ ...p, rcNumber: v }))}
          hint="CAC registration"
        />
        <TextField
          id="co-tin"
          label="TIN"
          value={s.tin ?? ""}
          onChange={(v) => setS((p) => ({ ...p, tin: v }))}
          hint="tax identification number"
        />
      </div>

      <div className="mt-6 border-t border-night-700/60 pt-5">
        <p className="text-[0.65rem] uppercase tracking-[0.2em] text-cream-600">
          Bank details for payment
        </p>
        <p className="mt-2 max-w-2xl text-xs leading-relaxed text-cream-500">
          Printed on invoices so a customer can pay by transfer. Check the account number
          against a statement rather than from memory — this is the number money will be sent
          to.
        </p>
        <div className="mt-4 grid gap-4 sm:grid-cols-3">
          <TextField
            id="co-bank"
            label="Bank"
            value={s.bankName ?? ""}
            onChange={(v) => setS((p) => ({ ...p, bankName: v }))}
          />
          <TextField
            id="co-bank-account-name"
            label="Account name"
            value={s.bankAccountName ?? ""}
            onChange={(v) => setS((p) => ({ ...p, bankAccountName: v }))}
          />
          <TextField
            id="co-bank-account-number"
            label="Account number"
            value={s.bankAccountNumber ?? ""}
            onChange={(v) => setS((p) => ({ ...p, bankAccountNumber: v }))}
          />
        </div>
      </div>

      <div className="mt-6 flex flex-wrap items-center gap-4">
        <Button onClick={save} busy={saving}>
          Save company details
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

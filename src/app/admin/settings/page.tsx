"use client";

import { useEffect, useState, type FormEvent } from "react";
import { CheckCircle2, Loader2, Save } from "lucide-react";
import { doc, getDoc, setDoc } from "firebase/firestore";
import { getDb } from "@/lib/firebase";
import { EmailTester } from "@/components/admin/EmailTester";
import { ReportRangesEditor } from "@/components/admin/ReportRangesEditor";
import { CompanySettingsEditor } from "@/components/admin/settings/CompanySettingsEditor";
import { HrSettingsEditor } from "@/components/admin/settings/HrSettingsEditor";
import { BoardCatalogueEditor } from "@/components/admin/settings/BoardCatalogueEditor";
import { BoardRatesEditor } from "@/components/admin/settings/BoardRatesEditor";
import { InvoiceSettingsEditor } from "@/components/admin/settings/InvoiceSettingsEditor";
import { MarketingTargetsEditor } from "@/components/admin/settings/MarketingTargetsEditor";
import { MetersEditor } from "@/components/admin/settings/MetersEditor";
import { PosSettingsEditor } from "@/components/admin/settings/PosSettingsEditor";
import { ServiceRatesEditor } from "@/components/admin/settings/ServiceRatesEditor";
import type { SiteSettings } from "@/lib/types";
import { RequireCapability } from "@/components/admin/RequireCapability";

const DEFAULTS: SiteSettings = {
  contactEmail: "info@nightowl.com.ng",
  contactPhone: "+234 808 444 1277",
  instagram: "https://www.instagram.com/nightowlwoodworksng",
  facebook: "",
  announcement: "",
};

const FIELDS: { key: keyof SiteSettings; label: string; placeholder: string; type: string }[] = [
  { key: "contactPhone", label: "WhatsApp / phone", placeholder: "+234 ...", type: "tel" },
  { key: "contactEmail", label: "Contact email", placeholder: "hello@nightowl.com.ng", type: "email" },
  { key: "instagram", label: "Instagram URL", placeholder: "https://instagram.com/...", type: "url" },
  { key: "facebook", label: "Facebook URL", placeholder: "https://facebook.com/...", type: "url" },
  { key: "announcement", label: "Announcement banner (optional)", placeholder: "e.g. Closed for Sallah break until…", type: "text" },
];

function SettingsPageInner() {
  const [settings, setSettings] = useState<SiteSettings>(DEFAULTS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    getDoc(doc(getDb(), "settings", "site"))
      .then((snap) => {
        if (snap.exists()) setSettings({ ...DEFAULTS, ...(snap.data() as SiteSettings) });
      })
      .catch(() => setError("Could not load settings."))
      .finally(() => setLoading(false));
  }, []);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSaving(true);
    setSaved(false);
    setError("");
    try {
      await setDoc(doc(getDb(), "settings", "site"), settings, { merge: true });
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch {
      setError("Save failed. Check permissions and try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="font-display text-3xl text-cream-50">Settings</h1>
      <p className="mt-1 text-sm text-cream-500">
        Contact details and site-wide options stored in Firestore.
      </p>

      {loading ? (
        <p className="mt-8 text-sm text-cream-500">Loading…</p>
      ) : (
        <form onSubmit={onSubmit} className="mt-8 space-y-5 rounded-2xl border border-night-700/70 bg-night-900 p-7">
          {FIELDS.map((field) => (
            <div key={field.key}>
              <label htmlFor={`set-${field.key}`} className="mb-1.5 block text-sm text-cream-300">
                {field.label}
              </label>
              <input
                id={`set-${field.key}`}
                type={field.type}
                value={settings[field.key]}
                placeholder={field.placeholder}
                onChange={(e) => setSettings((s) => ({ ...s, [field.key]: e.target.value }))}
                className="w-full rounded-xl border border-night-600 bg-night-800/60 px-4 py-3 text-cream-100 placeholder:text-cream-500 focus:border-brass-500 focus:outline-none"
              />
            </div>
          ))}

          {error && (
            <p role="alert" className="text-sm text-red-400">
              {error}
            </p>
          )}

          <div className="flex items-center gap-4 pt-2">
            <button
              type="submit"
              disabled={saving}
              className="inline-flex cursor-pointer items-center gap-2 rounded-full bg-brass-500 px-7 py-3.5 font-medium text-night-950 transition-all duration-300 hover:bg-brass-400 disabled:opacity-60"
            >
              {saving ? <Loader2 size={17} className="animate-spin" /> : <Save size={17} />}
              {saving ? "Saving…" : "Save settings"}
            </button>
            {saved && (
              <span className="inline-flex items-center gap-1.5 text-sm text-emerald-400" role="status">
                <CheckCircle2 size={16} /> Saved
              </span>
            )}
          </div>
        </form>
      )}

      {/* Company details first among the ERP groups: they print on every document the other
          groups produce, and an invoice with no address or account number cannot be paid. */}
      <div className="mt-8">
        <CompanySettingsEditor />
      </div>

      <div className="mt-8">
        <InvoiceSettingsEditor />
      </div>

      <div className="mt-8">
        <ServiceRatesEditor />
      </div>

      <div className="mt-8">
        <BoardRatesEditor />
      </div>

      <div className="mt-8">
        <MetersEditor />
      </div>

      <div className="mt-8">
        <PosSettingsEditor />
      </div>

      <div className="mt-8">
        <HrSettingsEditor />
      </div>

      <div className="mt-8">
        <MarketingTargetsEditor />
      </div>

      {/* The website-facing half of the boards: what a customer sees, as opposed to what
          cutting them costs. */}
      <div className="mt-8">
        <BoardCatalogueEditor />
      </div>

      <div className="mt-8">
        <ReportRangesEditor />
      </div>

      <div className="mt-8">
        <EmailTester />
      </div>
    </div>
  );
}

/**
 * Guarded at the route rather than inside the screen: hiding the sidebar link is
 * not access control, since the URL can still be typed or bookmarked.
 */
export default function SettingsPage() {
  return (
    <RequireCapability capability="settings.change">
      <SettingsPageInner />
    </RequireCapability>
  );
}

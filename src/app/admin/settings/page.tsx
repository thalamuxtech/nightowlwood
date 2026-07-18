"use client";

import { useEffect, useState, type FormEvent } from "react";
import { CheckCircle2, Loader2, Save } from "lucide-react";
import { doc, getDoc, setDoc } from "firebase/firestore";
import { getDb } from "@/lib/firebase";
import type { SiteSettings } from "@/lib/types";

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

export default function SettingsPage() {
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
    <div className="mx-auto max-w-2xl">
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
    </div>
  );
}

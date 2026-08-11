"use client";

import { useEffect, useState } from "react";
import { doc, getDoc, setDoc } from "firebase/firestore";
import { CheckCircle2, IdCard, ShieldAlert } from "lucide-react";
import { getDb } from "@/lib/firebase";
import { COL } from "@/lib/erp/collections";
import { DEFAULT_HR_SETTINGS, SETTINGS_DOC, type HrSettings } from "@/lib/erp/settings";
import { Button, NumberField, TextField } from "@/components/admin/ui/Fields";
import { formatNaira, toKobo } from "@/lib/erp/money";

/**
 * HR settings — the working month, and what goes on a letter or an ID card.
 *
 * `workingDaysPerMonth` is the one number here with money attached: a salaried person's day
 * rate is their monthly figure divided by it, which is what a no-show deduction is computed
 * from. Twenty-six is the six-day week the workshop runs. Changing it changes every future
 * absence deduction, so the effect is shown against a worked example rather than left for
 * someone to discover on a payslip.
 *
 * The signatory name matters more than it looks: an appointment letter printed with it empty
 * is an unsigned letter, which is not a letter.
 */
export function HrSettingsEditor() {
  const [s, setS] = useState<HrSettings>(DEFAULT_HR_SETTINGS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    getDoc(doc(getDb(), COL.settings, SETTINGS_DOC.hr))
      .then((snap) => {
        if (snap.exists()) {
          setS({ ...DEFAULT_HR_SETTINGS, ...(snap.data() as HrSettings) });
        }
      })
      .catch(() => setError("Could not load the HR settings."))
      .finally(() => setLoading(false));
  }, []);

  async function save() {
    setError("");
    // Between 1 and 31: zero would divide a salary by nothing, and more than 31 is not a month.
    if (!(s.workingDaysPerMonth >= 1 && s.workingDaysPerMonth <= 31)) {
      setError("Working days in a month must be between 1 and 31.");
      return;
    }
    if (!(s.idCardValidMonths >= 1)) {
      setError("An ID card has to be valid for at least a month.");
      return;
    }

    setSaving(true);
    try {
      await setDoc(doc(getDb(), COL.settings, SETTINGS_DOC.hr), s, { merge: true });
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch {
      setError("Save failed. Check permissions and try again.");
    } finally {
      setSaving(false);
    }
  }

  /** A worked example, so the consequence of the divisor is visible before it is saved. */
  const exampleDayRate =
    s.workingDaysPerMonth >= 1
      ? Math.round(toKobo(80_000) / s.workingDaysPerMonth)
      : 0;

  if (loading) {
    return (
      <section className="rounded-3xl border border-night-700/60 bg-night-900/40 p-6">
        <p className="text-sm text-cream-500">Loading HR settings…</p>
      </section>
    );
  }

  return (
    <section className="rounded-3xl border border-night-700/60 bg-night-900/40 p-6">
      <header>
        <h2 className="flex items-center gap-2 font-display text-lg text-cream-100">
          <IdCard size={18} className="text-brass-400" /> Staff & HR
        </h2>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-cream-400">
          The working month used to pro-rate a salary, and what appears on appointment letters
          and ID cards.
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
        <NumberField
          id="hr-working-days"
          label="Working days in a month"
          value={String(s.workingDaysPerMonth)}
          onChange={(v) => setS((p) => ({ ...p, workingDaysPerMonth: Number(v) || 0 }))}
          step={1}
          min={1}
          hint="26 = six-day week"
        />
        <div className="flex items-end pb-1">
          <p className="text-xs leading-relaxed text-cream-500">
            A ₦80,000 salary becomes{" "}
            <span className="text-brass-300">{formatNaira(exampleDayRate)}</span> a day, which is
            what one day&apos;s absence deducts.
          </p>
        </div>
      </div>

      <div className="mt-6 border-t border-night-700/60 pt-5">
        <p className="text-[0.65rem] uppercase tracking-[0.2em] text-cream-600">
          Appointment letters
        </p>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <TextField
            id="hr-signatory"
            label="Who signs"
            value={s.letterSignatoryName}
            onChange={(v) => setS((p) => ({ ...p, letterSignatoryName: v }))}
            hint="printed under the signature line"
          />
          <TextField
            id="hr-signatory-title"
            label="Their title"
            value={s.letterSignatoryTitle}
            onChange={(v) => setS((p) => ({ ...p, letterSignatoryTitle: v }))}
          />
        </div>
        {!s.letterSignatoryName.trim() && (
          <p className="mt-3 rounded-xl border border-amber-500/30 bg-amber-500/5 px-4 py-3 text-xs text-amber-300">
            No name set, so appointment letters currently print with a blank signature line.
          </p>
        )}
      </div>

      <div className="mt-6 border-t border-night-700/60 pt-5">
        <p className="text-[0.65rem] uppercase tracking-[0.2em] text-cream-600">Staff ID cards</p>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <NumberField
            id="hr-id-months"
            label="Valid for (months)"
            value={String(s.idCardValidMonths)}
            onChange={(v) => setS((p) => ({ ...p, idCardValidMonths: Number(v) || 0 }))}
            step={1}
            min={1}
          />
          <TextField
            id="hr-id-return"
            label="If-found note"
            value={s.idCardReturnNote}
            onChange={(v) => setS((p) => ({ ...p, idCardReturnNote: v }))}
          />
        </div>
      </div>

      <div className="mt-6 flex flex-wrap items-center gap-4">
        <Button onClick={save} busy={saving}>
          Save HR settings
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

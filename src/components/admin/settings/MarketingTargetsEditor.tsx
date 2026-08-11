"use client";

import { useEffect, useMemo, useState } from "react";
import { CheckCircle2, ShieldAlert, Target } from "lucide-react";
import { getDb } from "@/lib/firebase";
import {
  DEFAULT_MARKETING_TARGETS,
  loadMarketingTargets,
  saveMarketingTargets,
  type MarketingTargets,
} from "@/lib/erp/marketing";
import { Button, NumberField } from "@/components/admin/ui/Fields";
import { useErpSession } from "@/components/admin/ErpAuthProvider";

/**
 * Daily activity targets for the marketing team.
 *
 * The same targets the weekly summary measures against, editable from either place. Settings is
 * where someone looks for "where do I change the numbers"; the summary screen has its own copy
 * because that is where you notice they are wrong. Both write the one document.
 *
 * The weekly figures are shown live as they are typed, since that is the number that appears in
 * the review meeting and "5 a day" does not read as "30 a week" without the arithmetic.
 */
export function MarketingTargetsEditor() {
  const session = useErpSession();

  const [t, setT] = useState<MarketingTargets>(DEFAULT_MARKETING_TARGETS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    loadMarketingTargets(getDb())
      .then(setT)
      .catch(() => setError("Could not load the marketing targets."))
      .finally(() => setLoading(false));
  }, []);

  const actor = useMemo(
    () => ({
      uid: session.user?.uid ?? "",
      email: session.user?.email ?? "",
      role: session.role ?? "admin",
    }),
    [session.user, session.role]
  );

  async function save() {
    setError("");
    setSaving(true);
    try {
      await saveMarketingTargets(getDb(), actor, t);
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed. Check permissions and try again.");
    } finally {
      setSaving(false);
    }
  }

  const week = t.workingDaysPerWeek;

  if (loading) {
    return (
      <section className="rounded-3xl border border-night-700/60 bg-night-900/40 p-6">
        <p className="text-sm text-cream-500">Loading marketing targets…</p>
      </section>
    );
  }

  return (
    <section className="rounded-3xl border border-night-700/60 bg-night-900/40 p-6">
      <header>
        <h2 className="flex items-center gap-2 font-display text-lg text-cream-100">
          <Target size={18} className="text-brass-400" /> Marketing targets
        </h2>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-cream-400">
          Per marketer, per working day. The weekly summary measures the reports on file against
          these, so they are what makes a week readable as good or bad.
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

      <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <NumberField
          id="mt-sites"
          label="Sites to visit"
          value={String(t.sitesPerDay)}
          onChange={(v) => setT((p) => ({ ...p, sitesPerDay: Number(v) || 0 }))}
          step={1}
          hint={`${t.sitesPerDay * week}/week`}
        />
        <NumberField
          id="mt-convos"
          label="Conversations"
          value={String(t.conversationsPerDay)}
          onChange={(v) => setT((p) => ({ ...p, conversationsPerDay: Number(v) || 0 }))}
          step={1}
          hint={`${t.conversationsPerDay * week}/week`}
        />
        <NumberField
          id="mt-contacts"
          label="New contacts"
          value={String(t.newContactsPerDay)}
          onChange={(v) => setT((p) => ({ ...p, newContactsPerDay: Number(v) || 0 }))}
          step={1}
          hint={`${t.newContactsPerDay * week}/week`}
        />
        <NumberField
          id="mt-followups"
          label="Follow-ups"
          value={String(t.followUpsPerDay)}
          onChange={(v) => setT((p) => ({ ...p, followUpsPerDay: Number(v) || 0 }))}
          step={1}
          hint={`${t.followUpsPerDay * week}/week`}
        />
        <NumberField
          id="mt-days"
          label="Working days a week"
          value={String(t.workingDaysPerWeek)}
          onChange={(v) => setT((p) => ({ ...p, workingDaysPerWeek: Number(v) || 0 }))}
          step={1}
          min={1}
          hint="6 = Mon–Sat"
        />
      </div>

      <p className="mt-5 max-w-2xl text-xs leading-relaxed text-cream-500">
        The spec&apos;s figures are 5–10 sites, 10+ conversations, 5 new contacts and 3 follow-ups
        a day. They are stored rather than fixed because a target nobody can adjust is one that
        gets ignored the first season it is wrong.
      </p>

      <div className="mt-6 flex flex-wrap items-center gap-4">
        <Button onClick={save} busy={saving}>
          Save targets
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

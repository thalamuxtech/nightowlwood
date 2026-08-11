"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Award,
  CheckCircle2,
  Printer,
  Settings2,
  ShieldAlert,
  Target,
  TrendingDown,
  TrendingUp,
} from "lucide-react";
import { getDb } from "@/lib/firebase";
import { INTEREST_LEVELS, INTEREST_LEVEL_LABELS } from "@/lib/erp/enums";
import {
  buildMarketingSummary,
  DEFAULT_MARKETING_TARGETS,
  loadMarketingTargets,
  saveMarketingTargets,
  type MarketingSummary,
  type MarketingTargets,
} from "@/lib/erp/marketing";
import {
  Button,
  DateField,
  EmptyState,
  NumberField,
  todayIso,
} from "@/components/admin/ui/Fields";
import { useErpSession } from "@/components/admin/ErpAuthProvider";

/**
 * The weekly performance summary, and the targets it is measured against.
 *
 * Counted from the records rather than typed in, which is the difference between a report and
 * a claim: a marketer cannot write "12 sites" on this screen, it says 12 because twelve reports
 * exist. The targets are editable because a target nobody can adjust gets ignored the first
 * season it is wrong.
 *
 * The default period is the current week, Monday to today — that is the meeting this screen is
 * for. The spec's rule 4 is a ten-to-fifteen minute weekly review, and it should be readable in
 * one screen without scrolling on a laptop.
 */

/** Monday of the week containing `date`, as `yyyy-mm-dd`. */
function mondayOf(date: Date): string {
  const d = new Date(date);
  // getDay() is 0 for Sunday, so Sunday counts back six days rather than forward one —
  // otherwise the "current week" of a Sunday meeting would be the week about to start.
  const back = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - back);
  return d.toLocaleDateString("en-CA");
}

export function MarketingSummaryScreen() {
  const session = useErpSession();
  const canManage = session.can("marketing.manage");

  const [fromKey, setFromKey] = useState(() => mondayOf(new Date()));
  const [toKey, setToKey] = useState(todayIso());
  const [summary, setSummary] = useState<MarketingSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const [editingTargets, setEditingTargets] = useState(false);
  const [draft, setDraft] = useState<MarketingTargets>(DEFAULT_MARKETING_TARGETS);
  const [savingTargets, setSavingTargets] = useState(false);

  const actor = useMemo(
    () => ({
      uid: session.user?.uid ?? "",
      email: session.user?.email ?? "",
      role: session.role ?? "manager",
    }),
    [session.user, session.role]
  );

  const load = useCallback(() => {
    if (fromKey > toKey) {
      setError("The start of the period is after its end.");
      // The old report is cleared too. Leaving it on screen under an error banner shows figures
      // for a period the date boxes no longer describe, which is worse than showing none.
      setSummary(null);
      return;
    }
    setError("");
    setLoading(true);
    buildMarketingSummary(getDb(), fromKey, toKey)
      .then((s) => {
        setSummary(s);
        // The summary carries the stored targets, so a successful report is also a successful
        // read of them — enough to let them be edited and saved.
        setDraft(s.targets);
        setTargetsLoaded(true);
        setTargetsError("");
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Could not build the summary."))
      .finally(() => setLoading(false));
  }, [fromKey, toKey]);

  useEffect(load, [load]);

  /*
   * Whether the stored targets were actually read.
   *
   * If the read failed, `draft` is still the seeded defaults — and saving those would silently
   * overwrite whatever the workshop had set with 5/10/5/3. So the Save button is withheld until
   * a successful read has happened, which turns a destructive failure into a visible one.
   */
  const [targetsLoaded, setTargetsLoaded] = useState(false);
  const [targetsError, setTargetsError] = useState("");

  useEffect(() => {
    loadMarketingTargets(getDb())
      .then((t) => {
        setDraft(t);
        setTargetsLoaded(true);
      })
      .catch((e) =>
        setTargetsError(
          e instanceof Error
            ? `Could not read the saved targets: ${e.message}`
            : "Could not read the saved targets."
        )
      );
  }, []);

  async function saveTargets() {
    setError("");
    setSavingTargets(true);
    try {
      await saveMarketingTargets(getDb(), actor, draft);
      setNotice("Targets saved.");
      setTimeout(() => setNotice(""), 6000);
      setEditingTargets(false);
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save the targets.");
    } finally {
      setSavingTargets(false);
    }
  }

  function shiftWeek(by: -1 | 1) {
    const [y, m, d] = fromKey.split("-").map(Number);
    const start = new Date(y, m - 1, d + by * 7);
    const end = new Date(y, m - 1, d + by * 7 + 6);
    setFromKey(start.toLocaleDateString("en-CA"));
    setToKey(end.toLocaleDateString("en-CA"));
  }

  return (
    <div>
      <header className="flex flex-wrap items-start justify-between gap-4 print:hidden">
        <div>
          <h1 className="font-display text-2xl text-cream-50">Weekly summary</h1>
          <p className="mt-1.5 max-w-2xl text-sm text-cream-400">
            Counted from the reports on file, not typed in. Ten minutes a week with this on
            screen is the review the whole module is built for.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {canManage && (
            <Button
              variant={editingTargets ? "ghost" : "secondary"}
              onClick={() => setEditingTargets((e) => !e)}
            >
              <span className="flex items-center gap-1.5">
                <Settings2 size={15} /> {editingTargets ? "Cancel" : "Targets"}
              </span>
            </Button>
          )}
          <Button variant="secondary" onClick={() => window.print()}>
            <span className="flex items-center gap-1.5">
              <Printer size={15} /> Print
            </span>
          </Button>
        </div>
      </header>

      {error && (
        <p
          role="alert"
          className="mt-6 flex items-start gap-2 rounded-xl border border-red-500/40 bg-red-500/5 px-4 py-3 text-sm text-red-300 print:hidden"
        >
          <ShieldAlert size={16} className="mt-0.5 shrink-0" /> {error}
        </p>
      )}
      {notice && (
        <p
          role="status"
          className="mt-6 flex items-start gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/5 px-4 py-3 text-sm text-emerald-300 print:hidden"
        >
          <CheckCircle2 size={16} className="mt-0.5 shrink-0" /> {notice}
        </p>
      )}

      {/* Period */}
      <section className="mt-6 rounded-3xl border border-night-700/60 bg-night-900/30 p-5 print:hidden">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <DateField id="ms-from" label="From" value={fromKey} onChange={setFromKey} />
          <DateField id="ms-to" label="To" value={toKey} onChange={setToKey} />
          <div className="flex items-end gap-2">
            <Button variant="ghost" onClick={() => shiftWeek(-1)}>
              ← Previous week
            </Button>
          </div>
          <div className="flex items-end gap-2">
            <Button variant="ghost" onClick={() => shiftWeek(1)}>
              Next week →
            </Button>
          </div>
        </div>
      </section>

      {editingTargets && canManage && (
        <section className="mt-6 rounded-3xl border border-brass-500/30 bg-night-900/40 p-6 print:hidden">
          <h2 className="flex items-center gap-2 font-display text-lg text-cream-100">
            <Target size={18} className="text-brass-400" /> Daily targets
          </h2>
          <p className="mt-1.5 text-sm text-cream-400">
            Per marketer, per working day. The weekly figures below are these scaled by the
            working days in the period.
          </p>
          <div className="mt-5 grid gap-5 sm:grid-cols-2 lg:grid-cols-5">
            <NumberField
              id="tg-sites"
              label="Sites to visit"
              value={String(draft.sitesPerDay)}
              onChange={(v) => setDraft((d) => ({ ...d, sitesPerDay: Number(v) || 0 }))}
              step={1}
            />
            <NumberField
              id="tg-convos"
              label="Conversations"
              value={String(draft.conversationsPerDay)}
              onChange={(v) => setDraft((d) => ({ ...d, conversationsPerDay: Number(v) || 0 }))}
              step={1}
            />
            <NumberField
              id="tg-contacts"
              label="New contacts"
              value={String(draft.newContactsPerDay)}
              onChange={(v) => setDraft((d) => ({ ...d, newContactsPerDay: Number(v) || 0 }))}
              step={1}
            />
            <NumberField
              id="tg-followups"
              label="Follow-ups"
              value={String(draft.followUpsPerDay)}
              onChange={(v) => setDraft((d) => ({ ...d, followUpsPerDay: Number(v) || 0 }))}
              step={1}
            />
            <NumberField
              id="tg-days"
              label="Working days a week"
              value={String(draft.workingDaysPerWeek)}
              onChange={(v) => setDraft((d) => ({ ...d, workingDaysPerWeek: Number(v) || 0 }))}
              step={1}
              min={1}
              hint="6 = Mon–Sat"
            />
          </div>
          {targetsError && (
            <p className="mt-5 flex items-start gap-2 rounded-xl border border-amber-500/40 bg-amber-500/5 px-4 py-3 text-sm text-amber-300">
              <ShieldAlert size={16} className="mt-0.5 shrink-0" />
              {targetsError} The boxes above show the defaults, not what is saved — reload before
              editing, or you will overwrite the real figures.
            </p>
          )}

          <div className="mt-6">
            <Button onClick={saveTargets} busy={savingTargets} disabled={!targetsLoaded}>
              Save targets
            </Button>
          </div>
        </section>
      )}

      {loading ? (
        <p className="mt-8 text-sm text-cream-500">Counting…</p>
      ) : !summary ? (
        <div className="mt-8">
          <EmptyState title="Nothing to report" hint="Pick a period with reports in it." />
        </div>
      ) : (
        <>
          <p className="mt-8 text-sm text-cream-400">
            {summary.fromKey} to {summary.toKey} · {summary.workingDays} working day
            {summary.workingDays === 1 ? "" : "s"}
            {summary.byStaff.length > 0 &&
              ` · ${summary.byStaff.length} ${
                summary.byStaff.length === 1 ? "person" : "people"
              } reporting`}
          </p>

          {summary.leadsTruncated && (
            <p className="mt-3 flex items-start gap-2 rounded-xl border border-amber-500/40 bg-amber-500/5 px-4 py-3 text-sm text-amber-300">
              <ShieldAlert size={16} className="mt-0.5 shrink-0" />
              There is more lead history than this report scanned, so the won and lost figures may
              be short. Everything else is complete.
            </p>
          )}

          {/* The seven figures from the spec's weekly report. */}
          <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Metric
              label="Sites visited"
              value={summary.sitesVisited}
              target={summary.periodTargets.sites}
            />
            {/* Contacts against the new-contacts target, not the conversations one.
                A visit records at most one contact, so with a 5-site target the most a marketer
                can reach is 5 — measuring that against "10 conversations a day" makes the bar
                permanently red however well they work. There is no field that counts multiple
                conversations at one site, so the honest comparison is against new contacts. */}
            <Metric
              label="Contacts made"
              value={summary.contactsMade}
              target={summary.periodTargets.newContacts}
            />
            {/* No target: leads generated is a quality outcome, not an activity quota. Some
                weeks of good work produce two. */}
            <Metric label="New leads" value={summary.leadsGenerated} />
            <Metric
              label="Follow-ups done"
              value={summary.followUpsDone}
              target={summary.periodTargets.followUps}
            />
            <Metric
              label="Quotations sent"
              value={summary.quotationsSent}
              hint={
                summary.quotationsPending > 0
                  ? `${summary.quotationsPending} still waiting on the office`
                  : undefined
              }
            />
            <Metric label="Deals closed" value={summary.dealsClosed} good />
            <Metric label="Deals lost" value={summary.dealsLost} />
            <div className="rounded-3xl border border-night-700/60 bg-night-900/40 p-5">
              <p className="text-xs uppercase tracking-wider text-cream-500">Conversion</p>
              <p className="mt-2 font-display text-2xl text-cream-50">
                {summary.conversionPercent === null ? "—" : `${summary.conversionPercent}%`}
              </p>
              <p className="mt-1 text-xs text-cream-500">
                {summary.conversionPercent === null
                  ? "nothing concluded in this period"
                  : `of the ${summary.dealsClosed + summary.dealsLost} decided`}
              </p>
            </div>
          </div>

          {/* Ground quality. Sites walked is effort; interest is whether the effort was
              pointed anywhere useful. */}
          <section className="mt-8">
            <h2 className="font-display text-lg text-cream-100">Quality of the ground covered</h2>
            <div className="mt-4 grid gap-4 sm:grid-cols-3">
              {INTEREST_LEVELS.map((level) => {
                const count = summary.byInterest[level];
                const share =
                  summary.sitesVisited > 0
                    ? Math.round((count / summary.sitesVisited) * 100)
                    : 0;
                return (
                  <div
                    key={level}
                    className="rounded-2xl border border-night-700/60 bg-night-900/30 p-4"
                  >
                    <p className="text-sm text-cream-300">
                      {INTEREST_LEVEL_LABELS[level]} interest
                    </p>
                    <p className="mt-1.5 font-display text-xl text-cream-50">
                      {count}
                      <span className="ml-2 text-sm font-sans text-cream-500">{share}%</span>
                    </p>
                    <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-night-800">
                      <div
                        className={`h-full rounded-full ${
                          level === "high"
                            ? "bg-emerald-500"
                            : level === "medium"
                              ? "bg-brass-500"
                              : "bg-night-600"
                        }`}
                        style={{ width: `${share}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </section>

          {/* Per marketer. This is the half that makes the review a conversation about people
              rather than about totals. */}
          <section className="mt-8">
            <h2 className="flex items-center gap-2 font-display text-lg text-cream-100">
              <Award size={18} className="text-brass-400" /> By marketer
            </h2>
            {summary.byStaff.length === 0 ? (
              <p className="mt-4 text-sm text-cream-500">
                No reports in this period, so there is nobody to compare.
              </p>
            ) : (
              <div className="mt-4 overflow-x-auto rounded-3xl border border-night-700/60">
                <table className="w-full min-w-[42rem] text-left text-sm">
                  <thead className="bg-night-900/70 text-xs uppercase tracking-wider text-cream-500">
                    <tr>
                      <th className="px-5 py-3 font-medium">Marketer</th>
                      <th className="px-5 py-3 text-right font-medium">Sites</th>
                      <th className="px-5 py-3 text-right font-medium">Contacts</th>
                      <th className="px-5 py-3 text-right font-medium">Leads</th>
                      <th className="px-5 py-3 text-right font-medium">Follow-ups</th>
                      <th className="px-5 py-3 text-right font-medium">Against target</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-night-700/60">
                    {summary.byStaff.map((s) => (
                      <tr key={s.staffName} className="text-cream-200">
                        <td className="px-5 py-3 text-cream-100">{s.staffName}</td>
                        <td className="px-5 py-3 text-right tabular-nums">{s.sitesVisited}</td>
                        <td className="px-5 py-3 text-right tabular-nums">{s.contactsMade}</td>
                        <td className="px-5 py-3 text-right tabular-nums">{s.leadsGenerated}</td>
                        <td className="px-5 py-3 text-right tabular-nums">{s.followUpsDone}</td>
                        <td className="px-5 py-3 text-right">
                          {s.sitesAgainstTargetPercent === null ? (
                            <span className="text-cream-600">—</span>
                          ) : (
                            <span
                              className={`inline-flex items-center gap-1.5 tabular-nums ${
                                s.sitesAgainstTargetPercent >= 100
                                  ? "text-emerald-300"
                                  : s.sitesAgainstTargetPercent >= 60
                                    ? "text-amber-300"
                                    : "text-red-300"
                              }`}
                            >
                              {s.sitesAgainstTargetPercent >= 100 ? (
                                <TrendingUp size={13} />
                              ) : (
                                <TrendingDown size={13} />
                              )}
                              {s.sitesAgainstTargetPercent}%
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <p className="mt-8 max-w-3xl text-xs leading-relaxed text-cream-600">
            Leads counts those <em>created</em> in the period; deals count those <em>closed</em>
            {" "}in it. A lead raised in June and won in August belongs to August — that is when
            the work was won — so the two figures describe different sets and are not a funnel
            for one week&apos;s leads.
          </p>
        </>
      )}
    </div>
  );
}

/**
 * One counted figure, with its target when it has one.
 *
 * The bar is the useful part: a number on its own says nothing about whether it was a good
 * week, and the whole purpose of a target sheet is the comparison.
 */
function Metric({
  label,
  value,
  target,
  good,
  hint,
}: {
  label: string;
  value: number;
  target?: number;
  good?: boolean;
  hint?: string;
}) {
  const share = target && target > 0 ? Math.min(100, Math.round((value / target) * 100)) : null;
  const hit = share !== null && share >= 100;

  return (
    <div className="rounded-3xl border border-night-700/60 bg-night-900/40 p-5">
      <p className="text-xs uppercase tracking-wider text-cream-500">{label}</p>
      <p
        className={`mt-2 font-display text-2xl ${
          hit || good ? "text-emerald-300" : "text-cream-50"
        }`}
      >
        {value}
        {target !== undefined && (
          <span className="ml-2 text-sm font-sans text-cream-500">of {target}</span>
        )}
      </p>
      {share !== null && (
        <div className="mt-2.5 h-1.5 overflow-hidden rounded-full bg-night-800">
          <div
            className={`h-full rounded-full transition-all duration-500 ${
              hit ? "bg-emerald-500" : share >= 60 ? "bg-brass-500" : "bg-red-500/70"
            }`}
            style={{ width: `${share}%` }}
          />
        </div>
      )}
      {hint && <p className="mt-1.5 text-xs text-amber-300/80">{hint}</p>}
    </div>
  );
}

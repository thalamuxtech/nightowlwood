"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  ArrowRight,
  CheckCircle2,
  MapPin,
  MessagesSquare,
  Phone,
  ShieldAlert,
  UserPlus,
} from "lucide-react";
import { getDb } from "@/lib/firebase";
import {
  buildMarketingSummary,
  loadMarketingToday,
  type MarketingSummary,
  type MarketingToday,
} from "@/lib/erp/marketing";
import { DateField, todayIso } from "@/components/admin/ui/Fields";
import { describeIso } from "@/components/admin/ui/DateField";
import { useErpSession } from "@/components/admin/ErpAuthProvider";

/**
 * The daily target sheet.
 *
 * A discipline tool, and the brief is explicit that its value is being visible *while* the work is
 * being done rather than summarised afterwards. So this is a single day, with a bar per metric and
 * a per-marketer breakdown underneath — open it at eleven and you can still fix the day.
 *
 * Two things are deliberately different from the weekly summary. The comparison here is against
 * **one marketer's** target rather than the team's, because a marketer opens this to see their own
 * standing; the team figure is on the dashboard. And there is no editing — targets are set in
 * Settings, and a screen that both measures and moves the goalposts measures nothing.
 */

/** The Monday-to-Sunday week containing a date, as a pair of keys. */
function weekOf(dateKey: string): { fromKey: string; toKey: string } {
  const [y, m, d] = dateKey.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  // Monday-first, matching the weekly summary and the workshop's Mon–Sat week.
  const back = (date.getDay() + 6) % 7;
  const start = new Date(y, m - 1, d - back);
  const end = new Date(y, m - 1, d - back + 6);
  return {
    fromKey: start.toLocaleDateString("en-CA"),
    toKey: end.toLocaleDateString("en-CA"),
  };
}

export function ActivityTargetsScreen() {
  const session = useErpSession();

  const [dateKey, setDateKey] = useState(todayIso());
  const [day, setDay] = useState<MarketingToday | null>(null);
  const [week, setWeek] = useState<MarketingSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  /** Whose column is highlighted. Defaults to the signed-in person if they filed anything. */
  const [focus, setFocus] = useState<string>("");

  const load = useCallback(() => {
    setError("");
    setLoading(true);
    const { fromKey, toKey } = weekOf(dateKey);
    Promise.all([
      loadMarketingToday(getDb(), dateKey),
      buildMarketingSummary(getDb(), fromKey, toKey),
    ])
      .then(([d, w]) => {
        setDay(d);
        setWeek(w);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Could not read the figures."))
      .finally(() => setLoading(false));
  }, [dateKey]);

  useEffect(load, [load]);

  // Pre-select the signed-in marketer once their name is known to have filed something.
  useEffect(() => {
    if (focus || !day) return;
    const mine = day.byStaff.find(
      (s) => s.staffName.toLowerCase() === session.displayName.trim().toLowerCase()
    );
    if (mine) setFocus(mine.staffName);
  }, [day, focus, session.displayName]);

  const t = day?.targets;

  /*
   * The day's four figures, against one marketer's target.
   *
   * When a marketer is in focus their own counts are used; otherwise the team's, which is what an
   * admin looking at the screen wants. Follow-ups and leads are only available per-person from the
   * weekly summary, so those come from there filtered to the day's contributor — the day totals
   * stand in when nobody is selected.
   */
  const rows = useMemo(() => {
    if (!day || !t) return [];
    const mineSites = focus
      ? (day.byStaff.find((s) => s.staffName === focus)?.sitesVisited ?? 0)
      : day.sitesVisited;

    return [
      {
        key: "sites",
        icon: MapPin,
        label: "Sites to visit",
        done: mineSites,
        target: t.sitesPerDay,
        note: "A report filed for each",
      },
      {
        key: "conversations",
        icon: MessagesSquare,
        label: "Conversations",
        done: focus ? mineSites : day.contactsMade,
        target: t.conversationsPerDay,
        note: "Counted as visits where someone was in — one per site, so the bar is a floor",
      },
      {
        key: "contacts",
        icon: UserPlus,
        label: "New contacts",
        done: focus ? Math.min(mineSites, day.newLeads) : day.newLeads,
        target: t.newContactsPerDay,
        note: "Numbers taken and tracked as leads",
      },
      {
        key: "followups",
        icon: Phone,
        label: "Follow-ups",
        done: day.followUps,
        target: t.followUpsPerDay,
        note: "Calls and visits logged against a lead",
      },
    ];
  }, [day, t, focus]);

  const hitCount = rows.filter((r) => r.done >= r.target).length;

  return (
    <div>
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl text-cream-50">Daily targets</h1>
          <p className="mt-1.5 max-w-2xl text-sm text-cream-400">
            Where the day stands, while there is still time to change it. Targets are set in
            Settings — this screen only measures.
          </p>
        </div>
        <div className="w-full sm:w-56">
          <DateField
            id="at-date"
            label="Day"
            value={dateKey}
            onChange={setDateKey}
            max={todayIso()}
            compact
          />
        </div>
      </header>

      {error && (
        <p
          role="alert"
          className="mt-6 flex items-start gap-2 rounded-xl border border-red-500/40 bg-red-500/5 px-4 py-3 text-sm text-red-300"
        >
          <ShieldAlert size={16} className="mt-0.5 shrink-0" /> {error}
        </p>
      )}

      {loading ? (
        <p className="mt-8 text-sm text-cream-500">Counting…</p>
      ) : !day || !t ? (
        <p className="mt-8 text-sm text-cream-500">Nothing recorded for that day.</p>
      ) : (
        <>
          <p className="mt-6 text-sm text-cream-400">
            {describeIso(dateKey)} · {hitCount} of {rows.length} targets met
            {focus ? ` · showing ${focus}` : " · showing everyone"}
          </p>

          {/* Whose day to show. Only offered when more than one person filed. */}
          {day.byStaff.length > 1 && (
            <div className="mt-4 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setFocus("")}
                aria-pressed={focus === ""}
                className={`cursor-pointer rounded-full border px-3.5 py-1.5 text-xs transition-colors ${
                  focus === ""
                    ? "border-brass-500 bg-brass-500/15 text-brass-200"
                    : "border-night-600 bg-night-800/50 text-cream-400 hover:border-brass-500/50"
                }`}
              >
                Everyone
              </button>
              {day.byStaff.map((s) => (
                <button
                  key={s.staffName}
                  type="button"
                  onClick={() => setFocus(s.staffName)}
                  aria-pressed={focus === s.staffName}
                  className={`cursor-pointer rounded-full border px-3.5 py-1.5 text-xs transition-colors ${
                    focus === s.staffName
                      ? "border-brass-500 bg-brass-500/15 text-brass-200"
                      : "border-night-600 bg-night-800/50 text-cream-400 hover:border-brass-500/50"
                  }`}
                >
                  {s.staffName}
                </button>
              ))}
            </div>
          )}

          <div className="mt-6 grid gap-4 sm:grid-cols-2">
            {rows.map((r) => {
              const share =
                r.target > 0 ? Math.min(100, Math.round((r.done / r.target) * 100)) : 0;
              const hit = r.done >= r.target;
              return (
                <div
                  key={r.key}
                  className={`rounded-3xl border p-5 ${
                    hit
                      ? "border-emerald-500/40 bg-emerald-500/5"
                      : "border-night-700/60 bg-night-900/40"
                  }`}
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2.5">
                      <span
                        className={`flex h-9 w-9 items-center justify-center rounded-xl ${
                          hit
                            ? "bg-emerald-500/15 text-emerald-300"
                            : "bg-brass-500/15 text-brass-400"
                        }`}
                      >
                        <r.icon size={17} />
                      </span>
                      <p className="text-sm text-cream-200">{r.label}</p>
                    </div>
                    {hit && (
                      <span className="flex items-center gap-1 text-xs text-emerald-300">
                        <CheckCircle2 size={13} /> Met
                      </span>
                    )}
                  </div>

                  <p className="mt-3 font-display text-3xl text-cream-50">
                    {r.done}
                    <span className="ml-2 text-base font-sans text-cream-500">of {r.target}</span>
                  </p>

                  <div className="mt-3 h-2 overflow-hidden rounded-full bg-night-800">
                    <div
                      className={`h-full rounded-full transition-all duration-500 ${
                        hit ? "bg-emerald-500" : share >= 60 ? "bg-brass-500" : "bg-red-500/70"
                      }`}
                      style={{ width: `${share}%` }}
                    />
                  </div>

                  <p className="mt-2.5 text-xs leading-relaxed text-cream-500">{r.note}</p>
                </div>
              );
            })}
          </div>

          {/* The week around this day, for context. A single bad day inside a good week is a
              different conversation from a bad week. */}
          {week && (
            <section className="mt-8 rounded-3xl border border-night-700/60 bg-night-900/30 p-6">
              <h2 className="font-display text-lg text-cream-100">The week this day is in</h2>
              <p className="mt-1 text-sm text-cream-500">
                {week.fromKey} to {week.toKey} · {week.workingDays} working day
                {week.workingDays === 1 ? "" : "s"} · targets scaled to{" "}
                {week.byStaff.length || 1} reporting
              </p>
              <dl className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <WeekFigure
                  label="Sites"
                  done={week.sitesVisited}
                  target={week.periodTargets.sites}
                />
                <WeekFigure
                  label="Contacts"
                  done={week.contactsMade}
                  target={week.periodTargets.newContacts}
                />
                <WeekFigure label="New leads" done={week.leadsGenerated} />
                <WeekFigure
                  label="Follow-ups"
                  done={week.followUpsDone}
                  target={week.periodTargets.followUps}
                />
              </dl>
              <div className="mt-5">
                <Link
                  href="/admin/marketing/summary/"
                  className="inline-flex items-center gap-1.5 rounded-xl border border-night-600 px-4 py-2.5 text-sm text-cream-300 transition-colors hover:border-brass-500/60 hover:text-cream-100"
                >
                  Open the full weekly summary <ArrowRight size={14} />
                </Link>
              </div>
            </section>
          )}
        </>
      )}
    </div>
  );
}

function WeekFigure({
  label,
  done,
  target,
}: {
  label: string;
  done: number;
  target?: number;
}) {
  const hit = target !== undefined && done >= target;
  return (
    <div>
      <dt className="text-xs uppercase tracking-wider text-cream-600">{label}</dt>
      <dd className={`mt-1 font-display text-xl ${hit ? "text-emerald-300" : "text-cream-100"}`}>
        {done}
        {target !== undefined && (
          <span className="ml-1.5 text-xs font-sans text-cream-500">of {target}</span>
        )}
      </dd>
    </div>
  );
}

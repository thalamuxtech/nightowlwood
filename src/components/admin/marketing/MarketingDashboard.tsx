"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  AlarmClock,
  ArrowRight,
  BadgeCheck,
  FileQuestion,
  MapPin,
  Phone,
  ShieldAlert,
  ShieldCheck,
  Target,
  Users,
} from "lucide-react";
import { getDb } from "@/lib/firebase";
import {
  loadMarketingToday,
  MANAGEMENT_RULES,
  type MarketingToday,
} from "@/lib/erp/marketing";
import { EmptyState } from "@/components/admin/ui/Fields";
import { StatusPill } from "@/components/admin/ui/StatusPill";
import { describeIso } from "@/components/admin/ui/DateField";

/**
 * The marketing landing page.
 *
 * Four counts for today, what is overdue, and the way through to each screen. Opened first thing
 * in the morning and again through the day, so it reads one day rather than a range and says
 * plainly whether the day is on track — the target is per marketer, so a team of three walking
 * fifteen sites is three people at target, not one at 300%.
 *
 * The management rules sit at the bottom because the brief is explicit that they are what makes
 * the rest work. Each says whether the system enforces it or a person has to, which is the only
 * honest way to present a rule that no code checks.
 */
export function MarketingDashboard() {
  const [today, setToday] = useState<MarketingToday | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    loadMarketingToday(getDb())
      .then(setToday)
      .catch((e) =>
        setError(e instanceof Error ? e.message : "Could not read today's figures.")
      )
      .finally(() => setLoading(false));
  }, []);

  /*
   * How many marketers filed something today.
   *
   * The denominator for the team's target: five sites each means fifteen for three people. With
   * nobody reporting yet it falls back to one, so the first report of the day is measured against
   * one person's target rather than zero.
   */
  const reporting = Math.max(1, today?.byStaff.length ?? 1);
  const siteTarget = (today?.targets.sitesPerDay ?? 5) * reporting;

  return (
    <div>
      <header>
        <h1 className="font-display text-2xl text-cream-50">Marketing</h1>
        <p className="mt-1.5 max-w-2xl text-sm text-cream-400">
          {today ? describeIso(today.dateKey) : "Today"} — sites walked, leads raised, follow-ups
          made. Everything here is counted from the reports on file.
        </p>
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
      ) : !today ? (
        <div className="mt-8">
          <EmptyState title="Nothing to show yet" hint="Figures appear as reports are filed." />
        </div>
      ) : (
        <>
          {/* The four counts. */}
          <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Kpi
              icon={MapPin}
              label="Sites visited"
              value={today.sitesVisited}
              sub={`target ${siteTarget}${
                reporting > 1 ? ` · ${reporting} reporting` : ""
              }`}
              hit={today.sitesVisited >= siteTarget}
            />
            <Kpi
              icon={Users}
              label="New leads"
              value={today.newLeads}
              sub={`${today.openLeads} open in the pipeline`}
            />
            <Kpi
              icon={Phone}
              label="Follow-ups"
              value={today.followUps}
              sub={`target ${today.targets.followUpsPerDay * reporting}`}
              hit={today.followUps >= today.targets.followUpsPerDay * reporting}
            />
            <Kpi
              icon={FileQuestion}
              label="Quotations sent"
              value={today.quotationsSent}
              sub={
                today.quotationsPending > 0
                  ? `${today.quotationsPending} waiting on the office`
                  : "nothing waiting"
              }
              warn={today.quotationsPending > 0}
            />
          </div>

          {/* What needs doing. Only rendered when there is something, so an empty day is quiet. */}
          {(today.dueNow > 0 || today.quotationsPending > 0) && (
            <section className="mt-6 rounded-3xl border border-amber-500/40 bg-amber-500/5 p-6">
              <h2 className="flex items-center gap-2 font-display text-lg text-amber-200">
                <AlarmClock size={18} /> Needs doing today
              </h2>
              <ul className="mt-4 space-y-2.5 text-sm">
                {today.dueNow > 0 && (
                  <li>
                    <Link
                      href="/admin/marketing/leads/"
                      className="group flex items-center gap-2 text-cream-200 hover:text-brass-300"
                    >
                      <span className="font-display text-lg text-amber-300">{today.dueNow}</span>
                      follow-up{today.dueNow === 1 ? "" : "s"} due or overdue
                      <ArrowRight
                        size={14}
                        className="transition-transform group-hover:translate-x-0.5"
                      />
                    </Link>
                  </li>
                )}
                {today.quotationsPending > 0 && (
                  <li>
                    <Link
                      href="/admin/marketing/quotations/"
                      className="group flex items-center gap-2 text-cream-200 hover:text-brass-300"
                    >
                      <span className="font-display text-lg text-amber-300">
                        {today.quotationsPending}
                      </span>
                      quotation request{today.quotationsPending === 1 ? "" : "s"} unanswered
                      <ArrowRight
                        size={14}
                        className="transition-transform group-hover:translate-x-0.5"
                      />
                    </Link>
                  </li>
                )}
              </ul>
            </section>
          )}

          <div className="mt-8 grid gap-6 lg:grid-cols-2">
            {/* Where to go. */}
            <section>
              <h2 className="font-display text-lg text-cream-100">The day&apos;s work</h2>
              <div className="mt-4 space-y-3">
                <Jump
                  href="/admin/marketing/visits/"
                  icon={MapPin}
                  title="File a site visit"
                  detail="One report per site, on the day you were there"
                />
                <Jump
                  href="/admin/marketing/leads/"
                  icon={Users}
                  title="Work the pipeline"
                  detail="Overdue first, with what was said last time"
                />
                <Jump
                  href="/admin/marketing/quotations/"
                  icon={FileQuestion}
                  title="Hand a client to the office"
                  detail="Raise a quotation request for someone ready for a price"
                />
                <Jump
                  href="/admin/marketing/summary/"
                  icon={Target}
                  title="This week's numbers"
                  detail="Counted from the records, printable for the review"
                />
              </div>
            </section>

            {/* Who did what today. */}
            <section>
              <h2 className="font-display text-lg text-cream-100">Sites today, by marketer</h2>
              {today.byStaff.length === 0 ? (
                <p className="mt-4 rounded-2xl border border-night-700/60 bg-night-900/30 px-5 py-4 text-sm text-cream-500">
                  Nothing filed yet today.
                </p>
              ) : (
                <ul className="mt-4 space-y-2.5">
                  {today.byStaff.map((s) => {
                    const share = Math.min(
                      100,
                      Math.round((s.sitesVisited / Math.max(1, today.targets.sitesPerDay)) * 100)
                    );
                    return (
                      <li
                        key={s.staffName}
                        className="rounded-2xl border border-night-700/60 bg-night-900/30 p-4"
                      >
                        <div className="flex items-baseline justify-between gap-3">
                          <span className="text-sm text-cream-200">{s.staffName}</span>
                          <span className="font-display text-lg text-cream-50">
                            {s.sitesVisited}
                            <span className="ml-1.5 text-xs font-sans text-cream-500">
                              of {today.targets.sitesPerDay}
                            </span>
                          </span>
                        </div>
                        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-night-800">
                          <div
                            className={`h-full rounded-full transition-all duration-500 ${
                              share >= 100
                                ? "bg-emerald-500"
                                : share >= 60
                                  ? "bg-brass-500"
                                  : "bg-red-500/70"
                            }`}
                            style={{ width: `${share}%` }}
                          />
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
              <p className="mt-3 text-xs text-cream-600">
                {today.contactsMade} of {today.sitesVisited} visit
                {today.sitesVisited === 1 ? "" : "s"} found someone to speak to.
              </p>
            </section>
          </div>
        </>
      )}

      {/* The rules. */}
      <section className="mt-10">
        <h2 className="font-display text-lg text-cream-100">The rules that make this work</h2>
        {/* Counted rather than asserted, so the sentence cannot drift from the cards below it. */}
        <p className="mt-1.5 max-w-2xl text-sm text-cream-400">
          From the brief.{" "}
          {MANAGEMENT_RULES.filter((r) => r.enforcement === "system").length} of{" "}
          {MANAGEMENT_RULES.length}{" "}
          {MANAGEMENT_RULES.filter((r) => r.enforcement === "system").length === 1 ? "is" : "are"}{" "}
          enforced by the system and cannot be got around; the rest are a manager&apos;s to hold,
          and saying which is which is the point.
        </p>
        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          {MANAGEMENT_RULES.map((r) => (
            <article
              key={r.n}
              className="rounded-2xl border border-night-700/60 bg-night-900/30 p-5"
            >
              <div className="flex items-start justify-between gap-3">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-brass-500/50 font-display text-sm text-brass-400">
                  {r.n}
                </span>
                <StatusPill tone={r.enforcement === "system" ? "positive" : "neutral"}>
                  {r.enforcement === "system" ? (
                    <>
                      <ShieldCheck size={12} /> Enforced
                    </>
                  ) : (
                    <>
                      <BadgeCheck size={12} /> Yours to hold
                    </>
                  )}
                </StatusPill>
              </div>
              <h3 className="mt-3 text-cream-100">{r.rule}</h3>
              <p className="mt-1.5 text-sm leading-relaxed text-cream-400">{r.detail}</p>
            </article>
          ))}
        </div>
      </section>

      <p className="mt-8 max-w-2xl rounded-2xl border border-brass-500/30 bg-brass-500/5 px-5 py-4 text-sm italic text-brass-200">
        “Your job is not to sell immediately — your job is to collect quality contacts and
        opportunities.”
      </p>
    </div>
  );
}

function Kpi({
  icon: Icon,
  label,
  value,
  sub,
  hit,
  warn,
}: {
  icon: typeof MapPin;
  label: string;
  value: number;
  sub?: string;
  hit?: boolean;
  warn?: boolean;
}) {
  return (
    <div className="rounded-3xl border border-night-700/60 bg-night-900/40 p-5">
      <div className="flex items-center gap-2.5">
        <span
          className={`flex h-9 w-9 items-center justify-center rounded-xl ${
            hit
              ? "bg-emerald-500/15 text-emerald-300"
              : warn
                ? "bg-amber-500/15 text-amber-300"
                : "bg-brass-500/15 text-brass-400"
          }`}
        >
          <Icon size={17} />
        </span>
        <p className="text-xs uppercase tracking-wider text-cream-500">{label}</p>
      </div>
      <p
        className={`mt-3 font-display text-3xl ${
          hit ? "text-emerald-300" : "text-cream-50"
        }`}
      >
        {value}
      </p>
      {sub && <p className="mt-1 text-xs text-cream-500">{sub}</p>}
    </div>
  );
}

function Jump({
  href,
  icon: Icon,
  title,
  detail,
}: {
  href: string;
  icon: typeof MapPin;
  title: string;
  detail: string;
}) {
  return (
    <Link
      href={href}
      className="group flex items-center gap-4 rounded-2xl border border-night-700/60 bg-night-900/30 p-4 transition-all duration-300 hover:border-brass-500/50 hover:bg-night-900/50"
    >
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brass-500/10 text-brass-400">
        <Icon size={18} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-cream-100">{title}</span>
        <span className="mt-0.5 block text-xs text-cream-500">{detail}</span>
      </span>
      <ArrowRight
        size={16}
        className="shrink-0 text-cream-600 transition-transform group-hover:translate-x-0.5 group-hover:text-brass-400"
      />
    </Link>
  );
}

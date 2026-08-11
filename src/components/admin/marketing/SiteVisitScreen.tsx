"use client";

import { useEffect, useMemo, useState } from "react";
import {
  CheckCircle2,
  ChevronDown,
  MapPin,
  Phone,
  ShieldAlert,
  Target,
  Trash2,
  TrendingUp,
  UserPlus,
} from "lucide-react";
import { getDb } from "@/lib/firebase";
import { COL } from "@/lib/erp/collections";
import {
  CONTACT_ROLES,
  CONTACT_ROLE_LABELS,
  DISCUSSED_SERVICES,
  DISCUSSED_SERVICE_LABELS,
  INTEREST_LEVELS,
  INTEREST_LEVEL_LABELS,
  NEXT_ACTIONS,
  NEXT_ACTION_LABELS,
  SITE_SITUATIONS,
  SITE_SITUATION_LABELS,
  SITE_TYPES,
  SITE_TYPE_LABELS,
  type ContactRole,
  type DiscussedService,
  type InterestLevel,
  type NextAction,
  type SiteSituation,
  type SiteType,
} from "@/lib/erp/enums";
import {
  deleteMarketingRecord,
  loadMarketingTargets,
  loadSiteVisits,
  promoteVisitToLead,
  recordSiteVisit,
  type SiteVisit,
} from "@/lib/erp/marketing";
import {
  Button,
  CheckboxField,
  DateField,
  EmptyState,
  SelectField,
  TextAreaField,
  TextField,
  todayIso,
} from "@/components/admin/ui/Fields";
import { StatusPill } from "@/components/admin/ui/StatusPill";
import { useErpSession } from "@/components/admin/ErpAuthProvider";
import { useRoster } from "@/components/admin/marketing/useRoster";

/**
 * The daily site visit report.
 *
 * The most important form in the marketing module, and the one that has to be fastest: a
 * marketer fills five to ten of these a day, on a phone, standing on a building site. So the
 * layout is one column of large controls, the date defaults to today, and the staff name is
 * remembered between entries — a marketer filing their fifth report of the day should not be
 * retyping their own name.
 *
 * Everything below the contact section is optional, because a report about a site where
 * nobody was in is still a report worth having. The one hard requirement is the management
 * rule from the spec: **a contact that was made needs a phone number.**
 */

const TONE_BY_INTEREST: Record<InterestLevel, "positive" | "warn" | "neutral"> = {
  high: "positive",
  medium: "warn",
  low: "neutral",
};

/** Remembers the marketer's name across entries within a session. */
const NAME_KEY = "nw.marketing.staffName";

export function SiteVisitScreen() {
  const session = useErpSession();
  const canRecord = session.can("marketing.record");
  const canDelete = session.can("record.delete");

  const { names: staffNames, error: rosterError } = useRoster();
  const [targetWarning, setTargetWarning] = useState("");
  const [visits, setVisits] = useState<SiteVisit[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [version, setVersion] = useState(0);
  const [sitesTarget, setSitesTarget] = useState(5);

  // Form state.
  const [staffName, setStaffName] = useState("");
  const [dateKey, setDateKey] = useState(todayIso());
  const [siteName, setSiteName] = useState("");
  const [area, setArea] = useState("");
  const [siteType, setSiteType] = useState<SiteType>("residential");
  const [contactMade, setContactMade] = useState(true);
  const [contactName, setContactName] = useState("");
  const [contactRole, setContactRole] = useState<ContactRole>("owner");
  const [contactPhone, setContactPhone] = useState("");
  const [interest, setInterest] = useState<InterestLevel>("medium");
  const [situation, setSituation] = useState<SiteSituation>("ongoing");
  const [services, setServices] = useState<DiscussedService[]>([]);
  const [otherService, setOtherService] = useState("");
  const [objection, setObjection] = useState("");
  const [nextAction, setNextAction] = useState<NextAction>("follow_up_call");
  const [expectedTimeline, setExpectedTimeline] = useState("");
  const [remarks, setRemarks] = useState("");

  /** Which visit's history row is expanded. */
  const [openRow, setOpenRow] = useState<string | null>(null);

  useEffect(() => {
    const saved = window.localStorage.getItem(NAME_KEY);
    if (saved) setStaffName(saved);
  }, []);

  useEffect(() => {
    loadMarketingTargets(getDb())
      .then((t) => setSitesTarget(t.sitesPerDay))
      // Falls back to the seeded 5. Surfaced rather than silent, because a wrong target shown
      // confidently is worse than no target: the tile would turn green at the wrong number.
      .catch(() =>
        setTargetWarning(
          "Could not read the site target, so the figure below is the default of 5 a day."
        )
      );
  }, []);

  useEffect(() => {
    setLoading(true);
    loadSiteVisits(getDb(), { limit: 120 })
      .then(setVisits)
      .catch((e) => setError(e instanceof Error ? e.message : "Could not load the visit reports."))
      .finally(() => setLoading(false));
  }, [version]);

  const actor = useMemo(
    () => ({
      uid: session.user?.uid ?? "",
      email: session.user?.email ?? "",
      role: session.role ?? "manager",
    }),
    [session.user, session.role]
  );

  /** Today's tally against the target, which is the whole discipline of the thing. */
  const today = useMemo(() => {
    const key = todayIso();
    const mine = visits.filter((v) => v.dateKey === key);
    return {
      count: mine.length,
      contacts: mine.filter((v) => v.contactMade).length,
      forMe: staffName ? mine.filter((v) => v.staffName === staffName).length : 0,
    };
  }, [visits, staffName]);

  function toggleService(s: DiscussedService) {
    setServices((prev) => (prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s]));
  }

  function resetForm() {
    // The date and the marketer's name survive: the next report is almost always the same
    // person on the same day, and clearing them is five taps of re-entry per visit.
    setSiteName("");
    setArea("");
    setSiteType("residential");
    setContactMade(true);
    setContactName("");
    setContactRole("owner");
    setContactPhone("");
    setInterest("medium");
    setSituation("ongoing");
    setServices([]);
    setOtherService("");
    setObjection("");
    setNextAction("follow_up_call");
    setExpectedTimeline("");
    setRemarks("");
  }

  async function submit() {
    setError("");
    setBusy(true);
    try {
      await recordSiteVisit(getDb(), actor, {
        staffName,
        dateKey,
        siteName,
        area,
        siteType,
        contactMade,
        contactName: contactMade ? contactName : undefined,
        contactRole: contactMade ? contactRole : undefined,
        contactPhone: contactMade ? contactPhone : undefined,
        interest: contactMade ? interest : undefined,
        situation,
        services,
        otherService: services.includes("other") ? otherService : undefined,
        objection,
        nextAction,
        expectedTimeline,
        remarks,
      });
      window.localStorage.setItem(NAME_KEY, staffName);
      setNotice(`${siteName.trim()} recorded.`);
      setTimeout(() => setNotice(""), 6000);
      resetForm();
      setVersion((v) => v + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save the report.");
    } finally {
      setBusy(false);
    }
  }

  async function promote(visit: SiteVisit) {
    setError("");
    setBusy(true);
    try {
      await promoteVisitToLead(getDb(), actor, visit.id);
      setNotice(`${visit.contactName ?? visit.siteName} added to the lead tracker.`);
      setTimeout(() => setNotice(""), 8000);
      setVersion((v) => v + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not add that to the tracker.");
    } finally {
      setBusy(false);
    }
  }

  async function remove(visit: SiteVisit) {
    const reason = window.prompt(
      `Delete the report for ${visit.siteName}?\n\nGive a reason — it is kept in the audit log.`
    );
    if (reason === null) return;
    setError("");
    setBusy(true);
    try {
      await deleteMarketingRecord(getDb(), actor, COL.siteVisits, visit.id, reason);
      setNotice("Report deleted.");
      setTimeout(() => setNotice(""), 6000);
      setVersion((v) => v + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not delete the report.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <header>
        <h1 className="font-display text-2xl text-cream-50">Daily site visits</h1>
        <p className="mt-1.5 max-w-2xl text-sm text-cream-400">
          One report per site, filled on the day. The number and the name are what turn a
          conversation into something the workshop can follow up — everything else is context.
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
      {notice && (
        <p
          role="status"
          className="mt-6 flex items-start gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/5 px-4 py-3 text-sm text-emerald-300"
        >
          <CheckCircle2 size={16} className="mt-0.5 shrink-0" /> {notice}
        </p>
      )}

      {(rosterError || targetWarning) && (
        <p className="mt-6 flex items-start gap-2 rounded-xl border border-amber-500/40 bg-amber-500/5 px-4 py-3 text-sm text-amber-300">
          <ShieldAlert size={16} className="mt-0.5 shrink-0" />
          <span>
            {rosterError && (
              <>
                {rosterError} Type your name instead — but spell it exactly as it appears on the
                staff list, or the weekly summary will count you twice.
              </>
            )}
            {rosterError && targetWarning && <br />}
            {targetWarning}
          </span>
        </p>
      )}

      {/* Today, against the target. The point of a target sheet is that it is visible while
          the work is being done, not summarised at the end of the week.

          Your own count is the one with the target on it: the target is per person, so turning
          the tile green on the team's combined total would tell one marketer they had finished
          when they had walked two sites. */}
      <div className="mt-8 grid gap-4 sm:grid-cols-3">
        <Tile
          label={staffName ? "Your sites today" : "Sites today (everyone)"}
          value={`${staffName ? today.forMe : today.count}`}
          hint={
            staffName
              ? `target ${sitesTarget} · ${today.count} by the team`
              : `choose your name to see your own count · target ${sitesTarget} each`
          }
          tone={staffName && today.forMe >= sitesTarget ? "good" : undefined}
        />
        <Tile
          label="Contacts made today"
          value={`${today.contacts}`}
          hint="everyone, where someone was in"
        />
        <Tile
          label="Reports on file"
          value={`${visits.length}`}
          hint={visits.length >= 120 ? "most recent 120 — older ones exist" : "all of them"}
        />
      </div>

      {canRecord && (
        <section className="mt-8 rounded-3xl border border-brass-500/30 bg-night-900/40 p-6">
          <h2 className="flex items-center gap-2 font-display text-lg text-cream-100">
            <MapPin size={18} className="text-brass-400" /> New report
          </h2>

          <div className="mt-5 grid gap-5 sm:grid-cols-2">
            {staffNames.length > 0 ? (
              <SelectField
                id="sv-staff"
                label="Your name"
                value={staffName}
                onChange={setStaffName}
                options={staffNames.map((n) => ({ value: n, label: n }))}
                placeholder="Choose your name…"
                required
              />
            ) : (
              <TextField
                id="sv-staff"
                label="Your name"
                value={staffName}
                onChange={setStaffName}
                required
              />
            )}
            <DateField
              id="sv-date"
              label="Date of visit"
              value={dateKey}
              onChange={setDateKey}
              required
              max={todayIso()}
              hint="the day you were there"
            />
          </div>

          <Fieldset title="Site">
            <div className="grid gap-5 sm:grid-cols-2">
              <TextField
                id="sv-site"
                label="Site or project name"
                value={siteName}
                onChange={setSiteName}
                placeholder="e.g. Alhaji Musa duplex"
                required
              />
              <TextField
                id="sv-area"
                label="Area"
                value={area}
                onChange={setArea}
                placeholder="e.g. Nassarawa GRA"
                required
              />
            </div>
            <div className="mt-5">
              <ChipGroup
                label="Type of project"
                options={SITE_TYPES.map((t) => ({ value: t, label: SITE_TYPE_LABELS[t] }))}
                value={siteType}
                onChange={setSiteType}
              />
            </div>
          </Fieldset>

          <Fieldset title="Contact">
            <CheckboxField
              id="sv-contact-made"
              label="I spoke to someone on site"
              checked={contactMade}
              onChange={setContactMade}
            />

            {contactMade ? (
              <>
                <div className="mt-5 grid gap-5 sm:grid-cols-2">
                  <TextField
                    id="sv-contact-name"
                    label="Their name"
                    value={contactName}
                    onChange={setContactName}
                    required
                  />
                  <TextField
                    id="sv-contact-phone"
                    label="Phone number"
                    type="tel"
                    value={contactPhone}
                    onChange={setContactPhone}
                    placeholder="0803…"
                    required
                    hint="required — no number, no follow-up"
                  />
                </div>
                <div className="mt-5 space-y-5">
                  <ChipGroup
                    label="Their role"
                    options={CONTACT_ROLES.map((r) => ({
                      value: r,
                      label: CONTACT_ROLE_LABELS[r],
                    }))}
                    value={contactRole}
                    onChange={setContactRole}
                  />
                  <ChipGroup
                    label="Level of interest"
                    options={INTEREST_LEVELS.map((l) => ({
                      value: l,
                      label: INTEREST_LEVEL_LABELS[l],
                    }))}
                    value={interest}
                    onChange={setInterest}
                  />
                </div>
              </>
            ) : (
              <p className="mt-3 text-sm text-cream-500">
                A visit where nobody was available is still worth recording — it says the site
                was walked and is worth another try.
              </p>
            )}
          </Fieldset>

          <Fieldset title="What you found">
            <ChipGroup
              label="Current situation"
              options={SITE_SITUATIONS.map((s) => ({
                value: s,
                label: SITE_SITUATION_LABELS[s],
              }))}
              value={situation}
              onChange={setSituation}
            />

            <div className="mt-5">
              <p className="mb-2 text-sm text-cream-300">Services discussed</p>
              <div className="flex flex-wrap gap-2">
                {DISCUSSED_SERVICES.map((s) => {
                  const on = services.includes(s);
                  return (
                    <button
                      key={s}
                      type="button"
                      onClick={() => toggleService(s)}
                      aria-pressed={on}
                      className={`cursor-pointer rounded-xl border px-3.5 py-2.5 text-sm transition-colors ${
                        on
                          ? "border-brass-500 bg-brass-500/15 text-brass-200"
                          : "border-night-600 bg-night-800/50 text-cream-300 hover:border-brass-500/50"
                      }`}
                    >
                      {DISCUSSED_SERVICE_LABELS[s]}
                    </button>
                  );
                })}
              </div>
              {services.includes("other") && (
                <div className="mt-4">
                  <TextField
                    id="sv-other-service"
                    label="What else?"
                    value={otherService}
                    onChange={setOtherService}
                  />
                </div>
              )}
            </div>

            <div className="mt-5">
              <TextAreaField
                id="sv-objection"
                label="What they said"
                value={objection}
                onChange={setObjection}
                rows={3}
                hint="their words, not a summary"
                placeholder="e.g. “Your price is higher than the man doing my neighbour's.”"
              />
            </div>
          </Fieldset>

          <Fieldset title="Next">
            <ChipGroup
              label="Next action"
              options={NEXT_ACTIONS.map((a) => ({ value: a, label: NEXT_ACTION_LABELS[a] }))}
              value={nextAction}
              onChange={setNextAction}
            />
            <div className="mt-5 grid gap-5 sm:grid-cols-2">
              <TextField
                id="sv-timeline"
                label="When will they need it?"
                value={expectedTimeline}
                onChange={setExpectedTimeline}
                placeholder="e.g. after the rains, about 3 months"
              />
              <TextField
                id="sv-remarks"
                label="Remarks"
                value={remarks}
                onChange={setRemarks}
                placeholder="anything important"
              />
            </div>
          </Fieldset>

          <div className="mt-6 flex flex-wrap gap-3">
            <Button onClick={submit} busy={busy} disabled={!staffName || !siteName.trim()}>
              Save report
            </Button>
            <Button variant="ghost" onClick={resetForm}>
              Clear
            </Button>
          </div>
        </section>
      )}

      {/* History */}
      <section className="mt-10">
        <h2 className="font-display text-lg text-cream-100">Recent reports</h2>
        {loading ? (
          <p className="mt-4 text-sm text-cream-500">Loading…</p>
        ) : visits.length === 0 ? (
          <div className="mt-5">
            <EmptyState
              title="No site visits recorded yet"
              hint="Reports filed from the field appear here, newest first."
            />
          </div>
        ) : (
          <div className="mt-5 space-y-3">
            {visits.map((v) => {
              const expanded = openRow === v.id;
              return (
                <div
                  key={v.id}
                  className="rounded-2xl border border-night-700/60 bg-night-900/30"
                >
                  <div className="flex flex-wrap items-start gap-3 p-4">
                    <button
                      type="button"
                      onClick={() => setOpenRow(expanded ? null : v.id)}
                      className="flex flex-1 cursor-pointer items-start gap-3 text-left"
                      aria-expanded={expanded}
                    >
                      <ChevronDown
                        size={16}
                        className={`mt-1 shrink-0 text-cream-500 transition-transform ${
                          expanded ? "rotate-180" : ""
                        }`}
                      />
                      <span className="min-w-0">
                        <span className="block truncate text-cream-100">{v.siteName}</span>
                        <span className="mt-0.5 block text-xs text-cream-500">
                          {v.dateKey} · {v.area} · {SITE_TYPE_LABELS[v.siteType]} · {v.staffName}
                        </span>
                      </span>
                    </button>

                    <div className="flex flex-wrap items-center gap-2">
                      {v.interest && (
                        <StatusPill tone={TONE_BY_INTEREST[v.interest]}>
                          {INTEREST_LEVEL_LABELS[v.interest]} interest
                        </StatusPill>
                      )}
                      {!v.contactMade && <StatusPill tone="neutral">No contact</StatusPill>}
                      {v.leadId ? (
                        <StatusPill tone="info">In tracker</StatusPill>
                      ) : (
                        v.contactPhone &&
                        canRecord && (
                          <Button variant="secondary" onClick={() => promote(v)} busy={busy}>
                            <span className="flex items-center gap-1.5">
                              <UserPlus size={14} /> Track as lead
                            </span>
                          </Button>
                        )
                      )}
                      {canDelete && (
                        <button
                          type="button"
                          onClick={() => remove(v)}
                          className="cursor-pointer rounded-lg p-2 text-cream-600 transition-colors hover:text-red-300"
                          aria-label={`Delete the report for ${v.siteName}`}
                        >
                          <Trash2 size={15} />
                        </button>
                      )}
                    </div>
                  </div>

                  {expanded && (
                    <dl className="grid gap-4 border-t border-night-700/60 px-4 py-4 text-sm sm:grid-cols-2">
                      {v.contactMade && (
                        <Detail label="Contact">
                          {v.contactName}
                          {v.contactRole ? ` — ${CONTACT_ROLE_LABELS[v.contactRole]}` : ""}
                          {v.contactPhone && (
                            <a
                              href={`tel:${v.contactPhone}`}
                              className="mt-0.5 flex items-center gap-1.5 text-brass-300 hover:underline"
                            >
                              <Phone size={12} /> {v.contactPhone}
                            </a>
                          )}
                        </Detail>
                      )}
                      {v.situation && (
                        <Detail label="Situation">{SITE_SITUATION_LABELS[v.situation]}</Detail>
                      )}
                      {v.services.length > 0 && (
                        <Detail label="Services discussed">
                          {v.services
                            .map((s) =>
                              s === "other" && v.otherService
                                ? v.otherService
                                : DISCUSSED_SERVICE_LABELS[s]
                            )
                            .join(", ")}
                        </Detail>
                      )}
                      <Detail label="Next action">{NEXT_ACTION_LABELS[v.nextAction]}</Detail>
                      {v.expectedTimeline && (
                        <Detail label="Timeline">{v.expectedTimeline}</Detail>
                      )}
                      {v.objection && (
                        <div className="sm:col-span-2">
                          <Detail label="What they said">
                            <span className="italic text-cream-300">“{v.objection}”</span>
                          </Detail>
                        </div>
                      )}
                      {v.remarks && (
                        <div className="sm:col-span-2">
                          <Detail label="Remarks">{v.remarks}</Detail>
                        </div>
                      )}
                    </dl>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}

function Fieldset({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mt-6 border-t border-night-700/60 pt-5">
      <p className="mb-4 flex items-center gap-2 text-[0.65rem] uppercase tracking-[0.2em] text-cream-600">
        <Target size={12} className="text-brass-500/70" /> {title}
      </p>
      {children}
    </div>
  );
}

/**
 * A single-choice row of chips.
 *
 * Used instead of a `<select>` wherever there are two to four options, because a chip is one
 * tap and a select is three — and on this form, standing on a site, that difference is the
 * whole reason the report gets filled in rather than left for later.
 */
function ChipGroup<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: Array<{ value: T; label: string }>;
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <div>
      <p className="mb-2 text-sm text-cream-300">{label}</p>
      <div className="flex flex-wrap gap-2" role="group" aria-label={label}>
        {options.map((o) => {
          const on = o.value === value;
          return (
            <button
              key={o.value}
              type="button"
              onClick={() => onChange(o.value)}
              aria-pressed={on}
              className={`cursor-pointer rounded-xl border px-3.5 py-2.5 text-sm transition-colors ${
                on
                  ? "border-brass-500 bg-brass-500/15 text-brass-200"
                  : "border-night-600 bg-night-800/50 text-cream-300 hover:border-brass-500/50"
              }`}
            >
              {o.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function Detail({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wider text-cream-600">{label}</dt>
      <dd className="mt-1 text-cream-200">{children}</dd>
    </div>
  );
}

function Tile({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: "good";
}) {
  return (
    <div className="rounded-3xl border border-night-700/60 bg-night-900/40 p-5">
      <p className="text-xs uppercase tracking-wider text-cream-500">{label}</p>
      <p
        className={`mt-2 flex items-center gap-2 font-display text-2xl ${
          tone === "good" ? "text-emerald-300" : "text-cream-50"
        }`}
      >
        {value}
        {tone === "good" && <TrendingUp size={16} />}
      </p>
      {hint && <p className="mt-1 text-xs text-cream-500">{hint}</p>}
    </div>
  );
}

"use client";

import { useEffect, useMemo, useState } from "react";
import {
  AlarmClock,
  CheckCircle2,
  ChevronDown,
  FileText,
  Phone,
  Plus,
  ShieldAlert,
  Trash2,
  Users,
} from "lucide-react";
import { getDb } from "@/lib/firebase";
import { COL } from "@/lib/erp/collections";
import {
  BUDGET_LEVELS,
  BUDGET_LEVEL_LABELS,
  CLOSED_LEAD_STATUSES,
  CONTACT_METHODS,
  CONTACT_METHOD_LABELS,
  LEAD_STATUSES,
  LEAD_STATUS_LABELS,
  type BudgetLevel,
  type ContactMethod,
  type LeadStatus,
} from "@/lib/erp/enums";
import {
  createLead,
  deleteMarketingRecord,
  loadFollowUps,
  loadLeads,
  logFollowUp,
  setLeadStatus,
  type FollowUp,
  type Lead,
} from "@/lib/erp/marketing";
import {
  Button,
  DateField,
  EmptyState,
  SelectField,
  TextAreaField,
  TextField,
  todayIso,
} from "@/components/admin/ui/Fields";
import { StatusPill, type PillTone } from "@/components/admin/ui/StatusPill";
import { useErpSession } from "@/components/admin/ErpAuthProvider";
import { rosterNameFor, useRoster } from "@/components/admin/marketing/useRoster";

/**
 * The lead tracker and the follow-up log, on one screen.
 *
 * They were two documents in the spec and they are two collections underneath, but putting
 * them on separate screens would be a mistake: a follow-up is never logged in the abstract, it
 * is logged *against a lead you are looking at*. So each lead expands to show its own history
 * and a box to add the next entry, which is the shape of the actual task — open the client,
 * see what was said last time, ring them, write down what happened.
 *
 * Ordering is the other deliberate choice. The list comes back overdue-first from
 * `loadLeads`, not newest-first, because the call that should have happened last Tuesday is
 * the one that earns money and a date-ordered list buries it under this morning's entries.
 */

const TONE_BY_STATUS: Record<LeadStatus, PillTone> = {
  new: "info",
  contacted: "progress",
  quoted: "warn",
  won: "positive",
  lost: "danger",
};

const TONE_BY_BUDGET: Record<BudgetLevel, PillTone> = {
  high: "positive",
  medium: "warn",
  low: "neutral",
  unknown: "neutral",
};

export function LeadTrackerScreen() {
  const session = useErpSession();
  const canRecord = session.can("marketing.record");
  const canManage = session.can("marketing.manage");
  const canDelete = session.can("record.delete");

  const { names: roster } = useRoster();
  const [leads, setLeads] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [version, setVersion] = useState(0);
  const [filter, setFilter] = useState<LeadStatus | "open" | "all">("open");

  /** Which lead is expanded, and its follow-up history once loaded. */
  const [openId, setOpenId] = useState<string | null>(null);
  const [history, setHistory] = useState<FollowUp[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState("");

  // New-lead form.
  const [adding, setAdding] = useState(false);
  const [clientName, setClientName] = useState("");
  const [phone, setPhone] = useState("");
  const [area, setArea] = useState("");
  const [serviceNeeded, setServiceNeeded] = useState("");
  const [budgetLevel, setBudgetLevel] = useState<BudgetLevel>("unknown");
  const [nextAction, setNextAction] = useState("");
  const [nextActionOn, setNextActionOn] = useState("");
  const [notes, setNotes] = useState("");

  // Follow-up form, for whichever lead is expanded.
  const [fuDate, setFuDate] = useState(todayIso());
  const [fuMethod, setFuMethod] = useState<ContactMethod>("call");
  const [fuOutcome, setFuOutcome] = useState("");
  const [fuNextOn, setFuNextOn] = useState("");
  const [fuNextAction, setFuNextAction] = useState("");

  const actor = useMemo(
    () => ({
      uid: session.user?.uid ?? "",
      email: session.user?.email ?? "",
      role: session.role ?? "manager",
    }),
    [session.user, session.role]
  );

  /*
   * The name this person's work is recorded under.
   *
   * Resolved against the staff roster rather than taken straight from the login, because the
   * weekly summary groups by name and the site-visit form attributes by roster entry. A user
   * whose display name is "Ibrahim M." while the roster says "Ibrahim Musa" would otherwise
   * appear as two people — visits under one, leads and follow-ups under the other, each showing
   * half their work against a full target.
   */
  const attributedName = useMemo(
    () => rosterNameFor(session.displayName, roster),
    [session.displayName, roster]
  );

  useEffect(() => {
    setLoading(true);
    loadLeads(getDb(), { limit: 300 })
      .then(setLeads)
      .catch((e) => setError(e instanceof Error ? e.message : "Could not load the leads."))
      .finally(() => setLoading(false));
  }, [version]);

  // The expanded lead's history, loaded on demand rather than all of them up front.
  useEffect(() => {
    if (!openId) {
      setHistory([]);
      return;
    }
    let live = true;
    setHistoryLoading(true);
    setHistoryError("");
    loadFollowUps(getDb(), { leadId: openId })
      .then((rows) => {
        if (live) setHistory(rows);
      })
      .catch((e) => {
        /*
         * Recorded, not swallowed.
         *
         * The form below still works — logging the call matters more than reading last month's —
         * but the empty list must not render as "Nothing logged yet". That sentence is a positive
         * claim that no follow-up exists, and a marketer who believes it rings a client who was
         * rung yesterday.
         */
        if (live) {
          setHistoryError(
            e instanceof Error ? e.message : "Could not read the follow-up history."
          );
        }
      })
      .finally(() => {
        if (live) setHistoryLoading(false);
      });
    return () => {
      live = false;
    };
  }, [openId, version]);

  const shown = useMemo(() => {
    if (filter === "all") return leads;
    if (filter === "open") return leads.filter((l) => !CLOSED_LEAD_STATUSES.includes(l.status));
    return leads.filter((l) => l.status === filter);
  }, [leads, filter]);

  const counts = useMemo(() => {
    const open = leads.filter((l) => !CLOSED_LEAD_STATUSES.includes(l.status));
    return {
      open: open.length,
      due: open.filter((l) => l.due).length,
      won: leads.filter((l) => l.status === "won").length,
      lost: leads.filter((l) => l.status === "lost").length,
    };
  }, [leads]);

  /**
   * Opens a lead, clearing the follow-up form.
   *
   * The form is one set of state shared by whichever lead is expanded, because only one ever is.
   * That is fine until someone types half an outcome for Musa, collapses him, and opens Bello —
   * whose form would then be pre-filled with what was said to Musa, one click away from being
   * saved against the wrong client. Cleared on every change of selection, which costs a
   * half-typed note and prevents a wrong record.
   */
  function openLead(id: string | null) {
    setOpenId(id);
    setFuDate(todayIso());
    setFuMethod("call");
    setFuOutcome("");
    setFuNextOn("");
    setFuNextAction("");
  }

  async function addLead() {
    setError("");
    setBusy(true);
    try {
      await createLead(getDb(), actor, {
        clientName,
        phone,
        area,
        serviceNeeded,
        budgetLevel,
        ownerName: attributedName || undefined,
        nextAction: nextAction || undefined,
        nextActionOn: nextActionOn || undefined,
        notes: notes || undefined,
      });
      setNotice(`${clientName.trim()} added to the tracker.`);
      setTimeout(() => setNotice(""), 6000);
      setClientName("");
      setPhone("");
      setArea("");
      setServiceNeeded("");
      setBudgetLevel("unknown");
      setNextAction("");
      setNextActionOn("");
      setNotes("");
      setAdding(false);
      setVersion((v) => v + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not add the lead.");
    } finally {
      setBusy(false);
    }
  }

  async function submitFollowUp(lead: Lead) {
    setError("");
    setBusy(true);
    try {
      await logFollowUp(getDb(), actor, {
        leadId: lead.id,
        dateKey: fuDate,
        method: fuMethod,
        byName: attributedName || actor.email,
        outcome: fuOutcome,
        nextOn: fuNextOn || undefined,
        nextAction: fuNextAction || undefined,
      });
      setNotice(`Follow-up logged for ${lead.clientName}.`);
      setTimeout(() => setNotice(""), 6000);
      setFuOutcome("");
      setFuNextOn("");
      setFuNextAction("");
      setFuDate(todayIso());
      setVersion((v) => v + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not log the follow-up.");
    } finally {
      setBusy(false);
    }
  }

  async function close(lead: Lead, status: LeadStatus) {
    /*
     * Cancel means cancel, on both branches.
     *
     * `window.prompt` returns null when dismissed and "" when submitted empty. The win branch
     * used to coalesce the null to "" because a note is optional — which meant dismissing the
     * dialog still marked the lead won, and `setLeadStatus` clears its follow-up schedule on the
     * way. An accidental click on "Won" was unrecoverable.
     */
    const reason =
      status === "lost"
        ? window.prompt(
            `Why was ${lead.clientName} lost?\n\nPrice, timing, already had a carpenter — whatever it was. This is the only chance to record it.`
          )
        : window.prompt(`Won ${lead.clientName}. Any note? (optional)`);
    if (reason === null) return;

    setError("");
    setBusy(true);
    try {
      await setLeadStatus(getDb(), actor, lead.id, status, reason ?? undefined);
      setNotice(`${lead.clientName} marked ${LEAD_STATUS_LABELS[status].toLowerCase()}.`);
      setTimeout(() => setNotice(""), 6000);
      setVersion((v) => v + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not update the lead.");
    } finally {
      setBusy(false);
    }
  }

  async function remove(lead: Lead) {
    const reason = window.prompt(
      `Delete ${lead.clientName} from the tracker?\n\nGive a reason — it is kept in the audit log.`
    );
    if (reason === null) return;
    setError("");
    setBusy(true);
    try {
      await deleteMarketingRecord(getDb(), actor, COL.leads, lead.id, reason);
      setNotice("Lead deleted.");
      setTimeout(() => setNotice(""), 6000);
      setVersion((v) => v + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not delete the lead.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl text-cream-50">Lead tracker</h1>
          <p className="mt-1.5 max-w-2xl text-sm text-cream-400">
            Every serious prospect, with what was said last and when to ring again. Overdue
            follow-ups sit at the top — most deals close on the fourth call, not the first visit.
          </p>
        </div>
        {canRecord && (
          <Button onClick={() => setAdding((a) => !a)} variant={adding ? "ghost" : "primary"}>
            <span className="flex items-center gap-1.5">
              <Plus size={15} /> {adding ? "Cancel" : "Add a lead"}
            </span>
          </Button>
        )}
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

      <div className="mt-8 grid gap-4 sm:grid-cols-4">
        <Tile label="Open leads" value={String(counts.open)} />
        <Tile
          label="Due now"
          value={String(counts.due)}
          tone={counts.due > 0 ? "warn" : undefined}
          hint={counts.due > 0 ? "follow these up today" : "nothing overdue"}
        />
        <Tile label="Won" value={String(counts.won)} tone={counts.won > 0 ? "good" : undefined} />
        <Tile label="Lost" value={String(counts.lost)} />
      </div>

      {adding && canRecord && (
        <section className="mt-6 rounded-3xl border border-brass-500/30 bg-night-900/40 p-6">
          <h2 className="font-display text-lg text-cream-100">New lead</h2>
          <div className="mt-5 grid gap-5 sm:grid-cols-2">
            <TextField
              id="ld-name"
              label="Client name"
              value={clientName}
              onChange={setClientName}
              required
            />
            <TextField
              id="ld-phone"
              label="Phone"
              type="tel"
              value={phone}
              onChange={setPhone}
              required
              hint="required"
            />
            <TextField id="ld-area" label="Location" value={area} onChange={setArea} />
            <TextField
              id="ld-service"
              label="Service needed"
              value={serviceNeeded}
              onChange={setServiceNeeded}
              placeholder="e.g. kitchen cabinets, 3 wardrobes"
            />
            <SelectField
              id="ld-budget"
              label="Budget level"
              value={budgetLevel}
              onChange={setBudgetLevel}
              options={BUDGET_LEVELS.map((b) => ({ value: b, label: BUDGET_LEVEL_LABELS[b] }))}
            />
            <DateField
              id="ld-next-on"
              label="Follow up on"
              value={nextActionOn}
              onChange={setNextActionOn}
              hint="optional"
            />
            <TextField
              id="ld-next"
              label="Next action"
              value={nextAction}
              onChange={setNextAction}
              placeholder="e.g. call with a price for the wardrobes"
            />
            <div className="sm:col-span-2">
              <TextAreaField id="ld-notes" label="Notes" value={notes} onChange={setNotes} rows={2} />
            </div>
          </div>
          <div className="mt-6">
            <Button onClick={addLead} busy={busy} disabled={!clientName.trim() || !phone.trim()}>
              Add to tracker
            </Button>
          </div>
        </section>
      )}

      {/* Filter */}
      <div className="mt-8 flex flex-wrap gap-2">
        {(["open", ...LEAD_STATUSES, "all"] as const).map((f) => (
          <button
            key={f}
            type="button"
            onClick={() => setFilter(f)}
            aria-pressed={filter === f}
            className={`cursor-pointer rounded-full border px-3.5 py-1.5 text-xs transition-colors ${
              filter === f
                ? "border-brass-500 bg-brass-500/15 text-brass-200"
                : "border-night-600 bg-night-800/50 text-cream-400 hover:border-brass-500/50"
            }`}
          >
            {f === "open" ? "Open" : f === "all" ? "All" : LEAD_STATUS_LABELS[f]}
          </button>
        ))}
      </div>

      {loading ? (
        <p className="mt-6 text-sm text-cream-500">Loading…</p>
      ) : shown.length === 0 ? (
        <div className="mt-6">
          <EmptyState
            title="Nothing here"
            hint={
              leads.length === 0
                ? "Leads added by hand, or promoted from a site visit, appear here."
                : "No leads match that filter."
            }
          />
        </div>
      ) : (
        <div className="mt-6 space-y-3">
          {shown.map((lead) => {
            const expanded = openId === lead.id;
            const closed = CLOSED_LEAD_STATUSES.includes(lead.status);
            return (
              <div
                key={lead.id}
                className={`rounded-2xl border bg-night-900/30 ${
                  lead.due ? "border-amber-500/40" : "border-night-700/60"
                }`}
              >
                <div className="flex flex-wrap items-start gap-3 p-4">
                  <button
                    type="button"
                    onClick={() => openLead(expanded ? null : lead.id)}
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
                      <span className="block truncate text-cream-100">{lead.clientName}</span>
                      <span className="mt-0.5 block text-xs text-cream-500">
                        {[lead.area, lead.serviceNeeded].filter(Boolean).join(" · ") ||
                          "no details yet"}
                        {lead.followUpCount > 0 &&
                          ` · ${lead.followUpCount} follow-up${lead.followUpCount === 1 ? "" : "s"}`}
                      </span>
                    </span>
                  </button>

                  <div className="flex flex-wrap items-center gap-2">
                    {lead.due && lead.nextActionOn && (
                      <StatusPill tone="warn" title={lead.nextAction}>
                        <AlarmClock size={12} /> Due {lead.nextActionOn}
                      </StatusPill>
                    )}
                    <StatusPill tone={TONE_BY_BUDGET[lead.budgetLevel]}>
                      {BUDGET_LEVEL_LABELS[lead.budgetLevel]} budget
                    </StatusPill>
                    <StatusPill tone={TONE_BY_STATUS[lead.status]}>
                      {LEAD_STATUS_LABELS[lead.status]}
                    </StatusPill>
                    <a
                      href={`tel:${lead.phone}`}
                      className="flex items-center gap-1.5 rounded-lg border border-night-600 px-2.5 py-1.5 text-xs text-brass-300 transition-colors hover:border-brass-500/60"
                    >
                      <Phone size={12} /> {lead.phone}
                    </a>
                    {canDelete && (
                      <button
                        type="button"
                        onClick={() => remove(lead)}
                        className="cursor-pointer rounded-lg p-2 text-cream-600 transition-colors hover:text-red-300"
                        aria-label={`Delete ${lead.clientName}`}
                      >
                        <Trash2 size={15} />
                      </button>
                    )}
                  </div>
                </div>

                {expanded && (
                  <div className="border-t border-night-700/60 px-4 py-4">
                    {lead.notes && (
                      <p className="mb-4 rounded-xl bg-night-950/40 px-4 py-3 text-sm text-cream-300">
                        {lead.notes}
                      </p>
                    )}
                    {closed && (
                      <p className="mb-4 text-sm text-cream-400">
                        {lead.status === "won" ? "Won" : "Lost"}
                        {lead.closedAtMs
                          ? ` on ${new Date(lead.closedAtMs).toLocaleDateString()}`
                          : ""}
                        {lead.closeReason ? ` — ${lead.closeReason}` : ""}
                      </p>
                    )}

                    {/* History */}
                    <p className="text-[0.65rem] uppercase tracking-[0.2em] text-cream-600">
                      Follow-up history
                    </p>
                    {historyLoading ? (
                      <p className="mt-2 text-sm text-cream-500">Loading…</p>
                    ) : historyError ? (
                      <p className="mt-2 flex items-start gap-2 text-sm text-amber-300">
                        <ShieldAlert size={15} className="mt-0.5 shrink-0" />
                        {historyError} There may be earlier follow-ups that are not shown — check
                        before ringing.
                      </p>
                    ) : history.length === 0 ? (
                      <p className="mt-2 text-sm text-cream-500">
                        Nothing logged yet. The first entry is the first call.
                      </p>
                    ) : (
                      <ol className="mt-3 space-y-3">
                        {history.map((f) => (
                          <li
                            key={f.id}
                            className="border-l-2 border-brass-500/30 pl-4 text-sm"
                          >
                            <p className="text-cream-500">
                              <span className="text-cream-300">{f.dateKey}</span> ·{" "}
                              {CONTACT_METHOD_LABELS[f.method]}
                              {f.byName && ` · ${f.byName}`}
                            </p>
                            <p className="mt-0.5 text-cream-200">{f.outcome}</p>
                            {f.nextOn && (
                              <p className="mt-0.5 text-xs text-brass-300">
                                Next: {f.nextOn}
                                {f.nextAction ? ` — ${f.nextAction}` : ""}
                              </p>
                            )}
                          </li>
                        ))}
                      </ol>
                    )}

                    {/* Log the next one */}
                    {canRecord && !closed && (
                      <div className="mt-5 rounded-2xl border border-night-700/60 bg-night-950/40 p-4">
                        <p className="text-sm text-cream-200">Log a follow-up</p>
                        <div className="mt-4 grid gap-4 sm:grid-cols-2">
                          <DateField
                            id={`fu-date-${lead.id}`}
                            label="When"
                            value={fuDate}
                            onChange={setFuDate}
                            max={todayIso()}
                          />
                          <SelectField
                            id={`fu-method-${lead.id}`}
                            label="How"
                            value={fuMethod}
                            onChange={setFuMethod}
                            options={CONTACT_METHODS.map((m) => ({
                              value: m,
                              label: CONTACT_METHOD_LABELS[m],
                            }))}
                          />
                          <div className="sm:col-span-2">
                            <TextAreaField
                              id={`fu-outcome-${lead.id}`}
                              label="What happened"
                              value={fuOutcome}
                              onChange={setFuOutcome}
                              rows={2}
                              hint="required"
                              placeholder="e.g. asked for a price on 3 wardrobes; sending Thursday"
                            />
                          </div>
                          <DateField
                            id={`fu-next-${lead.id}`}
                            label="Try again on"
                            value={fuNextOn}
                            onChange={setFuNextOn}
                            hint="leave empty if nothing is planned"
                          />
                          <TextField
                            id={`fu-next-action-${lead.id}`}
                            label="Next action"
                            value={fuNextAction}
                            onChange={setFuNextAction}
                          />
                        </div>
                        <div className="mt-4 flex flex-wrap gap-3">
                          <Button
                            onClick={() => submitFollowUp(lead)}
                            busy={busy}
                            disabled={!fuOutcome.trim()}
                          >
                            Save follow-up
                          </Button>
                          {canManage && (
                            <>
                              <Button variant="secondary" onClick={() => close(lead, "won")}>
                                <span className="flex items-center gap-1.5">
                                  <CheckCircle2 size={14} /> Won
                                </span>
                              </Button>
                              <Button variant="ghost" onClick={() => close(lead, "lost")}>
                                Lost
                              </Button>
                            </>
                          )}
                        </div>
                      </div>
                    )}

                    {lead.sourceVisitId && (
                      <p className="mt-4 flex items-center gap-1.5 text-xs text-cream-600">
                        <FileText size={12} /> Came from a site visit report
                      </p>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      <p className="mt-8 flex items-start gap-2 text-xs text-cream-600">
        <Users size={13} className="mt-0.5 shrink-0" />
        Leads are also created automatically when a site visit with a phone number is promoted
        from the visits screen, so a number taken in the field never has to be typed twice.
      </p>
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
  tone?: "good" | "warn";
}) {
  return (
    <div className="rounded-3xl border border-night-700/60 bg-night-900/40 p-5">
      <p className="text-xs uppercase tracking-wider text-cream-500">{label}</p>
      <p
        className={`mt-2 font-display text-2xl ${
          tone === "warn"
            ? "text-amber-300"
            : tone === "good"
              ? "text-emerald-300"
              : "text-cream-50"
        }`}
      >
        {value}
      </p>
      {hint && <p className="mt-1 text-xs text-cream-500">{hint}</p>}
    </div>
  );
}

"use client";

import { useEffect, useMemo, useState } from "react";
import {
  CheckCircle2,
  FileQuestion,
  MapPin,
  Phone,
  Plus,
  Ruler,
  ShieldAlert,
  Trash2,
} from "lucide-react";
import { getDb } from "@/lib/firebase";
import { COL } from "@/lib/erp/collections";
import {
  CLOSED_LEAD_STATUSES,
  QUOTE_REQUEST_STATUSES,
  QUOTE_REQUEST_STATUS_LABELS,
  URGENCY_LEVELS,
  URGENCY_LEVEL_LABELS,
  type QuoteRequestStatus,
  type UrgencyLevel,
} from "@/lib/erp/enums";
import {
  createQuoteRequest,
  deleteMarketingRecord,
  loadLeads,
  loadQuoteRequests,
  setQuoteRequestStatus,
  type Lead,
  type QuoteRequest,
} from "@/lib/erp/marketing";
import {
  Button,
  CheckboxField,
  EmptyState,
  SelectField,
  TextAreaField,
  TextField,
} from "@/components/admin/ui/Fields";
import { StatusPill, type PillTone } from "@/components/admin/ui/StatusPill";
import { useErpSession } from "@/components/admin/ErpAuthProvider";
import { rosterNameFor, useRoster } from "@/components/admin/marketing/useRoster";

/**
 * Quotation requests — the marketer's handover to the office.
 *
 * This screen exists so "I brought you a client last week" becomes a document. A marketer
 * raises the request; the office sees a queue and answers it with a reference to whatever was
 * sent. Both halves of that were previously a conversation nobody could check.
 *
 * Pending sits at the top and stays there, because a request that has been waiting three days
 * is the whole problem this is meant to catch.
 */

const TONE: Record<QuoteRequestStatus, PillTone> = {
  pending: "warn",
  quoted: "positive",
  declined: "neutral",
};

const URGENCY_TONE: Record<UrgencyLevel, PillTone> = {
  high: "danger",
  medium: "warn",
  low: "neutral",
};

export function QuoteRequestsScreen() {
  const session = useErpSession();
  const canRecord = session.can("marketing.record");
  const canDelete = session.can("record.delete");

  const { names: roster } = useRoster();
  const [requests, setRequests] = useState<QuoteRequest[]>([]);
  const [leads, setLeads] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [version, setVersion] = useState(0);
  const [adding, setAdding] = useState(false);

  const [clientName, setClientName] = useState("");
  const [phone, setPhone] = useState("");
  const [location, setLocation] = useState("");
  const [workType, setWorkType] = useState("");
  const [measurements, setMeasurements] = useState(false);
  const [siteVisitNeeded, setSiteVisitNeeded] = useState(true);
  const [urgency, setUrgency] = useState<UrgencyLevel>("medium");
  const [leadId, setLeadId] = useState("");
  const [notes, setNotes] = useState("");

  const actor = useMemo(
    () => ({
      uid: session.user?.uid ?? "",
      email: session.user?.email ?? "",
      role: session.role ?? "manager",
    }),
    [session.user, session.role]
  );

  useEffect(() => {
    setLoading(true);
    Promise.all([loadQuoteRequests(getDb(), { limit: 200 }), loadLeads(getDb(), { limit: 300 })])
      .then(([r, l]) => {
        setRequests(r);
        // Only open leads are offerable: attaching a request to a lead already won or lost
        // would reopen a closed file.
        setLeads(l.filter((x) => !CLOSED_LEAD_STATUSES.includes(x.status)));
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Could not load the requests."))
      .finally(() => setLoading(false));
  }, [version]);

  /** Pending first — the queue is the point of the screen. */
  const ordered = useMemo(() => {
    const rank = (r: QuoteRequest) => (r.status === "pending" ? 0 : r.status === "quoted" ? 1 : 2);
    return [...requests].sort((a, b) => {
      const byRank = rank(a) - rank(b);
      if (byRank !== 0) return byRank;
      // Oldest pending first, so the longest wait is answered first.
      return rank(a) === 0
        ? (a.createdAtMs ?? 0) - (b.createdAtMs ?? 0)
        : (b.createdAtMs ?? 0) - (a.createdAtMs ?? 0);
    });
  }, [requests]);

  const pendingCount = requests.filter((r) => r.status === "pending").length;

  /**
   * Selecting a lead fills the client's details, so nothing is retyped.
   *
   * Only empty boxes are filled. Overwriting is what loses a correction — a marketer who has just
   * typed the client's *current* number should not have it replaced by the one recorded on the
   * lead three weeks ago. The rule is applied to every field rather than just the work type,
   * which is what it used to be.
   */
  function pickLead(id: string) {
    setLeadId(id);
    const lead = leads.find((l) => l.id === id);
    if (!lead) return;
    setClientName((v) => (v.trim() ? v : lead.clientName));
    setPhone((v) => (v.trim() ? v : lead.phone));
    setLocation((v) => (v.trim() ? v : lead.area));
    setWorkType((v) => (v.trim() ? v : lead.serviceNeeded));
  }

  async function submit() {
    setError("");
    setBusy(true);
    try {
      await createQuoteRequest(getDb(), actor, {
        clientName,
        phone,
        location,
        workType,
        measurementsAvailable: measurements,
        siteVisitNeeded,
        urgency,
        leadId: leadId || undefined,
        requestedByName: rosterNameFor(session.displayName, roster) || actor.email,
        notes: notes || undefined,
      });
      setNotice(`Request raised for ${clientName.trim()}.`);
      setTimeout(() => setNotice(""), 6000);
      setClientName("");
      setPhone("");
      setLocation("");
      setWorkType("");
      setMeasurements(false);
      setSiteVisitNeeded(true);
      setUrgency("medium");
      setLeadId("");
      setNotes("");
      setAdding(false);
      setVersion((v) => v + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not raise the request.");
    } finally {
      setBusy(false);
    }
  }

  async function answer(request: QuoteRequest, status: QuoteRequestStatus) {
    /*
     * Cancel means cancel, on both branches.
     *
     * `window.prompt` returns null when dismissed and "" when submitted empty. Coalescing the
     * null away — which the reference prompt used to do, since a reference is optional — turned
     * a dismissed dialog into an empty answer, so backing out of "Mark quoted" still marked it
     * quoted. The null is checked first and the empty string handled afterwards.
     */
    const detail =
      status === "quoted"
        ? window.prompt(
            `Quotation sent to ${request.clientName}.\n\nReference? (an invoice or estimate number, optional)`
          )
        : window.prompt(
            `Decline the request for ${request.clientName}?\n\nWhy — so the same one is not brought twice.`
          );
    if (detail === null) return;

    setError("");
    setBusy(true);
    try {
      await setQuoteRequestStatus(getDb(), actor, request.id, status, detail);
      // `detail` is a string here: the null was returned above.
      setNotice(
        status === "quoted" ? "Marked as quoted." : `Declined: ${detail.trim()}`
      );
      setTimeout(() => setNotice(""), 6000);
      setVersion((v) => v + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not update the request.");
    } finally {
      setBusy(false);
    }
  }

  async function remove(request: QuoteRequest) {
    const reason = window.prompt(
      `Delete the request for ${request.clientName}?\n\nGive a reason — it is kept in the audit log.`
    );
    if (reason === null) return;
    setError("");
    setBusy(true);
    try {
      await deleteMarketingRecord(getDb(), actor, COL.quoteRequests, request.id, reason);
      setNotice("Request deleted.");
      setTimeout(() => setNotice(""), 6000);
      setVersion((v) => v + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not delete the request.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl text-cream-50">Quotation requests</h1>
          <p className="mt-1.5 max-w-2xl text-sm text-cream-400">
            When a marketer brings a serious client, this is the handover. The office answers
            from the queue below, so nothing waits on someone remembering to mention it.
          </p>
        </div>
        {canRecord && (
          <Button onClick={() => setAdding((a) => !a)} variant={adding ? "ghost" : "primary"}>
            <span className="flex items-center gap-1.5">
              <Plus size={15} /> {adding ? "Cancel" : "Raise a request"}
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

      {pendingCount > 0 && (
        <p className="mt-6 rounded-xl border border-amber-500/40 bg-amber-500/5 px-4 py-3 text-sm text-amber-300">
          {pendingCount} request{pendingCount === 1 ? "" : "s"} waiting on a quotation.
        </p>
      )}

      {adding && canRecord && (
        <section className="mt-6 rounded-3xl border border-brass-500/30 bg-night-900/40 p-6">
          <h2 className="font-display text-lg text-cream-100">New request</h2>

          {leads.length > 0 && (
            <div className="mt-5">
              <SelectField
                id="qr-lead"
                label="From a tracked lead"
                value={leadId}
                onChange={pickLead}
                options={leads.map((l) => ({
                  value: l.id,
                  label: `${l.clientName} — ${l.phone}`,
                }))}
                placeholder="Not from a lead…"
                hint="fills the details, and marks the lead as quoted"
              />
            </div>
          )}

          <div className="mt-5 grid gap-5 sm:grid-cols-2">
            <TextField
              id="qr-client"
              label="Client name"
              value={clientName}
              onChange={setClientName}
              required
            />
            <TextField
              id="qr-phone"
              label="Phone"
              type="tel"
              value={phone}
              onChange={setPhone}
              required
            />
            <TextField
              id="qr-location"
              label="Location"
              value={location}
              onChange={setLocation}
            />
            <TextField
              id="qr-work"
              label="Type of work"
              value={workType}
              onChange={setWorkType}
              required
              placeholder="e.g. 4-bedroom kitchen + 3 wardrobes"
            />
            <SelectField
              id="qr-urgency"
              label="Urgency"
              value={urgency}
              onChange={setUrgency}
              options={URGENCY_LEVELS.map((u) => ({ value: u, label: URGENCY_LEVEL_LABELS[u] }))}
            />
            <div className="flex flex-col justify-end gap-3 pb-1">
              <CheckboxField
                id="qr-measurements"
                label="Measurements already available"
                checked={measurements}
                onChange={setMeasurements}
              />
              <CheckboxField
                id="qr-visit"
                label="Site visit needed before quoting"
                checked={siteVisitNeeded}
                onChange={setSiteVisitNeeded}
              />
            </div>
            <div className="sm:col-span-2">
              <TextAreaField
                id="qr-notes"
                label="Notes for whoever prices this"
                value={notes}
                onChange={setNotes}
                rows={2}
                placeholder="e.g. wants Egger, budget is tight, engineer is the decision maker"
              />
            </div>
          </div>

          <div className="mt-6">
            <Button
              onClick={submit}
              busy={busy}
              disabled={!clientName.trim() || !phone.trim() || !workType.trim()}
            >
              Raise request
            </Button>
          </div>
        </section>
      )}

      {loading ? (
        <p className="mt-8 text-sm text-cream-500">Loading…</p>
      ) : ordered.length === 0 ? (
        <div className="mt-8">
          <EmptyState
            title="No quotation requests yet"
            hint="A marketer raises one when a client is ready for a price."
          />
        </div>
      ) : (
        <div className="mt-8 space-y-3">
          {ordered.map((r) => (
            <div
              key={r.id}
              className={`rounded-2xl border bg-night-900/30 p-4 ${
                r.status === "pending" ? "border-amber-500/40" : "border-night-700/60"
              }`}
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-cream-100">{r.clientName}</p>
                  <p className="mt-0.5 text-sm text-cream-400">{r.workType}</p>
                  <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-cream-500">
                    <a
                      href={`tel:${r.phone}`}
                      className="flex items-center gap-1.5 text-brass-300 hover:underline"
                    >
                      <Phone size={12} /> {r.phone}
                    </a>
                    {r.location && (
                      <span className="flex items-center gap-1.5">
                        <MapPin size={12} /> {r.location}
                      </span>
                    )}
                    <span>by {r.requestedByName}</span>
                    {r.createdAtMs && <span>{new Date(r.createdAtMs).toLocaleDateString()}</span>}
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <StatusPill tone={URGENCY_TONE[r.urgency]}>
                    {URGENCY_LEVEL_LABELS[r.urgency]}
                  </StatusPill>
                  <StatusPill tone={TONE[r.status]}>
                    {QUOTE_REQUEST_STATUS_LABELS[r.status]}
                  </StatusPill>
                  {canDelete && (
                    <button
                      type="button"
                      onClick={() => remove(r)}
                      className="cursor-pointer rounded-lg p-2 text-cream-600 transition-colors hover:text-red-300"
                      aria-label={`Delete the request for ${r.clientName}`}
                    >
                      <Trash2 size={15} />
                    </button>
                  )}
                </div>
              </div>

              <div className="mt-3 flex flex-wrap items-center gap-3 text-xs">
                <span
                  className={`flex items-center gap-1.5 ${
                    r.measurementsAvailable ? "text-emerald-300" : "text-cream-600"
                  }`}
                >
                  <Ruler size={12} />
                  {r.measurementsAvailable ? "Measurements ready" : "No measurements"}
                </span>
                {r.siteVisitNeeded && (
                  <span className="flex items-center gap-1.5 text-amber-300/80">
                    <MapPin size={12} /> Site visit needed first
                  </span>
                )}
              </div>

              {r.notes && (
                <p className="mt-3 rounded-xl bg-night-950/40 px-4 py-3 text-sm text-cream-300">
                  {r.notes}
                </p>
              )}

              {r.quotedRef && (
                <p className="mt-3 text-sm text-emerald-300">Quoted — {r.quotedRef}</p>
              )}
              {r.declineReason && (
                <p className="mt-3 text-sm text-cream-400">Declined — {r.declineReason}</p>
              )}

              {r.status === "pending" && canRecord && (
                <div className="mt-4 flex flex-wrap gap-3">
                  <Button variant="secondary" onClick={() => answer(r, "quoted")} busy={busy}>
                    <span className="flex items-center gap-1.5">
                      <FileQuestion size={14} /> Mark quoted
                    </span>
                  </Button>
                  <Button variant="ghost" onClick={() => answer(r, "declined")}>
                    Decline
                  </Button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      <p className="mt-8 text-xs text-cream-600">
        Statuses: {QUOTE_REQUEST_STATUSES.map((s) => QUOTE_REQUEST_STATUS_LABELS[s]).join(" · ")}
      </p>
    </div>
  );
}

import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  limit as fsLimit,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
  where,
  type Firestore,
} from "firebase/firestore";
import { COL } from "./collections";
import { writeAudit, type AuditActor } from "./audit";
import {
  CLOSED_LEAD_STATUSES,
  type BudgetLevel,
  type ContactMethod,
  type ContactRole,
  type DiscussedService,
  type InterestLevel,
  type LeadStatus,
  type NextAction,
  type QuoteRequestStatus,
  type SiteSituation,
  type SiteType,
  type UrgencyLevel,
} from "./enums";

/**
 * Marketing.
 *
 * Five records, in the order the work actually happens:
 *
 * 1. **Site visit** — a marketer walks onto a building site and writes down what they
 *    found. Filled daily, in the field, and it is the raw material for everything else.
 * 2. **Lead** — a visit that looked promising becomes a tracked prospect. The pipeline.
 * 3. **Follow-up** — one contact attempt against a lead. Several per lead, because most
 *    deals close on the fourth call, not the first visit.
 * 4. **Quotation request** — the marketer handing a serious client to the office.
 * 5. **Daily target** — what a marketer is expected to do in a day, so a week can be
 *    judged against something rather than against a feeling.
 *
 * ## The one design decision worth stating
 *
 * A lead is a *separate document*, not a flag on the visit. A visit is a dated event that
 * happened once and never changes; a lead has a status that moves for months. Storing the
 * status on the visit would mean editing a historical report every time a client was
 * called, which destroys the thing the daily report is for — knowing what was true on the
 * day it was written. The visit keeps `leadId`, and the lead keeps `sourceVisitId`, so the
 * trail runs both ways.
 *
 * ## Counts, not sums
 *
 * Nothing here holds money except the quotation request's rough budget note. Marketing is
 * measured in activity — sites walked, contacts made, quotes sent, deals closed — so the
 * weekly summary counts documents rather than adding up naira. The money appears later, as
 * an invoice, and `wonLeadId` on that side is what would connect the two.
 */

// ---------------------------------------------------------------------------
// Site visits
// ---------------------------------------------------------------------------

export interface NewSiteVisit {
  /** Who filled the form. Held as a name because marketers are staff records, not users. */
  staffId?: string;
  staffName: string;
  /** The day of the visit, `yyyy-mm-dd`. Not the day it was typed up. */
  dateKey: string;
  siteName: string;
  area: string;
  siteType: SiteType;
  contactMade: boolean;
  contactName?: string;
  contactRole?: ContactRole;
  contactPhone?: string;
  interest?: InterestLevel;
  situation?: SiteSituation;
  services: DiscussedService[];
  otherService?: string;
  /** What the client said, in their words. */
  objection?: string;
  nextAction: NextAction;
  /** When they said they will need the work. Free text — "after Ramadan" is a real answer. */
  expectedTimeline?: string;
  remarks?: string;
}

export interface SiteVisit extends NewSiteVisit {
  id: string;
  /** Set when this visit was promoted into the lead tracker. */
  leadId?: string;
  createdAtMs: number | null;
  createdBy?: string;
}

/** `yyyy-mm-dd` → a Timestamp at local midnight, for range queries. */
function dayTimestamp(dateKey: string): Timestamp {
  const [y, m, d] = dateKey.split("-").map(Number);
  return Timestamp.fromDate(new Date(y, (m ?? 1) - 1, d ?? 1));
}

/**
 * Records a site visit.
 *
 * The two validations are the two management rules that matter: a report needs a date and
 * a site, and **a contact that was made needs a phone number**. The second is the whole
 * point of the exercise — a marketer who spoke to an engineer and did not take their
 * number has produced a story rather than a lead, and the form is where that gets caught.
 */
export async function recordSiteVisit(
  db: Firestore,
  actor: AuditActor,
  input: NewSiteVisit
): Promise<{ id: string }> {
  if (!input.staffName.trim()) throw new Error("Whose report is this? Enter the staff name.");
  if (!input.dateKey) throw new Error("Give the date of the visit.");
  if (!input.siteName.trim()) throw new Error("Name the site or project.");
  if (!input.area.trim()) throw new Error("Give the area, so the visit can be placed on a map.");

  if (input.contactMade) {
    if (!input.contactName?.trim()) {
      throw new Error("Contact was made — who with? Enter their name.");
    }
    if (!input.contactPhone?.trim()) {
      throw new Error(
        "Every contact needs a phone number. Without one there is no way to follow this up."
      );
    }
  }

  const ref = await addDoc(collection(db, COL.siteVisits), {
    staffId: input.staffId ?? null,
    staffName: input.staffName.trim(),
    dateKey: input.dateKey,
    // Both stored: the key is what a day's report is grouped by and read back as, the
    // timestamp is what a date range can be queried on.
    visitedAt: dayTimestamp(input.dateKey),
    siteName: input.siteName.trim(),
    area: input.area.trim(),
    siteType: input.siteType,
    contactMade: input.contactMade,
    contactName: input.contactName?.trim() || null,
    contactRole: input.contactRole ?? null,
    contactPhone: input.contactPhone?.trim() || null,
    interest: input.interest ?? null,
    situation: input.situation ?? null,
    services: input.services,
    otherService: input.otherService?.trim() || null,
    objection: input.objection?.trim() || null,
    nextAction: input.nextAction,
    expectedTimeline: input.expectedTimeline?.trim() || null,
    remarks: input.remarks?.trim() || null,
    leadId: null,
    createdAt: serverTimestamp(),
    createdBy: actor.uid,
  });

  await writeAudit(db, {
    actor,
    action: "create",
    collectionName: COL.siteVisits,
    docId: ref.id,
    summary: `Site visit: ${input.siteName.trim()} (${input.area.trim()}) by ${input.staffName.trim()}`,
    after: { dateKey: input.dateKey, contactMade: input.contactMade, interest: input.interest },
  });

  return { id: ref.id };
}

function visitFrom(id: string, x: Record<string, unknown>): SiteVisit {
  return {
    id,
    staffId: (x.staffId as string) ?? undefined,
    staffName: (x.staffName as string) ?? "",
    dateKey: (x.dateKey as string) ?? "",
    siteName: (x.siteName as string) ?? "",
    area: (x.area as string) ?? "",
    siteType: (x.siteType as SiteType) ?? "residential",
    contactMade: Boolean(x.contactMade),
    contactName: (x.contactName as string) ?? undefined,
    contactRole: (x.contactRole as ContactRole) ?? undefined,
    contactPhone: (x.contactPhone as string) ?? undefined,
    interest: (x.interest as InterestLevel) ?? undefined,
    situation: (x.situation as SiteSituation) ?? undefined,
    services: (x.services as DiscussedService[]) ?? [],
    otherService: (x.otherService as string) ?? undefined,
    objection: (x.objection as string) ?? undefined,
    nextAction: (x.nextAction as NextAction) ?? "none",
    expectedTimeline: (x.expectedTimeline as string) ?? undefined,
    remarks: (x.remarks as string) ?? undefined,
    leadId: (x.leadId as string) ?? undefined,
    createdAtMs:
      (x.createdAt as { toMillis?: () => number } | undefined)?.toMillis?.() ?? null,
    createdBy: (x.createdBy as string) ?? undefined,
  };
}

/** Site visits over a date range, newest first. */
export async function loadSiteVisits(
  db: Firestore,
  opts: { fromKey?: string; toKey?: string; staffName?: string; limit?: number } = {}
): Promise<SiteVisit[]> {
  /*
   * Ordered by `dateKey` rather than by `visitedAt`.
   *
   * They agree — the timestamp is derived from the key — but `dateKey` is a string in
   * `yyyy-mm-dd`, which sorts identically to the date it represents and needs no composite
   * index alongside the range filters. One less index to keep in step with the code.
   */
  const clauses = [];
  if (opts.fromKey) clauses.push(where("dateKey", ">=", opts.fromKey));
  if (opts.toKey) clauses.push(where("dateKey", "<=", opts.toKey));

  const snap = await getDocs(
    query(
      collection(db, COL.siteVisits),
      ...clauses,
      orderBy("dateKey", "desc"),
      fsLimit(opts.limit ?? 200)
    )
  );

  const rows = snap.docs.map((d) => visitFrom(d.id, d.data()));
  /*
   * Staff filtered in memory.
   *
   * Adding `where("staffName", "==", …)` to the two range clauses needs its own composite
   * index, and the result set here is one team's visits over at most a few months. Filtering
   * a few hundred rows locally is not the bottleneck; a missing index in production is.
   */
  return opts.staffName
    ? rows.filter((r) => r.staffName === opts.staffName)
    : rows;
}

// ---------------------------------------------------------------------------
// Leads
// ---------------------------------------------------------------------------

export interface NewLead {
  clientName: string;
  phone: string;
  area: string;
  serviceNeeded: string;
  budgetLevel: BudgetLevel;
  /** The visit this came from, when it was promoted rather than entered by hand. */
  sourceVisitId?: string;
  ownerName?: string;
  nextAction?: string;
  /** When the next contact is due, `yyyy-mm-dd`. */
  nextActionOn?: string;
  notes?: string;
}

export interface Lead extends NewLead {
  id: string;
  status: LeadStatus;
  createdAtMs: number | null;
  lastContactMs: number | null;
  /** Set when won or lost, with the reason. The reason on a loss is the useful half. */
  closedAtMs: number | null;
  closeReason?: string;
  followUpCount: number;
  /** True when the next action is due today or earlier. Derived, not stored. */
  due: boolean;
}

/**
 * Adds a lead to the tracker.
 *
 * A phone number is required here for the same reason it is on the visit form: a lead
 * without one cannot be followed up, and an un-followable lead in the pipeline makes the
 * pipeline lie about how much work is in it.
 */
export async function createLead(
  db: Firestore,
  actor: AuditActor,
  input: NewLead
): Promise<{ id: string }> {
  if (!input.clientName.trim()) throw new Error("Enter the client's name.");
  if (!input.phone.trim()) {
    throw new Error("A lead needs a phone number — there is no following it up without one.");
  }

  const ref = await addDoc(collection(db, COL.leads), {
    clientName: input.clientName.trim(),
    phone: input.phone.trim(),
    area: input.area.trim(),
    serviceNeeded: input.serviceNeeded.trim(),
    budgetLevel: input.budgetLevel,
    status: "new" satisfies LeadStatus,
    sourceVisitId: input.sourceVisitId ?? null,
    ownerName: input.ownerName?.trim() || null,
    nextAction: input.nextAction?.trim() || null,
    nextActionOn: input.nextActionOn || null,
    notes: input.notes?.trim() || null,
    followUpCount: 0,
    lastContactAt: null,
    closedAt: null,
    closeReason: null,
    createdAt: serverTimestamp(),
    createdBy: actor.uid,
  });

  // The visit now points at the lead it produced, so a report can be read forward into
  // what came of it.
  if (input.sourceVisitId) {
    await updateDoc(doc(db, COL.siteVisits, input.sourceVisitId), {
      leadId: ref.id,
      updatedAt: serverTimestamp(),
      updatedBy: actor.uid,
    });
  }

  await writeAudit(db, {
    actor,
    action: "create",
    collectionName: COL.leads,
    docId: ref.id,
    summary: `Lead: ${input.clientName.trim()} (${input.area.trim() || "area not given"})`,
    after: { phone: input.phone.trim(), budgetLevel: input.budgetLevel },
  });

  return { id: ref.id };
}

/**
 * Promotes a site visit into a lead.
 *
 * Copies across what the visit already knows so nothing is retyped — the retyping is
 * where a phone number gains a wrong digit. Refuses a second promotion of the same visit,
 * because two leads for one conversation means two people chasing the same client.
 */
export async function promoteVisitToLead(
  db: Firestore,
  actor: AuditActor,
  visitId: string,
  overrides: Partial<NewLead> = {}
): Promise<{ id: string }> {
  const snap = await getDoc(doc(db, COL.siteVisits, visitId));
  if (!snap.exists()) throw new Error("That site visit no longer exists.");
  const visit = visitFrom(snap.id, snap.data());

  if (visit.leadId) {
    throw new Error("This visit is already in the lead tracker.");
  }
  if (!visit.contactPhone && !overrides.phone) {
    throw new Error(
      "This visit has no phone number, so it cannot be followed up. Add the number to the visit first."
    );
  }

  return createLead(db, actor, {
    clientName: overrides.clientName ?? visit.contactName ?? visit.siteName,
    phone: overrides.phone ?? visit.contactPhone ?? "",
    area: overrides.area ?? visit.area,
    serviceNeeded: overrides.serviceNeeded ?? visit.services.join(", "),
    budgetLevel: overrides.budgetLevel ?? "unknown",
    sourceVisitId: visitId,
    ownerName: overrides.ownerName ?? visit.staffName,
    nextAction: overrides.nextAction,
    nextActionOn: overrides.nextActionOn,
    notes: overrides.notes ?? visit.remarks,
  });
}

function leadFrom(id: string, x: Record<string, unknown>, todayKey: string): Lead {
  const nextActionOn = (x.nextActionOn as string) ?? undefined;
  const status = (x.status as LeadStatus) ?? "new";
  return {
    id,
    clientName: (x.clientName as string) ?? "",
    phone: (x.phone as string) ?? "",
    area: (x.area as string) ?? "",
    serviceNeeded: (x.serviceNeeded as string) ?? "",
    budgetLevel: (x.budgetLevel as BudgetLevel) ?? "unknown",
    status,
    sourceVisitId: (x.sourceVisitId as string) ?? undefined,
    ownerName: (x.ownerName as string) ?? undefined,
    nextAction: (x.nextAction as string) ?? undefined,
    nextActionOn,
    notes: (x.notes as string) ?? undefined,
    followUpCount: (x.followUpCount as number) ?? 0,
    createdAtMs:
      (x.createdAt as { toMillis?: () => number } | undefined)?.toMillis?.() ?? null,
    lastContactMs:
      (x.lastContactAt as { toMillis?: () => number } | undefined)?.toMillis?.() ?? null,
    closedAtMs:
      (x.closedAt as { toMillis?: () => number } | undefined)?.toMillis?.() ?? null,
    closeReason: (x.closeReason as string) ?? undefined,
    /*
     * Due compares date *keys* as strings, not parsed dates.
     *
     * `yyyy-mm-dd` sorts lexicographically in date order, so this is exact and has no
     * timezone in it. Comparing `Date` objects here would make a follow-up due at
     * midnight UTC rather than midnight in Kano.
     */
    due:
      !CLOSED_LEAD_STATUSES.includes(status) &&
      nextActionOn !== undefined &&
      nextActionOn <= todayKey,
  };
}

/** The pipeline. Open leads first with the overdue at the top, then the closed ones. */
export async function loadLeads(
  db: Firestore,
  opts: { status?: LeadStatus; limit?: number } = {}
): Promise<Lead[]> {
  const todayKey = new Date().toLocaleDateString("en-CA");
  const snap = await getDocs(
    query(
      collection(db, COL.leads),
      ...(opts.status ? [where("status", "==", opts.status)] : []),
      orderBy("createdAt", "desc"),
      fsLimit(opts.limit ?? 300)
    )
  );

  const rows = snap.docs.map((d) => leadFrom(d.id, d.data(), todayKey));

  /*
   * Sorted for the person doing the chasing, not by date.
   *
   * Overdue first, then everything else open, then closed. A pipeline ordered purely by
   * creation date buries the call that should have happened last Tuesday under this
   * morning's new entries.
   */
  const rank = (l: Lead) => {
    if (CLOSED_LEAD_STATUSES.includes(l.status)) return 2;
    return l.due ? 0 : 1;
  };
  return rows.sort((a, b) => {
    const byRank = rank(a) - rank(b);
    if (byRank !== 0) return byRank;
    // Within the overdue band, the longest-waiting first.
    if (rank(a) === 0) return (a.nextActionOn ?? "").localeCompare(b.nextActionOn ?? "");
    return (b.createdAtMs ?? 0) - (a.createdAtMs ?? 0);
  });
}

/** Edits a lead's own fields. Status moves go through `setLeadStatus`. */
export async function updateLead(
  db: Firestore,
  actor: AuditActor,
  leadId: string,
  patch: Partial<Omit<NewLead, "sourceVisitId">>
): Promise<void> {
  if (patch.phone !== undefined && !patch.phone.trim()) {
    throw new Error("A lead cannot have its phone number removed.");
  }

  const clean: Record<string, unknown> = {
    updatedAt: serverTimestamp(),
    updatedBy: actor.uid,
  };
  // Only the keys actually supplied are written, so an edit to the next action does not
  // blank the notes.
  if (patch.clientName !== undefined) clean.clientName = patch.clientName.trim();
  if (patch.phone !== undefined) clean.phone = patch.phone.trim();
  if (patch.area !== undefined) clean.area = patch.area.trim();
  if (patch.serviceNeeded !== undefined) clean.serviceNeeded = patch.serviceNeeded.trim();
  if (patch.budgetLevel !== undefined) clean.budgetLevel = patch.budgetLevel;
  if (patch.ownerName !== undefined) clean.ownerName = patch.ownerName.trim() || null;
  if (patch.nextAction !== undefined) clean.nextAction = patch.nextAction.trim() || null;
  if (patch.nextActionOn !== undefined) clean.nextActionOn = patch.nextActionOn || null;
  if (patch.notes !== undefined) clean.notes = patch.notes.trim() || null;

  await updateDoc(doc(db, COL.leads, leadId), clean);

  await writeAudit(db, {
    actor,
    action: "update",
    collectionName: COL.leads,
    docId: leadId,
    summary: `Lead updated: ${Object.keys(clean)
      .filter((k) => k !== "updatedAt" && k !== "updatedBy")
      .join(", ")}`,
    after: clean,
  });
}

/**
 * Moves a lead along the pipeline.
 *
 * A loss requires a reason. That is the one piece of information a lost lead still has to
 * give — whether it went on price, on timing, or to a carpenter already on site — and it
 * is never recoverable later, because nobody remembers.
 */
export async function setLeadStatus(
  db: Firestore,
  actor: AuditActor,
  leadId: string,
  status: LeadStatus,
  reason?: string
): Promise<void> {
  if (status === "lost" && !reason?.trim()) {
    throw new Error("Why was it lost? A lost lead with no reason teaches nothing.");
  }

  const closing = CLOSED_LEAD_STATUSES.includes(status);

  await updateDoc(doc(db, COL.leads, leadId), {
    status,
    closedAt: closing ? serverTimestamp() : null,
    closeReason: closing ? reason?.trim() || null : null,
    // A closed lead has no next action; leaving one would keep it in the overdue list
    // for ever.
    ...(closing ? { nextActionOn: null, nextAction: null } : {}),
    updatedAt: serverTimestamp(),
    updatedBy: actor.uid,
  });

  await writeAudit(db, {
    actor,
    action: "status_change",
    collectionName: COL.leads,
    docId: leadId,
    summary: `Lead → ${status}${reason?.trim() ? `: ${reason.trim()}` : ""}`,
    after: { status, reason: reason?.trim() ?? null },
  });
}

// ---------------------------------------------------------------------------
// Follow-ups
// ---------------------------------------------------------------------------

export interface NewFollowUp {
  leadId: string;
  /** The day contact was attempted, `yyyy-mm-dd`. */
  dateKey: string;
  method: ContactMethod;
  byName: string;
  /** What came of it. The only required text — a logged call with no outcome is a tick box. */
  outcome: string;
  /** When to try again, `yyyy-mm-dd`. Empty when nothing further is planned. */
  nextOn?: string;
  nextAction?: string;
}

export interface FollowUp extends NewFollowUp {
  id: string;
  leadName: string;
  createdAtMs: number | null;
}

/**
 * Logs one follow-up against a lead, and moves the lead's own next-action date with it.
 *
 * The two writes are the point. A follow-up log that does not update the lead leaves the
 * pipeline showing a call as still due after it was made, so the marketer either chases
 * twice or learns to distrust the list. Not transactional: these are separate documents
 * with no shared invariant to violate, and a failed second write leaves a logged call with
 * a stale due date, which the next follow-up corrects. A transaction would buy
 * consistency that nothing here depends on.
 */
export async function logFollowUp(
  db: Firestore,
  actor: AuditActor,
  input: NewFollowUp
): Promise<{ id: string }> {
  if (!input.leadId) throw new Error("Which lead is this follow-up for?");
  if (!input.dateKey) throw new Error("Give the date of the follow-up.");
  if (!input.outcome.trim()) {
    throw new Error("What was the outcome? Record what was said, not just that it happened.");
  }

  const leadSnap = await getDoc(doc(db, COL.leads, input.leadId));
  if (!leadSnap.exists()) throw new Error("That lead no longer exists.");
  const lead = leadSnap.data();

  const ref = await addDoc(collection(db, COL.followUps), {
    leadId: input.leadId,
    leadName: lead.clientName ?? "",
    dateKey: input.dateKey,
    contactedAt: dayTimestamp(input.dateKey),
    method: input.method,
    byName: input.byName.trim(),
    outcome: input.outcome.trim(),
    nextOn: input.nextOn || null,
    nextAction: input.nextAction?.trim() || null,
    createdAt: serverTimestamp(),
    createdBy: actor.uid,
  });

  await updateDoc(doc(db, COL.leads, input.leadId), {
    lastContactAt: dayTimestamp(input.dateKey),
    nextActionOn: input.nextOn || null,
    nextAction: input.nextAction?.trim() || null,
    /*
     * Counted here rather than by reading the follow-ups back.
     *
     * A stored count is a rollup, and the rule for rollups in this codebase is to write a
     * delta rather than re-sum siblings — so `+ 1`, computed from what was read a moment
     * ago. Two people logging a follow-up on the same lead in the same second could lose
     * one increment; the cost of that is a display count off by one, which is not worth a
     * transaction on a field nothing is calculated from.
     */
    followUpCount: ((lead.followUpCount as number) ?? 0) + 1,
    // A lead being actively worked is no longer new. Won and lost are left alone: a
    // follow-up after a close is a courtesy call, not a reopening.
    ...(lead.status === "new" ? { status: "contacted" satisfies LeadStatus } : {}),
    updatedAt: serverTimestamp(),
    updatedBy: actor.uid,
  });

  await writeAudit(db, {
    actor,
    action: "create",
    collectionName: COL.followUps,
    docId: ref.id,
    summary: `Follow-up (${input.method}) with ${lead.clientName ?? "lead"}: ${input.outcome.trim().slice(0, 80)}`,
    after: { leadId: input.leadId, dateKey: input.dateKey, nextOn: input.nextOn ?? null },
  });

  return { id: ref.id };
}

/** Follow-ups, newest first. Scoped to one lead when `leadId` is given. */
export async function loadFollowUps(
  db: Firestore,
  opts: { leadId?: string; fromKey?: string; toKey?: string; limit?: number } = {}
): Promise<FollowUp[]> {
  /*
   * A lead's own history is queried by equality and ordered by date; the date-range view is
   * ordered by date with no equality. Kept as two shapes rather than one so neither needs a
   * composite index beyond the single-field ones Firestore creates itself.
   */
  const snap = await getDocs(
    opts.leadId
      ? query(
          collection(db, COL.followUps),
          where("leadId", "==", opts.leadId),
          fsLimit(opts.limit ?? 100)
        )
      : query(
          collection(db, COL.followUps),
          ...(opts.fromKey ? [where("dateKey", ">=", opts.fromKey)] : []),
          ...(opts.toKey ? [where("dateKey", "<=", opts.toKey)] : []),
          orderBy("dateKey", "desc"),
          fsLimit(opts.limit ?? 200)
        )
  );

  const rows = snap.docs.map((d) => {
    const x = d.data();
    return {
      id: d.id,
      leadId: (x.leadId as string) ?? "",
      leadName: (x.leadName as string) ?? "",
      dateKey: (x.dateKey as string) ?? "",
      method: (x.method as ContactMethod) ?? "call",
      byName: (x.byName as string) ?? "",
      outcome: (x.outcome as string) ?? "",
      nextOn: (x.nextOn as string) ?? undefined,
      nextAction: (x.nextAction as string) ?? undefined,
      createdAtMs:
        (x.createdAt as { toMillis?: () => number } | undefined)?.toMillis?.() ?? null,
    };
  });

  // The per-lead query is unordered in Firestore, so it is sorted here. Newest first.
  return opts.leadId ? rows.sort((a, b) => b.dateKey.localeCompare(a.dateKey)) : rows;
}

// ---------------------------------------------------------------------------
// Quotation requests
// ---------------------------------------------------------------------------

export interface NewQuoteRequest {
  clientName: string;
  phone: string;
  location: string;
  workType: string;
  measurementsAvailable: boolean;
  siteVisitNeeded: boolean;
  urgency: UrgencyLevel;
  leadId?: string;
  requestedByName: string;
  notes?: string;
}

export interface QuoteRequest extends NewQuoteRequest {
  id: string;
  status: QuoteRequestStatus;
  createdAtMs: number | null;
  /** The invoice or estimate that answered it, once one exists. */
  quotedRef?: string;
  declineReason?: string;
}

/**
 * The marketer's handover to the office.
 *
 * Exists so "I brought you a client last week" is a document rather than a conversation.
 * The office sees a queue of pending requests; the marketer can see whether theirs was
 * answered. Both halves of that were previously invisible.
 */
export async function createQuoteRequest(
  db: Firestore,
  actor: AuditActor,
  input: NewQuoteRequest
): Promise<{ id: string }> {
  if (!input.clientName.trim()) throw new Error("Enter the client's name.");
  if (!input.phone.trim()) throw new Error("Enter the client's phone number.");
  if (!input.workType.trim()) throw new Error("What work is being quoted for?");

  const ref = await addDoc(collection(db, COL.quoteRequests), {
    clientName: input.clientName.trim(),
    phone: input.phone.trim(),
    location: input.location.trim(),
    workType: input.workType.trim(),
    measurementsAvailable: input.measurementsAvailable,
    siteVisitNeeded: input.siteVisitNeeded,
    urgency: input.urgency,
    leadId: input.leadId ?? null,
    requestedByName: input.requestedByName.trim(),
    notes: input.notes?.trim() || null,
    status: "pending" satisfies QuoteRequestStatus,
    quotedRef: null,
    declineReason: null,
    createdAt: serverTimestamp(),
    createdBy: actor.uid,
  });

  // A lead that has reached quotation is past "following up".
  if (input.leadId) {
    await updateDoc(doc(db, COL.leads, input.leadId), {
      status: "quoted" satisfies LeadStatus,
      updatedAt: serverTimestamp(),
      updatedBy: actor.uid,
    });
  }

  await writeAudit(db, {
    actor,
    action: "create",
    collectionName: COL.quoteRequests,
    docId: ref.id,
    summary: `Quotation request: ${input.clientName.trim()} — ${input.workType.trim()}`,
    after: { urgency: input.urgency, siteVisitNeeded: input.siteVisitNeeded },
  });

  return { id: ref.id };
}

/** Answers a quotation request. A decline needs its reason, for the same reason a lost lead does. */
export async function setQuoteRequestStatus(
  db: Firestore,
  actor: AuditActor,
  requestId: string,
  status: QuoteRequestStatus,
  detail?: string
): Promise<void> {
  if (status === "declined" && !detail?.trim()) {
    throw new Error("Why was it declined? Record it, so the same request is not brought twice.");
  }

  await updateDoc(doc(db, COL.quoteRequests, requestId), {
    status,
    quotedRef: status === "quoted" ? detail?.trim() || null : null,
    declineReason: status === "declined" ? detail?.trim() || null : null,
    updatedAt: serverTimestamp(),
    updatedBy: actor.uid,
  });

  await writeAudit(db, {
    actor,
    action: "status_change",
    collectionName: COL.quoteRequests,
    docId: requestId,
    summary: `Quotation request → ${status}${detail?.trim() ? `: ${detail.trim()}` : ""}`,
    after: { status, detail: detail?.trim() ?? null },
  });
}

export async function loadQuoteRequests(
  db: Firestore,
  opts: { status?: QuoteRequestStatus; limit?: number } = {}
): Promise<QuoteRequest[]> {
  const snap = await getDocs(
    query(
      collection(db, COL.quoteRequests),
      ...(opts.status ? [where("status", "==", opts.status)] : []),
      orderBy("createdAt", "desc"),
      fsLimit(opts.limit ?? 200)
    )
  );

  return snap.docs.map((d) => {
    const x = d.data();
    return {
      id: d.id,
      clientName: (x.clientName as string) ?? "",
      phone: (x.phone as string) ?? "",
      location: (x.location as string) ?? "",
      workType: (x.workType as string) ?? "",
      measurementsAvailable: Boolean(x.measurementsAvailable),
      siteVisitNeeded: Boolean(x.siteVisitNeeded),
      urgency: (x.urgency as UrgencyLevel) ?? "medium",
      leadId: (x.leadId as string) ?? undefined,
      requestedByName: (x.requestedByName as string) ?? "",
      notes: (x.notes as string) ?? undefined,
      status: (x.status as QuoteRequestStatus) ?? "pending",
      quotedRef: (x.quotedRef as string) ?? undefined,
      declineReason: (x.declineReason as string) ?? undefined,
      createdAtMs:
        (x.createdAt as { toMillis?: () => number } | undefined)?.toMillis?.() ?? null,
    };
  });
}

// ---------------------------------------------------------------------------
// Daily targets
// ---------------------------------------------------------------------------

/**
 * What a marketer is expected to do in a day.
 *
 * The spec's figures: 5–10 sites, 10+ conversations, 5 new contacts, 3 follow-ups. Stored
 * as settings rather than hard-coded, because a target that cannot be changed gets ignored
 * the first time it is wrong for a season.
 */
export interface MarketingTargets {
  sitesPerDay: number;
  conversationsPerDay: number;
  newContactsPerDay: number;
  followUpsPerDay: number;
  /** Working days in a week, for scaling the daily targets into weekly ones. */
  workingDaysPerWeek: number;
}

export const DEFAULT_MARKETING_TARGETS: MarketingTargets = {
  sitesPerDay: 5,
  conversationsPerDay: 10,
  newContactsPerDay: 5,
  followUpsPerDay: 3,
  // Six: the workshop runs Monday to Saturday.
  workingDaysPerWeek: 6,
};

const TARGETS_DOC = "marketing";

export async function loadMarketingTargets(db: Firestore): Promise<MarketingTargets> {
  const snap = await getDoc(doc(db, COL.settings, TARGETS_DOC));
  if (!snap.exists()) return DEFAULT_MARKETING_TARGETS;
  return { ...DEFAULT_MARKETING_TARGETS, ...(snap.data() as Partial<MarketingTargets>) };
}

export async function saveMarketingTargets(
  db: Firestore,
  actor: AuditActor,
  targets: MarketingTargets
): Promise<void> {
  for (const [key, value] of Object.entries(targets)) {
    if (!Number.isFinite(value) || value < 0) {
      throw new Error(`${key} must be zero or more.`);
    }
  }
  if (targets.workingDaysPerWeek < 1 || targets.workingDaysPerWeek > 7) {
    throw new Error("Working days in a week must be between 1 and 7.");
  }

  await setDoc(
    doc(db, COL.settings, TARGETS_DOC),
    { ...targets, updatedAt: serverTimestamp(), updatedBy: actor.uid },
    { merge: true }
  );

  await writeAudit(db, {
    actor,
    action: "settings_change",
    collectionName: COL.settings,
    docId: TARGETS_DOC,
    summary: `Marketing targets: ${targets.sitesPerDay} sites, ${targets.conversationsPerDay} conversations, ${targets.newContactsPerDay} new contacts, ${targets.followUpsPerDay} follow-ups per day`,
    after: { ...targets },
  });
}

// ---------------------------------------------------------------------------
// Weekly summary
// ---------------------------------------------------------------------------

export interface StaffPerformance {
  staffName: string;
  sitesVisited: number;
  contactsMade: number;
  leadsGenerated: number;
  followUpsDone: number;
  /** Sites visited as a percentage of the period's target. Null when no target is set. */
  sitesAgainstTargetPercent: number | null;
}

export interface MarketingSummary {
  fromKey: string;
  toKey: string;
  /** Working days in the period, for scaling the daily targets. */
  workingDays: number;
  sitesVisited: number;
  contactsMade: number;
  leadsGenerated: number;
  followUpsDone: number;
  quotationsSent: number;
  /** Raised in the period and still unanswered — a queue, not a failure. */
  quotationsPending: number;
  dealsClosed: number;
  dealsLost: number;
  /** Deals won as a percentage of leads that reached a conclusion. Null when none did. */
  conversionPercent: number | null;
  byStaff: StaffPerformance[];
  targets: MarketingTargets;
  /** Targets scaled to the period, so the comparison is like for like. */
  periodTargets: {
    sites: number;
    conversations: number;
    newContacts: number;
    followUps: number;
  };
  /** Interest spread across the period's visits, for reading the quality of the ground covered. */
  byInterest: Record<InterestLevel, number>;
  /**
   * True when the lead scan hit its cap, so the closed-deal figures may be short.
   *
   * Reported rather than hidden: a silently truncated count reads as "we closed nothing", which
   * is a very different statement from "there is more history than this report scanned".
   */
  leadsTruncated: boolean;
}

/** Inclusive count of days between two `yyyy-mm-dd` keys. */
function dayCount(fromKey: string, toKey: string): number {
  const [fy, fm, fd] = fromKey.split("-").map(Number);
  const [ty, tm, td] = toKey.split("-").map(Number);
  const from = new Date(fy, fm - 1, fd);
  const to = new Date(ty, tm - 1, td);
  const ms = to.getTime() - from.getTime();
  if (!Number.isFinite(ms) || ms < 0) return 0;
  // Rounded rather than floored: daylight saving would otherwise cost a day twice a year.
  return Math.round(ms / 86_400_000) + 1;
}

/**
 * Working days in an inclusive date range.
 *
 * Counted day by day rather than scaled, because scaling gets a full working week wrong. A
 * Monday-to-Saturday period is six calendar days; multiplying by 6/7 gives 5.14, which rounds
 * to five — so a complete working week would be judged against five days of target and every
 * marketer would appear to have beaten it. Walking the days costs nothing at these ranges and
 * is simply correct.
 *
 * `workingDaysPerWeek` is read as "the first N days starting Monday", so 6 means Monday to
 * Saturday and 5 means Monday to Friday. Sunday is the rest day at 6, which is how the
 * workshop runs. Public holidays are deliberately not consulted: a marketer's target is a
 * discipline tool rather than a payroll figure, and making it depend on whether someone
 * remembered to enter a holiday would make the report quietly wrong instead of roughly right.
 */
function workingDaysBetween(
  fromKey: string,
  toKey: string,
  workingDaysPerWeek: number
): number {
  const total = dayCount(fromKey, toKey);
  if (total === 0) return 1;
  // Seven working days means every day counts, so the walk is unnecessary.
  if (workingDaysPerWeek >= 7) return total;

  const [y, m, d] = fromKey.split("-").map(Number);
  let count = 0;
  for (let i = 0; i < total; i += 1) {
    const day = new Date(y, m - 1, d + i).getDay();
    // Monday is 1, Sunday is 0. Shifted so Monday is 0 and Sunday is 6, then compared against
    // the number of working days — which makes "6" mean Monday through Saturday.
    if ((day + 6) % 7 < workingDaysPerWeek) count += 1;
  }
  // Never zero: a period consisting only of rest days would otherwise divide by nothing and
  // report every target as met.
  return Math.max(1, count);
}

/**
 * The weekly report — sites walked, contacts made, leads raised, quotes sent, deals closed.
 *
 * Counted from the records rather than typed in, which is the difference between a report
 * and a claim. Everything is read for the period and reduced locally, the same approach the
 * profit report takes and for the same reason: a stored running total that drifts from the
 * documents underneath it is worse than a query that takes a moment.
 *
 * ## What "closed" counts
 *
 * A deal is counted as closed in the period its lead was *closed*, not the period the lead
 * was created. A lead raised in June and won in August belongs to August's performance —
 * that is when the work was won. The `leadsGenerated` figure counts creation, so the two
 * numbers deliberately describe different cohorts and must not be read as a funnel for one
 * week's leads.
 */
export async function buildMarketingSummary(
  db: Firestore,
  fromKey: string,
  toKey: string
): Promise<MarketingSummary> {
  /*
   * Everything for the period, read in parallel and reduced locally.
   *
   * The two unbounded-looking reads are deliberate and bounded:
   *
   * - **Leads** cannot be date-filtered in the query, because a lead *created* two years ago and
   *   *closed* this week belongs in this week's `dealsClosed`. Filtering by `createdAt` would drop
   *   exactly the deals a good week is made of. So the collection is read whole, ordered newest
   *   first and capped — the cap is what keeps this from growing without limit, and
   *   `leadsTruncated` below tells the screen when it bit.
   * - **Quote requests** have the same problem in miniature and the same answer.
   *
   * At the workshop's volume — a few hundred leads a year — neither cap is reached. They exist so
   * that when it is, the report says so rather than quietly under-counting.
   */
  const LEAD_SCAN_CAP = 3000;
  const [visits, followUps, quotes, leadSnap, targets] = await Promise.all([
    loadSiteVisits(db, { fromKey, toKey, limit: 2000 }),
    loadFollowUps(db, { fromKey, toKey, limit: 2000 }),
    loadQuoteRequests(db, { limit: LEAD_SCAN_CAP }),
    getDocs(
      query(collection(db, COL.leads), orderBy("createdAt", "desc"), fsLimit(LEAD_SCAN_CAP))
    ),
    loadMarketingTargets(db),
  ]);

  const fromMs = dayTimestamp(fromKey).toMillis();
  // End of the last day, so a lead closed at 4pm on the final day is inside the period.
  const toMs = dayTimestamp(toKey).toMillis() + 86_400_000 - 1;
  const within = (ms: number | null) => ms !== null && ms >= fromMs && ms <= toMs;

  const leads = leadSnap.docs.map((d) => leadFrom(d.id, d.data(), toKey));

  const leadsGenerated = leads.filter((l) => within(l.createdAtMs));
  const closed = leads.filter((l) => within(l.closedAtMs));
  const dealsClosed = closed.filter((l) => l.status === "won").length;
  const dealsLost = closed.filter((l) => l.status === "lost").length;

  /*
   * Quotations actually sent, plus what is still waiting.
   *
   * `quoted` only — a request raised on Friday and never answered is not a quotation sent, and
   * counting it as one flatters the single figure the office is judged on. The pending count is
   * reported alongside rather than folded in, because a growing queue is the useful signal: it
   * says the marketers are working and the office is the bottleneck.
   *
   * Both are keyed on when the request was *raised*, not when it was answered, because that is
   * the only timestamp the document carries. So a request raised last week and quoted this week
   * counts in last week's figure. Stated here because it differs from how deals are counted, and
   * the screen says so too.
   */
  const inPeriod = quotes.filter((q) => within(q.createdAtMs));
  const quotationsSent = inPeriod.filter((q) => q.status === "quoted").length;
  const quotationsPending = inPeriod.filter((q) => q.status === "pending").length;

  const contactsMade = visits.filter((v) => v.contactMade).length;

  /*
   * Per-staff, keyed by the name on the report.
   *
   * By name rather than by staff id because marketers fill these in the field and the id is
   * not always attached — a report with a name and no id still has to count for that person.
   * The consequence is that two spellings of one name read as two people, which is why the
   * form offers the roster rather than a free text box.
   */
  const byStaffMap = new Map<string, StaffPerformance>();
  const blank = (staffName: string): StaffPerformance => ({
    staffName,
    sitesVisited: 0,
    contactsMade: 0,
    leadsGenerated: 0,
    followUpsDone: 0,
    sitesAgainstTargetPercent: null,
  });
  const bump = (name: string, apply: (row: StaffPerformance) => void) => {
    const key = name.trim() || "Unattributed";
    const row = byStaffMap.get(key) ?? blank(key);
    apply(row);
    byStaffMap.set(key, row);
  };

  for (const v of visits) {
    bump(v.staffName, (r) => {
      r.sitesVisited += 1;
      if (v.contactMade) r.contactsMade += 1;
    });
  }
  for (const l of leadsGenerated) {
    bump(l.ownerName ?? "", (r) => {
      r.leadsGenerated += 1;
    });
  }
  for (const f of followUps) {
    bump(f.byName, (r) => {
      r.followUpsDone += 1;
    });
  }

  const workingDays = workingDaysBetween(fromKey, toKey, targets.workingDaysPerWeek);

  /*
   * How many marketers the period's targets should be multiplied by.
   *
   * The targets are per person per day, so a team total has to be compared against the team's
   * target or the figure is meaningless: three marketers each hitting 5 sites a day produce 90 in
   * a six-day week, which reads as 300% against one person's 30.
   *
   * Counted from who actually filed something rather than from the staff roster, because the
   * roster does not say who is a marketer — and a target that included the carpenters would be
   * unreachable. The consequence is that a marketer who filed nothing all week is not counted,
   * which flatters the percentage; the per-staff table below is where that absence shows, and it
   * is the table the review meeting works from.
   */
  const reporting = Math.max(1, byStaffMap.size);

  const perStaffTargets = {
    sites: targets.sitesPerDay * workingDays,
    conversations: targets.conversationsPerDay * workingDays,
    newContacts: targets.newContactsPerDay * workingDays,
    followUps: targets.followUpsPerDay * workingDays,
  };

  const periodTargets = {
    sites: perStaffTargets.sites * reporting,
    conversations: perStaffTargets.conversations * reporting,
    newContacts: perStaffTargets.newContacts * reporting,
    followUps: perStaffTargets.followUps * reporting,
  };

  const perStaffSiteTarget = perStaffTargets.sites;
  const byStaff = [...byStaffMap.values()]
    .map((r) => ({
      ...r,
      sitesAgainstTargetPercent:
        perStaffSiteTarget > 0
          ? Math.round((r.sitesVisited / perStaffSiteTarget) * 100)
          : null,
    }))
    .sort((a, b) => b.sitesVisited - a.sitesVisited);

  const byInterest: Record<InterestLevel, number> = { high: 0, medium: 0, low: 0 };
  for (const v of visits) {
    if (v.interest) byInterest[v.interest] += 1;
  }

  const concluded = dealsClosed + dealsLost;

  return {
    fromKey,
    toKey,
    workingDays,
    sitesVisited: visits.length,
    contactsMade,
    leadsGenerated: leadsGenerated.length,
    followUpsDone: followUps.length,
    quotationsSent,
    quotationsPending,
    dealsClosed,
    dealsLost,
    conversionPercent:
      concluded > 0 ? Math.round((dealsClosed / concluded) * 1000) / 10 : null,
    byStaff,
    targets,
    periodTargets,
    byInterest,
    leadsTruncated: leadSnap.size >= LEAD_SCAN_CAP,
  };
}

/**
 * Today at a glance, for the module's landing page.
 *
 * Four figures, each answering a question someone actually asks in the morning: how many sites
 * have been walked, how many new leads came out of them, how many follow-ups were made, how many
 * quotations went out. Plus what is overdue, which is the only one that demands action.
 *
 * Deliberately cheap. This runs on a landing page that people open and close all day, so it reads
 * one day of visits and follow-ups rather than a range, and takes the lead counts from the same
 * capped scan the pipeline screen uses.
 */
export interface MarketingToday {
  dateKey: string;
  sitesVisited: number;
  contactsMade: number;
  newLeads: number;
  followUps: number;
  quotationsSent: number;
  /**
   * Open leads whose next action is due today or earlier. The queue for the day.
   *
   * Always measured against *now*, not against `dateKey` — `Lead.due` is computed from the real
   * today by `loadLeads`. So on a back-dated call this figure still describes the present, which is
   * what a dashboard wants and what a historical report must not use.
   */
  dueNow: number;
  /** Quotation requests the office has not answered. */
  quotationsPending: number;
  /** Open leads in total, for a sense of the pipeline's size. */
  openLeads: number;
  /** Per-marketer site counts for the day, busiest first. */
  byStaff: Array<{ staffName: string; sitesVisited: number }>;
  /** The daily site target, so the tiles can say whether the day is on track. */
  targets: MarketingTargets;
}

export async function loadMarketingToday(
  db: Firestore,
  dateKey: string = new Date().toLocaleDateString("en-CA")
): Promise<MarketingToday> {
  const [visits, followUps, leads, quotes, targets] = await Promise.all([
    loadSiteVisits(db, { fromKey: dateKey, toKey: dateKey, limit: 500 }),
    loadFollowUps(db, { fromKey: dateKey, toKey: dateKey, limit: 500 }),
    loadLeads(db, { limit: 500 }),
    loadQuoteRequests(db, { limit: 500 }),
    loadMarketingTargets(db),
  ]);

  const dayStart = dayTimestamp(dateKey).toMillis();
  const dayEnd = dayStart + 86_400_000 - 1;
  const madeToday = (ms: number | null) => ms !== null && ms >= dayStart && ms <= dayEnd;

  const open = leads.filter((l) => !CLOSED_LEAD_STATUSES.includes(l.status));

  const byStaffMap = new Map<string, number>();
  for (const v of visits) {
    const key = v.staffName.trim() || "Unattributed";
    byStaffMap.set(key, (byStaffMap.get(key) ?? 0) + 1);
  }

  return {
    dateKey,
    sitesVisited: visits.length,
    contactsMade: visits.filter((v) => v.contactMade).length,
    newLeads: leads.filter((l) => madeToday(l.createdAtMs)).length,
    followUps: followUps.length,
    quotationsSent: quotes.filter((q) => q.status === "quoted" && madeToday(q.createdAtMs)).length,
    dueNow: open.filter((l) => l.due).length,
    quotationsPending: quotes.filter((q) => q.status === "pending").length,
    openLeads: open.length,
    byStaff: [...byStaffMap.entries()]
      .map(([staffName, sitesVisited]) => ({ staffName, sitesVisited }))
      .sort((a, b) => b.sitesVisited - a.sitesVisited),
    targets,
  };
}

/**
 * The management rules from the spec, as data.
 *
 * Stated in the brief as the thing that makes the rest work — "if you don't enforce this,
 * everything fails" — so they are worth putting on screen rather than leaving in a document
 * nobody reopens. Held here rather than in the component because two screens show them.
 *
 * Each carries whether the system enforces it or whether it is on a person to enforce, which is
 * the honest distinction: the phone-number rule is checked by the form and cannot be got around,
 * the salary rule is a management decision no code makes.
 */
export const MANAGEMENT_RULES: Array<{
  n: number;
  rule: string;
  detail: string;
  enforcement: "system" | "manager";
}> = [
  {
    n: 1,
    rule: "No report, no pay for that day",
    detail:
      "A day with no site visit report is a day nobody can account for. The weekly summary shows who filed what, so the gap is visible before payday.",
    enforcement: "manager",
  },
  {
    n: 2,
    rule: "Minimum sites a day, unless justified",
    detail:
      "Set in Settings and shown live on the visits screen, so a marketer knows where they stand before the day ends rather than at the weekly review.",
    enforcement: "manager",
  },
  {
    n: 3,
    rule: "Every contact must have a phone number",
    detail:
      "Enforced by the form: a visit that records a contact cannot be saved without one. A contact with no number is a story rather than a lead.",
    enforcement: "system",
  },
  {
    n: 4,
    rule: "Weekly review, ten to fifteen minutes",
    detail:
      "The weekly summary is built to be that meeting — counted from the records, printable, and readable in one screen.",
    enforcement: "manager",
  },
];

/**
 * Deletes a marketing record.
 *
 * Marketing records are notes about conversations, not money or stock, so there is nothing
 * to reverse and no ledger to keep in step. A mistyped visit is deleted rather than voided.
 * The audit entry keeps what it said, which is the only trace worth having.
 */
export async function deleteMarketingRecord(
  db: Firestore,
  actor: AuditActor,
  collectionName: string,
  docId: string,
  reason: string
): Promise<void> {
  if (!reason.trim()) throw new Error("Give a reason for the deletion.");

  const allowed: string[] = [
    COL.siteVisits,
    COL.leads,
    COL.followUps,
    COL.quoteRequests,
  ];
  // Guards against this being handed any collection name at all — it is called from a UI
  // that passes a constant, and a general-purpose delete helper is a liability.
  if (!allowed.includes(collectionName)) {
    throw new Error("That collection cannot be deleted through this route.");
  }

  const ref = doc(db, collectionName, docId);
  const snap = await getDoc(ref);
  if (!snap.exists()) throw new Error("That record no longer exists.");
  const before = snap.data();

  await deleteDoc(ref);

  await writeAudit(db, {
    actor,
    action: "delete",
    collectionName,
    docId,
    summary: `Deleted marketing record: ${reason.trim()}`,
    before,
  });
}

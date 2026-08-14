"use client";

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import {
  collection,
  doc,
  limit,
  onSnapshot,
  orderBy,
  query,
  where,
} from "firebase/firestore";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  AlertTriangle,
  ChevronDown,
  ClipboardList,
  Layers,
  Loader2,
  PenLine,
  Plus,
  FileText,
  Printer,
  ShieldAlert,
  Trash2,
  Users,
} from "lucide-react";
import { getDb } from "@/lib/firebase";
import { COL } from "@/lib/erp/collections";
import {
  DEDUCTION_TYPES,
  DEDUCTION_TYPE_LABELS,
  JOB_STATUS_LABELS,
  WAGE_WORK_TYPES,
  WAGE_WORK_TYPE_LABELS,
  type DeductionType,
  type EmploymentType,
  type JobStatus,
  type WageWorkType,
} from "@/lib/erp/enums";
import { formatNaira, parseNairaInput, toNaira } from "@/lib/erp/money";
import {
  labelForWorkType,
  rateFor,
  resolveRates,
  resolveStaffRates,
  resolveWorkTypes,
  type ResolvedWorkType,
} from "@/lib/erp/wages";
import {
  DEFAULT_HR_SETTINGS,
  DEFAULT_WAGE_WORK_TYPE_SETTINGS,
  SETTINGS_DOC,
  type WageWorkTypeSettings,
} from "@/lib/erp/settings";
import { dayRateKobo, hrSettings } from "@/lib/erp/hr";
import {
  isoWeekKey,
  isoWeekOf,
  isoWeekRangeLabel,
  type IsoWeek,
} from "@/lib/erp/isoWeek";
import { boardsRemainingOnJob } from "@/lib/erp/boards";
import type { StaffRate, WageRate, WorkLogItem } from "@/lib/erp/types";
import {
  createWorkLog,
  deleteWorkLog,
  describeItems,
  fromDateInputValue,
  itemsFrom,
  toDateInputValue,
  totalUnits,
  updateWorkLog,
} from "@/lib/erp/workLogs";
import {
  Button,
  DateField,
  EmptyState,
  NairaField,
  NumberField,
  SelectField,
  TextAreaField,
  TextField,
} from "@/components/admin/ui/Fields";
import { useAuditActor, useErpSession } from "@/components/admin/ErpAuthProvider";
import { StaffPicker, type PickedStaff } from "@/components/admin/services/StaffPicker";
import { WorkLogSheet } from "./WorkLogSheet";
import { PrintPreview } from "@/components/admin/ui/PrintPreview";
import { DeleteWithReason } from "@/components/admin/ui/DeleteWithReason";
import { TOOLTIP_PROPS } from "@/components/admin/ui/chartTheme";
import type { AuditActor } from "@/lib/erp/audit";

interface StaffOption {
  id: string;
  name: string;
  isAssistant: boolean;
  /** Pay basis, so a no-show deduction can be worked out from a monthly salary. */
  employmentType?: EmploymentType;
  isSalaried?: boolean;
  monthlySalaryKobo?: number;
}

interface LogRow {
  id: string;
  staffId: string;
  staffName: string;
  /** Every kind of work on the entry, already normalised for legacy rows. */
  items: WorkLogItem[];
  workDateMs: number | null;
  assistantIds: string[];
  assistantNames: string[];
  assistantCount: number;
  jobId?: string;
  jobNumber?: string;
  boardsUsed?: number | null;
  edgeTapeUsed?: number | null;
  /**
   * Set while a deletion of this row is awaiting a decision.
   *
   * `requestApproval` writes it on the target so the record is locked, but nothing read it,
   * so a row with a request pending looked identical to any other and still offered a live
   * delete button — which then threw the raw transaction error on click.
   */
  pendingApprovalId?: string | null;
}

/** A service job that can still have work logged against it. */
interface OpenJob {
  id: string;
  jobNumber: string;
  customerName: string;
  status: JobStatus;
}

/**
 * Statuses a job can still be worked on.
 *
 * Collected and cancelled jobs are excluded: work logged against a job the customer
 * has already taken away is almost always a mis-selection, and it is the kind of
 * mistake that only surfaces when someone queries their bill.
 */
const WORKABLE_STATUSES: JobStatus[] = ["received", "in_progress", "qc", "on_hold"];

/**
 * How many work-log entries are read.
 *
 * About a year at this workshop's volume. The list is grouped and paginated by week, so this has
 * to be deep enough that "show earlier weeks" keeps finding weeks — but bounded, because an
 * unbounded snapshot on a growing collection is a bill that grows with it.
 */
const LOG_SCAN_CAP = 600;

/**
 * Work log entry. This is the only input to payroll.
 *
 * Operators may log their own work; managers and admins may log for anyone. The
 * Firestore rules enforce that an operator's log carries their own staffId, so
 * units cannot be attributed to someone else.
 */
export function WorkLogScreen() {
  const session = useErpSession();
  const canLogForOthers = session.can("worklog.viewAll");
  const canLog = session.can("worklog.create");
  /**
   * Raising a deduction alongside the work.
   *
   * Its own capability, not implied by logging work: an operator records their own
   * output and must not be able to dock a colleague's pay.
   */
  const canDeduct = session.can("deduction.create") && canLogForOthers;
  // Wage figures and the delete control. Rate visibility is its own capability,
  // so granting it does not also hand over the ability to remove a log.
  const isAdmin = session.can("wage.viewRates");

  const [rows, setRows] = useState<LogRow[]>([]);
  /** What the user is searching for — staff name, job number or kind of work. */
  const [search, setSearch] = useState("");
  /**
   * Which ISO week is expanded, as a `2026-W32` key.
   *
   * The brief asks for the list grouped by calendar week, and a group nobody can collapse is just a
   * heading — with a year of logs on screen the point is to open the week being discussed. The
   * newest week opens by default, which is almost always the one wanted.
   */
  const [openWeek, setOpenWeek] = useState<string | null>(null);
  /** How many weeks are shown. Pagination by week rather than by row, since weeks are the unit. */
  const [weeksShown, setWeeksShown] = useState(6);

  /*
   * Searching reopens the newest matching week.
   *
   * `openWeek` holds a specific week key once somebody has clicked a header. Search for a term that
   * has no entries in that week and every group renders collapsed — including the newest — leaving a
   * list of headers with no rows and nothing explaining why. Resetting to null restores the
   * "newest open" default against whatever now matches.
   */
  useEffect(() => {
    setOpenWeek(null);
  }, [search]);
  const [staff, setStaff] = useState<StaffOption[]>([]);
  const [rates, setRates] = useState<WageRate[]>([]);
  const [staffRates, setStaffRates] = useState<StaffRate[]>([]);
  const [openJobs, setOpenJobs] = useState<OpenJob[]>([]);
  /** Kinds of work currently offered, including any the workshop added itself. */
  const [workTypeSettings, setWorkTypeSettings] = useState<WageWorkTypeSettings>(
    DEFAULT_WAGE_WORK_TYPE_SETTINGS
  );
  /**
   * Working days in a month, for pro-rating a salaried absence.
   *
   * Read from HR settings so the derived no-show figure matches what the salary run uses.
   * A different divisor in the two places would mean the deduction shown at the work log
   * and the one applied at pay time disagree.
   */
  const [workingDaysPerMonth, setWorkingDaysPerMonth] = useState(
    DEFAULT_HR_SETTINGS.workingDaysPerMonth
  );
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState("");
  /** Confirms a deletion, or that one was sent for approval. */
  const [notice, setNotice] = useState("");

  useEffect(() => {
    hrSettings(getDb())
      .then((s) => setWorkingDaysPerMonth(s.workingDaysPerMonth))
      .catch(() => {});
  }, []);
  const [previewing, setPreviewing] = useState(false);
  const [printing, setPrinting] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  /** The entry whose delete-reason panel is open, in the row beneath it. */
  const [deletingId, setDeletingId] = useState<string | null>(null);

  useEffect(() => {
    const q = query(collection(getDb(), COL.staff), orderBy("name", "asc"));
    return onSnapshot(
      q,
      (snap) =>
        setStaff(
          snap.docs
            .filter((d) => d.data().active !== false)
            .map((d) => {
              const x = d.data();
              return {
                id: d.id,
                name: (x.name as string) ?? "",
                isAssistant: x.isAssistant === true,
                employmentType: x.employmentType as EmploymentType | undefined,
                isSalaried: x.isSalaried === true,
                monthlySalaryKobo: x.monthlySalaryKobo ?? undefined,
              };
            })
        ),
      // Secondary lookup: an operator without staff read access simply gets no
      // assistant list, which the fieldset already explains.
      () => {}
    );
  }, []);

  // Rates are read only to show an estimated value as work is entered.
  useEffect(() => {
    if (!isAdmin) return;
    const unsubRates = onSnapshot(
      collection(getDb(), COL.wageRates),
      (snap) =>
        setRates(snap.docs.map((d) => ({ id: d.id, ...d.data() })) as WageRate[]),
      () => {}
    );
    // Per-person overrides, so the estimate shows what *this* operator earns
    // rather than the standard rate they may not be on.
    const unsubStaffRates = onSnapshot(
      collection(getDb(), COL.staffRates),
      (snap) =>
        setStaffRates(snap.docs.map((d) => ({ id: d.id, ...d.data() })) as StaffRate[]),
      () => {}
    );
    return () => {
      unsubRates();
      unsubStaffRates();
    };
  }, [isAdmin]);

  /*
   * Jobs still open for work, offered as a dropdown rather than a typed number.
   *
   * The job number was previously a free-text box, which produced work attributed to
   * jobs that did not exist ("JOB-2026-142" for "JOB-2026-0142") and so to no job at
   * all. Selecting from the live list makes the link real, which is what lets boards
   * cut be reconciled against boards received.
   */
  // The work-type vocabulary. Read by everyone who logs work, not only admins, or a
  // custom type would be invisible to the operators expected to log against it.
  useEffect(() => {
    return onSnapshot(
      doc(getDb(), COL.settings, SETTINGS_DOC.wageWorkTypes),
      (snap) => {
        const d = snap.data();
        setWorkTypeSettings({
          custom: (d?.custom ?? []) as Array<{ id: string; label: string }>,
          hidden: (d?.hidden ?? []) as string[],
        });
      },
      () => {}
    );
  }, []);

  useEffect(() => {
    return onSnapshot(
      query(collection(getDb(), COL.serviceJobs), orderBy("receivedAt", "desc"), limit(150)),
      (snap) =>
        setOpenJobs(
          snap.docs
            .filter((d) => WORKABLE_STATUSES.includes(d.data().status as JobStatus))
            .map((d) => {
              const x = d.data();
              return {
                id: d.id,
                jobNumber: x.jobNumber ?? "",
                customerName: x.customerName ?? "",
                status: (x.status as JobStatus) ?? "received",
              };
            })
        ),
      // An operator may not be able to read jobs; the field then falls back to
      // free text, which the form explains.
      () => {}
    );
  }, []);

  useEffect(() => {
    /*
     * Operators see only their own logs, which is also what the rules allow.
     *
     * Raised from 100 to 600 — roughly a year at this workshop's volume — because the list is now
     * grouped and paginated by week. At 100 rows "show earlier weeks" would find nothing beyond
     * about the third week back, and a pagination control that silently runs out is worse than no
     * pagination at all. Still capped rather than unbounded, and the count is stated below the list
     * so a truncated history is visible rather than assumed complete.
     */
    const base = collection(getDb(), COL.workLogs);
    const q =
      canLogForOthers || !session.staffId
        ? query(base, orderBy("workDate", "desc"), limit(LOG_SCAN_CAP))
        : query(
            base,
            where("staffId", "==", session.staffId),
            orderBy("workDate", "desc"),
            limit(LOG_SCAN_CAP)
          );

    return onSnapshot(
      q,
      (snap) => {
        setRows(
          snap.docs.map((d) => {
            const x = d.data();
            return {
              id: d.id,
              staffId: x.staffId ?? "",
              staffName: x.staffName ?? "",
              // Normalised on read, so a legacy single-type entry and a new
              // multi-type one are the same shape everywhere below this point.
              items: itemsFrom({
                workType: (x.workType as WageWorkType) ?? "board",
                units: x.units ?? 0,
                items: x.items as WorkLogItem[] | undefined,
              }),
              workDateMs: x.workDate?.toMillis?.() ?? null,
              assistantIds: (x.assistantIds as string[]) ?? [],
              assistantNames: (x.assistantNames as string[]) ?? [],
              assistantCount: x.assistantCount ?? 0,
              jobId: x.jobId ?? undefined,
              jobNumber: x.jobNumber ?? undefined,
              boardsUsed: x.boardsUsed ?? null,
              edgeTapeUsed: x.edgeTapeUsed ?? null,
              pendingApprovalId: x.pendingApprovalId ?? null,
            };
          })
        );
        setLoading(false);
      },
      (e) => {
        setError(e.message);
        setLoading(false);
      }
    );
  }, [canLogForOthers, session.staffId]);

  const actor = useAuditActor();

  const assistantPool = useMemo(() => staff.filter((s) => s.isAssistant), [staff]);

  /** Offered kinds of work, built-in and custom together. */
  const workTypes = useMemo(
    () => resolveWorkTypes(workTypeSettings),
    [workTypeSettings]
  );

  /**
   * Names a work type for display, including hidden and custom ones.
   *
   * Not `WAGE_WORK_TYPE_LABELS[x]`: an entry can reference a type the workshop added, or
   * one it has since stopped offering, and indexing the built-in map on either yields
   * undefined — so the row would render blank where a name belongs.
   */
  const nameOfWorkType = useCallback(
    (id: string) => labelForWorkType(id, workTypeSettings.custom),
    [workTypeSettings.custom]
  );

  if (!session.ready) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center">
        <Loader2 className="animate-spin text-brass-400" size={28} aria-label="Loading" />
      </div>
    );
  }

  /*
   * Search across the things somebody actually looks for.
   *
   * A name, a job number, or a kind of work — those are the three ways a log gets described out
   * loud ("Bashir's entries", "everything on JOB-2026-0142", "the door work"). Assistants are
   * searched too, because "was Halifa on that job" is asked as often as who logged it.
   */
  const matching = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return rows;
    return rows.filter((r) =>
      [
        r.staffName,
        r.jobNumber ?? "",
        ...r.assistantNames,
        ...r.items.map((it) => nameOfWorkType(it.workType)),
      ].some((f) => f.toLowerCase().includes(term))
    );
  }, [rows, search]);

  /*
   * Grouped into ISO calendar weeks, newest first.
   *
   * Keyed by `{isoYear}-W{week}` rather than by week number alone: a week belongs to a year that is
   * not always the calendar year of its dates — the last days of December usually fall in week 1 of
   * the next year — so grouping on the number alone would merge two different weeks five years apart.
   */
  const weeks = useMemo(() => {
    const groups = new Map<string, { week: IsoWeek; rows: LogRow[] }>();
    const undated: LogRow[] = [];

    for (const r of matching) {
      if (r.workDateMs === null) {
        undated.push(r);
        continue;
      }
      const w = isoWeekOf(new Date(r.workDateMs));
      const key = isoWeekKey(w);
      const bucket = groups.get(key) ?? { week: w, rows: [] };
      bucket.rows.push(r);
      groups.set(key, bucket);
    }

    const ordered = [...groups.entries()]
      .sort((a, b) => b[0].localeCompare(a[0]))
      .map(([key, g]) => ({ key, ...g }));

    /*
     * Entries with no date, kept visible rather than dropped.
     *
     * They should not exist — the form requires a date — but a legacy row or a failed write could
     * produce one, and silently hiding it from every week means work that was done and never paid.
     */
    return { ordered, undated };
  }, [matching]);

  /*
   * The four analytics the brief asks for, over whatever is on screen.
   *
   * Boards, revenue, wages and jobs — computed from the filtered rows rather than a separate query,
   * so the chart always describes exactly the entries listed beneath it. Revenue and wages are
   * per-week sums of what those jobs and rates imply; both are approximations stated as such,
   * because the authoritative figures live on the invoice and the wage run.
   */
  const analytics = useMemo(() => {
    return weeks.ordered
      .slice(0, weeksShown)
      .map((g) => {
        const boards = g.rows.reduce((s, r) => s + (r.boardsUsed ?? 0), 0);
        const units = g.rows.reduce(
          (s, r) => s + r.items.reduce((t, it) => t + it.units, 0),
          0
        );
        const jobs = new Set(
          g.rows.flatMap((r) => [r.jobId, ...r.items.map((it) => it.jobId)]).filter(Boolean)
        ).size;
        /*
         * Wages implied by the logged work, operators and assistants together.
         *
         * Priced with the same `rateFor` precedence the wage run uses — per-person rate first, then
         * the rate for that kind of work — and against the rates in force on the day the work was
         * done, not today's. A chart drawn with current rates would silently restate history every
         * time somebody got a raise.
         *
         * It is an estimate: the authoritative figure is the wage run, which applies deductions and
         * can be adjusted before approval. Labelled as such on the chart.
         */
        const wagesKobo = g.rows.reduce((s, r) => {
          const atMs = r.workDateMs ?? Date.now();
          const resolved = resolveRates(rates, atMs);
          const personal = resolveStaffRates(staffRates, atMs);
          return (
            s +
            r.items.reduce((t, it) => {
              const workTypeRate = resolved.get(it.workType);
              const op = rateFor(r.staffId, "operator", it.workType, workTypeRate, personal);
              const assistants = r.assistantIds.reduce(
                (a, id) =>
                  a + rateFor(id, "assistant", it.workType, workTypeRate, personal).rateKobo,
                0
              );
              return t + Math.round(it.units * (op.rateKobo + assistants));
            }, 0)
          );
        }, 0);
        return {
          key: g.key,
          label: `W${g.week.week}`,
          boards,
          units,
          jobs,
          wages: wagesKobo / 100,
        };
      })
      // Oldest to newest, which is how a trend reads.
      .reverse();
  }, [weeks.ordered, weeksShown, rates, staffRates]);

  // The printed range is whatever is on screen, which is what the user just
  // filtered to; labelling it from the rows avoids claiming a period the sheet
  // does not actually cover.
  const printLabel = (() => {
    const dates = rows.map((r) => r.workDateMs).filter((m): m is number => m !== null);
    if (dates.length === 0) return "All entries";
    const f = (ms: number) =>
      new Date(ms).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
    return `${f(Math.min(...dates))} to ${f(Math.max(...dates))}`;
  })();

  return (
    <div className="mx-auto max-w-5xl pb-20">
      {previewing && (
        <PrintPreview
          title="Work log"
          paper="a4-landscape"
          onPrint={() => {
            // Leave the preview open behind the print dialog: closing it first
            // would unmount the sheet before the browser had captured it.
            setPrinting(true);
          }}
          onClose={() => setPreviewing(false)}
        >
          <WorkLogSheet
            rows={rows}
            periodLabel={printLabel}
            autoPrint={false}
            onDone={() => {}}
          />
        </PrintPreview>
      )}

      {printing && (
        <WorkLogSheet
          rows={rows}
          periodLabel={printLabel}
          onDone={() => {
            setPrinting(false);
            setPreviewing(false);
          }}
        />
      )}

      <header className="flex flex-wrap items-end justify-between gap-4 print:hidden">
        <div>
          <p className="text-eyebrow">Payroll</p>
          <h1 className="text-title mt-3 text-cream-50">Work log</h1>
          <p className="mt-3 max-w-2xl text-sm leading-relaxed text-cream-400">
            Every unit of piece-rate work. This is what the weekly wage run reads,
            so an unlogged job is unpaid work.
          </p>
        </div>
        <div className="flex flex-wrap gap-3">
          {rows.length > 0 && (
            <Button variant="secondary" onClick={() => setPreviewing(true)}>
              <span className="flex items-center gap-2">
                <FileText size={15} /> View &amp; download
              </span>
            </Button>
          )}
          {canLog && !adding && (
            <Button onClick={() => setAdding(true)}>
              <span className="flex items-center gap-2">
                <Plus size={15} /> Log work
              </span>
            </Button>
          )}
        </div>
      </header>

      {error && (
        <p
          role="alert"
          className="mt-6 flex items-start gap-2 rounded-xl border border-red-500/30 bg-red-500/5 px-4 py-3 text-sm text-red-400"
        >
          <ShieldAlert size={16} className="mt-0.5 shrink-0" /> {error}
        </p>
      )}
      {notice && (
        <p
          role="status"
          className="mt-6 rounded-xl border border-emerald-500/30 bg-emerald-500/5 px-4 py-3 text-sm text-emerald-300"
        >
          {notice}
        </p>
      )}

      {adding && (
        <WorkLogForm
          actor={actor}
          staff={staff}
          assistantPool={assistantPool}
          rates={rates}
          staffRates={staffRates}
          openJobs={openJobs}
          workTypes={workTypes}
          workingDaysPerMonth={workingDaysPerMonth}
          canDeduct={canDeduct}
          isAdmin={isAdmin}
          canLogForOthers={canLogForOthers}
          selfStaffId={session.staffId}
          selfName={session.displayName}
          onClose={() => setAdding(false)}
          onError={setError}
        />
      )}

      {/* Analytics over what is on screen.
          The four figures the brief names — boards, revenue, wages and jobs — per calendar week.
          Drawn from the filtered rows rather than a separate query, so the chart always describes
          exactly the entries listed beneath it. */}
      {!loading && analytics.length > 1 && isAdmin && (
        <section className="mt-8 rounded-3xl border border-night-700/60 bg-night-900/40 p-6 print:hidden">
          <h2 className="font-display text-lg text-cream-100">By week</h2>
          <p className="mt-1 text-sm text-cream-500">
            Boards off the customers&apos; stacks, units of work, and the wages those imply. Wages
            are an estimate at the rates in force on each day — the wage run is the authority.
          </p>
          <div className="mt-5 h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={analytics} margin={{ top: 4, right: 4, bottom: 0, left: 4 }}>
                <CartesianGrid stroke="#2a221b" vertical={false} />
                <XAxis dataKey="label" stroke="#8a7a68" fontSize={12} tickLine={false} />
                <YAxis stroke="#8a7a68" fontSize={12} tickLine={false} width={44} />
                <Tooltip {...TOOLTIP_PROPS} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Bar dataKey="boards" name="Boards" fill="#c08a3e" radius={[3, 3, 0, 0]} />
                <Bar dataKey="units" name="Units" fill="#8a6a45" radius={[3, 3, 0, 0]} />
                <Bar dataKey="jobs" name="Jobs" fill="#d9b678" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <dl className="mt-4 grid gap-4 border-t border-night-700/60 pt-4 sm:grid-cols-4">
            <Figure
              label="Boards"
              value={String(analytics.reduce((s, a) => s + a.boards, 0))}
            />
            <Figure label="Units" value={String(analytics.reduce((s, a) => s + a.units, 0))} />
            <Figure
              label="Estimated wages"
              value={formatNaira(
                Math.round(analytics.reduce((s, a) => s + a.wages, 0) * 100)
              )}
            />
            <Figure
              label="Weeks shown"
              value={String(analytics.length)}
              hint={`of ${weeks.ordered.length} on file`}
            />
          </dl>
        </section>
      )}

      <section className="mt-8 print:hidden">
        {/* Search. A name, a job number, or a kind of work — the three ways somebody describes
            the entry they are looking for. */}
        {!loading && rows.length > 0 && (
          <div className="mb-5 flex flex-wrap items-end gap-3">
            <div className="min-w-[16rem] flex-1">
              <TextField
                id="wl-search"
                label="Find an entry"
                value={search}
                onChange={setSearch}
                placeholder="Staff name, job number, or kind of work…"
              />
            </div>
            {search.trim() !== "" && (
              <p className="pb-3 text-sm text-cream-500">
                {matching.length} of {rows.length} entries
              </p>
            )}
          </div>
        )}

        {loading ? (
          <div className="flex justify-center py-10">
            <Loader2 className="animate-spin text-brass-400" size={24} aria-label="Loading" />
          </div>
        ) : rows.length === 0 ? (
          <EmptyState
            title="No work logged yet"
            hint="Log the week's work here, then generate the wage run from Payroll."
          />
        ) : matching.length === 0 ? (
          <EmptyState
            title={`Nothing matches “${search.trim()}”`}
            hint="Try a staff name, a job number, or a kind of work."
          />
        ) : (
          <div className="space-y-4">
            {/* One block per ISO calendar week, newest first.
                The brief asks for the list grouped by week 1 to 53. Collapsible because with a
                year of logs on screen the point is to open the week being discussed, and the
                newest opens by default since that is almost always the one wanted. */}
            {weeks.ordered.slice(0, weeksShown).map((group, groupIndex) => {
              const expanded = openWeek === null ? groupIndex === 0 : openWeek === group.key;
              const weekBoards = group.rows.reduce((s, r) => s + (r.boardsUsed ?? 0), 0);
              const weekUnits = group.rows.reduce(
                (s, r) => s + r.items.reduce((t, it) => t + it.units, 0),
                0
              );
              return (
                <div
                  key={group.key}
                  className="overflow-hidden rounded-3xl border border-night-700/60"
                >
                  <button
                    type="button"
                    onClick={() => setOpenWeek(expanded ? "" : group.key)}
                    aria-expanded={expanded}
                    className="flex w-full cursor-pointer flex-wrap items-center justify-between gap-3 bg-night-900/70 px-5 py-3.5 text-left transition-colors hover:bg-night-900"
                  >
                    <span>
                      <span className="block text-sm text-cream-100">
                        {isoWeekRangeLabel(group.week)}
                      </span>
                      <span className="mt-0.5 block text-xs text-cream-500">
                        {group.rows.length} entr{group.rows.length === 1 ? "y" : "ies"}
                        {weekBoards > 0 && ` · ${weekBoards} boards`}
                        {weekUnits > 0 && ` · ${weekUnits} units`}
                      </span>
                    </span>
                    <ChevronDown
                      size={17}
                      className={`shrink-0 text-cream-500 transition-transform ${
                        expanded ? "rotate-180" : ""
                      }`}
                    />
                  </button>

                  {expanded && (
                  <div className="overflow-x-auto">
            <table className="w-full min-w-[46rem] text-left text-sm">
              <thead className="bg-night-900/70 text-xs uppercase tracking-wider text-cream-500">
                <tr>
                  <th className="px-5 py-3 font-medium">Date</th>
                  <th className="px-5 py-3 font-medium">Staff</th>
                  <th className="px-5 py-3 font-medium">Work</th>
                  <th className="px-5 py-3 text-right font-medium">Units</th>
                  <th className="px-5 py-3 font-medium">Assistants</th>
                  {isAdmin && <th className="px-5 py-3" />}
                </tr>
              </thead>
              <tbody className="divide-y divide-night-800">
                {group.rows.map((r) => (
                  <Fragment key={r.id}>
                  <tr>
                    <td className="px-5 py-4 text-cream-400">
                      {r.workDateMs
                        ? new Date(r.workDateMs).toLocaleDateString("en-GB", {
                            day: "numeric",
                            month: "short",
                          })
                        : "-"}
                    </td>
                    <td className="px-5 py-4">
                      <p className="text-cream-100">{r.staffName}</p>
                      {r.jobNumber && (
                        <p className="text-xs text-cream-500">{r.jobNumber}</p>
                      )}
                    </td>
                    {/* One row per work type, stacked. An entry with boards and
                        doors on it has to show both or the smaller count looks
                        like it was never recorded — which is the failure this
                        whole change exists to fix. */}
                    <td className="px-5 py-4 text-cream-300">
                      <ul className="space-y-0.5">
                        {r.items.map((it, i) => (
                          <li key={`${it.workType}-${i}`}>
                            {nameOfWorkType(it.workType)}
                          </li>
                        ))}
                      </ul>
                    </td>
                    <td className="px-5 py-4 text-right text-cream-200">
                      <ul className="space-y-0.5 tabular-nums">
                        {r.items.map((it, i) => (
                          <li key={`${it.workType}-${i}`}>{it.units}</li>
                        ))}
                      </ul>
                      {r.items.length > 1 && (
                        <p className="mt-1 border-t border-night-800 pt-1 text-xs text-cream-500">
                          {totalUnits({ workType: r.items[0].workType, units: r.items[0].units, items: r.items })} total
                        </p>
                      )}
                    </td>
                    <td className="px-5 py-4 text-xs">
                      {r.assistantNames.length > 0 ? (
                        <span className="text-cream-400">
                          {r.assistantNames.join(", ")}
                        </span>
                      ) : r.assistantCount > 0 ? (
                        <span className="flex items-center gap-1.5 text-amber-300">
                          <AlertTriangle size={12} />
                          {r.assistantCount} unnamed
                        </span>
                      ) : (
                        <span className="text-cream-600">None</span>
                      )}
                    </td>
                    {isAdmin && (
                      <td className="px-5 py-4 text-right">
                        <div className="flex justify-end gap-3">
                          <button
                            type="button"
                            aria-label="Edit log"
                            onClick={() =>
                              setEditingId(editingId === r.id ? null : r.id)
                            }
                            className="cursor-pointer text-cream-500 transition-colors hover:text-brass-300"
                          >
                            <PenLine size={15} />
                          </button>
                          {/* Opens the reason panel in the row below, where it has room.
                              Deleting is routed through the approval workflow: a work log
                              is the sole input to payroll, so removing one changes what a
                              real person is paid. */}
                          <button
                            type="button"
                            aria-label="Delete log"
                            onClick={() =>
                              setDeletingId(deletingId === r.id ? null : r.id)
                            }
                            className="cursor-pointer text-cream-500 transition-colors hover:text-red-400"
                          >
                            <Trash2 size={15} />
                          </button>
                        </div>
                      </td>
                    )}
                  </tr>
                  {isAdmin && deletingId === r.id && (
                    <tr>
                      <td colSpan={6} className="px-5 pb-4">
                        <DeleteWithReason
                          targetCollection={COL.workLogs}
                          targetId={r.id}
                          targetLabel={`${r.staffName} · ${describeItems(r.items)}`}
                          description="This is what the wage run reads, so removing it changes what is paid for that period."
                          locked={Boolean(r.pendingApprovalId)}
                          operation="workLog.delete"
                          before={{
                            staffName: r.staffName,
                            items: describeItems(r.items),
                            boardsUsed: r.boardsUsed ?? null,
                          }}
                          hardDelete={() =>
                            deleteWorkLog(
                              getDb(),
                              actor,
                              r.id,
                              `${r.staffName} ${describeItems(r.items)}`
                            )
                          }
                          onDone={(m) => {
                            setError("");
                            setNotice(m);
                            setDeletingId(null);
                            setTimeout(() => setNotice(""), 8000);
                          }}
                          onError={setError}
                          startOpen
                        />
                      </td>
                    </tr>
                  )}
                  {isAdmin && editingId === r.id && (
                    <tr>
                      {/* Corrections sit under the row they change, so the entry
                          being restated stays in view while it is retyped. */}
                      <td colSpan={6} className="px-5 pb-5">
                        <WorkLogForm
                          actor={actor}
                          staff={staff}
                          assistantPool={assistantPool}
                          rates={rates}
                          staffRates={staffRates}
                          openJobs={openJobs}
                          workTypes={workTypes}
                          workingDaysPerMonth={workingDaysPerMonth}
                          canDeduct={canDeduct}
                          isAdmin={isAdmin}
                          canLogForOthers={canLogForOthers}
                          selfStaffId={session.staffId}
                          selfName={session.displayName}
                          editing={r}
                          onClose={() => setEditingId(null)}
                          onError={setError}
                        />
                      </td>
                    </tr>
                  )}
                  </Fragment>
                ))}
              </tbody>
            </table>
                  </div>
                  )}
                </div>
              );
            })}

            {/* Pagination, by week rather than by row: a week is the unit the workshop thinks in,
                and cutting one in half would put Monday and Friday on different pages. */}
            {weeks.ordered.length > weeksShown && (
              <div className="flex flex-wrap items-center gap-3 pt-1">
                <Button variant="secondary" onClick={() => setWeeksShown((n) => n + 6)}>
                  Show earlier weeks
                </Button>
                <p className="text-sm text-cream-500">
                  Showing {weeksShown} of {weeks.ordered.length} weeks
                </p>
              </div>
            )}

            {/* The read cap, stated rather than hidden. At the limit there is older work on file
                that this list is not showing, and a list that looks complete but is not is how a
                week gets missed at wage time. */}
            {rows.length >= LOG_SCAN_CAP && (
              <p className="pt-1 text-xs text-cream-600">
                Showing the most recent {LOG_SCAN_CAP} entries. Older work exists but is not loaded
                here — use the printed sheet or the wage run for a full historical record.
              </p>
            )}

            {/* Entries with no date. They should not exist, but hiding one means work that was
                done and never paid. */}
            {weeks.undated.length > 0 && (
              <p className="rounded-xl border border-amber-500/40 bg-amber-500/5 px-4 py-3 text-sm text-amber-300">
                {weeks.undated.length} entr{weeks.undated.length === 1 ? "y has" : "ies have"} no
                date recorded, so {weeks.undated.length === 1 ? "it is" : "they are"} not in any
                week above: {weeks.undated.map((r) => r.staffName).join(", ")}. Edit to add the date.
              </p>
            )}
          </div>
        )}
      </section>
    </div>
  );
}

/**
 * The one work log form, used to log and to correct.
 *
 * A correction has to offer every field the entry carries, including the named
 * assistants: an assistant left off the original entry is somebody who was not
 * paid, and reaching them means retyping the same form rather than a reduced one.
 */
/** One editable work-type row in the form. */
interface ItemDraft {
  /** Stable across re-renders so React keys survive a row being removed. */
  key: number;
  workType: WageWorkType | "";
  units: string;
  /**
   * The job this particular kind of work was for.
   *
   * Empty means the entry's job. One shift can span two customers — 20 boards cut for one,
   * 12 edged for another — and forcing that into two records meant the second was skipped.
   */
  jobId: string;
}

let nextItemKey = 1;
const newItemDraft = (): ItemDraft => ({
  key: nextItemKey++,
  workType: "",
  units: "",
  jobId: "",
});

function WorkLogForm({
  actor,
  staff,
  assistantPool,
  rates,
  staffRates,
  openJobs,
  workingDaysPerMonth,
  workTypes,
  canDeduct,
  isAdmin,
  canLogForOthers,
  selfStaffId,
  selfName,
  editing,
  onClose,
  onError,
}: {
  actor: AuditActor;
  staff: StaffOption[];
  assistantPool: StaffOption[];
  rates: WageRate[];
  staffRates: StaffRate[];
  openJobs: OpenJob[];
  /** Kinds of work on offer, built-in and workshop-added together. */
  workTypes: ResolvedWorkType[];
  /** Working days in a month, for pro-rating a salaried absence. */
  workingDaysPerMonth: number;
  canDeduct: boolean;
  isAdmin: boolean;
  canLogForOthers: boolean;
  selfStaffId: string | null;
  selfName: string;
  editing?: LogRow;
  onClose: () => void;
  onError: (m: string) => void;
}) {
  const [operator, setOperator] = useState<PickedStaff | null>(
    editing ? { id: editing.staffId, name: editing.staffName } : null
  );
  const [items, setItems] = useState<ItemDraft[]>(() =>
    editing && editing.items.length > 0
      ? editing.items.map((i) => ({
          key: nextItemKey++,
          workType: i.workType,
          units: String(i.units),
          jobId: i.jobId ?? "",
        }))
      : [newItemDraft()]
  );
  const [workDate, setWorkDate] = useState(
    toDateInputValue(editing?.workDateMs ? new Date(editing.workDateMs) : new Date())
  );
  const [assistantIds, setAssistantIds] = useState<string[]>(editing?.assistantIds ?? []);
  const [jobId, setJobId] = useState(editing?.jobId ?? "");
  const [boardsUsed, setBoardsUsed] = useState(
    editing?.boardsUsed !== undefined && editing.boardsUsed !== null
      ? String(editing.boardsUsed)
      : ""
  );
  const [edgeTapeUsed, setEdgeTapeUsed] = useState(
    editing?.edgeTapeUsed !== undefined && editing.edgeTapeUsed !== null
      ? String(editing.edgeTapeUsed)
      : ""
  );
  const [busy, setBusy] = useState(false);

  /**
   * What is left on the customer's stack for the job selected.
   *
   * Fetched so the form can warn *before* the entry is saved. An operator drawing more
   * sheets than the customer brought is either a mis-count or a mix-up with another
   * customer's pile, and both are far cheaper to catch at the machine than in a dispute
   * weeks later.
   *
   * The entry being corrected excludes its own prior contribution, or editing it would
   * count its boards against itself and always look like an over-draw.
   */
  const [stack, setStack] = useState<{
    received: number;
    used: number;
    remaining: number;
    receivedTape: number;
    usedTape: number;
    remainingTape: number;
  } | null>(null);

  useEffect(() => {
    // The job the materials come off: the entry's, or the first item that names one.
    const target = jobId || items.find((i) => i.jobId)?.jobId || "";
    if (!target) {
      setStack(null);
      return;
    }
    let live = true;
    boardsRemainingOnJob(getDb(), target, editing?.id)
      .then((r) => {
        if (live) setStack(r);
      })
      .catch(() => {
        // A read failure must not block logging work; the warning simply does not show.
        if (live) setStack(null);
      });
    return () => {
      live = false;
    };
    // `items` is intentionally not a dependency in full: only the job selections matter,
    // and depending on the whole array would refetch on every keystroke in a unit box.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobId, items.map((i) => i.jobId).join("|"), editing?.id]);

  /** True when this entry would draw more sheets than the stack holds. */
  const overDraw = useMemo(() => {
    const want = Number(boardsUsed);
    if (!stack || !Number.isFinite(want) || want <= 0) return null;
    if (want <= stack.remaining) return null;
    return { want, remaining: stack.remaining, over: want - stack.remaining };
  }, [boardsUsed, stack]);

  /** The same check for tape, which is over-drawn just as easily and in rolls. */
  const tapeOverDraw = useMemo(() => {
    const want = Number(edgeTapeUsed);
    if (!stack || !Number.isFinite(want) || want <= 0) return null;
    // Only warn where tape was actually received: a job with no tape on the intake form
    // may legitimately draw from the workshop's own roll.
    if (stack.receivedTape <= 0 || want <= stack.remainingTape) return null;
    return { want, remaining: stack.remainingTape, over: want - stack.remainingTape };
  }, [edgeTapeUsed, stack]);

  /*
   * Deduction alongside the work.
   *
   * Only on a new entry, never on a correction. A deduction is a separate document
   * once written, and offering the field again while editing would raise a *second*
   * one every time the work was corrected — silently docking someone twice for the
   * same no-show.
   */
  const [dedType, setDedType] = useState<DeductionType | "">("");
  const [dedAmount, setDedAmount] = useState("");
  const [dedReason, setDedReason] = useState("");
  /** Days absent, when the deduction is a no-show. Drives the derived amount. */
  const [dedDays, setDedDays] = useState("1");

  // Field ids are suffixed per entry, since a correction can be open while the
  // create form is showing and duplicate ids would misdirect the labels.
  const key = editing ? editing.id : "new";

  // Memoised because it is a dependency of the estimate below, and a fresh object
  // literal every render would recompute the whole preview on each keystroke.
  const chosenStaff = useMemo(
    () =>
      canLogForOthers
        ? operator
        : selfStaffId
          ? { id: selfStaffId, name: selfName }
          : null,
    [canLogForOthers, operator, selfStaffId, selfName]
  );

  /*
   * A no-show's amount, derived rather than typed.
   *
   * A day absent costs a day's pay, which for a salaried person is their monthly figure
   * over the working days in a month. Everything else — a penalty, an advance — is a
   * judgement or a sum handed over, so those stay entered. See `DEDUCTION_AMOUNT_SOURCE`.
   *
   * For a piece-rate worker the day rate is zero, and that is correct rather than a gap:
   * an operator who does not turn up logs no work and so earns nothing for the day. The
   * absence is already reflected in their pay, and deducting on top would charge them
   * twice for one missed day. The form says so rather than silently offering zero.
   */
  const dedStaff = useMemo(
    () => (chosenStaff ? staff.find((s) => s.id === chosenStaff.id) : undefined),
    [chosenStaff, staff]
  );

  const derivedDeduction = useMemo(() => {
    if (dedType !== "no_show" || !dedStaff) return null;
    const days = Math.max(1, Number(dedDays) || 1);
    const perDay = dayRateKobo(dedStaff, workingDaysPerMonth);
    return { perDay, days, amountKobo: perDay * days };
  }, [dedType, dedStaff, dedDays, workingDaysPerMonth]);

  // Kept in step with the derivation, so the field the user sees is the figure that saves.
  useEffect(() => {
    if (derivedDeduction && derivedDeduction.amountKobo > 0) {
      setDedAmount(String(toNaira(derivedDeduction.amountKobo)));
    }
  }, [derivedDeduction]);

  function patchItem(k: number, next: Partial<ItemDraft>) {
    setItems((prev) => prev.map((i) => (i.key === k ? { ...i, ...next } : i)));
  }

  /**
   * What the entry is worth, per work type and per person.
   *
   * Uses the same `rateFor` precedence the wage run uses, so the figure previewed is
   * the figure that will be paid — including where this operator is on their own
   * rate. Showing the standard rate to someone who is not on it is worse than
   * showing nothing.
   */
  const estimate = useMemo(() => {
    if (!isAdmin) return null;

    const atMs = fromDateInputValue(workDate).getTime();
    const resolved = resolveRates(rates, atMs);
    const personal = resolveStaffRates(staffRates, atMs);

    const rows: Array<{
      workType: WageWorkType;
      units: number;
      operatorKobo: number;
      assistantKobo: number;
      personal: boolean;
      missing: boolean;
    }> = [];

    for (const draft of items) {
      const units = Number(draft.units);
      // Pulled into a local so the narrowing survives into the closure below,
      // which a property access on `draft` would not.
      const workType = draft.workType;
      if (!workType || !Number.isFinite(units) || units <= 0) continue;

      const workTypeRate = resolved.get(workType);
      const op = chosenStaff
        ? rateFor(chosenStaff.id, "operator", workType, workTypeRate, personal)
        : { rateKobo: workTypeRate?.operatorRateKobo ?? 0, personal: false };

      // Each assistant may be on their own rate, so they are priced individually
      // rather than as count × one rate.
      const assistantKobo = assistantIds.reduce((sum, id) => {
        const a = rateFor(id, "assistant", workType, workTypeRate, personal);
        return sum + Math.round(units * a.rateKobo);
      }, 0);

      rows.push({
        workType,
        units,
        operatorKobo: Math.round(units * op.rateKobo),
        assistantKobo,
        personal: op.personal,
        missing: !workTypeRate && !op.personal,
      });
    }

    if (rows.length === 0) return null;
    return {
      rows,
      operatorKobo: rows.reduce((s, r) => s + r.operatorKobo, 0),
      assistantKobo: rows.reduce((s, r) => s + r.assistantKobo, 0),
      anyMissing: rows.some((r) => r.missing),
      anyPersonal: rows.some((r) => r.personal),
    };
  }, [isAdmin, items, workDate, rates, staffRates, assistantIds, chosenStaff]);

  function toggleAssistant(id: string) {
    setAssistantIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  }

  async function submit() {
    if (!chosenStaff) {
      onError(
        canLogForOthers
          ? "Select who did the work."
          : "Your login is not linked to a staff record, so work cannot be attributed. Ask an admin to link it."
      );
      return;
    }

    const filled = items.filter((i) => i.workType && Number(i.units) > 0);
    if (filled.length === 0) {
      onError("Add at least one kind of work with a unit count above zero.");
      return;
    }
    // Caught here as well as merged in `normaliseItems`, because a duplicate is
    // usually a mis-click rather than an intention to add two counts together, and
    // silently summing them hides that.
    const types = filled.map((i) => i.workType);
    if (new Set(types).size !== types.length) {
      onError("The same kind of work is listed twice. Combine the units into one row.");
      return;
    }

    const dedKobo = dedType ? parseNairaInput(dedAmount) : 0;
    if (dedType && !(dedKobo > 0)) {
      onError("Enter the deduction amount, or clear the deduction type.");
      return;
    }

    setBusy(true);
    onError("");
    try {
      const job = openJobs.find((j) => j.id === jobId);
      const input = {
        staffId: chosenStaff.id,
        staffName: chosenStaff.name,
        items: filled.map((i) => {
          const itemJob = i.jobId ? openJobs.find((j) => j.id === i.jobId) : undefined;
          return {
            workType: i.workType as WageWorkType,
            units: Number(i.units),
            // Only carried when it differs from the entry's job, so the common case of
            // one job for everything stays a single field on the entry.
            ...(i.jobId && i.jobId !== jobId
              ? { jobId: i.jobId, jobNumber: itemJob?.jobNumber }
              : {}),
          };
        }),
        boardsUsed: boardsUsed.trim() === "" ? undefined : Number(boardsUsed),
        edgeTapeUsed:
          edgeTapeUsed.trim() === "" ? undefined : Number(edgeTapeUsed),
        workDate: fromDateInputValue(workDate),
        assistantIds,
        // Names are stored alongside the ids so the printed sheet and the wage
        // run do not depend on the staff list still holding the record. An
        // assistant already on the entry keeps the name it was saved with.
        assistantNames: assistantIds.map(
          (id) =>
            staff.find((s) => s.id === id)?.name ??
            editing?.assistantNames[editing.assistantIds.indexOf(id)] ??
            id
        ),
        jobId: jobId || undefined,
        // Kept alongside the id so the printed sheet and older readers still show
        // something meaningful without resolving the job.
        jobNumber: job?.jobNumber ?? editing?.jobNumber,
        ...(dedType && dedKobo > 0
          ? {
              deduction: {
                type: dedType,
                amountKobo: dedKobo,
                // The day count is folded into the reason for a no-show, so a payslip
                // query can be answered without re-deriving it from the amount.
                reason:
                  dedType === "no_show"
                    ? [
                        `${derivedDeduction?.days ?? 1} day(s) absent`,
                        dedReason.trim(),
                      ]
                        .filter(Boolean)
                        .join(" — ")
                    : dedReason.trim() || undefined,
              },
            }
          : {}),
      };
      if (editing) {
        await updateWorkLog(getDb(), actor, editing.id, input);
      } else {
        await createWorkLog(getDb(), actor, input);
      }
      onClose();
    } catch (e) {
      onError(e instanceof Error ? e.message : "Could not save the work log.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="mt-6 rounded-3xl border border-brass-500/30 print:hidden bg-night-900/40 p-6">
      <h2 className="flex items-center gap-2 font-display text-lg text-cream-100">
        <ClipboardList size={18} className="text-brass-400" />{" "}
        {editing ? "Correct this work log" : "New work log"}
      </h2>

      <div className="mt-5 grid gap-4 sm:grid-cols-2">
        {canLogForOthers ? (
          <StaffPicker
            value={operator}
            onChange={setOperator}
            createdBy={actor.uid}
            label="Work done by"
            required
          />
        ) : (
          <TextField
            id={`wl-self-${key}`}
            label="Work done by"
            value={selfName}
            disabled
          />
        )}
        <DateField
          id={`wl-date-${key}`}
          label="Date"
          value={workDate}
          max={toDateInputValue(new Date())}
          onChange={setWorkDate}
          required
        />
        <div className="sm:col-span-2">
          {/* The job, selected from what is actually open.
              A dropdown rather than a typed number: a mistyped job number links the
              work to nothing, and the boards-remaining figure depends on this link
              being real. */}
          {openJobs.length > 0 ? (
            <SelectField
              id={`wl-job-${key}`}
              label="Job in progress (optional)"
              value={jobId}
              onChange={setJobId}
              placeholder="Not against a specific job"
              options={openJobs.map((j) => ({
                value: j.id,
                label: `${j.jobNumber} · ${j.customerName} · ${JOB_STATUS_LABELS[j.status]}`,
              }))}
            />
          ) : (
            <TextField
              id={`wl-job-${key}`}
              label="Job number (optional)"
              value={editing?.jobNumber ?? ""}
              disabled
              hint="no open jobs available to select"
            />
          )}
        </div>
      </div>

      {/* Work done: several kinds, each with its own count.
          A shift is not one kind of work. An operator cuts boards, edges some of
          them and hangs a door, all on the same job with the same assistants —
          and on paper only the largest number got written down. */}
      <fieldset className="mt-6">
        <legend className="mb-2 flex items-center gap-2 text-sm text-cream-300">
          <ClipboardList size={15} className="text-brass-400" /> Work done
          <span className="text-brass-400">*</span>
        </legend>

        <div className="space-y-3">
          {items.map((item, index) => (
            <div
              key={item.key}
              className="grid gap-3 sm:grid-cols-[1fr_7rem_1fr_auto] sm:items-end"
            >
              <SelectField
                id={`wl-type-${key}-${item.key}`}
                label={index === 0 ? "Type of work" : ""}
                value={item.workType}
                onChange={(v) => patchItem(item.key, { workType: v as WageWorkType })}
                placeholder="Select…"
                // The effective list, so a kind of work added under Piece Rates can
                // actually be logged against. Offering only the built-in enum meant a new
                // rate could be set and then never used.
                options={workTypes.map((w) => ({ value: w.id, label: w.label }))}
              />
              <NumberField
                id={`wl-units-${key}-${item.key}`}
                label={index === 0 ? "Units" : ""}
                value={item.units}
                onChange={(v) => patchItem(item.key, { units: v })}
                hint={item.workType === "grooving" ? "mm" : undefined}
              />
              {/* Per-item job. Left blank it inherits the entry's, which is the common
                  case; set, it covers a shift that spanned two customers. */}
              <SelectField
                id={`wl-item-job-${key}-${item.key}`}
                label={index === 0 ? "For which job" : ""}
                value={item.jobId}
                onChange={(v) => patchItem(item.key, { jobId: v })}
                placeholder={jobId ? "Same as above" : "Not job-specific"}
                options={openJobs.map((j) => ({
                  value: j.id,
                  label: `${j.jobNumber} · ${j.customerName}`,
                }))}
              />
              <button
                type="button"
                aria-label="Remove this kind of work"
                // Never removable down to nothing: an entry with no work on it is
                // not a work log, and leaving one empty row keeps the form usable.
                disabled={items.length === 1}
                onClick={() =>
                  setItems((prev) => prev.filter((x) => x.key !== item.key))
                }
                className="flex h-12 w-12 cursor-pointer items-center justify-center rounded-xl border border-night-600 text-cream-500 transition-colors hover:border-red-500/50 hover:text-red-400 disabled:cursor-not-allowed disabled:opacity-40"
              >
                <Trash2 size={15} />
              </button>
            </div>
          ))}
        </div>

        <button
          type="button"
          onClick={() => setItems((prev) => [...prev, newItemDraft()])}
          className="mt-3 flex cursor-pointer items-center gap-1.5 text-sm text-brass-300 transition-colors hover:text-brass-200"
        >
          <Plus size={14} /> Add another kind of work
        </button>
      </fieldset>

      {/* Materials drawn from the customer's stack.
          Recorded rather than worked out from the unit counts, because 40 pieces
          routinely come out of 12 boards — treating units as sheets would claim 40 off a
          stack that only ever held 12. */}
      <fieldset className="mt-6 rounded-2xl border border-night-700/60 bg-night-950/30 p-5">
        <legend className="px-2 flex items-center gap-2 text-sm text-cream-300">
          <Layers size={15} className="text-brass-400" /> Materials used
        </legend>

        <div className="grid gap-4 sm:grid-cols-2">
          <NumberField
            id={`wl-boards-${key}`}
            label="Boards used"
            value={boardsUsed}
            onChange={setBoardsUsed}
            hint={
              stack
                ? `${stack.remaining} left of ${stack.received} received`
                : "sheets taken from the stack"
            }
          />
          <NumberField
            id={`wl-tape-${key}`}
            label="Edge tape used"
            value={edgeTapeUsed}
            onChange={setEdgeTapeUsed}
            hint={
              stack && stack.receivedTape > 0
                ? `${stack.remainingTape} of ${stack.receivedTape} roll(s) left`
                : "rolls"
            }
          />
        </div>

        {/* The over-draw flag. Not a hard block: the count on record may simply be
            wrong, and refusing the entry would leave the work unpaid to protect a figure
            that was already inaccurate. It is loud, and it says what to check. */}
        {overDraw && (
          <p className="mt-4 flex items-start gap-2 rounded-xl border border-amber-500/50 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
            <AlertTriangle size={16} className="mt-0.5 shrink-0" />
            <span>
              This draws {overDraw.want} boards but only{" "}
              <strong className="font-medium">{overDraw.remaining}</strong> are left on
              this job — {overDraw.over} more than the customer brought in. Check the count
              on the stack, whether boards arrived without being entered, or whether this
              is another customer&rsquo;s pile. Saving it will flag the job as over-cut.
            </span>
          </p>
        )}

        {tapeOverDraw && (
          <p className="mt-3 flex items-start gap-2 rounded-xl border border-amber-500/50 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
            <AlertTriangle size={16} className="mt-0.5 shrink-0" />
            <span>
              This draws {tapeOverDraw.want} roll(s) of tape but only{" "}
              <strong className="font-medium">{tapeOverDraw.remaining}</strong> are left on
              this job. Check whether the tape came from the workshop&rsquo;s own stock
              rather than the customer&rsquo;s.
            </span>
          </p>
        )}

        {!overDraw && stack && Number(boardsUsed) > 0 && (
          <p className="mt-3 text-xs text-cream-500">
            Leaves {stack.remaining - Number(boardsUsed)} board
            {stack.remaining - Number(boardsUsed) === 1 ? "" : "s"} on this job.
          </p>
        )}
      </fieldset>

      {/* Assistants: named, not counted */}
      <fieldset className="mt-6">
        <legend className="mb-2 flex items-center gap-2 text-sm text-cream-300">
          <Users size={15} className="text-brass-400" /> Assistants on this work
        </legend>
        {assistantPool.length === 0 ? (
          <p className="text-xs text-cream-500">
            No staff are marked as assistants yet. Set the assistant flag on a
            staff record to list them here.
          </p>
        ) : (
          <>
            <div className="flex flex-wrap gap-2">
              {assistantPool.map((a) => {
                const on = assistantIds.includes(a.id);
                return (
                  <button
                    key={a.id}
                    type="button"
                    onClick={() => toggleAssistant(a.id)}
                    aria-pressed={on}
                    className={`cursor-pointer rounded-full border px-4 py-2 text-xs font-medium transition-all duration-300 ${
                      on
                        ? "border-brass-500 bg-brass-500 text-night-950"
                        : "border-night-600 text-cream-300 hover:border-brass-500/60 hover:text-brass-300"
                    }`}
                  >
                    {a.name}
                  </button>
                );
              })}
            </div>
            <p className="mt-2 text-xs text-cream-500">
              Each assistant selected earns the assistant rate on these units.
              Naming them is what lets the wage run pay the right people.
            </p>
          </>
        )}
      </fieldset>

      {/* Deduction, raised with the work.
          Here because this is the moment the supervisor remembers the no-show or
          the breakage. It only proposes the reduction — the wage run that applies
          it still has to be approved. */}
      {canDeduct && !editing && (
        <fieldset className="mt-6 rounded-2xl border border-night-700/60 bg-night-950/30 p-5">
          <legend className="px-2 text-sm text-cream-300">
            Deduction from this person&rsquo;s pay (optional)
          </legend>
          <div className="grid gap-4 sm:grid-cols-2">
            <SelectField
              id={`wl-ded-type-${key}`}
              label="Reason type"
              value={dedType}
              onChange={(v) => setDedType(v as DeductionType)}
              placeholder="No deduction"
              options={DEDUCTION_TYPES.map((t) => ({
                value: t,
                label: DEDUCTION_TYPE_LABELS[t],
              }))}
            />
            {/* Days absent, for a no-show only. The amount below follows from it. */}
            {dedType === "no_show" && (
              <NumberField
                id={`wl-ded-days-${key}`}
                label="Days absent"
                value={dedDays}
                onChange={setDedDays}
              />
            )}
            <NairaField
              id={`wl-ded-amount-${key}`}
              label="Amount"
              valueKobo={dedAmount}
              onChangeKobo={setDedAmount}
              disabled={!dedType}
              hint={
                dedType === "no_show" && (derivedDeduction?.perDay ?? 0) > 0
                  ? `${formatNaira(derivedDeduction!.perDay)} a day`
                  : undefined
              }
            />
          </div>

          {/* A no-show for a piece-rate worker is already reflected in their pay: they
              logged no work, so they earned nothing for the day. Deducting on top would
              charge them twice for one absence, so the form says so rather than quietly
              offering zero. */}
          {dedType === "no_show" && dedStaff && (derivedDeduction?.perDay ?? 0) === 0 && (
            <p className="mt-3 flex items-start gap-2 text-xs text-amber-300">
              <AlertTriangle size={13} className="mt-0.5 shrink-0" />
              {dedStaff.name} is paid per piece, so an absence already costs them the day&rsquo;s
              work — there is nothing to deduct on top. Record a penalty instead if something
              is genuinely owed.
            </p>
          )}

          {dedType === "no_show" && (derivedDeduction?.amountKobo ?? 0) > 0 && (
            <p className="mt-3 text-xs text-cream-500">
              {derivedDeduction!.days} day{derivedDeduction!.days === 1 ? "" : "s"} ×{" "}
              {formatNaira(derivedDeduction!.perDay)} — a month&rsquo;s salary over{" "}
              {workingDaysPerMonth} working days. Change the amount if a different figure
              was agreed.
            </p>
          )}
          {dedType && (
            <div className="mt-4">
              <TextAreaField
                id={`wl-ded-reason-${key}`}
                label="Note"
                value={dedReason}
                onChange={setDedReason}
                rows={2}
                placeholder="What happened, so this can be explained later"
              />
            </div>
          )}
          <p className="mt-3 text-xs leading-relaxed text-cream-500">
            Applied automatically by the next wage run, which still needs approving.
            It is taken whole or not at all — if a week&rsquo;s pay cannot cover it,
            it stays pending for the following run.
          </p>
        </fieldset>
      )}

      {estimate && (
        <div className="mt-5 rounded-2xl border border-night-700/60 bg-night-950/40 p-4 text-sm">
          {estimate.anyMissing && (
            <p className="mb-3 flex items-start gap-2 text-amber-300">
              <AlertTriangle size={15} className="mt-0.5 shrink-0" />
              One or more of these work types has no rate in force, so it will be
              left out of the wage run until one is set.
            </p>
          )}

          {/* Per work type, because the whole point of a multi-type entry is that
              the types are priced differently. */}
          {estimate.rows.length > 1 && (
            <ul className="mb-3 space-y-1 border-b border-night-800 pb-3">
              {estimate.rows.map((r) => (
                <li key={r.workType} className="flex justify-between gap-4 text-xs">
                  <span className="text-cream-400">
                    {r.units} ×{" "}
                    {workTypes.find((t) => t.id === r.workType)?.label ?? r.workType}
                    {r.missing && <span className="ml-1.5 text-amber-400">no rate</span>}
                  </span>
                  <span className="tabular-nums text-cream-300">
                    {formatNaira(r.operatorKobo + r.assistantKobo)}
                  </span>
                </li>
              ))}
            </ul>
          )}

          <div className="flex flex-wrap gap-6">
            <span className="text-cream-400">
              Operator:{" "}
              <span className="text-cream-100">
                {formatNaira(estimate.operatorKobo)}
              </span>
            </span>
            {estimate.assistantKobo > 0 && (
              <span className="text-cream-400">
                Assistants:{" "}
                <span className="text-cream-100">
                  {formatNaira(estimate.assistantKobo)}
                </span>
              </span>
            )}
            <span className="text-cream-400">
              Total:{" "}
              <span className="font-medium text-brass-300">
                {formatNaira(estimate.operatorKobo + estimate.assistantKobo)}
              </span>
            </span>
          </div>

          {estimate.anyPersonal && (
            <p className="mt-2 text-xs text-cream-500">
              Includes a rate set for this person specifically, rather than the
              standard rate for the work.
            </p>
          )}
        </div>
      )}

      <div className="mt-6 flex gap-3">
        <Button onClick={submit} busy={busy}>
          {editing ? "Save changes" : "Save log"}
        </Button>
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
      </div>
    </section>
  );
}

/** One figure in the weekly analytics summary. */
function Figure({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wider text-cream-600">{label}</dt>
      <dd className="mt-1 font-display text-lg text-cream-100">{value}</dd>
      {hint && <dd className="mt-0.5 text-xs text-cream-600">{hint}</dd>}
    </div>
  );
}

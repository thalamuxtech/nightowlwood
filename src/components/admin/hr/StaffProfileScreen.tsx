"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  collection,
  getDocs,
  limit as fsLimit,
  orderBy,
  query,
  where,
} from "firebase/firestore";
import {
  AlertTriangle,
  BadgeMinus,
  CalendarX,
  CheckCircle2,
  Coins,
  FileText,
  HandCoins,
  Package,
  ShieldAlert,
  UserRound,
  Wallet,
  Wrench,
} from "lucide-react";
import { getDb } from "@/lib/firebase";
import { COL, toolItemsPath } from "@/lib/erp/collections";
import {
  ATTENDANCE_STATUS_LABELS,
  DEDUCTION_TYPE_LABELS,
  EMPLOYMENT_TYPE_LABELS,
  STAFF_ROLE_LABELS,
  STAFF_STATUS_LABELS,
  type DeductionType,
} from "@/lib/erp/enums";
import { formatNaira, parseNairaInput } from "@/lib/erp/money";
import {
  dayRateKobo,
  deductionRaisedFor,
  hrSettings,
  linkAbsenceDeduction,
  loadAttendance,
  loadStaffStats,
  markAttendance,
  suggestedDeductionKobo,
  type AttendanceMark,
  type StaffStats,
} from "@/lib/erp/hr";
import { createDeduction, deleteDeduction } from "@/lib/erp/workLogs";
import { DEFAULT_HR_SETTINGS, type HrSettings } from "@/lib/erp/settings";
import type { Staff } from "@/lib/erp/types";
import {
  Button,
  DateField,
  NairaField,
  TextField,
  todayIso,
} from "@/components/admin/ui/Fields";
import { StatusPill, type PillTone } from "@/components/admin/ui/StatusPill";
import { useAuditActor, useErpSession } from "@/components/admin/ErpAuthProvider";

/**
 * One person's whole file, on one screen.
 *
 * The four figures at the top are the ones a staff member actually asks about — what have I
 * earned here, what do I still owe, how many days have I missed, what have I been docked — and
 * every one of them was previously answered by an admin scrolling through records, or from
 * memory. They are read across loans, deductions, the paid runs and the work logs rather than
 * kept as counters on the staff record, because a denormalised total that drifts from its source
 * is worse than a query that takes a moment.
 *
 * The quick actions are here for the same reason: an advance handed over at the bench, a penalty
 * for a damaged panel, a day marked absent. Each was a trip to a different screen, which is how
 * they ended up on scraps of paper instead.
 *
 * Nothing here takes money by itself. A penalty or an absence *proposes* a reduction; the wage or
 * salary run that consumes it still needs its own approval. That separation is what makes it safe
 * to give this screen to a supervisor.
 */

const TONE_BY_STATUS: Record<string, PillTone> = {
  active: "positive",
  suspended: "warn",
  exited: "neutral",
};

/** A tool still signed out to this person. */
interface ToolHeld {
  id: string;
  name: string;
  issuedAtMs: number | null;
  requestId: string;
}

export function StaffProfileScreen({ staff }: { staff: Staff }) {
  const session = useErpSession();
  const canDeduct = session.can("deduction.create");
  const canMarkAttendance = session.can("worklog.viewAll") || session.can("staff.edit");

  const [stats, setStats] = useState<StaffStats | null>(null);
  const [hr, setHr] = useState<HrSettings>(DEFAULT_HR_SETTINGS);
  const [attendance, setAttendance] = useState<AttendanceMark[]>([]);
  const [toolsHeld, setToolsHeld] = useState<ToolHeld[]>([]);
  /** Set when the tool read failed, so an empty list is never shown as "all returned". */
  const [toolsError, setToolsError] = useState("");
  /** How many requests the scan covered, so the cap can be stated rather than hidden. */
  const [toolsScanned, setToolsScanned] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [version, setVersion] = useState(0);
  /** Which deduction is being withdrawn, so only that row's button shows as busy. */
  const [removingId, setRemovingId] = useState<string | null>(null);

  /** Which quick action is open. One at a time — three open forms on a profile is noise. */
  const [action, setAction] = useState<"advance" | "penalty" | "absence" | null>(null);
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [actionDate, setActionDate] = useState(todayIso());

  const actor = useAuditActor();

  const load = useCallback(() => {
    setLoading(true);
    Promise.all([
      loadStaffStats(getDb(), staff.id),
      hrSettings(getDb()),
      loadAttendance(getDb(), { staffId: staff.id, limit: 60 }),
    ])
      .then(([s, h, a]) => {
        setStats(s);
        setHr(h);
        setAttendance(a);
      })
      .catch((e) =>
        setError(e instanceof Error ? e.message : "Could not read this person's record.")
      )
      .finally(() => setLoading(false));
  }, [staff.id]);

  useEffect(load, [load, version]);

  /*
   * Tools still signed out to this person.
   *
   * Read across every open tool request rather than from a per-person index, because a tool is
   * issued against a request and the request is the document that exists. The brief calls this out
   * as the feature that saves money: a drill nobody remembers issuing is a drill that is bought
   * twice, and it is the one thing an exit clearance must check.
   */
  useEffect(() => {
    let live = true;
    setToolsError("");
    /*
     * Capped and read in parallel.
     *
     * One query per request's items, because a tool is issued against a request and the request is
     * the document that exists. Bounded to the most recent 60 requests: unbounded, this was a read
     * of every request the workshop has ever raised plus one subquery each, serially, on every
     * profile open. Anything still signed out is on a recent request in practice — and if it is
     * not, the cap is stated rather than hidden.
     */
    const CAP = 60;
    getDocs(
      query(
        collection(getDb(), COL.toolRequests),
        orderBy("requestedAt", "desc"),
        fsLimit(CAP)
      )
    )
      .then(async (reqSnap) => {
        const perRequest = await Promise.all(
          reqSnap.docs.map(async (req) => {
            const items = await getDocs(
              query(
                collection(getDb(), toolItemsPath(req.id)),
                where("issuedToStaffId", "==", staff.id)
              )
            );
            return items.docs
              // Returned tools are not held. `returnedAt` unset is what "still out" means.
              .filter((item) => !item.data().returnedAt)
              .map((item) => {
                const x = item.data();
                return {
                  id: item.id,
                  name: String(x.name ?? x.toolName ?? "Tool"),
                  issuedAtMs: x.issuedAt?.toMillis?.() ?? null,
                  requestId: req.id,
                };
              });
          })
        );
        if (live) {
          setToolsHeld(perRequest.flat());
          setToolsScanned(reqSnap.size);
        }
      })
      /*
       * Recorded, never swallowed.
       *
       * This read needs `tool.request`, which whoever can open a staff profile may not hold. An
       * empty list would then render on the exit checklist below as a green "All returned" —
       * asserting the opposite of what is known, on the one screen whose whole purpose is stopping
       * a final payment before the tools come back.
       */
      .catch((e) => {
        if (live) {
          setToolsError(
            e instanceof Error
              ? `Could not check tools: ${e.message}`
              : "Could not check what tools this person is holding."
          );
        }
      });
    return () => {
      live = false;
    };
  }, [staff.id, version]);

  const dayRate = dayRateKobo(staff, hr.workingDaysPerMonth);

  /** Absences in the register, distinct from the deduction-derived count in `stats`. */
  const absenceDays = attendance.filter((a) => a.status === "absent");
  const uncharged = absenceDays.filter((a) => !a.deductionId);

  function openAction(next: typeof action) {
    setAction(next);
    setError("");
    setActionDate(todayIso());
    setReason("");
    // A no-show has a computable amount; the others are judgements. Pre-filling the day rate
    // saves the arithmetic and can still be typed over.
    setAmount(
      next === "absence" && dayRate > 0 ? String(Math.round(dayRate / 100)) : ""
    );
  }

  async function submitAction() {
    if (!action) return;
    setError("");

    const amountKobo =
      action === "absence" && !amount.trim()
        ? suggestedDeductionKobo("no_show", staff, hr.workingDaysPerMonth)
        : parseNairaInput(amount);

    if (!(amountKobo > 0)) {
      setError("Enter an amount greater than zero.");
      return;
    }
    if (action !== "advance" && !reason.trim()) {
      setError("Give a reason — this reduces someone's pay, and they will ask why.");
      return;
    }

    const type: DeductionType =
      action === "advance" ? "advance" : action === "penalty" ? "penalty" : "no_show";

    setBusy(true);
    try {
      const [y, m, d] = actionDate.split("-").map(Number);
      const when = new Date(y, m - 1, d);

      /*
       * An absence is written to the register *before* the money is raised, and only if the day
       * has not already been charged.
       *
       * The order matters more than it looks. Charging first and marking second means a failure
       * between the two leaves a pending deduction that the register shows as uncharged — so the
       * next person to look raises it again and a day's pay comes off twice. Marking first means
       * the worst failure leaves a recorded absence with no deduction, which is visible, safe, and
       * fixable by pressing the same button again.
       *
       * The `deductionRaisedFor` check is the actual guard: the register keeps its link across
       * every correction, so a day charged once cannot be charged again through this path.
       */
      if (action === "absence") {
        const already = await deductionRaisedFor(getDb(), actionDate, staff.id);
        if (already) {
          setError(
            `${actionDate} has already been charged for this person. Reverse the existing deduction rather than raising a second one.`
          );
          setBusy(false);
          return;
        }

        await markAttendance(getDb(), actor, {
          dateKey: actionDate,
          staffId: staff.id,
          staffName: staff.name,
          status: "absent",
          note: reason.trim() || undefined,
          markedByName: session.displayName || actor.email,
        });
      }

      const deductionId = await createDeduction(getDb(), actor, {
        staffId: staff.id,
        staffName: staff.name,
        type,
        amountKobo,
        reason: reason.trim() || undefined,
        date: when,
      });

      if (action === "absence") {
        /*
         * The link, written last.
         *
         * If this fails the deduction exists and the day is marked but unlinked — which the guard
         * above will not catch, so the day could be charged twice. That is why the failure is
         * surfaced loudly rather than swallowed: it names the day and tells whoever is looking
         * what to check.
         */
        try {
          await linkAbsenceDeduction(getDb(), actor, actionDate, staff.id, deductionId);
        } catch {
          setError(
            `The deduction was raised but could not be linked to ${actionDate}. Check that day before raising another, or it may be charged twice.`
          );
        }
      }

      setNotice(
        `${formatNaira(amountKobo)} ${
          action === "advance" ? "advance recorded" : "deduction raised"
        } — it will be taken by the next run.`
      );
      setTimeout(() => setNotice(""), 9000);
      setAction(null);
      setAmount("");
      setReason("");
      setVersion((v) => v + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save that.");
    } finally {
      setBusy(false);
    }
  }

  /*
   * Withdraws a deduction that has not yet been taken by a run.
   *
   * Confirmed rather than immediate: it is somebody's pay, and the figure is the only thing on
   * the row that distinguishes one penalty from another. `deleteDeduction` refuses anything a
   * run has already claimed, so the worst this can do is remove money that was never taken.
   */
  async function removeDeduction(deductionId: string, amountKobo: number) {
    if (
      !window.confirm(
        `Remove this ${formatNaira(amountKobo)} deduction? ` +
          `It has not been taken by a run yet, so ${staff.name} keeps the money.`
      )
    ) {
      return;
    }
    setError("");
    setRemovingId(deductionId);
    try {
      await deleteDeduction(getDb(), actor, deductionId);
      setNotice(`${formatNaira(amountKobo)} deduction removed.`);
      setTimeout(() => setNotice(""), 6000);
      setVersion((v) => v + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not remove that deduction.");
    } finally {
      setRemovingId(null);
    }
  }

  async function markToday(status: "present" | "absent" | "leave") {
    setError("");
    setBusy(true);
    try {
      await markAttendance(getDb(), actor, {
        dateKey: todayIso(),
        staffId: staff.id,
        staffName: staff.name,
        status,
        markedByName: session.displayName || actor.email,
      });
      setNotice(`Marked ${ATTENDANCE_STATUS_LABELS[status].toLowerCase()} for today.`);
      setTimeout(() => setNotice(""), 6000);
      setVersion((v) => v + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not mark attendance.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      {/* Who this is. */}
      <header className="flex flex-wrap items-start gap-5 rounded-3xl border border-brass-500/30 bg-night-900/40 p-6">
        <span className="flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl bg-brass-500/15 font-display text-2xl text-brass-300">
          {staff.name
            .split(" ")
            .slice(0, 2)
            .map((p) => p[0])
            .join("")
            .toUpperCase()}
        </span>
        <div className="min-w-0 flex-1">
          <h1 className="font-display text-2xl text-cream-50">{staff.name}</h1>
          <p className="mt-1 text-sm text-cream-400">
            {[
              staff.role ? STAFF_ROLE_LABELS[staff.role] : null,
              staff.employmentType ? EMPLOYMENT_TYPE_LABELS[staff.employmentType] : null,
              staff.jobTitle,
            ]
              .filter(Boolean)
              .join(" · ")}
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <StatusPill tone={TONE_BY_STATUS[staff.status ?? "active"] ?? "neutral"}>
              {STAFF_STATUS_LABELS[staff.status ?? "active"]}
            </StatusPill>
            {staff.staffNumber && (
              <span className="rounded-lg border border-night-600 px-2.5 py-1 font-mono text-xs text-cream-400">
                {staff.staffNumber}
              </span>
            )}
            {dayRate > 0 && (
              <span className="text-xs text-cream-500">
                {formatNaira(dayRate)} a day
              </span>
            )}
          </div>
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
      {notice && (
        <p
          role="status"
          className="mt-6 flex items-start gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/5 px-4 py-3 text-sm text-emerald-300"
        >
          <CheckCircle2 size={16} className="mt-0.5 shrink-0" /> {notice}
        </p>
      )}

      {loading ? (
        <p className="mt-8 text-sm text-cream-500">Reading the record…</p>
      ) : !stats ? (
        <p className="mt-8 text-sm text-cream-500">Nothing on file yet.</p>
      ) : (
        <>
          {/* The four figures. */}
          <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Figure
              icon={Wallet}
              label="Total earned"
              value={formatNaira(stats.totalEarnedKobo)}
              sub={`${stats.wageRunCount + stats.salaryRunCount} run${
                stats.wageRunCount + stats.salaryRunCount === 1 ? "" : "s"
              } paid`}
            />
            <Figure
              icon={HandCoins}
              label="Owing us"
              value={formatNaira(stats.loanOutstandingKobo)}
              sub={
                stats.loanCount > 0
                  ? `${stats.loanCount} loan${stats.loanCount === 1 ? "" : "s"} on the ledger`
                  : "nothing outstanding"
              }
              tone={stats.loanOutstandingKobo > 0 ? "warn" : undefined}
            />
            {/* Charged, not "absences".
                `stats.absenceCount` counts no-show *deductions* — the whole record, exactly. The
                register count is a different figure over a different window (the last 60 days
                recorded), so the two must not be reconciled with a max: three absences of which
                one was charged is not "three absences, ₦x withheld". The register's own count is
                stated in the Attendance panel below, where its window can be labelled. */}
            <Figure
              icon={CalendarX}
              label="Absences charged"
              value={String(stats.absenceCount)}
              sub={
                stats.absenceKobo > 0
                  ? `${formatNaira(stats.absenceKobo)} withheld`
                  : "none charged"
              }
              tone={stats.absenceCount > 0 ? "warn" : undefined}
            />
            <Figure
              icon={BadgeMinus}
              label="Penalties"
              value={formatNaira(stats.penaltyKobo)}
              sub={`${stats.penaltyCount} recorded`}
              tone={stats.penaltyKobo > 0 ? "danger" : undefined}
            />
          </div>

          {/* Anything still to be taken, itemised so a mistake can be withdrawn.
              Listing the total alone left no way to undo a deduction raised in error — it
              would simply be taken by the next run, and after that the only route back is
              reopening the run. The window to fix it cheaply is now, so the rows are here. */}
          {stats.pendingDeductionKobo > 0 && (
            <div className="mt-4 rounded-xl border border-amber-500/40 bg-amber-500/5 px-4 py-3">
              <p className="flex items-start gap-2 text-sm text-amber-300">
                <AlertTriangle size={16} className="mt-0.5 shrink-0" />
                {formatNaira(stats.pendingDeductionKobo)} raised and not yet taken by a run.
              </p>
              <ul className="mt-3 space-y-1.5">
                {stats.pendingDeductions.map((d) => (
                  <li
                    key={d.id}
                    className="flex flex-wrap items-center justify-between gap-2 border-t border-amber-500/20 pt-1.5 text-sm text-cream-300 first:border-0 first:pt-0"
                  >
                    <span className="min-w-0">
                      <span className="text-cream-100">{formatNaira(d.amountKobo)}</span>{" "}
                      {DEDUCTION_TYPE_LABELS[d.type] ?? d.type}
                      {d.dateKey ? ` · ${d.dateKey}` : ""}
                      {d.reason ? <span className="text-cream-500"> — {d.reason}</span> : null}
                    </span>
                    {canDeduct && (
                      <button
                        type="button"
                        onClick={() => removeDeduction(d.id, d.amountKobo)}
                        disabled={removingId === d.id}
                        className="shrink-0 cursor-pointer rounded-full border border-night-600 px-3 py-1 text-xs text-cream-300 transition-colors hover:border-red-500/60 hover:text-red-300 disabled:opacity-50"
                      >
                        {removingId === d.id ? "Removing…" : "Remove"}
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Quick actions. */}
          {(canDeduct || canMarkAttendance) && (
            <section className="mt-6 rounded-3xl border border-night-700/60 bg-night-900/30 p-6">
              <h2 className="font-display text-lg text-cream-100">Quick actions</h2>
              <p className="mt-1 text-sm text-cream-400">
                Nothing here takes money on its own — a deduction is raised and the next run
                applies it.
              </p>

              <div className="mt-4 flex flex-wrap gap-2">
                {canDeduct && (
                  <>
                    <ActionChip
                      active={action === "advance"}
                      onClick={() => openAction(action === "advance" ? null : "advance")}
                      icon={Coins}
                      label="Record an advance"
                    />
                    <ActionChip
                      active={action === "penalty"}
                      onClick={() => openAction(action === "penalty" ? null : "penalty")}
                      icon={BadgeMinus}
                      label="Penalty or damage"
                    />
                    <ActionChip
                      active={action === "absence"}
                      onClick={() => openAction(action === "absence" ? null : "absence")}
                      icon={CalendarX}
                      label="Record an absence"
                    />
                  </>
                )}
                {canMarkAttendance && (
                  <>
                    <ActionChip
                      onClick={() => markToday("present")}
                      icon={CheckCircle2}
                      label="Present today"
                      disabled={busy}
                    />
                    <ActionChip
                      onClick={() => markToday("leave")}
                      icon={UserRound}
                      label="On leave today"
                      disabled={busy}
                    />
                  </>
                )}
              </div>

              {action && (
                <div className="mt-5 grid gap-4 rounded-2xl border border-night-700/60 bg-night-950/40 p-5 sm:grid-cols-3">
                  <NairaField
                    id="sp-amount"
                    label={action === "advance" ? "Advance given" : "Amount to withhold"}
                    valueKobo={amount}
                    onChangeKobo={setAmount}
                    hint={
                      action === "absence" && dayRate > 0
                        ? `a day is ${formatNaira(dayRate)}`
                        : undefined
                    }
                  />
                  <DateField
                    id="sp-date"
                    label={action === "absence" ? "Day missed" : "Date"}
                    value={actionDate}
                    onChange={setActionDate}
                    max={todayIso()}
                  />
                  <TextField
                    id="sp-reason"
                    label="Reason"
                    value={reason}
                    onChange={setReason}
                    required={action !== "advance"}
                    placeholder={
                      action === "penalty"
                        ? "e.g. cut an Egger sheet to the wrong size"
                        : action === "absence"
                          ? "e.g. did not come in, no message"
                          : "optional"
                    }
                  />
                  <div className="sm:col-span-3">
                    <Button onClick={submitAction} busy={busy}>
                      {action === "advance" ? "Record advance" : "Raise deduction"}
                    </Button>
                  </div>
                </div>
              )}
            </section>
          )}

          <div className="mt-6 grid gap-6 lg:grid-cols-2">
            {/* Attendance. */}
            <section className="rounded-3xl border border-night-700/60 bg-night-900/30 p-6">
              <h2 className="font-display text-lg text-cream-100">Attendance</h2>
              {attendance.length === 0 ? (
                <p className="mt-3 text-sm text-cream-500">
                  Nothing in the register yet. Marking days here is what explains an empty work
                  log later.
                </p>
              ) : (
                <>
                  <p className="mt-1 text-sm text-cream-400">
                    {absenceDays.length} absence{absenceDays.length === 1 ? "" : "s"} in the last{" "}
                    {attendance.length} day{attendance.length === 1 ? "" : "s"} recorded
                    {uncharged.length > 0 && `, ${uncharged.length} not charged`}
                    {/* The cap is stated rather than hidden: at 60 there is older history the
                        panel is not showing, and the tile above counts the whole record. */}
                    {attendance.length >= 60 && " — older days exist"}
                  </p>
                  <ul className="mt-4 space-y-2">
                    {attendance.slice(0, 12).map((a) => (
                      <li
                        key={a.id}
                        className="flex flex-wrap items-center justify-between gap-2 border-b border-night-700/40 pb-2 text-sm last:border-0"
                      >
                        <span className="text-cream-300">{a.dateKey}</span>
                        <span className="flex items-center gap-2">
                          {a.note && (
                            <span className="text-xs text-cream-600">{a.note}</span>
                          )}
                          <StatusPill
                            tone={
                              a.status === "present"
                                ? "positive"
                                : a.status === "absent"
                                  ? "danger"
                                  : "neutral"
                            }
                          >
                            {ATTENDANCE_STATUS_LABELS[a.status]}
                          </StatusPill>
                        </span>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </section>

            {/* Tools held — the exit-clearance question. */}
            <section className="rounded-3xl border border-night-700/60 bg-night-900/30 p-6">
              <h2 className="flex items-center gap-2 font-display text-lg text-cream-100">
                <Wrench size={18} className="text-brass-400" /> Tools signed out
              </h2>
              {toolsError ? (
                <p className="mt-3 flex items-start gap-2 text-sm text-amber-300">
                  <AlertTriangle size={15} className="mt-0.5 shrink-0" />
                  {toolsError} Check the tool log directly before clearing an exit.
                </p>
              ) : toolsHeld.length === 0 ? (
                <p className="mt-3 flex items-center gap-2 text-sm text-emerald-300">
                  <CheckCircle2 size={15} /> Nothing outstanding
                  {toolsScanned > 0 && ` across the last ${toolsScanned} tool requests`}.
                </p>
              ) : (
                <>
                  <p className="mt-1 text-sm text-amber-300">
                    {toolsHeld.length} item{toolsHeld.length === 1 ? "" : "s"} still with this
                    person.
                  </p>
                  <ul className="mt-4 space-y-2">
                    {toolsHeld.map((t) => (
                      <li
                        key={t.id}
                        className="flex items-center justify-between gap-3 border-b border-night-700/40 pb-2 text-sm last:border-0"
                      >
                        <span className="flex items-center gap-2 text-cream-200">
                          <Package size={14} className="text-cream-600" /> {t.name}
                        </span>
                        <span className="text-xs text-cream-600">
                          {t.issuedAtMs
                            ? `issued ${new Date(t.issuedAtMs).toLocaleDateString()}`
                            : ""}
                        </span>
                      </li>
                    ))}
                  </ul>
                  <p className="mt-4 text-xs leading-relaxed text-cream-500">
                    These must come back before an exit is cleared. A tool nobody remembers
                    issuing is a tool the workshop buys twice.
                  </p>
                </>
              )}
            </section>
          </div>

          {/* Exit clearance.
              Shown for anyone still employed, because the point is to be read *before* someone
              leaves rather than after. The three things that must be settled are a loan balance,
              tools still signed out, and deductions raised but not yet taken — each of which is
              money or property the workshop does not get back once the person has gone. */}
          {(staff.status ?? "active") === "active" && (
            <section className="mt-6 rounded-3xl border border-night-700/60 bg-night-900/30 p-6">
              <h2 className="flex items-center gap-2 font-display text-lg text-cream-100">
                <UserRound size={18} className="text-brass-400" /> Exit clearance
              </h2>
              <p className="mt-1 text-sm text-cream-400">
                What would have to be settled if this person left today.
              </p>

              <ul className="mt-4 space-y-2.5 text-sm">
                <Clearance
                  settled={stats.loanOutstandingKobo === 0}
                  label="Loans and advances"
                  detail={
                    stats.loanOutstandingKobo === 0
                      ? "Nothing outstanding"
                      : `${formatNaira(stats.loanOutstandingKobo)} still owed`
                  }
                />
                {/* `unknown` rather than settled when the read failed. "All returned" asserted on
                    a list that could not be fetched is the worst line on this screen. */}
                <Clearance
                  settled={toolsError ? "unknown" : toolsHeld.length === 0}
                  label="Company tools"
                  detail={
                    toolsError
                      ? "Could not be checked — look at the tool log before clearing this"
                      : toolsHeld.length === 0
                        ? "All returned"
                        : `${toolsHeld.length} item${
                            toolsHeld.length === 1 ? "" : "s"
                          } still signed out: ${toolsHeld.map((t) => t.name).join(", ")}`
                  }
                />
                <Clearance
                  settled={stats.pendingDeductionKobo === 0}
                  label="Deductions raised"
                  detail={
                    stats.pendingDeductionKobo === 0
                      ? "Nothing pending"
                      : `${formatNaira(
                          stats.pendingDeductionKobo
                        )} raised and not yet taken by a run`
                  }
                />
              </ul>

              {stats.loanOutstandingKobo === 0 &&
              !toolsError &&
              toolsHeld.length === 0 &&
              stats.pendingDeductionKobo === 0 ? (
                <p className="mt-4 flex items-center gap-2 text-sm text-emerald-300">
                  <CheckCircle2 size={15} /> Nothing outstanding — a clean exit.
                </p>
              ) : (
                <p className="mt-4 text-xs leading-relaxed text-cream-500">
                  Ending employment is done from the staff list. This is the check to run first —
                  a final payment made before these are settled is money and property the workshop
                  does not get back.
                </p>
              )}
            </section>
          )}

          {/* Throughput and payroll history. */}
          <section className="mt-6 rounded-3xl border border-night-700/60 bg-night-900/30 p-6">
            <h2 className="flex items-center gap-2 font-display text-lg text-cream-100">
              <FileText size={18} className="text-brass-400" /> Work and pay
            </h2>
            <dl className="mt-4 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
              <Fact label="Work logs" value={String(stats.workLogCount)} />
              <Fact label="Units logged" value={String(stats.totalUnitsLogged)} />
              <Fact label="Wage runs" value={String(stats.wageRunCount)} />
              <Fact label="Salary runs" value={String(stats.salaryRunCount)} />
              <Fact
                label="Advances taken"
                value={formatNaira(stats.advanceKobo)}
                hint={`${DEDUCTION_TYPE_LABELS.advance} deductions`}
              />
              <Fact label="Absence cost" value={formatNaira(stats.absenceKobo)} />
              <Fact label="Penalties" value={formatNaira(stats.penaltyKobo)} />
              <Fact
                label="Still to be taken"
                value={formatNaira(stats.pendingDeductionKobo)}
              />
            </dl>
          </section>
        </>
      )}
    </div>
  );
}

function Figure({
  icon: Icon,
  label,
  value,
  sub,
  tone,
}: {
  icon: typeof Wallet;
  label: string;
  value: string;
  sub?: string;
  tone?: "warn" | "danger";
}) {
  return (
    <div className="rounded-3xl border border-night-700/60 bg-night-900/40 p-5">
      <div className="flex items-center gap-2.5">
        <span
          className={`flex h-9 w-9 items-center justify-center rounded-xl ${
            tone === "danger"
              ? "bg-red-500/15 text-red-300"
              : tone === "warn"
                ? "bg-amber-500/15 text-amber-300"
                : "bg-brass-500/15 text-brass-400"
          }`}
        >
          <Icon size={17} />
        </span>
        <p className="text-xs uppercase tracking-wider text-cream-500">{label}</p>
      </div>
      <p
        className={`mt-3 font-display text-2xl ${
          tone === "danger"
            ? "text-red-300"
            : tone === "warn"
              ? "text-amber-300"
              : "text-cream-50"
        }`}
      >
        {value}
      </p>
      {sub && <p className="mt-1 text-xs text-cream-500">{sub}</p>}
    </div>
  );
}

function ActionChip({
  active,
  onClick,
  icon: Icon,
  label,
  disabled,
}: {
  active?: boolean;
  onClick: () => void;
  icon: typeof Coins;
  label: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={active}
      className={`flex cursor-pointer items-center gap-1.5 rounded-xl border px-3.5 py-2.5 text-sm transition-colors disabled:opacity-60 ${
        active
          ? "border-brass-500 bg-brass-500/15 text-brass-200"
          : "border-night-600 bg-night-800/50 text-cream-300 hover:border-brass-500/50"
      }`}
    >
      <Icon size={15} /> {label}
    </button>
  );
}

/**
 * One line of the exit checklist.
 *
 * Three states, not two. `"unknown"` exists because a check that could not run is not a check that
 * passed — and on this list, a green tick against something nobody managed to look up is how a
 * final payment gets made while the tools are still in someone's boot.
 */
function Clearance({
  settled,
  label,
  detail,
}: {
  settled: boolean | "unknown";
  label: string;
  detail: string;
}) {
  const ok = settled === true;
  const unknown = settled === "unknown";
  return (
    <li className="flex items-start gap-3">
      <span
        className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full ${
          ok
            ? "bg-emerald-500/20 text-emerald-300"
            : unknown
              ? "bg-night-700 text-cream-400"
              : "bg-amber-500/20 text-amber-300"
        }`}
      >
        {ok ? (
          <CheckCircle2 size={13} />
        ) : unknown ? (
          <span className="text-xs font-medium">?</span>
        ) : (
          <AlertTriangle size={12} />
        )}
      </span>
      <span>
        <span className="block text-cream-200">{label}</span>
        <span
          className={`block text-xs ${
            ok ? "text-cream-500" : unknown ? "text-cream-400" : "text-amber-300/90"
          }`}
        >
          {detail}
        </span>
      </span>
    </li>
  );
}

function Fact({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wider text-cream-600">{label}</dt>
      <dd className="mt-1 font-display text-lg text-cream-100">{value}</dd>
      {hint && <dd className="mt-0.5 text-xs text-cream-600">{hint}</dd>}
    </div>
  );
}

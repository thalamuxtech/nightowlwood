"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { collection, getDocs, orderBy, query } from "firebase/firestore";
import {
  CalendarCheck,
  CheckCircle2,
  Loader2,
  ShieldAlert,
  UserRound,
  Users,
} from "lucide-react";
import { getDb } from "@/lib/firebase";
import { COL } from "@/lib/erp/collections";
import {
  ATTENDANCE_STATUSES,
  ATTENDANCE_STATUS_LABELS,
  type AttendanceStatus,
} from "@/lib/erp/enums";
import { formatNaira } from "@/lib/erp/money";
import {
  dayRateKobo,
  holidayDayKeys,
  hrSettings,
  loadAttendance,
  loadHolidays,
  markAttendance,
  type AttendanceMark,
} from "@/lib/erp/hr";
import { DEFAULT_HR_SETTINGS, type HrSettings } from "@/lib/erp/settings";
import type { Staff } from "@/lib/erp/types";
import { Button, DateField, EmptyState, todayIso } from "@/components/admin/ui/Fields";
import { describeIso } from "@/components/admin/ui/DateField";
import { useErpSession } from "@/components/admin/ErpAuthProvider";

/**
 * The daily attendance register.
 *
 * A row per active staff member, four buttons each. The brief is explicit that this should not
 * start with biometrics, and it is right: a register somebody ticks at 8am is a system that gets
 * used, while a clocking machine nobody trusts gets worked around. No times in or out either —
 * the workshop pays by the piece and by the month, so an arrival time would be recorded and never
 * read.
 *
 * Marking someone absent here **takes no money**. It records the fact; the no-show deduction is a
 * separate, deliberate act on that person's profile with its own permission, because an absence
 * often turns out to have been agreed. This screen says which absences have not been charged so
 * neither half is forgotten.
 *
 * A day already marked as a public holiday pre-fills as such and says so, which is what stops a
 * whole workshop being marked absent for Sallah.
 */
export function AttendanceScreen() {
  const session = useErpSession();
  const canMark = session.can("worklog.viewAll") || session.can("staff.edit");

  const [dateKey, setDateKey] = useState(todayIso());
  const [staff, setStaff] = useState<Staff[]>([]);
  const [marks, setMarks] = useState<Map<string, AttendanceMark>>(new Map());
  const [hr, setHr] = useState<HrSettings>(DEFAULT_HR_SETTINGS);
  const [holidayKeys, setHolidayKeys] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  /** Which row is mid-write, so only that button spins rather than the whole screen. */
  const [saving, setSaving] = useState<string | null>(null);

  const actor = useMemo(
    () => ({
      uid: session.user?.uid ?? "",
      email: session.user?.email ?? "",
      role: session.role ?? "manager",
    }),
    [session.user, session.role]
  );

  // The roster and the settings, once.
  useEffect(() => {
    /*
     * Holidays for a year either side of today.
     *
     * Wide enough that back-dating the register a few months still knows about Sallah, and narrow
     * enough to stay one small read. Loaded once rather than per day, since the set barely changes
     * and re-reading it on every date change would be a request per keystroke on the roller.
     */
    const now = new Date();
    const from = new Date(now.getFullYear() - 1, now.getMonth(), now.getDate());
    const to = new Date(now.getFullYear() + 1, now.getMonth(), now.getDate());

    Promise.all([
      getDocs(query(collection(getDb(), COL.staff), orderBy("name", "asc"))),
      hrSettings(getDb()),
      loadHolidays(getDb(), from, to),
    ])
      .then(([snap, h, holidays]) => {
        setStaff(
          snap.docs
            .map((d) => ({ id: d.id, ...d.data() }) as Staff)
            // Someone who has left does not belong on a register. Absent status counts as
            // active, since a record written before the field existed is a working person.
            .filter((s) => (s.status ?? "active") === "active")
        );
        setHr(h);
        setHolidayKeys(holidayDayKeys(holidays));
      })
      .catch((e) =>
        setError(e instanceof Error ? e.message : "Could not load the staff list.")
      )
      .finally(() => setLoading(false));
  }, []);

  const loadDay = useCallback(() => {
    setError("");
    loadAttendance(getDb(), { dateKey })
      .then((rows) => setMarks(new Map(rows.map((r) => [r.staffId, r]))))
      .catch((e) =>
        setError(e instanceof Error ? e.message : "Could not read that day's register.")
      );
  }, [dateKey]);

  useEffect(loadDay, [loadDay]);

  const isHoliday = holidayKeys.has(dateKey);

  async function mark(person: Staff, status: AttendanceStatus) {
    setError("");
    setSaving(person.id);
    try {
      await markAttendance(getDb(), actor, {
        dateKey,
        staffId: person.id,
        staffName: person.name,
        status,
        markedByName: session.displayName || actor.email,
      });
      /*
       * Written into the local map rather than re-reading the day.
       *
       * One tick should not cost a round trip for the whole register, and a register is ticked
       * twenty times in a row. `deductionId` is carried across unchanged whatever the new status
       * is — mirroring the data layer, which never clears it, because that link is the only thing
       * stopping a charged day from being charged again.
       */
      setMarks((prev) => {
        const next = new Map(prev);
        const existing = next.get(person.id);
        next.set(person.id, {
          id: `${dateKey}_${person.id}`,
          dateKey,
          staffId: person.id,
          staffName: person.name,
          status,
          deductionId: existing?.deductionId,
          markedByName: session.displayName || actor.email,
          markedAtMs: Date.now(),
        });
        return next;
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save that.");
    } finally {
      setSaving(null);
    }
  }

  /**
   * Marks everyone not yet ticked. The common case: most people turned up.
   *
   * Written in parallel and settled individually rather than in a sequential loop. Forty people
   * through a loop of read-write-audit is a couple of hundred serial round trips — twenty seconds
   * behind a single spinner, which reads as a hung screen — and a failure halfway left the earlier
   * writes in place with no indication of how many had landed.
   *
   * `allSettled` means one refusal does not abandon the rest, and the count of each outcome is
   * reported. The register is re-read either way, so what is on screen is what is stored.
   */
  async function markRest(status: AttendanceStatus) {
    setError("");
    const pending = staff.filter((s) => !marks.has(s.id));
    if (pending.length === 0) return;
    setSaving("__all__");
    try {
      const results = await Promise.allSettled(
        pending.map((person) =>
          markAttendance(getDb(), actor, {
            dateKey,
            staffId: person.id,
            staffName: person.name,
            status,
            markedByName: session.displayName || actor.email,
          })
        )
      );

      const done = results.filter((r) => r.status === "fulfilled").length;
      const failed = results.length - done;

      if (done > 0) {
        setNotice(
          `${done} ${done === 1 ? "person" : "people"} marked ${ATTENDANCE_STATUS_LABELS[
            status
          ].toLowerCase()}.`
        );
        setTimeout(() => setNotice(""), 6000);
      }
      if (failed > 0) {
        // Named rather than counted only: whoever is at the register needs to know which rows to
        // tick by hand, and the list below will show them as still unmarked.
        setError(
          `${failed} could not be saved and ${
            failed === 1 ? "is" : "are"
          } still unmarked. Tick ${failed === 1 ? "it" : "them"} individually.`
        );
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not mark everyone.");
    } finally {
      // In `finally`, so a failure still refreshes: the previous version left the screen showing
      // everyone as unmarked after a partial write.
      loadDay();
      setSaving(null);
    }
  }

  const counts = useMemo(() => {
    const out: Record<AttendanceStatus, number> = {
      present: 0,
      absent: 0,
      leave: 0,
      holiday: 0,
    };
    for (const m of marks.values()) out[m.status] += 1;
    return out;
  }, [marks]);

  const unmarked = staff.length - marks.size;
  /** Absences with no deduction raised, which is the follow-up this screen owes. */
  const uncharged = [...marks.values()].filter(
    (m) => m.status === "absent" && !m.deductionId
  );

  return (
    <div>
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl text-cream-50">Attendance</h1>
          <p className="mt-1.5 max-w-2xl text-sm text-cream-400">
            A tick per person per day. Recording an absence here does not deduct anything — that
            is raised separately on the person&apos;s profile, because an absence is often agreed.
          </p>
        </div>
        <div className="w-full sm:w-60">
          <DateField
            id="att-date"
            label="Day"
            value={dateKey}
            onChange={setDateKey}
            max={todayIso()}
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
      {notice && (
        <p
          role="status"
          className="mt-6 flex items-start gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/5 px-4 py-3 text-sm text-emerald-300"
        >
          <CheckCircle2 size={16} className="mt-0.5 shrink-0" /> {notice}
        </p>
      )}

      {isHoliday && (
        <p className="mt-6 flex items-start gap-2 rounded-xl border border-sky-500/40 bg-sky-500/5 px-4 py-3 text-sm text-sky-300">
          <CalendarCheck size={16} className="mt-0.5 shrink-0" />
          {describeIso(dateKey)} is a public holiday. Mark the workshop as such rather than
          absent, or a whole day reads as everybody failing to turn up.
        </p>
      )}

      <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Tally label="Present" value={counts.present} tone="good" />
        <Tally label="Absent" value={counts.absent} tone={counts.absent > 0 ? "bad" : undefined} />
        <Tally label="On leave" value={counts.leave} />
        <Tally
          label="Not yet marked"
          value={unmarked}
          tone={unmarked > 0 ? "warn" : "good"}
        />
      </div>

      {uncharged.length > 0 && (
        <p className="mt-4 rounded-xl border border-amber-500/40 bg-amber-500/5 px-4 py-3 text-sm text-amber-300">
          {uncharged.length} absence{uncharged.length === 1 ? "" : "s"} recorded with no deduction
          raised: {uncharged.map((m) => m.staffName).join(", ")}. Raise it on their profile if the
          day is to be withheld.
        </p>
      )}

      {canMark && unmarked > 0 && staff.length > 0 && (
        <div className="mt-6 flex flex-wrap items-center gap-3">
          <span className="text-sm text-cream-400">Mark the remaining {unmarked}:</span>
          <Button
            variant="secondary"
            onClick={() => markRest("present")}
            busy={saving === "__all__"}
          >
            All present
          </Button>
          {isHoliday && (
            <Button variant="ghost" onClick={() => markRest("holiday")}>
              All on holiday
            </Button>
          )}
        </div>
      )}

      {loading ? (
        <p className="mt-8 flex items-center gap-2 text-sm text-cream-500">
          <Loader2 size={15} className="animate-spin" /> Loading the roster…
        </p>
      ) : staff.length === 0 ? (
        <div className="mt-8">
          <EmptyState
            title="No active staff"
            hint="Add people under Staff & HR and they will appear on the register."
          />
        </div>
      ) : (
        <div className="mt-8 space-y-2">
          {staff.map((person) => {
            const mark_ = marks.get(person.id);
            const rate = dayRateKobo(person, hr.workingDaysPerMonth);
            return (
              <div
                key={person.id}
                className={`flex flex-wrap items-center gap-3 rounded-2xl border p-4 ${
                  mark_
                    ? mark_.status === "absent"
                      ? "border-red-500/30 bg-red-500/5"
                      : "border-night-700/60 bg-night-900/30"
                    : "border-amber-500/30 bg-night-900/30"
                }`}
              >
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-night-800 text-xs text-cream-400">
                  {person.name
                    .split(" ")
                    .slice(0, 2)
                    .map((p) => p[0])
                    .join("")
                    .toUpperCase()}
                </span>

                <span className="min-w-0 flex-1">
                  <span className="block truncate text-cream-100">
                    {person.name}
                    {person.nickname && (
                      <span className="ml-2 text-xs text-cream-600">({person.nickname})</span>
                    )}
                  </span>
                  <span className="mt-0.5 block text-xs text-cream-500">
                    {person.jobTitle ?? (person.isOperator ? "Operator" : "Assistant")}
                    {rate > 0 && ` · ${formatNaira(rate)} a day`}
                    {mark_?.markedByName && ` · marked by ${mark_.markedByName}`}
                  </span>
                </span>

                {canMark ? (
                  <span className="flex flex-wrap gap-1.5">
                    {ATTENDANCE_STATUSES.map((s) => {
                      const on = mark_?.status === s;
                      return (
                        <button
                          key={s}
                          type="button"
                          onClick={() => mark(person, s)}
                          disabled={saving !== null}
                          aria-pressed={on}
                          className={`cursor-pointer rounded-lg border px-2.5 py-1.5 text-xs transition-colors disabled:opacity-50 ${
                            on
                              ? s === "absent"
                                ? "border-red-500 bg-red-500/15 text-red-200"
                                : s === "present"
                                  ? "border-emerald-500 bg-emerald-500/15 text-emerald-200"
                                  : "border-brass-500 bg-brass-500/15 text-brass-200"
                              : "border-night-600 text-cream-400 hover:border-brass-500/50"
                          }`}
                        >
                          {saving === person.id ? (
                            <Loader2 size={12} className="animate-spin" />
                          ) : (
                            ATTENDANCE_STATUS_LABELS[s]
                          )}
                        </button>
                      );
                    })}
                  </span>
                ) : mark_ ? (
                  <span className="text-sm text-cream-300">
                    {ATTENDANCE_STATUS_LABELS[mark_.status]}
                  </span>
                ) : (
                  <span className="text-sm text-cream-600">not marked</span>
                )}
              </div>
            );
          })}
        </div>
      )}

      <p className="mt-8 flex items-start gap-2 text-xs text-cream-600">
        <Users size={13} className="mt-0.5 shrink-0" />
        The register is what explains an empty work log. Without it, a public holiday and a day
        nobody bothered recording look identical — and that is always the first question about a
        light week.
      </p>
    </div>
  );
}

function Tally({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone?: "good" | "warn" | "bad";
}) {
  return (
    <div className="rounded-3xl border border-night-700/60 bg-night-900/40 p-5">
      <p className="text-xs uppercase tracking-wider text-cream-500">{label}</p>
      <p
        className={`mt-2 font-display text-2xl ${
          tone === "bad"
            ? "text-red-300"
            : tone === "warn"
              ? "text-amber-300"
              : tone === "good"
                ? "text-emerald-300"
                : "text-cream-50"
        }`}
      >
        {value}
      </p>
    </div>
  );
}

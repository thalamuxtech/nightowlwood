"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { collection, doc, getDoc, onSnapshot, orderBy, query } from "firebase/firestore";
import {
  FileText,
  IdCard,
  Loader2,
  PenLine,
  Plus,
  ShieldAlert,
  UserPlus,
  Users,
} from "lucide-react";
import { getDb } from "@/lib/firebase";
import { COL } from "@/lib/erp/collections";
import {
  EMPLOYMENT_TYPES,
  EMPLOYMENT_TYPE_LABELS,
  STAFF_ROLES,
  STAFF_ROLE_LABELS,
  STAFF_STATUSES,
  STAFF_STATUS_LABELS,
  type EmploymentType,
  type StaffRole,
  type StaffStatus,
} from "@/lib/erp/enums";
import { formatNaira, parseNairaInput, toNaira } from "@/lib/erp/money";
import {
  createStaff,
  hrSettings,
  loadStaffStats,
  recordStaffDocument,
  updateStaff,
  type StaffStats,
} from "@/lib/erp/hr";
import { seedRoster } from "@/lib/erp/seedRoster";
import {
  DEFAULT_COMPANY_SETTINGS,
  DEFAULT_HR_SETTINGS,
  SETTINGS_DOC,
  type CompanySettings,
  type HrSettings,
} from "@/lib/erp/settings";
import type { Staff } from "@/lib/erp/types";
import { fromDateInputValue, toDateInputValue } from "@/lib/erp/workLogs";
import {
  Button,
  DateField,
  EmptyState,
  NairaField,
  SelectField,
  TextAreaField,
  TextField,
} from "@/components/admin/ui/Fields";
import { StatusPill } from "@/components/admin/ui/StatusPill";
import { PrintPreview } from "@/components/admin/ui/PrintPreview";
import { AppointmentLetter } from "@/components/admin/print/AppointmentLetter";
import { StaffIdCard } from "@/components/admin/print/StaffIdCard";
import { useErpSession } from "@/components/admin/ErpAuthProvider";

interface Row extends Staff {
  id: string;
}

type Printing =
  | { kind: "letter"; staff: Row; reference: string }
  | { kind: "card"; staff: Row }
  | null;

/**
 * Staff records and HR documents.
 *
 * The workshop's people were a name and two flags, which runs payroll and answers nothing
 * else. This holds the employment record — when they started, who to call, what is on
 * their card — and produces the two documents that were previously typed by hand each
 * time, so a reprint matches the original.
 */
export function StaffScreen() {
  const session = useErpSession();
  const canEdit = session.can("staff.edit");
  const canHr = session.can("hr.manage");
  /** Pay and loan figures on the profile. Not implied by being able to see a name. */
  const canSeeMoney = session.can("wage.viewRates") || session.can("wage.run");

  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [showEnded, setShowEnded] = useState(false);

  const [company, setCompany] = useState<CompanySettings>(DEFAULT_COMPANY_SETTINGS);
  const [hr, setHr] = useState<HrSettings>(DEFAULT_HR_SETTINGS);
  const [seeding, setSeeding] = useState(false);
  /** Things worth saying after a seed — figures to confirm, and what was left out. */
  const [seedNotes, setSeedNotes] = useState<string[]>([]);
  const [printing, setPrinting] = useState<Printing>(null);
  const [printNow, setPrintNow] = useState(false);

  useEffect(() => {
    return onSnapshot(
      query(collection(getDb(), COL.staff), orderBy("name", "asc")),
      (snap) => {
        setRows(snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Row));
        setLoading(false);
      },
      (e) => {
        setError(
          e.code === "permission-denied"
            ? "You do not have permission to see staff records."
            : e.message
        );
        setLoading(false);
      }
    );
  }, []);

  useEffect(() => {
    hrSettings(getDb()).then(setHr).catch(() => {});
    getDoc(doc(getDb(), COL.settings, SETTINGS_DOC.company))
      .then((snap) => {
        if (snap.exists()) {
          setCompany({ ...DEFAULT_COMPANY_SETTINGS, ...(snap.data() as CompanySettings) });
        }
      })
      .catch(() => {});
  }, []);

  const actor = useMemo(
    () => ({
      uid: session.user?.uid ?? "",
      email: session.user?.email ?? "",
      role: session.role ?? "admin",
    }),
    [session.user, session.role]
  );

  const visible = useMemo(
    () =>
      rows.filter((r) =>
        showEnded ? true : r.active !== false && r.status !== "resigned" && r.status !== "terminated"
      ),
    [rows, showEnded]
  );

  const grouped = useMemo(() => {
    const salary = visible.filter(
      (r) => r.employmentType === "salary" || r.isSalaried === true
    );
    const wage = visible.filter(
      (r) => !(r.employmentType === "salary" || r.isSalaried === true)
    );
    return { salary, wage };
  }, [visible]);

  const monthlySalaryBill = useMemo(
    () =>
      grouped.salary.reduce((s, r) => s + (r.monthlySalaryKobo ?? 0), 0),
    [grouped.salary]
  );

  function flash(m: string) {
    setNotice(m);
    setTimeout(() => setNotice(""), 6000);
  }

  /**
   * Issues a document and records that it was issued.
   *
   * The reference is derived from the staff number and the date, so a reprint of the same
   * letter carries the same reference — which is what lets a copy in someone's file be
   * matched to the record of it.
   */
  async function issue(kind: "letter" | "card", staff: Row) {
    const stamp = new Date();
    const reference =
      kind === "letter"
        ? `APT/${staff.staffNumber || staff.id.slice(0, 5).toUpperCase()}/${stamp.getFullYear()}`
        : `ID/${staff.staffNumber || staff.id.slice(0, 5).toUpperCase()}`;

    setPrinting(
      kind === "letter"
        ? { kind: "letter", staff, reference }
        : { kind: "card", staff }
    );

    if (canHr) {
      try {
        await recordStaffDocument(getDb(), actor, staff.id, staff.name, {
          kind: kind === "letter" ? "appointment_letter" : "id_card",
          title: kind === "letter" ? "Letter of appointment" : "Staff ID card",
          reference,
          issuedAt: stamp,
        });
      } catch {
        // The document still prints. Failing to log the issue is not a reason to
        // withhold the letter from someone waiting for it.
      }
    }
  }

  if (!session.ready) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center">
        <Loader2 className="animate-spin text-brass-400" size={28} aria-label="Loading" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl pb-20">
      {/* Printables */}
      {printing?.kind === "letter" && (
        <PrintPreview
          title={`Appointment letter · ${printing.staff.name}`}
          paper="a4-portrait"
          onPrint={() => setPrintNow(true)}
          onClose={() => setPrinting(null)}
        >
          <AppointmentLetter
            data={letterData(printing.staff, printing.reference, hr)}
            company={company}
            autoPrint={false}
            onDone={() => {}}
          />
        </PrintPreview>
      )}
      {printing?.kind === "card" && (
        <PrintPreview
          title={`ID card · ${printing.staff.name}`}
          paper="a4-portrait"
          onPrint={() => setPrintNow(true)}
          onClose={() => setPrinting(null)}
        >
          <StaffIdCard
            data={cardData(printing.staff, hr)}
            company={company}
            autoPrint={false}
            onDone={() => {}}
          />
        </PrintPreview>
      )}
      {printNow && printing?.kind === "letter" && (
        <AppointmentLetter
          data={letterData(printing.staff, printing.reference, hr)}
          company={company}
          onDone={() => {
            setPrintNow(false);
            setPrinting(null);
          }}
        />
      )}
      {printNow && printing?.kind === "card" && (
        <StaffIdCard
          data={cardData(printing.staff, hr)}
          company={company}
          onDone={() => {
            setPrintNow(false);
            setPrinting(null);
          }}
        />
      )}

      <div className="print:hidden">
        <header className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-eyebrow">People</p>
            <h1 className="text-title mt-3 text-cream-50">Staff &amp; HR</h1>
            <p className="mt-3 max-w-2xl text-sm leading-relaxed text-cream-400">
              Employment records, appointment letters and ID cards. Pay figures here feed
              the salary and wage runs.
            </p>
          </div>
          <div className="flex flex-wrap gap-3">
            {/* One-off setup, offered only while the list is empty so it cannot be run
                against a populated roster by accident. It is idempotent by name either
                way — a second run updates rather than duplicating. */}
            {canEdit && rows.length === 0 && !loading && (
              <Button
                variant="secondary"
                busy={seeding}
                onClick={() => {
                  if (
                    !window.confirm(
                      "Add the workshop's known staff and standing fixed costs?\n\nSafe to run twice: anyone already on the list is updated rather than duplicated."
                    )
                  )
                    return;
                  setSeeding(true);
                  setError("");
                  seedRoster(getDb(), actor)
                    .then((r) => {
                      flash(
                        `${r.staffCreated} added, ${r.staffUpdated} updated, ` +
                          `${r.fixedCostsCreated} fixed cost(s) created.`
                      );
                      setSeedNotes(r.notes);
                    })
                    .catch((e) =>
                      setError(
                        e instanceof Error ? e.message : "Could not seed the roster."
                      )
                    )
                    .finally(() => setSeeding(false));
                }}
              >
                Load the known roster
              </Button>
            )}
            {canEdit && !adding && (
              <Button onClick={() => setAdding(true)}>
                <span className="flex items-center gap-2">
                  <UserPlus size={15} /> Add someone
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
          <p role="status" className="mt-6 text-sm text-emerald-300">
            {notice}
          </p>
        )}

        {/* What the seed could not decide for itself. Stated rather than buried, because
            one of them is a salary figure that needs confirming before anyone is paid. */}
        {seedNotes.length > 0 && (
          <ul className="mt-4 space-y-1.5 rounded-xl border border-night-700/60 bg-night-950/40 p-4 text-xs leading-relaxed text-cream-400">
            {seedNotes.map((n, i) => (
              <li key={i}>· {n}</li>
            ))}
          </ul>
        )}

        <div className="mt-8 grid gap-4 sm:grid-cols-3">
          <Tile label="On the books" value={String(visible.length)} />
          <Tile
            label="Salaried"
            value={String(grouped.salary.length)}
            hint={canSeeMoney ? `${formatNaira(monthlySalaryBill)} a month` : undefined}
          />
          <Tile label="Piece rate" value={String(grouped.wage.length)} />
        </div>

        {adding && canEdit && (
          <StaffForm
            actor={actor}
            onClose={() => setAdding(false)}
            onSaved={flash}
            onError={setError}
          />
        )}

        <div className="mt-8 flex items-center justify-between gap-3">
          <h2 className="font-display text-lg text-cream-100">Everyone</h2>
          <button
            type="button"
            onClick={() => setShowEnded((v) => !v)}
            className="cursor-pointer text-xs text-cream-400 transition-colors hover:text-brass-300"
          >
            {showEnded ? "Hide past staff" : "Show past staff"}
          </button>
        </div>

        {loading ? (
          <div className="mt-6 flex justify-center py-10">
            <Loader2 className="animate-spin text-brass-400" size={26} aria-label="Loading" />
          </div>
        ) : visible.length === 0 ? (
          <div className="mt-5">
            <EmptyState
              title="Nobody on the books"
              hint="Add the workshop's staff, and their pay basis feeds the salary and wage runs."
            />
          </div>
        ) : (
          <ul className="mt-5 space-y-3">
            {visible.map((r) => {
              const salaried = r.employmentType === "salary" || r.isSalaried === true;
              const ended = r.status === "resigned" || r.status === "terminated";
              return (
                <li
                  key={r.id}
                  className={`rounded-2xl border border-night-700/60 bg-night-900/40 p-5 ${
                    ended ? "opacity-60" : ""
                  }`}
                >
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div className="min-w-0">
                      <p className="flex flex-wrap items-center gap-2">
                        <span className="font-medium text-cream-100">{r.name}</span>
                        {r.nickname && (
                          <span className="text-xs text-cream-500">
                            &ldquo;{r.nickname}&rdquo;
                          </span>
                        )}
                        <StatusPill tone={salaried ? "info" : "progress"}>
                          {salaried ? "Salary" : "Wage"}
                        </StatusPill>
                        {ended && (
                          <StatusPill tone="danger">
                            {STAFF_STATUS_LABELS[r.status as StaffStatus]}
                          </StatusPill>
                        )}
                      </p>
                      <p className="mt-1 text-sm text-cream-400">
                        {r.jobTitle ??
                          (r.role ? STAFF_ROLE_LABELS[r.role] : "Role not set")}
                        {r.staffNumber && (
                          <span className="text-cream-600"> · {r.staffNumber}</span>
                        )}
                      </p>
                      <p className="mt-0.5 text-xs text-cream-500">
                        {r.phone ?? "no phone"}
                        {r.hiredAt?.toMillis && (
                          <>
                            <span className="mx-1.5 text-cream-700">·</span>
                            since{" "}
                            {new Date(r.hiredAt.toMillis()).toLocaleDateString("en-GB", {
                              month: "short",
                              year: "numeric",
                            })}
                          </>
                        )}
                      </p>
                    </div>

                    <div className="flex flex-wrap items-center gap-3">
                      {canSeeMoney && salaried && (
                        <span className="font-display text-lg text-cream-50">
                          {formatNaira(r.monthlySalaryKobo ?? 0)}
                          <span className="ml-1 text-xs text-cream-500">/mo</span>
                        </span>
                      )}
                      <button
                        type="button"
                        onClick={() => setOpenId(openId === r.id ? null : r.id)}
                        className="cursor-pointer text-xs text-cream-400 transition-colors hover:text-brass-300"
                      >
                        {openId === r.id ? "Hide" : "Record"}
                      </button>
                      {/* The full file, with the quick actions and the tools still signed out.
                          The inline record above is a summary; this is the page you work from. */}
                      <Link
                        href={`/admin/staff/profile/?id=${r.id}`}
                        className="text-xs text-brass-300 transition-colors hover:text-brass-200"
                      >
                        Full profile
                      </Link>
                      {canHr && (
                        <>
                          <button
                            type="button"
                            title="Appointment letter"
                            aria-label={`Appointment letter for ${r.name}`}
                            onClick={() => issue("letter", r)}
                            className="cursor-pointer text-cream-400 transition-colors hover:text-brass-300"
                          >
                            <FileText size={15} />
                          </button>
                          <button
                            type="button"
                            title="Staff ID card"
                            aria-label={`ID card for ${r.name}`}
                            onClick={() => issue("card", r)}
                            className="cursor-pointer text-cream-400 transition-colors hover:text-brass-300"
                          >
                            <IdCard size={16} />
                          </button>
                        </>
                      )}
                      {canEdit && (
                        <button
                          type="button"
                          aria-label={`Edit ${r.name}`}
                          onClick={() => setEditingId(editingId === r.id ? null : r.id)}
                          className="cursor-pointer text-cream-500 transition-colors hover:text-brass-300"
                        >
                          <PenLine size={15} />
                        </button>
                      )}
                    </div>
                  </div>

                  {openId === r.id && (
                    <StaffRecord staff={r} canSeeMoney={canSeeMoney} />
                  )}

                  {editingId === r.id && canEdit && (
                    <StaffForm
                      actor={actor}
                      editing={r}
                      onClose={() => setEditingId(null)}
                      onSaved={flash}
                      onError={setError}
                    />
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}

/** Maps a staff row onto the letter's shape. */
function letterData(staff: Staff, reference: string, hr: HrSettings) {
  return {
    reference,
    staffName: staff.name,
    address: staff.address,
    jobTitle:
      staff.jobTitle ?? (staff.role ? STAFF_ROLE_LABELS[staff.role] : "Staff"),
    employmentType: (staff.employmentType ??
      (staff.isSalaried ? "salary" : "wage")) as EmploymentType,
    monthlySalaryKobo: staff.monthlySalaryKobo,
    startDateMs: staff.hiredAt?.toMillis?.() ?? null,
    issuedAtMs: Date.now(),
    signatoryName: hr.letterSignatoryName,
    signatoryTitle: hr.letterSignatoryTitle,
  };
}

/** Maps a staff row onto the ID card's shape. */
function cardData(staff: Staff, hr: HrSettings) {
  const issued = Date.now();
  const expires = new Date(issued);
  expires.setMonth(expires.getMonth() + hr.idCardValidMonths);

  return {
    staffName: staff.name,
    jobTitle:
      staff.jobTitle ?? (staff.role ? STAFF_ROLE_LABELS[staff.role] : "Staff"),
    staffNumber: staff.staffNumber ?? "",
    photoUrl: staff.photoUrl,
    phone: staff.phone,
    idNumber: staff.idNumber,
    issuedAtMs: issued,
    expiresAtMs: expires.getTime(),
    nextOfKinName: staff.nextOfKinName,
    nextOfKinPhone: staff.nextOfKinPhone,
    returnNote: hr.idCardReturnNote,
  };
}

/**
 * The employment record and the figures a staff member asks about.
 *
 * Loaded on expand rather than for every row: the stats read across four collections, and
 * doing that for a list of twenty people would be eighty queries to render a page nobody
 * had asked to see in detail.
 */
function StaffRecord({
  staff,
  canSeeMoney,
}: {
  staff: Row;
  canSeeMoney: boolean;
}) {
  const [stats, setStats] = useState<StaffStats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let live = true;
    loadStaffStats(getDb(), staff.id)
      .then((s) => {
        if (live) setStats(s);
      })
      .catch(() => {})
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
    };
  }, [staff.id]);

  return (
    <div className="mt-4 space-y-4 border-t border-night-800 pt-4">
      <dl className="grid gap-x-6 gap-y-2 text-xs sm:grid-cols-2 lg:grid-cols-3">
        <Fact label="Role" value={staff.role ? STAFF_ROLE_LABELS[staff.role] : "—"} />
        <Fact
          label="Pay basis"
          value={
            EMPLOYMENT_TYPE_LABELS[
              (staff.employmentType ?? (staff.isSalaried ? "salary" : "wage")) as EmploymentType
            ]
          }
        />
        <Fact label="Staff number" value={staff.staffNumber ?? "—"} />
        <Fact label="Phone" value={staff.phone ?? "—"} />
        <Fact label="NIN" value={staff.idNumber ?? "—"} />
        <Fact
          label="Started"
          value={
            staff.hiredAt?.toMillis
              ? new Date(staff.hiredAt.toMillis()).toLocaleDateString("en-GB")
              : "—"
          }
        />
        <Fact label="Address" value={staff.address ?? "—"} />
        <Fact
          label="Next of kin"
          value={
            staff.nextOfKinName
              ? `${staff.nextOfKinName}${
                  staff.nextOfKinRelationship ? ` (${staff.nextOfKinRelationship})` : ""
                }${staff.nextOfKinPhone ? ` · ${staff.nextOfKinPhone}` : ""}`
              : "—"
          }
        />
        <Fact label="Bank" value={staff.bankName ?? "—"} />
      </dl>

      {/* The figures the person themselves asks about. */}
      {canSeeMoney && (
        <div>
          <p className="text-xs uppercase tracking-wider text-cream-500">Record</p>
          {loading ? (
            <p className="mt-2 text-xs text-cream-600">Working it out…</p>
          ) : !stats ? (
            <p className="mt-2 text-xs text-cream-600">Could not read the figures.</p>
          ) : (
            <div className="mt-2 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Stat
                label="Earned to date"
                value={formatNaira(stats.totalEarnedKobo)}
                hint={`${stats.wageRunCount + stats.salaryRunCount} paid run(s)`}
              />
              <Stat
                label="Loan outstanding"
                value={formatNaira(stats.loanOutstandingKobo)}
                tone={stats.loanOutstandingKobo > 0 ? "warn" : undefined}
                hint={`${stats.loanCount} on record`}
              />
              <Stat
                label="Penalties"
                value={formatNaira(stats.penaltyKobo)}
                tone={stats.penaltyCount > 0 ? "warn" : undefined}
                hint={`${stats.penaltyCount} recorded`}
              />
              <Stat
                label="Absences"
                value={String(stats.absenceCount)}
                tone={stats.absenceCount > 0 ? "warn" : undefined}
                hint={
                  stats.absenceKobo > 0
                    ? `${formatNaira(stats.absenceKobo)} deducted`
                    : undefined
                }
              />
              {stats.pendingDeductionKobo > 0 && (
                <Stat
                  label="Awaiting deduction"
                  value={formatNaira(stats.pendingDeductionKobo)}
                  tone="warn"
                  hint="on the next run"
                />
              )}
              <Stat
                label="Work logged"
                value={String(stats.totalUnitsLogged)}
                hint={`${stats.workLogCount} entries`}
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function StaffForm({
  actor,
  editing,
  onClose,
  onSaved,
  onError,
}: {
  actor: { uid: string; email: string; role: "admin" | "manager" | "operator" };
  editing?: Row;
  onClose: () => void;
  onSaved: (m: string) => void;
  onError: (m: string) => void;
}) {
  const [name, setName] = useState(editing?.name ?? "");
  const [nickname, setNickname] = useState(editing?.nickname ?? "");
  const [phone, setPhone] = useState(editing?.phone ?? "");
  const [role, setRole] = useState<StaffRole | "">(editing?.role ?? "");
  const [jobTitle, setJobTitle] = useState(editing?.jobTitle ?? "");
  const [employmentType, setEmploymentType] = useState<EmploymentType>(
    editing?.employmentType ?? (editing?.isSalaried ? "salary" : "wage")
  );
  const [salary, setSalary] = useState(
    editing?.monthlySalaryKobo ? String(toNaira(editing.monthlySalaryKobo)) : ""
  );
  const [status, setStatus] = useState<StaffStatus>(editing?.status ?? "active");
  const [staffNumber, setStaffNumber] = useState(editing?.staffNumber ?? "");
  const [address, setAddress] = useState(editing?.address ?? "");
  const [idNumber, setIdNumber] = useState(editing?.idNumber ?? "");
  const [hiredAt, setHiredAt] = useState(
    editing?.hiredAt?.toMillis
      ? toDateInputValue(new Date(editing.hiredAt.toMillis()))
      : toDateInputValue(new Date())
  );
  const [kinName, setKinName] = useState(editing?.nextOfKinName ?? "");
  const [kinPhone, setKinPhone] = useState(editing?.nextOfKinPhone ?? "");
  const [kinRel, setKinRel] = useState(editing?.nextOfKinRelationship ?? "");
  const [bankName, setBankName] = useState(editing?.bankName ?? "");
  const [bankAccount, setBankAccount] = useState(editing?.bankAccount ?? "");
  const [notes, setNotes] = useState(editing?.notes ?? "");
  const [busy, setBusy] = useState(false);

  async function save() {
    if (!name.trim()) {
      onError("A staff member needs a name.");
      return;
    }
    if (employmentType === "salary" && parseNairaInput(salary) <= 0) {
      onError("Set the monthly salary, or record this person as piece rate.");
      return;
    }

    setBusy(true);
    try {
      const input = {
        name,
        nickname,
        phone,
        role: role || undefined,
        jobTitle: jobTitle || undefined,
        employmentType,
        monthlySalaryKobo:
          employmentType === "salary" ? parseNairaInput(salary) : undefined,
        status,
        staffNumber,
        address,
        idNumber,
        hiredAt: fromDateInputValue(hiredAt),
        nextOfKinName: kinName,
        nextOfKinPhone: kinPhone,
        nextOfKinRelationship: kinRel,
        bankName,
        bankAccount,
        notes,
      };
      if (editing) {
        await updateStaff(getDb(), actor, editing.id, input);
        onSaved(`${name.trim()} updated.`);
      } else {
        await createStaff(getDb(), actor, input);
        onSaved(`${name.trim()} added.`);
      }
      onClose();
    } catch (e) {
      onError(e instanceof Error ? e.message : "Could not save the record.");
    } finally {
      setBusy(false);
    }
  }

  const key = editing?.id ?? "new";

  return (
    <div className="mt-5 rounded-2xl border border-brass-500/30 bg-night-950/40 p-5">
      <h3 className="flex items-center gap-2 text-sm text-cream-200">
        <Users size={15} className="text-brass-400" />
        {editing ? `Edit ${editing.name}` : "New staff member"}
      </h3>

      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <TextField id={`st-name-${key}`} label="Full name" value={name} onChange={setName} required />
        <TextField
          id={`st-nick-${key}`}
          label="Known as"
          value={nickname}
          onChange={setNickname}
          hint="what the floor calls them"
        />
        <TextField id={`st-phone-${key}`} label="Phone" value={phone} onChange={setPhone} />
        <SelectField
          id={`st-role-${key}`}
          label="Role"
          value={role}
          onChange={(v) => setRole(v as StaffRole)}
          placeholder="Select…"
          options={STAFF_ROLES.map((r) => ({ value: r, label: STAFF_ROLE_LABELS[r] }))}
        />
        <TextField
          id={`st-title-${key}`}
          label="Job title"
          value={jobTitle}
          onChange={setJobTitle}
          hint="as it appears on the letter"
        />
        <SelectField
          id={`st-emp-${key}`}
          label="Paid by"
          value={employmentType}
          onChange={(v) => setEmploymentType(v as EmploymentType)}
          options={EMPLOYMENT_TYPES.map((t) => ({
            value: t,
            label: EMPLOYMENT_TYPE_LABELS[t],
          }))}
        />
        {employmentType === "salary" && (
          <NairaField
            id={`st-salary-${key}`}
            label="Monthly salary"
            valueKobo={salary}
            onChangeKobo={setSalary}
            required
          />
        )}
        <TextField
          id={`st-number-${key}`}
          label="Staff number"
          value={staffNumber}
          onChange={setStaffNumber}
          hint="printed on the ID card"
        />
        <DateField
          id={`st-hired-${key}`}
          label="Start date"
          value={hiredAt}
          onChange={setHiredAt}
        />
        <SelectField
          id={`st-status-${key}`}
          label="Status"
          value={status}
          onChange={(v) => setStatus(v as StaffStatus)}
          options={STAFF_STATUSES.map((s) => ({
            value: s,
            label: STAFF_STATUS_LABELS[s],
          }))}
        />
        <TextField id={`st-nin-${key}`} label="NIN" value={idNumber} onChange={setIdNumber} />
        <TextField id={`st-addr-${key}`} label="Address" value={address} onChange={setAddress} />
        <TextField id={`st-kin-${key}`} label="Next of kin" value={kinName} onChange={setKinName} />
        <TextField
          id={`st-kinphone-${key}`}
          label="Next of kin phone"
          value={kinPhone}
          onChange={setKinPhone}
        />
        <TextField
          id={`st-kinrel-${key}`}
          label="Relationship"
          value={kinRel}
          onChange={setKinRel}
        />
        <TextField id={`st-bank-${key}`} label="Bank" value={bankName} onChange={setBankName} />
        <TextField
          id={`st-acct-${key}`}
          label="Account number"
          value={bankAccount}
          onChange={setBankAccount}
        />
      </div>

      <div className="mt-4">
        <TextAreaField
          id={`st-notes-${key}`}
          label="Notes"
          value={notes}
          onChange={setNotes}
          rows={2}
        />
      </div>

      <div className="mt-5 flex gap-3">
        <Button onClick={save} busy={busy}>
          {editing ? "Save changes" : "Add staff member"}
        </Button>
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-cream-600">{label}</dt>
      <dd className="mt-0.5 text-cream-300">{value}</dd>
    </div>
  );
}

function Stat({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: "warn";
}) {
  return (
    <div className="rounded-xl border border-night-700/60 bg-night-950/40 p-3">
      <p className="text-[0.65rem] uppercase tracking-wider text-cream-600">{label}</p>
      <p
        className={`mt-1 font-display text-base ${
          tone === "warn" ? "text-amber-300" : "text-cream-100"
        }`}
      >
        {value}
      </p>
      {hint && <p className="mt-0.5 text-[0.65rem] text-cream-600">{hint}</p>}
    </div>
  );
}

function Tile({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className="rounded-3xl border border-night-700/60 bg-night-900/40 p-5">
      <p className="text-xs uppercase tracking-wider text-cream-500">{label}</p>
      <p className="mt-2 font-display text-2xl text-cream-50">{value}</p>
      {hint && <p className="mt-1 text-xs text-cream-500">{hint}</p>}
    </div>
  );
}

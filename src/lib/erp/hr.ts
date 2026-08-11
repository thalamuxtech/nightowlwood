import {
  addDoc,
  collection,
  doc,
  getDoc,
  getDocs,
  orderBy,
  query,
  serverTimestamp,
  Timestamp,
  updateDoc,
  where,
  type Firestore,
} from "firebase/firestore";
import { COL, staffDocumentsPath } from "./collections";
import type {
  DeductionType,
  EmploymentType,
  StaffRole,
  StaffStatus,
} from "./enums";
import { sumKobo } from "./money";
import { DEFAULT_HR_SETTINGS, SETTINGS_DOC, type HrSettings } from "./settings";
import type { Holiday, Staff, StaffDocument } from "./types";
import { writeAudit, type AuditActor } from "./audit";

/**
 * HR: staff records, employment documents, holidays, and the figures a payslip query
 * needs.
 *
 * The workshop's people were previously a name and two boolean flags, which is enough to
 * run payroll and nothing else. It could not answer "when did he start", "what is on his
 * ID card", "how many days has he missed", or "how much has he actually earned from us" —
 * all of which are asked, and all of which were answered from memory.
 */

export async function hrSettings(db: Firestore): Promise<HrSettings> {
  try {
    const snap = await getDoc(doc(db, COL.settings, SETTINGS_DOC.hr));
    if (!snap.exists()) return DEFAULT_HR_SETTINGS;
    return { ...DEFAULT_HR_SETTINGS, ...(snap.data() as Partial<HrSettings>) };
  } catch {
    return DEFAULT_HR_SETTINGS;
  }
}

// ---------------------------------------------------------------------------
// Staff records
// ---------------------------------------------------------------------------

export interface StaffInput {
  name: string;
  nickname?: string;
  phone?: string;
  altPhone?: string;
  role?: StaffRole;
  jobTitle?: string;
  employmentType: EmploymentType;
  /** Required for salaried staff; ignored for piece-rate. */
  monthlySalaryKobo?: number;
  isOperator?: boolean;
  isAssistant?: boolean;
  status?: StaffStatus;
  staffNumber?: string;
  address?: string;
  dateOfBirth?: Date;
  hiredAt?: Date;
  nextOfKinName?: string;
  nextOfKinPhone?: string;
  nextOfKinRelationship?: string;
  photoUrl?: string;
  idNumber?: string;
  bankName?: string;
  bankAccount?: string;
  notes?: string;
}

/**
 * The document body for a staff record.
 *
 * `isSalaried`, `isOperator` and `isAssistant` are derived from `employmentType` and
 * `role` rather than set independently, because the two had drifted: a record could say
 * `isSalaried: true` with no salary figure, or be an operator by flag and an assistant by
 * title. Deriving them means one field decides and the rest follow.
 */
function staffBody(input: StaffInput) {
  const isSalaried = input.employmentType === "salary";

  // Role decides the wage flags where it can. An explicit flag still wins, for roles
  // outside the controlled list.
  const roleIsOperator =
    input.role === "cutting_operator" || input.role === "edging_operator";
  const roleIsAssistant = input.role === "assistant_operator";

  return {
    name: input.name.trim(),
    nickname: input.nickname?.trim() || null,
    phone: input.phone?.trim() || null,
    altPhone: input.altPhone?.trim() || null,
    role: input.role ?? null,
    jobTitle: input.jobTitle?.trim() || null,
    employmentType: input.employmentType,
    isSalaried,
    // A salaried person's figure; null for piece-rate so a stale number cannot be paid.
    monthlySalaryKobo: isSalaried ? (input.monthlySalaryKobo ?? 0) : null,
    isOperator: input.isOperator ?? roleIsOperator,
    isAssistant: input.isAssistant ?? roleIsAssistant,
    status: input.status ?? "active",
    // `active` is kept in step with `status` because every existing query filters on it.
    active: (input.status ?? "active") === "active",
    staffNumber: input.staffNumber?.trim() || null,
    address: input.address?.trim() || null,
    dateOfBirth: input.dateOfBirth ? Timestamp.fromDate(input.dateOfBirth) : null,
    hiredAt: input.hiredAt ? Timestamp.fromDate(input.hiredAt) : null,
    nextOfKinName: input.nextOfKinName?.trim() || null,
    nextOfKinPhone: input.nextOfKinPhone?.trim() || null,
    nextOfKinRelationship: input.nextOfKinRelationship?.trim() || null,
    photoUrl: input.photoUrl || null,
    idNumber: input.idNumber?.trim() || null,
    bankName: input.bankName?.trim() || null,
    bankAccount: input.bankAccount?.trim() || null,
    notes: input.notes?.trim() || null,
  };
}

export async function createStaff(
  db: Firestore,
  actor: AuditActor,
  input: StaffInput
): Promise<string> {
  if (!input.name.trim()) throw new Error("A staff member needs a name.");
  if (input.employmentType === "salary" && (input.monthlySalaryKobo ?? 0) < 0) {
    throw new Error("A salary cannot be negative.");
  }

  const ref = await addDoc(collection(db, COL.staff), {
    ...staffBody(input),
    createdAt: serverTimestamp(),
    createdBy: actor.uid,
  });

  await writeAudit(db, {
    actor,
    action: "create",
    collectionName: COL.staff,
    docId: ref.id,
    summary:
      `Added ${input.name.trim()} as ${input.jobTitle ?? input.role ?? "staff"} ` +
      `(${input.employmentType})`,
    after: { name: input.name.trim(), employmentType: input.employmentType },
  });

  return ref.id;
}

export async function updateStaff(
  db: Firestore,
  actor: AuditActor,
  staffId: string,
  input: StaffInput
): Promise<void> {
  if (!input.name.trim()) throw new Error("A staff member needs a name.");

  const ref = doc(db, COL.staff, staffId);
  const snap = await getDoc(ref);
  if (!snap.exists()) throw new Error("That staff record no longer exists.");
  const prev = snap.data();

  await updateDoc(ref, {
    ...staffBody(input),
    updatedAt: serverTimestamp(),
    updatedBy: actor.uid,
  });

  await writeAudit(db, {
    actor,
    action: "update",
    collectionName: COL.staff,
    docId: staffId,
    summary: `Updated the staff record for ${input.name.trim()}`,
    before: {
      name: prev.name ?? "",
      employmentType: prev.employmentType ?? null,
      monthlySalaryKobo: prev.monthlySalaryKobo ?? null,
      status: prev.status ?? null,
    },
    after: {
      name: input.name.trim(),
      employmentType: input.employmentType,
      monthlySalaryKobo: input.monthlySalaryKobo ?? null,
      status: input.status ?? "active",
    },
  });
}

/**
 * Ends someone's employment.
 *
 * A status change, never a deletion. Their work logs, wage runs and loans all reference
 * them, and removing the record would leave a year of payroll pointing at nothing — the
 * question "who was paid this?" has to stay answerable after they leave.
 */
export async function endEmployment(
  db: Firestore,
  actor: AuditActor,
  staffId: string,
  staffName: string,
  status: Extract<StaffStatus, "resigned" | "terminated">,
  endedAt: Date,
  reason: string
): Promise<void> {
  if (!reason.trim()) throw new Error("Record why the employment ended.");

  await updateDoc(doc(db, COL.staff, staffId), {
    status,
    active: false,
    endedAt: Timestamp.fromDate(endedAt),
    notes: reason.trim(),
    updatedAt: serverTimestamp(),
    updatedBy: actor.uid,
  });

  await writeAudit(db, {
    actor,
    action: "user_deactivate",
    collectionName: COL.staff,
    docId: staffId,
    summary: `${staffName} ${status}: ${reason.trim()}`,
    after: { status, endedAt: endedAt.toISOString() },
  });
}

// ---------------------------------------------------------------------------
// Day rate, for a no-show deduction
// ---------------------------------------------------------------------------

/**
 * What one day off costs a salaried person.
 *
 * Monthly salary over the working days in a month — a fixed divisor rather than the real
 * calendar count, so the same absent day costs the same in February as in March. Staff
 * read a varying figure as arbitrary, and the divisor is stored on the deduction so a past
 * one stays explicable if the setting later changes.
 *
 * Returns zero for a piece-rate worker, and that is correct rather than a gap: a
 * piece-rate operator who does not turn up logs no work and so earns nothing for the day.
 * The absence is already reflected in their pay, and deducting on top would charge them
 * twice for one missed day.
 */
export function dayRateKobo(
  staff: Pick<Staff, "employmentType" | "isSalaried" | "monthlySalaryKobo">,
  workingDaysPerMonth: number
): number {
  const salaried = staff.employmentType === "salary" || staff.isSalaried === true;
  if (!salaried) return 0;
  const monthly = staff.monthlySalaryKobo ?? 0;
  if (monthly <= 0 || workingDaysPerMonth <= 0) return 0;
  return Math.round(monthly / workingDaysPerMonth);
}

/**
 * The deduction amount for a given type, derived where it can be.
 *
 * Only `no_show` is computable. A penalty is a judgement about what a breakage cost and an
 * advance is a sum handed over, so both are entered — see `DEDUCTION_AMOUNT_SOURCE`.
 */
export function suggestedDeductionKobo(
  type: DeductionType,
  staff: Pick<Staff, "employmentType" | "isSalaried" | "monthlySalaryKobo">,
  workingDaysPerMonth: number,
  days = 1
): number {
  if (type !== "no_show") return 0;
  return dayRateKobo(staff, workingDaysPerMonth) * Math.max(1, days);
}

// ---------------------------------------------------------------------------
// Holidays
// ---------------------------------------------------------------------------

export interface HolidayInput {
  name: string;
  startDate: Date;
  endDate: Date;
  kind: "public" | "closure";
  notes?: string;
}

/**
 * Records a day, or run of days, the workshop was shut.
 *
 * A range because holidays come in runs, and four separate records for Sallah means three
 * of them get forgotten. Dates are normalised to the start and end of their days so a
 * comparison never turns on the time part.
 */
export async function setHoliday(
  db: Firestore,
  actor: AuditActor,
  input: HolidayInput
): Promise<string> {
  if (!input.name.trim()) throw new Error("Name the holiday.");

  const start = new Date(input.startDate);
  start.setHours(0, 0, 0, 0);
  const end = new Date(input.endDate);
  end.setHours(23, 59, 59, 999);

  if (end.getTime() < start.getTime()) {
    throw new Error("The last day cannot fall before the first.");
  }

  const ref = await addDoc(collection(db, COL.holidays), {
    name: input.name.trim(),
    startDate: Timestamp.fromDate(start),
    endDate: Timestamp.fromDate(end),
    kind: input.kind,
    notes: input.notes?.trim() || null,
    createdAt: serverTimestamp(),
    createdBy: actor.uid,
  });

  await writeAudit(db, {
    actor,
    action: "holiday_set",
    collectionName: COL.holidays,
    docId: ref.id,
    summary:
      `${input.kind === "public" ? "Public holiday" : "Closure"}: ${input.name.trim()}, ` +
      `${start.toDateString()} to ${end.toDateString()}`,
    after: { name: input.name.trim(), kind: input.kind },
  });

  return ref.id;
}

/**
 * Holidays overlapping a period.
 *
 * Queried on `endDate >= from` and filtered on `startDate <= to` in memory, because
 * Firestore cannot range-filter two different fields in one query. The client-side half is
 * over a handful of documents a year, so the cost is nothing.
 */
export async function loadHolidays(
  db: Firestore,
  from: Date,
  to: Date
): Promise<Holiday[]> {
  const snap = await getDocs(
    query(
      collection(db, COL.holidays),
      where("endDate", ">=", Timestamp.fromDate(from)),
      orderBy("endDate", "asc")
    )
  );
  return snap.docs
    .map((d) => ({ id: d.id, ...d.data() }) as Holiday)
    .filter((h) => (h.startDate?.toMillis?.() ?? 0) <= to.getTime());
}

/**
 * A local calendar day as `YYYY-MM-DD`.
 *
 * Shared by `holidayDayKeys` and `isHoliday` so both build the identical key. Two copies of
 * this formatting is how a lookup silently misses — one padding a month and the other not.
 */
function dayKey(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Every calendar day covered by a set of holidays, as `YYYY-MM-DD` keys. */
export function holidayDayKeys(holidays: Holiday[]): Set<string> {
  const keys = new Set<string>();

  for (const h of holidays) {
    const startMs = h.startDate?.toMillis?.();
    const endMs = h.endDate?.toMillis?.();
    if (!startMs || !endMs) continue;

    const cursor = new Date(startMs);
    cursor.setHours(12, 0, 0, 0);
    const last = new Date(endMs);

    // Guarded against a malformed range producing an unbounded loop. 400 exceeds any
    // plausible closure, so hitting it means the range is wrong — logged rather than
    // truncated silently, since a half-populated set reads as authoritative.
    let guard = 0;
    while (cursor.getTime() <= last.getTime() && guard < 400) {
      keys.add(dayKey(cursor));
      cursor.setDate(cursor.getDate() + 1);
      guard += 1;
    }
    if (guard >= 400) {
      console.warn(
        `[holidays] "${h.name}" spans more than 400 days — check its end date. ` +
          "Days beyond that are not treated as holidays."
      );
    }
  }
  return keys;
}

/** True when a date falls on a recorded holiday or closure. */
export function isHoliday(date: Date, dayKeys: Set<string>): boolean {
  return dayKeys.has(dayKey(date));
}

// ---------------------------------------------------------------------------
// Staff documents
// ---------------------------------------------------------------------------

/**
 * Records that a document was issued.
 *
 * The letter and the card are generated for printing rather than stored as files, so what
 * is kept here is the fact of issue and its reference number — which is what makes a
 * reprint match the original, and what answers "was he ever given one".
 */
export async function recordStaffDocument(
  db: Firestore,
  actor: AuditActor,
  staffId: string,
  staffName: string,
  input: {
    kind: StaffDocument["kind"];
    title: string;
    reference?: string;
    fileUrl?: string;
    issuedAt: Date;
    notes?: string;
  }
): Promise<string> {
  const ref = await addDoc(collection(db, staffDocumentsPath(staffId)), {
    kind: input.kind,
    title: input.title.trim(),
    reference: input.reference?.trim() || null,
    fileUrl: input.fileUrl || null,
    issuedAt: Timestamp.fromDate(input.issuedAt),
    notes: input.notes?.trim() || null,
    createdAt: serverTimestamp(),
    createdBy: actor.uid,
  });

  await writeAudit(db, {
    actor,
    action: "staff_document",
    collectionName: staffDocumentsPath(staffId),
    docId: ref.id,
    summary: `Issued ${input.title.trim()} to ${staffName}`,
    after: { kind: input.kind, reference: input.reference ?? null },
  });

  return ref.id;
}

export async function loadStaffDocuments(
  db: Firestore,
  staffId: string
): Promise<StaffDocument[]> {
  const snap = await getDocs(
    query(collection(db, staffDocumentsPath(staffId)), orderBy("issuedAt", "desc"))
  );
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }) as StaffDocument);
}

// ---------------------------------------------------------------------------
// Staff statistics
// ---------------------------------------------------------------------------

export interface StaffStats {
  /** Outstanding across every disbursed loan and advance. */
  loanOutstandingKobo: number;
  loanCount: number;
  /** Penalties and damages ever recorded, and how many. */
  penaltyKobo: number;
  penaltyCount: number;
  /** Days recorded absent, and what they cost. */
  absenceCount: number;
  absenceKobo: number;
  /** Advances taken as deductions, distinct from loans still on the ledger. */
  advanceKobo: number;
  /** Deductions raised but not yet taken by a run. */
  pendingDeductionKobo: number;
  /** Everything ever paid to this person, net of deductions. */
  totalEarnedKobo: number;
  /** Wage-run and salary-run counts behind that figure. */
  wageRunCount: number;
  salaryRunCount: number;
  /** Units of work logged, all types, for a sense of throughput. */
  totalUnitsLogged: number;
  workLogCount: number;
}

/**
 * The figures a staff member asks about.
 *
 * "How much do I owe?", "how many times have I been docked?", "what have I earned here?"
 * — all previously answered by an admin scrolling through records. Read across the four
 * collections that hold the answers rather than kept as running totals on the staff
 * record, because a denormalised counter that drifts from its source is worse than a
 * query that takes a moment.
 *
 * Earnings come from the runs' own `perStaff` rows rather than from the work logs, since a
 * run snapshots what was actually paid — including any adjustment made before approval —
 * and the logs only say what was done.
 */
export async function loadStaffStats(
  db: Firestore,
  staffId: string
): Promise<StaffStats> {
  const [loanSnap, dedSnap, wageSnap, salarySnap, logSnap] = await Promise.all([
    getDocs(query(collection(db, COL.loans), where("staffId", "==", staffId))),
    getDocs(query(collection(db, COL.deductions), where("staffId", "==", staffId))),
    // Only runs that were actually paid count as earnings. A draft is a proposal and an
    // approved-but-unpaid run is money not yet handed over.
    getDocs(query(collection(db, COL.wageRuns), where("status", "==", "paid"))),
    getDocs(query(collection(db, COL.salaryRuns), where("status", "==", "paid"))),
    getDocs(query(collection(db, COL.workLogs), where("staffId", "==", staffId))),
  ]);

  const loans = loanSnap.docs.map((d) => d.data());
  const loanOutstandingKobo = sumKobo(
    loans
      .filter((l) => l.status === "disbursed" || l.status === "repaying")
      .map((l) => l.outstandingKobo ?? 0)
  );

  const deductions = dedSnap.docs.map((d) => d.data());
  const byType = (t: DeductionType) => deductions.filter((d) => d.type === t);

  const penalties = byType("penalty");
  const absences = byType("no_show");

  let totalEarnedKobo = 0;
  let wageRunCount = 0;
  for (const d of wageSnap.docs) {
    const rows = (d.data().perStaff ?? []) as Array<{
      staffId: string;
      netKobo?: number;
    }>;
    const mine = rows.find((r) => r.staffId === staffId);
    if (mine) {
      totalEarnedKobo += mine.netKobo ?? 0;
      wageRunCount += 1;
    }
  }

  let salaryRunCount = 0;
  for (const d of salarySnap.docs) {
    const rows = (d.data().lines ?? []) as Array<{
      staffId: string;
      netKobo?: number;
    }>;
    const mine = rows.find((r) => r.staffId === staffId);
    if (mine) {
      totalEarnedKobo += mine.netKobo ?? 0;
      salaryRunCount += 1;
    }
  }

  let totalUnitsLogged = 0;
  for (const d of logSnap.docs) {
    const x = d.data();
    const items = (x.items ?? []) as Array<{ units?: number }>;
    if (items.length > 0) {
      totalUnitsLogged += items.reduce((s, i) => s + (i.units ?? 0), 0);
    } else {
      totalUnitsLogged += x.units ?? 0;
    }
  }

  return {
    loanOutstandingKobo,
    loanCount: loans.length,
    penaltyKobo: sumKobo(penalties.map((d) => d.amountKobo ?? 0)),
    penaltyCount: penalties.length,
    absenceCount: absences.length,
    absenceKobo: sumKobo(absences.map((d) => d.amountKobo ?? 0)),
    advanceKobo: sumKobo(byType("advance").map((d) => d.amountKobo ?? 0)),
    pendingDeductionKobo: sumKobo(
      deductions.filter((d) => !d.appliedToRunId).map((d) => d.amountKobo ?? 0)
    ),
    totalEarnedKobo,
    wageRunCount,
    salaryRunCount,
    totalUnitsLogged,
    workLogCount: logSnap.size,
  };
}

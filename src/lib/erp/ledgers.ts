import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  serverTimestamp,
  Timestamp,
  updateDoc,
  where,
  type Firestore,
} from "firebase/firestore";
import { COL } from "./collections";
import type { ExpenseCategory } from "./enums";
import { toKobo } from "./money";
import {
  DEFAULT_METER_CONVERSION_FACTOR,
  DEFAULT_METER_RATE_NAIRA,
  DEFAULT_UTILITY_SETTINGS,
  SETTINGS_DOC,
} from "./settings";
import { writeAudit, type AuditActor } from "./audit";

/**
 * Expense and utility ledgers.
 *
 * Both replace sheets from the record book. The meter sheet in particular was
 * full of `#VALUE!` errors because consumption was a hand-written formula against
 * the previous row; when a row was inserted or deleted the reference broke. Here
 * the delta is computed on write from the actual previous reading, so it cannot
 * be orphaned by an edit elsewhere.
 */

// ---------------------------------------------------------------------------
// Expenses
// ---------------------------------------------------------------------------

export interface NewExpense {
  date: Date;
  payeeType: "staff" | "company" | "vendor";
  payeeName: string;
  purpose: string;
  category: ExpenseCategory;
  amountKobo: number;
  receiptUrl?: string;
}

export async function recordExpense(
  db: Firestore,
  actor: AuditActor,
  input: NewExpense
): Promise<string> {
  if (input.amountKobo <= 0) throw new Error("Amount must be greater than zero.");
  if (!input.payeeName.trim()) throw new Error("Record who was paid.");

  const ref = await addDoc(collection(db, COL.expenses), {
    date: Timestamp.fromDate(input.date),
    payeeType: input.payeeType,
    payeeName: input.payeeName.trim(),
    purpose: input.purpose.trim() || "Not stated",
    category: input.category,
    amountKobo: input.amountKobo,
    receiptUrl: input.receiptUrl ?? null,
    createdAt: serverTimestamp(),
    createdBy: actor.uid,
  });

  await writeAudit(db, {
    actor,
    action: "create",
    collectionName: COL.expenses,
    docId: ref.id,
    summary: `${input.payeeName.trim()}: ${input.purpose.trim()} (${input.amountKobo} kobo)`,
    after: { amountKobo: input.amountKobo, category: input.category },
  });

  return ref.id;
}

/**
 * Corrects a recorded expense.
 *
 * Editing rather than delete-and-recreate keeps the original `createdAt`, so the
 * ledger stays in the order the money actually moved. Re-entering it would place
 * the correction at today's date and quietly reorder the books.
 *
 * The before-image is captured for the audit entry: for money, what a figure was
 * changed *from* is as important as what it became.
 */
export async function updateExpense(
  db: Firestore,
  actor: AuditActor,
  expenseId: string,
  input: NewExpense
): Promise<void> {
  if (input.amountKobo <= 0) throw new Error("Amount must be greater than zero.");
  if (!input.payeeName.trim()) throw new Error("Record who was paid.");

  const ref = doc(db, COL.expenses, expenseId);
  const snap = await getDoc(ref);
  if (!snap.exists()) throw new Error("That expense no longer exists.");
  const prev = snap.data();

  await updateDoc(ref, {
    date: Timestamp.fromDate(input.date),
    payeeType: input.payeeType,
    payeeName: input.payeeName.trim(),
    purpose: input.purpose.trim() || "Not stated",
    category: input.category,
    amountKobo: input.amountKobo,
    receiptUrl: input.receiptUrl ?? null,
    updatedAt: serverTimestamp(),
    updatedBy: actor.uid,
  });

  await writeAudit(db, {
    actor,
    action: "update",
    collectionName: COL.expenses,
    docId: expenseId,
    summary:
      `Corrected expense for ${input.payeeName.trim()}: ` +
      `${prev.amountKobo ?? 0} → ${input.amountKobo} kobo`,
    before: {
      amountKobo: prev.amountKobo ?? 0,
      category: prev.category ?? null,
      payeeName: prev.payeeName ?? "",
    },
    after: {
      amountKobo: input.amountKobo,
      category: input.category,
      payeeName: input.payeeName.trim(),
    },
  });
}

/** Deletes an expense. Admin only, enforced in rules. */
export async function deleteExpense(
  db: Firestore,
  actor: AuditActor,
  expenseId: string,
  summary: string
): Promise<void> {
  await deleteDoc(doc(db, COL.expenses, expenseId));
  await writeAudit(db, {
    actor,
    action: "delete",
    collectionName: COL.expenses,
    docId: expenseId,
    summary: `Deleted expense: ${summary}`,
  });
}

// ---------------------------------------------------------------------------
// Meter readings
// ---------------------------------------------------------------------------

export interface MeterConfigured {
  name: string;
  /** Cost per *billed* unit, after any conversion. */
  ratePerUnitKobo: number;
  /** Whether dial units must be scaled up to reach billable units. */
  useConversion?: boolean;
  conversionFactor?: number;
  /** Baseline for the very first reading, so that period is not billed as zero. */
  openingReading?: number;
  active: boolean;
}

/** Meters from settings, falling back to the two observed in the record book. */
export async function loadMeters(db: Firestore): Promise<MeterConfigured[]> {
  try {
    const snap = await getDocs(
      query(collection(db, COL.settings), where("__name__", "==", SETTINGS_DOC.utility))
    );
    const doc0 = snap.docs[0];
    const meters = doc0?.data()?.meters as MeterConfigured[] | undefined;
    if (meters?.length) return meters.filter((m) => m.active !== false);
  } catch {
    /* fall through to defaults */
  }
  return DEFAULT_UTILITY_SETTINGS.meters.filter((m) => m.active !== false);
}

/**
 * The effective conversion factor for a meter.
 *
 * One place, because "is the conversion on, and what is it" is asked when a reading
 * is recorded, when the chain is rebuilt, and when the form previews a cost — and
 * three copies of `useConversion ? factor ?? 60 : 1` is three chances to disagree
 * about what a historical bill was.
 *
 * A factor of zero or a negative one is treated as "off": it would otherwise make
 * every reading free, which is never what was meant.
 */
export function conversionFactorFor(meter: {
  useConversion?: boolean;
  conversionFactor?: number;
}): number {
  if (!meter.useConversion) return 1;
  const f = meter.conversionFactor ?? DEFAULT_METER_CONVERSION_FACTOR;
  return Number.isFinite(f) && f > 0 ? f : 1;
}

/**
 * What a meter reading costs.
 *
 * `(current − previous) × conversionFactor × ratePerUnit`, which is the formula the
 * business confirmed. Exported and pure so the entry form can show the figure
 * before it is saved, and so the chain rebuild computes it identically — the old
 * spreadsheet's real failure was not the arithmetic but that each row did its own.
 *
 * Consumption is clamped at zero: a dial that reads lower than last time means a
 * replacement or a typo, never negative power, and a negative bill would credit the
 * workshop for electricity it used.
 */
export function meterCharge(input: {
  reading: number;
  previousReading: number | null;
  conversionFactor: number;
  ratePerUnitKobo: number;
}): { consumedUnits: number; billedUnits: number; amountKobo: number } {
  if (input.previousReading === null || input.reading < input.previousReading) {
    return { consumedUnits: 0, billedUnits: 0, amountKobo: 0 };
  }
  // Rounded to two places because dials read to hundredths; carrying full float
  // precision here is what produced 6.289999999 in the source sheet.
  const consumedUnits = Math.round((input.reading - input.previousReading) * 100) / 100;
  const billedUnits = Math.round(consumedUnits * input.conversionFactor * 100) / 100;
  return {
    consumedUnits,
    billedUnits,
    amountKobo: Math.round(billedUnits * input.ratePerUnitKobo),
  };
}

export interface ReadingResult {
  id: string;
  actualConsumed: number;
  billedUnits: number;
  amountKobo: number;
  /** Set when the reading is lower than the one before it. */
  warning?: string;
}

/**
 * Records a meter reading, computing consumption from the previous one.
 *
 * The delta is derived here rather than entered, which is the fix for the
 * `#VALUE!` errors: consumption was a formula pointing at the row above, so any
 * insertion or deletion broke it. Reading the actual previous document for the
 * same meter cannot be broken that way.
 *
 * A reading below its predecessor is accepted but flagged rather than rejected.
 * Meters are replaced and occasionally roll over, so refusing the entry would
 * leave the operator with nowhere to record what the dial says. Consumption is
 * clamped to zero so a rollover cannot produce a negative bill.
 */
export async function recordMeterReading(
  db: Firestore,
  actor: AuditActor,
  input: {
    meterName: string;
    date: Date;
    reading: number;
    ratePerUnitKobo: number;
    /** From the meter's config; 1 when the dial already reads in billed units. */
    conversionFactor?: number;
    /**
     * Baseline for the very first reading on this meter.
     *
     * Without one the first entry has nothing to subtract from and that period's
     * power goes unbilled — which is why it is configurable rather than assumed
     * to be zero. Ignored once any reading exists, since the chain then has a real
     * predecessor.
     */
    openingReading?: number;
  }
): Promise<ReadingResult> {
  if (input.reading < 0) throw new Error("A reading cannot be negative.");

  const conversionFactor =
    Number.isFinite(input.conversionFactor) && (input.conversionFactor as number) > 0
      ? (input.conversionFactor as number)
      : 1;

  // The most recent reading for this meter on or before the new date, so
  // back-dating an entry compares against the right predecessor rather than the
  // latest one.
  const previousSnap = await getDocs(
    query(
      collection(db, COL.meterReadings),
      where("meterName", "==", input.meterName),
      where("date", "<=", Timestamp.fromDate(input.date)),
      orderBy("date", "desc"),
      limit(1)
    )
  );

  const previous = previousSnap.docs[0]?.data();
  const recordedPrevious =
    typeof previous?.reading === "number" ? previous.reading : null;

  // No earlier reading, so fall back to the configured opening value. This is the
  // fix for a first entry always costing nothing: the workshop knows what the dial
  // said when it started recording, and that is a legitimate baseline.
  const opening =
    Number.isFinite(input.openingReading) && (input.openingReading as number) >= 0
      ? (input.openingReading as number)
      : null;
  const previousReading = recordedPrevious ?? opening;

  let warning: string | undefined;

  if (recordedPrevious === null && opening === null) {
    warning =
      "First reading for this meter and no opening reading is configured, so no " +
      "consumption is charged. Set an opening reading in Settings to bill this period.";
  } else if (previousReading !== null && input.reading < previousReading) {
    warning =
      `This reading (${input.reading}) is lower than the one before it ` +
      `(${previousReading}). Recorded with zero consumption. Check for a meter ` +
      `replacement or a typo.`;
  }

  const { consumedUnits, billedUnits, amountKobo } = meterCharge({
    reading: input.reading,
    previousReading,
    conversionFactor,
    ratePerUnitKobo: input.ratePerUnitKobo,
  });

  const ref = await addDoc(collection(db, COL.meterReadings), {
    meterName: input.meterName,
    date: Timestamp.fromDate(input.date),
    reading: input.reading,
    previousReading,
    actualConsumed: consumedUnits,
    // Stored, not re-derived on read: turning the conversion off later must not
    // restate a bill that was already issued and paid.
    conversionFactor,
    billedUnits,
    ratePerUnitKobo: input.ratePerUnitKobo,
    amountKobo,
    // Stored so a later review can see the entry was questioned at the time.
    warning: warning ?? null,
    createdAt: serverTimestamp(),
    createdBy: actor.uid,
  });

  await writeAudit(db, {
    actor,
    action: "create",
    collectionName: COL.meterReadings,
    docId: ref.id,
    summary:
      `${input.meterName}: reading ${input.reading}, ${consumedUnits} unit(s)` +
      (conversionFactor !== 1 ? ` × ${conversionFactor} = ${billedUnits}` : "") +
      `, ${amountKobo} kobo` +
      (warning ? " (flagged)" : ""),
    after: {
      reading: input.reading,
      actualConsumed: consumedUnits,
      billedUnits,
      amountKobo,
    },
  });

  return {
    id: ref.id,
    actualConsumed: consumedUnits,
    billedUnits,
    amountKobo,
    warning,
  };
}

/**
 * Recomputes a meter's consumption chain.
 *
 * Needed after a correction or deletion, because every later reading's delta
 * depends on the one before it. Without this, fixing a mistyped reading would
 * leave the following row's consumption wrong.
 */
export async function recalculateMeterChain(
  db: Firestore,
  actor: AuditActor,
  meterName: string
): Promise<{ updated: number }> {
  const snap = await getDocs(
    query(
      collection(db, COL.meterReadings),
      where("meterName", "==", meterName),
      orderBy("date", "asc")
    )
  );

  /*
   * The meter's current configuration, for the opening reading only.
   *
   * The rate and the conversion factor are taken from each *reading* rather than
   * from the config, because those were the terms the reading was billed under and
   * a tariff rise must not silently reprice last year's power. The opening reading
   * is different in kind: it is a property of the chain's start, not of any one
   * entry, so the first row picks it up from settings and later rows measure
   * against their real predecessor.
   */
  const meters = await loadMeters(db);
  const config = meters.find((m) => m.name === meterName);
  const opening =
    Number.isFinite(config?.openingReading) && (config?.openingReading as number) >= 0
      ? (config?.openingReading as number)
      : null;

  let previous: number | null = opening;
  let updated = 0;

  for (const d of snap.docs) {
    const x = d.data();
    const reading = typeof x.reading === "number" ? x.reading : 0;
    const rate = x.ratePerUnitKobo ?? toKobo(DEFAULT_METER_RATE_NAIRA);
    const factor =
      Number.isFinite(x.conversionFactor) && x.conversionFactor > 0
        ? (x.conversionFactor as number)
        : 1;

    const { consumedUnits, billedUnits, amountKobo } = meterCharge({
      reading,
      previousReading: previous,
      conversionFactor: factor,
      ratePerUnitKobo: rate,
    });

    if (
      x.actualConsumed !== consumedUnits ||
      x.amountKobo !== amountKobo ||
      x.billedUnits !== billedUnits ||
      x.previousReading !== previous
    ) {
      await updateDoc(d.ref, {
        previousReading: previous,
        actualConsumed: consumedUnits,
        billedUnits,
        amountKobo,
        updatedAt: serverTimestamp(),
        updatedBy: actor.uid,
      });
      updated += 1;
    }
    previous = reading;
  }

  if (updated > 0) {
    await writeAudit(db, {
      actor,
      action: "update",
      collectionName: COL.meterReadings,
      docId: meterName,
      summary: `Recomputed ${meterName}: ${updated} reading(s) corrected`,
      after: { updated },
    });
  }

  return { updated };
}

/**
 * Which meters have not been read today.
 *
 * Drives the dashboard reminder. A gap in the chain is not recoverable after the
 * fact — nobody can go back and see what the dial said on Tuesday — so a nudge on
 * the day is the only thing that keeps the series complete, and a complete series
 * is what makes a consumption spike visible at all.
 *
 * "Today" is local midnight, matching how a reading is dated on entry.
 */
export async function metersDueToday(
  db: Firestore
): Promise<Array<{ name: string; lastReadMs: number | null }>> {
  const meters = await loadMeters(db);
  if (meters.length === 0) return [];

  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);

  const due: Array<{ name: string; lastReadMs: number | null }> = [];

  for (const meter of meters) {
    try {
      const snap = await getDocs(
        query(
          collection(db, COL.meterReadings),
          where("meterName", "==", meter.name),
          orderBy("date", "desc"),
          limit(1)
        )
      );
      const lastMs = snap.docs[0]?.data()?.date?.toMillis?.() ?? null;
      if (lastMs === null || lastMs < startOfToday.getTime()) {
        due.push({ name: meter.name, lastReadMs: lastMs });
      }
    } catch {
      // A read failure must not turn the reminder into an error banner; the worst
      // case is that a meter is simply not listed as due.
    }
  }

  return due;
}

export async function deleteMeterReading(
  db: Firestore,
  actor: AuditActor,
  readingId: string,
  meterName: string
): Promise<void> {
  await deleteDoc(doc(db, COL.meterReadings, readingId));
  await writeAudit(db, {
    actor,
    action: "delete",
    collectionName: COL.meterReadings,
    docId: readingId,
    summary: `Deleted a ${meterName} reading`,
  });
  // The chain is rebuilt because every later delta depended on the removed row.
  await recalculateMeterChain(db, actor, meterName);
}

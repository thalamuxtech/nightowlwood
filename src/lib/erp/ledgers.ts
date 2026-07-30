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
import { DEFAULT_METER_RATE_NAIRA, SETTINGS_DOC } from "./settings";
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
  ratePerUnitKobo: number;
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
  return [
    { name: "Shasan", ratePerUnitKobo: toKobo(DEFAULT_METER_RATE_NAIRA), active: true },
    { name: "Gadon Kaya", ratePerUnitKobo: toKobo(DEFAULT_METER_RATE_NAIRA), active: true },
  ];
}

export interface ReadingResult {
  id: string;
  actualConsumed: number;
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
  input: { meterName: string; date: Date; reading: number; ratePerUnitKobo: number }
): Promise<ReadingResult> {
  if (input.reading < 0) throw new Error("A reading cannot be negative.");

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
  const previousReading = typeof previous?.reading === "number" ? previous.reading : null;

  let warning: string | undefined;
  let consumed: number;

  if (previousReading === null) {
    // First reading for this meter: nothing to measure against, so consumption
    // is zero rather than the whole dial value, which would bill the entire
    // history of the meter in one go.
    consumed = 0;
    warning = "First reading for this meter, so no consumption is charged yet.";
  } else if (input.reading < previousReading) {
    consumed = 0;
    warning =
      `This reading (${input.reading}) is lower than the previous one ` +
      `(${previousReading}). Recorded with zero consumption. Check for a meter ` +
      `replacement or a typo.`;
  } else {
    consumed = Math.round((input.reading - previousReading) * 100) / 100;
  }

  const amountKobo = Math.round(consumed * input.ratePerUnitKobo);

  const ref = await addDoc(collection(db, COL.meterReadings), {
    meterName: input.meterName,
    date: Timestamp.fromDate(input.date),
    reading: input.reading,
    previousReading,
    actualConsumed: consumed,
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
      `${input.meterName}: reading ${input.reading}, consumed ${consumed}, ` +
      `${amountKobo} kobo` + (warning ? " (flagged)" : ""),
    after: { reading: input.reading, actualConsumed: consumed, amountKobo },
  });

  return { id: ref.id, actualConsumed: consumed, amountKobo, warning };
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

  let previous: number | null = null;
  let updated = 0;

  for (const d of snap.docs) {
    const x = d.data();
    const reading = typeof x.reading === "number" ? x.reading : 0;
    const consumed =
      previous === null || reading < previous
        ? 0
        : Math.round((reading - previous) * 100) / 100;
    const rate = x.ratePerUnitKobo ?? toKobo(DEFAULT_METER_RATE_NAIRA);
    const amountKobo = Math.round(consumed * rate);

    if (x.actualConsumed !== consumed || x.amountKobo !== amountKobo) {
      await updateDoc(d.ref, {
        previousReading: previous,
        actualConsumed: consumed,
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

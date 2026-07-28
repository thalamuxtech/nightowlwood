import { doc, runTransaction, type Firestore } from "firebase/firestore";
import { COL, NUMBER_PREFIX, type CounterName } from "./collections";

/**
 * Human-readable document numbers (JOB-2026-0142, INV-2026-0007).
 *
 * Sequences are allocated inside a Firestore transaction so two people creating
 * a job at the same moment cannot receive the same number. Counters are held per
 * prefix *and year*, so each January restarts at 0001 without colliding with
 * last year's records.
 */

export interface AllocatedNumber {
  /** Formatted number, e.g. `JOB-2026-0142`. */
  formatted: string;
  year: number;
  sequence: number;
}

function pad(sequence: number, width = 4): string {
  return String(sequence).padStart(width, "0");
}

/** Formats a number without touching Firestore — for previews and tests. */
export function formatDocNumber(name: CounterName, year: number, sequence: number): string {
  return `${NUMBER_PREFIX[name]}-${year}-${pad(sequence)}`;
}

/**
 * Atomically allocates the next number for `name`.
 *
 * The counter document holds one field per year (`y2026: 142`). Reading and
 * incrementing inside the transaction is what makes this safe — `increment()`
 * alone would be atomic but wouldn't tell us the resulting value to format.
 */
export async function allocateDocNumber(
  db: Firestore,
  name: CounterName,
  now: Date = new Date()
): Promise<AllocatedNumber> {
  const year = now.getFullYear();
  const field = `y${year}`;
  const ref = doc(db, COL.counters, name);

  const sequence = await runTransaction(db, async (tx) => {
    const snap = await tx.get(ref);
    const current = snap.exists() ? Number(snap.data()?.[field] ?? 0) : 0;
    const next = current + 1;
    // merge-style set: keeps other years' fields intact.
    tx.set(ref, { [field]: next }, { merge: true });
    return next;
  });

  return { formatted: formatDocNumber(name, year, sequence), year, sequence };
}

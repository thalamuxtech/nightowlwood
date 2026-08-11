import {
  addDoc,
  collection,
  deleteDoc,
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
import { COL } from "./collections";
import type { ExpenseCategory } from "./enums";
import { sumKobo } from "./money";
import type { FixedCost } from "./types";
import { writeAudit, type AuditActor } from "./audit";

/**
 * Recurring fixed costs: rent, subscriptions, contributions, salaries.
 *
 * These are a *commitment* rather than a payment, which is why they are not simply
 * expenses. Rent of ₦4m a year is owed whether or not a board is cut, and the question it
 * answers — "what must we turn over each month before we make anything?" — cannot be
 * answered from expenses already paid, because the ones not yet paid are exactly the ones
 * that matter.
 *
 * Paying one still writes an ordinary expense, so the ledger stays the single source of
 * truth for money that has actually left. This collection says what is *owed*; the ledger
 * says what has *gone*. Both are needed and they are not the same number.
 */

export interface FixedCostInput {
  name: string;
  category: ExpenseCategory;
  amountKobo: number;
  cadence: FixedCost["cadence"];
  dueDay?: number;
  active?: boolean;
  notes?: string;
}

/**
 * A cost's monthly equivalent.
 *
 * Annual and quarterly commitments are divided down so everything can be compared and
 * summed on one timescale — ₦4m a year is ₦333,333 a month, and a break-even figure that
 * mixed annual and monthly amounts would be meaningless.
 */
export function monthlyEquivalentKobo(cost: {
  amountKobo: number;
  cadence: FixedCost["cadence"];
}): number {
  switch (cost.cadence) {
    case "annual":
      return Math.round(cost.amountKobo / 12);
    case "quarterly":
      return Math.round(cost.amountKobo / 3);
    default:
      return cost.amountKobo;
  }
}

export async function createFixedCost(
  db: Firestore,
  actor: AuditActor,
  input: FixedCostInput
): Promise<string> {
  if (!input.name.trim()) throw new Error("Name the cost.");
  if (!(input.amountKobo > 0)) throw new Error("A fixed cost must have an amount.");
  if (input.dueDay !== undefined && (input.dueDay < 1 || input.dueDay > 31)) {
    throw new Error("The due day has to be between 1 and 31.");
  }

  const ref = await addDoc(collection(db, COL.fixedCosts), {
    name: input.name.trim(),
    category: input.category,
    amountKobo: input.amountKobo,
    cadence: input.cadence,
    dueDay: input.dueDay ?? null,
    active: input.active ?? true,
    notes: input.notes?.trim() || null,
    createdAt: serverTimestamp(),
    createdBy: actor.uid,
  });

  await writeAudit(db, {
    actor,
    action: "create",
    collectionName: COL.fixedCosts,
    docId: ref.id,
    summary:
      `Added fixed cost ${input.name.trim()}: ${input.amountKobo} kobo ${input.cadence}`,
    after: {
      name: input.name.trim(),
      amountKobo: input.amountKobo,
      cadence: input.cadence,
    },
  });

  return ref.id;
}

export async function updateFixedCost(
  db: Firestore,
  actor: AuditActor,
  costId: string,
  input: FixedCostInput
): Promise<void> {
  if (!input.name.trim()) throw new Error("Name the cost.");
  if (!(input.amountKobo > 0)) throw new Error("A fixed cost must have an amount.");

  const ref = doc(db, COL.fixedCosts, costId);
  const snap = await getDoc(ref);
  if (!snap.exists()) throw new Error("That cost no longer exists.");
  const prev = snap.data();

  await updateDoc(ref, {
    name: input.name.trim(),
    category: input.category,
    amountKobo: input.amountKobo,
    cadence: input.cadence,
    dueDay: input.dueDay ?? null,
    active: input.active ?? true,
    notes: input.notes?.trim() || null,
    updatedAt: serverTimestamp(),
    updatedBy: actor.uid,
  });

  await writeAudit(db, {
    actor,
    action: "update",
    collectionName: COL.fixedCosts,
    docId: costId,
    summary:
      `Changed fixed cost ${input.name.trim()}: ` +
      `${prev.amountKobo ?? 0} → ${input.amountKobo} kobo`,
    before: { amountKobo: prev.amountKobo ?? 0, cadence: prev.cadence ?? null },
    after: { amountKobo: input.amountKobo, cadence: input.cadence },
  });
}

/**
 * Removes a fixed cost. Expenses already booked against it are untouched.
 *
 * Those expenses are money that actually left and stay in the ledger regardless — deleting
 * the commitment stops it counting toward the monthly floor from now on, and does not
 * rewrite history.
 *
 * Existence is checked first so the audit entry cannot claim a removal that removed
 * nothing: deleting an already-gone document succeeds silently in Firestore, and an audit
 * trail with entries for things that were not there is worse than one with a gap.
 *
 * Callers should route this through `deleteOrRequest` so a non-admin's removal becomes an
 * approval request; the reason is required either way.
 */
export async function deleteFixedCost(
  db: Firestore,
  actor: AuditActor,
  costId: string,
  name: string,
  reason: string
): Promise<void> {
  if (!reason.trim()) throw new Error("Give a reason for removing this cost.");

  const ref = doc(db, COL.fixedCosts, costId);
  const snap = await getDoc(ref);
  if (!snap.exists()) throw new Error("That cost no longer exists.");
  const prev = snap.data();

  await deleteDoc(ref);

  await writeAudit(db, {
    actor,
    action: "delete",
    collectionName: COL.fixedCosts,
    docId: costId,
    summary:
      `Removed fixed cost ${name} (${prev.amountKobo ?? 0} kobo ${prev.cadence ?? ""}): ` +
      reason.trim(),
    before: { name, amountKobo: prev.amountKobo ?? 0, cadence: prev.cadence ?? null },
  });
}

export async function loadFixedCosts(
  db: Firestore,
  includeInactive = false
): Promise<FixedCost[]> {
  const snap = await getDocs(
    query(collection(db, COL.fixedCosts), orderBy("name", "asc"))
  );
  return snap.docs
    .map((d) => ({ id: d.id, ...d.data() }) as FixedCost)
    .filter((c) => includeInactive || c.active !== false);
}

export interface FixedCostSummary {
  costs: FixedCost[];
  /** Every active commitment on a monthly footing. */
  monthlyTotalKobo: number;
  /** Salaries owed monthly, read from staff rather than entered as a fixed cost. */
  salaryMonthlyKobo: number;
  /** Commitments plus salaries — the real monthly floor. */
  monthlyFloorKobo: number;
  byCategory: Partial<Record<ExpenseCategory, number>>;
}

/**
 * The monthly cost floor.
 *
 * Salaries are read from the staff records rather than entered here as a line, because
 * they already exist there and are what the salary run pays. Entering them twice is how a
 * raise gets applied in one place and not the other, and then the break-even figure is
 * quietly wrong.
 */
export async function summariseFixedCosts(
  db: Firestore
): Promise<FixedCostSummary> {
  const [costs, staffSnap] = await Promise.all([
    loadFixedCosts(db),
    getDocs(query(collection(db, COL.staff), where("active", "==", true))),
  ]);

  const byCategory: Partial<Record<ExpenseCategory, number>> = {};
  for (const c of costs) {
    const monthly = monthlyEquivalentKobo(c);
    byCategory[c.category] = (byCategory[c.category] ?? 0) + monthly;
  }

  const salaryMonthlyKobo = sumKobo(
    staffSnap.docs
      .map((d) => d.data())
      .filter((s) => s.isSalaried === true || s.employmentType === "salary")
      .map((s) => s.monthlySalaryKobo ?? 0)
  );

  const monthlyTotalKobo = sumKobo(costs.map(monthlyEquivalentKobo));

  return {
    costs,
    monthlyTotalKobo,
    salaryMonthlyKobo,
    monthlyFloorKobo: monthlyTotalKobo + salaryMonthlyKobo,
    byCategory,
  };
}

/**
 * Books a payment against a fixed cost.
 *
 * Writes an ordinary expense, which is what keeps the ledger the one place money-out is
 * recorded. The link back means a run of rent payments can be traced to the commitment
 * they satisfy without the commitment itself pretending to be a payment.
 */
export async function payFixedCost(
  db: Firestore,
  actor: AuditActor,
  cost: FixedCost,
  input: { date: Date; amountKobo?: number; notes?: string }
): Promise<string> {
  const amountKobo = input.amountKobo ?? cost.amountKobo;
  if (!(amountKobo > 0)) throw new Error("A payment must have an amount.");

  const ref = await addDoc(collection(db, COL.expenses), {
    date: Timestamp.fromDate(input.date),
    payeeType: "company",
    payeeName: cost.name,
    purpose: input.notes?.trim() || `${cost.name} (${cost.cadence})`,
    category: cost.category,
    amountKobo,
    receiptUrl: null,
    sourceCollection: COL.fixedCosts,
    sourceId: cost.id,
    createdAt: serverTimestamp(),
    createdBy: actor.uid,
  });

  await updateDoc(doc(db, COL.fixedCosts, cost.id), {
    lastPaidAt: Timestamp.fromDate(input.date),
    updatedAt: serverTimestamp(),
    updatedBy: actor.uid,
  });

  await writeAudit(db, {
    actor,
    action: "create",
    collectionName: COL.expenses,
    docId: ref.id,
    summary: `Paid ${cost.name}: ${amountKobo} kobo`,
    after: { fixedCostId: cost.id, amountKobo },
  });

  return ref.id;
}

/** Seed set matching what the workshop confirmed, for first-run setup. */
export const DEFAULT_FIXED_COSTS: FixedCostInput[] = [
  { name: "Rent", category: "rent", amountKobo: 400_000_000, cadence: "annual" },
  { name: "Water bill", category: "admin", amountKobo: 500_000, cadence: "monthly" },
  { name: "Canva subscription", category: "admin", amountKobo: 290_000, cadence: "monthly" },
  { name: "Meta verified badge", category: "admin", amountKobo: 1_200_000, cadence: "monthly" },
  {
    name: "Shasan security contribution",
    category: "admin",
    amountKobo: 300_000,
    cadence: "monthly",
  },
];

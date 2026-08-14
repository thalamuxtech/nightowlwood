import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  Timestamp,
  updateDoc,
  writeBatch,
  type Firestore,
} from "firebase/firestore";
import { COL, addonsPath, componentsPath, projectPurchasesPath } from "./collections";
import type { ExpenseCategory } from "./enums";
import { applyPercentKobo, lineAmountKobo, sumKobo } from "./money";
import type { ComponentAddon, ProjectPurchase } from "./types";
import { writeAudit, type AuditActor } from "./audit";

/**
 * Component addons, and purchases against a project.
 *
 * Two things the estimate could not express, both of which distorted the numbers.
 *
 * **Addons** are bought-in items — kitchenwares, appliances, fittings — passed on to
 * the client. They are not component *features*, because a feature is work the
 * workshop performs and prices with its own margin. Mixing them meant a ₦450,000 oven
 * inflated the base that the error margin and the Nightowl charge were applied to, so
 * the client was charged a manufacturing margin on an appliance nobody manufactured.
 *
 * **Purchases** are what was actually spent. The estimate says what a job was expected
 * to cost; without purchases there is no record of what it really cost, so a project's
 * profit was a guess against a figure quoted before any material was bought.
 */

// ---------------------------------------------------------------------------
// Addons
// ---------------------------------------------------------------------------

/**
 * What an addon adds to the estimate.
 *
 * `quantity × unitCost`, plus a per-line handling margin. The margin defaults to zero
 * because some addons are passed through at cost as a courtesy and others carry a
 * charge, and that is a commercial decision per line rather than a system-wide rate.
 */
export function addonAmountKobo(input: {
  quantity: number;
  unitCostKobo: number;
  marginPercent?: number;
}): number {
  const base = lineAmountKobo(input.quantity, input.unitCostKobo);
  return base + applyPercentKobo(base, input.marginPercent ?? 0);
}

/**
 * Whether an addon belongs on the estimate. **The only rule.**
 *
 * Every path goes through this — the rollup that moves the component total, the
 * component subtotal, and the invoice's line builder. Three copies had drifted apart
 * once already: the write path treated a missing flag as included, while the read
 * paths treated it as included only if priced. That disagreement let a component's
 * stored total and the invoice built from it diverge, which shows up as a client
 * under-billed for the workshop's own work.
 *
 * The rule matches `isIncluded` for component features, deliberately: an explicit tick
 * decides, and a row written before the flag existed falls back to its price being the
 * only record of intent. `createAddon` always writes the flag, so the fallback only
 * ever applies to rows this code did not create — an import, or a hand edit.
 */
export function isAddonIncluded(addon: {
  included?: boolean | null;
  amountKobo?: number | null;
}): boolean {
  if (addon.included === true) return true;
  if (addon.included === false) return false;
  return (addon.amountKobo ?? 0) > 0;
}

/**
 * The kitchen appliances and fittings the workshop quotes, with the prices from its own estimate
 * sheet.
 *
 * These sat in a second column of the paper template headed "Addons", separate from the materials —
 * and that separation is right, which is why they are here rather than as template lines. An oven is
 * bought in, passed through at cost plus a handling margin, and it must not disappear into a
 * materials subtotal that the error margin and Nightowl charge are then calculated on.
 *
 * A starting list, not a fixed one: prices move, and each is editable on the addon itself. Offered
 * as one-tap picks so a kitchen quote does not mean typing fourteen appliance names.
 */
export const SUGGESTED_ADDONS: Array<{
  name: string;
  category: ComponentAddon["category"];
  unitCostKobo: number;
}> = [
  { name: "Builtin Microwave", category: "appliance", unitCostKobo: 250_000_00 },
  { name: "Builtin Oven (electric + gas)", category: "appliance", unitCostKobo: 429_000_00 },
  {
    name: "5-burner inbuilt hob, 8mm tempered glass",
    category: "appliance",
    unitCostKobo: 200_000_00,
  },
  { name: "Smoke extractor (chimney)", category: "appliance", unitCostKobo: 230_000_00 },
  { name: "Pull pantry (glass)", category: "kitchenware", unitCostKobo: 280_000_00 },
  { name: "Pulldown rack", category: "kitchenware", unitCostKobo: 220_000_00 },
  { name: "Smart sink", category: "kitchenware", unitCostKobo: 200_000_00 },
  { name: "Wastebin drawer", category: "kitchenware", unitCostKobo: 130_000_00 },
  { name: "Magic corner", category: "kitchenware", unitCostKobo: 205_000_00 },
  { name: "Plate rack", category: "kitchenware", unitCostKobo: 25_000_00 },
  { name: "Plate / mugs drawer", category: "kitchenware", unitCostKobo: 180_000_00 },
  { name: "Cutlery divider", category: "kitchenware", unitCostKobo: 20_000_00 },
  { name: "Vertical stack drawer", category: "kitchenware", unitCostKobo: 30_000_00 },
  { name: "Stool chairs", category: "other", unitCostKobo: 150_000_00 },
];

export interface NewAddon {
  name: string;
  category: ComponentAddon["category"];
  brand?: string;
  model?: string;
  supplier?: string;
  quantity: number;
  unitCostKobo: number;
  marginPercent?: number;
  included?: boolean;
  notes?: string;
}

/**
 * Moves a component's and its project's totals by a delta.
 *
 * A delta, never a re-sum of the siblings, for the reason set out at length in
 * `saveFeature`: the client SDK's `tx.get` takes a document reference and not a query,
 * so a sibling sum has to be read outside the transaction and is therefore not in its
 * read set. Two addons changing at once would each commit a stale total and one
 * would erase the other. Only this row's before and after are needed, and both are
 * known to the caller.
 */
async function applyAddonDelta(
  db: Firestore,
  actor: AuditActor,
  projectId: string,
  componentId: string,
  deltaKobo: number
): Promise<void> {
  if (deltaKobo === 0) return;

  const compRef = doc(db, componentsPath(projectId), componentId);
  const projRef = doc(db, COL.projects, projectId);

  await runTransaction(db, async (tx) => {
    const [compSnap, projSnap] = await Promise.all([tx.get(compRef), tx.get(projRef)]);
    if (!compSnap.exists()) throw new Error("That component no longer exists.");
    if (!projSnap.exists()) throw new Error("Project not found.");

    const previousComponentTotal = (compSnap.data().estimatedCostKobo as number) ?? 0;
    const nextComponentTotal = Math.max(0, previousComponentTotal + deltaKobo);
    const projectTotal = (projSnap.data().estimatedCostKobo as number) ?? 0;

    /*
     * The project moves by the *same* amount the component did.
     *
     * `nextComponentTotal` is floored at zero, so when the floor bites the component
     * moves by less than `deltaKobo`. Applying the raw delta to the project — or
     * deriving the project from the floored component — would let the two disagree
     * about the same estimate by the clamped remainder, with nothing recording it.
     * Taking the difference the component actually moved keeps them in step whether or
     * not the clamp engaged.
     *
     * The floor is not itself expected to fire: it exists because a stored total that
     * has already drifted must not be able to go negative, which would read as the
     * workshop owing the client money.
     */
    const appliedDelta = nextComponentTotal - previousComponentTotal;

    tx.update(compRef, { estimatedCostKobo: nextComponentTotal });
    tx.update(projRef, {
      estimatedCostKobo: Math.max(0, projectTotal + appliedDelta),
      updatedAt: serverTimestamp(),
      updatedBy: actor.uid,
    });
  });
}

export async function createAddon(
  db: Firestore,
  actor: AuditActor,
  projectId: string,
  componentId: string,
  input: NewAddon
): Promise<string> {
  if (!input.name.trim()) throw new Error("Name the addon.");
  if (!(input.quantity > 0)) throw new Error("Quantity must be greater than zero.");
  if (input.unitCostKobo < 0) throw new Error("A cost cannot be negative.");

  // Appended, so a new addon lands at the end of the component's list rather than
  // reordering what the client has already reviewed.
  const existing = await getDocs(collection(db, addonsPath(projectId, componentId)));
  const amountKobo = addonAmountKobo(input);
  const included = input.included ?? true;

  const ref = await addDoc(collection(db, addonsPath(projectId, componentId)), {
    name: input.name.trim(),
    category: input.category,
    brand: input.brand?.trim() || null,
    model: input.model?.trim() || null,
    supplier: input.supplier?.trim() || null,
    quantity: input.quantity,
    unitCostKobo: input.unitCostKobo,
    marginPercent: input.marginPercent ?? 0,
    amountKobo,
    order: existing.size,
    // Ticked by default, unlike a template feature: an addon is only ever added
    // because somebody decided this job needs it, so arriving unticked would mean
    // every addon had to be confirmed twice.
    included,
    notes: input.notes?.trim() || null,
    createdAt: serverTimestamp(),
    createdBy: actor.uid,
  });

  // The estimate has to move with it, or a ₦450,000 appliance sits on the component
  // and the project total says the job is worth what it was before.
  await applyAddonDelta(
    db,
    actor,
    projectId,
    componentId,
    included ? amountKobo : 0
  );

  await writeAudit(db, {
    actor,
    action: "create",
    collectionName: `${COL.projects}/${projectId}/components/${componentId}/addons`,
    docId: ref.id,
    summary: `Added ${input.quantity} × ${input.name.trim()} (${amountKobo} kobo) to a component`,
    after: { name: input.name.trim(), quantity: input.quantity, amountKobo, included },
  });

  return ref.id;
}

export async function updateAddon(
  db: Firestore,
  actor: AuditActor,
  projectId: string,
  componentId: string,
  addonId: string,
  input: NewAddon
): Promise<void> {
  if (!input.name.trim()) throw new Error("Name the addon.");
  if (!(input.quantity > 0)) throw new Error("Quantity must be greater than zero.");

  const ref = doc(db, addonsPath(projectId, componentId), addonId);
  const snap = await getDoc(ref);
  if (!snap.exists()) throw new Error("That addon no longer exists.");
  const prev = snap.data();

  const amountKobo = addonAmountKobo(input);
  const included = input.included ?? true;

  // What this row contributed before, and what it contributes now. An untick moves the
  // total down by the old amount even though the row itself survives.
  //
  // `isAddonIncluded` on the stored row, not `prev.included ?? true`: the before-figure
  // has to be what the rollup actually added, and for a row this code did not write —
  // an import with no flag and no price — that was nothing. Reading it as included
  // would subtract a contribution that was never made, taking real own-work value off
  // the component and the project with it.
  const before = isAddonIncluded(prev) ? ((prev.amountKobo as number) ?? 0) : 0;
  const after = included ? amountKobo : 0;

  await updateDoc(ref, {
    name: input.name.trim(),
    category: input.category,
    brand: input.brand?.trim() || null,
    model: input.model?.trim() || null,
    supplier: input.supplier?.trim() || null,
    quantity: input.quantity,
    unitCostKobo: input.unitCostKobo,
    marginPercent: input.marginPercent ?? 0,
    amountKobo,
    included,
    notes: input.notes?.trim() || null,
    updatedAt: serverTimestamp(),
    updatedBy: actor.uid,
  });

  await applyAddonDelta(db, actor, projectId, componentId, after - before);

  await writeAudit(db, {
    actor,
    action: "update",
    collectionName: `${COL.projects}/${projectId}/components/${componentId}/addons`,
    docId: addonId,
    summary:
      `Changed addon ${input.name.trim()}: ` +
      `${prev.amountKobo ?? 0} → ${amountKobo} kobo`,
    before: { amountKobo: prev.amountKobo ?? 0, quantity: prev.quantity ?? 0 },
    after: { amountKobo, quantity: input.quantity, included },
  });
}

export async function deleteAddon(
  db: Firestore,
  actor: AuditActor,
  projectId: string,
  componentId: string,
  addonId: string,
  name: string
): Promise<void> {
  const ref = doc(db, addonsPath(projectId, componentId), addonId);
  const snap = await getDoc(ref);
  if (!snap.exists()) return;
  const prev = snap.data();

  // Read before the delete, because afterwards there is nothing left to say what the
  // row was contributing — and a removal that does not reverse its contribution
  // leaves the estimate permanently overstated. Same rule as everywhere else, so what
  // is taken off is exactly what was put on.
  const contributed = isAddonIncluded(prev) ? ((prev.amountKobo as number) ?? 0) : 0;

  await deleteDoc(ref);
  await applyAddonDelta(db, actor, projectId, componentId, -contributed);

  await writeAudit(db, {
    actor,
    action: "delete",
    collectionName: `${COL.projects}/${projectId}/components/${componentId}/addons`,
    docId: addonId,
    summary: `Removed addon ${name} (${contributed} kobo off the estimate)`,
    before: { name, amountKobo: prev.amountKobo ?? 0 },
  });
}

/** Addons on a component, in display order. */
export async function loadAddons(
  db: Firestore,
  projectId: string,
  componentId: string
): Promise<ComponentAddon[]> {
  const snap = await getDocs(
    query(collection(db, addonsPath(projectId, componentId)), orderBy("order", "asc"))
  );
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }) as ComponentAddon);
}

/**
 * What the ticked addons on a component come to.
 *
 * Only the ticked ones, matching how features work: an addon listed but not included
 * is a suggestion the client turned down, and billing it would be wrong.
 */
export function addonsTotalKobo(addons: ComponentAddon[]): number {
  return sumKobo(addons.filter(isAddonIncluded).map((a) => a.amountKobo ?? 0));
}

// ---------------------------------------------------------------------------
// Project purchases
// ---------------------------------------------------------------------------

export interface NewProjectPurchase {
  item: string;
  category: ExpenseCategory;
  componentId?: string;
  componentName?: string;
  quantity: number;
  unit?: string;
  unitCostKobo: number;
  supplierId?: string;
  supplierName?: string;
  purchasedAt: Date;
  receiptUrl?: string;
  notes?: string;
}

/**
 * Records something bought against a project, and books it to the expense ledger.
 *
 * Booked in both places on purpose, and this is *not* double-counting: the expense
 * ledger is the company's single record of money paid out, while the project purchase
 * is the same money attributed to the job that consumed it. The link is the
 * `expenseId` stored on the purchase, plus `sourceCollection`/`sourceId` on the
 * expense — so the two can always be reconciled and neither can be counted twice by
 * anything reading them.
 *
 * The Profit & Loss report reads costs from the expense ledger only, for exactly this
 * reason. Per-project profit reads the purchases. Both see the same naira once.
 */
export async function recordProjectPurchase(
  db: Firestore,
  actor: AuditActor,
  projectId: string,
  projectNumber: string | undefined,
  input: NewProjectPurchase
): Promise<string> {
  if (!input.item.trim()) throw new Error("Name what was bought.");
  if (!(input.quantity > 0)) throw new Error("Quantity must be greater than zero.");
  if (input.unitCostKobo < 0) throw new Error("A cost cannot be negative.");

  const totalCostKobo = lineAmountKobo(input.quantity, input.unitCostKobo);
  if (totalCostKobo <= 0) throw new Error("A purchase must cost something.");

  /*
   * The expense and the purchase in one batch, so both land or neither does.
   *
   * Two sequential writes were not good enough. The purchase carries the expense's id
   * and `deleteProjectPurchase` uses it to reverse the pair, so a purchase written
   * without its expense — or an expense with no purchase pointing at it — is a cost
   * that can never be reconciled or removed. Batching removes the window entirely.
   *
   * Both refs are minted up front because each document has to know the other's id.
   */
  const expenseRef = doc(collection(db, COL.expenses));
  const ref = doc(collection(db, projectPurchasesPath(projectId)));

  const batch = writeBatch(db);

  batch.set(expenseRef, {
    date: Timestamp.fromDate(input.purchasedAt),
    payeeType: "vendor",
    payeeName: input.supplierName?.trim() || "Supplier",
    purpose:
      `${input.item.trim()} for ${projectNumber ?? "project"}` +
      (input.componentName ? ` (${input.componentName})` : ""),
    category: input.category,
    amountKobo: totalCostKobo,
    receiptUrl: input.receiptUrl ?? null,
    /*
     * The link back, which is what makes the two records reconcilable rather than
     * duplicates.
     *
     * `sourceId` is the *purchase* id, not the project's. Keying on the project would
     * make every purchase on it share one (sourceCollection, sourceId) pair, and
     * `recordPayrollExpense`'s idempotency guard keys on exactly that pair — so any
     * future code reusing that guard would treat the second purchase on a project as
     * already booked and silently drop it.
     */
    sourceCollection: `${COL.projects}/${projectId}/purchases`,
    sourceId: ref.id,
    projectId,
    createdAt: serverTimestamp(),
    createdBy: actor.uid,
  });

  batch.set(ref, {
    projectId,
    projectNumber: projectNumber ?? null,
    componentId: input.componentId ?? null,
    componentName: input.componentName ?? null,
    item: input.item.trim(),
    category: input.category,
    quantity: input.quantity,
    unit: input.unit?.trim() || null,
    unitCostKobo: input.unitCostKobo,
    totalCostKobo,
    supplierId: input.supplierId ?? null,
    supplierName: input.supplierName?.trim() || null,
    purchasedAt: Timestamp.fromDate(input.purchasedAt),
    receiptUrl: input.receiptUrl ?? null,
    expenseId: expenseRef.id,
    notes: input.notes?.trim() || null,
    createdAt: serverTimestamp(),
    createdBy: actor.uid,
  });

  await batch.commit();

  await writeAudit(db, {
    actor,
    action: "create",
    collectionName: `${COL.projects}/${projectId}/purchases`,
    docId: ref.id,
    summary:
      `Bought ${input.quantity} × ${input.item.trim()} for ` +
      `${projectNumber ?? "a project"}: ${totalCostKobo} kobo`,
    after: { item: input.item.trim(), totalCostKobo, expenseId: expenseRef.id },
  });

  return ref.id;
}

/**
 * Removes a project purchase and the expense it booked.
 *
 * Both, or the ledgers disagree: deleting the purchase alone would leave a cost in the
 * company books attributed to nothing, and deleting the expense alone would leave a
 * project cost that never happened. The expense is removed first so a failure leaves
 * the recoverable state — a purchase whose expense is already gone is visible as an
 * orphan, whereas the reverse silently understates costs.
 */
export async function deleteProjectPurchase(
  db: Firestore,
  actor: AuditActor,
  projectId: string,
  purchaseId: string
): Promise<void> {
  const ref = doc(db, projectPurchasesPath(projectId), purchaseId);
  const snap = await getDoc(ref);
  if (!snap.exists()) throw new Error("That purchase no longer exists.");
  const p = snap.data();

  // Both in one batch, matching how they were written: a purchase whose expense
  // survives leaves a cost in the books attributed to nothing, and an expense removed
  // without its purchase understates what the project cost.
  const batch = writeBatch(db);
  if (p.expenseId) batch.delete(doc(db, COL.expenses, p.expenseId as string));
  batch.delete(ref);
  await batch.commit();

  await writeAudit(db, {
    actor,
    action: "delete",
    collectionName: `${COL.projects}/${projectId}/purchases`,
    docId: purchaseId,
    summary:
      `Removed purchase ${p.item ?? ""} (${p.totalCostKobo ?? 0} kobo) and its expense entry`,
    before: { item: p.item ?? "", totalCostKobo: p.totalCostKobo ?? 0 },
  });
}

/** Purchases against a project, newest first. */
export async function loadProjectPurchases(
  db: Firestore,
  projectId: string
): Promise<ProjectPurchase[]> {
  const snap = await getDocs(
    query(collection(db, projectPurchasesPath(projectId)), orderBy("purchasedAt", "desc"))
  );
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }) as ProjectPurchase);
}

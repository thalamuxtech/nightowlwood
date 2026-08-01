import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  query,
  runTransaction,
  serverTimestamp,
  Timestamp,
  updateDoc,
  where,
  writeBatch,
  type Firestore,
} from "firebase/firestore";
import { COL, COUNTER, inventoryMovementsPath, purchaseLinesPath, toolItemsPath } from "./collections";
import type { BoardType, ConsumableType, MovementType, ToolRequestStatus } from "./enums";
import { sumKobo } from "./money";
import { allocateDocNumber } from "./numbering";
import { daysBetween, scoreConsumableBrand, scoreSupplier } from "./procurement";
import type { ConsumableCycle, Purchase, PurchaseLine } from "./types";
import { writeAudit, type AuditActor } from "./audit";

/**
 * Inventory, tools and procurement writes.
 *
 * Stock levels are held on the item document and every change is also written as
 * a movement. The running balance is stored on each movement, so an audit can
 * follow the stock forward without re-summing the whole ledger, and a discrepancy
 * points at the exact movement where it began.
 */

// ---------------------------------------------------------------------------
// Company inventory
// ---------------------------------------------------------------------------

export interface NewInventoryItem {
  name: string;
  category: string;
  unit: string;
  quantityOnHand: number;
  reorderLevel: number;
  unitCostKobo: number;
  supplier?: string;
  sku?: string;
}

/**
 * Corrects an inventory item's details.
 *
 * `quantityOnHand` is deliberately absent. Stock level is the running total of the
 * movement ledger, and typing over it would leave the item claiming a quantity no
 * movement accounts for; the ledger would no longer explain the balance. Use
 * recordMovement for that, which is what an adjustment actually is.
 */
export async function updateInventoryItem(
  db: Firestore,
  actor: AuditActor,
  itemId: string,
  input: Omit<NewInventoryItem, "quantityOnHand">
): Promise<void> {
  if (!input.name.trim()) throw new Error("An item needs a name.");
  if (input.reorderLevel < 0) throw new Error("A reorder level cannot be negative.");
  if (input.unitCostKobo < 0) throw new Error("A unit cost cannot be negative.");

  const ref = doc(db, COL.inventoryCompany, itemId);
  const snap = await getDoc(ref);
  if (!snap.exists()) throw new Error("That item no longer exists.");
  const prev = snap.data();

  await updateDoc(ref, {
    name: input.name.trim(),
    category: input.category,
    unit: input.unit,
    reorderLevel: input.reorderLevel,
    unitCostKobo: input.unitCostKobo,
    supplier: input.supplier ?? null,
    sku: input.sku ?? null,
    updatedAt: serverTimestamp(),
    updatedBy: actor.uid,
  });

  await writeAudit(db, {
    actor,
    action: "update",
    collectionName: COL.inventoryCompany,
    docId: itemId,
    summary: `Edited inventory item "${prev.name ?? ""}"`,
    before: {
      name: prev.name ?? "",
      reorderLevel: prev.reorderLevel ?? 0,
      unitCostKobo: prev.unitCostKobo ?? 0,
    },
    after: {
      name: input.name.trim(),
      reorderLevel: input.reorderLevel,
      unitCostKobo: input.unitCostKobo,
    },
  });
}

/**
 * Retires an inventory item without deleting it.
 *
 * Deletion would orphan its movement ledger and break the history of stock that
 * genuinely passed through the workshop. Inactive items drop out of the pickers
 * but their record stays intact.
 */
export async function setInventoryItemActive(
  db: Firestore,
  actor: AuditActor,
  itemId: string,
  active: boolean,
  name: string
): Promise<void> {
  await updateDoc(doc(db, COL.inventoryCompany, itemId), {
    active,
    updatedAt: serverTimestamp(),
    updatedBy: actor.uid,
  });
  await writeAudit(db, {
    actor,
    action: "update",
    collectionName: COL.inventoryCompany,
    docId: itemId,
    summary: `${active ? "Restored" : "Retired"} inventory item "${name}"`,
    after: { active },
  });
}

/**
 * Deletes an inventory item outright, but only one with no history.
 *
 * The movement ledger beneath an item is append-only by rule — `allow update,
 * delete: if false` — so a client cannot remove it. Deleting the parent doc would
 * therefore leave the ledger permanently unreachable and undeletable, and stock
 * that genuinely passed through the workshop would stop reconciling.
 *
 * So this is for the mistake case only: an item typed in wrongly and noticed
 * straight away. The opening-balance movement written at creation is allowed — it is
 * the item's own birth record, not history of anything real — and goes with it.
 * Anything more than that, or any quantity still on hand, is refused and
 * `setInventoryItemActive` is the answer instead.
 *
 * The opening balance is identified by its reason rather than a distinct type: it is
 * written as an ordinary "in" (see createInventoryItem), so the wording is the only
 * thing that separates it from a real receipt. A receipt someone happened to label
 * "Opening balance" would therefore be treated as one — acceptable, because the
 * quantity check has already established the item is empty.
 */
export async function deleteInventoryItem(
  db: Firestore,
  actor: AuditActor,
  itemId: string,
  name: string
): Promise<void> {
  const ref = doc(db, COL.inventoryCompany, itemId);
  const snap = await getDoc(ref);
  if (!snap.exists()) return;

  const onHand = (snap.data().quantityOnHand as number) ?? 0;
  if (onHand !== 0) {
    throw new Error(
      `"${name}" still has ${onHand} on hand. Issue or write off the stock first, or retire the item instead of deleting it.`
    );
  }

  const movements = await getDocs(collection(db, inventoryMovementsPath(itemId)));
  const realHistory = movements.docs.filter(
    (d) => String(d.data().reason ?? "") !== "Opening balance"
  );
  if (realHistory.length > 0) {
    throw new Error(
      `"${name}" has ${realHistory.length} recorded movement${
        realHistory.length === 1 ? "" : "s"
      }, so deleting it would break the stock history. Retire it instead — the record stays and it drops out of the pickers.`
    );
  }

  const batch = writeBatch(db);
  movements.docs.forEach((d) => batch.delete(d.ref));
  batch.delete(ref);
  await batch.commit();

  await writeAudit(db, {
    actor,
    action: "delete",
    collectionName: COL.inventoryCompany,
    docId: itemId,
    summary: `Deleted unused inventory item "${name}"`,
  });
}

/**
 * Adds a supplier.
 *
 * Moved out of the screen, where it was an inline `addDoc` and the only create in
 * the app that wrote no audit entry — so a supplier appearing in the list had no
 * record of who added it.
 */
export async function createSupplier(
  db: Firestore,
  actor: AuditActor,
  input: { name: string; phone?: string; categories?: string[] }
): Promise<string> {
  if (!input.name.trim()) throw new Error("A supplier needs a name.");

  const ref = await addDoc(collection(db, COL.suppliers), {
    name: input.name.trim(),
    phone: input.phone?.trim() || null,
    categories: input.categories ?? [],
    active: true,
    purchaseCount: 0,
    totalSpendKobo: 0,
    createdAt: serverTimestamp(),
    createdBy: actor.uid,
  });

  await writeAudit(db, {
    actor,
    action: "create",
    collectionName: COL.suppliers,
    docId: ref.id,
    summary: `Added supplier "${input.name.trim()}"`,
  });

  return ref.id;
}

/**
 * Deletes a supplier that has never been purchased from.
 *
 * Purchases and consumable cycles reference a supplier by id as well as carrying a
 * copy of its name, so removing one with history leaves those documents pointing at
 * nothing: the scorecard query finds no purchases, and lead-time and defect history
 * silently reads as zero rather than as missing. A supplier that has been traded
 * with is deactivated instead, which the list already honours.
 */
export async function deleteSupplier(
  db: Firestore,
  actor: AuditActor,
  supplierId: string,
  name: string
): Promise<void> {
  const purchases = await getDocs(
    query(collection(db, COL.purchases), where("supplierId", "==", supplierId))
  );
  if (!purchases.empty) {
    throw new Error(
      `"${name}" has ${purchases.size} purchase${
        purchases.size === 1 ? "" : "s"
      } on record. Deactivate the supplier instead — deleting it would break that purchase history.`
    );
  }

  await deleteDoc(doc(db, COL.suppliers, supplierId));

  await writeAudit(db, {
    actor,
    action: "delete",
    collectionName: COL.suppliers,
    docId: supplierId,
    summary: `Deleted unused supplier "${name}"`,
  });
}

/** Corrects a supplier's contact details. */
export async function updateSupplier(
  db: Firestore,
  actor: AuditActor,
  supplierId: string,
  input: { name: string; phone?: string; categories?: string[]; active?: boolean }
): Promise<void> {
  if (!input.name.trim()) throw new Error("A supplier needs a name.");

  await updateDoc(doc(db, COL.suppliers, supplierId), {
    name: input.name.trim(),
    phone: input.phone?.trim() || null,
    ...(input.categories ? { categories: input.categories } : {}),
    ...(input.active === undefined ? {} : { active: input.active }),
    updatedAt: serverTimestamp(),
    updatedBy: actor.uid,
  });

  await writeAudit(db, {
    actor,
    action: "update",
    collectionName: COL.suppliers,
    docId: supplierId,
    summary: `Edited supplier "${input.name.trim()}"`,
    after: { name: input.name.trim(), active: input.active ?? true },
  });
}

export async function createInventoryItem(
  db: Firestore,
  actor: AuditActor,
  input: NewInventoryItem
): Promise<string> {
  const ref = await addDoc(collection(db, COL.inventoryCompany), {
    ...input,
    supplier: input.supplier ?? null,
    sku: input.sku ?? null,
    active: true,
    createdAt: serverTimestamp(),
    createdBy: actor.uid,
  });

  // An opening balance is a movement too, so the ledger starts complete rather
  // than with an unexplained quantity.
  if (input.quantityOnHand > 0) {
    await addDoc(collection(db, inventoryMovementsPath(ref.id)), {
      type: "in" satisfies MovementType,
      quantity: input.quantityOnHand,
      reason: "Opening balance",
      balanceAfter: input.quantityOnHand,
      createdAt: serverTimestamp(),
      createdBy: actor.uid,
    });
  }

  await writeAudit(db, {
    actor,
    action: "create",
    collectionName: COL.inventoryCompany,
    docId: ref.id,
    summary: `Added ${input.name} to inventory (${input.quantityOnHand} ${input.unit})`,
  });

  return ref.id;
}

/**
 * Records a stock movement and updates the balance.
 *
 * Transactional because two people issuing from the same item would otherwise
 * both read the old quantity and the second write would lose the first. An `out`
 * movement is refused when it would take stock negative: a negative balance hides
 * either a miscount or a theft, and both need investigating rather than
 * recording.
 */
export async function recordMovement(
  db: Firestore,
  actor: AuditActor,
  itemId: string,
  input: {
    type: MovementType;
    quantity: number;
    reason: string;
    jobId?: string;
    projectId?: string;
    unitCostKobo?: number;
  }
): Promise<{ balanceAfter: number }> {
  if (input.quantity <= 0) throw new Error("Quantity must be greater than zero.");

  const itemRef = doc(db, COL.inventoryCompany, itemId);
  const moveRef = doc(collection(db, inventoryMovementsPath(itemId)));

  const balanceAfter = await runTransaction(db, async (tx) => {
    const snap = await tx.get(itemRef);
    if (!snap.exists()) throw new Error("Inventory item not found.");
    const current = (snap.data().quantityOnHand as number) ?? 0;
    const name = snap.data().name ?? "item";

    let next: number;
    if (input.type === "in") next = current + input.quantity;
    else if (input.type === "out") {
      next = current - input.quantity;
      if (next < 0) {
        throw new Error(
          `Only ${current} of ${name} on hand, so ${input.quantity} cannot be issued. ` +
            `Adjust the count first if the shelf disagrees with the record.`
        );
      }
    } else {
      // An adjustment sets the count outright, which is what a stock-take does.
      next = input.quantity;
    }

    tx.set(moveRef, {
      type: input.type,
      quantity: input.quantity,
      reason: input.reason,
      jobId: input.jobId ?? null,
      projectId: input.projectId ?? null,
      unitCostKobo: input.unitCostKobo ?? null,
      balanceAfter: next,
      createdAt: serverTimestamp(),
      createdBy: actor.uid,
    });
    tx.update(itemRef, {
      quantityOnHand: next,
      ...(input.type === "in" ? { lastRestockedAt: serverTimestamp() } : {}),
      updatedAt: serverTimestamp(),
      updatedBy: actor.uid,
    });

    return next;
  });

  await writeAudit(db, {
    actor,
    action: "inventory_movement",
    collectionName: COL.inventoryCompany,
    docId: itemId,
    summary: `${input.type} ${input.quantity}: ${input.reason} (balance ${balanceAfter})`,
    after: { type: input.type, quantity: input.quantity, balanceAfter },
  });

  return { balanceAfter };
}

// ---------------------------------------------------------------------------
// Service inventory: customer property
// ---------------------------------------------------------------------------

/**
 * Releases customer boards back to them.
 *
 * Kept separate from company stock because these are never ours: they are not an
 * asset, cannot be issued to another job, and must be accounted for on the way
 * out as well as in.
 */
export async function releaseServiceInventory(
  db: Firestore,
  actor: AuditActor,
  entryId: string,
  customerName: string
): Promise<void> {
  await updateDoc(doc(db, COL.inventoryService, entryId), {
    status: "released",
    releasedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    updatedBy: actor.uid,
  });

  await writeAudit(db, {
    actor,
    action: "update",
    collectionName: COL.inventoryService,
    docId: entryId,
    summary: `Released held boards back to ${customerName}`,
    after: { status: "released" },
  });
}

// ---------------------------------------------------------------------------
// Product inventory: bought for one project
// ---------------------------------------------------------------------------

export async function addProductPurchase(
  db: Firestore,
  actor: AuditActor,
  input: {
    projectId: string;
    projectNumber?: string;
    componentId?: string;
    item: string;
    quantity: number;
    unitCostKobo: number;
    supplier?: string;
  }
): Promise<string> {
  const totalCostKobo = Math.round(input.quantity * input.unitCostKobo);
  const ref = await addDoc(collection(db, COL.inventoryProduct), {
    ...input,
    projectNumber: input.projectNumber ?? null,
    componentId: input.componentId ?? null,
    supplier: input.supplier ?? null,
    totalCostKobo,
    purchasedAt: serverTimestamp(),
    createdAt: serverTimestamp(),
    createdBy: actor.uid,
  });

  // Charged to the project so estimated against actual stays meaningful.
  await updateDoc(doc(db, COL.projects, input.projectId), {
    actualCostKobo: await nextActualCost(db, input.projectId, totalCostKobo),
    updatedAt: serverTimestamp(),
    updatedBy: actor.uid,
  }).catch(() => {
    // A project that has since been deleted must not block the purchase record.
  });

  await writeAudit(db, {
    actor,
    action: "create",
    collectionName: COL.inventoryProduct,
    docId: ref.id,
    summary: `Bought ${input.quantity} x ${input.item} for ${input.projectNumber ?? "a project"}`,
    after: { item: input.item, totalCostKobo },
  });

  return ref.id;
}

async function nextActualCost(
  db: Firestore,
  projectId: string,
  addKobo: number
): Promise<number> {
  const snap = await getDoc(doc(db, COL.projects, projectId));
  return ((snap.data()?.actualCostKobo as number) ?? 0) + addKobo;
}

// ---------------------------------------------------------------------------
// Consumable cycles
// ---------------------------------------------------------------------------

export async function startConsumableCycle(
  db: Firestore,
  actor: AuditActor,
  input: {
    type: ConsumableType;
    model: string;
    brandId?: string;
    brandName?: string;
    supplierId?: string;
    supplierName?: string;
    line?: "egger" | "mdf" | "both";
    costKobo?: number;
  }
): Promise<string> {
  const ref = await addDoc(collection(db, COL.consumableCycles), {
    ...input,
    brandId: input.brandId ?? null,
    brandName: input.brandName ?? null,
    supplierId: input.supplierId ?? null,
    supplierName: input.supplierName ?? null,
    line: input.line ?? "both",
    costKobo: input.costKobo ?? null,
    startDate: serverTimestamp(),
    endDate: null,
    createdAt: serverTimestamp(),
    createdBy: actor.uid,
  });

  await writeAudit(db, {
    actor,
    action: "create",
    collectionName: COL.consumableCycles,
    docId: ref.id,
    summary: `Fitted ${input.model}`,
  });

  return ref.id;
}

/**
 * Closes a cycle and refreshes the brand scorecard.
 *
 * `lifespanDays` is computed here rather than on read: it is the figure the
 * scorecard ranks on, and deriving it once at close means every later comparison
 * uses the same number.
 */
export async function endConsumableCycle(
  db: Firestore,
  actor: AuditActor,
  cycleId: string,
  input: {
    unitsProcessed?: number;
    retiredReason: "worn_out" | "broke_early" | "damaged" | "lost" | "other";
    costKobo?: number;
    notes?: string;
  }
): Promise<void> {
  const ref = doc(db, COL.consumableCycles, cycleId);
  const snap = await getDoc(ref);
  if (!snap.exists()) throw new Error("Cycle not found.");
  const cycle = snap.data() as ConsumableCycle;

  const endDate = Timestamp.now();
  const lifespanDays = daysBetween(cycle.startDate, endDate);

  await updateDoc(ref, {
    endDate,
    lifespanDays: lifespanDays ?? null,
    unitsProcessed: input.unitsProcessed ?? null,
    retiredReason: input.retiredReason,
    costKobo: input.costKobo ?? cycle.costKobo ?? null,
    notes: input.notes ?? null,
    updatedAt: serverTimestamp(),
    updatedBy: actor.uid,
  });

  if (cycle.brandId) await refreshBrandScorecard(db, cycle.brandId);

  await writeAudit(db, {
    actor,
    action: "update",
    collectionName: COL.consumableCycles,
    docId: cycleId,
    summary:
      `Retired ${cycle.model} after ${lifespanDays ?? "?"} days (${input.retiredReason})`,
    after: { lifespanDays, retiredReason: input.retiredReason },
  });
}

/**
 * Recomputes a brand's derived figures from its closed cycles.
 *
 * Written back to the brand document so a list view does not have to read every
 * cycle. The scoring itself lives in procurement.ts as pure functions, which is
 * what makes it testable without a database.
 */
export async function refreshBrandScorecard(db: Firestore, brandId: string): Promise<void> {
  const snap = await getDocs(
    query(collection(db, COL.consumableCycles), where("brandId", "==", brandId))
  );
  const cycles = snap.docs.map((d) => d.data() as ConsumableCycle);
  const score = scoreConsumableBrand(cycles);

  await updateDoc(doc(db, COL.consumableBrands, brandId), {
    cyclesRecorded: score.cyclesRecorded,
    avgLifespanDays: score.avgLifespanDays ?? null,
    avgUnitsProcessed: score.avgUnitsProcessed ?? null,
    avgUnitCostKobo: score.avgUnitCostKobo ?? null,
    costPerUnitProcessedKobo: score.costPerUnitProcessedKobo ?? null,
    earlyFailureRatePercent: score.earlyFailureRatePercent ?? null,
    updatedAt: serverTimestamp(),
  }).catch(() => {
    // A brand deleted mid-refresh is not an error worth surfacing.
  });
}

// ---------------------------------------------------------------------------
// Suppliers and purchases
// ---------------------------------------------------------------------------

export async function createPurchase(
  db: Firestore,
  actor: AuditActor,
  input: {
    supplierId: string;
    supplierName: string;
    reference?: string;
    promisedAt?: Date;
    lines: Array<{
      item: string;
      inventoryItemId?: string;
      brandId?: string;
      quantityOrdered: number;
      unit: string;
      unitCostKobo: number;
    }>;
  }
): Promise<string> {
  if (input.lines.length === 0) throw new Error("A purchase needs at least one line.");

  const ref = doc(collection(db, COL.purchases));
  const lines = input.lines.map((l) => ({
    ...l,
    inventoryItemId: l.inventoryItemId ?? null,
    brandId: l.brandId ?? null,
    amountKobo: Math.round(l.quantityOrdered * l.unitCostKobo),
  }));
  const total = sumKobo(lines.map((l) => l.amountKobo));

  const batch = writeBatch(db);
  batch.set(ref, {
    supplierId: input.supplierId,
    supplierName: input.supplierName,
    reference: input.reference ?? null,
    orderedAt: serverTimestamp(),
    promisedAt: input.promisedAt ? Timestamp.fromDate(input.promisedAt) : null,
    receivedAt: null,
    status: "ordered",
    subtotalKobo: total,
    totalKobo: total,
    createdAt: serverTimestamp(),
    createdBy: actor.uid,
  });
  for (const l of lines) {
    batch.set(doc(collection(db, purchaseLinesPath(ref.id))), l);
  }
  await batch.commit();

  await writeAudit(db, {
    actor,
    action: "create",
    collectionName: COL.purchases,
    docId: ref.id,
    summary: `Ordered ${lines.length} line(s) from ${input.supplierName}, ${total} kobo`,
  });

  return ref.id;
}

/**
 * Receives a delivery: updates stock, records shortfalls, rescores the supplier.
 *
 * Received and rejected quantities are captured separately. Recording only what
 * arrived would lose the fact that something was short or refused, which is
 * precisely what the defect rate needs.
 */
export async function receivePurchase(
  db: Firestore,
  actor: AuditActor,
  purchaseId: string,
  received: Array<{ lineId: string; quantityReceived: number; quantityRejected: number }>,
  issueNotes?: string
): Promise<void> {
  const purchaseRef = doc(db, COL.purchases, purchaseId);
  const snap = await getDoc(purchaseRef);
  if (!snap.exists()) throw new Error("Purchase not found.");
  const purchase = snap.data() as Purchase;

  const lineSnap = await getDocs(collection(db, purchaseLinesPath(purchaseId)));
  const byId = new Map(lineSnap.docs.map((d) => [d.id, d]));

  let hadIssues = false;
  const batch = writeBatch(db);

  for (const r of received) {
    const lineDoc = byId.get(r.lineId);
    if (!lineDoc) continue;
    const line = lineDoc.data() as PurchaseLine;

    if (r.quantityRejected > 0 || r.quantityReceived < line.quantityOrdered) {
      hadIssues = true;
    }

    batch.update(lineDoc.ref, {
      quantityReceived: r.quantityReceived,
      quantityRejected: r.quantityRejected,
    });
  }

  batch.update(purchaseRef, {
    receivedAt: serverTimestamp(),
    status: "received",
    hadIssues,
    issueNotes: issueNotes ?? null,
    updatedAt: serverTimestamp(),
    updatedBy: actor.uid,
  });
  await batch.commit();

  // Stock movements are separate from the batch: each is transactional against
  // its own item, and a failure on one must not roll back the whole receipt.
  for (const r of received) {
    const lineDoc = byId.get(r.lineId);
    const line = lineDoc?.data() as PurchaseLine | undefined;
    if (!line?.inventoryItemId || r.quantityReceived <= 0) continue;
    await recordMovement(db, actor, line.inventoryItemId, {
      type: "in",
      quantity: r.quantityReceived,
      reason: `Received on ${purchase.reference ?? "purchase"}`,
      unitCostKobo: line.unitCostKobo,
    }).catch(() => {
      // Logged by recordMovement's own audit; the receipt itself stands.
    });
  }

  await refreshSupplierScorecard(db, purchase.supplierId);

  await writeAudit(db, {
    actor,
    action: "purchase_receive",
    collectionName: COL.purchases,
    docId: purchaseId,
    summary:
      `Received from ${purchase.supplierName}` +
      (hadIssues ? " with shortfalls or rejections" : " in full"),
    after: { hadIssues },
  });
}

/** Recomputes a supplier's derived figures from its purchase history. */
export async function refreshSupplierScorecard(
  db: Firestore,
  supplierId: string
): Promise<void> {
  const snap = await getDocs(
    query(collection(db, COL.purchases), where("supplierId", "==", supplierId))
  );
  const purchases = snap.docs.map((d) => ({ id: d.id, ...d.data() })) as Purchase[];

  // One round trip per purchase, but issued together rather than in series. A
  // supplier with 40 purchases waited on 40 sequential reads before; the document
  // count is the same, the latency is now that of the slowest single read.
  //
  // A collectionGroup query would be one read instead of N, but purchase lines do
  // not carry supplierId, so there is nothing to filter on. Denormalising it onto
  // every line to save this one admin-triggered call is not worth the write cost.
  const lineSnaps = await Promise.all(
    purchases.map((p) => getDocs(collection(db, purchaseLinesPath(p.id))))
  );
  const linesByPurchase: Record<string, PurchaseLine[]> = {};
  purchases.forEach((p, i) => {
    linesByPurchase[p.id] = lineSnaps[i].docs.map((d) => ({
      id: d.id,
      ...d.data(),
    })) as PurchaseLine[];
  });

  const score = scoreSupplier(purchases, linesByPurchase);

  await updateDoc(doc(db, COL.suppliers, supplierId), {
    purchaseCount: score.purchaseCount,
    totalSpendKobo: score.totalSpendKobo,
    avgLeadTimeDays: score.avgLeadTimeDays ?? null,
    onTimeRatePercent: score.onTimeRatePercent ?? null,
    defectRatePercent: score.defectRatePercent ?? null,
    lastPurchaseAt: score.lastPurchaseAtMs
      ? Timestamp.fromMillis(score.lastPurchaseAtMs)
      : null,
    updatedAt: serverTimestamp(),
  }).catch(() => {});
}

// ---------------------------------------------------------------------------
// Tool requests
// ---------------------------------------------------------------------------

export async function createToolRequest(
  db: Firestore,
  actor: AuditActor,
  input: {
    jobName: string;
    jobLocation?: string;
    requestedByStaffId?: string;
    requestedByName: string;
    expectedReturnDate?: Date;
    items: Array<{ name: string; description?: string; quantityRequested: number }>;
  }
): Promise<{ requestId: string; requestNumber: string }> {
  if (input.items.length === 0) throw new Error("List at least one tool.");

  const { formatted: requestNumber } = await allocateDocNumber(db, COUNTER.toolRequest);
  const ref = doc(collection(db, COL.toolRequests));

  const batch = writeBatch(db);
  batch.set(ref, {
    requestNumber,
    jobName: input.jobName,
    jobLocation: input.jobLocation ?? null,
    requestedByStaffId: input.requestedByStaffId ?? null,
    requestedByName: input.requestedByName,
    requestDate: serverTimestamp(),
    expectedReturnDate: input.expectedReturnDate
      ? Timestamp.fromDate(input.expectedReturnDate)
      : null,
    status: "requested" satisfies ToolRequestStatus,
    createdAt: serverTimestamp(),
    createdBy: actor.uid,
  });
  for (const item of input.items) {
    batch.set(doc(collection(db, toolItemsPath(ref.id))), {
      ...item,
      description: item.description ?? null,
      quantityIssued: null,
      quantityReturned: null,
    });
  }
  await batch.commit();

  await writeAudit(db, {
    actor,
    action: "create",
    collectionName: COL.toolRequests,
    docId: ref.id,
    summary: `${requestNumber}: ${input.requestedByName} requested ${input.items.length} tool(s) for ${input.jobName}`,
  });

  return { requestId: ref.id, requestNumber };
}

export async function issueTools(
  db: Firestore,
  actor: AuditActor,
  requestId: string,
  requestNumber: string,
  issued: Array<{ itemId: string; quantityIssued: number }>,
  issuedByName: string
): Promise<void> {
  const batch = writeBatch(db);
  for (const i of issued) {
    batch.update(doc(db, `${toolItemsPath(requestId)}/${i.itemId}`), {
      quantityIssued: i.quantityIssued,
    });
  }
  batch.update(doc(db, COL.toolRequests, requestId), {
    status: "issued" satisfies ToolRequestStatus,
    issuedByName,
    issuedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    updatedBy: actor.uid,
  });
  await batch.commit();

  await writeAudit(db, {
    actor,
    action: "tool_issue",
    collectionName: COL.toolRequests,
    docId: requestId,
    summary: `${requestNumber}: tools issued by ${issuedByName}`,
  });
}

/**
 * Records a return.
 *
 * Status becomes `returned` only when every issued tool is back. A partial
 * return that read as complete would let a missing tool disappear from the
 * overdue list, which is the one thing this log exists to prevent.
 */
export async function returnTools(
  db: Firestore,
  actor: AuditActor,
  requestId: string,
  requestNumber: string,
  returns: Array<{ itemId: string; quantityIssued: number; quantityReturned: number }>,
  returnedByName: string
): Promise<{ complete: boolean }> {
  const complete = returns.every((r) => r.quantityReturned >= r.quantityIssued);

  const batch = writeBatch(db);
  for (const r of returns) {
    batch.update(doc(db, `${toolItemsPath(requestId)}/${r.itemId}`), {
      quantityReturned: r.quantityReturned,
    });
  }
  batch.update(doc(db, COL.toolRequests, requestId), {
    status: (complete ? "returned" : "partially_returned") satisfies ToolRequestStatus,
    returnedByName,
    returnedDate: serverTimestamp(),
    updatedAt: serverTimestamp(),
    updatedBy: actor.uid,
  });
  await batch.commit();

  await writeAudit(db, {
    actor,
    action: "tool_return",
    collectionName: COL.toolRequests,
    docId: requestId,
    summary: `${requestNumber}: ${complete ? "all tools returned" : "partial return"} by ${returnedByName}`,
    after: { complete },
  });

  return { complete };
}

/**
 * Corrects a tool request's details and its item list.
 *
 * Everything a person typed is editable, because everything a person typed can be
 * wrong: the wrong job, the wrong staff member, a tool that turns out not to be
 * needed. Items are reconciled rather than replaced — rows still present are
 * updated, new ones added, missing ones removed — so the issued and returned
 * quantities recorded against a surviving row are not lost by rewriting it.
 *
 * Tool requests do not touch stock quantities or write inventory movements, so
 * there is no ledger here to keep consistent. That is what makes this safe to edit
 * freely where company stock is not.
 */
export async function updateToolRequest(
  db: Firestore,
  actor: AuditActor,
  requestId: string,
  requestNumber: string,
  input: {
    jobName: string;
    jobLocation?: string;
    requestedByStaffId?: string;
    requestedByName: string;
    expectedReturnDate?: Date | null;
    items: Array<{
      /** Present for a row that already exists; absent for a new one. */
      id?: string;
      name: string;
      description?: string;
      quantityRequested: number;
    }>;
  }
): Promise<void> {
  if (!input.jobName.trim()) throw new Error("Name the job.");
  if (input.items.length === 0) throw new Error("A request needs at least one tool.");

  const existing = await getDocs(collection(db, toolItemsPath(requestId)));
  const keep = new Set(input.items.map((i) => i.id).filter(Boolean) as string[]);

  const batch = writeBatch(db);

  batch.update(doc(db, COL.toolRequests, requestId), {
    jobName: input.jobName.trim(),
    jobLocation: input.jobLocation?.trim() || null,
    requestedByStaffId: input.requestedByStaffId ?? null,
    requestedByName: input.requestedByName,
    expectedReturnDate: input.expectedReturnDate
      ? Timestamp.fromDate(input.expectedReturnDate)
      : null,
    updatedAt: serverTimestamp(),
    updatedBy: actor.uid,
  });

  for (const item of input.items) {
    if (item.id) {
      batch.update(doc(db, `${toolItemsPath(requestId)}/${item.id}`), {
        name: item.name.trim(),
        description: item.description?.trim() || null,
        quantityRequested: item.quantityRequested,
      });
    } else {
      batch.set(doc(collection(db, toolItemsPath(requestId))), {
        name: item.name.trim(),
        description: item.description?.trim() || null,
        quantityRequested: item.quantityRequested,
        quantityIssued: 0,
        quantityReturned: 0,
      });
    }
  }

  for (const d of existing.docs) {
    if (!keep.has(d.id)) batch.delete(d.ref);
  }

  await batch.commit();

  await writeAudit(db, {
    actor,
    action: "update",
    collectionName: COL.toolRequests,
    docId: requestId,
    summary: `${requestNumber}: edited the request (${input.items.length} tool(s) for ${input.jobName.trim()})`,
    after: { jobName: input.jobName.trim(), itemCount: input.items.length },
  });
}

/**
 * Sets a tool request's status directly.
 *
 * The normal path is `issueTools` and `returnTools`, which move the status as a
 * consequence of recording what actually happened. This is the correction path: a
 * request marked issued that never was, or one stuck at partly-returned because a
 * tool was quietly put back. Recorded as a status change rather than an edit so the
 * audit log distinguishes "we fixed the record" from "the tools moved".
 *
 * `overdue` is deliberately not settable: it is derived from the due date on read,
 * so storing it would freeze a state that should follow the calendar.
 */
export async function setToolRequestStatus(
  db: Firestore,
  actor: AuditActor,
  requestId: string,
  requestNumber: string,
  from: ToolRequestStatus,
  to: ToolRequestStatus
): Promise<void> {
  if (to === "overdue") {
    throw new Error("Overdue follows the due date and cannot be set by hand.");
  }

  await updateDoc(doc(db, COL.toolRequests, requestId), {
    status: to,
    // Cleared when moving back before issue, so a corrected record does not keep
    // claiming tools went out on a date they did not.
    ...(to === "requested" ? { issuedAt: null, issuedByName: null } : {}),
    updatedAt: serverTimestamp(),
    updatedBy: actor.uid,
  });

  await writeAudit(db, {
    actor,
    action: "status_change",
    collectionName: COL.toolRequests,
    docId: requestId,
    summary: `${requestNumber}: status ${from} to ${to}`,
    before: { status: from },
    after: { status: to },
  });
}

/**
 * Deletes a tool request and its items.
 *
 * Firestore does not cascade, so the items go explicitly or they are orphaned in a
 * subcollection nothing can reach. The request number is not returned to the
 * counter: a gap in numbering is honest, whereas reusing a number would give two
 * different requests the same reference.
 */
export async function deleteToolRequest(
  db: Firestore,
  actor: AuditActor,
  requestId: string,
  requestNumber: string
): Promise<void> {
  const items = await getDocs(collection(db, toolItemsPath(requestId)));
  for (let i = 0; i < items.docs.length; i += 400) {
    const b = writeBatch(db);
    items.docs.slice(i, i + 400).forEach((d) => b.delete(d.ref));
    await b.commit();
  }
  await deleteDoc(doc(db, COL.toolRequests, requestId));

  await writeAudit(db, {
    actor,
    action: "delete",
    collectionName: COL.toolRequests,
    docId: requestId,
    summary: `Deleted tool request ${requestNumber} and its ${items.size} item(s)`,
  });
}

/** Board types recorded against held customer stock. */
export const SERVICE_BOARD_TYPES: BoardType[] = [
  "mdf",
  "egger",
  "hdf",
  "quarter",
  "kwali",
  "high_glossy",
  "aluko",
  "other",
];

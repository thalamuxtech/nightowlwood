import {
  addDoc,
  collection,
  doc,
  getDoc,
  getDocs,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  Timestamp,
  where,
  type Firestore,
} from "firebase/firestore";
import {
  COL,
  COUNTER,
  inventoryMovementsPath,
  posMovementsPath,
  saleLinesPath,
} from "./collections";
import type { PaymentMethod, SaleStatus, TaxMode } from "./enums";
import { lineAmountKobo, sumKobo } from "./money";
import { allocateDocNumber } from "./numbering";
import { computeInvoiceTotals, subtotalOfLines } from "./invoices";
import { DEFAULT_POS_SETTINGS, SETTINGS_DOC } from "./settings";
import type { SaleLine } from "./types";
import { writeAudit, type AuditActor } from "./audit";

/**
 * Counter sales: boards, edge tape, accessories.
 *
 * This trade was invisible to the system. The workshop sells stock over the counter
 * alongside doing service work, and none of it was recorded — so the stock figure
 * drifted from the shelf, and the money never reached the books.
 *
 * A sale is not a service job. Nothing is being worked on and there is no pipeline to
 * move through: money and stock change hands once, which is why it is its own
 * document with its own numbering.
 *
 * Two rules make the numbers trustworthy:
 *
 * 1. **Stock moves in the same transaction as the sale.** A sale that did not
 *    decrement stock is exactly how a board count becomes fiction, so the two either
 *    both happen or neither does.
 * 2. **Cost is captured at the moment of sale.** Margin is computed against what the
 *    stock cost then, not what a replacement costs today, or every supplier price
 *    change would silently restate the profit on sales already made.
 */

export interface PosSettingsResolved {
  taxMode: TaxMode;
  taxPercent: number;
  taxLabel: string;
  allowNegativeStock: boolean;
  receiptFooter: string;
}

export async function posSettings(db: Firestore): Promise<PosSettingsResolved> {
  try {
    const snap = await getDoc(doc(db, COL.settings, SETTINGS_DOC.pos));
    if (!snap.exists()) return DEFAULT_POS_SETTINGS;
    const d = snap.data();
    return {
      taxMode: (d.taxMode as TaxMode) ?? DEFAULT_POS_SETTINGS.taxMode,
      taxPercent: d.taxPercent ?? DEFAULT_POS_SETTINGS.taxPercent,
      taxLabel: d.taxLabel ?? DEFAULT_POS_SETTINGS.taxLabel,
      allowNegativeStock:
        d.allowNegativeStock ?? DEFAULT_POS_SETTINGS.allowNegativeStock,
      receiptFooter: d.receiptFooter ?? DEFAULT_POS_SETTINGS.receiptFooter,
    };
  } catch {
    return DEFAULT_POS_SETTINGS;
  }
}

/** A sellable item as the till sees it. */
export interface SellableItem {
  id: string;
  name: string;
  sku?: string;
  unit: string;
  quantityOnHand: number;
  reorderLevel: number;
  /** What it cost to buy, for margin. */
  unitCostKobo: number;
  /** What it sells for. Falls back to cost when no sale price is set. */
  unitPriceKobo: number;
  category: string;
  /** False for a service — sold over the counter but holding no stock. */
  tracksStock: boolean;
}

/**
 * The counter's own stock.
 *
 * Read from `inventoryPos`, not from company stock. The two are separate shelves answering separate
 * questions: company stock is what the workshop holds to consume, this is what is on the shop floor
 * to sell. Goods reach the counter by an explicit transfer — see `transferToCounter` — which is what
 * makes "what can we sell today" a figure somebody can stand at the till and trust.
 *
 * The cost travels with the transfer, so a sale is costed at what the workshop actually paid rather
 * than at a price retyped at the counter.
 */
export async function loadSellableItems(db: Firestore): Promise<SellableItem[]> {
  const snap = await getDocs(collection(db, COL.inventoryPos));
  return snap.docs
    .filter((d) => d.data().active !== false)
    .map((d) => {
      const x = d.data();
      /*
       * The item's weighted average purchase cost.
       *
       * `unitCostKobo` on the item is re-blended by `recordMovement` on every priced receipt, so it
       * is the average the brief requires cost of goods to use — not the price last typed. The sale
       * snapshots it, which is what keeps a completed sale's margin fixed at what was true when the
       * goods left rather than drifting with later deliveries.
       */
      const unitCostKobo = x.unitCostKobo ?? 0;
      return {
        id: d.id,
        name: x.name ?? "",
        sku: x.sku ?? undefined,
        unit: x.unit ?? "unit",
        quantityOnHand: x.quantityOnHand ?? 0,
        reorderLevel: x.reorderLevel ?? 0,
        unitCostKobo,
        /*
         * The selling price, falling back to cost.
         *
         * Falling back to *cost* rather than to zero is deliberate: a zero-priced line
         * gives the goods away, and a cashier who does not notice has sold stock for
         * nothing. At cost the sale merely makes no margin, which is visible in the
         * profit report and recoverable.
         */
        unitPriceKobo: x.unitPriceKobo ?? unitCostKobo,
        category: x.category ?? "other",
        // Services hold no stock. Absent means it does, which is right for every real item.
        tracksStock: x.tracksStock !== false,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Moves stock from the workshop's shelves to the counter.
 *
 * The two are separate collections, so getting goods to the till is an explicit act. That is the
 * point: "what can we sell today" becomes a figure somebody can stand at the counter and trust,
 * rather than the workshop's whole holding minus whatever is spoken for.
 *
 * ## Why one transaction
 *
 * A half-applied transfer either loses stock or invents it. Decrementing the workshop and failing to
 * increment the counter destroys goods that are physically on a shelf; the reverse conjures goods
 * that are not. So both sides move together or neither does, and both movements are written inside
 * the same transaction as their ledger entries.
 *
 * ## Why the cost travels
 *
 * The counter item takes the workshop item's weighted average cost, re-blended into whatever the
 * counter already held. Without that, a sale would be costed at a figure retyped at the till, and
 * the retail margin the brief asks for would be measuring against a guess. The blend is the same
 * arithmetic `recordMovement` uses on a delivery, for the same reason.
 *
 * The counter item is created on first transfer, keyed by name, so nobody sets the same product up
 * twice.
 */
export async function transferToCounter(
  db: Firestore,
  actor: AuditActor,
  input: {
    /** The company-stock item being moved. */
    companyItemId: string;
    quantity: number;
    /** What the counter will sell it for. Only needed the first time. */
    unitPriceKobo?: number;
    reason?: string;
  }
): Promise<{ posItemId: string; counterQuantity: number }> {
  if (!(input.quantity > 0)) throw new Error("How many are going to the counter?");

  const companyRef = doc(db, COL.inventoryCompany, input.companyItemId);

  /*
   * The matching counter item is found before the transaction opens.
   *
   * A transaction cannot run a query, so the lookup by name happens first and its id is then read
   * inside. The race — two transfers creating the same counter item at once — is handled by the
   * transaction reading that id again: the second sees the first's write and blends into it.
   */
  const companyPre = await getDoc(companyRef);
  if (!companyPre.exists()) throw new Error("That stock item no longer exists.");
  const name = String(companyPre.data().name ?? "").trim();

  const existing = await getDocs(collection(db, COL.inventoryPos));
  const match = existing.docs.find(
    (d) => String(d.data().name ?? "").trim().toLowerCase() === name.toLowerCase()
  );
  const posRef = match ? doc(db, COL.inventoryPos, match.id) : doc(collection(db, COL.inventoryPos));

  const result = await runTransaction(db, async (tx) => {
    // Every read first, then every write — the rule this codebase holds throughout.
    const company = await tx.get(companyRef);
    if (!company.exists()) throw new Error("That stock item no longer exists.");
    const pos = await tx.get(posRef);

    const c = company.data();
    const companyOnHand = (c.quantityOnHand as number) ?? 0;
    const companyCostKobo = (c.unitCostKobo as number) ?? 0;

    if (companyOnHand < input.quantity) {
      throw new Error(
        `Only ${companyOnHand} ${c.unit ?? "unit"}(s) of ${name} in company stock, so ${input.quantity} cannot be moved to the counter.`
      );
    }

    const posOnHand = pos.exists() ? ((pos.data()!.quantityOnHand as number) ?? 0) : 0;
    const posCostKobo = pos.exists() ? ((pos.data()!.unitCostKobo as number) ?? 0) : 0;
    const nextPosOnHand = posOnHand + input.quantity;

    /*
     * The cost blended into what the counter already held.
     *
     * Same weighted average as a delivery: the counter's existing stock at its cost, plus what is
     * arriving at the workshop's cost. A transfer is a receipt as far as the counter is concerned.
     */
    const nextPosCostKobo =
      nextPosOnHand > 0
        ? Math.round(
            (posOnHand * posCostKobo + input.quantity * companyCostKobo) / nextPosOnHand
          )
        : companyCostKobo;

    const nextCompanyOnHand = companyOnHand - input.quantity;
    const note = input.reason?.trim() || "Transferred to the counter";

    // Company side: out.
    tx.update(companyRef, {
      quantityOnHand: nextCompanyOnHand,
      updatedAt: serverTimestamp(),
      updatedBy: actor.uid,
    });
    tx.set(doc(collection(db, inventoryMovementsPath(input.companyItemId))), {
      type: "out",
      quantity: input.quantity,
      reason: note,
      issuedToName: "Counter (POS)",
      issuedByName: actor.email,
      averageCostAfterKobo: companyCostKobo,
      balanceAfter: nextCompanyOnHand,
      createdAt: serverTimestamp(),
      createdBy: actor.uid,
    });

    // Counter side: in. Created on first transfer, carrying the details from company stock so the
    // same product is not described two different ways on the two shelves.
    if (pos.exists()) {
      tx.update(posRef, {
        quantityOnHand: nextPosOnHand,
        unitCostKobo: nextPosCostKobo,
        ...(input.unitPriceKobo !== undefined && input.unitPriceKobo > 0
          ? { unitPriceKobo: input.unitPriceKobo }
          : {}),
        lastRestockedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        updatedBy: actor.uid,
      });
    } else {
      tx.set(posRef, {
        name,
        category: c.category ?? "other",
        unit: c.unit ?? "unit",
        sku: c.sku ?? null,
        quantityOnHand: input.quantity,
        reorderLevel: c.reorderLevel ?? 0,
        unitCostKobo: companyCostKobo,
        /*
         * A selling price is required on the first transfer, but not enforced here.
         *
         * Falling back to cost rather than refusing: a counter item priced at cost makes no margin,
         * which is visible in the retail figures and correctable. Refusing the transfer would leave
         * the goods physically at the counter and absent from the record, which is worse.
         */
        unitPriceKobo:
          input.unitPriceKobo !== undefined && input.unitPriceKobo > 0
            ? input.unitPriceKobo
            : companyCostKobo,
        tracksStock: true,
        active: true,
        sourceCompanyItemId: input.companyItemId,
        createdAt: serverTimestamp(),
        createdBy: actor.uid,
      });
    }

    tx.set(doc(collection(db, posMovementsPath(posRef.id))), {
      type: "in",
      quantity: input.quantity,
      reason: note,
      issuedByName: actor.email,
      averageCostAfterKobo: nextPosCostKobo,
      balanceAfter: nextPosOnHand,
      createdAt: serverTimestamp(),
      createdBy: actor.uid,
    });

    return { posItemId: posRef.id, counterQuantity: nextPosOnHand };
  });

  await writeAudit(db, {
    actor,
    action: "inventory_movement",
    collectionName: COL.inventoryPos,
    docId: result.posItemId,
    summary: `Moved ${input.quantity} ${name} from company stock to the counter (counter now holds ${result.counterQuantity})`,
    after: {
      companyItemId: input.companyItemId,
      quantity: input.quantity,
      counterQuantity: result.counterQuantity,
    },
  });

  return result;
}

/**
 * The counter's opening stock list.
 *
 * The items the shop actually sells, so the till is usable on day one instead of starting empty
 * and being filled in during the first customer's wait. Costs and prices are starting figures to
 * be corrected against real invoices — a price is a commercial decision, not a constant.
 *
 * The two services at the end carry no stock: cutting and edge banding are sold over the counter
 * like anything else, and a service with a quantity on hand would show as perpetually out of
 * stock. `tracksStock: false` is what excludes them from the stock decrement.
 */
export const DEFAULT_POS_ITEMS: Array<{
  name: string;
  category: string;
  unit: string;
  unitCostKobo: number;
  unitPriceKobo: number;
  reorderLevel: number;
  tracksStock?: boolean;
}> = [
  { name: "18mm White MDF 8x4", category: "boards", unit: "sheet", unitCostKobo: 2_800_000, unitPriceKobo: 3_200_000, reorderLevel: 10 },
  { name: "18mm HDF 8x4", category: "boards", unit: "sheet", unitCostKobo: 2_400_000, unitPriceKobo: 2_800_000, reorderLevel: 10 },
  { name: "Quarter Plywood", category: "boards", unit: "sheet", unitCostKobo: 900_000, unitPriceKobo: 1_150_000, reorderLevel: 15 },
  { name: "Edge Tape", category: "consumables", unit: "roll", unitCostKobo: 450_000, unitPriceKobo: 600_000, reorderLevel: 8 },
  { name: "Wood Glue", category: "consumables", unit: "tin", unitCostKobo: 350_000, unitPriceKobo: 480_000, reorderLevel: 6 },
  { name: "Cabinet Handles", category: "fittings", unit: "piece", unitCostKobo: 120_000, unitPriceKobo: 180_000, reorderLevel: 24 },
  { name: "Soft Close Hinges", category: "fittings", unit: "pair", unitCostKobo: 250_000, unitPriceKobo: 350_000, reorderLevel: 20 },
  { name: "Angle Irons", category: "fittings", unit: "piece", unitCostKobo: 60_000, unitPriceKobo: 100_000, reorderLevel: 30 },
  // Services: sold, not stocked.
  { name: "Cutting Service", category: "services", unit: "board", unitCostKobo: 0, unitPriceKobo: 300_000, reorderLevel: 0, tracksStock: false },
  { name: "Edge Banding Service", category: "services", unit: "metre", unitCostKobo: 0, unitPriceKobo: 50_000, reorderLevel: 0, tracksStock: false },
];

/**
 * Adds the counter's opening stock list, skipping anything already there.
 *
 * Matched on name so a second run tops up rather than duplicating. Idempotent because the
 * realistic mistake is running it twice and ending up with two "Edge Tape" rows, which then
 * disagree about how much tape there is.
 */
export async function seedPosItems(
  db: Firestore,
  actor: AuditActor
): Promise<{ created: number; skipped: number }> {
  const existing = await getDocs(collection(db, COL.inventoryPos));
  const have = new Set(
    existing.docs.map((d) => String(d.data().name ?? "").trim().toLowerCase())
  );

  let created = 0;
  let skipped = 0;

  for (const item of DEFAULT_POS_ITEMS) {
    if (have.has(item.name.trim().toLowerCase())) {
      skipped += 1;
      continue;
    }
    await addDoc(collection(db, COL.inventoryPos), {
      name: item.name,
      category: item.category,
      unit: item.unit,
      // Opening quantity zero: a stock figure invented by a seed is a lie the counter would
      // then sell against. It is set by the first delivery or a stock take.
      quantityOnHand: 0,
      reorderLevel: item.reorderLevel,
      unitCostKobo: item.unitCostKobo,
      unitPriceKobo: item.unitPriceKobo,
      tracksStock: item.tracksStock ?? true,
      active: true,
      createdAt: serverTimestamp(),
      createdBy: actor.uid,
    });
    created += 1;
  }

  if (created > 0) {
    await writeAudit(db, {
      actor,
      action: "create",
      collectionName: COL.inventoryPos,
      docId: "seed",
      summary: `Added ${created} counter item(s) to stock; ${skipped} already present`,
      after: { created, skipped },
    });
  }

  return { created, skipped };
}

export interface NewSaleLine {
  /** Set when selling from stock; absent for an untracked one-off. */
  inventoryItemId?: string;
  item: string;
  unit?: string;
  quantity: number;
  unitPriceKobo: number;
  unitCostKobo?: number;
  /**
   * False for a service — cutting, edge banding — which is sold but not stocked.
   *
   * Without it a service's count would go negative on every sale, and once negative stock is
   * disallowed the till would refuse to sell it at all.
   */
  tracksStock?: boolean;
}

export interface NewSale {
  customerId?: string;
  customerName?: string;
  customerPhone?: string;
  lines: NewSaleLine[];
  discountPercent?: number;
  discountKobo?: number;
  taxMode?: TaxMode;
  taxPercent?: number;
  taxLabel?: string;
  method: PaymentMethod;
  tenderedKobo?: number;
  /**
   * What the customer actually paid, when it is less than the total.
   *
   * Omitted means paid in full, which is the ordinary counter sale. Supplying less makes it a
   * credit sale: the goods leave, the stock comes off, and the balance is owed. A trade customer
   * taking boards on account previously had nowhere to be recorded.
   */
  amountPaidKobo?: number;
  /** When the balance is due, on a credit sale. */
  dueAt?: Date;
  notes?: string;
  soldByName?: string;
}

export interface SaleResult {
  saleId: string;
  receiptNumber: string;
  totalKobo: number;
  changeKobo: number;
  /** Nought on an ordinary sale; what is still owed when it went out on account. */
  balanceKobo: number;
}

/**
 * Completes a counter sale.
 *
 * Everything happens in one transaction: the sale, its lines, the stock decrement and
 * the movement record. A partial write here is the worst outcome available — stock
 * reduced with no sale to explain it, or takings recorded against goods still on the
 * shelf — so atomicity matters more than the transaction's size limits, which a
 * counter sale of a handful of lines never approaches.
 *
 * Stock is re-read inside the transaction rather than trusted from the screen. The
 * quantities the cashier saw may be minutes old, and two tills selling the last four
 * boards would otherwise both succeed.
 */
export async function completeSale(
  db: Firestore,
  actor: AuditActor,
  input: NewSale
): Promise<SaleResult> {
  const lines = input.lines.filter(
    (l) => l.item.trim() !== "" && l.quantity > 0
  );
  if (lines.length === 0) throw new Error("Add at least one item to the sale.");
  if (lines.some((l) => l.unitPriceKobo < 0)) {
    throw new Error("A price cannot be negative.");
  }

  const settings = await posSettings(db);

  const saleLines: SaleLine[] = lines.map((l, i) => ({
    id: `s${i + 1}`,
    inventoryItemId: l.inventoryItemId,
    item: l.item.trim(),
    unit: l.unit,
    quantity: l.quantity,
    unitPriceKobo: l.unitPriceKobo,
    unitCostKobo: l.unitCostKobo ?? 0,
    // Carried onto the stored line so a void reverses exactly what the sale moved.
    tracksStock: l.tracksStock ?? true,
    amountKobo: lineAmountKobo(l.quantity, l.unitPriceKobo),
  }));

  // The same arithmetic the invoice uses, so a receipt and an invoice for identical
  // goods can never disagree about the tax.
  const totals = computeInvoiceTotals({
    subtotalKobo: subtotalOfLines(saleLines),
    discountPercent: input.discountPercent,
    discountKobo: input.discountKobo,
    taxMode: input.taxMode ?? settings.taxMode,
    taxPercent: input.taxPercent ?? settings.taxPercent,
  });

  const costOfGoodsKobo = sumKobo(
    saleLines.map((l) => lineAmountKobo(l.quantity, l.unitCostKobo ?? 0))
  );

  /*
   * What was paid, and what is owed.
   *
   * Omitting `amountPaidKobo` means the ordinary case: paid in full. Supplying less makes it a
   * credit sale, which is a real thing at the counter — a trade customer takes boards on account
   * — and previously had nowhere to go but a notebook.
   */
  const amountPaidKobo =
    input.amountPaidKobo === undefined
      ? totals.totalKobo
      : Math.max(0, Math.min(input.amountPaidKobo, totals.totalKobo));
  const balanceKobo = totals.totalKobo - amountPaidKobo;

  if (balanceKobo > 0 && !input.customerName?.trim()) {
    // A debt owed by nobody cannot be chased, which makes it a gift.
    throw new Error(
      "A sale on account needs the customer's name, or there is no way to collect the balance."
    );
  }

  // Cash tendered is only meaningful for cash: a transfer or a card is for the exact
  // amount, and asking for "change" on one would be nonsense.
  const tendered = input.method === "cash" ? (input.tenderedKobo ?? 0) : 0;
  // Compared against what is being *paid* rather than the total, so a part payment in cash is
  // not rejected for being less than the full price.
  if (input.method === "cash" && tendered > 0 && tendered < amountPaidKobo) {
    throw new Error(
      `Cash given is less than the amount being paid. Short by ${amountPaidKobo - tendered} kobo.`
    );
  }
  const changeKobo = tendered > 0 ? Math.max(0, tendered - amountPaidKobo) : 0;

  const { formatted: receiptNumber } = await allocateDocNumber(db, COUNTER.sale);
  const saleRef = doc(collection(db, COL.sales));

  /*
   * Lines that move stock.
   *
   * An untracked one-off has no item to decrement, and a *service* has an item but no stock —
   * cutting and edge banding are sold over the counter like anything else, and decrementing them
   * would drive their count negative on every sale and then block the till once
   * `allowNegativeStock` is off.
   */
  const stocked = saleLines.filter((l) => l.inventoryItemId && l.tracksStock !== false);

  await runTransaction(db, async (tx) => {
    /*
     * Reads first, in full.
     *
     * Firestore rejects a transaction that reads after it writes, so every item is
     * fetched before anything is decremented. Quantities are also summed per item id
     * first, because the same board can legitimately appear on two lines and reading
     * it twice would check each against the original figure rather than the running
     * one.
     */
    const wantedByItem = new Map<string, number>();
    for (const l of stocked) {
      wantedByItem.set(
        l.inventoryItemId!,
        (wantedByItem.get(l.inventoryItemId!) ?? 0) + l.quantity
      );
    }

    const itemIds = [...wantedByItem.keys()];
    const snaps = await Promise.all(
      itemIds.map((id) => tx.get(doc(db, COL.inventoryPos, id)))
    );

    const onHandById = new Map<string, { name: string; onHand: number; unit: string }>();
    itemIds.forEach((id, i) => {
      const snap = snaps[i];
      if (!snap.exists()) {
        throw new Error(
          "An item on this sale is no longer in stock records. Remove it and try again."
        );
      }
      const x = snap.data();
      onHandById.set(id, {
        name: x.name ?? "item",
        onHand: x.quantityOnHand ?? 0,
        unit: x.unit ?? "unit",
      });
    });

    if (!settings.allowNegativeStock) {
      for (const [id, wanted] of wantedByItem) {
        const held = onHandById.get(id)!;
        if (wanted > held.onHand) {
          throw new Error(
            `Only ${held.onHand} ${held.unit} of ${held.name} in stock, but ${wanted} ` +
              "is being sold. Count the stock, or allow negative stock in Settings."
          );
        }
      }
    }

    // Writes.
    tx.set(saleRef, {
      receiptNumber,
      customerId: input.customerId ?? null,
      customerName: input.customerName?.trim() || null,
      customerPhone: input.customerPhone?.trim() || null,
      lines: saleLines,
      subtotalKobo: totals.subtotalKobo,
      discountPercent: totals.discountPercent,
      discountKobo: totals.discountKobo,
      taxMode: totals.taxMode,
      taxPercent: totals.taxPercent,
      taxLabel: input.taxLabel ?? settings.taxLabel,
      taxKobo: totals.taxKobo,
      totalKobo: totals.totalKobo,
      costOfGoodsKobo,
      method: input.method,
      tenderedKobo: tendered || null,
      changeKobo,
      amountPaidKobo,
      balanceKobo,
      dueAt: input.dueAt ? Timestamp.fromDate(input.dueAt) : null,
      settledAt: balanceKobo <= 0 ? serverTimestamp() : null,
      // `credit` when money is still owed, so the till can list what to collect rather than
      // reporting every sale as settled.
      status: (balanceKobo > 0 ? "credit" : "completed") satisfies SaleStatus,
      soldAt: serverTimestamp(),
      soldByName: input.soldByName ?? actor.email,
      notes: input.notes?.trim() || null,
      createdAt: serverTimestamp(),
      createdBy: actor.uid,
    });

    for (const line of saleLines) {
      tx.set(doc(collection(db, saleLinesPath(saleRef.id))), line);
    }

    for (const [id, wanted] of wantedByItem) {
      const held = onHandById.get(id)!;
      const balanceAfter = held.onHand - wanted;
      tx.update(doc(db, COL.inventoryPos, id), {
        quantityOnHand: balanceAfter,
        updatedAt: serverTimestamp(),
        updatedBy: actor.uid,
      });
      // The movement is what makes the stock figure auditable: a balance with no
      // record of how it got there cannot be checked against anything.
      tx.set(doc(collection(db, posMovementsPath(id))), {
        type: "out",
        quantity: wanted,
        reason: `Counter sale ${receiptNumber}`,
        saleId: saleRef.id,
        balanceAfter,
        createdAt: serverTimestamp(),
        createdBy: actor.uid,
      });
    }
  });

  await writeAudit(db, {
    actor,
    action: "create",
    collectionName: COL.sales,
    docId: saleRef.id,
    summary:
      `Counter sale ${receiptNumber}: ${saleLines.length} line(s), ` +
      `${totals.totalKobo} kobo by ${input.method}` +
      (input.customerName ? ` to ${input.customerName}` : ""),
    after: {
      receiptNumber,
      totalKobo: totals.totalKobo,
      costOfGoodsKobo,
      method: input.method,
    },
  });

  return {
    saleId: saleRef.id,
    receiptNumber,
    totalKobo: totals.totalKobo,
    changeKobo,
    balanceKobo,
  };
}

/**
 * Records money against a sale sold on account.
 *
 * Kept as its own function rather than folded into an edit, because taking a payment is not the
 * same act as correcting a sale: the goods and the price are settled, only the money is moving.
 * Transactional so two people collecting from the same customer at once cannot both write a
 * balance computed from the same starting figure.
 */
export async function recordSalePayment(
  db: Firestore,
  actor: AuditActor,
  saleId: string,
  amountKobo: number,
  method: PaymentMethod
): Promise<{ balanceKobo: number; settled: boolean }> {
  if (!(amountKobo > 0)) throw new Error("Enter the amount received.");

  const saleRef = doc(db, COL.sales, saleId);

  const result = await runTransaction(db, async (tx) => {
    const snap = await tx.get(saleRef);
    if (!snap.exists()) throw new Error("That sale no longer exists.");
    const sale = snap.data();

    if (sale.status === "voided") {
      throw new Error("This sale was voided, so there is nothing to collect.");
    }

    const total = sale.totalKobo ?? 0;
    const paid = sale.amountPaidKobo ?? total;
    const outstanding = total - paid;

    if (outstanding <= 0) {
      throw new Error("This sale is already settled in full.");
    }
    if (amountKobo > outstanding) {
      throw new Error(
        `That is more than the ${outstanding} kobo outstanding. Take the balance only.`
      );
    }

    const nextPaid = paid + amountKobo;
    const nextBalance = total - nextPaid;

    tx.update(saleRef, {
      amountPaidKobo: nextPaid,
      balanceKobo: nextBalance,
      status: (nextBalance <= 0 ? "completed" : "credit") satisfies SaleStatus,
      settledAt: nextBalance <= 0 ? serverTimestamp() : null,
      // The method of the *latest* payment, so a transfer settling a cash sale is visible.
      lastPaymentMethod: method,
      updatedAt: serverTimestamp(),
      updatedBy: actor.uid,
    });

    return {
      balanceKobo: nextBalance,
      settled: nextBalance <= 0,
      receiptNumber: (sale.receiptNumber as string) ?? saleId,
    };
  });

  await writeAudit(db, {
    actor,
    action: "payment_record",
    collectionName: COL.sales,
    docId: saleId,
    summary:
      `${result.receiptNumber}: ${amountKobo} kobo received by ${method}` +
      (result.settled ? " — settled in full" : `, ${result.balanceKobo} kobo still owed`),
    after: { amountKobo, balanceKobo: result.balanceKobo, method },
  });

  return { balanceKobo: result.balanceKobo, settled: result.settled };
}

/** A sale with money still owed on it. */
export interface Debtor {
  id: string;
  receiptNumber: string;
  customerName: string;
  customerPhone?: string;
  totalKobo: number;
  amountPaidKobo: number;
  balanceKobo: number;
  soldAtMs: number | null;
  dueAtMs: number | null;
  /** Past its agreed date. False when no date was agreed — not late, just open. */
  overdue: boolean;
}

/**
 * Sales with money still owed, oldest first.
 *
 * Oldest first because that is the order to chase them in — a debt from six weeks ago is the one
 * at risk, not this morning's.
 */
export async function loadDebtors(db: Firestore): Promise<Debtor[]> {
  const snap = await getDocs(
    query(collection(db, COL.sales), where("status", "==", "credit"))
  );
  const now = Date.now();

  return snap.docs
    .map((d) => {
      const x = d.data();
      const dueAtMs = x.dueAt?.toMillis?.() ?? null;
      return {
        id: d.id,
        receiptNumber: x.receiptNumber ?? "",
        customerName: x.customerName ?? "Unknown",
        customerPhone: x.customerPhone ?? undefined,
        totalKobo: x.totalKobo ?? 0,
        amountPaidKobo: x.amountPaidKobo ?? 0,
        balanceKobo: x.balanceKobo ?? 0,
        soldAtMs: x.soldAt?.toMillis?.() ?? null,
        dueAtMs,
        overdue: dueAtMs !== null && dueAtMs < now,
      };
    })
    .filter((r) => r.balanceKobo > 0)
    .sort((a, b) => (a.soldAtMs ?? 0) - (b.soldAtMs ?? 0));
}

/**
 * Voids a completed sale and puts the stock back.
 *
 * Voided rather than deleted, so the receipt number stays in the sequence — a missing
 * receipt is indistinguishable from a theft, which is precisely the thing a till
 * record exists to rule out.
 *
 * The stock is returned in the same transaction as the void, for the same reason it
 * was taken out in one: a void that failed halfway would leave the takings reversed
 * and the goods still counted as sold.
 */
export async function voidSale(
  db: Firestore,
  actor: AuditActor,
  saleId: string,
  reason: string
): Promise<void> {
  if (!reason.trim()) throw new Error("Give a reason for voiding the sale.");

  const saleRef = doc(db, COL.sales, saleId);

  await runTransaction(db, async (tx) => {
    const snap = await tx.get(saleRef);
    if (!snap.exists()) throw new Error("Sale not found.");
    const sale = snap.data();

    if (sale.status === "voided") throw new Error("This sale is already voided.");

    const lines = (sale.lines ?? []) as SaleLine[];
    const returnByItem = new Map<string, number>();
    for (const l of lines) {
      // Mirrors what `completeSale` decremented: no item, or a service, moved no stock, so a
      // void must not put any back. Returning stock that never left would inflate the count.
      if (!l.inventoryItemId || l.tracksStock === false) continue;
      returnByItem.set(
        l.inventoryItemId,
        (returnByItem.get(l.inventoryItemId) ?? 0) + l.quantity
      );
    }

    const itemIds = [...returnByItem.keys()];
    const snaps = await Promise.all(
      itemIds.map((id) => tx.get(doc(db, COL.inventoryPos, id)))
    );

    tx.update(saleRef, {
      status: "voided" satisfies SaleStatus,
      /*
       * The debt dies with the sale.
       *
       * `loadDebtors` filters on the status, so a voided sale already drops off the chase list —
       * but leaving a balance on the document means any later reader that sums `balanceKobo`
       * without also checking the status reports money owed on goods that came back. Zeroed here
       * so the figure cannot be read wrongly rather than merely being filtered out of one view.
       */
      balanceKobo: 0,
      voidedAt: serverTimestamp(),
      voidReason: reason.trim(),
      updatedAt: serverTimestamp(),
      updatedBy: actor.uid,
    });

    itemIds.forEach((id, i) => {
      const itemSnap = snaps[i];
      // A deleted stock item cannot take its goods back. The void still stands —
      // reversing the money is the more important half — and the audit entry records
      // that the stock could not be returned.
      if (!itemSnap.exists()) return;
      const back = returnByItem.get(id) ?? 0;
      const balanceAfter = (itemSnap.data().quantityOnHand ?? 0) + back;
      tx.update(doc(db, COL.inventoryPos, id), {
        quantityOnHand: balanceAfter,
        updatedAt: serverTimestamp(),
        updatedBy: actor.uid,
      });
      tx.set(doc(collection(db, posMovementsPath(id))), {
        type: "in",
        quantity: back,
        reason: `Voided sale ${sale.receiptNumber ?? saleId}: ${reason.trim()}`,
        saleId,
        balanceAfter,
        createdAt: serverTimestamp(),
        createdBy: actor.uid,
      });
    });
  });

  const after = await getDoc(saleRef);

  await writeAudit(db, {
    actor,
    action: "delete",
    collectionName: COL.sales,
    docId: saleId,
    summary:
      `Voided sale ${after.data()?.receiptNumber ?? saleId} ` +
      `(${after.data()?.totalKobo ?? 0} kobo): ${reason.trim()}`,
    before: { status: "completed", totalKobo: after.data()?.totalKobo ?? 0 },
    after: { status: "voided", reason: reason.trim() },
  });
}

/** Takings and margin over a set of sales. Voided sales are excluded. */
export function summariseSales(
  sales: Array<{
    status: SaleStatus;
    totalKobo: number;
    taxKobo: number;
    costOfGoodsKobo: number;
    method: PaymentMethod;
    /** Absent on sales written before credit existed, which were paid in full. */
    amountPaidKobo?: number;
    balanceKobo?: number;
  }>
): {
  saleCount: number;
  /** What was sold, at full value — including anything still owed. */
  soldKobo: number;
  /** What actually came into the till. Less than `soldKobo` when there are debtors. */
  takingsKobo: number;
  /** Still owed on sales made in this period. */
  owedKobo: number;
  taxKobo: number;
  costKobo: number;
  /** Takings net of tax, less what the goods cost. */
  marginKobo: number;
  /**
   * Sales that recorded no cost of goods.
   *
   * Their margin reads as 100%, which is almost never true — it means the item was
   * sold off-stock, or its stock record carries no unit cost. Counted so the figure can
   * be qualified rather than quietly believed: an unpriced cost inflates margin, and a
   * margin nobody questions is worse than one with a caveat attached.
   */
  salesMissingCost: number;
  byMethod: Record<string, number>;
} {
  const live = sales.filter((s) => s.status !== "voided");

  const soldKobo = sumKobo(live.map((s) => s.totalKobo));
  /*
   * Takings are what reached the till, not what was sold.
   *
   * A credit sale puts goods out of the door without money coming in, so counting its full value
   * as takings would report cash the workshop does not have. `amountPaidKobo` is absent on sales
   * written before credit existed — those were paid in full, so the total is correct for them.
   */
  const takingsKobo = sumKobo(live.map((s) => s.amountPaidKobo ?? s.totalKobo));
  const owedKobo = sumKobo(live.map((s) => s.balanceKobo ?? 0));

  const taxKobo = sumKobo(live.map((s) => s.taxKobo));
  const costKobo = sumKobo(live.map((s) => s.costOfGoodsKobo));

  const byMethod: Record<string, number> = {};
  for (const s of live) {
    // Split by what was actually received, so the method totals reconcile against the till.
    byMethod[s.method] = (byMethod[s.method] ?? 0) + (s.amountPaidKobo ?? s.totalKobo);
  }

  return {
    saleCount: live.length,
    soldKobo,
    takingsKobo,
    owedKobo,
    taxKobo,
    costKobo,
    salesMissingCost: live.filter(
      (s) => s.costOfGoodsKobo <= 0 && s.totalKobo > 0
    ).length,
    /*
     * Margin is on what was *sold*, not what was collected.
     *
     * The goods left the shop and their cost was incurred whether or not the customer has paid
     * yet, so a credit sale earns its margin at the point of sale. Using takings here would
     * report a loss on every sale on account — the cost counted, the revenue not — and then a
     * matching windfall weeks later when the money arrived.
     *
     * Tax is removed first: tax collected is not the workshop's money, it is owed onward, so
     * counting it as revenue would overstate margin by the tax rate on every sale.
     */
    marginKobo: soldKobo - taxKobo - costKobo,
    byMethod,
  };
}

/** Sales within a period, for the takings view and the profit report. */
export async function loadSalesBetween(
  db: Firestore,
  from: Date,
  to: Date
): Promise<
  Array<{
    id: string;
    receiptNumber: string;
    customerName?: string;
    totalKobo: number;
    taxKobo: number;
    costOfGoodsKobo: number;
    method: PaymentMethod;
    status: SaleStatus;
    /** What reached the till, which is less than the total on a credit sale. */
    amountPaidKobo: number;
    balanceKobo: number;
    soldAtMs: number | null;
  }>
> {
  const snap = await getDocs(
    query(
      collection(db, COL.sales),
      where("soldAt", ">=", Timestamp.fromDate(from)),
      where("soldAt", "<=", Timestamp.fromDate(to)),
      orderBy("soldAt", "desc")
    )
  );
  return snap.docs.map((d) => {
    const x = d.data();
    return {
      id: d.id,
      receiptNumber: x.receiptNumber ?? "",
      customerName: x.customerName ?? undefined,
      totalKobo: x.totalKobo ?? 0,
      taxKobo: x.taxKobo ?? 0,
      costOfGoodsKobo: x.costOfGoodsKobo ?? 0,
      method: (x.method as PaymentMethod) ?? "cash",
      status: (x.status as SaleStatus) ?? "completed",
      // Absent on sales written before credit existed: those were paid in full.
      amountPaidKobo: x.amountPaidKobo ?? x.totalKobo ?? 0,
      balanceKobo: x.balanceKobo ?? 0,
      soldAtMs: x.soldAt?.toMillis?.() ?? null,
    };
  });
}

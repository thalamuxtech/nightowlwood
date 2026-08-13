"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  collection,
  doc,
  getDoc,
  limit,
  onSnapshot,
  orderBy,
  query,
} from "firebase/firestore";
import {
  AlertTriangle,
  Loader2,
  Package,
  PackagePlus,
  Plus,
  Receipt,
  ShieldAlert,
  ShoppingCart,
  Users,
  Trash2,
} from "lucide-react";
import { getDb } from "@/lib/firebase";
import { COL } from "@/lib/erp/collections";
import {
  PAYMENT_METHODS,
  PAYMENT_METHOD_LABELS,
  SALE_STATUS_LABELS,
  TAX_MODES,
  TAX_MODE_LABELS,
  type PaymentMethod,
  type SaleStatus,
  type TaxMode,
} from "@/lib/erp/enums";
import {
  formatNaira,
  lineAmountKobo,
  parseNairaInput,
  sumKobo,
  toNaira,
} from "@/lib/erp/money";
import { computeInvoiceTotals, subtotalOfLines } from "@/lib/erp/invoices";
import {
  completeSale,
  loadDebtors,
  loadSellableItems,
  posSettings,
  recordSalePayment,
  seedPosItems,
  summariseSales,
  voidSale,
  type Debtor,
  type SellableItem,
} from "@/lib/erp/sales";
import { StatusPill } from "@/components/admin/ui/StatusPill";
import {
  Button,
  DateField,
  EmptyState,
  NairaField,
  NumberField,
  SelectField,
  TextField,
} from "@/components/admin/ui/Fields";
import { useErpSession } from "@/components/admin/ErpAuthProvider";
import { SaleReceipt } from "@/components/admin/print/SaleReceipt";
import { ThermalReceipt } from "@/components/admin/print/ThermalReceipt";
import { PrintPreview } from "@/components/admin/ui/PrintPreview";
import { CounterRestockPanel } from "@/components/admin/money/CounterRestockPanel";
import {
  DEFAULT_COMPANY_SETTINGS,
  SETTINGS_DOC,
  type CompanySettings,
} from "@/lib/erp/settings";

/** A line in the basket. Naira in the boxes, kobo on the document. */
interface BasketLine {
  key: number;
  inventoryItemId?: string;
  item: string;
  unit?: string;
  quantity: string;
  priceNaira: string;
  unitCostKobo: number;
  /** Stock on hand when it was added, for the over-sell warning. Undefined for a service. */
  onHand?: number;
  /** False for a service: sold, but no stock to move. */
  tracksStock?: boolean;
}

let nextKey = 1;

interface SaleRow {
  id: string;
  receiptNumber: string;
  customerName?: string;
  totalKobo: number;
  taxKobo: number;
  costOfGoodsKobo: number;
  method: PaymentMethod;
  status: SaleStatus;
  soldAtMs: number | null;
  lineCount: number;
}

/**
 * The counter till.
 *
 * Built as a basket rather than a form because that is what the job is: items go in
 * one at a time while a customer stands there, the total updates, money is taken and
 * a receipt is printed. Completing a sale decrements the stock sold in the same
 * transaction, so the shelf and the record cannot drift apart.
 */
export function PosScreen() {
  const session = useErpSession();
  const canSell = session.can("sale.create");
  const canVoid = session.can("sale.void");

  const [items, setItems] = useState<SellableItem[]>([]);
  const [sales, setSales] = useState<SaleRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);

  const [basket, setBasket] = useState<BasketLine[]>([]);
  /** What the cashier is typing to find an item. */
  const [search, setSearch] = useState("");
  /** Part payment, when the customer is taking goods on account. */
  const [paidNow, setPaidNow] = useState("");
  const [onAccount, setOnAccount] = useState(false);
  /** When the balance is expected, as a yyyy-mm-dd box. Optional — many customers just say "soon". */
  const [dueDate, setDueDate] = useState("");
  const [seeding, setSeeding] = useState(false);
  /** Whether the restock panel is open. */
  const [restocking, setRestocking] = useState(false);
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [method, setMethod] = useState<PaymentMethod>("cash");
  const [tendered, setTendered] = useState("");
  const [discountPercent, setDiscountPercent] = useState("0");
  const [taxMode, setTaxMode] = useState<TaxMode>("none");
  const [taxPercent, setTaxPercent] = useState("7.5");
  const [taxLabel, setTaxLabel] = useState("VAT");
  const [allowNegative, setAllowNegative] = useState(false);
  const [receiptFooter, setReceiptFooter] = useState("");
  /** Company details for the receipt header. */
  const [company, setCompany] = useState<CompanySettings>(DEFAULT_COMPANY_SETTINGS);

  useEffect(() => {
    getDoc(doc(getDb(), COL.settings, SETTINGS_DOC.company))
      .then((snap) => {
        if (snap.exists()) {
          setCompany({
            ...DEFAULT_COMPANY_SETTINGS,
            ...(snap.data() as CompanySettings),
          });
        }
      })
      // The receipt still prints with the default name; a missing settings document is
      // not a reason to hold up a sale.
      .catch(() => {});
  }, []);

  /** The completed sale whose receipt is showing. */
  const [receiptFor, setReceiptFor] = useState<{
    receiptNumber: string;
    lines: Array<{ item: string; quantity: number; unitPriceKobo: number; amountKobo: number }>;
    subtotalKobo: number;
    discountKobo: number;
    taxKobo: number;
    taxLabel: string;
    taxInclusive: boolean;
    totalKobo: number;
    method: PaymentMethod;
    tenderedKobo: number;
    changeKobo: number;
    customerName?: string;
    customerPhone?: string;
    /** Set only on a sale that went out on account, so the slip states what is still owed. */
    amountPaidKobo?: number;
    balanceKobo?: number;
    soldAtMs: number;
  } | null>(null);
  const [printing, setPrinting] = useState(false);

  /**
   * Which paper the receipt is going on.
   *
   * The counter has an 80mm thermal printer and the office has A4, and the same sale gets
   * printed on either depending on who is asking — a walk-in wants a slip, a company wants
   * something for their file. Defaults to thermal, since that is what the till is for, and
   * the choice is remembered for the session so a busy counter is not re-picking it on
   * every sale.
   */
  const [paper, setPaper] = useState<"thermal" | "a4">("thermal");

  useEffect(() => {
    posSettings(getDb())
      .then((s) => {
        setTaxMode(s.taxMode);
        setTaxPercent(String(s.taxPercent));
        setTaxLabel(s.taxLabel);
        setAllowNegative(s.allowNegativeStock);
        setReceiptFooter(s.receiptFooter);
      })
      .catch(() => {});
  }, []);

  /*
   * Who still owes.
   *
   * Read on its own rather than filtered out of the recent-sales snapshot, because a debt from two
   * months ago falls outside the fifty most recent sales — and that is exactly the one that needs
   * chasing. Re-read whenever a sale or a collection happens.
   */
  const [debtors, setDebtors] = useState<Debtor[]>([]);
  const [debtorsLoading, setDebtorsLoading] = useState(true);
  const [debtorVersion, setDebtorVersion] = useState(0);
  /** The sale whose payment box is open. */
  const [collecting, setCollecting] = useState<string | null>(null);
  const [collectAmount, setCollectAmount] = useState("");
  const [collectMethod, setCollectMethod] = useState<PaymentMethod>("cash");

  useEffect(() => {
    let live = true;
    setDebtorsLoading(true);
    loadDebtors(getDb())
      .then((rows) => {
        if (live) setDebtors(rows);
      })
      .catch((e) =>
        setError(e instanceof Error ? e.message : "Could not load who is owing.")
      )
      .finally(() => {
        if (live) setDebtorsLoading(false);
      });
    return () => {
      live = false;
    };
  }, [debtorVersion]);

  async function collect(saleId: string, balanceKobo: number) {
    setError("");
    const amountKobo = parseNairaInput(collectAmount);
    if (amountKobo <= 0) {
      setError("Enter the amount received.");
      return;
    }
    if (amountKobo > balanceKobo) {
      setError(`That is more than the ${formatNaira(balanceKobo)} outstanding.`);
      return;
    }
    setBusy(true);
    try {
      const res = await recordSalePayment(getDb(), actor, saleId, amountKobo, collectMethod);
      setNotice(
        `${formatNaira(amountKobo)} received` +
          (res.settled ? " — settled in full" : `, ${formatNaira(res.balanceKobo)} still owed`)
      );
      setTimeout(() => setNotice(""), 10000);
      setCollecting(null);
      setCollectAmount("");
      setDebtorVersion((v) => v + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not record the payment.");
    } finally {
      setBusy(false);
    }
  }

  /** Reloaded after each sale so the on-hand figures shown stay current. */
  const [stockVersion, setStockVersion] = useState(0);
  useEffect(() => {
    loadSellableItems(getDb())
      .then(setItems)
      .catch((e) =>
        setError(e instanceof Error ? e.message : "Could not load the stock list.")
      )
      .finally(() => setLoading(false));
  }, [stockVersion]);

  useEffect(() => {
    return onSnapshot(
      query(collection(getDb(), COL.sales), orderBy("soldAt", "desc"), limit(50)),
      (snap) =>
        setSales(
          snap.docs.map((d) => {
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
              soldAtMs: x.soldAt?.toMillis?.() ?? null,
              lineCount: (x.lines ?? []).length,
            };
          })
        ),
      (e) => setError(e.message)
    );
  }, []);

  const actor = useMemo(
    () => ({
      uid: session.user?.uid ?? "",
      email: session.user?.email ?? "",
      role: session.role ?? "manager",
    }),
    [session.user, session.role]
  );

  const totals = useMemo(() => {
    const lines = basket
      .filter((l) => l.item.trim() !== "")
      .map((l) => ({
        amountKobo: lineAmountKobo(
          Number(l.quantity) || 0,
          parseNairaInput(l.priceNaira)
        ),
      }));
    return computeInvoiceTotals({
      subtotalKobo: subtotalOfLines(lines),
      discountPercent: Number(discountPercent) || 0,
      taxMode,
      taxPercent: Number(taxPercent) || 0,
    });
  }, [basket, discountPercent, taxMode, taxPercent]);

  const tenderedKobo = parseNairaInput(tendered);

  /*
   * What is being paid now, and what is left owing.
   *
   * On an ordinary sale that is the whole total. On account it is whatever the customer hands
   * over — possibly nothing — and the rest becomes a debt against their name.
   */
  const payingKobo = onAccount
    ? Math.min(parseNairaInput(paidNow), totals.totalKobo)
    : totals.totalKobo;
  const owingKobo = Math.max(0, totals.totalKobo - payingKobo);

  // Change and shortfall are measured against what is being paid, not the total — otherwise a
  // deliberate part payment in cash would read as the customer being short.
  const changeKobo =
    method === "cash" && tenderedKobo > 0
      ? Math.max(0, tenderedKobo - payingKobo)
      : 0;
  const shortKobo =
    method === "cash" && tenderedKobo > 0
      ? Math.max(0, payingKobo - tenderedKobo)
      : 0;

  /** Today's takings, from the live list. */
  const today = useMemo(() => {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    return summariseSales(
      sales.filter((s) => s.soldAtMs !== null && s.soldAtMs >= start.getTime())
    );
  }, [sales]);

  /**
   * The items matching what the cashier typed.
   *
   * Capped at 12: the point is to narrow to the thing in front of the customer, and a wall of
   * sixty buttons is the dropdown problem again in a different shape. With no search term the
   * first twelve alphabetically stand in as a quick-pick row, which covers the handful of items
   * that sell all day.
   */
  const matches = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return items.slice(0, 12);
    return items
      .filter((i) =>
        [i.name, i.sku ?? "", i.category].some((f) =>
          f.toLowerCase().includes(term)
        )
      )
      .slice(0, 12);
  }, [items, search]);

  /** Lines asking for more than the shelf holds, shown before money is taken. */
  const overSold = useMemo(
    () =>
      basket.filter(
        (l) =>
          l.inventoryItemId !== undefined &&
          l.onHand !== undefined &&
          Number(l.quantity) > l.onHand
      ),
    [basket]
  );

  function addFromStock(itemId: string) {
    const item = items.find((i) => i.id === itemId);
    if (!item) return;
    setBasket((prev) => {
      // Adding the same item again bumps its quantity rather than making a second
      // line, which is what a cashier scanning two of something expects.
      const existing = prev.find((l) => l.inventoryItemId === itemId);
      if (existing) {
        return prev.map((l) =>
          l.key === existing.key
            ? { ...l, quantity: String((Number(l.quantity) || 0) + 1) }
            : l
        );
      }
      return [
        ...prev,
        {
          key: nextKey++,
          inventoryItemId: item.id,
          item: item.name,
          unit: item.unit,
          quantity: "1",
          priceNaira: String(toNaira(item.unitPriceKobo)),
          unitCostKobo: item.unitCostKobo,
          // A service holds no stock, so it must not raise the over-draw warning or be
          // decremented — `onHand` stays undefined for it.
          onHand: item.tracksStock ? item.quantityOnHand : undefined,
          tracksStock: item.tracksStock,
        },
      ];
    });
    // Cleared so the next item can be typed straight away, which is how a counter runs.
    setSearch("");
  }

  async function seedStock() {
    setError("");
    setSeeding(true);
    try {
      const res = await seedPosItems(getDb(), actor);
      setNotice(
        `${res.created} item(s) added to stock` +
          (res.skipped > 0 ? `, ${res.skipped} already there` : "") +
          ". Set the quantities from your next delivery."
      );
      setTimeout(() => setNotice(""), 12000);
      setStockVersion((v) => v + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not add the counter items.");
    } finally {
      setSeeding(false);
    }
  }

  function addFreeLine() {
    setBasket((prev) => [
      ...prev,
      {
        key: nextKey++,
        item: "",
        quantity: "1",
        priceNaira: "",
        unitCostKobo: 0,
      },
    ]);
  }

  function patch(key: number, next: Partial<BasketLine>) {
    setBasket((prev) => prev.map((l) => (l.key === key ? { ...l, ...next } : l)));
  }

  function clearBasket() {
    setBasket([]);
    setCustomerName("");
    setCustomerPhone("");
    setTendered("");
    setDiscountPercent("0");
    setOnAccount(false);
    setPaidNow("");
    setDueDate("");
  }

  async function complete() {
    setError("");
    const lines = basket.filter((l) => l.item.trim() !== "" && Number(l.quantity) > 0);
    if (lines.length === 0) {
      setError("Add something to the sale first.");
      return;
    }
    if (method === "cash" && tenderedKobo > 0 && shortKobo > 0) {
      setError(`Cash given is short by ${formatNaira(shortKobo)}.`);
      return;
    }
    // A debt owed by nobody cannot be collected, which makes it a gift.
    if (onAccount && owingKobo > 0 && !customerName.trim()) {
      setError(
        "A sale on account needs the customer's name, or there is no way to collect the balance."
      );
      return;
    }

    setBusy(true);
    try {
      const payload = lines.map((l) => ({
        inventoryItemId: l.inventoryItemId,
        item: l.item.trim(),
        unit: l.unit,
        quantity: Number(l.quantity),
        unitPriceKobo: parseNairaInput(l.priceNaira),
        unitCostKobo: l.unitCostKobo,
        tracksStock: l.tracksStock,
      }));

      const res = await completeSale(getDb(), actor, {
        customerName: customerName.trim() || undefined,
        customerPhone: customerPhone.trim() || undefined,
        lines: payload,
        discountPercent: Number(discountPercent) || 0,
        taxMode,
        taxPercent: Number(taxPercent) || 0,
        taxLabel,
        method,
        tenderedKobo: method === "cash" ? tenderedKobo : undefined,
        // Left undefined on an ordinary sale so the engine takes the whole total as paid;
        // only a sale on account narrows it to the part payment.
        amountPaidKobo: onAccount ? payingKobo : undefined,
        dueAt: onAccount && dueDate ? new Date(`${dueDate}T00:00:00`) : undefined,
        soldByName: session.displayName || actor.email,
      });

      // The receipt is built from what was just sold rather than re-read, so it
      // prints immediately with the customer still at the counter.
      setReceiptFor({
        receiptNumber: res.receiptNumber,
        lines: payload.map((l) => ({
          item: l.item,
          quantity: l.quantity,
          unitPriceKobo: l.unitPriceKobo,
          amountKobo: lineAmountKobo(l.quantity, l.unitPriceKobo),
        })),
        subtotalKobo: totals.subtotalKobo,
        discountKobo: totals.discountKobo,
        taxKobo: totals.taxKobo,
        taxLabel,
        taxInclusive: totals.taxMode === "inclusive",
        totalKobo: res.totalKobo,
        method,
        tenderedKobo,
        changeKobo: res.changeKobo,
        customerName: customerName.trim() || undefined,
        customerPhone: customerPhone.trim() || undefined,
        amountPaidKobo: onAccount ? payingKobo : undefined,
        balanceKobo: onAccount ? res.balanceKobo : undefined,
        soldAtMs: Date.now(),
      });

      setNotice(
        `${res.receiptNumber} · ${formatNaira(res.totalKobo)}` +
          (res.changeKobo > 0 ? ` · change ${formatNaira(res.changeKobo)}` : "")
      );
      setTimeout(() => setNotice(""), 10000);
      clearBasket();
      // Stock changed, so the on-hand figures on screen are now stale.
      setStockVersion((v) => v + 1);
      // And if that sale went out on account, the owing list just gained a row.
      if (res.balanceKobo > 0) setDebtorVersion((v) => v + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not complete the sale.");
    } finally {
      setBusy(false);
    }
  }

  if (!session.ready) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center">
        <Loader2 className="animate-spin text-brass-400" size={28} aria-label="Loading" />
      </div>
    );
  }

  const lowStock = items.filter(
    (i) => i.reorderLevel > 0 && i.quantityOnHand <= i.reorderLevel
  );

  return (
    <div className="mx-auto max-w-6xl pb-20">
      {/* The receipt, on whichever paper is chosen.
          Both layouts carry the same figures; only the geometry differs — 80mm continuous
          for the counter printer, A4 for a customer who wants something filed. */}
      {receiptFor && (
        <PrintPreview
          title={`Receipt ${receiptFor.receiptNumber}`}
          paper="a4-portrait"
          onPrint={() => setPrinting(true)}
          onClose={() => setReceiptFor(null)}
        >
          <div className="mb-4 flex flex-wrap items-center gap-2 print:hidden">
            <span className="text-xs uppercase tracking-wider text-cream-500">
              Paper
            </span>
            <PaperChip
              active={paper === "thermal"}
              onClick={() => setPaper("thermal")}
              label="80mm thermal"
            />
            <PaperChip
              active={paper === "a4"}
              onClick={() => setPaper("a4")}
              label="A4"
            />
          </div>

          {paper === "thermal" ? (
            <ThermalReceipt
              data={{
                heading: "Sales Receipt",
                reference: receiptFor.receiptNumber,
                lines: receiptFor.lines,
                subtotalKobo: receiptFor.subtotalKobo,
                discountKobo: receiptFor.discountKobo,
                taxKobo: receiptFor.taxKobo,
                taxLabel: receiptFor.taxLabel,
                taxInclusive: receiptFor.taxInclusive,
                totalKobo: receiptFor.totalKobo,
                method: receiptFor.method,
                tenderedKobo: receiptFor.tenderedKobo,
                changeKobo: receiptFor.changeKobo,
                customerName: receiptFor.customerName,
                customerPhone: receiptFor.customerPhone,
                amountPaidKobo: receiptFor.amountPaidKobo,
                balanceKobo: receiptFor.balanceKobo,
                servedBy: session.displayName || undefined,
                atMs: receiptFor.soldAtMs,
                footerNote: receiptFooter,
              }}
              company={company}
              autoPrint={false}
              onDone={() => {}}
            />
          ) : (
            <SaleReceipt
              sale={receiptFor}
              footerNote={receiptFooter}
              autoPrint={false}
              onDone={() => {}}
            />
          )}
        </PrintPreview>
      )}
      {printing &&
        receiptFor &&
        (paper === "thermal" ? (
          <ThermalReceipt
            data={{
              heading: "Sales Receipt",
              reference: receiptFor.receiptNumber,
              lines: receiptFor.lines,
              subtotalKobo: receiptFor.subtotalKobo,
              discountKobo: receiptFor.discountKobo,
              taxKobo: receiptFor.taxKobo,
              taxLabel: receiptFor.taxLabel,
              taxInclusive: receiptFor.taxInclusive,
              totalKobo: receiptFor.totalKobo,
              method: receiptFor.method,
              tenderedKobo: receiptFor.tenderedKobo,
              changeKobo: receiptFor.changeKobo,
              customerName: receiptFor.customerName,
              customerPhone: receiptFor.customerPhone,
              amountPaidKobo: receiptFor.amountPaidKobo,
              balanceKobo: receiptFor.balanceKobo,
              servedBy: session.displayName || undefined,
              atMs: receiptFor.soldAtMs,
              footerNote: receiptFooter,
            }}
            company={company}
            onDone={() => {
              setPrinting(false);
              setReceiptFor(null);
            }}
          />
        ) : (
          <SaleReceipt
            sale={receiptFor}
            footerNote={receiptFooter}
            onDone={() => {
              setPrinting(false);
              setReceiptFor(null);
            }}
          />
        ))}

      <div className="print:hidden">
        <header>
          <p className="text-eyebrow">Counter</p>
          <h1 className="text-title mt-3 text-cream-50">Counter sales</h1>
          <p className="mt-3 max-w-2xl text-sm leading-relaxed text-cream-400">
            Boards, edge tape and accessories sold over the counter. Completing a sale
            takes the stock off the shelf in the records at the same moment, so the two
            cannot drift apart.
          </p>
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
          <p
            role="status"
            className="mt-6 rounded-xl border border-emerald-500/30 bg-emerald-500/5 px-4 py-3 text-sm text-emerald-300"
          >
            Sale completed · {notice}
          </p>
        )}

        <div className="mt-8 grid gap-4 sm:grid-cols-3 lg:grid-cols-5">
          <Tile label="Sales today" value={String(today.saleCount)} />
          <Tile
            label="Sold today"
            value={formatNaira(today.soldKobo)}
            hint="Value of goods that left the counter"
          />
          <Tile
            label="Money taken"
            value={formatNaira(today.takingsKobo)}
            hint={
              today.owedKobo > 0
                ? `${formatNaira(today.owedKobo)} still owed on account`
                : undefined
            }
            tone={today.owedKobo > 0 ? "warn" : undefined}
          />
          <Tile label="Cost of goods" value={formatNaira(today.costKobo)} />
          <Tile
            label="Margin today"
            value={formatNaira(today.marginKobo)}
            tone={today.marginKobo < 0 ? "danger" : "good"}
            hint={
              today.salesMissingCost > 0
                ? `${today.salesMissingCost} sale${
                    today.salesMissingCost === 1 ? "" : "s"
                  } with no cost recorded, so this reads high`
                : undefined
            }
          />
        </div>

        {lowStock.length > 0 && (
          <p className="mt-4 flex flex-wrap items-start gap-2 rounded-xl border border-amber-500/40 bg-amber-500/5 px-4 py-3 text-sm text-amber-300">
            <AlertTriangle size={16} className="mt-0.5 shrink-0" />
            <span>
              Low stock:{" "}
              {lowStock
                .slice(0, 6)
                .map((i) => `${i.name} (${i.quantityOnHand} ${i.unit})`)
                .join(", ")}
              {lowStock.length > 6 && ` and ${lowStock.length - 6} more`}.
            </span>
          </p>
        )}

        {canSell && (
          <section className="mt-8 rounded-3xl border border-brass-500/30 bg-night-900/40 p-6">
            <h2 className="flex items-center gap-2 font-display text-lg text-cream-100">
              <ShoppingCart size={18} className="text-brass-400" /> New sale
            </h2>

            {/* Search, not a dropdown of everything.
                A counter with sixty lines is unusable as a select — the cashier is typing the
                first letters of what the customer just asked for while they wait. Matches on
                name, SKU and category so "hinge", "SC-18" and "fittings" all find it. */}
            <div className="mt-5">
              <div className="flex flex-wrap items-end gap-3">
                <div className="min-w-[16rem] flex-1">
                  <TextField
                    id="pos-search"
                    label="Find an item"
                    value={search}
                    onChange={setSearch}
                    placeholder="Type a name, SKU or category…"
                  />
                </div>
                <Button variant="secondary" onClick={addFreeLine}>
                  <span className="flex items-center gap-1.5">
                    <Plus size={14} /> Item not listed
                  </span>
                </Button>
                {/* Restocking the counter from the workshop's shelves.
                    Here rather than in inventory because the person who notices the counter is out
                    of hinges is the person standing at it. */}
                <Button
                  variant="secondary"
                  onClick={() => setRestocking((r) => !r)}
                >
                  <span className="flex items-center gap-1.5">
                    <PackagePlus size={14} /> {restocking ? "Close restock" : "Restock counter"}
                  </span>
                </Button>
                {/* New products are set up in inventory; the counter links there rather than holding
                    a second, divergent way to create the same record. */}
                <Link
                  href="/admin/inventory"
                  className="flex items-center gap-1.5 rounded-xl border border-night-600 px-4 py-2.5 text-sm text-cream-300 transition-colors hover:border-brass-500/60 hover:text-cream-100"
                >
                  <Package size={14} /> Add a product
                </Link>
              </div>

              {restocking && (
                <CounterRestockPanel
                  actor={actor}
                  onDone={(message) => {
                    setNotice(message);
                    setTimeout(() => setNotice(""), 9000);
                    // The counter's on-hand figures just changed.
                    setStockVersion((v) => v + 1);
                  }}
                  onClose={() => setRestocking(false)}
                />
              )}

              {loading ? (
                <p className="mt-3 text-sm text-cream-500">Loading stock…</p>
              ) : matches.length === 0 ? (
                <div className="mt-3">
                  <p className="text-sm text-cream-500">
                    {items.length === 0
                      ? "No stock set up yet."
                      : `Nothing matches “${search}”. Use “Item not listed” to sell it anyway.`}
                  </p>
                  {/* Only offered on a genuinely empty list: a one-press way to get the usual
                      boards, consumables, fittings and services onto the till. Quantities start
                      at zero, so nothing is invented — only the names and prices. */}
                  {items.length === 0 && (
                    <div className="mt-3">
                      <Button variant="secondary" busy={seeding} onClick={seedStock}>
                        Add the usual counter items
                      </Button>
                    </div>
                  )}
                </div>
              ) : (
                <div className="mt-3 flex flex-wrap gap-2">
                  {matches.map((i) => {
                    const out = i.tracksStock && i.quantityOnHand <= 0;
                    return (
                      <button
                        key={i.id}
                        type="button"
                        onClick={() => addFromStock(i.id)}
                        className={`cursor-pointer rounded-xl border px-3 py-2 text-left transition-all duration-200 ${
                          out
                            ? "border-red-500/40 bg-red-500/5 hover:border-red-500/60"
                            : "border-night-600 bg-night-800/50 hover:border-brass-500/60"
                        }`}
                      >
                        <span className="block text-sm text-cream-100">{i.name}</span>
                        <span className="block text-xs text-cream-500">
                          {formatNaira(i.unitPriceKobo)}
                          {i.tracksStock ? (
                            <>
                              {" · "}
                              <span className={out ? "text-red-300" : undefined}>
                                {i.quantityOnHand} {i.unit}
                              </span>
                            </>
                          ) : (
                            " · service"
                          )}
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            {basket.length === 0 ? (
              <p className="mt-5 text-sm text-cream-500">
                Nothing in the sale yet. Pick from stock, or add an item that is not
                stocked.
              </p>
            ) : (
              <>
                <div className="mt-5 space-y-3">
                  {basket.map((l, index) => {
                    const amount = lineAmountKobo(
                      Number(l.quantity) || 0,
                      parseNairaInput(l.priceNaira)
                    );
                    const over =
                      l.onHand !== undefined && Number(l.quantity) > l.onHand;
                    return (
                      <div key={l.key}>
                        <div className="grid gap-3 sm:grid-cols-[1fr_6rem_9rem_auto] sm:items-end">
                          <TextField
                            id={`pos-item-${l.key}`}
                            label={index === 0 ? "Item" : ""}
                            value={l.item}
                            onChange={(v) => patch(l.key, { item: v })}
                            disabled={l.inventoryItemId !== undefined}
                          />
                          <NumberField
                            id={`pos-qty-${l.key}`}
                            label={index === 0 ? "Qty" : ""}
                            value={l.quantity}
                            onChange={(v) => patch(l.key, { quantity: v })}
                          />
                          <NairaField
                            id={`pos-price-${l.key}`}
                            label={index === 0 ? "Unit price" : ""}
                            valueKobo={l.priceNaira}
                            onChangeKobo={(v) => patch(l.key, { priceNaira: v })}
                          />
                          <div className="flex items-center gap-2">
                            <span className="min-w-[5.5rem] text-right text-sm tabular-nums text-cream-200">
                              {formatNaira(amount)}
                            </span>
                            <button
                              type="button"
                              aria-label={`Remove ${l.item || "this line"}`}
                              onClick={() =>
                                setBasket((p) => p.filter((x) => x.key !== l.key))
                              }
                              className="flex h-12 w-11 cursor-pointer items-center justify-center rounded-xl border border-night-600 text-cream-500 transition-colors hover:border-red-500/50 hover:text-red-400"
                            >
                              <Trash2 size={15} />
                            </button>
                          </div>
                        </div>
                        {over && (
                          <p className="mt-1 flex items-center gap-1.5 text-xs text-amber-300">
                            <AlertTriangle size={12} />
                            Only {l.onHand} {l.unit ?? "in stock"} on record
                            {allowNegative
                              ? ", so this will take the count negative."
                              : ". The sale will be refused until the count is corrected."}
                          </p>
                        )}
                      </div>
                    );
                  })}
                </div>

                {/* Payment and adjustments */}
                <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                  <TextField
                    id="pos-customer"
                    label="Customer (optional)"
                    value={customerName}
                    onChange={setCustomerName}
                    hint="walk-in trade needs no name"
                  />
                  <TextField
                    id="pos-phone"
                    label="Phone (optional)"
                    value={customerPhone}
                    onChange={setCustomerPhone}
                  />
                  <NumberField
                    id="pos-discount"
                    label="Discount (%)"
                    value={discountPercent}
                    onChange={setDiscountPercent}
                  />
                  <SelectField
                    id="pos-method"
                    label="Paid by"
                    value={method}
                    onChange={setMethod}
                    options={PAYMENT_METHODS.map((m) => ({
                      value: m,
                      label: PAYMENT_METHOD_LABELS[m],
                    }))}
                  />
                  <SelectField
                    id="pos-tax-mode"
                    label="Tax"
                    value={taxMode}
                    onChange={setTaxMode}
                    options={TAX_MODES.map((m) => ({
                      value: m,
                      label: TAX_MODE_LABELS[m],
                    }))}
                  />
                  <NumberField
                    id="pos-tax-rate"
                    label="Tax rate (%)"
                    value={taxPercent}
                    onChange={setTaxPercent}
                    disabled={taxMode === "none"}
                  />
                  {method === "cash" && (
                    <NairaField
                      id="pos-tendered"
                      label="Cash given"
                      valueKobo={tendered}
                      onChangeKobo={setTendered}
                      hint="to work out change"
                    />
                  )}
                </div>

                {/* Goods on account.
                    A regular customer takes boards and pays on Friday. Without this the cashier
                    either records the sale as paid — inventing takings that never arrived — or
                    does not record it at all, and the stock walks out unaccounted for. Both
                    happen in practice, so the till has to be able to say "gone, not paid". */}
                <div className="mt-5 rounded-2xl border border-night-700/60 bg-night-950/40 p-5">
                  <label className="flex cursor-pointer items-start gap-3 text-sm text-cream-200">
                    <input
                      type="checkbox"
                      checked={onAccount}
                      onChange={(e) => {
                        setOnAccount(e.target.checked);
                        if (!e.target.checked) {
                          setPaidNow("");
                          setDueDate("");
                        }
                      }}
                      className="mt-0.5 size-4 shrink-0 accent-brass-500"
                    />
                    <span>
                      Goods leaving on account
                      <span className="mt-0.5 block text-xs text-cream-500">
                        The customer is paying part, or nothing, today. The balance is tracked
                        against their name until it is collected.
                      </span>
                    </span>
                  </label>

                  {onAccount && (
                    <div className="mt-4 grid gap-4 sm:grid-cols-3">
                      <NairaField
                        id="pos-paid-now"
                        label="Paying now"
                        valueKobo={paidNow}
                        onChangeKobo={setPaidNow}
                        hint="leave empty if paying nothing today"
                      />
                      <DateField
                        id="pos-due"
                        compact
                        label="Balance due by"
                        value={dueDate}
                        onChange={setDueDate}
                        hint="optional"
                      />
                      <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-3">
                        <p className="text-xs uppercase tracking-wider text-amber-300/80">
                          Will be owed
                        </p>
                        <p className="mt-1 font-display text-xl text-amber-300">
                          {formatNaira(owingKobo)}
                        </p>
                      </div>
                    </div>
                  )}
                </div>

                {/* The total, and the change to hand back. */}
                <dl className="mt-6 space-y-2 rounded-2xl border border-night-700/60 bg-night-950/40 p-5 text-sm">
                  <Row label="Subtotal" value={formatNaira(totals.subtotalKobo)} />
                  {totals.discountKobo > 0 && (
                    <Row
                      label={`Discount (${totals.discountPercent}%)`}
                      value={`−${formatNaira(totals.discountKobo)}`}
                      tone="warn"
                    />
                  )}
                  {totals.taxMode !== "none" && (
                    <Row
                      label={
                        `${taxLabel} (${totals.taxPercent}%)` +
                        (totals.taxMode === "inclusive" ? " — included" : "")
                      }
                      value={formatNaira(totals.taxKobo)}
                    />
                  )}
                  <div className="flex items-baseline justify-between gap-4 border-t border-night-700/60 pt-2.5">
                    <dt className="text-cream-200">{onAccount ? "Sale total" : "To pay"}</dt>
                    <dd className="font-display text-2xl text-brass-300">
                      {formatNaira(totals.totalKobo)}
                    </dd>
                  </div>
                  {onAccount && (
                    <>
                      <Row label="Paying now" value={formatNaira(payingKobo)} />
                      <Row
                        label="Balance on account"
                        value={formatNaira(owingKobo)}
                        tone="warn"
                      />
                    </>
                  )}
                  {method === "cash" && tenderedKobo > 0 && (
                    <div className="flex items-baseline justify-between gap-4 pt-1">
                      <dt className={shortKobo > 0 ? "text-red-300" : "text-cream-200"}>
                        {shortKobo > 0 ? "Short by" : "Change"}
                      </dt>
                      <dd
                        className={`font-display text-xl ${
                          shortKobo > 0 ? "text-red-300" : "text-emerald-300"
                        }`}
                      >
                        {formatNaira(shortKobo > 0 ? shortKobo : changeKobo)}
                      </dd>
                    </div>
                  )}
                </dl>

                <div className="mt-6 flex flex-wrap gap-3">
                  <Button
                    onClick={complete}
                    busy={busy}
                    disabled={
                      totals.totalKobo <= 0 ||
                      shortKobo > 0 ||
                      (!allowNegative && overSold.length > 0)
                    }
                  >
                    <span className="flex items-center gap-1.5">
                      <Receipt size={15} />{" "}
                      {onAccount && owingKobo > 0
                        ? "Release on account & print"
                        : "Complete sale & print"}
                    </span>
                  </Button>
                  <Button variant="ghost" onClick={clearBasket}>
                    Clear
                  </Button>
                </div>
              </>
            )}
          </section>
        )}

        {/* Who owes money.
            Separate from recent sales because it is a different job: recent sales is a record to
            check against the till, this is a list to work through with a phone. Oldest first, since
            the six-week-old debt is the one at risk. */}
        <section className="mt-10">
          <div className="flex flex-wrap items-baseline justify-between gap-3">
            <h2 className="flex items-center gap-2 font-display text-lg text-cream-100">
              <Users size={18} className="text-brass-400" /> Owing
            </h2>
            {debtors.length > 0 && (
              <p className="text-sm text-amber-300">
                {formatNaira(sumKobo(debtors.map((d) => d.balanceKobo)))} across{" "}
                {debtors.length} sale{debtors.length === 1 ? "" : "s"}
              </p>
            )}
          </div>

          {debtorsLoading ? (
            <p className="mt-4 text-sm text-cream-500">Loading…</p>
          ) : debtors.length === 0 ? (
            <p className="mt-4 rounded-2xl border border-night-700/60 bg-night-900/30 px-5 py-4 text-sm text-cream-500">
              Nothing outstanding. Every sale on the books has been paid for.
            </p>
          ) : (
            <div className="mt-5 overflow-x-auto rounded-3xl border border-night-700/60">
              <table className="w-full min-w-[52rem] text-left text-sm">
                <thead className="bg-night-900/70 text-xs uppercase tracking-wider text-cream-500">
                  <tr>
                    <th className="px-5 py-3 font-medium">Customer</th>
                    <th className="px-5 py-3 font-medium">Receipt</th>
                    <th className="px-5 py-3 font-medium">Sold</th>
                    <th className="px-5 py-3 font-medium">Due</th>
                    <th className="px-5 py-3 text-right font-medium">Owing</th>
                    <th className="px-5 py-3 text-right font-medium">Collect</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-night-700/60">
                  {debtors.map((d) => (
                    <tr key={d.id} className="text-cream-200">
                      <td className="px-5 py-3">
                        <span className="block text-cream-100">{d.customerName}</span>
                        {d.customerPhone && (
                          <a
                            href={`tel:${d.customerPhone}`}
                            className="text-xs text-brass-300 hover:underline"
                          >
                            {d.customerPhone}
                          </a>
                        )}
                      </td>
                      <td className="px-5 py-3 font-mono text-xs">{d.receiptNumber}</td>
                      <td className="px-5 py-3 text-cream-400">
                        {d.soldAtMs ? new Date(d.soldAtMs).toLocaleDateString() : "—"}
                      </td>
                      <td className="px-5 py-3">
                        {d.dueAtMs ? (
                          <span className={d.overdue ? "text-red-300" : "text-cream-400"}>
                            {new Date(d.dueAtMs).toLocaleDateString()}
                            {d.overdue && " · overdue"}
                          </span>
                        ) : (
                          <span className="text-cream-500">not set</span>
                        )}
                      </td>
                      <td className="px-5 py-3 text-right font-display text-amber-300">
                        {formatNaira(d.balanceKobo)}
                        <span className="mt-0.5 block text-xs font-sans text-cream-500">
                          of {formatNaira(d.totalKobo)}
                        </span>
                      </td>
                      <td className="px-5 py-3">
                        {canSell ? (
                          collecting === d.id ? (
                            <div className="flex flex-wrap items-end justify-end gap-2">
                              <div className="w-32">
                                <NairaField
                                  id={`collect-${d.id}`}
                                  label="Received"
                                  valueKobo={collectAmount}
                                  onChangeKobo={setCollectAmount}
                                />
                              </div>
                              <div className="w-32">
                                <SelectField
                                  id={`collect-method-${d.id}`}
                                  label="By"
                                  value={collectMethod}
                                  onChange={(v) => setCollectMethod(v as PaymentMethod)}
                                  options={PAYMENT_METHODS.map((m) => ({
                                    value: m,
                                    label: PAYMENT_METHOD_LABELS[m],
                                  }))}
                                />
                              </div>
                              <Button
                                busy={busy}
                                onClick={() => collect(d.id, d.balanceKobo)}
                              >
                                Save
                              </Button>
                              <Button variant="ghost" onClick={() => setCollecting(null)}>
                                Cancel
                              </Button>
                            </div>
                          ) : (
                            <div className="flex justify-end">
                              <Button
                                variant="secondary"
                                onClick={() => {
                                  setCollecting(d.id);
                                  // Pre-filled with the whole balance, because settling in full is
                                  // the usual case and a part payment is the edit.
                                  setCollectAmount(String(toNaira(d.balanceKobo)));
                                  setCollectMethod("cash");
                                }}
                              >
                                Take payment
                              </Button>
                            </div>
                          )
                        ) : (
                          <span className="block text-right text-xs text-cream-500">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {/* Recent sales */}
        <section className="mt-10">
          <h2 className="font-display text-lg text-cream-100">Recent sales</h2>
          {sales.length === 0 ? (
            <div className="mt-5">
              <EmptyState
                title="No sales recorded yet"
                hint="Sales made at the counter appear here with their takings and margin."
              />
            </div>
          ) : (
            <div className="mt-5 overflow-x-auto rounded-3xl border border-night-700/60">
              <table className="w-full min-w-[46rem] text-left text-sm">
                <thead className="bg-night-900/70 text-xs uppercase tracking-wider text-cream-500">
                  <tr>
                    <th className="px-5 py-3 font-medium">Receipt</th>
                    <th className="px-5 py-3 font-medium">When</th>
                    <th className="px-5 py-3 font-medium">Customer</th>
                    <th className="px-5 py-3 font-medium">Paid by</th>
                    <th className="px-5 py-3 text-right font-medium">Total</th>
                    <th className="px-5 py-3 text-right font-medium">Margin</th>
                    {canVoid && <th className="px-5 py-3" />}
                  </tr>
                </thead>
                <tbody className="divide-y divide-night-800">
                  {sales.map((s) => {
                    const margin = s.totalKobo - s.taxKobo - s.costOfGoodsKobo;
                    const voided = s.status === "voided";
                    return (
                      <tr
                        key={s.id}
                        className={voided ? "opacity-50" : "transition-colors hover:bg-night-900/40"}
                      >
                        <td className="px-5 py-3.5">
                          <span className="text-cream-100">{s.receiptNumber}</span>
                          {voided && (
                            <StatusPill tone="danger">
                              {SALE_STATUS_LABELS[s.status]}
                            </StatusPill>
                          )}
                          <span className="mt-0.5 block text-xs text-cream-600">
                            {s.lineCount} line{s.lineCount === 1 ? "" : "s"}
                          </span>
                        </td>
                        <td className="px-5 py-3.5 text-xs text-cream-500">
                          {s.soldAtMs
                            ? new Date(s.soldAtMs).toLocaleString("en-GB", {
                                day: "numeric",
                                month: "short",
                                hour: "2-digit",
                                minute: "2-digit",
                              })
                            : "—"}
                        </td>
                        <td className="px-5 py-3.5 text-cream-300">
                          {s.customerName ?? (
                            <span className="text-cream-600">Walk-in</span>
                          )}
                        </td>
                        <td className="px-5 py-3.5 text-cream-400">
                          {PAYMENT_METHOD_LABELS[s.method]}
                        </td>
                        <td className="px-5 py-3.5 text-right tabular-nums text-cream-100">
                          {formatNaira(s.totalKobo)}
                        </td>
                        <td
                          className={`px-5 py-3.5 text-right tabular-nums ${
                            margin < 0 ? "text-red-300" : "text-cream-300"
                          }`}
                        >
                          {voided ? "—" : formatNaira(margin)}
                        </td>
                        {canVoid && (
                          <td className="px-5 py-3.5 text-right">
                            {!voided && (
                              <button
                                type="button"
                                onClick={() => {
                                  const reason = window.prompt(
                                    `Void ${s.receiptNumber}? The stock goes back on the shelf and the takings are reversed. Give a reason.`
                                  );
                                  if (!reason?.trim()) return;
                                  voidSale(getDb(), actor, s.id, reason.trim())
                                    .then(() => {
                                      setNotice(`${s.receiptNumber} voided.`);
                                      setStockVersion((v) => v + 1);
                                      setTimeout(() => setNotice(""), 6000);
                                    })
                                    .catch((e) =>
                                      setError(
                                        e instanceof Error
                                          ? e.message
                                          : "Could not void the sale."
                                      )
                                    );
                                }}
                                className="cursor-pointer text-xs text-cream-500 transition-colors hover:text-red-400"
                              >
                                Void
                              </button>
                            )}
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {items.length === 0 && !loading && (
          <p className="mt-6 flex items-start gap-2 text-sm text-cream-500">
            <Package size={16} className="mt-0.5 shrink-0" />
            No company stock is set up yet. Add items under Inventory → Company stock,
            with a unit cost and a selling price, and they become sellable here.
          </p>
        )}
      </div>
    </div>
  );
}

/** Paper-size selector inside the print preview. */
function PaperChip({
  active,
  onClick,
  label,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`cursor-pointer rounded-full border px-3 py-1.5 text-xs font-medium transition-all duration-300 ${
        active
          ? "border-brass-500 bg-brass-500 text-night-950"
          : "border-night-600 text-cream-300 hover:border-brass-500/60 hover:text-brass-300"
      }`}
    >
      {label}
    </button>
  );
}

function Row({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "warn";
}) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt className="text-cream-400">{label}</dt>
      <dd
        className={`tabular-nums ${tone === "warn" ? "text-amber-300" : "text-cream-200"}`}
      >
        {value}
      </dd>
    </div>
  );
}

function Tile({
  label,
  value,
  tone,
  hint,
}: {
  label: string;
  value: string;
  tone?: "good" | "warn" | "danger";
  hint?: string;
}) {
  const colour =
    tone === "danger"
      ? "text-red-300"
      : tone === "warn"
        ? "text-amber-300"
        : tone === "good"
          ? "text-emerald-300"
          : "text-cream-50";
  return (
    <div className="rounded-3xl border border-night-700/60 bg-night-900/40 p-5">
      <p className="text-xs uppercase tracking-wider text-cream-500">{label}</p>
      <p className={`mt-2 font-display text-2xl ${colour}`}>{value}</p>
      {hint && <p className="mt-1 text-xs text-amber-300/80">{hint}</p>}
    </div>
  );
}

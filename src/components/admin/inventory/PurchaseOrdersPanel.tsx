"use client";

import { useEffect, useMemo, useState } from "react";
import {
  collection,
  onSnapshot,
  orderBy,
  query,
  limit as fsLimit,
  getDocs,
} from "firebase/firestore";
import { CheckCircle2, PackageCheck, Plus, Trash2, Truck } from "lucide-react";
import { getDb } from "@/lib/firebase";
import { COL, purchaseLinesPath } from "@/lib/erp/collections";
import { formatNaira, parseNairaInput, toNaira } from "@/lib/erp/money";
import { createPurchase, receivePurchase } from "@/lib/erp/inventory";
import {
  Button,
  EmptyState,
  NairaField,
  NumberField,
  SelectField,
  TextAreaField,
  TextField,
} from "@/components/admin/ui/Fields";
import { DateField } from "@/components/admin/ui/DateField";
import { useAuditActor, useErpSession } from "@/components/admin/ErpAuthProvider";

interface SupplierOption {
  id: string;
  name: string;
}

interface StockOption {
  id: string;
  name: string;
  unit: string;
  lastCostKobo: number;
}

interface OrderRow {
  id: string;
  supplierId: string;
  supplierName: string;
  reference?: string;
  status: "ordered" | "partial" | "received" | "cancelled";
  totalKobo: number;
  orderedAtMs?: number;
  promisedAtMs?: number;
  receivedAtMs?: number;
  hadIssues?: boolean;
  issueNotes?: string;
}

interface LineRow {
  id: string;
  item: string;
  inventoryItemId?: string | null;
  unit: string;
  quantityOrdered: number;
  quantityReceived?: number;
  quantityRejected?: number;
  unitCostKobo: number;
  amountKobo: number;
}

/** A line being drafted, before it is priced and sent. */
interface DraftLine {
  key: number;
  stockId: string;
  item: string;
  unit: string;
  quantity: string;
  cost: string;
}

const STATUS_LABELS: Record<OrderRow["status"], string> = {
  ordered: "Ordered",
  partial: "Part received",
  received: "Received",
  cancelled: "Cancelled",
};

const todayIso = () => new Date().toLocaleDateString("en-CA");

function newDraftLine(key: number): DraftLine {
  return { key, stockId: "", item: "", unit: "sheet", quantity: "1", cost: "" };
}

/**
 * Purchase orders against a supplier, and receiving them into stock.
 *
 * This is the half of procurement the supplier scorecards are computed from. Lead time comes
 * from the gap between ordering and receiving, on-time rate from `promisedAt` against the day
 * it actually arrived, and defect rate from what was rejected on arrival — so a workshop that
 * never records an order has a scorecard of zeroes and no way to tell a good supplier from a
 * bad one.
 *
 * Receiving is deliberately a separate step from ordering rather than a single "bought it"
 * form: what arrives is routinely not what was ordered, and the difference between the two is
 * the entire point of the record.
 */
export function PurchaseOrdersPanel() {
  const session = useErpSession();
  const canCreate = session.can("purchase.create");
  const canReceive = session.can("purchase.receive");

  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [suppliers, setSuppliers] = useState<SupplierOption[]>([]);
  const [stock, setStock] = useState<StockOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);

  // Ordering
  const [drafting, setDrafting] = useState(false);
  const [supplierId, setSupplierId] = useState("");
  const [reference, setReference] = useState("");
  const [promised, setPromised] = useState("");
  const [lines, setLines] = useState<DraftLine[]>([newDraftLine(0)]);

  // Receiving
  const [receivingId, setReceivingId] = useState("");
  const [receiveLines, setReceiveLines] = useState<LineRow[]>([]);
  const [counts, setCounts] = useState<Record<string, { got: string; bad: string }>>({});
  const [issueNotes, setIssueNotes] = useState("");

  const actor = useAuditActor();

  useEffect(() => {
    const db = getDb();
    /*
     * Capped at the most recent orders. Procurement history is a growing collection and this
     * panel is a working list, not an archive — the scorecards above it hold the long-run
     * figures, so there is nothing here that needs every order ever placed.
     */
    const unsubO = onSnapshot(
      query(collection(db, COL.purchases), orderBy("orderedAt", "desc"), fsLimit(40)),
      (snap) => {
        setOrders(
          snap.docs.map((d) => {
            const x = d.data();
            return {
              id: d.id,
              supplierId: x.supplierId ?? "",
              supplierName: x.supplierName ?? "Unknown supplier",
              reference: x.reference ?? undefined,
              status: (x.status ?? "ordered") as OrderRow["status"],
              totalKobo: x.totalKobo ?? 0,
              orderedAtMs: x.orderedAt?.toMillis?.(),
              promisedAtMs: x.promisedAt?.toMillis?.(),
              receivedAtMs: x.receivedAt?.toMillis?.(),
              hadIssues: x.hadIssues ?? false,
              issueNotes: x.issueNotes ?? undefined,
            };
          })
        );
        setLoading(false);
      },
      (e) => {
        setError(e.message);
        setLoading(false);
      }
    );

    const unsubS = onSnapshot(
      query(collection(db, COL.suppliers), orderBy("name", "asc")),
      (snap) =>
        setSuppliers(
          snap.docs
            // Only suppliers still trading can be ordered from; a deactivated one stays on
            // the scorecards above but is not a choice here.
            .filter((d) => d.data().active !== false)
            .map((d) => ({ id: d.id, name: d.data().name ?? "" }))
        )
    );

    const unsubI = onSnapshot(
      query(collection(db, COL.inventoryCompany), orderBy("name", "asc")),
      (snap) =>
        setStock(
          snap.docs.map((d) => {
            const x = d.data();
            return {
              id: d.id,
              name: x.name ?? "",
              unit: x.unit ?? "sheet",
              lastCostKobo: x.averageCostKobo ?? x.lastCostKobo ?? 0,
            };
          })
        )
    );

    return () => {
      unsubO();
      unsubS();
      unsubI();
    };
  }, []);

  const draftTotalKobo = useMemo(
    () =>
      lines.reduce((sum, l) => {
        const qty = Number(l.quantity) || 0;
        const cost = parseNairaInput(l.cost) ?? 0;
        return sum + Math.round(qty * cost);
      }, 0),
    [lines]
  );

  function resetDraft() {
    setDrafting(false);
    setSupplierId("");
    setReference("");
    setPromised("");
    setLines([newDraftLine(0)]);
  }

  /** Picking a stock item fills the unit and the last cost, which is usually the right one. */
  function chooseStock(key: number, stockId: string) {
    const item = stock.find((s) => s.id === stockId);
    setLines((prev) =>
      prev.map((l) =>
        l.key !== key
          ? l
          : {
              ...l,
              stockId,
              item: item?.name ?? l.item,
              unit: item?.unit ?? l.unit,
              cost:
                item && item.lastCostKobo > 0
                  ? String(toNaira(item.lastCostKobo))
                  : l.cost,
            }
      )
    );
  }

  async function submitOrder() {
    const supplier = suppliers.find((s) => s.id === supplierId);
    if (!supplier) {
      setError("Choose a supplier for this order.");
      return;
    }
    const priced = lines
      .map((l) => ({
        item: l.item.trim(),
        inventoryItemId: l.stockId || undefined,
        quantityOrdered: Number(l.quantity) || 0,
        unit: l.unit.trim() || "sheet",
        unitCostKobo: parseNairaInput(l.cost) ?? 0,
      }))
      .filter((l) => l.item && l.quantityOrdered > 0);

    if (priced.length === 0) {
      setError("Add at least one line with a description and a quantity.");
      return;
    }

    setBusy(true);
    setError("");
    try {
      await createPurchase(getDb(), actor, {
        supplierId: supplier.id,
        supplierName: supplier.name,
        reference: reference.trim() || undefined,
        // Parsed as a local date at midday so the day cannot drift either side of a timezone.
        promisedAt: promised ? new Date(`${promised}T12:00:00`) : undefined,
        lines: priced,
      });
      setNotice(`Order placed with ${supplier.name} for ${formatNaira(draftTotalKobo)}.`);
      setTimeout(() => setNotice(""), 6000);
      resetDraft();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not place the order.");
    } finally {
      setBusy(false);
    }
  }

  /** Opens the receiving form, defaulting every line to "all of it arrived, none rejected". */
  async function openReceive(order: OrderRow) {
    setError("");
    setReceivingId(order.id);
    setIssueNotes("");
    try {
      const snap = await getDocs(collection(getDb(), purchaseLinesPath(order.id)));
      const rows = snap.docs.map((d) => {
        const x = d.data();
        return {
          id: d.id,
          item: x.item ?? "",
          inventoryItemId: x.inventoryItemId ?? null,
          unit: x.unit ?? "sheet",
          quantityOrdered: x.quantityOrdered ?? 0,
          quantityReceived: x.quantityReceived ?? undefined,
          quantityRejected: x.quantityRejected ?? undefined,
          unitCostKobo: x.unitCostKobo ?? 0,
          amountKobo: x.amountKobo ?? 0,
        };
      });
      setReceiveLines(rows);
      setCounts(
        Object.fromEntries(
          rows.map((r) => [r.id, { got: String(r.quantityOrdered), bad: "0" }])
        )
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not read the order lines.");
      setReceivingId("");
    }
  }

  async function submitReceive() {
    const order = orders.find((o) => o.id === receivingId);
    if (!order) return;

    setBusy(true);
    setError("");
    try {
      await receivePurchase(
        getDb(),
        actor,
        order.id,
        receiveLines.map((l) => ({
          lineId: l.id,
          quantityReceived: Number(counts[l.id]?.got ?? 0) || 0,
          quantityRejected: Number(counts[l.id]?.bad ?? 0) || 0,
        })),
        issueNotes.trim() || undefined
      );
      setNotice(
        `Received ${order.reference ?? "the order"} from ${order.supplierName}. ` +
          "Stock and the supplier's scorecard are updated."
      );
      setTimeout(() => setNotice(""), 7000);
      setReceivingId("");
      setReceiveLines([]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not record the receipt.");
    } finally {
      setBusy(false);
    }
  }

  const receiving = orders.find((o) => o.id === receivingId);

  return (
    <section className="mt-8 rounded-3xl border border-night-700/60 bg-night-900/30 p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 font-display text-lg text-cream-100">
            <Truck size={18} className="text-brass-400" /> Purchase orders
          </h2>
          <p className="mt-1 text-sm text-cream-500">
            What was ordered, what arrived, and how late. The supplier scores above are
            computed from these.
          </p>
        </div>
        {canCreate && !drafting && (
          <Button onClick={() => setDrafting(true)} disabled={busy}>
            <Plus size={15} /> New order
          </Button>
        )}
      </div>

      {error && (
        <p role="alert" className="mt-4 text-sm text-red-400">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="mt-4 flex items-center gap-1.5 text-sm text-emerald-400">
          <CheckCircle2 size={15} /> {notice}
        </p>
      )}

      {/* --- Drafting an order ------------------------------------------------ */}
      {drafting && (
        <div className="mt-5 rounded-2xl border border-night-700/70 bg-night-950/40 p-5">
          <div className="grid gap-4 sm:grid-cols-3">
            <SelectField
              id="po-supplier"
              label="Supplier"
              value={supplierId}
              onChange={setSupplierId}
              options={[
                { value: "", label: "Choose a supplier…" },
                ...suppliers.map((s) => ({ value: s.id, label: s.name })),
              ]}
            />
            <TextField
              id="po-ref"
              label="Reference"
              value={reference}
              onChange={setReference}
              placeholder="e.g. INV-4471 or a waybill number"
            />
            <DateField
              id="po-promised"
              label="Promised for"
              value={promised}
              onChange={setPromised}
              min={todayIso()}
              hint="Used for the on-time rate"
            />
          </div>

          <div className="mt-5 space-y-3">
            {lines.map((l) => (
              <div
                key={l.key}
                className="grid gap-3 rounded-xl border border-night-700/60 bg-night-900/40 p-3 sm:grid-cols-[2fr_1fr_1fr_1fr_auto]"
              >
                <SelectField
                  id={`po-stock-${l.key}`}
                  label="Stock item"
                  value={l.stockId}
                  onChange={(v) => chooseStock(l.key, v)}
                  options={[
                    { value: "", label: "Not tracked in stock" },
                    ...stock.map((s) => ({ value: s.id, label: s.name })),
                  ]}
                />
                <TextField
                  id={`po-item-${l.key}`}
                  label="Description"
                  value={l.item}
                  onChange={(v) =>
                    setLines((prev) =>
                      prev.map((x) => (x.key === l.key ? { ...x, item: v } : x))
                    )
                  }
                  placeholder="What is being bought"
                />
                <NumberField
                  id={`po-qty-${l.key}`}
                  label={`Quantity (${l.unit})`}
                  value={l.quantity}
                  onChange={(v) =>
                    setLines((prev) =>
                      prev.map((x) => (x.key === l.key ? { ...x, quantity: v } : x))
                    )
                  }
                  min={0}
                />
                <NairaField
                  id={`po-cost-${l.key}`}
                  label="Unit cost"
                  valueKobo={l.cost}
                  onChangeKobo={(v: string) =>
                    setLines((prev) =>
                      prev.map((x) => (x.key === l.key ? { ...x, cost: v } : x))
                    )
                  }
                />
                <div className="flex items-end">
                  <button
                    type="button"
                    aria-label="Remove this line"
                    // Never removable down to nothing: an order with no lines cannot be
                    // placed, and an empty form is harder to recover from than one blank row.
                    disabled={lines.length === 1}
                    onClick={() =>
                      setLines((prev) => prev.filter((x) => x.key !== l.key))
                    }
                    className="cursor-pointer rounded-xl border border-night-600 p-2.5 text-cream-400 transition-all duration-300 hover:border-red-500/60 hover:text-red-300 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
              </div>
            ))}
          </div>

          <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
            <button
              type="button"
              onClick={() =>
                setLines((prev) => [
                  ...prev,
                  newDraftLine(Math.max(...prev.map((p) => p.key)) + 1),
                ])
              }
              className="cursor-pointer text-sm text-brass-300 transition-all duration-300 hover:text-brass-200"
            >
              + Add another line
            </button>
            <p className="text-sm text-cream-300">
              Order total{" "}
              <span className="font-medium text-cream-100">
                {formatNaira(draftTotalKobo)}
              </span>
            </p>
          </div>

          <div className="mt-5 flex flex-wrap gap-3">
            <Button onClick={submitOrder} disabled={busy}>
              {busy ? "Placing…" : "Place the order"}
            </Button>
            <Button variant="ghost" onClick={resetDraft} disabled={busy}>
              Cancel
            </Button>
          </div>
        </div>
      )}

      {/* --- Receiving ------------------------------------------------------- */}
      {receiving && (
        <div className="mt-5 rounded-2xl border border-brass-500/40 bg-night-950/40 p-5">
          <h3 className="font-display text-base text-cream-100">
            Receiving {receiving.reference ?? "order"} from {receiving.supplierName}
          </h3>
          <p className="mt-1 text-sm text-cream-500">
            Count what actually arrived. Anything short or rejected is recorded against the
            supplier, and only the accepted quantity goes into stock.
          </p>

          <div className="mt-4 space-y-3">
            {receiveLines.map((l) => (
              <div
                key={l.id}
                className="grid gap-3 rounded-xl border border-night-700/60 bg-night-900/40 p-3 sm:grid-cols-[2fr_1fr_1fr]"
              >
                <div className="self-center">
                  <p className="text-sm text-cream-200">{l.item}</p>
                  <p className="text-xs text-cream-500">
                    {l.quantityOrdered} {l.unit} ordered at {formatNaira(l.unitCostKobo)}
                  </p>
                </div>
                <NumberField
                  id={`rc-got-${l.id}`}
                  label="Accepted"
                  value={counts[l.id]?.got ?? "0"}
                  onChange={(v) =>
                    setCounts((prev) => ({
                      ...prev,
                      [l.id]: { got: v, bad: prev[l.id]?.bad ?? "0" },
                    }))
                  }
                  min={0}
                />
                <NumberField
                  id={`rc-bad-${l.id}`}
                  label="Rejected"
                  value={counts[l.id]?.bad ?? "0"}
                  onChange={(v) =>
                    setCounts((prev) => ({
                      ...prev,
                      [l.id]: { got: prev[l.id]?.got ?? "0", bad: v },
                    }))
                  }
                  min={0}
                />
              </div>
            ))}
          </div>

          <div className="mt-4">
            <TextAreaField
              id="rc-notes"
              label="Notes on any problem (optional)"
              value={issueNotes}
              onChange={setIssueNotes}
              placeholder="e.g. six sheets water-damaged, driver took them back"
              rows={2}
            />
          </div>

          <div className="mt-5 flex flex-wrap gap-3">
            <Button onClick={submitReceive} disabled={busy}>
              <PackageCheck size={15} /> {busy ? "Recording…" : "Record the receipt"}
            </Button>
            <Button
              variant="ghost"
              onClick={() => {
                setReceivingId("");
                setReceiveLines([]);
              }}
              disabled={busy}
            >
              Cancel
            </Button>
          </div>
        </div>
      )}

      {/* --- The list -------------------------------------------------------- */}
      {loading ? (
        <p className="mt-5 text-sm text-cream-500">Loading orders…</p>
      ) : orders.length === 0 ? (
        <div className="mt-5">
          <EmptyState
            title="No purchase orders yet"
            hint={
              canCreate
                ? "Place one to start building a supplier's lead time and on-time record."
                : "Orders placed by the office will show here."
            }
          />
        </div>
      ) : (
        <div className="mt-5 overflow-x-auto">
          <table className="w-full min-w-[46rem] text-sm">
            <thead className="text-left text-xs uppercase tracking-wide text-cream-500">
              <tr>
                <th className="pb-2 pr-3 font-medium">Supplier</th>
                <th className="pb-2 pr-3 font-medium">Reference</th>
                <th className="pb-2 pr-3 font-medium">Ordered</th>
                <th className="pb-2 pr-3 font-medium">Promised</th>
                <th className="pb-2 pr-3 text-right font-medium">Total</th>
                <th className="pb-2 pr-3 font-medium">Status</th>
                <th className="pb-2 font-medium" />
              </tr>
            </thead>
            <tbody className="text-cream-200">
              {orders.map((o) => {
                const late =
                  o.promisedAtMs !== undefined &&
                  (o.receivedAtMs ?? Date.now()) > o.promisedAtMs;
                return (
                  <tr key={o.id} className="border-t border-night-700/50">
                    <td className="py-2.5 pr-3">{o.supplierName}</td>
                    <td className="py-2.5 pr-3 text-cream-400">{o.reference ?? "—"}</td>
                    <td className="py-2.5 pr-3 text-cream-400">
                      {o.orderedAtMs
                        ? new Date(o.orderedAtMs).toLocaleDateString("en-GB", {
                            day: "numeric",
                            month: "short",
                          })
                        : "—"}
                    </td>
                    <td className="py-2.5 pr-3">
                      {o.promisedAtMs ? (
                        <span className={late ? "text-amber-300" : "text-cream-400"}>
                          {new Date(o.promisedAtMs).toLocaleDateString("en-GB", {
                            day: "numeric",
                            month: "short",
                          })}
                          {late && o.status !== "received" ? " · overdue" : ""}
                        </span>
                      ) : (
                        <span className="text-cream-500">—</span>
                      )}
                    </td>
                    <td className="py-2.5 pr-3 text-right">{formatNaira(o.totalKobo)}</td>
                    <td className="py-2.5 pr-3">
                      <span
                        className={
                          o.status === "received"
                            ? o.hadIssues
                              ? "text-amber-300"
                              : "text-emerald-400"
                            : "text-cream-300"
                        }
                        title={o.issueNotes ?? undefined}
                      >
                        {STATUS_LABELS[o.status]}
                        {o.status === "received" && o.hadIssues ? " · with issues" : ""}
                      </span>
                    </td>
                    <td className="py-2.5">
                      {canReceive && o.status !== "received" && o.status !== "cancelled" && (
                        <button
                          type="button"
                          onClick={() => openReceive(o)}
                          disabled={busy || receivingId === o.id}
                          className="cursor-pointer rounded-lg border border-night-600 px-3 py-1.5 text-xs text-cream-200 transition-all duration-300 hover:border-brass-500/60 hover:text-brass-300 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          Receive
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

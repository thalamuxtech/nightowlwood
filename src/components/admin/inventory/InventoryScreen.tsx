"use client";

import { useEffect, useMemo, useState } from "react";
import { collection, limit, onSnapshot, orderBy, query } from "firebase/firestore";
import {
  AlertTriangle,
  ArrowDownToLine,
  ArrowUpFromLine,
  ClipboardCheck,
  Loader2,
  Package,
  PenLine,
  Plus,
  RotateCcw,
  ShieldAlert,
  Trash2,
} from "lucide-react";
import { getDb } from "@/lib/firebase";
import { COL, inventoryMovementsPath } from "@/lib/erp/collections";
import { formatNaira, parseNairaInput, toNaira } from "@/lib/erp/money";
import {
  createInventoryItem,
  deleteInventoryItem,
  recordMovement,
  setInventoryItemActive,
  updateInventoryItem,
} from "@/lib/erp/inventory";
import type { MovementType } from "@/lib/erp/enums";
import { StatusPill } from "@/components/admin/ui/StatusPill";
import {
  Button,
  EmptyState,
  NumberField,
  SelectField,
  TextField,
} from "@/components/admin/ui/Fields";
import { useAuditActor, useErpSession } from "@/components/admin/ErpAuthProvider";
import type { AuditActor } from "@/lib/erp/audit";
import { useConfirmBoolean } from "@/components/admin/ui/ConfirmDialog";

interface ItemRow {
  id: string;
  name: string;
  category: string;
  unit: string;
  quantityOnHand: number;
  reorderLevel: number;
  unitCostKobo: number;
  supplier?: string;
  sku?: string;
  active: boolean;
  lastRestockedAtMs: number | null;
}

interface MovementRow {
  id: string;
  type: MovementType;
  quantity: number;
  reason: string;
  /** Who took it. Recorded for stock going out; absent on receipts and stock-takes. */
  issuedToName?: string;
  balanceAfter: number;
  atMs: number | null;
}

/**
 * Company inventory.
 *
 * Sorted with the items that need attention first: out of stock, then at or
 * below the reorder level, then everything else. A list sorted alphabetically
 * buries the one thing you needed to know.
 */
export function InventoryScreen() {
  const session = useErpSession();
  const canEdit = session.can("inventory.edit");
  // Deleting is admin-only app-wide: record.delete is not grantable to a manager.
  const canDelete = session.can("record.delete");

  const [rows, setRows] = useState<ItemRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [adding, setAdding] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [onlyLow, setOnlyLow] = useState(false);

  useEffect(() => {
    const q = query(collection(getDb(), COL.inventoryCompany), orderBy("name", "asc"));
    return onSnapshot(
      q,
      (snap) => {
        // Retired items are read too, not filtered out at the snapshot: a
        // retirement has to be reversible, and an item the query never returns
        // could not be restored from this screen.
        setRows(
          snap.docs.map((d) => {
            const x = d.data();
            return {
              id: d.id,
              name: x.name ?? "",
              category: x.category ?? "",
              unit: x.unit ?? "",
              quantityOnHand: x.quantityOnHand ?? 0,
              reorderLevel: x.reorderLevel ?? 0,
              unitCostKobo: x.unitCostKobo ?? 0,
              supplier: x.supplier ?? undefined,
              sku: x.sku ?? undefined,
              active: x.active !== false,
              lastRestockedAtMs: x.lastRestockedAt?.toMillis?.() ?? null,
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
  }, []);

  const actor = useAuditActor();

  const active = useMemo(() => rows.filter((r) => r.active), [rows]);
  const retired = useMemo(() => rows.filter((r) => !r.active), [rows]);

  /** Urgency, not alphabet: out of stock first, then low, then the rest. */
  const sorted = useMemo(() => {
    const rank = (r: ItemRow) => {
      if (r.quantityOnHand === 0) return 0;
      if (r.reorderLevel > 0 && r.quantityOnHand <= r.reorderLevel) return 1;
      return 2;
    };
    return [...active]
      .filter((r) => !onlyLow || (r.reorderLevel > 0 && r.quantityOnHand <= r.reorderLevel))
      .sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
  }, [active, onlyLow]);

  // Retired items are excluded from every figure: they are no longer stock the
  // business intends to hold, so counting them would overstate what is on hand.
  const stats = useMemo(() => {
    const low = active.filter((r) => r.reorderLevel > 0 && r.quantityOnHand <= r.reorderLevel);
    return {
      items: active.length,
      low: low.length,
      out: active.filter((r) => r.quantityOnHand === 0).length,
      value: active.reduce((s, r) => s + r.quantityOnHand * r.unitCostKobo, 0),
    };
  }, [active]);

  return (
    <div className="mx-auto max-w-6xl pb-20">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-eyebrow">Inventory</p>
          <h1 className="text-title mt-3 text-cream-50">Company stock</h1>
          <p className="mt-3 max-w-2xl text-sm leading-relaxed text-cream-400">
            Materials and consumables Nightowl owns. Customer boards are held
            separately, since those are never ours to issue.
          </p>
        </div>
        {canEdit && !adding && (
          <Button onClick={() => setAdding(true)}>
            <span className="flex items-center gap-2">
              <Plus size={15} /> Add item
            </span>
          </Button>
        )}
      </header>

      {error && (
        <p
          role="alert"
          className="mt-6 flex items-start gap-2 rounded-xl border border-red-500/30 bg-red-500/5 px-4 py-3 text-sm text-red-400"
        >
          <ShieldAlert size={16} className="mt-0.5 shrink-0" /> {error}
        </p>
      )}

      <div className="mt-8 grid gap-4 sm:grid-cols-4">
        <Tile label="Items" value={String(stats.items)} />
        <Tile
          label="At reorder level"
          value={String(stats.low)}
          tone={stats.low > 0 ? "warn" : undefined}
        />
        <Tile
          label="Out of stock"
          value={String(stats.out)}
          tone={stats.out > 0 ? "danger" : undefined}
        />
        <Tile label="Stock value" value={formatNaira(stats.value)} />
      </div>

      {adding && (
        <ItemForm actor={actor} onClose={() => setAdding(false)} onError={setError} />
      )}

      {stats.low > 0 && (
        <button
          type="button"
          onClick={() => setOnlyLow((v) => !v)}
          className={`mt-8 flex cursor-pointer items-center gap-2 rounded-xl border px-4 py-2.5 text-sm transition-colors ${
            onlyLow
              ? "border-amber-500 bg-amber-500/10 text-amber-300"
              : "border-amber-500/40 bg-amber-500/5 text-amber-300 hover:border-amber-500"
          }`}
        >
          <AlertTriangle size={15} />
          {onlyLow
            ? "Showing only items needing a reorder"
            : `${stats.low} item${stats.low === 1 ? "" : "s"} need reordering`}
        </button>
      )}

      {loading ? (
        <div className="mt-10 flex justify-center py-10">
          <Loader2 className="animate-spin text-brass-400" size={26} aria-label="Loading" />
        </div>
      ) : sorted.length === 0 ? (
        <div className="mt-8">
          <EmptyState
            title={active.length === 0 ? "No stock recorded" : "Nothing needs reordering"}
            hint={
              active.length === 0
                ? "Add the boards, tape, gum and fittings you keep on hand."
                : "Every item is above its reorder level."
            }
          />
        </div>
      ) : (
        <div className="mt-6 space-y-3">
          {sorted.map((r) => (
            <ItemPanel
              key={r.id}
              item={r}
              open={openId === r.id}
              onToggle={() => setOpenId(openId === r.id ? null : r.id)}
              canEdit={canEdit}
              canDelete={canDelete}
              actor={actor}
              onError={setError}
            />
          ))}
        </div>
      )}

      {/* Retired items are kept visible but out of the way: their movement
          history still explains past stock, and restoring one must be possible. */}
      {retired.length > 0 && (
        <section className="mt-10">
          <h2 className="text-xs uppercase tracking-wider text-cream-500">
            Retired ({retired.length})
          </h2>
          <div className="mt-3 space-y-3 opacity-60">
            {retired.map((r) => (
              <ItemPanel
                key={r.id}
                item={r}
                open={openId === r.id}
                onToggle={() => setOpenId(openId === r.id ? null : r.id)}
                canEdit={canEdit}
                canDelete={canDelete}
                actor={actor}
                onError={setError}
              />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function ItemPanel({
  item,
  open,
  onToggle,
  canEdit,
  canDelete,
  actor,
  onError,
}: {
  item: ItemRow;
  open: boolean;
  onToggle: () => void;
  canEdit: boolean;
  canDelete: boolean;
  actor: AuditActor;
  onError: (m: string) => void;
}) {
  const { confirm, dialog } = useConfirmBoolean();
  const [movements, setMovements] = useState<MovementRow[]>([]);
  const [mode, setMode] = useState<MovementType | null>(null);
  const [editing, setEditing] = useState(false);
  const [qty, setQty] = useState("");
  const [reason, setReason] = useState("");
  /** Who the stock is going to. Required when issuing. */
  const [issuedTo, setIssuedTo] = useState("");
  /** What a delivery cost per unit, which re-blends the weighted average. */
  const [unitCost, setUnitCost] = useState("");
  /** Staff names, offered as suggestions so the common case is one keystroke. */
  const [staff, setStaff] = useState<Array<{ id: string; name: string }>>([]);

  useEffect(() => {
    if (!open) return;
    return onSnapshot(
      query(collection(getDb(), COL.staff), orderBy("name", "asc")),
      (snap) =>
        setStaff(
          snap.docs
            .filter((d) => d.data().active !== false)
            .map((d) => ({ id: d.id, name: (d.data().name as string) ?? "" }))
        ),
      // A missing staff list only costs the suggestions; the field still accepts a name.
      () => {}
    );
  }, [open]);
  const [busy, setBusy] = useState(false);

  // Only the open item subscribes to its ledger: a shelf of 40 items would
  // otherwise hold 40 listeners for history nobody is reading.
  useEffect(() => {
    if (!open) return;
    return onSnapshot(
      query(
        collection(getDb(), inventoryMovementsPath(item.id)),
        orderBy("createdAt", "desc"),
        limit(25)
      ),
      (snap) =>
        setMovements(
          snap.docs.map((d) => ({
            id: d.id,
            type: (d.data().type as MovementType) ?? "in",
            quantity: d.data().quantity ?? 0,
            reason: d.data().reason ?? "",
            issuedToName: (d.data().issuedToName as string | null) ?? undefined,
            balanceAfter: d.data().balanceAfter ?? 0,
            atMs: d.data().createdAt?.toMillis?.() ?? null,
          }))
        ),
      () => {}
    );
  }, [open, item.id]);

  const out = item.quantityOnHand === 0;
  const low = item.reorderLevel > 0 && item.quantityOnHand <= item.reorderLevel;

  async function submit() {
    if (!mode) return;
    const n = Number(qty);
    if (!(n >= 0) || (mode !== "adjust" && n <= 0)) {
      onError("Enter a quantity.");
      return;
    }
    // Stock going out has to name a receiver. The write layer enforces it too; catching
    // it here means the message lands next to the field rather than as a thrown error.
    if (mode === "out" && !issuedTo.trim()) {
      onError("Record who the stock is being issued to.");
      return;
    }
    setBusy(true);
    try {
      await recordMovement(getDb(), actor, item.id, {
        type: mode,
        quantity: n,
        reason: reason.trim() || defaultReason(mode),
        /*
         * What was paid on this delivery, which re-blends the weighted average.
         *
         * Without it the average never moves for stock received here rather than through a purchase
         * order — so every later sale of that item is costed at a price the workshop stopped paying.
         * Optional: left empty the average is kept as it stands, which is the honest outcome when
         * nobody knows what the delivery cost.
         */
        ...(mode === "in" && unitCost.trim()
          ? { unitCostKobo: parseNairaInput(unitCost) }
          : {}),
        ...(mode === "out"
          ? {
              issuedToName: issuedTo.trim(),
              // Linked to a staff record where the name matches one, so the movement can
              // be counted against a person later. Free text still stands on its own for
              // a fitter on site or a driver collecting.
              issuedToStaffId: staff.find(
                (s) => s.name.toLowerCase() === issuedTo.trim().toLowerCase()
              )?.id,
            }
          : {}),
      });
      setMode(null);
      setQty("");
      setReason("");
      setIssuedTo("");
      setUnitCost("");
    } catch (e) {
      onError(e instanceof Error ? e.message : "Could not record the movement.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className={`overflow-hidden rounded-2xl border ${
        out
          ? "border-red-500/40 bg-red-500/5"
          : low
            ? "border-amber-500/40 bg-amber-500/5"
            : "border-night-700/60 bg-night-900/40"
      }`}
    >
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="flex w-full cursor-pointer items-center justify-between gap-4 p-5 text-left"
      >
        <span className="flex min-w-0 items-center gap-3">
          <Package
            size={17}
            className={`shrink-0 ${out ? "text-red-400" : low ? "text-amber-400" : "text-cream-500"}`}
          />
          <span className="min-w-0">
            <span className="block truncate text-cream-100">{item.name}</span>
            <span className="block text-xs text-cream-500">
              {item.category}
              {item.supplier ? ` · ${item.supplier}` : ""}
            </span>
          </span>
        </span>
        <span className="flex shrink-0 items-center gap-3">
          {!item.active ? (
            <StatusPill tone="neutral">Retired</StatusPill>
          ) : out ? (
            <StatusPill tone="danger">Out of stock</StatusPill>
          ) : low ? (
            <StatusPill tone="warn">Reorder</StatusPill>
          ) : null}
          <span className="text-right">
            <span className="block font-display text-lg text-cream-50">
              {item.quantityOnHand}
              <span className="ml-1 text-xs font-normal text-cream-500">{item.unit}</span>
            </span>
            <span className="block text-xs text-cream-500">
              {formatNaira(item.quantityOnHand * item.unitCostKobo)}
            </span>
          </span>
        </span>
      </button>

      {open && (
        <div className="border-t border-night-700/60 p-5">
          <dl className="grid gap-4 text-sm sm:grid-cols-3">
            <Detail label="Reorder level" value={`${item.reorderLevel} ${item.unit}`} />
            <Detail label="Average cost" value={formatNaira(item.unitCostKobo)} />
            <Detail
              label="Last restocked"
              value={
                item.lastRestockedAtMs
                  ? new Date(item.lastRestockedAtMs).toLocaleDateString("en-GB")
                  : "Never"
              }
            />
            {item.sku && <Detail label="SKU" value={item.sku} />}
          </dl>

          {canEdit && (
            <div className="mt-5 flex flex-wrap gap-3">
              {!editing && (
                <button
                  type="button"
                  onClick={() => setEditing(true)}
                  className="flex cursor-pointer items-center gap-2 text-sm text-brass-300 transition-colors hover:text-brass-200"
                >
                  <PenLine size={15} /> Edit details
                </button>
              )}
              <button
                type="button"
                onClick={() =>
                  setInventoryItemActive(
                    getDb(),
                    actor,
                    item.id,
                    !item.active,
                    item.name
                  ).catch((e) =>
                    onError(
                      e instanceof Error
                        ? e.message
                        : item.active
                          ? "Could not retire the item."
                          : "Could not restore the item."
                    )
                  )
                }
                // Retiring rather than deleting: the movement ledger is the
                // record of stock that passed through, and removing the item
                // would leave those movements pointing at nothing.
                className={`flex cursor-pointer items-center gap-2 text-sm transition-colors ${
                  item.active
                    ? "text-cream-500 hover:text-amber-300"
                    : "text-cream-500 hover:text-brass-300"
                }`}
              >
                <RotateCcw size={14} /> {item.active ? "Retire item" : "Restore item"}
              </button>

              {/* Delete is for the mistake case: an item typed in wrongly and
                  caught before any stock moved. The library refuses once there is
                  a movement or a quantity on hand, and says to retire instead, so
                  the ledger can never be orphaned by a click here. */}
              {canDelete && (
                <button
                  type="button"
                  onClick={async () => {
                    const ok = await confirm({
                      title: `Delete "${item.name}"?`,
                      body: "This only works if no stock has ever moved through it — otherwise retire it instead.",
                      confirmLabel: "Delete item",
                      tone: "danger",
                    });
                    if (!ok) return;
                    deleteInventoryItem(getDb(), actor, item.id, item.name).catch(
                      (e) =>
                        onError(
                          e instanceof Error ? e.message : "Could not delete the item."
                        )
                    );
                  }}
                  className="flex cursor-pointer items-center gap-2 text-sm text-cream-500 transition-colors hover:text-red-400"
                >
                  <Trash2 size={14} /> Delete
                </button>
              )}
            </div>
          )}

          {canEdit && editing && (
            <ItemForm
              actor={actor}
              editing={item}
              onClose={() => setEditing(false)}
              onError={onError}
            />
          )}

          {canEdit && item.active && (
            <div className="mt-5">
              {mode ? (
                <div className="rounded-xl border border-night-700/60 bg-night-950/40 p-4">
                  <p className="text-sm text-cream-200">
                    {mode === "in"
                      ? "Receive stock"
                      : mode === "out"
                        ? "Issue stock"
                        : "Correct the count"}
                  </p>
                  <div className="mt-3 grid gap-3 sm:grid-cols-2">
                    <NumberField
                      id={`qty-${item.id}`}
                      label={mode === "adjust" ? "Counted quantity" : "Quantity"}
                      value={qty}
                      onChange={setQty}
                    />
                    <TextField
                      id={`reason-${item.id}`}
                      label="Reason"
                      value={reason}
                      onChange={setReason}
                      placeholder={defaultReason(mode)}
                    />
                    {/* What the delivery cost, per unit.
                        This is what re-blends the weighted average the stock is valued at and that
                        a counter sale is costed from. Only on an `in`: issuing stock is costed *at*
                        the average, and a stock-take says nothing about price. Optional, because
                        somebody recording a delivery may genuinely not have the invoice yet — left
                        empty the average stands unchanged, which is better than blending against a
                        guess. */}
                    {mode === "in" && (
                      <div className="sm:col-span-2">
                        <NumberField
                          id={`cost-${item.id}`}
                          label="Cost per unit on this delivery (₦)"
                          value={unitCost}
                          onChange={setUnitCost}
                          hint={`currently averaging ${formatNaira(item.unitCostKobo)}`}
                        />
                      </div>
                    )}
                    {/* Who is taking it. Only for stock going out: an `in` movement has a
                        supplier, and an `adjust` is a stock-take where nobody took
                        anything. A datalist rather than a locked dropdown, because the
                        receiver is often not on the staff list — a fitter on site, a
                        driver collecting. */}
                    {mode === "out" && (
                      <div className="sm:col-span-2">
                        <label
                          htmlFor={`issued-${item.id}`}
                          className="mb-1.5 block text-sm text-cream-300"
                        >
                          Issued to <span className="ml-1 text-brass-400">*</span>
                        </label>
                        <input
                          id={`issued-${item.id}`}
                          list={`staff-list-${item.id}`}
                          value={issuedTo}
                          onChange={(e) => setIssuedTo(e.target.value)}
                          placeholder="Who is taking it"
                          className="w-full rounded-xl border border-night-600 bg-night-800/60 px-4 py-3 text-cream-100 placeholder:text-cream-600 focus:border-brass-500 focus:outline-none"
                        />
                        <datalist id={`staff-list-${item.id}`}>
                          {staff.map((s) => (
                            <option key={s.id} value={s.name} />
                          ))}
                        </datalist>
                      </div>
                    )}
                  </div>
                  {mode === "out" && (
                    <p className="mt-2 text-xs text-cream-500">
                      Only {item.quantityOnHand} on hand. Issuing more is refused, since
                      a negative balance would hide a miscount.
                    </p>
                  )}
                  <div className="mt-4 flex gap-2">
                    <Button onClick={submit} busy={busy}>
                      Record
                    </Button>
                    <Button variant="ghost" onClick={() => setMode(null)}>
                      Cancel
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="flex flex-wrap gap-2">
                  <Button variant="secondary" onClick={() => setMode("in")}>
                    <span className="flex items-center gap-1.5">
                      <ArrowDownToLine size={14} /> Receive
                    </span>
                  </Button>
                  <Button variant="secondary" onClick={() => setMode("out")}>
                    <span className="flex items-center gap-1.5">
                      <ArrowUpFromLine size={14} /> Issue
                    </span>
                  </Button>
                  <Button variant="secondary" onClick={() => setMode("adjust")}>
                    <span className="flex items-center gap-1.5">
                      <ClipboardCheck size={14} /> Stock take
                    </span>
                  </Button>
                </div>
              )}
            </div>
          )}

          <h3 className="mt-6 text-xs uppercase tracking-wider text-cream-500">
            Recent movements
          </h3>
          {movements.length === 0 ? (
            <p className="mt-2 text-sm text-cream-500">Nothing recorded yet.</p>
          ) : (
            <ul className="mt-2 divide-y divide-night-800">
              {movements.map((m) => (
                <li key={m.id} className="flex items-center justify-between gap-4 py-2.5">
                  <span className="min-w-0">
                    <span className="text-sm text-cream-200">
                      {m.type === "in" ? "+" : m.type === "out" ? "-" : "="}
                      {m.quantity} {item.unit}
                    </span>
                    <span className="block truncate text-xs text-cream-500">
                      {m.reason}
                      {/* The receiver, where one was recorded. This is what makes the log
                          a record of custody rather than only of quantities. */}
                      {m.issuedToName && (
                        <span className="text-cream-400"> → {m.issuedToName}</span>
                      )}
                      {m.atMs
                        ? ` · ${new Date(m.atMs).toLocaleDateString("en-GB")}`
                        : ""}
                    </span>
                  </span>
                  <span className="shrink-0 text-xs text-cream-400">
                    balance {m.balanceAfter}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      {dialog}
    </div>
  );
}

function defaultReason(mode: MovementType): string {
  if (mode === "in") return "Delivery received";
  if (mode === "out") return "Issued to job";
  return "Stock take";
}

/**
 * The one item form, used to add and to correct.
 *
 * Quantity on hand appears only when adding. Editing it would leave the item
 * claiming a balance the movement ledger cannot account for, so a correction to
 * the count is a stock take rather than a field on this form.
 */
function ItemForm({
  actor,
  editing,
  onClose,
  onError,
}: {
  actor: AuditActor;
  editing?: ItemRow;
  onClose: () => void;
  onError: (m: string) => void;
}) {
  const [name, setName] = useState(editing?.name ?? "");
  const [category, setCategory] = useState(editing?.category ?? "boards");
  const [unit, setUnit] = useState(editing?.unit ?? "sheet");
  const [qty, setQty] = useState("");
  const [reorder, setReorder] = useState(editing ? String(editing.reorderLevel) : "");
  const [cost, setCost] = useState(editing ? String(toNaira(editing.unitCostKobo)) : "");
  const [supplier, setSupplier] = useState(editing?.supplier ?? "");
  const [sku, setSku] = useState(editing?.sku ?? "");
  const [busy, setBusy] = useState(false);

  // Field ids are suffixed per item, since an item's form can be open while the
  // add form is showing and duplicate ids would misdirect the labels.
  const key = editing ? editing.id : "new";

  async function submit() {
    if (!name.trim()) {
      onError("Name the item.");
      return;
    }
    setBusy(true);
    try {
      const shared = {
        name: name.trim(),
        category,
        unit: unit.trim() || "unit",
        reorderLevel: Number(reorder) || 0,
        unitCostKobo: parseNairaInput(cost),
        supplier: supplier.trim() || undefined,
        sku: sku.trim() || undefined,
      };
      if (editing) {
        await updateInventoryItem(getDb(), actor, editing.id, shared);
      } else {
        await createInventoryItem(getDb(), actor, {
          ...shared,
          quantityOnHand: Number(qty) || 0,
        });
      }
      onClose();
    } catch (e) {
      onError(
        e instanceof Error
          ? e.message
          : editing
            ? "Could not save the item."
            : "Could not add the item."
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="mt-6 rounded-3xl border border-brass-500/30 bg-night-900/40 p-6">
      <h2 className="font-display text-lg text-cream-100">
        {editing ? "Correct this item" : "Add an item"}
      </h2>
      <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <TextField
          id={`inv-name-${key}`}
          label="Name"
          value={name}
          onChange={setName}
          required
        />
        <SelectField
          id={`inv-cat-${key}`}
          label="Category"
          value={category}
          onChange={setCategory}
          options={[
            { value: "boards", label: "Boards" },
            { value: "consumables", label: "Consumables" },
            { value: "fittings", label: "Fittings" },
            { value: "tools", label: "Tools" },
            { value: "other", label: "Other" },
          ]}
        />
        <TextField id={`inv-unit-${key}`} label="Unit" value={unit} onChange={setUnit} />
        <TextField
          id={`inv-supplier-${key}`}
          label="Usual supplier"
          value={supplier}
          onChange={setSupplier}
        />
        {!editing && (
          <NumberField
            id={`inv-qty-${key}`}
            label="Quantity on hand"
            value={qty}
            onChange={setQty}
          />
        )}
        <NumberField
          id={`inv-reorder-${key}`}
          label="Reorder level"
          value={reorder}
          onChange={setReorder}
          hint="alert at or below"
        />
        {/* Named for what it is now.
            This figure is maintained automatically: every priced receipt re-blends it into the
            weighted average, which is what values stock and what cost of goods is taken from on a
            counter sale. Typing over it is still allowed — an opening figure has to come from
            somewhere, and a wrong average needs correcting — but the label has to say that the next
            delivery will move it, or somebody will keep setting it back and wonder why it drifts. */}
        <NumberField
          id={`inv-cost-${key}`}
          label="Average cost (₦)"
          value={cost}
          onChange={setCost}
          hint={editing ? "re-blended by each priced delivery" : "what you paid per unit"}
        />
        <TextField id={`inv-sku-${key}`} label="SKU" value={sku} onChange={setSku} />
      </div>
      {editing && (
        <p className="mt-3 text-xs text-cream-500">
          The count stays as the movement ledger reports it. Use a stock take to
          correct the quantity on hand.
        </p>
      )}
      <div className="mt-5 flex gap-3">
        <Button onClick={submit} busy={busy}>
          {editing ? "Save changes" : "Add item"}
        </Button>
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
      </div>
    </section>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wider text-cream-500">{label}</dt>
      <dd className="mt-0.5 text-cream-100">{value}</dd>
    </div>
  );
}

function Tile({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "warn" | "danger";
}) {
  const colour =
    tone === "danger" ? "text-red-300" : tone === "warn" ? "text-amber-300" : "text-cream-50";
  return (
    <div className="rounded-3xl border border-night-700/60 bg-night-900/40 p-5">
      <p className="text-xs uppercase tracking-wider text-cream-500">{label}</p>
      <p className={`mt-2 font-display text-2xl ${colour}`}>{value}</p>
    </div>
  );
}

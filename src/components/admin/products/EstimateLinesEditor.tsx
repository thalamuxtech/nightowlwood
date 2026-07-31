"use client";

import { useEffect, useState } from "react";
import { collection, onSnapshot, orderBy, query } from "firebase/firestore";
import { Loader2, Plus, Trash2, UserPlus } from "lucide-react";
import { getDb } from "@/lib/firebase";
import { estimateLinesPath } from "@/lib/erp/collections";
import {
  PRODUCT_CATEGORIES,
  PRODUCT_CATEGORY_LABELS,
  type ProductCategory,
} from "@/lib/erp/enums";
import { formatNaira, parseNairaInput, toNaira } from "@/lib/erp/money";
import {
  addEstimateLine,
  removeEstimateLine,
  saveEstimateLine,
  setEstimateMargins,
} from "@/lib/erp/projects";
import type { AuditActor } from "@/lib/erp/audit";
import {
  Button,
  NumberField,
  SelectField,
  TextField,
} from "@/components/admin/ui/Fields";

/**
 * Edits the lines of an issued estimate.
 *
 * The estimate is a snapshot of the project's priced features, but it stops being a
 * copy the moment it is issued: a reviewer returns a corrected figure, or a price
 * turns out to be wrong, and the version the client is holding is the one that needs
 * fixing. Regenerating from the project would mint a new version and supersede the
 * one under discussion, which is the wrong move for a typo.
 *
 * Locked once approved — the total has become the contract value by then, and the
 * library refuses the write as well, so the disabled state here is a courtesy rather
 * than the guard.
 *
 * Lines a reviewer added are marked. Their figures are worth more scrutiny than the
 * ones this office typed, and the client may ask where a new line came from.
 */

interface LineRow {
  id: string;
  category: ProductCategory | string;
  item: string;
  quantity: number;
  unitPriceKobo: number;
  amountKobo: number;
  order: number;
  addedByReviewer?: boolean;
  reviewerNote?: string;
}

export function EstimateLinesEditor({
  estimateId,
  actor,
  locked,
  errorMarginPercent,
  nightowlChargePercent,
  onError,
  onNotice,
}: {
  estimateId: string;
  actor: AuditActor;
  /** True once approved: the figures underpin the contract value. */
  locked: boolean;
  errorMarginPercent: number;
  nightowlChargePercent: number;
  onError: (m: string) => void;
  onNotice: (m: string) => void;
}) {
  const [lines, setLines] = useState<LineRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [editingMargins, setEditingMargins] = useState(false);

  useEffect(() => {
    return onSnapshot(
      query(collection(getDb(), estimateLinesPath(estimateId)), orderBy("order", "asc")),
      (snap) => {
        setLines(
          snap.docs.map((d) => ({
            id: d.id,
            category: d.data().category ?? "",
            item: d.data().item ?? "",
            quantity: d.data().quantity ?? 0,
            unitPriceKobo: d.data().unitPriceKobo ?? 0,
            amountKobo: d.data().amountKobo ?? 0,
            order: d.data().order ?? 0,
            addedByReviewer: d.data().addedByReviewer === true,
            reviewerNote: d.data().reviewerNote || undefined,
          }))
        );
        setLoading(false);
      },
      (e) => {
        onError(e.message);
        setLoading(false);
      }
    );
  }, [estimateId, onError]);

  if (loading) {
    return (
      <div className="mt-4 flex justify-center py-6">
        <Loader2 className="animate-spin text-brass-400" size={20} aria-label="Loading" />
      </div>
    );
  }

  // Grouped the way the PDF groups them, so what is edited here reads in the same
  // order as the document it produces.
  const groups: Array<{ key: string; label: string; rows: LineRow[] }> = [];
  for (const line of lines) {
    const key = String(line.category);
    const last = groups[groups.length - 1];
    if (last && last.key === key) last.rows.push(line);
    else {
      groups.push({
        key,
        label:
          PRODUCT_CATEGORY_LABELS[key as ProductCategory] ?? key ?? "Items",
        rows: [line],
      });
    }
  }

  return (
    <div className="mt-5 border-t border-night-700/60 pt-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs text-cream-500">
          {lines.length} {lines.length === 1 ? "line" : "lines"} on this estimate
        </p>
        {!locked && (
          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              onClick={() => setEditingMargins((v) => !v)}
              className="cursor-pointer text-xs text-cream-400 transition-colors hover:text-brass-300"
            >
              {editingMargins ? "Hide margins" : "Change margins"}
            </button>
            <button
              type="button"
              onClick={() => setAdding((v) => !v)}
              className="flex cursor-pointer items-center gap-1.5 text-xs text-brass-300 transition-colors hover:text-brass-200"
            >
              <Plus size={13} /> Add line
            </button>
          </div>
        )}
      </div>

      {locked && (
        <p className="mt-3 rounded-xl border border-emerald-500/30 bg-emerald-500/5 px-3 py-2 text-xs text-emerald-200">
          Approved. These figures set the project&rsquo;s contract value, so they are
          fixed — create a new estimate to quote differently.
        </p>
      )}

      {editingMargins && !locked && (
        <MarginEditor
          estimateId={estimateId}
          actor={actor}
          errorMarginPercent={errorMarginPercent}
          nightowlChargePercent={nightowlChargePercent}
          onClose={() => setEditingMargins(false)}
          onError={onError}
          onNotice={onNotice}
        />
      )}

      {adding && !locked && (
        <AddLineForm
          estimateId={estimateId}
          actor={actor}
          defaultCategory={
            (groups[0]?.key as ProductCategory) ?? PRODUCT_CATEGORIES[0]
          }
          onClose={() => setAdding(false)}
          onError={onError}
        />
      )}

      {lines.length === 0 ? (
        <p className="mt-4 text-sm text-cream-500">
          This estimate has no lines. Nothing was ticked on the project when it was
          created.
        </p>
      ) : (
        <div className="mt-4 space-y-4">
          {groups.map((g) => (
            <div key={g.key + g.rows[0].id}>
              <div className="flex items-center justify-between gap-3 rounded-xl bg-night-800/50 px-3 py-2">
                <span className="text-xs font-medium uppercase tracking-wider text-brass-300">
                  {g.label}
                </span>
                <span className="text-xs text-cream-300">
                  {formatNaira(g.rows.reduce((s, r) => s + r.amountKobo, 0))}
                </span>
              </div>
              <div className="mt-2 space-y-2">
                {g.rows.map((r) => (
                  <LineEditor
                    key={r.id}
                    estimateId={estimateId}
                    line={r}
                    actor={actor}
                    locked={locked}
                    onError={onError}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** One estimate line, saved on blur like the project feature rows. */
function LineEditor({
  estimateId,
  line,
  actor,
  locked,
  onError,
}: {
  estimateId: string;
  line: LineRow;
  actor: AuditActor;
  locked: boolean;
  onError: (m: string) => void;
}) {
  const [item, setItem] = useState(line.item);
  const [qty, setQty] = useState(line.quantity ? String(line.quantity) : "");
  const [price, setPrice] = useState(
    line.unitPriceKobo ? String(toNaira(line.unitPriceKobo)) : ""
  );
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setItem(line.item);
    setQty(line.quantity ? String(line.quantity) : "");
    setPrice(line.unitPriceKobo ? String(toNaira(line.unitPriceKobo)) : "");
  }, [line.item, line.quantity, line.unitPriceKobo]);

  const amount = (Number(qty) || 0) * parseNairaInput(price);

  async function commit() {
    if (locked) return;
    const nextQty = Number(qty) || 0;
    const nextPrice = parseNairaInput(price);
    const nextItem = item.trim() || line.item;
    if (
      nextQty === line.quantity &&
      nextPrice === line.unitPriceKobo &&
      nextItem === line.item
    )
      return;

    setSaving(true);
    try {
      await saveEstimateLine(getDb(), actor, estimateId, line.id, {
        item: nextItem,
        quantity: nextQty,
        unitPriceKobo: nextPrice,
      });
    } catch (e) {
      onError(e instanceof Error ? e.message : "Could not save the line.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      className={`grid items-end gap-3 rounded-xl border p-3 sm:grid-cols-[1fr_5rem_7rem_7rem_2rem] ${
        line.addedByReviewer
          ? "border-amber-500/30 bg-amber-500/5"
          : "border-night-700/40 bg-night-950/30"
      }`}
    >
      <div className="min-w-0" onBlur={commit}>
        <TextField
          id={`el-i-${line.id}`}
          label="Item"
          value={item}
          onChange={setItem}
          disabled={locked}
        />
        {line.addedByReviewer && (
          <p className="mt-1 flex items-center gap-1 text-xs text-amber-300">
            <UserPlus size={11} /> Added by the reviewer
          </p>
        )}
        {line.reviewerNote && (
          <p className="mt-1 text-xs text-cream-500">{line.reviewerNote}</p>
        )}
      </div>
      <div onBlur={commit}>
        <NumberField
          id={`el-q-${line.id}`}
          label="Qty"
          value={qty}
          onChange={setQty}
          disabled={locked}
        />
      </div>
      <div onBlur={commit}>
        <NumberField
          id={`el-p-${line.id}`}
          label="Unit (₦)"
          value={price}
          onChange={setPrice}
          disabled={locked}
        />
      </div>
      <div>
        <p className="mb-1.5 text-sm text-cream-300">Amount</p>
        <p
          className={`px-1 py-3 text-right text-sm ${
            amount > 0 ? "text-brass-300" : "text-cream-600"
          }`}
        >
          {amount > 0 ? formatNaira(amount) : "-"}
        </p>
      </div>
      {!locked && (
        <div className="flex items-center justify-end pb-3">
          {saving ? (
            <Loader2 size={14} className="animate-spin text-brass-400" />
          ) : (
            <button
              type="button"
              aria-label={`Remove ${line.item}`}
              title="Remove from this estimate"
              onClick={() =>
                removeEstimateLine(getDb(), actor, estimateId, line.id).catch((e) =>
                  onError(e instanceof Error ? e.message : "Could not remove the line.")
                )
              }
              className="cursor-pointer text-cream-600 transition-colors hover:text-red-400"
            >
              <Trash2 size={13} />
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function AddLineForm({
  estimateId,
  actor,
  defaultCategory,
  onClose,
  onError,
}: {
  estimateId: string;
  actor: AuditActor;
  defaultCategory: ProductCategory;
  onClose: () => void;
  onError: (m: string) => void;
}) {
  const [item, setItem] = useState("");
  const [category, setCategory] = useState<ProductCategory>(defaultCategory);
  const [qty, setQty] = useState("1");
  const [price, setPrice] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (!item.trim()) {
      onError("Name the line.");
      return;
    }
    setBusy(true);
    try {
      await addEstimateLine(getDb(), actor, estimateId, {
        item: item.trim(),
        category,
        quantity: Number(qty) || 0,
        unitPriceKobo: parseNairaInput(price),
      });
      onClose();
    } catch (e) {
      onError(e instanceof Error ? e.message : "Could not add the line.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-4 rounded-2xl border border-brass-500/30 bg-night-950/40 p-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <TextField
          id="el-new-item"
          label="Item"
          value={item}
          onChange={setItem}
          placeholder="Bespoke handle"
          required
          autoFocus
        />
        <SelectField
          id="el-new-cat"
          label="Group it under"
          value={category}
          onChange={(v) => setCategory(v as ProductCategory)}
          options={PRODUCT_CATEGORIES.map((c) => ({
            value: c,
            label: PRODUCT_CATEGORY_LABELS[c],
          }))}
        />
      </div>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <NumberField id="el-new-qty" label="Qty" value={qty} onChange={setQty} />
        <NumberField
          id="el-new-price"
          label="Unit price (₦)"
          value={price}
          onChange={setPrice}
        />
      </div>
      <div className="mt-4 flex gap-3">
        <Button onClick={submit} busy={busy}>
          Add line
        </Button>
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

function MarginEditor({
  estimateId,
  actor,
  errorMarginPercent,
  nightowlChargePercent,
  onClose,
  onError,
  onNotice,
}: {
  estimateId: string;
  actor: AuditActor;
  errorMarginPercent: number;
  nightowlChargePercent: number;
  onClose: () => void;
  onError: (m: string) => void;
  onNotice: (m: string) => void;
}) {
  const [margin, setMargin] = useState(String(errorMarginPercent));
  const [charge, setCharge] = useState(String(nightowlChargePercent));
  const [busy, setBusy] = useState(false);

  return (
    <div className="mt-4 rounded-2xl border border-brass-500/30 bg-night-950/40 p-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <NumberField
          id="el-margin"
          label="Error margin (%)"
          value={margin}
          onChange={setMargin}
        />
        <NumberField
          id="el-charge"
          label="Nightowl charge (%)"
          value={charge}
          onChange={setCharge}
        />
      </div>
      <p className="mt-2 text-xs text-cream-500">
        Both apply to the subtotal only, never to each other.
      </p>
      <div className="mt-4 flex gap-3">
        <Button
          busy={busy}
          onClick={() => {
            setBusy(true);
            setEstimateMargins(getDb(), actor, estimateId, {
              errorMarginPercent: Number(margin) || 0,
              nightowlChargePercent: Number(charge) || 0,
            })
              .then((t) => {
                onNotice(`Estimate restated at ${formatNaira(t.totalKobo)}.`);
                onClose();
              })
              .catch((e) =>
                onError(e instanceof Error ? e.message : "Could not restate the estimate.")
              )
              .finally(() => setBusy(false));
          }}
        >
          Restate totals
        </Button>
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

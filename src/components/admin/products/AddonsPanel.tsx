"use client";

import { useEffect, useMemo, useState } from "react";
import { collection, onSnapshot, orderBy, query } from "firebase/firestore";
import { PackagePlus, PenLine, Plus, Trash2 } from "lucide-react";
import { getDb } from "@/lib/firebase";
import { addonsPath } from "@/lib/erp/collections";
import { formatNaira, parseNairaInput, toNaira } from "@/lib/erp/money";
import {
  addonAmountKobo,
  createAddon,
  deleteAddon,
  SUGGESTED_ADDONS,
  updateAddon,
} from "@/lib/erp/addons";
import type { ComponentAddon } from "@/lib/erp/types";
import {
  Button,
  CheckboxField,
  NairaField,
  NumberField,
  SelectField,
  TextField,
} from "@/components/admin/ui/Fields";
import type { AuditActor } from "@/lib/erp/audit";

const CATEGORIES: Array<{ value: ComponentAddon["category"]; label: string }> = [
  { value: "kitchenware", label: "Kitchenware" },
  { value: "appliance", label: "Appliance" },
  { value: "fitting", label: "Fitting" },
  { value: "other", label: "Other" },
];

interface Row extends ComponentAddon {
  id: string;
}

/**
 * Bought-in extras on a component: kitchenwares, appliances, fittings.
 *
 * Kept apart from the component's features because the two are different kinds of
 * money. A feature is work the workshop performs and prices with its own margin; an
 * addon is an item bought at a supplier price and passed on. Mixing them meant a
 * ₦450,000 oven inflated the base that the error margin and the Nightowl charge were
 * applied to — so the client was quietly charged a manufacturing margin on an
 * appliance nobody manufactured.
 *
 * The handling margin is therefore per addon and starts at zero: some are passed
 * through at cost as a courtesy, others carry a charge, and that is a decision per
 * line.
 */
export function AddonsPanel({
  projectId,
  componentId,
  canEdit,
  actor,
  onError,
}: {
  projectId: string;
  componentId: string;
  canEdit: boolean;
  actor: AuditActor;
  onError: (m: string) => void;
}) {
  const [rows, setRows] = useState<Row[]>([]);
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  useEffect(() => {
    return onSnapshot(
      query(collection(getDb(), addonsPath(projectId, componentId)), orderBy("order", "asc")),
      (snap) =>
        setRows(snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Row)),
      () => {}
    );
  }, [projectId, componentId]);

  const total = useMemo(
    () =>
      rows
        .filter((r) => r.included ?? true)
        .reduce((s, r) => s + (r.amountKobo ?? 0), 0),
    [rows]
  );

  return (
    <div className="mt-6 border-t border-night-700/60 pt-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="flex items-center gap-2 text-sm text-cream-200">
          <PackagePlus size={15} className="text-brass-400" />
          Kitchenwares &amp; appliances
          {rows.length > 0 && (
            <span className="text-xs text-cream-500">
              ({rows.length}, {formatNaira(total)})
            </span>
          )}
        </h3>
        {canEdit && !adding && (
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="flex cursor-pointer items-center gap-1.5 text-xs text-brass-300 transition-colors hover:text-brass-200"
          >
            <Plus size={13} /> Add an item
          </button>
        )}
      </div>

      {rows.length === 0 && !adding ? (
        <p className="mt-3 text-xs leading-relaxed text-cream-500">
          Nothing bought in for this component yet. Items added here are billed as their
          own invoice lines at cost plus any handling charge, so no manufacturing margin
          is applied to them.
        </p>
      ) : (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[38rem] text-left text-xs">
            <thead className="text-cream-600">
              <tr>
                <th className="pb-2 font-medium">Item</th>
                <th className="pb-2 font-medium">Kind</th>
                <th className="pb-2 text-right font-medium">Qty</th>
                <th className="pb-2 text-right font-medium">Unit cost</th>
                <th className="pb-2 text-right font-medium">Margin</th>
                <th className="pb-2 text-right font-medium">Amount</th>
                {canEdit && <th className="pb-2" />}
              </tr>
            </thead>
            <tbody className="divide-y divide-night-800/70">
              {rows.map((r) => (
                <tr key={r.id} className={(r.included ?? true) ? "" : "opacity-45"}>
                  <td className="py-2 text-cream-200">
                    {r.name}
                    {(r.brand || r.model) && (
                      <span className="mt-0.5 block text-cream-600">
                        {[r.brand, r.model].filter(Boolean).join(" ")}
                      </span>
                    )}
                    {!(r.included ?? true) && (
                      <span className="mt-0.5 block text-cream-600">not included</span>
                    )}
                  </td>
                  <td className="py-2 capitalize text-cream-500">{r.category}</td>
                  <td className="py-2 text-right tabular-nums text-cream-300">
                    {r.quantity}
                  </td>
                  <td className="py-2 text-right tabular-nums text-cream-300">
                    {formatNaira(r.unitCostKobo)}
                  </td>
                  <td className="py-2 text-right tabular-nums text-cream-500">
                    {r.marginPercent ? `${r.marginPercent}%` : "at cost"}
                  </td>
                  <td className="py-2 text-right tabular-nums text-cream-100">
                    {formatNaira(r.amountKobo)}
                  </td>
                  {canEdit && (
                    <td className="py-2 text-right">
                      <div className="flex justify-end gap-2.5">
                        <button
                          type="button"
                          aria-label={`Edit ${r.name}`}
                          onClick={() => setEditingId(editingId === r.id ? null : r.id)}
                          className="cursor-pointer text-cream-500 transition-colors hover:text-brass-300"
                        >
                          <PenLine size={13} />
                        </button>
                        <button
                          type="button"
                          aria-label={`Remove ${r.name}`}
                          onClick={() =>
                            deleteAddon(
                              getDb(),
                              actor,
                              projectId,
                              componentId,
                              r.id,
                              r.name
                            ).catch((e) =>
                              onError(
                                e instanceof Error ? e.message : "Could not remove."
                              )
                            )
                          }
                          className="cursor-pointer text-cream-500 transition-colors hover:text-red-400"
                        >
                          <Trash2 size={13} />
                        </button>
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {canEdit && (adding || editingId) && (
        <AddonForm
          projectId={projectId}
          componentId={componentId}
          actor={actor}
          editing={editingId ? rows.find((r) => r.id === editingId) : undefined}
          onClose={() => {
            setAdding(false);
            setEditingId(null);
          }}
          onError={onError}
        />
      )}
    </div>
  );
}

function AddonForm({
  projectId,
  componentId,
  actor,
  editing,
  onClose,
  onError,
}: {
  projectId: string;
  componentId: string;
  actor: AuditActor;
  editing?: Row;
  onClose: () => void;
  onError: (m: string) => void;
}) {
  const [name, setName] = useState(editing?.name ?? "");
  const [category, setCategory] = useState<ComponentAddon["category"]>(
    editing?.category ?? "appliance"
  );
  const [brand, setBrand] = useState(editing?.brand ?? "");
  const [model, setModel] = useState(editing?.model ?? "");
  const [supplier, setSupplier] = useState(editing?.supplier ?? "");
  const [quantity, setQuantity] = useState(String(editing?.quantity ?? 1));
  const [cost, setCost] = useState(
    editing ? String(toNaira(editing.unitCostKobo)) : ""
  );
  const [margin, setMargin] = useState(String(editing?.marginPercent ?? 0));
  const [included, setIncluded] = useState(editing?.included ?? true);
  const [busy, setBusy] = useState(false);

  const preview = addonAmountKobo({
    quantity: Number(quantity) || 0,
    unitCostKobo: parseNairaInput(cost),
    marginPercent: Number(margin) || 0,
  });

  async function save() {
    if (!name.trim()) {
      onError("Name the item.");
      return;
    }
    if (!(Number(quantity) > 0)) {
      onError("Quantity must be more than zero.");
      return;
    }
    setBusy(true);
    try {
      const input = {
        name,
        category,
        brand: brand || undefined,
        model: model || undefined,
        supplier: supplier || undefined,
        quantity: Number(quantity),
        unitCostKobo: parseNairaInput(cost),
        marginPercent: Number(margin) || 0,
        included,
      };
      if (editing) {
        await updateAddon(getDb(), actor, projectId, componentId, editing.id, input);
      } else {
        await createAddon(getDb(), actor, projectId, componentId, input);
      }
      onClose();
    } catch (e) {
      onError(e instanceof Error ? e.message : "Could not save the item.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-4 rounded-2xl border border-brass-500/30 bg-night-950/40 p-4">
      {/* The appliances the workshop quotes, at the prices from its own estimate sheet.
          One tap fills the name, the category and the price rather than typing "Builtin Oven
          (electric + gas)" and its figure from memory on every kitchen. Only offered on a new
          addon: on an edit these would overwrite what is being corrected. */}
      {!editing && (
        <div className="mb-4">
          <p className="mb-2 text-xs uppercase tracking-wider text-cream-600">
            Common items
          </p>
          <div className="flex flex-wrap gap-1.5">
            {SUGGESTED_ADDONS.map((s) => (
              <button
                key={s.name}
                type="button"
                onClick={() => {
                  setName(s.name);
                  setCategory(s.category);
                  setCost(String(toNaira(s.unitCostKobo)));
                }}
                className="cursor-pointer rounded-lg border border-night-600 bg-night-800/50 px-2.5 py-1.5 text-xs text-cream-300 transition-colors hover:border-brass-500/60 hover:text-brass-300"
              >
                {s.name}
                <span className="ml-1.5 text-cream-600">
                  {formatNaira(s.unitCostKobo)}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <TextField
          id={`ad-name-${editing?.id ?? "new"}`}
          label="Item"
          value={name}
          onChange={setName}
          placeholder="e.g. Built-in oven"
          required
        />
        <SelectField
          id={`ad-cat-${editing?.id ?? "new"}`}
          label="Kind"
          value={category}
          onChange={setCategory}
          options={CATEGORIES}
        />
        <TextField
          id={`ad-brand-${editing?.id ?? "new"}`}
          label="Brand"
          value={brand}
          onChange={setBrand}
        />
        <TextField
          id={`ad-model-${editing?.id ?? "new"}`}
          label="Model"
          value={model}
          onChange={setModel}
        />
        <TextField
          id={`ad-supplier-${editing?.id ?? "new"}`}
          label="Supplier"
          value={supplier}
          onChange={setSupplier}
        />
        <NumberField
          id={`ad-qty-${editing?.id ?? "new"}`}
          label="Quantity"
          value={quantity}
          onChange={setQuantity}
          required
        />
        <NairaField
          id={`ad-cost-${editing?.id ?? "new"}`}
          label="Unit cost"
          valueKobo={cost}
          onChangeKobo={setCost}
          hint="what it costs to buy"
        />
        <NumberField
          id={`ad-margin-${editing?.id ?? "new"}`}
          label="Handling margin (%)"
          value={margin}
          onChange={setMargin}
          hint="0 to pass on at cost"
        />
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-4">
        <CheckboxField
          id={`ad-inc-${editing?.id ?? "new"}`}
          label="Include on the estimate"
          checked={included}
          onChange={setIncluded}
        />
        <p className="text-sm text-cream-400">
          Adds{" "}
          <span className="font-medium text-brass-300">{formatNaira(preview)}</span> to
          this component
        </p>
      </div>

      <div className="mt-4 flex gap-3">
        <Button onClick={save} busy={busy}>
          {editing ? "Save item" : "Add item"}
        </Button>
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

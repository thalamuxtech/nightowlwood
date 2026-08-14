"use client";

import { useEffect, useMemo, useState } from "react";
import { collection, onSnapshot, orderBy, query } from "firebase/firestore";
import { Plus, Receipt, ShoppingBag, Trash2 } from "lucide-react";
import { getDb } from "@/lib/firebase";
import { projectPurchasesPath } from "@/lib/erp/collections";
import {
  EXPENSE_CATEGORIES,
  EXPENSE_CATEGORY_LABELS,
  type ExpenseCategory,
} from "@/lib/erp/enums";
import { formatNaira, lineAmountKobo, parseNairaInput } from "@/lib/erp/money";
import {
  deleteProjectPurchase,
  recordProjectPurchase,
} from "@/lib/erp/addons";
import type { ProjectPurchase } from "@/lib/erp/types";
import { fromDateInputValue, toDateInputValue } from "@/lib/erp/workLogs";
import {
  Button,
  DateField,
  NairaField,
  NumberField,
  SelectField,
  TextField,
} from "@/components/admin/ui/Fields";
import type { AuditActor } from "@/lib/erp/audit";
import { useConfirmBoolean } from "@/components/admin/ui/ConfirmDialog";

interface Row extends ProjectPurchase {
  id: string;
}

/**
 * What was actually bought for this project.
 *
 * The estimate says what the job was expected to cost. Until these were recorded there
 * was no record of what it really cost, so a project's profit was a guess against a
 * figure quoted before any material was bought.
 *
 * Every purchase is booked to the expense ledger as well, linked by id. That is not
 * double-counting: the ledger is the company's record of money out, and this is the
 * same money attributed to the job that consumed it. The Profit & Loss report reads the
 * ledger; per-project profit reads these. Each naira appears once in both.
 */
export function ProjectPurchasesPanel({
  projectId,
  projectNumber,
  contractValueKobo,
  estimatedCostKobo,
  components,
  canEdit,
  actor,
  onError,
}: {
  projectId: string;
  projectNumber?: string;
  contractValueKobo?: number;
  estimatedCostKobo: number;
  components: Array<{ id: string; name: string }>;
  canEdit: boolean;
  actor: AuditActor;
  onError: (m: string) => void;
}) {
  const { confirm, dialog } = useConfirmBoolean();
  const [rows, setRows] = useState<Row[]>([]);
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    return onSnapshot(
      query(
        collection(getDb(), projectPurchasesPath(projectId)),
        orderBy("purchasedAt", "desc")
      ),
      (snap) => setRows(snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Row)),
      () => {}
    );
  }, [projectId]);

  const spent = useMemo(
    () => rows.reduce((s, r) => s + (r.totalCostKobo ?? 0), 0),
    [rows]
  );

  /*
   * The revenue side: the agreed contract figure where there is one, the estimate
   * otherwise. Labour is deliberately absent — piece-rate work is logged per operator
   * per week, not per project, so apportioning it would be a guess, and a guess inside
   * a profit figure is worse than a stated gap.
   */
  const revenue = contractValueKobo && contractValueKobo > 0
    ? contractValueKobo
    : estimatedCostKobo;
  const gross = revenue - spent;
  const marginPercent = revenue > 0 ? Math.round((gross / revenue) * 1000) / 10 : null;

  return (
    <section className="mt-8 rounded-3xl border border-night-700/60 bg-night-900/30 p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 font-display text-lg text-cream-100">
          <ShoppingBag size={18} className="text-brass-400" /> Purchases for this project
        </h2>
        {canEdit && !adding && (
          <Button variant="secondary" onClick={() => setAdding(true)}>
            <span className="flex items-center gap-1.5">
              <Plus size={14} /> Record a purchase
            </span>
          </Button>
        )}
      </div>

      {/* Contract value against what has been spent. The one figure that answers
          "is this job making money", and it was previously unanswerable. */}
      <div className="mt-5 grid gap-4 sm:grid-cols-3">
        <Figure
          label={contractValueKobo ? "Contract value" : "Estimate"}
          value={formatNaira(revenue)}
        />
        <Figure label="Spent so far" value={formatNaira(spent)} tone="warn" />
        <Figure
          label={gross >= 0 ? "Gross margin" : "Over budget"}
          value={formatNaira(Math.abs(gross))}
          tone={gross >= 0 ? "good" : "danger"}
          hint={
            marginPercent !== null
              ? `${marginPercent}% of ${contractValueKobo ? "contract" : "estimate"}`
              : undefined
          }
        />
      </div>

      <p className="mt-3 text-xs leading-relaxed text-cream-500">
        Materials only. Piece-rate labour is logged per operator per week rather than
        per project, so it is not apportioned here — the margin above is before labour.
      </p>

      {adding && canEdit && (
        <PurchaseForm
          projectId={projectId}
          projectNumber={projectNumber}
          components={components}
          actor={actor}
          onClose={() => setAdding(false)}
          onError={onError}
        />
      )}

      {rows.length === 0 ? (
        <p className="mt-5 text-sm text-cream-500">
          Nothing recorded yet. Each purchase entered here also reaches the expense
          ledger, so the project cost and the company books stay in step.
        </p>
      ) : (
        <div className="mt-5 overflow-x-auto">
          <table className="w-full min-w-[42rem] text-left text-sm">
            <thead className="text-xs uppercase tracking-wider text-cream-500">
              <tr>
                <th className="pb-3 font-medium">Item</th>
                <th className="pb-3 font-medium">For</th>
                <th className="pb-3 font-medium">Supplier</th>
                <th className="pb-3 text-right font-medium">Qty</th>
                <th className="pb-3 text-right font-medium">Cost</th>
                <th className="pb-3 font-medium">When</th>
                {canEdit && <th className="pb-3" />}
              </tr>
            </thead>
            <tbody className="divide-y divide-night-800">
              {rows.map((r) => (
                <tr key={r.id}>
                  <td className="py-3 text-cream-200">
                    {r.item}
                    <span className="mt-0.5 block text-xs text-cream-600">
                      {EXPENSE_CATEGORY_LABELS[r.category] ?? r.category}
                    </span>
                  </td>
                  <td className="py-3 text-xs text-cream-400">
                    {r.componentName ?? <span className="text-cream-600">Project</span>}
                  </td>
                  <td className="py-3 text-xs text-cream-400">
                    {r.supplierName ?? "—"}
                  </td>
                  <td className="py-3 text-right tabular-nums text-cream-300">
                    {r.quantity}
                    {r.unit ? ` ${r.unit}` : ""}
                  </td>
                  <td className="py-3 text-right tabular-nums text-cream-100">
                    {formatNaira(r.totalCostKobo)}
                  </td>
                  <td className="py-3 text-xs text-cream-500">
                    {r.purchasedAt?.toMillis
                      ? new Date(r.purchasedAt.toMillis()).toLocaleDateString("en-GB", {
                          day: "numeric",
                          month: "short",
                        })
                      : "—"}
                  </td>
                  {canEdit && (
                    <td className="py-3 text-right">
                      <button
                        type="button"
                        aria-label={`Remove ${r.item}`}
                        onClick={async () => {
                          const ok = await confirm({
                            title: `Remove "${r.item}"?`,
                            body: "Its expense entry is removed too, so the books stay in step.",
                            confirmLabel: "Remove purchase",
                            tone: "danger",
                          });
                          if (!ok) return;
                          deleteProjectPurchase(getDb(), actor, projectId, r.id).catch(
                            (e) =>
                              onError(
                                e instanceof Error ? e.message : "Could not remove."
                              )
                          );
                        }}
                        className="cursor-pointer text-cream-500 transition-colors hover:text-red-400"
                      >
                        <Trash2 size={14} />
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {dialog}
    </section>
  );
}

function PurchaseForm({
  projectId,
  projectNumber,
  components,
  actor,
  onClose,
  onError,
}: {
  projectId: string;
  projectNumber?: string;
  components: Array<{ id: string; name: string }>;
  actor: AuditActor;
  onClose: () => void;
  onError: (m: string) => void;
}) {
  const [item, setItem] = useState("");
  const [category, setCategory] = useState<ExpenseCategory>("materials");
  const [componentId, setComponentId] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [unit, setUnit] = useState("");
  const [cost, setCost] = useState("");
  const [supplier, setSupplier] = useState("");
  const [date, setDate] = useState(toDateInputValue(new Date()));
  const [busy, setBusy] = useState(false);

  const total = lineAmountKobo(Number(quantity) || 0, parseNairaInput(cost));

  async function save() {
    if (!item.trim()) {
      onError("Name what was bought.");
      return;
    }
    if (!(total > 0)) {
      onError("Enter a quantity and a unit cost.");
      return;
    }
    setBusy(true);
    try {
      await recordProjectPurchase(getDb(), actor, projectId, projectNumber, {
        item,
        category,
        componentId: componentId || undefined,
        componentName: components.find((c) => c.id === componentId)?.name,
        quantity: Number(quantity),
        unit: unit || undefined,
        unitCostKobo: parseNairaInput(cost),
        supplierName: supplier || undefined,
        purchasedAt: fromDateInputValue(date),
      });
      onClose();
    } catch (e) {
      onError(e instanceof Error ? e.message : "Could not record the purchase.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-5 rounded-2xl border border-brass-500/30 bg-night-950/40 p-5">
      <h3 className="flex items-center gap-2 text-sm text-cream-200">
        <Receipt size={15} className="text-brass-400" /> Record a purchase
      </h3>

      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <TextField
          id="pp-item"
          label="What was bought"
          value={item}
          onChange={setItem}
          placeholder="e.g. 18mm MDF sheets"
          required
        />
        <SelectField
          id="pp-category"
          label="Cost type"
          value={category}
          onChange={setCategory}
          options={EXPENSE_CATEGORIES.map((c) => ({
            value: c,
            label: EXPENSE_CATEGORY_LABELS[c],
          }))}
        />
        <SelectField
          id="pp-component"
          label="For which component"
          value={componentId}
          onChange={setComponentId}
          placeholder="The project as a whole"
          options={components.map((c) => ({ value: c.id, label: c.name }))}
        />
        <NumberField
          id="pp-qty"
          label="Quantity"
          value={quantity}
          onChange={setQuantity}
          required
        />
        <TextField id="pp-unit" label="Unit" value={unit} onChange={setUnit} placeholder="sheets" />
        <NairaField
          id="pp-cost"
          label="Unit cost"
          valueKobo={cost}
          onChangeKobo={setCost}
          required
        />
        <TextField
          id="pp-supplier"
          label="Supplier"
          value={supplier}
          onChange={setSupplier}
        />
        <DateField
          id="pp-date"
          label="Date bought"
          value={date}
          max={toDateInputValue(new Date())}
          onChange={setDate}
        />
      </div>

      {total > 0 && (
        <p className="mt-4 text-sm text-cream-400">
          Total{" "}
          <span className="font-medium text-brass-300">{formatNaira(total)}</span>, which
          is also booked to expenses.
        </p>
      )}

      <div className="mt-5 flex gap-3">
        <Button onClick={save} busy={busy}>
          Record purchase
        </Button>
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

function Figure({
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
    <div className="rounded-2xl border border-night-700/60 bg-night-950/30 p-4">
      <p className="text-xs uppercase tracking-wider text-cream-500">{label}</p>
      <p className={`mt-1.5 font-display text-xl ${colour}`}>{value}</p>
      {hint && <p className="mt-1 text-xs text-cream-500">{hint}</p>}
    </div>
  );
}

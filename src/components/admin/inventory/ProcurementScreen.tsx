"use client";

import { useEffect, useMemo, useState } from "react";
import { collection, onSnapshot, orderBy, query } from "firebase/firestore";
import {
  Award,
  Clock,
  Loader2,
  PenLine,
  Plus,
  RotateCcw,
  ShieldAlert,
  Trash2,
  TrendingDown,
  Truck,
} from "lucide-react";
import { getDb } from "@/lib/firebase";
import { COL } from "@/lib/erp/collections";
import { formatNaira } from "@/lib/erp/money";
import {
  createSupplier,
  deleteSupplier,
  updateSupplier,
} from "@/lib/erp/inventory";
import {
  brandObservations,
  rankBrands,
  supplierObservations,
  type BrandScorecard,
  type SupplierScorecard,
} from "@/lib/erp/procurement";
import { Button, EmptyState, TextField } from "@/components/admin/ui/Fields";
import { useAuditActor, useErpSession } from "@/components/admin/ErpAuthProvider";
import { PurchaseOrdersPanel } from "./PurchaseOrdersPanel";
import type { AuditActor } from "@/lib/erp/audit";
import { useConfirmBoolean } from "@/components/admin/ui/ConfirmDialog";

interface SupplierRow {
  id: string;
  name: string;
  phone?: string;
  categories?: string[];
  active: boolean;
  score: SupplierScorecard;
}

interface BrandRow {
  id: string;
  name: string;
  type: string;
  score: BrandScorecard;
}

/**
 * Suppliers and consumable brands, with their derived scorecards.
 *
 * The headline for a brand is cost per unit processed, not sticker price: the
 * legacy records show Infrawood blades lasting about four days against Freud's
 * fourteen, so the cheaper blade is the more expensive one. The observations
 * below the tables state that in words, and only when there is enough evidence.
 */
export function ProcurementScreen() {
  const session = useErpSession();
  const canSeePerformance = session.can("procurement.viewPerformance");
  const canEdit = session.can("supplier.edit");
  // Admin-only across the app; record.delete is not grantable to a manager.
  const canDelete = session.can("record.delete");
  const canSeeOrders = session.can("purchase.view");

  const [suppliers, setSuppliers] = useState<SupplierRow[]>([]);
  const [brands, setBrands] = useState<BrandRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState("");
  const [newPhone, setNewPhone] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const unsubS = onSnapshot(
      query(collection(getDb(), COL.suppliers), orderBy("name", "asc")),
      (snap) => {
        // Deactivated suppliers are read too, not filtered out at the snapshot.
        // Filtering here made deactivation a one-way door: the supplier vanished
        // from the only screen that could have restored it.
        setSuppliers(
          snap.docs
            .map((d) => {
              const x = d.data();
              return {
                id: d.id,
                name: x.name ?? "",
                phone: x.phone ?? undefined,
                categories: x.categories ?? [],
                active: x.active !== false,
                score: {
                  purchaseCount: x.purchaseCount ?? 0,
                  totalSpendKobo: x.totalSpendKobo ?? 0,
                  avgLeadTimeDays: x.avgLeadTimeDays ?? undefined,
                  onTimeRatePercent: x.onTimeRatePercent ?? undefined,
                  defectRatePercent: x.defectRatePercent ?? undefined,
                  lastPurchaseAtMs: x.lastPurchaseAt?.toMillis?.() ?? undefined,
                },
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
    const unsubB = onSnapshot(
      query(collection(getDb(), COL.consumableBrands), orderBy("name", "asc")),
      (snap) =>
        setBrands(
          snap.docs
            .filter((d) => d.data().active !== false)
            .map((d) => {
              const x = d.data();
              return {
                id: d.id,
                name: x.name ?? "",
                type: x.type ?? "blade",
                score: {
                  cyclesRecorded: x.cyclesRecorded ?? 0,
                  avgLifespanDays: x.avgLifespanDays ?? undefined,
                  avgUnitsProcessed: x.avgUnitsProcessed ?? undefined,
                  avgUnitCostKobo: x.avgUnitCostKobo ?? undefined,
                  costPerUnitProcessedKobo: x.costPerUnitProcessedKobo ?? undefined,
                  earlyFailureRatePercent: x.earlyFailureRatePercent ?? undefined,
                },
              };
            })
        ),
      () => {}
    );
    return () => {
      unsubS();
      unsubB();
    };
  }, []);

  const rankedBrands = useMemo(
    () => rankBrands(brands.map((b) => ({ brandId: b.id, brandName: b.name, score: b.score }))),
    [brands]
  );

  const advice = useMemo(() => {
    if (!canSeePerformance) return [];
    return [
      ...brandObservations(
        brands.map((b) => ({ brandId: b.id, brandName: b.name, score: b.score }))
      ),
      ...supplierObservations(
        suppliers.map((s) => ({ supplierId: s.id, supplierName: s.name, score: s.score }))
      ),
    ];
  }, [brands, suppliers, canSeePerformance]);

  const actor = useAuditActor();

  const activeSuppliers = useMemo(() => suppliers.filter((s) => s.active), [suppliers]);
  const inactiveSuppliers = useMemo(
    () => suppliers.filter((s) => !s.active),
    [suppliers]
  );

  async function addSupplier() {
    if (!newName.trim()) {
      setError("Name the supplier.");
      return;
    }
    setBusy(true);
    try {
      // Through the library rather than a bare addDoc: this was the only create in
      // the app that wrote no audit entry, so a supplier appearing in the list had
      // no record of who added it.
      await createSupplier(getDb(), actor, {
        name: newName,
        phone: newPhone,
      });
      setNewName("");
      setNewPhone("");
      setAdding(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not add the supplier.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-6xl pb-20">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-eyebrow">Procurement</p>
          <h1 className="text-title mt-3 text-cream-50">Suppliers &amp; brands</h1>
          <p className="mt-3 max-w-2xl text-sm leading-relaxed text-cream-400">
            Scorecards are derived from purchase history and consumable cycles, never
            entered by hand.
          </p>
        </div>
        {canEdit && !adding && (
          <Button onClick={() => setAdding(true)}>
            <span className="flex items-center gap-2">
              <Plus size={15} /> Add supplier
            </span>
          </Button>
        )}
      </header>

      {error && (
        <p role="alert" className="mt-6 flex items-center gap-2 text-sm text-red-400">
          <ShieldAlert size={16} /> {error}
        </p>
      )}

      {adding && (
        <section className="mt-6 rounded-3xl border border-brass-500/30 bg-night-900/40 p-6">
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField id="sup-name" label="Supplier name" value={newName} onChange={setNewName} required />
            <TextField id="sup-phone" label="Phone" value={newPhone} onChange={setNewPhone} />
          </div>
          <div className="mt-5 flex gap-3">
            <Button onClick={addSupplier} busy={busy}>
              Add supplier
            </Button>
            <Button variant="ghost" onClick={() => setAdding(false)}>
              Cancel
            </Button>
          </div>
        </section>
      )}

      {advice.length > 0 && (
        <section className="mt-8 rounded-3xl border border-brass-500/30 bg-brass-500/5 p-6">
          <h2 className="flex items-center gap-2 font-display text-lg text-cream-100">
            <TrendingDown size={18} className="text-brass-400" /> Purchasing advice
          </h2>
          <ul className="mt-4 space-y-2.5">
            {advice.map((a, i) => (
              <li key={i} className="text-sm leading-relaxed text-cream-300">
                {a}
              </li>
            ))}
          </ul>
        </section>
      )}

      {loading ? (
        <div className="mt-10 flex justify-center py-10">
          <Loader2 className="animate-spin text-brass-400" size={26} aria-label="Loading" />
        </div>
      ) : (
        <>
          <section className="mt-8">
            <h2 className="font-display text-lg text-cream-100">Consumable brands</h2>
            {rankedBrands.length === 0 ? (
              <div className="mt-5">
                <EmptyState
                  title="No brands recorded"
                  hint="Record a blade or gum cycle to start comparing brands."
                />
              </div>
            ) : (
              <div className="mt-5 space-y-3">
                {rankedBrands.map((b, i) => {
                  // Fewer than three closed cycles is not evidence, so those are
                  // shown without a rank rather than ranked on noise.
                  const judged = b.score.cyclesRecorded >= 3;
                  return (
                    <div
                      key={b.brandId}
                      className={`rounded-2xl border p-5 ${
                        judged && i === 0
                          ? "border-emerald-500/40 bg-emerald-500/5"
                          : "border-night-700/60 bg-night-900/40"
                      }`}
                    >
                      <div className="flex flex-wrap items-start justify-between gap-4">
                        <div>
                          <p className="flex items-center gap-2 text-cream-100">
                            {judged && i === 0 && (
                              <Award size={15} className="text-emerald-400" />
                            )}
                            {b.brandName}
                          </p>
                          <p className="mt-1 text-xs text-cream-500">
                            {b.score.cyclesRecorded} closed cycle
                            {b.score.cyclesRecorded === 1 ? "" : "s"}
                            {!judged && " · too few to rank"}
                          </p>
                        </div>
                        {canSeePerformance && b.score.costPerUnitProcessedKobo !== undefined && (
                          <div className="text-right">
                            <p className="font-display text-xl text-cream-50">
                              {formatNaira(b.score.costPerUnitProcessedKobo)}
                            </p>
                            <p className="text-xs text-cream-500">per board processed</p>
                          </div>
                        )}
                      </div>
                      <dl className="mt-4 grid gap-4 text-sm sm:grid-cols-4">
                        <Metric
                          label="Avg lifespan"
                          value={
                            b.score.avgLifespanDays !== undefined
                              ? `${b.score.avgLifespanDays} days`
                              : "-"
                          }
                        />
                        <Metric
                          label="Avg boards"
                          value={
                            b.score.avgUnitsProcessed !== undefined
                              ? String(b.score.avgUnitsProcessed)
                              : "-"
                          }
                        />
                        {canSeePerformance && (
                          <Metric
                            label="Avg cost"
                            value={
                              b.score.avgUnitCostKobo !== undefined
                                ? formatNaira(b.score.avgUnitCostKobo)
                                : "-"
                            }
                          />
                        )}
                        <Metric
                          label="Failed early"
                          value={
                            b.score.earlyFailureRatePercent !== undefined
                              ? `${b.score.earlyFailureRatePercent}%`
                              : "-"
                          }
                          tone={
                            (b.score.earlyFailureRatePercent ?? 0) >= 25 ? "warn" : undefined
                          }
                        />
                      </dl>
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          <section className="mt-10">
            <h2 className="font-display text-lg text-cream-100">Suppliers</h2>
            {suppliers.length === 0 ? (
              <div className="mt-5">
                <EmptyState title="No suppliers yet" hint="Add the vendors you buy from." />
              </div>
            ) : (
              <div className="mt-5 space-y-3">
                {activeSuppliers.map((s) => (
                  <SupplierCard
                    key={s.id}
                    supplier={s}
                    actor={actor}
                    canEdit={canEdit}
                    canDelete={canDelete}
                    canSeePerformance={canSeePerformance}
                    onError={setError}
                  />
                ))}
              </div>
            )}

            {/* Deactivated suppliers get their own section rather than vanishing.
                They were filtered out of the query before, which made deactivation
                irreversible from the only screen that could undo it. */}
            {inactiveSuppliers.length > 0 && (
              <div className="mt-8">
                <p className="text-xs uppercase tracking-wider text-cream-600">
                  Deactivated ({inactiveSuppliers.length})
                </p>
                <div className="mt-3 space-y-3">
                  {inactiveSuppliers.map((s) => (
                    <SupplierCard
                      key={s.id}
                      supplier={s}
                      actor={actor}
                      canEdit={canEdit}
                      canDelete={canDelete}
                      canSeePerformance={canSeePerformance}
                      onError={setError}
                    />
                  ))}
                </div>
              </div>
            )}
          </section>

          {/* The orders the scorecards above are computed from. Below them rather than above
              because the scores are the question this screen answers and the orders are the
              working record that feeds them. */}
          {canSeeOrders && <PurchaseOrdersPanel />}

          {!canSeePerformance && (
            <p className="mt-8 text-xs text-cream-600">
              Spend and cost figures are restricted to administrators.
            </p>
          )}
        </>
      )}
    </div>
  );
}

/**
 * One supplier, with its scorecard and the controls to correct it.
 *
 * Deleting is refused by the library once there are purchases against the supplier,
 * because those documents reference it by id and would be left pointing at nothing —
 * the scorecard query would then read as zero rather than as missing. Deactivating is
 * the answer for a supplier with history, and it is reversible.
 */
function SupplierCard({
  supplier: s,
  actor,
  canEdit,
  canDelete,
  canSeePerformance,
  onError,
}: {
  supplier: SupplierRow;
  actor: AuditActor;
  canEdit: boolean;
  canDelete: boolean;
  canSeePerformance: boolean;
  onError: (m: string) => void;
}) {
  const { confirm, dialog } = useConfirmBoolean();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(s.name);
  const [phone, setPhone] = useState(s.phone ?? "");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setName(s.name);
    setPhone(s.phone ?? "");
  }, [s.name, s.phone]);

  async function save() {
    setBusy(true);
    try {
      await updateSupplier(getDb(), actor, s.id, { name, phone });
      setEditing(false);
    } catch (e) {
      onError(e instanceof Error ? e.message : "Could not save the supplier.");
    } finally {
      setBusy(false);
    }
  }

  async function toggleActive() {
    setBusy(true);
    try {
      await updateSupplier(getDb(), actor, s.id, {
        name: s.name,
        phone: s.phone,
        active: !s.active,
      });
    } catch (e) {
      onError(e instanceof Error ? e.message : "Could not change the supplier.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className={`rounded-2xl border p-5 ${
        s.active
          ? "border-night-700/60 bg-night-900/40"
          : "border-night-800 bg-night-900/20"
      }`}
    >
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className={s.active ? "" : "opacity-60"}>
          <p className="flex items-center gap-2 text-cream-100">
            <Truck size={15} className="text-cream-500" />
            {s.name}
            {!s.active && (
              <span className="rounded-full border border-night-600 px-2 py-0.5 text-xs text-cream-500">
                Deactivated
              </span>
            )}
          </p>
          <p className="mt-1 text-xs text-cream-500">
            {s.phone ? `${s.phone} · ` : ""}
            {s.score.purchaseCount} purchase
            {s.score.purchaseCount === 1 ? "" : "s"}
          </p>
        </div>
        {canSeePerformance && s.score.totalSpendKobo > 0 && (
          <div className="text-right">
            <p className="font-display text-lg text-cream-50">
              {formatNaira(s.score.totalSpendKobo)}
            </p>
            <p className="text-xs text-cream-500">total spend</p>
          </div>
        )}
      </div>

      <dl className="mt-4 grid gap-4 text-sm sm:grid-cols-3">
        <Metric
          label="Avg lead time"
          value={
            s.score.avgLeadTimeDays !== undefined
              ? `${s.score.avgLeadTimeDays} days`
              : "-"
          }
          tone={(s.score.avgLeadTimeDays ?? 0) > 14 ? "warn" : undefined}
        />
        <Metric
          label="On time"
          value={
            s.score.onTimeRatePercent !== undefined
              ? `${s.score.onTimeRatePercent}%`
              : "no promised dates"
          }
          tone={
            s.score.onTimeRatePercent !== undefined && s.score.onTimeRatePercent < 70
              ? "warn"
              : undefined
          }
        />
        <Metric
          label="Defect rate"
          value={
            s.score.defectRatePercent !== undefined
              ? `${s.score.defectRatePercent}%`
              : "-"
          }
          tone={(s.score.defectRatePercent ?? 0) >= 5 ? "warn" : undefined}
        />
      </dl>

      {s.score.lastPurchaseAtMs && (
        <p className="mt-3 flex items-center gap-1.5 text-xs text-cream-600">
          <Clock size={12} /> Last delivery{" "}
          {new Date(s.score.lastPurchaseAtMs).toLocaleDateString("en-GB")}
        </p>
      )}

      {editing && canEdit && (
        <div className="mt-4 rounded-xl border border-brass-500/30 bg-night-950/40 p-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <TextField
              id={`sup-name-${s.id}`}
              label="Supplier name"
              value={name}
              onChange={setName}
              required
            />
            <TextField
              id={`sup-phone-${s.id}`}
              label="Phone"
              value={phone}
              onChange={setPhone}
            />
          </div>
          <div className="mt-4 flex gap-3">
            <Button onClick={save} busy={busy}>
              Save
            </Button>
            <Button variant="ghost" onClick={() => setEditing(false)}>
              Cancel
            </Button>
          </div>
        </div>
      )}

      {canEdit && !editing && (
        <div className="mt-4 flex flex-wrap gap-4">
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="flex cursor-pointer items-center gap-2 text-sm text-brass-300 transition-colors hover:text-brass-200"
          >
            <PenLine size={14} /> Edit
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={toggleActive}
            className="flex cursor-pointer items-center gap-2 text-sm text-cream-500 transition-colors hover:text-amber-300 disabled:opacity-50"
          >
            <RotateCcw size={14} /> {s.active ? "Deactivate" : "Reactivate"}
          </button>
          {canDelete && (
            <button
              type="button"
              disabled={busy}
              onClick={async () => {
                const ok = await confirm({
                  title: `Delete "${s.name}"?`,
                  body: "The supplier comes off the list along with their scorecard. Deactivate instead to keep the history.",
                  confirmLabel: "Delete supplier",
                  tone: "danger",
                });
                if (!ok) return;
                deleteSupplier(getDb(), actor, s.id, s.name).catch((e) =>
                  onError(
                    e instanceof Error ? e.message : "Could not delete the supplier."
                  )
                );
              }}
              className="flex cursor-pointer items-center gap-2 text-sm text-cream-500 transition-colors hover:text-red-400 disabled:opacity-50"
            >
              <Trash2 size={14} /> Delete
            </button>
          )}
        </div>
      )}
      {dialog}
    </div>
  );
}

function Metric({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "warn";
}) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wider text-cream-500">{label}</dt>
      <dd className={`mt-0.5 ${tone === "warn" ? "text-amber-300" : "text-cream-100"}`}>
        {value}
      </dd>
    </div>
  );
}

"use client";

import { useEffect, useMemo, useState } from "react";
import { addDoc, collection, onSnapshot, orderBy, query, serverTimestamp } from "firebase/firestore";
import {
  Award,
  Clock,
  Loader2,
  Plus,
  ShieldAlert,
  TrendingDown,
  Truck,
} from "lucide-react";
import { getDb } from "@/lib/firebase";
import { COL } from "@/lib/erp/collections";
import { formatNaira } from "@/lib/erp/money";
import {
  brandObservations,
  rankBrands,
  supplierObservations,
  type BrandScorecard,
  type SupplierScorecard,
} from "@/lib/erp/procurement";
import { Button, EmptyState, TextField } from "@/components/admin/ui/Fields";
import { useErpSession } from "@/components/admin/ErpAuthProvider";

interface SupplierRow {
  id: string;
  name: string;
  phone?: string;
  categories?: string[];
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
        setSuppliers(
          snap.docs
            .filter((d) => d.data().active !== false)
            .map((d) => {
              const x = d.data();
              return {
                id: d.id,
                name: x.name ?? "",
                phone: x.phone ?? undefined,
                categories: x.categories ?? [],
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

  async function addSupplier() {
    if (!newName.trim()) {
      setError("Name the supplier.");
      return;
    }
    setBusy(true);
    try {
      await addDoc(collection(getDb(), COL.suppliers), {
        name: newName.trim(),
        phone: newPhone.trim() || null,
        categories: [],
        active: true,
        createdAt: serverTimestamp(),
        createdBy: session.user?.uid ?? "",
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
                {suppliers.map((s) => (
                  <div
                    key={s.id}
                    className="rounded-2xl border border-night-700/60 bg-night-900/40 p-5"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-4">
                      <div>
                        <p className="flex items-center gap-2 text-cream-100">
                          <Truck size={15} className="text-cream-500" />
                          {s.name}
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
                          s.score.onTimeRatePercent !== undefined &&
                          s.score.onTimeRatePercent < 70
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
                  </div>
                ))}
              </div>
            )}
          </section>

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

"use client";

import { useEffect, useMemo, useState } from "react";
import { collection, getDocs, orderBy, query } from "firebase/firestore";
import { ArrowRight, CheckCircle2, PackagePlus, ShieldAlert } from "lucide-react";
import { getDb } from "@/lib/firebase";
import { COL } from "@/lib/erp/collections";
import { formatNaira, parseNairaInput, toNaira } from "@/lib/erp/money";
import { transferToCounter } from "@/lib/erp/sales";
import {
  Button,
  NairaField,
  NumberField,
  SelectField,
  TextField,
} from "@/components/admin/ui/Fields";

/** A company-stock item that could be moved to the counter. */
interface CompanyItem {
  id: string;
  name: string;
  unit: string;
  quantityOnHand: number;
  unitCostKobo: number;
}

/**
 * Moving stock from the workshop's shelves to the counter.
 *
 * The counter holds its own stock, so goods have to be walked across — and this is that act,
 * recorded. It exists on the till screen rather than in inventory because the person who notices the
 * counter is out of hinges is the person standing at it.
 *
 * The cost travels with the goods, so the counter never has to be told what anything cost: a sale is
 * costed at what the workshop actually paid, which is what makes the retail margin real.
 */
export function CounterRestockPanel({
  actor,
  onDone,
  onClose,
}: {
  actor: { uid: string; email: string; role: "admin" | "manager" | "operator" };
  onDone: (message: string) => void;
  onClose: () => void;
}) {
  const [items, setItems] = useState<CompanyItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const [itemId, setItemId] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [price, setPrice] = useState("");
  const [reason, setReason] = useState("");

  useEffect(() => {
    getDocs(query(collection(getDb(), COL.inventoryCompany), orderBy("name", "asc")))
      .then((snap) =>
        setItems(
          snap.docs
            .map((d) => {
              const x = d.data();
              return {
                id: d.id,
                name: (x.name as string) ?? "",
                unit: (x.unit as string) ?? "unit",
                quantityOnHand: (x.quantityOnHand as number) ?? 0,
                unitCostKobo: (x.unitCostKobo as number) ?? 0,
              };
            })
            // Nothing on the shelf cannot be moved off it.
            .filter((i) => i.quantityOnHand > 0)
        )
      )
      .catch((e) =>
        setError(e instanceof Error ? e.message : "Could not read company stock.")
      )
      .finally(() => setLoading(false));
  }, []);

  const chosen = useMemo(() => items.find((i) => i.id === itemId), [items, itemId]);
  const moving = Number(quantity) || 0;
  const tooMany = chosen !== undefined && moving > chosen.quantityOnHand;

  async function submit() {
    setError("");
    if (!chosen) {
      setError("Choose what is going to the counter.");
      return;
    }
    setBusy(true);
    try {
      const res = await transferToCounter(getDb(), actor, {
        companyItemId: chosen.id,
        quantity: moving,
        unitPriceKobo: price ? parseNairaInput(price) : undefined,
        reason: reason || undefined,
      });
      onDone(
        `${moving} ${chosen.unit}(s) of ${chosen.name} moved to the counter — it now holds ${res.counterQuantity}.`
      );
      setItemId("");
      setQuantity("1");
      setPrice("");
      setReason("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not move the stock.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="mt-6 rounded-3xl border border-brass-500/30 bg-night-900/40 p-6">
      <h2 className="flex items-center gap-2 font-display text-lg text-cream-100">
        <PackagePlus size={18} className="text-brass-400" /> Restock the counter
      </h2>
      <p className="mt-1.5 max-w-2xl text-sm text-cream-400">
        Moves stock from the workshop&apos;s shelves onto the shop floor. Both counts change together,
        and what it cost travels with it — so the counter never has to be told a price it paid.
      </p>

      {error && (
        <p
          role="alert"
          className="mt-5 flex items-start gap-2 rounded-xl border border-red-500/40 bg-red-500/5 px-4 py-3 text-sm text-red-300"
        >
          <ShieldAlert size={16} className="mt-0.5 shrink-0" /> {error}
        </p>
      )}

      {loading ? (
        <p className="mt-5 text-sm text-cream-500">Reading company stock…</p>
      ) : items.length === 0 ? (
        <p className="mt-5 text-sm text-cream-500">
          Nothing in company stock has any quantity on hand, so there is nothing to move. Receive a
          delivery in Inventory first.
        </p>
      ) : (
        <>
          <div className="mt-5 grid gap-5 sm:grid-cols-2">
            <SelectField
              id="rs-item"
              label="What is going across"
              value={itemId}
              onChange={setItemId}
              options={items.map((i) => ({
                value: i.id,
                label: `${i.name} — ${i.quantityOnHand} ${i.unit} on hand`,
              }))}
              placeholder="Choose from company stock…"
              required
            />
            <NumberField
              id="rs-qty"
              label="How many"
              value={quantity}
              onChange={setQuantity}
              step={1}
              min={1}
              hint={chosen ? `${chosen.quantityOnHand} available` : undefined}
            />
            <NairaField
              id="rs-price"
              label="Counter selling price"
              valueKobo={price}
              onChangeKobo={setPrice}
              hint={
                chosen
                  ? `cost is ${formatNaira(chosen.unitCostKobo)} — only needed the first time`
                  : "only needed the first time"
              }
            />
            <TextField
              id="rs-reason"
              label="Note"
              value={reason}
              onChange={setReason}
              placeholder="e.g. counter ran out of hinges"
            />
          </div>

          {/* What is about to happen, in the two figures that change. Shown because a transfer moves
              real goods and the mistake to catch is a mistyped quantity. */}
          {chosen && moving > 0 && !tooMany && (
            <p className="mt-4 flex flex-wrap items-center gap-2 rounded-xl border border-night-700/60 bg-night-950/40 px-4 py-3 text-sm">
              <span className="text-cream-400">
                Workshop {chosen.quantityOnHand} → {chosen.quantityOnHand - moving}
              </span>
              <ArrowRight size={14} className="text-brass-400" />
              <span className="text-cream-200">
                {moving} {chosen.unit}
                {moving === 1 ? "" : "s"} of {chosen.name} to the counter
              </span>
            </p>
          )}

          {tooMany && chosen && (
            <p className="mt-4 rounded-xl border border-amber-500/40 bg-amber-500/5 px-4 py-3 text-sm text-amber-300">
              Only {chosen.quantityOnHand} {chosen.unit}
              {chosen.quantityOnHand === 1 ? "" : "s"} on hand. Adjust the company count in Inventory
              first if the shelf disagrees with the record.
            </p>
          )}

          <div className="mt-6 flex flex-wrap gap-3">
            <Button onClick={submit} busy={busy} disabled={!chosen || moving <= 0 || tooMany}>
              <span className="flex items-center gap-1.5">
                <CheckCircle2 size={15} /> Move it across
              </span>
            </Button>
            <Button variant="ghost" onClick={onClose}>
              Close
            </Button>
          </div>
        </>
      )}
    </section>
  );
}

"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Building2,
  CheckCircle2,
  ChevronDown,
  PenLine,
  Plus,
  QrCode,
  ShieldAlert,
  TrendingDown,
} from "lucide-react";
import { getDb } from "@/lib/firebase";
import { formatNaira, parseNairaInput, toNaira } from "@/lib/erp/money";
import {
  ASSET_CATEGORIES,
  ASSET_CATEGORY_LABELS,
  ASSET_DEFAULT_LIFE_YEARS,
  ASSET_STATUSES,
  ASSET_STATUS_LABELS,
  createAsset,
  disposeAsset,
  loadAssets,
  registerTotals,
  updateAsset,
  type AssetCategory,
  type AssetStatus,
  type AssetWithDepreciation,
} from "@/lib/erp/assets";
import {
  Button,
  DateField,
  EmptyState,
  NairaField,
  NumberField,
  SelectField,
  TextAreaField,
  TextField,
  todayIso,
  validDateKey,
} from "@/components/admin/ui/Fields";
import { StatusPill, type PillTone } from "@/components/admin/ui/StatusPill";
import { useAuditActor, useErpSession } from "@/components/admin/ErpAuthProvider";
import { useConfirm } from "@/components/admin/ui/ConfirmDialog";
import type { AuditActor } from "@/lib/erp/audit";

/**
 * The fixed assets register.
 *
 * The brief lists it as its own inventory: "Permanent company assets with ID/QR, value, and
 * depreciation." It is not stock — there is one of each, it is never issued, and its value falls on a
 * schedule rather than when somebody takes it off a shelf. So the questions are different: not how
 * many are left, but what the workshop owns, what it is worth now, and what is due for replacement.
 *
 * Depreciation is straight line and computed on read. Nothing here posts to the expense ledger:
 * depreciation is a book entry the accountant makes, not cash the workshop paid, and writing expense
 * records for it would count the same machine twice against its original purchase.
 */

const TONE: Record<AssetStatus, PillTone> = {
  in_use: "positive",
  under_repair: "warn",
  idle: "neutral",
  disposed: "danger",
};

export function FixedAssetsScreen() {
  const { ask, dialog } = useConfirm();
  const session = useErpSession();
  const canEdit = session.can("inventory.edit");

  const [assets, setAssets] = useState<AssetWithDepreciation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [version, setVersion] = useState(0);
  const [showDisposed, setShowDisposed] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  const actor = useAuditActor();

  const load = useCallback(() => {
    setLoading(true);
    loadAssets(getDb())
      .then(setAssets)
      .catch((e) =>
        setError(e instanceof Error ? e.message : "Could not read the asset register.")
      )
      .finally(() => setLoading(false));
  }, []);

  useEffect(load, [load, version]);

  const totals = useMemo(() => registerTotals(assets), [assets]);
  const shown = useMemo(
    () => assets.filter((a) => (showDisposed ? true : a.status !== "disposed")),
    [assets, showDisposed]
  );

  async function dispose(asset: AssetWithDepreciation) {
    const when = await ask({
      title: `When did ${asset.assetTag} — ${asset.name} — leave?`,
      body: "Depreciation stops on that day, and the asset comes off the register's current value.",
      confirmLabel: "Continue",
      tone: "warn",
      input: {
        label: "Date it left",
        kind: "date",
        initial: todayIso(),
      },
    });
    if (when === null) return;

    const note = await ask({
      title: "What happened to it?",
      body: "Sold, scrapped, stolen. This is what the register shows in place of the machine.",
      confirmLabel: "Record disposal",
      tone: "warn",
      input: {
        label: "What happened",
        kind: "text",
        placeholder: "Sold to Alhaji Bello's workshop.",
      },
    });
    if (note === null) return;

    const dateKey = validDateKey(when.trim() || todayIso());
    if (!dateKey) {
      setError("That is not a date. Use yyyy-mm-dd, for example 2026-08-13.");
      return;
    }

    setError("");
    setBusy(true);
    try {
      await disposeAsset(getDb(), actor, asset.id, dateKey, note);
      setNotice(`${asset.assetTag} recorded as disposed of. It stays on the register as history.`);
      setTimeout(() => setNotice(""), 8000);
      setVersion((v) => v + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not record the disposal.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl text-cream-50">Fixed assets</h1>
          <p className="mt-1.5 max-w-2xl text-sm text-cream-400">
            The machines, vehicles and equipment the workshop owns — what each cost, what it is
            worth now, and how much life it has left.
          </p>
        </div>
        {canEdit && !adding && (
          <Button onClick={() => setAdding(true)}>
            <span className="flex items-center gap-1.5">
              <Plus size={15} /> Register an asset
            </span>
          </Button>
        )}
      </header>

      {error && (
        <p
          role="alert"
          className="mt-6 flex items-start gap-2 rounded-xl border border-red-500/40 bg-red-500/5 px-4 py-3 text-sm text-red-300"
        >
          <ShieldAlert size={16} className="mt-0.5 shrink-0" /> {error}
        </p>
      )}
      {notice && (
        <p
          role="status"
          className="mt-6 flex items-start gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/5 px-4 py-3 text-sm text-emerald-300"
        >
          <CheckCircle2 size={16} className="mt-0.5 shrink-0" /> {notice}
        </p>
      )}

      <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Tile label="Assets held" value={String(totals.count)} />
        <Tile label="Original cost" value={formatNaira(totals.costKobo)} />
        <Tile
          label="Book value now"
          value={formatNaira(totals.bookValueKobo)}
          hint={`${formatNaira(totals.accumulatedKobo)} written off`}
        />
        <Tile
          label="This year's charge"
          value={formatNaira(totals.annualChargeKobo)}
          hint={
            totals.fullyDepreciated > 0
              ? `${totals.fullyDepreciated} fully written down`
              : "straight line"
          }
        />
      </div>

      {adding && canEdit && (
        <AssetForm
          actor={actor}
          onClose={() => setAdding(false)}
          onSaved={(tag) => {
            setNotice(`Registered as ${tag}. Put that on the label.`);
            setTimeout(() => setNotice(""), 9000);
            setAdding(false);
            setVersion((v) => v + 1);
          }}
          onError={setError}
        />
      )}

      {totals.disposed > 0 && (
        <button
          type="button"
          onClick={() => setShowDisposed((v) => !v)}
          className="mt-6 cursor-pointer text-sm text-cream-400 transition-colors hover:text-brass-300"
        >
          {showDisposed
            ? "Hide disposed assets"
            : `Show ${totals.disposed} disposed asset${totals.disposed === 1 ? "" : "s"}`}
        </button>
      )}

      {loading ? (
        <p className="mt-8 text-sm text-cream-500">Reading the register…</p>
      ) : shown.length === 0 ? (
        <div className="mt-8">
          <EmptyState
            title="Nothing on the register yet"
            hint="Add the edge bander, the sliding saw, the generator — anything the workshop owns rather than consumes."
          />
        </div>
      ) : (
        <div className="mt-8 space-y-3">
          {shown.map((a) => {
            const expanded = openId === a.id;
            const d = a.depreciation;
            const wornPercent =
              a.costKobo > 0 ? Math.round((d.accumulatedKobo / a.costKobo) * 100) : 0;

            return (
              <div
                key={a.id}
                className={`rounded-2xl border bg-night-900/30 ${
                  a.status === "disposed" ? "border-night-800 opacity-70" : "border-night-700/60"
                }`}
              >
                <div className="flex flex-wrap items-start gap-3 p-4">
                  <button
                    type="button"
                    onClick={() => setOpenId(expanded ? null : a.id)}
                    className="flex flex-1 cursor-pointer items-start gap-3 text-left"
                    aria-expanded={expanded}
                  >
                    <ChevronDown
                      size={16}
                      className={`mt-1 shrink-0 text-cream-500 transition-transform ${
                        expanded ? "rotate-180" : ""
                      }`}
                    />
                    <span className="min-w-0">
                      <span className="block truncate text-cream-100">{a.name}</span>
                      <span className="mt-0.5 flex flex-wrap items-center gap-x-2.5 text-xs text-cream-500">
                        {/* The tag, in monospace so it can be read out and compared to a label. */}
                        <span className="flex items-center gap-1 font-mono text-brass-300">
                          <QrCode size={11} /> {a.assetTag}
                        </span>
                        <span>{ASSET_CATEGORY_LABELS[a.category]}</span>
                        {a.location && <span>{a.location}</span>}
                      </span>
                    </span>
                  </button>

                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-right">
                      <span className="block font-display text-lg text-cream-100">
                        {formatNaira(d.bookValueKobo)}
                      </span>
                      <span className="block text-xs text-cream-600">
                        of {formatNaira(a.costKobo)}
                      </span>
                    </span>
                    <StatusPill tone={TONE[a.status]}>
                      {ASSET_STATUS_LABELS[a.status]}
                    </StatusPill>
                    {canEdit && a.status !== "disposed" && (
                      <button
                        type="button"
                        onClick={() => setEditingId(editingId === a.id ? null : a.id)}
                        className="cursor-pointer rounded-lg p-2 text-cream-600 transition-colors hover:text-brass-300"
                        aria-label={`Edit ${a.name}`}
                      >
                        <PenLine size={15} />
                      </button>
                    )}
                  </div>
                </div>

                {/* How much life has been used. A bar reads faster than two currency figures. */}
                {a.status !== "disposed" && (
                  <div className="px-4 pb-3">
                    <div className="h-1.5 overflow-hidden rounded-full bg-night-800">
                      <div
                        className={`h-full rounded-full ${
                          d.fullyDepreciated
                            ? "bg-red-500/70"
                            : wornPercent > 75
                              ? "bg-amber-500"
                              : "bg-brass-500"
                        }`}
                        style={{ width: `${Math.min(100, wornPercent)}%` }}
                      />
                    </div>
                    <p className="mt-1.5 text-xs text-cream-600">
                      {d.fullyDepreciated
                        ? "Fully written down — still working, but worth nothing on the books"
                        : `${wornPercent}% written off · ${d.remainingYears} year${
                            d.remainingYears === 1 ? "" : "s"
                          } of life left`}
                    </p>
                  </div>
                )}

                {expanded && (
                  <dl className="grid gap-4 border-t border-night-700/60 px-4 py-4 text-sm sm:grid-cols-3">
                    <Fact label="Acquired" value={a.acquiredOn || "—"} />
                    <Fact label="Age" value={`${d.ageYears} years`} />
                    <Fact label="Useful life" value={`${a.usefulLifeYears} years`} />
                    <Fact
                      label="Annual charge"
                      value={formatNaira(d.annualChargeKobo)}
                      hint="straight line"
                    />
                    <Fact label="Written off" value={formatNaira(d.accumulatedKobo)} />
                    <Fact
                      label="Residual"
                      value={a.residualKobo > 0 ? formatNaira(a.residualKobo) : "none"}
                    />
                    {a.serialNumber && <Fact label="Serial" value={a.serialNumber} />}
                    {a.supplier && <Fact label="Bought from" value={a.supplier} />}
                    {a.disposedOn && (
                      <Fact
                        label="Disposed"
                        value={a.disposedOn}
                        hint={a.disposalNote}
                      />
                    )}
                    {a.notes && (
                      <div className="sm:col-span-3">
                        <Fact label="Notes" value={a.notes} />
                      </div>
                    )}
                    {canEdit && a.status !== "disposed" && (
                      <div className="sm:col-span-3">
                        <Button variant="ghost" onClick={() => dispose(a)} busy={busy}>
                          Record a disposal
                        </Button>
                      </div>
                    )}
                  </dl>
                )}

                {editingId === a.id && canEdit && (
                  <div className="border-t border-night-700/60 p-4">
                    <AssetForm
                      actor={actor}
                      editing={a}
                      onClose={() => setEditingId(null)}
                      onSaved={() => {
                        setNotice("Asset updated.");
                        setTimeout(() => setNotice(""), 6000);
                        setEditingId(null);
                        setVersion((v) => v + 1);
                      }}
                      onError={setError}
                    />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      <p className="mt-8 flex items-start gap-2 text-xs leading-relaxed text-cream-600">
        <TrendingDown size={13} className="mt-0.5 shrink-0" />
        Depreciation is straight line and worked out when this page is opened, so it is always
        current. It is a book figure for the accounts — no expense is posted for it, because the cash
        already left when the asset was bought.
      </p>
      {dialog}
    </div>
  );
}

/** Register or correct an asset. */
function AssetForm({
  actor,
  editing,
  onClose,
  onSaved,
  onError,
}: {
  actor: AuditActor;
  editing?: AssetWithDepreciation;
  onClose: () => void;
  onSaved: (assetTag: string) => void;
  onError: (message: string) => void;
}) {
  const [name, setName] = useState(editing?.name ?? "");
  const [category, setCategory] = useState<AssetCategory>(editing?.category ?? "machine");
  const [cost, setCost] = useState(editing ? String(toNaira(editing.costKobo)) : "");
  const [acquiredOn, setAcquiredOn] = useState(editing?.acquiredOn ?? todayIso());
  const [life, setLife] = useState(
    String(editing?.usefulLifeYears ?? ASSET_DEFAULT_LIFE_YEARS.machine)
  );
  const [residual, setResidual] = useState(
    editing && editing.residualKobo > 0 ? String(toNaira(editing.residualKobo)) : ""
  );
  const [location, setLocation] = useState(editing?.location ?? "");
  const [serial, setSerial] = useState(editing?.serialNumber ?? "");
  const [supplier, setSupplier] = useState(editing?.supplier ?? "");
  const [status, setStatus] = useState<AssetStatus>(editing?.status ?? "in_use");
  const [notes, setNotes] = useState(editing?.notes ?? "");
  const [busy, setBusy] = useState(false);

  /** The default life follows the category until somebody types over it. */
  function pickCategory(next: AssetCategory) {
    setCategory(next);
    if (!editing) setLife(String(ASSET_DEFAULT_LIFE_YEARS[next]));
  }

  async function save() {
    setBusy(true);
    try {
      const input = {
        name,
        category,
        costKobo: parseNairaInput(cost),
        acquiredOn,
        usefulLifeYears: Number(life) || 0,
        residualKobo: residual ? parseNairaInput(residual) : 0,
        location: location || undefined,
        serialNumber: serial || undefined,
        supplier: supplier || undefined,
        notes: notes || undefined,
      };
      if (editing) {
        await updateAsset(getDb(), actor, editing.id, { ...input, status });
        onSaved(editing.assetTag);
      } else {
        const res = await createAsset(getDb(), actor, input);
        onSaved(res.assetTag);
      }
    } catch (e) {
      onError(e instanceof Error ? e.message : "Could not save the asset.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section
      className={
        editing
          ? ""
          : "mt-6 rounded-3xl border border-brass-500/30 bg-night-900/40 p-6"
      }
    >
      {!editing && <h2 className="font-display text-lg text-cream-100">Register an asset</h2>}

      <div className="mt-5 grid gap-5 sm:grid-cols-2">
        <TextField
          id="as-name"
          label="What is it"
          value={name}
          onChange={setName}
          required
          placeholder="e.g. Edge banding machine"
        />
        <SelectField
          id="as-category"
          label="Category"
          value={category}
          onChange={pickCategory}
          options={ASSET_CATEGORIES.map((c) => ({ value: c, label: ASSET_CATEGORY_LABELS[c] }))}
        />
        <NairaField id="as-cost" label="What it cost" valueKobo={cost} onChangeKobo={setCost} />
        <DateField
          id="as-acquired"
          label="Acquired on"
          value={acquiredOn}
          onChange={setAcquiredOn}
          max={todayIso()}
          required
          hint="depreciation runs from here"
        />
        <NumberField
          id="as-life"
          label="Useful life (years)"
          value={life}
          onChange={setLife}
          step={1}
          min={1}
        />
        <NairaField
          id="as-residual"
          label="Value at end of life"
          valueKobo={residual}
          onChangeKobo={setResidual}
          hint="usually nothing"
        />
        <TextField
          id="as-location"
          label="Where it is"
          value={location}
          onChange={setLocation}
          placeholder="e.g. Machine hall"
        />
        <TextField id="as-serial" label="Serial number" value={serial} onChange={setSerial} />
        <TextField id="as-supplier" label="Bought from" value={supplier} onChange={setSupplier} />
        {editing && (
          <SelectField
            id="as-status"
            label="Condition"
            value={status}
            onChange={(v) => setStatus(v as AssetStatus)}
            // Disposal has its own action, which records when and why — so it is not offered as a
            // status somebody can quietly select.
            options={ASSET_STATUSES.filter((s) => s !== "disposed").map((s) => ({
              value: s,
              label: ASSET_STATUS_LABELS[s],
            }))}
          />
        )}
        <div className="sm:col-span-2">
          <TextAreaField id="as-notes" label="Notes" value={notes} onChange={setNotes} rows={2} />
        </div>
      </div>

      <div className="mt-6 flex flex-wrap gap-3">
        <Button onClick={save} busy={busy} disabled={!name.trim()}>
          {editing ? "Save changes" : "Register it"}
        </Button>
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
      </div>
    </section>
  );
}

function Tile({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-3xl border border-night-700/60 bg-night-900/40 p-5">
      <p className="text-xs uppercase tracking-wider text-cream-500">{label}</p>
      <p className="mt-2 font-display text-2xl text-cream-50">{value}</p>
      {hint && <p className="mt-1 text-xs text-cream-500">{hint}</p>}
    </div>
  );
}

function Fact({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wider text-cream-600">{label}</dt>
      <dd className="mt-1 text-cream-200">{value}</dd>
      {hint && <dd className="mt-0.5 text-xs text-cream-600">{hint}</dd>}
    </div>
  );
}

"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  CheckCircle2,
  Plus,
  Printer,
  Ruler,
  Trash2,
} from "lucide-react";
import { getDb } from "@/lib/firebase";
import { BOARD_TYPE_LABELS, CE_RATED_BOARD_TYPES, type BoardType } from "@/lib/erp/enums";
import { BoardReference } from "@/components/site/BoardReference";
import {
  computeCuttingListTotals,
  createCuttingList,
  DEFAULT_WASTE_PERCENT,
  EDGE_CODES,
  EDGE_CODE_META,
  type CuttingListPart,
  type EdgeCode,
} from "@/lib/erp/cuttingList";

/**
 * The public cutting list builder.
 *
 * A customer fills this in themselves — part by part, with the sizes they want — and the
 * workshop gets a list it can cut from instead of a sheet of paper that goes missing. That is
 * the whole reason it is public: the person who knows what they want cut is the customer, and
 * making them come in to dictate it is how the detail gets lost in translation.
 *
 * It computes what the paper form cannot: banding length per tape width, and boards required
 * from the panel area plus a waste allowance. Both are shown live, so somebody sizing a job
 * can see the board count move as they add parts.
 *
 * No login. It writes one document to a collection whose rules allow exactly that and nothing
 * else — see the `cuttingLists` block in firestore.rules.
 */

/** Tape widths the workshop stocks. */
const TAPE_WIDTHS = [18, 36] as const;

interface PartDraft extends Omit<CuttingListPart, "widthMm" | "lengthMm" | "quantity"> {
  /** Kept as strings so a half-typed "12" is not coerced mid-edit. */
  widthMm: string;
  lengthMm: string;
  quantity: string;
}

let seq = 1;
const blankPart = (): PartDraft => ({
  id: `p${seq++}`,
  part: "",
  widthMm: "",
  lengthMm: "",
  quantity: "1",
  boardType: undefined,
  boardColour: "",
  edgeCode: "none",
  edgeTapeMm: 18,
  notes: "",
});

export function CuttingListBuilder() {
  const [customerName, setCustomerName] = useState("");
  const [phone, setPhone] = useState("");
  const [title, setTitle] = useState("");
  const [parts, setParts] = useState<PartDraft[]>([blankPart(), blankPart(), blankPart()]);
  const [waste, setWaste] = useState(String(DEFAULT_WASTE_PERCENT));
  const [offset, setOffset] = useState("3");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState<{ listNumber: string } | null>(null);

  /** The parts as the totals function wants them. */
  const asParts = useMemo<CuttingListPart[]>(
    () =>
      parts.map((p) => ({
        ...p,
        widthMm: Number(p.widthMm) || 0,
        lengthMm: Number(p.lengthMm) || 0,
        quantity: Number(p.quantity) || 0,
      })),
    [parts]
  );

  const totals = useMemo(
    () => computeCuttingListTotals(asParts, Number(waste) || 0),
    [asParts, waste]
  );

  /** Board lines with no material chosen, which cannot be counted toward boards. */
  const untyped = useMemo(
    () =>
      asParts.filter(
        (p) => p.part.trim() !== "" && p.quantity > 0 && p.widthMm > 0 && !p.boardType
      ),
    [asParts]
  );

  function patch(id: string, next: Partial<PartDraft>) {
    setParts((prev) => prev.map((p) => (p.id === id ? { ...p, ...next } : p)));
  }

  async function submit() {
    setError("");
    if (!customerName.trim()) {
      setError("Please give your name so we know whose list this is.");
      return;
    }
    if (!phone.trim()) {
      setError("Please give a phone number so we can reach you about it.");
      return;
    }
    const ready = asParts.filter(
      (p) => p.part.trim() !== "" && p.quantity > 0 && p.widthMm > 0 && p.lengthMm > 0
    );
    if (ready.length === 0) {
      setError("Add at least one part with a width, a length and a quantity.");
      return;
    }

    setBusy(true);
    try {
      // `null` actor: this came through the public link, and the record says so.
      const res = await createCuttingList(getDb(), null, {
        customerName,
        customerPhone: phone,
        title: title || undefined,
        parts: ready,
        wastePercent: Number(waste) || DEFAULT_WASTE_PERCENT,
        offsetMm: Number(offset) || 3,
        notes: notes || undefined,
      });
      setDone({ listNumber: res.listNumber });
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "Could not send the list. Please check your connection and try again."
      );
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <div className="mx-auto max-w-2xl px-5 py-20 text-center">
        <CheckCircle2 className="mx-auto text-emerald-400" size={44} />
        <h1 className="mt-6 font-display text-3xl text-cream-50">Cutting list sent</h1>
        <p className="mt-3 text-cream-300">
          Your reference is{" "}
          <span className="font-mono text-brass-300">{done.listNumber}</span>. Please quote it
          when you come in — write it down or take a photograph of this screen.
        </p>
        <div className="mt-8 rounded-2xl border border-night-700/60 bg-night-900/40 p-6 text-left">
          <dl className="grid gap-3 sm:grid-cols-3">
            <Fig label="Panels" value={String(totals.panelCount)} />
            <Fig label="Boards needed" value={String(totals.totalBoardsRequired)} />
            <Fig label="Edge banding" value={`${totals.totalTapeMetres} m`} />
          </dl>
        </div>
        <div className="mt-8 flex flex-wrap justify-center gap-3">
          <button
            type="button"
            onClick={() => window.print()}
            className="inline-flex cursor-pointer items-center gap-2 rounded-full border border-night-600 px-6 py-3 text-sm text-cream-200 transition-colors hover:border-brass-500/60 hover:text-brass-300"
          >
            <Printer size={15} /> Print a copy
          </button>
          <Link
            href="/"
            className="inline-flex items-center rounded-full bg-brass-500 px-6 py-3 text-sm font-medium text-night-950 transition-colors hover:bg-brass-400"
          >
            Back to the site
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl px-5 pb-24 pt-10 sm:px-8">
      <header>
        <p className="text-eyebrow">Cutting list</p>
        <h1 className="text-title mt-3 text-cream-50">Tell us what to cut</h1>
        <p className="mt-4 max-w-2xl leading-relaxed text-cream-400">
          Fill in each panel you need — what it is, how wide, how long, how many, and which
          edges want banding. We will work out the boards and the banding for you. Keep the
          reference number you get at the end.
        </p>
        <p className="mt-3 text-sm text-cream-500">
          All sizes in millimetres. <strong className="text-cream-300">W</strong> is across,{" "}
          <strong className="text-cream-300">L</strong> is down.
        </p>
      </header>

      {error && (
        <p
          role="alert"
          className="mt-6 flex items-start gap-2 rounded-xl border border-red-500/30 bg-red-500/5 px-4 py-3 text-sm text-red-400"
        >
          <AlertTriangle size={16} className="mt-0.5 shrink-0" /> {error}
        </p>
      )}

      {/* Who it is for */}
      <section className="mt-8 grid gap-4 sm:grid-cols-3">
        <Field label="Your name" value={customerName} onChange={setCustomerName} required />
        <Field label="Phone number" value={phone} onChange={setPhone} required />
        <Field
          label="What is it for (optional)"
          value={title}
          onChange={setTitle}
          placeholder="e.g. Kitchen at Gwarinpa"
        />
      </section>

      {/* Parts */}
      <section className="mt-10">
        <h2 className="font-display text-xl text-cream-100">Parts</h2>

        {/* What the board names mean.
            The board picker below is a `<select>`, which cannot hold a picture — and a customer
            choosing between "Egger" and "MFC 9×7 (Bangaji)" from names alone is guessing. This
            strip is the reference for that choice, sitting immediately above the form rather
            than on another page where it would not be read. */}
        <BoardReference />

        <div className="mt-4 space-y-3">
          {parts.map((p, i) => (
            <div
              key={p.id}
              className="rounded-2xl border border-night-700/60 bg-night-900/40 p-4"
            >
              <div className="flex items-center justify-between">
                <span className="text-xs uppercase tracking-wider text-cream-600">
                  Part {i + 1}
                </span>
                {parts.length > 1 && (
                  <button
                    type="button"
                    aria-label={`Remove part ${i + 1}`}
                    onClick={() => setParts((prev) => prev.filter((x) => x.id !== p.id))}
                    className="cursor-pointer text-cream-500 transition-colors hover:text-red-400"
                  >
                    <Trash2 size={15} />
                  </button>
                )}
              </div>

              <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <Field
                  label="What is it"
                  value={p.part}
                  onChange={(v) => patch(p.id, { part: v })}
                  placeholder="e.g. Shelf"
                />
                <Field
                  label="Width (mm)"
                  value={p.widthMm}
                  onChange={(v) => patch(p.id, { widthMm: v })}
                  numeric
                />
                <Field
                  label="Length (mm)"
                  value={p.lengthMm}
                  onChange={(v) => patch(p.id, { lengthMm: v })}
                  numeric
                />
                <Field
                  label="How many"
                  value={p.quantity}
                  onChange={(v) => patch(p.id, { quantity: v })}
                  numeric
                />

                <Select
                  label="Board"
                  value={p.boardType ?? ""}
                  onChange={(v) => patch(p.id, { boardType: (v || undefined) as BoardType })}
                  placeholder="Which board?"
                  options={CE_RATED_BOARD_TYPES.map((t) => ({
                    value: t,
                    label: BOARD_TYPE_LABELS[t],
                  }))}
                />
                <Field
                  label="Colour / finish"
                  value={p.boardColour ?? ""}
                  onChange={(v) => patch(p.id, { boardColour: v })}
                  placeholder="e.g. Oak Brown"
                />
                <Select
                  label="Edges to band"
                  value={p.edgeCode}
                  onChange={(v) => patch(p.id, { edgeCode: v as EdgeCode })}
                  options={EDGE_CODES.map((c) => ({
                    value: c,
                    label: `${EDGE_CODE_META[c].label} — ${EDGE_CODE_META[c].detail}`,
                  }))}
                />
                <Select
                  label="Banding width"
                  value={String(p.edgeTapeMm)}
                  onChange={(v) => patch(p.id, { edgeTapeMm: Number(v) })}
                  options={TAPE_WIDTHS.map((w) => ({
                    value: String(w),
                    label: `${w}mm`,
                  }))}
                />
              </div>
            </div>
          ))}
        </div>

        <button
          type="button"
          onClick={() => setParts((prev) => [...prev, blankPart()])}
          className="mt-4 flex cursor-pointer items-center gap-2 text-sm text-brass-300 transition-colors hover:text-brass-200"
        >
          <Plus size={15} /> Add another part
        </button>
      </section>

      {/* Edge code guide, straight from the workshop's own legend. */}
      <section className="mt-10 rounded-2xl border border-night-700/60 bg-night-900/30 p-6">
        <h2 className="flex items-center gap-2 font-display text-lg text-cream-100">
          <Ruler size={17} className="text-brass-400" /> What the edge codes mean
        </h2>
        <dl className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {EDGE_CODES.filter((c) => c !== "none").map((c) => (
            <div key={c} className="flex items-start gap-3">
              <dt className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-brass-500/40 font-mono text-sm text-brass-300">
                {EDGE_CODE_META[c].label}
              </dt>
              <dd className="text-sm text-cream-400">
                {EDGE_CODE_META[c].detail}
                <span className="block text-xs text-cream-600">
                  {EDGE_CODE_META[c].edges} edge
                  {EDGE_CODE_META[c].edges === 1 ? "" : "s"}
                </span>
              </dd>
            </div>
          ))}
        </dl>
      </section>

      {/* Live totals */}
      <section className="mt-10 grid gap-6 lg:grid-cols-3">
        <div className="rounded-2xl border border-night-700/60 bg-night-900/40 p-6">
          <h3 className="text-xs uppercase tracking-wider text-cream-500">
            Edge banding
          </h3>
          {totals.totalTapeMetres === 0 ? (
            <p className="mt-3 text-sm text-cream-600">Nothing banded yet.</p>
          ) : (
            <>
              <dl className="mt-3 space-y-1.5">
                {Object.entries(totals.tapeMetresByWidth).map(([w, m]) => (
                  <div key={w} className="flex justify-between text-sm">
                    <dt className="text-cream-400">{w}mm</dt>
                    <dd className="tabular-nums text-cream-200">{m} m</dd>
                  </div>
                ))}
              </dl>
              <p className="mt-3 border-t border-night-800 pt-3 font-display text-2xl text-brass-300">
                {totals.totalTapeMetres} m
              </p>
            </>
          )}
        </div>

        <div className="rounded-2xl border border-night-700/60 bg-night-900/40 p-6">
          <h3 className="text-xs uppercase tracking-wider text-cream-500">
            Boards needed
          </h3>
          {totals.boardsByType.length === 0 ? (
            <p className="mt-3 text-sm text-cream-600">
              Choose a board on each part to see this.
            </p>
          ) : (
            <>
              <dl className="mt-3 space-y-1.5">
                {totals.boardsByType.map((b) => (
                  <div key={b.boardType} className="flex justify-between text-sm">
                    <dt className="text-cream-400">{b.label}</dt>
                    <dd className="tabular-nums text-cream-200">
                      {b.boardsRequired}
                      <span className="ml-1 text-xs text-cream-600">
                        ({b.areaM2} m²)
                      </span>
                    </dd>
                  </div>
                ))}
              </dl>
              <p className="mt-3 border-t border-night-800 pt-3 font-display text-2xl text-brass-300">
                {totals.totalBoardsRequired} board
                {totals.totalBoardsRequired === 1 ? "" : "s"}
              </p>
              <p className="mt-1 text-xs text-cream-600">
                Includes {waste}% for offcuts, on a {1220}×{2440}mm sheet.
              </p>
            </>
          )}
        </div>

        <div className="rounded-2xl border border-night-700/60 bg-night-900/40 p-6">
          <h3 className="text-xs uppercase tracking-wider text-cream-500">Totals</h3>
          <dl className="mt-3 space-y-1.5 text-sm">
            <div className="flex justify-between">
              <dt className="text-cream-400">Parts</dt>
              <dd className="tabular-nums text-cream-200">{totals.partCount}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-cream-400">Panels</dt>
              <dd className="tabular-nums text-cream-200">{totals.panelCount}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-cream-400">Total area</dt>
              <dd className="tabular-nums text-cream-200">{totals.totalAreaM2} m²</dd>
            </div>
          </dl>

          <div className="mt-4 grid grid-cols-2 gap-3 border-t border-night-800 pt-4">
            <Field label="Waste %" value={waste} onChange={setWaste} numeric small />
            {/* The saw removes material on every cut, so a list cut without an allowance
                comes out short on the last panel. */}
            <Field
              label="Blade offset (mm)"
              value={offset}
              onChange={setOffset}
              numeric
              small
            />
          </div>
        </div>
      </section>

      {untyped.length > 0 && (
        <p className="mt-6 flex items-start gap-2 rounded-xl border border-amber-500/40 bg-amber-500/5 px-4 py-3 text-sm text-amber-300">
          <AlertTriangle size={16} className="mt-0.5 shrink-0" />
          <span>
            {untyped.length} part{untyped.length === 1 ? "" : "s"} have no board chosen, so
            they are not counted in the boards needed. You can still send the list — we will
            confirm the board with you.
          </span>
        </p>
      )}

      <section className="mt-8">
        <label htmlFor="cl-notes" className="mb-1.5 block text-sm text-cream-300">
          Anything else we should know
        </label>
        <textarea
          id="cl-notes"
          rows={3}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Grain direction, which face shows, when you need it…"
          className="w-full rounded-xl border border-night-600 bg-night-800/60 px-4 py-3 text-cream-100 placeholder:text-cream-600 focus:border-brass-500 focus:outline-none"
        />
      </section>

      <div className="mt-8 flex flex-wrap items-center gap-4">
        <button
          type="button"
          onClick={submit}
          disabled={busy}
          className="inline-flex cursor-pointer items-center gap-2 rounded-full bg-brass-500 px-8 py-4 font-medium text-night-950 transition-all duration-300 hover:bg-brass-400 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {busy ? "Sending…" : "Send my cutting list"}
        </button>
        <p className="text-xs text-cream-600">
          You will get a reference number to quote when you come in.
        </p>
      </div>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  required,
  numeric,
  small,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  required?: boolean;
  numeric?: boolean;
  small?: boolean;
}) {
  const id = `cl-${label.replace(/[^a-z]/gi, "-").toLowerCase()}`;
  return (
    <div>
      <label
        htmlFor={id}
        className={`mb-1.5 block ${small ? "text-xs" : "text-sm"} text-cream-300`}
      >
        {label}
        {required && <span className="ml-1 text-brass-400">*</span>}
      </label>
      <input
        id={id}
        type={numeric ? "number" : "text"}
        inputMode={numeric ? "decimal" : undefined}
        min={numeric ? 0 : undefined}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full rounded-xl border border-night-600 bg-night-800/60 px-4 py-3 text-cream-100 placeholder:text-cream-600 focus:border-brass-500 focus:outline-none"
      />
    </div>
  );
}

function Select({
  label,
  value,
  onChange,
  options,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: Array<{ value: string; label: string }>;
  placeholder?: string;
}) {
  const id = `cls-${label.replace(/[^a-z]/gi, "-").toLowerCase()}-${value}`;
  return (
    <div>
      <label htmlFor={id} className="mb-1.5 block text-sm text-cream-300">
        {label}
      </label>
      <select
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full cursor-pointer rounded-xl border border-night-600 bg-night-800/60 px-4 py-3 text-cream-100 focus:border-brass-500 focus:outline-none"
      >
        {placeholder && <option value="">{placeholder}</option>}
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}

function Fig({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wider text-cream-500">{label}</dt>
      <dd className="mt-1 font-display text-2xl text-cream-50">{value}</dd>
    </div>
  );
}

"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  CheckCircle2,
  CircleDot,
  Disc3,
  Droplets,
  Gauge,
  Layers,
  Plus,
  ShieldAlert,
  TrendingUp,
} from "lucide-react";
import { getDb } from "@/lib/firebase";
import { formatNaira, parseNairaInput, toNaira } from "@/lib/erp/money";
import {
  boardTypeLabel,
  closeOpenCycle,
  CYCLE_CONSUMABLE_LABELS,
  CYCLE_DEFAULT_COST_KOBO,
  CYCLE_UNIT,
  issueConsumable,
  loadCycles,
  type CycleConsumable,
  type CycleWithMetrics,
} from "@/lib/erp/cycles";
import {
  Button,
  DateField,
  EmptyState,
  NairaField,
  NumberField,
  TextField,
  todayIso,
  validDateKey,
} from "@/components/admin/ui/Fields";
import { StatusPill } from "@/components/admin/ui/StatusPill";
import { useAuditActor, useErpSession } from "@/components/admin/ErpAuthProvider";

/**
 * Blade and gum cycles.
 *
 * The question this screen answers is "how many boards did the last blade cut, and what did that
 * work out to per board" — which a store count cannot answer, and which is why the brief calls this
 * "performance-cycle based, not quantity-based inventory".
 *
 * Everything except the cost and the label is derived. Boards come from the work logs between the
 * two issue dates, so nobody types a figure that looks like a measurement but is a guess. Issuing a
 * new one closes the previous cycle automatically and books the cost as a service expense dated to
 * the issue day, both of which the brief asks for by name.
 */

const TABS: Array<{ key: CycleConsumable; icon: typeof Disc3 }> = [
  { key: "blade", icon: Disc3 },
  { key: "gum", icon: Droplets },
];

export function ConsumableCyclesScreen() {
  const session = useErpSession();
  /*
   * Issuing books an expense in the same batch, so it needs exactly the grant the expense ledger
   * needs — not `inventory.edit`. Offering the button to someone with only stock permission would
   * show them a control whose write is denied at the database, which reads as a broken feature
   * rather than as a permission they do not have.
   */
  const canIssue = session.can("expense.create");
  /** Closing books nothing, so whoever manages stock may record that one came off. */
  const canClose = canIssue || session.can("inventory.edit");

  const [tab, setTab] = useState<CycleConsumable>("blade");
  const [cycles, setCycles] = useState<CycleWithMetrics[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [version, setVersion] = useState(0);

  const [issuing, setIssuing] = useState(false);
  const [label, setLabel] = useState("");
  const [dateKey, setDateKey] = useState(todayIso());
  const [cost, setCost] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [notes, setNotes] = useState("");

  const actor = useAuditActor();

  const load = useCallback(() => {
    setLoading(true);
    loadCycles(getDb(), tab, 12)
      .then(setCycles)
      .catch((e) =>
        setError(e instanceof Error ? e.message : "Could not read the cycle history.")
      )
      .finally(() => setLoading(false));
  }, [tab]);

  useEffect(load, [load, version]);

  // The reference cost, pre-filled so the form does not open empty on the common case.
  function openIssue() {
    setIssuing(true);
    setError("");
    setLabel("");
    setDateKey(todayIso());
    setCost(String(toNaira(CYCLE_DEFAULT_COST_KOBO[tab])));
    setQuantity("1");
    setNotes("");
  }

  async function submit() {
    setError("");
    setBusy(true);
    try {
      const res = await issueConsumable(getDb(), actor, {
        consumable: tab,
        label,
        dateKey,
        costKobo: parseNairaInput(cost),
        quantity: Number(quantity) || 1,
        notes: notes || undefined,
      });
      setNotice(
        `${label.trim()} fitted.` +
          (res.closedCycleId ? " The previous cycle was closed." : "") +
          " The cost is booked against cutting & edging."
      );
      setTimeout(() => setNotice(""), 9000);
      setIssuing(false);
      setVersion((v) => v + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not record the issue.");
    } finally {
      setBusy(false);
    }
  }

  async function close() {
    const when = window.prompt(
      `What day did it come off the machine?\n\nUse yyyy-mm-dd. Leave blank for today.`,
      todayIso()
    );
    if (when === null) return;
    const reason = window.prompt("Why was it taken off without a replacement? (optional)") ?? "";

    const dateKey = validDateKey(when.trim() || todayIso());
    if (!dateKey) {
      setError("That is not a date. Use yyyy-mm-dd, for example 2026-08-13.");
      return;
    }

    setError("");
    setBusy(true);
    try {
      await closeOpenCycle(getDb(), actor, tab, dateKey, reason);
      setNotice("Cycle closed.");
      setTimeout(() => setNotice(""), 6000);
      setVersion((v) => v + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not close the cycle.");
    } finally {
      setBusy(false);
    }
  }

  const open = cycles.find((c) => c.endKey === null);
  const closed = cycles.filter((c) => c.endKey !== null);

  /** The average across closed cycles, which is what makes one cycle judgeable. */
  const benchmark = useMemo(() => {
    const withBoards = closed.filter((c) => c.metrics.boards > 0);
    if (withBoards.length === 0) return null;
    const boards = withBoards.reduce((s, c) => s + c.metrics.boards, 0);
    const cost = withBoards.reduce((s, c) => s + c.costKobo * c.quantity, 0);
    const days = withBoards.reduce((s, c) => s + (c.metrics.durationDays ?? 0), 0);
    return {
      cycles: withBoards.length,
      avgBoards: Math.round(boards / withBoards.length),
      avgDays: days > 0 ? Math.round(days / withBoards.length) : null,
      costPerBoardKobo: Math.round(cost / boards),
    };
  }, [closed]);

  return (
    <div>
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl text-cream-50">Blades &amp; gum</h1>
          <p className="mt-1.5 max-w-2xl text-sm text-cream-400">
            How long each one lasted and what it cost per board. The boards are counted from the
            work logs between one issue and the next, so nothing here is typed twice.
          </p>
        </div>
        {canIssue && !issuing && (
          <Button onClick={openIssue}>
            <span className="flex items-center gap-1.5">
              <Plus size={15} /> Fit a new {CYCLE_UNIT[tab]}
            </span>
          </Button>
        )}
      </header>

      {/* Which consumable. */}
      <div className="mt-6 flex flex-wrap gap-2">
        {TABS.map(({ key, icon: Icon }) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            aria-pressed={tab === key}
            className={`flex cursor-pointer items-center gap-1.5 rounded-xl border px-4 py-2.5 text-sm transition-colors ${
              tab === key
                ? "border-brass-500 bg-brass-500/15 text-brass-200"
                : "border-night-600 bg-night-800/50 text-cream-300 hover:border-brass-500/50"
            }`}
          >
            <Icon size={15} /> {CYCLE_CONSUMABLE_LABELS[key]}
          </button>
        ))}
      </div>

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

      {issuing && canIssue && (
        <section className="mt-6 rounded-3xl border border-brass-500/30 bg-night-900/40 p-6">
          <h2 className="font-display text-lg text-cream-100">
            Fit a new {CYCLE_CONSUMABLE_LABELS[tab].toLowerCase()}
          </h2>
          <p className="mt-1.5 max-w-2xl text-sm text-cream-400">
            This closes the cycle currently running and books the cost against cutting &amp;
            edging, dated to the day it went on.
          </p>
          <div className="mt-5 grid gap-5 sm:grid-cols-2">
            <TextField
              id="cy-label"
              label="Brand or model"
              value={label}
              onChange={setLabel}
              required
              placeholder={tab === "blade" ? "e.g. Freud 350mm" : "e.g. Jowat 280.30"}
            />
            <DateField
              id="cy-date"
              label="Day it went on"
              value={dateKey}
              onChange={setDateKey}
              max={todayIso()}
              required
            />
            <NairaField
              id="cy-cost"
              label={`Cost per ${CYCLE_UNIT[tab]}`}
              valueKobo={cost}
              onChangeKobo={setCost}
              hint={`reference: ${formatNaira(CYCLE_DEFAULT_COST_KOBO[tab])}`}
            />
            <NumberField
              id="cy-qty"
              label={`How many ${CYCLE_UNIT[tab]}s`}
              value={quantity}
              onChange={setQuantity}
              step={1}
              min={1}
            />
            <div className="sm:col-span-2">
              <TextField id="cy-notes" label="Notes" value={notes} onChange={setNotes} />
            </div>
          </div>
          <div className="mt-6 flex flex-wrap gap-3">
            <Button onClick={submit} busy={busy} disabled={!label.trim()}>
              Record it
            </Button>
            <Button variant="ghost" onClick={() => setIssuing(false)}>
              Cancel
            </Button>
          </div>
        </section>
      )}

      {/* What is on the machine now. */}
      {loading ? (
        <p className="mt-8 text-sm text-cream-500">Counting boards…</p>
      ) : (
        <>
          {open ? (
            <section className="mt-8 rounded-3xl border border-brass-500/30 bg-night-900/40 p-6">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="flex items-center gap-2 text-xs uppercase tracking-wider text-brass-400">
                    <CircleDot size={13} /> On the machine now
                  </p>
                  <h2 className="mt-2 font-display text-xl text-cream-50">{open.label}</h2>
                  <p className="mt-1 text-sm text-cream-500">
                    Fitted {open.startKey} · {formatNaira(open.costKobo * open.quantity)}
                    {open.quantity > 1 && ` for ${open.quantity} ${CYCLE_UNIT[tab]}s`}
                  </p>
                </div>
                {canClose && (
                  <Button variant="ghost" onClick={close} busy={busy}>
                    Took it off
                  </Button>
                )}
              </div>

              <CycleFigures cycle={open} benchmarkCostKobo={benchmark?.costPerBoardKobo ?? null} />
            </section>
          ) : (
            <div className="mt-8">
              <EmptyState
                title={`No ${CYCLE_CONSUMABLE_LABELS[tab].toLowerCase()} on the machine`}
                hint={
                  canIssue
                    ? "Record one when it is fitted, and the boards it cuts will be counted from the work logs."
                    : "Nothing has been recorded as fitted."
                }
              />
            </div>
          )}

          {/* How this compares. */}
          {benchmark && (
            <section className="mt-6 rounded-3xl border border-night-700/60 bg-night-900/30 p-5">
              <h2 className="flex items-center gap-2 font-display text-lg text-cream-100">
                <TrendingUp size={18} className="text-brass-400" /> Across{" "}
                {benchmark.cycles} finished cycle{benchmark.cycles === 1 ? "" : "s"}
              </h2>
              <dl className="mt-4 grid gap-4 sm:grid-cols-3">
                <Figure label="Average boards" value={String(benchmark.avgBoards)} />
                <Figure
                  label="Average life"
                  value={benchmark.avgDays === null ? "—" : `${benchmark.avgDays} days`}
                />
                <Figure
                  label="Cost per board"
                  value={formatNaira(benchmark.costPerBoardKobo)}
                  hint="the figure to beat"
                />
              </dl>
            </section>
          )}

          {/* History. */}
          {closed.length > 0 && (
            <section className="mt-8">
              <h2 className="font-display text-lg text-cream-100">Finished cycles</h2>
              <div className="mt-4 space-y-3">
                {closed.map((c) => (
                  <article
                    key={c.id}
                    className="rounded-2xl border border-night-700/60 bg-night-900/30 p-5"
                  >
                    <div className="flex flex-wrap items-baseline justify-between gap-3">
                      <div>
                        <p className="text-cream-100">{c.label}</p>
                        <p className="mt-0.5 text-xs text-cream-500">
                          {c.startKey} to {c.endKey} ·{" "}
                          {formatNaira(c.costKobo * c.quantity)}
                        </p>
                      </div>
                      {c.metrics.costPerBoardKobo !== null &&
                        benchmark &&
                        c.metrics.boards > 0 && (
                          <StatusPill
                            tone={
                              c.metrics.costPerBoardKobo <= benchmark.costPerBoardKobo
                                ? "positive"
                                : "warn"
                            }
                          >
                            {formatNaira(c.metrics.costPerBoardKobo)} a board
                          </StatusPill>
                        )}
                    </div>
                    <CycleFigures
                      cycle={c}
                      benchmarkCostKobo={benchmark?.costPerBoardKobo ?? null}
                      compact
                    />
                  </article>
                ))}
              </div>
            </section>
          )}
        </>
      )}

      <p className="mt-8 flex items-start gap-2 text-xs leading-relaxed text-cream-600">
        <Layers size={13} className="mt-0.5 shrink-0" />
        {tab === "gum"
          ? "Gum counts boards that went through the edge bander. A board that was only cut never reached it and used no gum, so those are left out — counting them would flatter every figure here."
          : "The blade counts every board that went through the saw, including the ones that were cut but not edged."}
      </p>
    </div>
  );
}

/** The derived figures for one cycle. */
function CycleFigures({
  cycle,
  benchmarkCostKobo,
  compact,
}: {
  cycle: CycleWithMetrics;
  benchmarkCostKobo: number | null;
  compact?: boolean;
}) {
  const m = cycle.metrics;
  const better =
    benchmarkCostKobo !== null && m.costPerBoardKobo !== null
      ? m.costPerBoardKobo <= benchmarkCostKobo
      : null;

  return (
    <>
      <dl className={`grid gap-4 ${compact ? "mt-4 sm:grid-cols-4" : "mt-5 sm:grid-cols-2 lg:grid-cols-5"}`}>
        <Figure
          label="Days"
          value={m.durationDays === null ? "—" : String(m.durationDays)}
          hint={cycle.endKey === null ? "so far" : undefined}
        />
        <Figure label="Boards" value={String(m.boards)} hint={`${m.logCount} work log(s)`} />
        <Figure
          label="Boards a day"
          value={m.boardsPerDay === null ? "—" : String(m.boardsPerDay)}
        />
        <Figure
          label="Cost a board"
          value={m.costPerBoardKobo === null ? "—" : formatNaira(m.costPerBoardKobo)}
          tone={better === null ? undefined : better ? "good" : "warn"}
        />
        {!compact && (
          <Figure
            label="Revenue on those jobs"
            value={formatNaira(m.revenueKobo)}
            hint="jobs worked in the window"
          />
        )}
      </dl>

      {/* By material. Two cycles are only comparable if you know what they were cutting —
          6,400-naira Bangaji is harder on a blade than quarter plywood. */}
      {m.byBoardType.length > 0 && (
        <div className="mt-4 border-t border-night-700/60 pt-3">
          <p className="text-[0.65rem] uppercase tracking-[0.2em] text-cream-600">By board type</p>
          <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1.5 text-xs">
            {m.byBoardType.map(({ boardType, boards }) => (
              <span key={boardType} className="text-cream-400">
                {boardTypeLabel(boardType)}{" "}
                <span className="text-cream-200">{boards}</span>
              </span>
            ))}
          </div>
        </div>
      )}

      {m.boards === 0 && (
        <p className="mt-3 flex items-start gap-2 text-xs text-cream-500">
          <Gauge size={13} className="mt-0.5 shrink-0" />
          No boards recorded in this window yet, so there is no cost per board. It fills in as work
          logs are entered.
        </p>
      )}
    </>
  );
}

function Figure({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: "good" | "warn";
}) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wider text-cream-600">{label}</dt>
      <dd
        className={`mt-1 font-display text-lg ${
          tone === "warn" ? "text-amber-300" : tone === "good" ? "text-emerald-300" : "text-cream-100"
        }`}
      >
        {value}
      </dd>
      {hint && <dd className="mt-0.5 text-xs text-cream-600">{hint}</dd>}
    </div>
  );
}

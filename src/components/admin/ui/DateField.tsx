"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { CalendarDays, Check, X } from "lucide-react";

/**
 * A date field with a roller picker.
 *
 * Every date in this system was a bare `<input type="date">`, which on a phone opens
 * whatever the browser feels like and on a desktop needs three separate clicks into a
 * tiny calendar grid. Both are slow, and dates here are typed constantly — a work log
 * every day, a meter reading, a follow-up, a wage run.
 *
 * So: three scrolling columns, day / month / year, the way a phone's own time picker
 * works. The thumb flicks a column and it snaps. It is one gesture per part instead of
 * a hunt through a grid, and it cannot produce an impossible date because the day
 * column is rebuilt from the chosen month and year.
 *
 * The native input is kept underneath as the actual form control — the keyboard still
 * works, the value is still `yyyy-mm-dd`, and anyone who prefers typing can. The roller
 * is an alternative way in, not a replacement.
 *
 * ## Why scroll position drives the value
 *
 * Each column is a scroll container with snap points. The selected item is whichever
 * one is centred, read from `scrollTop` rather than tracked separately, because two
 * sources of truth for "which row is centred" drift apart the moment a scroll is
 * interrupted. Committing happens on a settle timer rather than on every scroll event,
 * so a flick through sixty rows doesn't fire sixty updates.
 */

/** Height of one row, in pixels. Fixed, because the maths below depends on it. */
const ROW = 40;
/** Rows visible above and below the centred one. Three rows of context, seven total. */
const PAD = 3;

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/** Days in a month, leap years included. Month is 1-based. */
function daysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate();
}

/** `yyyy-mm-dd` → parts, or null if it isn't a real date. */
function parseIso(value: string): { y: number; m: number; d: number } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const y = Number(match[1]);
  const m = Number(match[2]);
  const d = Number(match[3]);
  if (m < 1 || m > 12) return null;
  if (d < 1 || d > daysInMonth(y, m)) return null;
  return { y, m, d };
}

function toIso(y: number, m: number, d: number): string {
  // Clamped so 31 January → February lands on the 28th or 29th rather than rolling
  // into March, which is what a naive Date would do.
  const day = Math.min(d, daysInMonth(y, m));
  return `${y}-${pad2(m)}-${pad2(day)}`;
}

/**
 * The written form of a date, for the closed field.
 *
 * Includes the weekday because so much of this system is paid by the day: a wage run,
 * a work log, a holiday. "Friday" answers a question that "2026-08-14" does not.
 */
export function describeIso(value: string): string {
  const parts = parseIso(value);
  if (!parts) return "";
  const date = new Date(parts.y, parts.m - 1, parts.d);
  return `${WEEKDAYS[date.getDay()]}, ${parts.d} ${MONTHS[parts.m - 1]} ${parts.y}`;
}

/** Today as `yyyy-mm-dd`, in local time rather than UTC. */
export function todayIso(): string {
  const now = new Date();
  return toIso(now.getFullYear(), now.getMonth() + 1, now.getDate());
}

/** One scrolling column. */
function Wheel({
  label,
  items,
  index,
  onIndex,
}: {
  label: string;
  /** Display text per row. Index is the value. */
  items: string[];
  index: number;
  onIndex: (index: number) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const settle = useRef<ReturnType<typeof setTimeout> | null>(null);
  /*
   * True while this wheel is being scrolled by the user.
   *
   * Without it, the effect that scrolls to `index` fights the finger: a scroll moves the
   * column, the parent's state updates, the effect scrolls it back to where it thinks it
   * should be, and the column judders.
   */
  const touching = useRef(false);

  // Position the wheel whenever the selection changes from outside.
  useEffect(() => {
    const el = ref.current;
    if (!el || touching.current) return;
    const target = index * ROW;
    if (Math.abs(el.scrollTop - target) > 1) {
      el.scrollTo({ top: target, behavior: "smooth" });
    }
  }, [index]);

  const onScroll = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    touching.current = true;
    if (settle.current) clearTimeout(settle.current);
    /*
     * Committed once the scrolling stops.
     *
     * 90ms is long enough that a flick reads as one gesture and short enough that the
     * value feels immediate. Reading the row from `scrollTop` means snap has already
     * done the rounding for us in the common case; the round handles the rest.
     */
    settle.current = setTimeout(() => {
      touching.current = false;
      const next = Math.round(el.scrollTop / ROW);
      const clamped = Math.max(0, Math.min(items.length - 1, next));
      if (clamped !== index) onIndex(clamped);
    }, 90);
  }, [index, items.length, onIndex]);

  useEffect(
    () => () => {
      if (settle.current) clearTimeout(settle.current);
    },
    []
  );

  return (
    <div className="flex-1">
      <p className="mb-1.5 text-center text-[0.65rem] uppercase tracking-[0.18em] text-cream-600">
        {label}
      </p>
      <div
        ref={ref}
        onScroll={onScroll}
        role="listbox"
        aria-label={label}
        tabIndex={0}
        onKeyDown={(e) => {
          // Arrow keys move the wheel, so this is usable without a pointer at all.
          if (e.key === "ArrowDown" || e.key === "ArrowUp") {
            e.preventDefault();
            const next = index + (e.key === "ArrowDown" ? 1 : -1);
            if (next >= 0 && next < items.length) onIndex(next);
          }
        }}
        className="h-[280px] snap-y snap-mandatory overflow-y-auto overscroll-contain outline-none [-ms-overflow-style:none] [scrollbar-width:none] focus-visible:ring-1 focus-visible:ring-brass-500/60 [&::-webkit-scrollbar]:hidden"
        style={{
          // Padding of exactly PAD rows top and bottom is what lets the first and last
          // item reach the centre line. Without it neither end is selectable.
          paddingTop: PAD * ROW,
          paddingBottom: PAD * ROW,
        }}
      >
        {items.map((text, i) => {
          const distance = Math.abs(i - index);
          return (
            <div
              key={text + i}
              role="option"
              aria-selected={i === index}
              onClick={() => onIndex(i)}
              style={{ height: ROW }}
              className={`flex cursor-pointer snap-center items-center justify-center text-sm tabular-nums transition-colors duration-150 ${
                distance === 0
                  ? "font-display text-lg text-brass-300"
                  : distance === 1
                    ? "text-cream-300"
                    : distance === 2
                      ? "text-cream-500"
                      : "text-cream-700"
              }`}
            >
              {text}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function DateField({
  id,
  label,
  value,
  onChange,
  required,
  disabled,
  hint,
  min,
  max,
  /**
   * Years offered either side of the current selection.
   *
   * Five back and two forward by default: this is a business system, so the dates being
   * entered are recent history or the near diary. A hundred-year range would be sixty
   * rows of scrolling to reach the year it almost always is.
   */
  yearsBack = 5,
  yearsForward = 2,
  /**
   * Smaller control, for a field sitting in a tight row.
   *
   * The roller sheet is unchanged — that is a modal and has the room. This only shrinks the
   * closed field, for the handful of places (a filter bar, the POS payment panel) where the
   * full-size input crowds its neighbours.
   */
  compact,
}: {
  id: string;
  label: string;
  /** `yyyy-mm-dd`, or empty. */
  value: string;
  onChange: (value: string) => void;
  required?: boolean;
  disabled?: boolean;
  hint?: string;
  min?: string;
  max?: string;
  yearsBack?: number;
  yearsForward?: number;
  compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  /*
   * What the roller is currently showing.
   *
   * Held separately from `value` so the wheels can move without every intermediate
   * position being committed to the form — spinning past March on the way to June must
   * not save March. `Set` on open, applied on confirm.
   */
  const initial = useMemo(() => parseIso(value) ?? parseIso(todayIso())!, [value]);
  const [draft, setDraft] = useState(initial);

  /*
   * Re-seeded each time it opens, so reopening after a cancel starts from the real value
   * rather than from wherever the wheels were left.
   *
   * Deliberately keyed on `open` alone. Including `value` would re-seed mid-gesture whenever the
   * parent's state changed while the sheet was up — the "Today" button writes `value`, and a
   * parent that normalises or clamps the date on every change would yank the wheels back under
   * the thumb. The value is read at the moment of opening, which is when it is wanted.
   */
  const valueRef = useRef(value);
  valueRef.current = value;
  useEffect(() => {
    if (open) setDraft(parseIso(valueRef.current) ?? parseIso(todayIso())!);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    // The sheet is modal, so the page behind it must not scroll under the thumb.
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = previous;
    };
  }, [open]);

  const years = useMemo(() => {
    const centre = initial.y;
    const list: number[] = [];
    // Widened to include the current draft and any min/max bound, so a date outside the
    // default window is still reachable rather than silently unselectable.
    let first = centre - yearsBack;
    let last = centre + yearsForward;
    const minY = min ? parseIso(min)?.y : undefined;
    const maxY = max ? parseIso(max)?.y : undefined;
    if (minY !== undefined) first = Math.min(first, minY);
    if (maxY !== undefined) last = Math.max(last, maxY);
    first = Math.min(first, draft.y);
    last = Math.max(last, draft.y);
    for (let y = first; y <= last; y += 1) list.push(y);
    return list;
  }, [initial.y, yearsBack, yearsForward, min, max, draft.y]);

  const dayCount = daysInMonth(draft.y, draft.m);
  const days = useMemo(
    () => Array.from({ length: dayCount }, (_, i) => String(i + 1)),
    [dayCount]
  );

  /*
   * Guard against an impossible day surviving a month change.
   *
   * Spinning from 31 March to February leaves the day wheel showing a row that no longer
   * exists. Clamped here rather than in the wheel, because the wheel does not know what
   * the other two columns say.
   */
  useEffect(() => {
    if (draft.d > dayCount) setDraft((d) => ({ ...d, d: dayCount }));
  }, [dayCount, draft.d]);

  /*
   * The chosen date, held inside any min/max the caller set.
   *
   * The native input enforces its own bounds; the roller has to do it here or the two disagree —
   * a work-log field capped at today would accept next Tuesday through the wheels and reject it
   * when typed. Clamping rather than refusing, because a wheel that will not commit gives the
   * user nothing to act on, and the clamped date is visibly wrong so it gets corrected.
   */
  function clampToBounds(iso: string): string {
    if (min && iso < min) return min;
    if (max && iso > max) return max;
    return iso;
  }

  function commit() {
    onChange(clampToBounds(toIso(draft.y, draft.m, draft.d)));
    setOpen(false);
  }

  const described = describeIso(value);

  const sheet = (
    <div className="fixed inset-0 z-[70] flex items-end justify-center sm:items-center">
      {/* Tapping away cancels: on a phone the sheet covers the screen and a stray tap
          should not silently change a date. */}
      <button
        type="button"
        aria-label="Close date picker"
        onClick={() => setOpen(false)}
        className="absolute inset-0 cursor-default bg-night-950/80 backdrop-blur-sm"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Choose ${label}`}
        className="relative w-full max-w-sm rounded-t-3xl border border-night-700/60 bg-night-900 p-5 shadow-2xl sm:rounded-3xl"
      >
        <div className="flex items-baseline justify-between gap-3">
          <p className="font-display text-lg text-cream-100">{label}</p>
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="cursor-pointer rounded-lg p-1.5 text-cream-500 transition-colors hover:text-cream-200"
            aria-label="Cancel"
          >
            <X size={18} />
          </button>
        </div>

        <p className="mt-1 text-sm text-brass-300">
          {describeIso(toIso(draft.y, draft.m, draft.d))}
        </p>

        <div className="relative mt-4">
          {/* The centre line. Purely decorative — the value is read from scroll position —
              but without it there is nothing telling the eye which row counts. */}
          <div
            aria-hidden
            className="pointer-events-none absolute inset-x-0 z-10 rounded-xl border-y border-brass-500/40 bg-brass-500/5"
            style={{ top: PAD * ROW + 22, height: ROW }}
          />
          {/* Fades top and bottom, so the wheels read as cylinders rather than lists. */}
          <div
            aria-hidden
            className="pointer-events-none absolute inset-x-0 top-6 z-10 h-16 bg-gradient-to-b from-night-900 to-transparent"
          />
          <div
            aria-hidden
            className="pointer-events-none absolute inset-x-0 bottom-0 z-10 h-16 bg-gradient-to-t from-night-900 to-transparent"
          />

          <div className="flex gap-2">
            <Wheel
              label="Day"
              items={days}
              index={draft.d - 1}
              onIndex={(i) => setDraft((d) => ({ ...d, d: i + 1 }))}
            />
            <Wheel
              label="Month"
              items={MONTHS.map((m) => m.slice(0, 3))}
              index={draft.m - 1}
              onIndex={(i) => setDraft((d) => ({ ...d, m: i + 1 }))}
            />
            <Wheel
              label="Year"
              items={years.map(String)}
              index={Math.max(0, years.indexOf(draft.y))}
              onIndex={(i) => setDraft((d) => ({ ...d, y: years[i] }))}
            />
          </div>
        </div>

        <div className="mt-5 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={commit}
            className="flex flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-xl bg-brass-500 px-4 py-3 text-sm font-medium text-night-950 transition-colors hover:bg-brass-400"
          >
            <Check size={16} /> Use this date
          </button>
          {/* Today, in one tap. By far the most common date in a daily-report system —
              and the reason the field exists is that typing it was slow. */}
          <button
            type="button"
            onClick={() => {
              // Clamped like any other choice: a field with a `min` in the future would
              // otherwise take today and then fail validation on submit.
              onChange(clampToBounds(todayIso()));
              setOpen(false);
            }}
            className="cursor-pointer rounded-xl border border-night-600 px-4 py-3 text-sm text-cream-300 transition-colors hover:border-brass-500/60 hover:text-cream-100"
          >
            Today
          </button>
        </div>
      </div>
    </div>
  );

  return (
    <div>
      <label htmlFor={id} className="mb-1.5 block text-sm text-cream-300">
        {label}
        {required && <span className="ml-1 text-brass-400">*</span>}
        {hint && <span className="ml-2 text-xs text-cream-500">{hint}</span>}
      </label>

      <div className="flex gap-2">
        {/*
         * The real control.
         *
         * Left as a native date input so typing, keyboard navigation, form validation and
         * `required` all behave exactly as they did before the roller existed. The roller
         * writes through the same `onChange`.
         */}
        <input
          id={id}
          type="date"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          required={required}
          disabled={disabled}
          min={min}
          max={max}
          className={`w-full min-w-0 flex-1 rounded-xl border border-night-600 bg-night-800/60 text-cream-100 focus:border-brass-500 focus:outline-none disabled:opacity-60 [&::-webkit-calendar-picker-indicator]:opacity-0 ${
            compact ? "px-3 py-2 text-sm" : "px-4 py-3"
          }`}
        />
        <button
          type="button"
          onClick={() => setOpen(true)}
          disabled={disabled}
          aria-label={`Open the date roller for ${label}`}
          className={`shrink-0 cursor-pointer rounded-xl border border-night-600 bg-night-800/60 text-brass-400 transition-colors hover:border-brass-500/60 hover:text-brass-300 disabled:opacity-60 ${
            compact ? "px-2.5" : "px-3.5"
          }`}
        >
          <CalendarDays size={compact ? 15 : 18} />
        </button>
      </div>

      {/* The written date, including the weekday. Cheap to render and it catches the
          transposed-digit mistake that a bare yyyy-mm-dd hides completely. Suppressed in
          compact mode, where the extra line is what made the field too tall for its row. */}
      {described && !compact && (
        <p className="mt-1.5 text-xs text-cream-500">{described}</p>
      )}

      {/* Portalled, so a sheet opened from inside a scrolling panel or a table cell is
          still positioned against the viewport rather than clipped by its parent. */}
      {open && mounted && createPortal(sheet, document.body)}
    </div>
  );
}

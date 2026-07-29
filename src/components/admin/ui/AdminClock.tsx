"use client";

import { useEffect, useState } from "react";

/**
 * Live clock for the admin header.
 *
 * Pinned to Africa/Lagos rather than the browser's zone: the business runs on
 * Lagos time, and a manager checking in from another timezone should see the
 * factory's clock, not their own. That also keeps it consistent with the
 * timestamps stored on jobs and wage runs.
 *
 * Rendered only after mount. The server has no clock for the user's locale, so
 * emitting a time during SSR would hydrate to a different string and React
 * would flag the mismatch.
 */
export function AdminClock() {
  const [now, setNow] = useState<Date | null>(null);

  useEffect(() => {
    setNow(new Date());
    // Align the first tick to the next whole second so the display does not
    // appear to skip or stall.
    const align = 1000 - (Date.now() % 1000);
    let interval: ReturnType<typeof setInterval>;
    const timeout = setTimeout(() => {
      setNow(new Date());
      interval = setInterval(() => setNow(new Date()), 1000);
    }, align);

    return () => {
      clearTimeout(timeout);
      if (interval) clearInterval(interval);
    };
  }, []);

  if (!now) {
    // Reserve the width so the header does not shift when the clock appears.
    return <div className="hidden h-9 w-[104px] sm:block" aria-hidden />;
  }

  const time = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Africa/Lagos",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(now);

  const day = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Africa/Lagos",
    weekday: "short",
    day: "numeric",
    month: "short",
  }).format(now);

  const [hh, mm, ss] = time.split(":");

  return (
    <div
      className="hidden items-center gap-2.5 rounded-xl border border-night-700/60 bg-night-900/70 px-3 py-1.5 sm:flex"
      title="Factory time (Africa/Lagos)"
    >
      <span className="relative flex h-1.5 w-1.5" aria-hidden>
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-brass-400 opacity-70" />
        <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-brass-400" />
      </span>
      <span className="leading-tight">
        <span className="block font-mono text-sm tabular-nums text-cream-100">
          {hh}
          <span className="text-brass-400">:</span>
          {mm}
          <span className="text-cream-500">:{ss}</span>
        </span>
        <span className="block text-[0.6rem] uppercase tracking-[0.16em] text-cream-500">
          {day}
        </span>
      </span>
    </div>
  );
}

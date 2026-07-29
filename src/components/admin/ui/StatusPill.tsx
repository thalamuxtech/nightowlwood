import type { ReactNode } from "react";

/**
 * Status chip used across the ERP.
 *
 * Tone carries meaning consistently: `positive` = settled/finished, `warn` =
 * needs attention, `danger` = money at risk or cancelled, `info` = in flight,
 * `neutral` = not started. Colour is never the only signal, the label always
 * states the status in words.
 */

export type PillTone = "neutral" | "info" | "progress" | "positive" | "warn" | "danger";

const TONES: Record<PillTone, string> = {
  neutral: "border-night-600 bg-night-800/70 text-cream-300",
  info: "border-sky-500/40 bg-sky-500/10 text-sky-300",
  progress: "border-brass-500/40 bg-brass-500/10 text-brass-300",
  positive: "border-emerald-500/40 bg-emerald-500/10 text-emerald-300",
  warn: "border-amber-500/40 bg-amber-500/10 text-amber-300",
  danger: "border-red-500/40 bg-red-500/10 text-red-300",
};

export function StatusPill({
  tone = "neutral",
  children,
  title,
}: {
  tone?: PillTone;
  children: ReactNode;
  title?: string;
}) {
  return (
    <span
      title={title}
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium ${TONES[tone]}`}
    >
      {children}
    </span>
  );
}

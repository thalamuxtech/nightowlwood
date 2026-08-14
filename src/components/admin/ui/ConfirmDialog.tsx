"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { AnimatePresence, motion } from "framer-motion";
import { AlertTriangle, ShieldAlert, Trash2 } from "lucide-react";
import { Button, TextAreaField, TextField } from "@/components/admin/ui/Fields";
import { DateField } from "@/components/admin/ui/DateField";

/**
 * In-app confirmation and input dialogs, replacing `window.confirm` and `window.prompt`.
 *
 * The native ones had to go for reasons beyond looks. They are unstyled and jarring against a
 * dark interface; several browsers let a user tick "prevent this page from creating more
 * dialogs", after which every subsequent confirm silently returns false and deletions appear to
 * do nothing at all; and `window.prompt` is blocked outright in some embedded webviews, which
 * would have left the wage-run and asset screens unable to collect the date they require.
 *
 * They also block the main thread, so a slow Firestore write behind one froze the whole page.
 *
 * ## How to use
 *
 * `useConfirm()` returns an `ask` function and the element to render. `ask` resolves to true or
 * false, so a call site reads almost exactly as the `window.confirm` it replaces:
 *
 * ```tsx
 * const { ask, dialog } = useConfirm();
 * // ...
 * if (!(await ask({ title: "Delete this?", tone: "danger" }))) return;
 * // ...
 * return <>{dialog}...</>;
 * ```
 */

export type ConfirmTone = "danger" | "warn" | "neutral";

export interface ConfirmOptions {
  title: string;
  /** The consequence, in a sentence. Shown under the title. */
  body?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: ConfirmTone;
  /**
   * Collects text alongside the confirmation, replacing `window.prompt`.
   *
   * `required` refuses an empty value rather than proceeding with one, which the native prompt
   * could not do — every caller had to re-check the result afterwards and several did not.
   */
  input?: {
    label: string;
    kind?: "text" | "textarea" | "date";
    placeholder?: string;
    initial?: string;
    required?: boolean;
    hint?: string;
  };
}

/** What a dialog resolves to: `null` when dismissed, otherwise the value (or "" with no input). */
export type ConfirmResult = string | null;

const TONE: Record<
  ConfirmTone,
  { ring: string; icon: typeof AlertTriangle; iconClass: string; button: "danger" | "primary" }
> = {
  danger: {
    ring: "border-red-500/40",
    icon: Trash2,
    iconClass: "text-red-400",
    button: "danger",
  },
  warn: {
    ring: "border-amber-500/40",
    icon: AlertTriangle,
    iconClass: "text-amber-400",
    button: "primary",
  },
  neutral: {
    ring: "border-brass-500/30",
    icon: ShieldAlert,
    iconClass: "text-brass-400",
    button: "primary",
  },
};

/**
 * Drives one dialog per screen.
 *
 * One instance is reused for every question a screen asks, rather than a component per delete
 * button: a screen with twenty rows would otherwise mount twenty dialogs, and the "which one is
 * open" state has to be single anyway.
 */
export function useConfirm() {
  const [options, setOptions] = useState<ConfirmOptions | null>(null);
  const resolver = useRef<((value: ConfirmResult) => void) | null>(null);

  const ask = useCallback((opts: ConfirmOptions): Promise<ConfirmResult> => {
    setOptions(opts);
    return new Promise<ConfirmResult>((resolve) => {
      resolver.current = resolve;
    });
  }, []);

  const settle = useCallback((value: ConfirmResult) => {
    resolver.current?.(value);
    resolver.current = null;
    setOptions(null);
  }, []);

  const dialog = (
    <ConfirmDialog options={options} onSettle={settle} />
  );

  return { ask, dialog };
}

/**
 * A boolean-only helper, for the many callers that just replaced `window.confirm`.
 *
 * Returns true when confirmed. Keeps those call sites from having to know that the general
 * form resolves to a string.
 */
export function useConfirmBoolean() {
  const { ask, dialog } = useConfirm();
  const confirm = useCallback(
    async (opts: ConfirmOptions) => (await ask(opts)) !== null,
    [ask]
  );
  return { confirm, dialog };
}

function ConfirmDialog({
  options,
  onSettle,
}: {
  options: ConfirmOptions | null;
  onSettle: (value: ConfirmResult) => void;
}) {
  const [value, setValue] = useState("");
  const [touched, setTouched] = useState(false);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLDivElement>(null);

  // Reset per opening, so yesterday's reason is not sitting in today's box.
  useEffect(() => {
    if (options) {
      setValue(options.input?.initial ?? "");
      setTouched(false);
    }
  }, [options]);

  /*
   * Focus moves into the dialog on open.
   *
   * The input when there is one, otherwise the confirm button — and never straight onto a
   * destructive action when the user has something to type first. A keyboard user who cannot
   * reach the dialog is stuck, since the page behind it is inert.
   */
  useEffect(() => {
    if (!options) return;
    const t = setTimeout(() => {
      const field = inputRef.current?.querySelector<HTMLElement>("input, textarea");
      (field ?? confirmRef.current)?.focus();
    }, 40);
    return () => clearTimeout(t);
  }, [options]);

  const missing = Boolean(options?.input?.required) && value.trim() === "";

  useEffect(() => {
    if (!options) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        onSettle(null);
      }
      // Enter confirms, but not from a textarea, where it means "new line".
      if (e.key === "Enter" && !e.shiftKey) {
        const el = e.target as HTMLElement | null;
        if (el?.tagName === "TEXTAREA") return;
        if (missing) return;
        e.preventDefault();
        onSettle(value);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [options, onSettle, value, missing]);

  const tone = TONE[options?.tone ?? "neutral"];
  const Icon = tone.icon;

  return (
    <AnimatePresence>
      {options && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18 }}
          role="dialog"
          aria-modal="true"
          aria-label={options.title}
          // Above the PDF modals, which sit at z-80: a confirmation raised from inside one has
          // to be reachable.
          className="fixed inset-0 z-[95] flex items-center justify-center overflow-y-auto bg-night-950/85 p-4 backdrop-blur-sm sm:p-8"
          onClick={(e) => {
            // Backdrop only. A click inside the panel must not dismiss it.
            if (e.target === e.currentTarget) onSettle(null);
          }}
        >
          <motion.div
            initial={{ opacity: 0, y: 12, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.99 }}
            transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
            className={`w-full max-w-md rounded-3xl border ${tone.ring} bg-night-900 p-6 shadow-2xl shadow-night-950/60`}
          >
            <div className="flex items-start gap-3.5">
              <span
                aria-hidden
                className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-night-950/60 ${tone.iconClass}`}
              >
                <Icon size={17} />
              </span>
              <div className="min-w-0 flex-1">
                <h2 className="font-display text-lg leading-snug text-cream-100">
                  {options.title}
                </h2>
                {options.body && (
                  <div className="mt-1.5 text-sm leading-relaxed text-cream-400">
                    {options.body}
                  </div>
                )}
              </div>
            </div>

            {options.input && (
              <div ref={inputRef} className="mt-5">
                {options.input.kind === "textarea" ? (
                  <TextAreaField
                    id="confirm-input"
                    label={options.input.label}
                    value={value}
                    onChange={(v) => {
                      setValue(v);
                      setTouched(true);
                    }}
                    rows={3}
                    placeholder={options.input.placeholder}
                  />
                ) : options.input.kind === "date" ? (
                  <DateField
                    id="confirm-input"
                    label={options.input.label}
                    value={value}
                    onChange={(v) => {
                      setValue(v);
                      setTouched(true);
                    }}
                    hint={options.input.hint}
                  />
                ) : (
                  <TextField
                    id="confirm-input"
                    label={options.input.label}
                    value={value}
                    onChange={(v) => {
                      setValue(v);
                      setTouched(true);
                    }}
                    placeholder={options.input.placeholder}
                  />
                )}
                {/* Only after they have typed and cleared it: a warning on an untouched box
                    tells somebody off for not having started yet. */}
                {missing && touched && (
                  <p className="mt-1.5 text-xs text-amber-300">
                    This is needed before you can continue.
                  </p>
                )}
              </div>
            )}

            <div className="mt-6 flex flex-wrap justify-end gap-3">
              <Button variant="ghost" onClick={() => onSettle(null)}>
                {options.cancelLabel ?? "Cancel"}
              </Button>
              <button
                ref={confirmRef}
                type="button"
                disabled={missing}
                onClick={() => onSettle(value)}
                className={`cursor-pointer rounded-full px-6 py-2.5 text-sm font-medium transition-all duration-300 disabled:cursor-not-allowed disabled:opacity-50 ${
                  tone.button === "danger"
                    ? "bg-red-500/90 text-cream-50 hover:bg-red-500"
                    : "bg-brass-500 text-night-950 hover:bg-brass-400"
                }`}
              >
                {options.confirmLabel ?? "Confirm"}
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

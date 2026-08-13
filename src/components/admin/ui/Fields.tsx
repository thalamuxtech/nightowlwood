"use client";

import type { ReactNode } from "react";

/**
 * Form primitives for the admin screens.
 *
 * Every control is label-linked by id, so clicking the label focuses the input
 * and screen readers announce the field. Styling matches the site's night/brass
 * palette rather than browser defaults.
 */

const BASE_INPUT =
  "w-full rounded-xl border border-night-600 bg-night-800/60 px-4 py-3 text-cream-100 placeholder:text-cream-600 focus:border-brass-500 focus:outline-none disabled:opacity-60";

function Label({
  htmlFor,
  children,
  required,
  hint,
}: {
  htmlFor: string;
  children: ReactNode;
  required?: boolean;
  hint?: string;
}) {
  return (
    <label htmlFor={htmlFor} className="mb-1.5 block text-sm text-cream-300">
      {children}
      {required && <span className="ml-1 text-brass-400">*</span>}
      {hint && <span className="ml-2 text-xs text-cream-500">{hint}</span>}
    </label>
  );
}

export function TextField({
  id,
  label,
  name,
  type = "text",
  value,
  onChange,
  placeholder,
  required,
  disabled,
  hint,
  autoFocus,
}: {
  id: string;
  label: string;
  name?: string;
  type?: string;
  value?: string;
  onChange?: (value: string) => void;
  placeholder?: string;
  required?: boolean;
  disabled?: boolean;
  hint?: string;
  autoFocus?: boolean;
}) {
  return (
    <div>
      <Label htmlFor={id} required={required} hint={hint}>
        {label}
      </Label>
      <input
        id={id}
        name={name ?? id}
        type={type}
        value={value}
        onChange={onChange ? (e) => onChange(e.target.value) : undefined}
        placeholder={placeholder}
        required={required}
        disabled={disabled}
        autoFocus={autoFocus}
        className={BASE_INPUT}
      />
    </div>
  );
}

/**
 * Numeric field.
 *
 * Kept as a string in state so a half-typed value like "1." or an empty box
 * doesn't get coerced to 0 mid-edit, which makes the input fight the user.
 */
export function NumberField({
  id,
  label,
  value,
  onChange,
  min = 0,
  step = "any",
  placeholder,
  required,
  disabled,
  hint,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  min?: number;
  step?: number | "any";
  placeholder?: string;
  required?: boolean;
  disabled?: boolean;
  hint?: string;
}) {
  return (
    <div>
      <Label htmlFor={id} required={required} hint={hint}>
        {label}
      </Label>
      <input
        id={id}
        type="number"
        inputMode="decimal"
        min={min}
        step={step}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        required={required}
        disabled={disabled}
        className={BASE_INPUT}
      />
    </div>
  );
}

/** Money field that displays naira while the caller stores kobo. */
export function NairaField({
  id,
  label,
  valueKobo,
  onChangeKobo,
  required,
  disabled,
  hint,
}: {
  id: string;
  label: string;
  valueKobo: string;
  onChangeKobo: (naira: string) => void;
  required?: boolean;
  disabled?: boolean;
  hint?: string;
}) {
  return (
    <div>
      <Label htmlFor={id} required={required} hint={hint}>
        {label}
      </Label>
      <div className="relative">
        <span
          aria-hidden
          className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-cream-500"
        >
          ₦
        </span>
        <input
          id={id}
          type="number"
          inputMode="decimal"
          min={0}
          step="any"
          value={valueKobo}
          onChange={(e) => onChangeKobo(e.target.value)}
          required={required}
          disabled={disabled}
          className={`${BASE_INPUT} pl-9`}
        />
      </div>
    </div>
  );
}

export function SelectField<T extends string>({
  id,
  label,
  value,
  onChange,
  options,
  required,
  disabled,
  hint,
  placeholder,
}: {
  id: string;
  label: string;
  value: T | "";
  onChange: (value: T) => void;
  options: Array<{ value: T; label: string }>;
  required?: boolean;
  disabled?: boolean;
  hint?: string;
  placeholder?: string;
}) {
  return (
    <div>
      <Label htmlFor={id} required={required} hint={hint}>
        {label}
      </Label>
      <select
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value as T)}
        required={required}
        disabled={disabled}
        className={`${BASE_INPUT} cursor-pointer`}
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

export function TextAreaField({
  id,
  label,
  value,
  onChange,
  rows = 3,
  placeholder,
  disabled,
  hint,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  rows?: number;
  placeholder?: string;
  disabled?: boolean;
  hint?: string;
}) {
  return (
    <div>
      <Label htmlFor={id} hint={hint}>
        {label}
      </Label>
      <textarea
        id={id}
        rows={rows}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        disabled={disabled}
        className={`${BASE_INPUT} resize-y`}
      />
    </div>
  );
}

export function CheckboxField({
  id,
  label,
  checked,
  onChange,
  disabled,
}: {
  id: string;
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <label
      htmlFor={id}
      className="flex cursor-pointer items-center gap-3 text-sm text-cream-300"
    >
      <input
        id={id}
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        disabled={disabled}
        className="h-4 w-4 cursor-pointer accent-brass-500"
      />
      {label}
    </label>
  );
}

/** Primary/secondary/danger button with a busy state. */
export function Button({
  children,
  onClick,
  type = "button",
  variant = "primary",
  busy,
  disabled,
  title,
}: {
  children: ReactNode;
  onClick?: () => void;
  type?: "button" | "submit";
  variant?: "primary" | "secondary" | "danger" | "ghost";
  busy?: boolean;
  disabled?: boolean;
  title?: string;
}) {
  const styles: Record<string, string> = {
    primary: "bg-brass-500 text-night-950 hover:bg-brass-400",
    secondary:
      "border border-night-600 bg-night-800/60 text-cream-200 hover:border-brass-500/60 hover:text-brass-300",
    danger: "border border-red-500/40 bg-red-500/10 text-red-300 hover:bg-red-500/20",
    ghost: "text-cream-300 hover:bg-night-800 hover:text-cream-100",
  };
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled || busy}
      title={title}
      className={`cursor-pointer rounded-xl px-5 py-2.5 text-sm font-medium transition-all duration-300 disabled:cursor-not-allowed disabled:opacity-60 ${styles[variant]}`}
    >
      {busy ? "Working…" : children}
    </button>
  );
}

/** Empty-state panel for lists with no rows yet. */
export function EmptyState({
  title,
  hint,
  action,
}: {
  title: string;
  hint?: string;
  action?: ReactNode;
}) {
  return (
    <div className="rounded-3xl border border-night-700/60 bg-night-900/40 p-10 text-center">
      <p className="font-display text-lg text-cream-200">{title}</p>
      {hint && <p className="mx-auto mt-2 max-w-md text-sm text-cream-500">{hint}</p>}
      {action && <div className="mt-5 flex justify-center">{action}</div>}
    </div>
  );
}

/*
 * Re-exported so the date control arrives with the rest of the form kit.
 *
 * It lives in its own file because it is an order of magnitude bigger than everything
 * here — a roller picker with three scroll wheels — and mixing it in would bury the
 * primitives. Callers should not have to know that.
 */
export { DateField, describeIso, todayIso, validDateKey } from "@/components/admin/ui/DateField";

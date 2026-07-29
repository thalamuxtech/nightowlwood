"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { addDoc, collection, onSnapshot, orderBy, query, serverTimestamp } from "firebase/firestore";
import { Plus, Search, UserRound } from "lucide-react";
import { getDb } from "@/lib/firebase";
import { COL } from "@/lib/erp/collections";
import { Button, CheckboxField, TextField } from "@/components/admin/ui/Fields";

export interface PickedStaff {
  id: string;
  name: string;
  phone?: string;
}

/**
 * Search-or-create staff selector.
 *
 * Intake is a counter task, so a missing staff record must not stop the job
 * being logged. Rather than showing an empty dropdown when nothing exists, this
 * lets whoever is on the desk add the person on the spot.
 */
export function StaffPicker({
  value,
  onChange,
  createdBy,
  label = "Received by",
  required,
}: {
  value: PickedStaff | null;
  onChange: (staff: PickedStaff | null) => void;
  createdBy: string;
  label?: string;
  required?: boolean;
}) {
  const [staff, setStaff] = useState<PickedStaff[]>([]);
  const [term, setTerm] = useState("");
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newPhone, setNewPhone] = useState("");
  const [newJobTitle, setNewJobTitle] = useState("");
  const [isOperator, setIsOperator] = useState(true);
  const [isAssistant, setIsAssistant] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const q = query(collection(getDb(), COL.staff), orderBy("name", "asc"));
    return onSnapshot(
      q,
      (snap) =>
        setStaff(
          snap.docs
            .filter((d) => d.data().active !== false)
            .map((d) => ({
              id: d.id,
              name: (d.data().name as string) ?? "",
              phone: d.data().phone as string | undefined,
            }))
        ),
      () => setError("Could not load staff.")
    );
  }, []);

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  const matches = useMemo(() => {
    const t = term.trim().toLowerCase();
    if (!t) return staff.slice(0, 8);
    return staff.filter((s) => s.name.toLowerCase().includes(t)).slice(0, 8);
  }, [staff, term]);

  const exactExists = useMemo(
    () => staff.some((s) => s.name.trim().toLowerCase() === term.trim().toLowerCase()),
    [staff, term]
  );

  async function createStaff() {
    const name = term.trim();
    if (!name) {
      setError("Enter a name first.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const ref = await addDoc(collection(getDb(), COL.staff), {
        name,
        phone: newPhone.trim() || null,
        jobTitle: newJobTitle.trim() || null,
        isOperator,
        isAssistant,
        active: true,
        createdAt: serverTimestamp(),
        createdBy,
      });
      onChange({ id: ref.id, name, phone: newPhone.trim() || undefined });
      setCreating(false);
      setNewPhone("");
      setNewJobTitle("");
      setOpen(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not add the staff member.");
    } finally {
      setBusy(false);
    }
  }

  if (value) {
    return (
      <div>
        <p className="mb-1.5 block text-sm text-cream-300">
          {label}
          {required && <span className="ml-1 text-brass-400">*</span>}
        </p>
        <div className="flex items-center justify-between gap-3 rounded-xl border border-brass-500/40 bg-brass-500/5 px-4 py-3">
          <span className="flex min-w-0 items-center gap-2.5">
            <UserRound size={17} className="shrink-0 text-brass-400" />
            <span className="min-w-0">
              <span className="block truncate text-cream-100">{value.name}</span>
              {value.phone && (
                <span className="block text-xs text-cream-500">{value.phone}</span>
              )}
            </span>
          </span>
          <button
            type="button"
            onClick={() => {
              onChange(null);
              setTerm("");
            }}
            className="shrink-0 cursor-pointer text-xs text-cream-400 underline transition-colors hover:text-brass-300"
          >
            Change
          </button>
        </div>
      </div>
    );
  }

  const inputId = `staff-search-${label.replace(/\W+/g, "-").toLowerCase()}`;

  return (
    <div ref={boxRef} className="relative">
      <label htmlFor={inputId} className="mb-1.5 block text-sm text-cream-300">
        {label}
        {required && <span className="ml-1 text-brass-400">*</span>}
        <span className="ml-2 text-xs text-cream-500">search or add</span>
      </label>
      <div className="relative">
        <Search
          size={16}
          aria-hidden
          className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-cream-500"
        />
        <input
          id={inputId}
          type="text"
          value={term}
          onChange={(e) => {
            setTerm(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          placeholder={staff.length ? "Type a name" : "No staff yet, type a name to add"}
          autoComplete="off"
          className="w-full rounded-xl border border-night-600 bg-night-800/60 py-3 pl-11 pr-4 text-cream-100 placeholder:text-cream-600 focus:border-brass-500 focus:outline-none"
        />
      </div>

      {error && (
        <p role="alert" className="mt-2 text-xs text-red-400">
          {error}
        </p>
      )}

      {open && (
        <div className="absolute z-30 mt-2 w-full overflow-hidden rounded-xl border border-night-600 bg-night-900 shadow-card">
          {matches.length > 0 && (
            <ul className="max-h-56 overflow-y-auto">
              {matches.map((s) => (
                <li key={s.id}>
                  <button
                    type="button"
                    onClick={() => {
                      onChange(s);
                      setOpen(false);
                    }}
                    className="flex w-full cursor-pointer flex-col items-start px-4 py-3 text-left text-sm transition-colors hover:bg-night-800"
                  >
                    <span className="truncate text-cream-100">{s.name}</span>
                    {s.phone && <span className="text-xs text-cream-500">{s.phone}</span>}
                  </button>
                </li>
              ))}
            </ul>
          )}

          {term.trim() && !exactExists && (
            <div className="border-t border-night-700/60 p-3">
              {creating ? (
                <div className="space-y-3">
                  <p className="text-xs text-cream-400">
                    New staff: <span className="text-cream-100">{term.trim()}</span>
                  </p>
                  <TextField
                    id="new-staff-phone"
                    label="Phone (optional)"
                    value={newPhone}
                    onChange={setNewPhone}
                    placeholder="080…"
                  />
                  <TextField
                    id="new-staff-title"
                    label="Job title (optional)"
                    value={newJobTitle}
                    onChange={setNewJobTitle}
                    placeholder="Machine operator"
                  />
                  <div className="flex flex-wrap gap-4">
                    <CheckboxField
                      id="new-staff-operator"
                      label="Operator"
                      checked={isOperator}
                      onChange={setIsOperator}
                    />
                    <CheckboxField
                      id="new-staff-assistant"
                      label="Assistant"
                      checked={isAssistant}
                      onChange={setIsAssistant}
                    />
                  </div>
                  <p className="text-xs text-cream-600">
                    These decide whose work counts toward operator or assistant wages.
                  </p>
                  <div className="flex gap-2">
                    <Button onClick={createStaff} busy={busy}>
                      Add &amp; select
                    </Button>
                    <Button variant="ghost" onClick={() => setCreating(false)}>
                      Cancel
                    </Button>
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setCreating(true)}
                  className="flex w-full cursor-pointer items-center gap-2 rounded-lg px-2 py-2 text-left text-sm text-brass-300 transition-colors hover:bg-night-800"
                >
                  <Plus size={15} />
                  Add &ldquo;{term.trim()}&rdquo; as staff
                </button>
              )}
            </div>
          )}

          {matches.length === 0 && !term.trim() && (
            <p className="px-4 py-6 text-center text-sm text-cream-500">
              No staff records yet. Type a name to add the first one.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

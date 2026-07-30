"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { addDoc, collection, onSnapshot, orderBy, query, serverTimestamp } from "firebase/firestore";
import { Check, Plus, Search, UserRound } from "lucide-react";
import { getDb } from "@/lib/firebase";
import { COL } from "@/lib/erp/collections";
import { Button, TextField } from "@/components/admin/ui/Fields";

export interface PickedCustomer {
  id: string;
  name: string;
  phone?: string;
  /** Carried onto invoices so they can be emailed. Optional: walk-in trade often
   *  has no address, and requiring one would block intake at the counter. */
  email?: string;
}

interface CustomerOption extends PickedCustomer {
  altPhone?: string;
}

/**
 * Search-or-create customer selector.
 *
 * Intake happens at a counter with a customer waiting, so the flow has to work
 * without leaving the form: type a name, pick a match, or create the record
 * inline. The legacy sheet let staff type a name freehand every time, which is
 * why the history contains 326 "customers" including date strings, this widget
 * exists to force a real reference.
 */
export function CustomerPicker({
  value,
  onChange,
  createdBy,
}: {
  value: PickedCustomer | null;
  onChange: (customer: PickedCustomer | null) => void;
  createdBy: string;
}) {
  const [customers, setCustomers] = useState<CustomerOption[]>([]);
  const [term, setTerm] = useState("");
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newPhone, setNewPhone] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const q = query(collection(getDb(), COL.customers), orderBy("name", "asc"));
    return onSnapshot(
      q,
      (snap) =>
        setCustomers(
          snap.docs.map((d) => ({
            id: d.id,
            name: (d.data().name as string) ?? "",
            phone: d.data().phone as string | undefined,
            email: d.data().email as string | undefined,
            altPhone: d.data().altPhone as string | undefined,
          }))
        ),
      () => setError("Could not load customers.")
    );
  }, []);

  // Close the dropdown when focus or a click leaves the widget.
  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  const matches = useMemo(() => {
    const t = term.trim().toLowerCase();
    if (!t) return customers.slice(0, 8);
    return customers
      .filter(
        (c) =>
          c.name.toLowerCase().includes(t) ||
          (c.phone ?? "").includes(t) ||
          (c.altPhone ?? "").includes(t)
      )
      .slice(0, 8);
  }, [customers, term]);

  /** True when the typed name doesn't already exist, so "create" is offered. */
  const exactExists = useMemo(
    () => customers.some((c) => c.name.trim().toLowerCase() === term.trim().toLowerCase()),
    [customers, term]
  );

  async function createCustomer() {
    const name = term.trim();
    if (!name) {
      setError("Enter a customer name first.");
      return;
    }
    const email = newEmail.trim();
    // Checked here rather than on send: a typo caught at the counter costs a
    // moment, whereas one found later means an invoice that silently never
    // arrived and a customer wondering why they were chased for it.
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setError("That email address does not look right.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const ref = await addDoc(collection(getDb(), COL.customers), {
        name,
        phone: newPhone.trim() || null,
        email: email || null,
        isServiceCustomer: true,
        isProductClient: false,
        createdAt: serverTimestamp(),
        createdBy,
      });
      onChange({
        id: ref.id,
        name,
        phone: newPhone.trim() || undefined,
        email: email || undefined,
      });
      setCreating(false);
      setNewPhone("");
      setNewEmail("");
      setOpen(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not create the customer.");
    } finally {
      setBusy(false);
    }
  }

  if (value) {
    return (
      <div>
        <p className="mb-1.5 block text-sm text-cream-300">
          Customer <span className="ml-1 text-brass-400">*</span>
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

  return (
    <div ref={boxRef} className="relative">
      <label htmlFor="customer-search" className="mb-1.5 block text-sm text-cream-300">
        Customer <span className="ml-1 text-brass-400">*</span>
        <span className="ml-2 text-xs text-cream-500">search or create</span>
      </label>
      <div className="relative">
        <Search
          size={16}
          aria-hidden
          className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-cream-500"
        />
        <input
          id="customer-search"
          type="text"
          value={term}
          onChange={(e) => {
            setTerm(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          placeholder="Type a name or phone number"
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
            <ul className="max-h-64 overflow-y-auto">
              {matches.map((c) => (
                <li key={c.id}>
                  <button
                    type="button"
                    onClick={() => {
                      onChange({ id: c.id, name: c.name, phone: c.phone, email: c.email });
                      setOpen(false);
                    }}
                    className="flex w-full cursor-pointer items-center justify-between gap-3 px-4 py-3 text-left text-sm transition-colors hover:bg-night-800"
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-cream-100">{c.name}</span>
                      {c.phone && <span className="block text-xs text-cream-500">{c.phone}</span>}
                    </span>
                    <Check size={15} className="shrink-0 text-brass-400 opacity-0" />
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
                    New customer: <span className="text-cream-100">{term.trim()}</span>
                  </p>
                  <TextField
                    id="new-customer-phone"
                    label="Phone (optional)"
                    value={newPhone}
                    onChange={setNewPhone}
                    placeholder="080…"
                  />
                  <TextField
                    id="new-customer-email"
                    label="Email (optional)"
                    value={newEmail}
                    onChange={setNewEmail}
                    placeholder="name@example.com"
                    hint="Needed to email invoices and receipts"
                  />
                  <div className="flex gap-2">
                    <Button onClick={createCustomer} busy={busy}>
                      Create &amp; select
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
                  Create &ldquo;{term.trim()}&rdquo;
                </button>
              )}
            </div>
          )}

          {matches.length === 0 && !term.trim() && (
            <p className="px-4 py-6 text-center text-sm text-cream-500">
              No customers yet, type a name to create the first one.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

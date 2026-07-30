"use client";

import { useEffect, useMemo, useState } from "react";
import {
  addDoc,
  collection,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
} from "firebase/firestore";
import {
  Contact,
  HardHat,
  Loader2,
  PenLine,
  Plus,
  RotateCcw,
  Search,
  ShieldAlert,
  Truck,
  Users,
  type LucideIcon,
} from "lucide-react";
import { getDb } from "@/lib/firebase";
import { COL } from "@/lib/erp/collections";
import {
  createCustomer,
  createStaff,
  setCustomerActive,
  setStaffActive,
  updateCustomer,
  updateStaff,
} from "@/lib/erp/people";
import { updateSupplier } from "@/lib/erp/inventory";
import { StatusPill } from "@/components/admin/ui/StatusPill";
import {
  Button,
  CheckboxField,
  EmptyState,
  TextField,
} from "@/components/admin/ui/Fields";
import { useErpSession } from "@/components/admin/ErpAuthProvider";

/**
 * The directory: customers, staff and suppliers in one place.
 *
 * All three were create-only, raised inline from a picker while doing something
 * else, with no way back to a record afterwards. A misspelled customer name then
 * followed every job and invoice raised for them. This screen is the edit path
 * those three collections never had.
 *
 * Nothing here deletes. A customer with jobs behind them and a member of staff
 * named in past wage runs cannot be removed without orphaning those records, so
 * each type carries an `active` flag instead: inactive entries drop out of the
 * pickers, stay readable here, and can be brought back.
 */

/** One listener cap for all three tabs; well past the real record counts. */
const MAX_ROWS = 300;

type Tab = "customers" | "staff" | "suppliers";

interface CustomerRow {
  id: string;
  name: string;
  phone: string;
  email: string;
  address: string;
  active: boolean;
}

interface StaffRow {
  id: string;
  name: string;
  phone: string;
  jobTitle: string;
  isOperator: boolean;
  isAssistant: boolean;
  active: boolean;
}

interface SupplierRow {
  id: string;
  name: string;
  phone: string;
  active: boolean;
}

interface Actor {
  uid: string;
  email: string;
  role: "admin" | "manager" | "operator";
}

const TABS: Array<{ key: Tab; label: string; icon: LucideIcon }> = [
  { key: "customers", label: "Customers", icon: Contact },
  { key: "staff", label: "Staff", icon: HardHat },
  { key: "suppliers", label: "Suppliers", icon: Truck },
];

export function DirectoryScreen() {
  const session = useErpSession();
  const [tab, setTab] = useState<Tab>("customers");
  const [error, setError] = useState("");

  const actor = useMemo<Actor>(
    () => ({
      uid: session.user?.uid ?? "",
      email: session.user?.email ?? "",
      role: session.role ?? "manager",
    }),
    [session.user, session.role]
  );

  return (
    <div className="mx-auto max-w-6xl pb-20">
      <header>
        <p className="text-eyebrow">Directory</p>
        <h1 className="text-title mt-3 text-cream-50">People and suppliers</h1>
        <p className="mt-3 max-w-2xl text-sm leading-relaxed text-cream-400">
          The records everything else points at. Correcting one here fixes it from
          now on; jobs, invoices and payslips keep the details they were raised
          with, since a document already handed over should not change afterwards.
        </p>
      </header>

      {error && (
        <p
          role="alert"
          className="mt-6 flex items-start gap-2 rounded-xl border border-red-500/30 bg-red-500/5 px-4 py-3 text-sm text-red-400"
        >
          <ShieldAlert size={16} className="mt-0.5 shrink-0" /> {error}
        </p>
      )}

      {/* A local strip rather than GroupTabs: that component navigates between
          routes via pathname, and these three lists are one route. */}
      <nav
        aria-label="Directory sections"
        className="mt-8 flex gap-1 overflow-x-auto border-b border-night-700/60 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {TABS.map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            type="button"
            onClick={() => {
              setTab(key);
              // Errors belong to the list that raised them, so switching away
              // must not leave a stale warning above a different table.
              setError("");
            }}
            aria-current={tab === key ? "page" : undefined}
            className={`relative flex shrink-0 cursor-pointer items-center gap-2 whitespace-nowrap px-4 py-2.5 text-sm font-medium transition-colors duration-200 ${
              tab === key ? "text-brass-300" : "text-cream-400 hover:text-cream-100"
            }`}
          >
            <Icon size={15} className="shrink-0" />
            {label}
            {tab === key && (
              <span
                aria-hidden
                className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-brass-500"
              />
            )}
          </button>
        ))}
      </nav>

      {tab === "customers" && <CustomerList actor={actor} onError={setError} />}
      {tab === "staff" && <StaffList actor={actor} onError={setError} />}
      {tab === "suppliers" && <SupplierList actor={actor} onError={setError} />}
    </div>
  );
}

/**
 * Shared scaffolding for the three lists.
 *
 * Each tab is the same shape: search, an add button, the active records, then the
 * inactive ones dimmed below. Only the fields and the save calls differ, so the
 * arrangement lives here once and each list supplies its rows and its form.
 */
function ListShell<T extends { id: string; name: string; active: boolean }>({
  rows,
  loading,
  noun,
  plural,
  hint,
  canEdit,
  inactiveHeading,
  adding,
  onAddingChange,
  form,
  row,
}: {
  rows: T[];
  loading: boolean;
  noun: string;
  plural: string;
  hint: string;
  canEdit: boolean;
  inactiveHeading: string;
  adding: boolean;
  onAddingChange: (v: boolean) => void;
  /** `undefined` when adding, so one form serves both paths. */
  form: (editing: T | undefined, close: () => void) => React.ReactNode;
  row: (record: T) => React.ReactNode;
}) {
  const [search, setSearch] = useState("");

  const matches = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return rows;
    return rows.filter((r) => r.name.toLowerCase().includes(needle));
  }, [rows, search]);

  const active = useMemo(() => matches.filter((r) => r.active), [matches]);
  const inactive = useMemo(() => matches.filter((r) => !r.active), [matches]);

  return (
    <>
      <div className="mt-6 flex flex-wrap items-end justify-between gap-4">
        <div className="relative w-full max-w-xs">
          <Search
            size={15}
            aria-hidden
            className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-cream-600"
          />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label={`Search ${plural} by name`}
            placeholder={`Search ${plural}`}
            className="w-full rounded-xl border border-night-600 bg-night-800/60 py-3 pl-11 pr-4 text-sm text-cream-100 placeholder:text-cream-600 focus:border-brass-500 focus:outline-none"
          />
        </div>
        {canEdit && !adding && (
          <Button onClick={() => onAddingChange(true)}>
            <span className="flex items-center gap-2">
              <Plus size={15} /> Add {noun}
            </span>
          </Button>
        )}
      </div>

      {adding && form(undefined, () => onAddingChange(false))}

      {loading ? (
        <div className="mt-10 flex justify-center py-10">
          <Loader2 className="animate-spin text-brass-400" size={26} aria-label="Loading" />
        </div>
      ) : active.length === 0 ? (
        <div className="mt-8">
          <EmptyState
            title={
              rows.length === 0
                ? `No ${plural} recorded`
                : `No ${plural} match that name`
            }
            hint={rows.length === 0 ? hint : "Clear the search to see the full list."}
          />
        </div>
      ) : (
        <div className="mt-6 space-y-3">{active.map(row)}</div>
      )}

      {/* Inactive records stay visible but out of the way: their history still
          explains past jobs and payments, and restoring one must be possible. */}
      {inactive.length > 0 && (
        <section className="mt-10">
          <h2 className="text-xs uppercase tracking-wider text-cream-500">
            {inactiveHeading} ({inactive.length})
          </h2>
          <div className="mt-3 space-y-3 opacity-60">{inactive.map(row)}</div>
        </section>
      )}
    </>
  );
}

/**
 * One record, collapsed to a summary until opened.
 *
 * The edit form lives inside the expansion rather than in a dialog, so the row it
 * belongs to stays on screen while the fields are being corrected.
 */
function RecordPanel({
  icon: Icon,
  name,
  secondary,
  active,
  inactiveLabel,
  open,
  onToggle,
  canEdit,
  editing,
  onEditingChange,
  onToggleActive,
  toggleLabel,
  details,
  form,
}: {
  icon: LucideIcon;
  name: string;
  secondary: string;
  active: boolean;
  inactiveLabel: string;
  open: boolean;
  onToggle: () => void;
  canEdit: boolean;
  editing: boolean;
  onEditingChange: (v: boolean) => void;
  onToggleActive: () => void;
  toggleLabel: string;
  details: React.ReactNode;
  form: React.ReactNode;
}) {
  return (
    <div className="overflow-hidden rounded-2xl border border-night-700/60 bg-night-900/40">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="flex w-full cursor-pointer items-center justify-between gap-4 p-5 text-left"
      >
        <span className="flex min-w-0 items-center gap-3">
          <Icon size={17} className="shrink-0 text-cream-500" />
          <span className="min-w-0">
            <span className="block truncate text-cream-100">{name}</span>
            <span className="block truncate text-xs text-cream-500">
              {secondary || "No contact details"}
            </span>
          </span>
        </span>
        {!active && (
          <span className="shrink-0">
            <StatusPill tone="neutral">{inactiveLabel}</StatusPill>
          </span>
        )}
      </button>

      {open && (
        <div className="border-t border-night-700/60 p-5">
          <dl className="grid gap-4 text-sm sm:grid-cols-3">{details}</dl>

          {canEdit && (
            <div className="mt-5 flex flex-wrap gap-5">
              {!editing && (
                <button
                  type="button"
                  onClick={() => onEditingChange(true)}
                  className="flex cursor-pointer items-center gap-2 text-sm text-brass-300 transition-colors hover:text-brass-200"
                >
                  <PenLine size={15} /> Edit details
                </button>
              )}
              <button
                type="button"
                onClick={onToggleActive}
                className={`flex cursor-pointer items-center gap-2 text-sm transition-colors ${
                  active
                    ? "text-cream-500 hover:text-amber-300"
                    : "text-cream-500 hover:text-brass-300"
                }`}
              >
                <RotateCcw size={14} /> {toggleLabel}
              </button>
            </div>
          )}

          {canEdit && editing && form}
        </div>
      )}
    </div>
  );
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function CustomerList({
  actor,
  onError,
}: {
  actor: Actor;
  onError: (m: string) => void;
}) {
  const session = useErpSession();
  const canEdit = session.can("customer.edit");

  const [rows, setRows] = useState<CustomerRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);

  // Archived customers are read too rather than filtered at the query: an
  // archive has to be reversible, and a record the query never returns could
  // not be restored from this screen.
  useEffect(() => {
    return onSnapshot(
      query(collection(getDb(), COL.customers), orderBy("name", "asc"), limit(MAX_ROWS)),
      (snap) => {
        setRows(
          snap.docs.map((d) => {
            const x = d.data();
            return {
              id: d.id,
              name: x.name ?? "",
              phone: x.phone ?? "",
              email: x.email ?? "",
              address: x.address ?? "",
              active: x.active !== false,
            };
          })
        );
        setLoading(false);
      },
      (e) => {
        onError(e.message);
        setLoading(false);
      }
    );
  }, [onError]);

  return (
    <ListShell
      rows={rows}
      loading={loading}
      noun="customer"
      plural="customers"
      hint="Add the people and businesses whose work you take in."
      canEdit={canEdit}
      inactiveHeading="Archived"
      adding={adding}
      onAddingChange={setAdding}
      form={(editing, close) => (
        <CustomerForm actor={actor} editing={editing} onClose={close} onError={onError} />
      )}
      row={(r) => (
        <RecordPanel
          key={r.id}
          icon={Users}
          name={r.name}
          secondary={[r.phone, r.email].filter(Boolean).join(" · ")}
          active={r.active}
          inactiveLabel="Archived"
          open={openId === r.id}
          onToggle={() => {
            setOpenId(openId === r.id ? null : r.id);
            setEditingId(null);
          }}
          canEdit={canEdit}
          editing={editingId === r.id}
          onEditingChange={(v) => setEditingId(v ? r.id : null)}
          onToggleActive={() =>
            setCustomerActive(getDb(), actor, r.id, !r.active, r.name).catch((e) =>
              onError(
                e instanceof Error
                  ? e.message
                  : r.active
                    ? "Could not archive the customer."
                    : "Could not restore the customer."
              )
            )
          }
          toggleLabel={r.active ? "Archive customer" : "Restore customer"}
          details={
            <>
              <Detail label="Phone" value={r.phone || "Not recorded"} />
              <Detail label="Email" value={r.email || "Not recorded"} />
              <Detail label="Address" value={r.address || "Not recorded"} />
            </>
          }
          form={
            <CustomerForm
              actor={actor}
              editing={r}
              onClose={() => setEditingId(null)}
              onError={onError}
            />
          }
        />
      )}
    />
  );
}

/** The one customer form, used to add and to correct. */
function CustomerForm({
  actor,
  editing,
  onClose,
  onError,
}: {
  actor: Actor;
  editing?: CustomerRow;
  onClose: () => void;
  onError: (m: string) => void;
}) {
  const [name, setName] = useState(editing?.name ?? "");
  const [phone, setPhone] = useState(editing?.phone ?? "");
  const [email, setEmail] = useState(editing?.email ?? "");
  const [address, setAddress] = useState(editing?.address ?? "");
  const [busy, setBusy] = useState(false);

  // Field ids are suffixed per record, since a row's form can be open while the
  // add form is showing and duplicate ids would misdirect the labels.
  const key = editing ? editing.id : "new";

  async function submit() {
    if (!name.trim()) {
      onError("Name the customer.");
      return;
    }
    // The lib validates the same thing, but catching it here shows the problem
    // before a round trip and without the error reading as a save failure.
    if (email.trim() && !EMAIL.test(email.trim())) {
      onError("That email address does not look right.");
      return;
    }
    setBusy(true);
    try {
      const input = {
        name: name.trim(),
        phone: phone.trim() || undefined,
        email: email.trim() || undefined,
        address: address.trim() || undefined,
      };
      if (editing) {
        await updateCustomer(getDb(), actor, editing.id, input);
      } else {
        await createCustomer(getDb(), actor, input);
      }
      onClose();
    } catch (e) {
      onError(
        e instanceof Error
          ? e.message
          : editing
            ? "Could not save the customer."
            : "Could not add the customer."
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="mt-6 rounded-3xl border border-brass-500/30 bg-night-900/40 p-6">
      <h2 className="font-display text-lg text-cream-100">
        {editing ? "Correct this customer" : "Add a customer"}
      </h2>
      <div className="mt-5 grid gap-4 sm:grid-cols-2">
        <TextField id={`cust-name-${key}`} label="Name" value={name} onChange={setName} required />
        <TextField id={`cust-phone-${key}`} label="Phone" value={phone} onChange={setPhone} />
        <TextField
          id={`cust-email-${key}`}
          label="Email"
          type="email"
          value={email}
          onChange={setEmail}
        />
        <TextField
          id={`cust-address-${key}`}
          label="Address"
          value={address}
          onChange={setAddress}
        />
      </div>
      <div className="mt-5 flex gap-3">
        <Button onClick={submit} busy={busy}>
          {editing ? "Save changes" : "Add customer"}
        </Button>
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
      </div>
    </section>
  );
}

function StaffList({ actor, onError }: { actor: Actor; onError: (m: string) => void }) {
  const session = useErpSession();
  // Staff edits are admin-only, mirroring `staff.edit` in the capability matrix:
  // a manager can see who works here without being able to rewrite the records
  // that payroll runs against.
  const canEdit = session.can("staff.edit");

  const [rows, setRows] = useState<StaffRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);

  useEffect(() => {
    return onSnapshot(
      query(collection(getDb(), COL.staff), orderBy("name", "asc"), limit(MAX_ROWS)),
      (snap) => {
        setRows(
          snap.docs.map((d) => {
            const x = d.data();
            return {
              id: d.id,
              name: x.name ?? "",
              phone: x.phone ?? "",
              jobTitle: x.jobTitle ?? "",
              isOperator: x.isOperator !== false,
              isAssistant: x.isAssistant !== false,
              active: x.active !== false,
            };
          })
        );
        setLoading(false);
      },
      (e) => {
        onError(e.message);
        setLoading(false);
      }
    );
  }, [onError]);

  return (
    <ListShell
      rows={rows}
      loading={loading}
      noun="staff member"
      plural="staff"
      hint="Add the operators and assistants who work on the floor."
      canEdit={canEdit}
      inactiveHeading="Left"
      adding={adding}
      onAddingChange={setAdding}
      form={(editing, close) => (
        <StaffForm actor={actor} editing={editing} onClose={close} onError={onError} />
      )}
      row={(r) => (
        <RecordPanel
          key={r.id}
          icon={HardHat}
          name={r.name}
          secondary={[r.jobTitle, r.phone].filter(Boolean).join(" · ")}
          active={r.active}
          inactiveLabel="Left"
          open={openId === r.id}
          onToggle={() => {
            setOpenId(openId === r.id ? null : r.id);
            setEditingId(null);
          }}
          canEdit={canEdit}
          editing={editingId === r.id}
          onEditingChange={(v) => setEditingId(v ? r.id : null)}
          onToggleActive={() =>
            setStaffActive(getDb(), actor, r.id, !r.active, r.name).catch((e) =>
              onError(
                e instanceof Error
                  ? e.message
                  : r.active
                    ? "Could not mark them as left."
                    : "Could not reinstate them."
              )
            )
          }
          toggleLabel={r.active ? "Mark as left" : "Reinstate"}
          details={
            <>
              <Detail label="Job title" value={r.jobTitle || "Not recorded"} />
              <Detail label="Phone" value={r.phone || "Not recorded"} />
              <Detail
                label="Works as"
                value={
                  [r.isOperator && "Operator", r.isAssistant && "Assistant"]
                    .filter(Boolean)
                    .join(" and ") || "Not set"
                }
              />
            </>
          }
          form={
            <StaffForm
              actor={actor}
              editing={r}
              onClose={() => setEditingId(null)}
              onError={onError}
            />
          }
        />
      )}
    />
  );
}

/** The one staff form, used to add and to correct. */
function StaffForm({
  actor,
  editing,
  onClose,
  onError,
}: {
  actor: Actor;
  editing?: StaffRow;
  onClose: () => void;
  onError: (m: string) => void;
}) {
  const [name, setName] = useState(editing?.name ?? "");
  const [phone, setPhone] = useState(editing?.phone ?? "");
  const [jobTitle, setJobTitle] = useState(editing?.jobTitle ?? "");
  const [isOperator, setIsOperator] = useState(editing?.isOperator ?? true);
  const [isAssistant, setIsAssistant] = useState(editing?.isAssistant ?? true);
  const [busy, setBusy] = useState(false);

  const key = editing ? editing.id : "new";

  async function submit() {
    if (!name.trim()) {
      onError("Name the staff member.");
      return;
    }
    // Someone who is neither cannot be picked anywhere, so the save would appear
    // to succeed and the record would then be invisible.
    if (!isOperator && !isAssistant) {
      onError("Mark them as an operator, an assistant, or both.");
      return;
    }
    setBusy(true);
    try {
      const input = {
        name: name.trim(),
        phone: phone.trim() || undefined,
        jobTitle: jobTitle.trim() || undefined,
        isOperator,
        isAssistant,
      };
      if (editing) {
        await updateStaff(getDb(), actor, editing.id, input);
      } else {
        await createStaff(getDb(), actor, input);
      }
      onClose();
    } catch (e) {
      onError(
        e instanceof Error
          ? e.message
          : editing
            ? "Could not save the staff member."
            : "Could not add the staff member."
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="mt-6 rounded-3xl border border-brass-500/30 bg-night-900/40 p-6">
      <h2 className="font-display text-lg text-cream-100">
        {editing ? "Correct this record" : "Add a staff member"}
      </h2>
      <div className="mt-5 grid gap-4 sm:grid-cols-3">
        <TextField id={`staff-name-${key}`} label="Name" value={name} onChange={setName} required />
        <TextField id={`staff-phone-${key}`} label="Phone" value={phone} onChange={setPhone} />
        <TextField
          id={`staff-title-${key}`}
          label="Job title"
          value={jobTitle}
          onChange={setJobTitle}
        />
      </div>
      <div className="mt-5 flex flex-wrap gap-6">
        <CheckboxField
          id={`staff-op-${key}`}
          label="Operator"
          checked={isOperator}
          onChange={setIsOperator}
        />
        <CheckboxField
          id={`staff-asst-${key}`}
          label="Assistant"
          checked={isAssistant}
          onChange={setIsAssistant}
        />
      </div>
      <div className="mt-5 flex gap-3">
        <Button onClick={submit} busy={busy}>
          {editing ? "Save changes" : "Add staff member"}
        </Button>
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
      </div>
    </section>
  );
}

function SupplierList({ actor, onError }: { actor: Actor; onError: (m: string) => void }) {
  const session = useErpSession();
  const canEdit = session.can("supplier.edit");

  const [rows, setRows] = useState<SupplierRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);

  useEffect(() => {
    return onSnapshot(
      query(collection(getDb(), COL.suppliers), orderBy("name", "asc"), limit(MAX_ROWS)),
      (snap) => {
        setRows(
          snap.docs.map((d) => {
            const x = d.data();
            return {
              id: d.id,
              name: x.name ?? "",
              phone: x.phone ?? "",
              active: x.active !== false,
            };
          })
        );
        setLoading(false);
      },
      (e) => {
        onError(e.message);
        setLoading(false);
      }
    );
  }, [onError]);

  return (
    <ListShell
      rows={rows}
      loading={loading}
      noun="supplier"
      plural="suppliers"
      hint="Add the merchants you buy boards, blades and fittings from."
      canEdit={canEdit}
      inactiveHeading="No longer used"
      adding={adding}
      onAddingChange={setAdding}
      form={(editing, close) => (
        <SupplierForm actor={actor} editing={editing} onClose={close} onError={onError} />
      )}
      row={(r) => (
        <RecordPanel
          key={r.id}
          icon={Truck}
          name={r.name}
          secondary={r.phone}
          active={r.active}
          inactiveLabel="Retired"
          open={openId === r.id}
          onToggle={() => {
            setOpenId(openId === r.id ? null : r.id);
            setEditingId(null);
          }}
          canEdit={canEdit}
          editing={editingId === r.id}
          onEditingChange={(v) => setEditingId(v ? r.id : null)}
          // Suppliers have no dedicated active setter; the flag rides along with
          // an update, so the name has to be resent unchanged.
          onToggleActive={() =>
            updateSupplier(getDb(), actor, r.id, {
              name: r.name,
              phone: r.phone || undefined,
              active: !r.active,
            }).catch((e) =>
              onError(
                e instanceof Error
                  ? e.message
                  : r.active
                    ? "Could not retire the supplier."
                    : "Could not restore the supplier."
              )
            )
          }
          toggleLabel={r.active ? "Retire supplier" : "Restore supplier"}
          details={<Detail label="Phone" value={r.phone || "Not recorded"} />}
          form={
            <SupplierForm
              actor={actor}
              editing={r}
              onClose={() => setEditingId(null)}
              onError={onError}
            />
          }
        />
      )}
    />
  );
}

/**
 * The one supplier form, used to add and to correct.
 *
 * Creation writes the document directly, since there is no `createSupplier` in
 * the procurement lib and the existing suppliers panel raises them the same way.
 * Categories and the derived scorecard fields are left alone: those accumulate
 * from purchases and are not the user's to set here.
 */
function SupplierForm({
  actor,
  editing,
  onClose,
  onError,
}: {
  actor: Actor;
  editing?: SupplierRow;
  onClose: () => void;
  onError: (m: string) => void;
}) {
  const [name, setName] = useState(editing?.name ?? "");
  const [phone, setPhone] = useState(editing?.phone ?? "");
  const [busy, setBusy] = useState(false);

  const key = editing ? editing.id : "new";

  async function submit() {
    if (!name.trim()) {
      onError("Name the supplier.");
      return;
    }
    setBusy(true);
    try {
      if (editing) {
        await updateSupplier(getDb(), actor, editing.id, {
          name: name.trim(),
          phone: phone.trim() || undefined,
          // Resent so an edit never silently reinstates a retired supplier.
          active: editing.active,
        });
      } else {
        await addDoc(collection(getDb(), COL.suppliers), {
          name: name.trim(),
          phone: phone.trim() || null,
          categories: [],
          active: true,
          createdAt: serverTimestamp(),
          createdBy: actor.uid,
        });
      }
      onClose();
    } catch (e) {
      onError(
        e instanceof Error
          ? e.message
          : editing
            ? "Could not save the supplier."
            : "Could not add the supplier."
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="mt-6 rounded-3xl border border-brass-500/30 bg-night-900/40 p-6">
      <h2 className="font-display text-lg text-cream-100">
        {editing ? "Correct this supplier" : "Add a supplier"}
      </h2>
      <div className="mt-5 grid gap-4 sm:grid-cols-2">
        <TextField id={`sup-name-${key}`} label="Name" value={name} onChange={setName} required />
        <TextField id={`sup-phone-${key}`} label="Phone" value={phone} onChange={setPhone} />
      </div>
      <div className="mt-5 flex gap-3">
        <Button onClick={submit} busy={busy}>
          {editing ? "Save changes" : "Add supplier"}
        </Button>
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
      </div>
    </section>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wider text-cream-500">{label}</dt>
      <dd className="mt-0.5 break-words text-cream-100">{value}</dd>
    </div>
  );
}

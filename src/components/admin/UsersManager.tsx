"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import {
  collection,
  doc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
} from "firebase/firestore";
import { Loader2, ShieldAlert, ShieldCheck, UserPlus } from "lucide-react";
import { getDb } from "@/lib/firebase";
import { COL } from "@/lib/erp/collections";
import { ROLES, ROLE_LABELS, type Role } from "@/lib/erp/enums";
import { capabilitiesFor } from "@/lib/erp/permissions";
import { ROLE_TONE } from "@/lib/erp/statusTone";
import { writeAudit } from "@/lib/erp/audit";
import { StatusPill } from "@/components/admin/ui/StatusPill";
import { useErpSession } from "@/components/admin/ErpAuthProvider";

interface UserRow {
  id: string;
  email: string;
  name: string;
  role: Role;
  phone?: string;
  active: boolean;
  staffId?: string;
}

/**
 * Users & roles. Admin-only.
 *
 * A user document is what grants staff access — a Firebase account alone does
 * nothing, because public signup is enabled on this project. The uid must match
 * the Firebase Auth uid, so the flow is: create the account in the Firebase
 * console, then record it here with a role.
 */
export function UsersManager() {
  const session = useErpSession();
  const [rows, setRows] = useState<UserRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState("");

  const isAdmin = session.role === "admin";

  useEffect(() => {
    if (!isAdmin) {
      setLoading(false);
      return;
    }
    const q = query(collection(getDb(), COL.users), orderBy("name", "asc"));
    return onSnapshot(
      q,
      (snap) => {
        setRows(
          snap.docs.map((d) => {
            const data = d.data();
            return {
              id: d.id,
              email: data.email ?? "",
              name: data.name ?? "",
              role: (data.role as Role) ?? "operator",
              phone: data.phone,
              active: data.active !== false,
              staffId: data.staffId,
            };
          })
        );
        setLoading(false);
      },
      (err) => {
        setError(err.message);
        setLoading(false);
      }
    );
  }, [isAdmin]);

  const actor = useMemo(
    () => ({
      uid: session.user?.uid ?? "",
      email: session.user?.email ?? "",
      role: (session.role ?? "operator") as Role,
    }),
    [session.user, session.role]
  );

  async function changeRole(row: UserRow, role: Role) {
    if (role === row.role) return;
    setBusyId(row.id);
    setError("");
    try {
      await updateDoc(doc(getDb(), COL.users, row.id), {
        role,
        updatedAt: serverTimestamp(),
        updatedBy: actor.uid,
      });
      await writeAudit(getDb(), {
        actor,
        action: "role_change",
        collectionName: COL.users,
        docId: row.id,
        summary: `${row.email}: ${ROLE_LABELS[row.role]} → ${ROLE_LABELS[role]}`,
        before: { role: row.role },
        after: { role },
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not change role.");
    } finally {
      setBusyId(null);
    }
  }

  async function toggleActive(row: UserRow) {
    setBusyId(row.id);
    setError("");
    try {
      const active = !row.active;
      await updateDoc(doc(getDb(), COL.users, row.id), {
        active,
        updatedAt: serverTimestamp(),
        updatedBy: actor.uid,
      });
      await writeAudit(getDb(), {
        actor,
        action: active ? "update" : "user_deactivate",
        collectionName: COL.users,
        docId: row.id,
        summary: `${row.email} ${active ? "reactivated" : "deactivated"}`,
        before: { active: row.active },
        after: { active },
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not update user.");
    } finally {
      setBusyId(null);
    }
  }

  async function addUser(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const uid = String(form.get("uid") ?? "").trim();
    const email = String(form.get("email") ?? "").trim();
    const name = String(form.get("name") ?? "").trim();
    const role = String(form.get("role") ?? "operator") as Role;
    if (!uid || !email) {
      setError("Firebase UID and email are both required.");
      return;
    }

    setBusyId("new");
    setError("");
    try {
      await setDoc(doc(getDb(), COL.users, uid), {
        email,
        name: name || email,
        role,
        active: true,
        createdAt: serverTimestamp(),
        createdBy: actor.uid,
      });
      await writeAudit(getDb(), {
        actor,
        action: "create",
        collectionName: COL.users,
        docId: uid,
        summary: `Added ${email} as ${ROLE_LABELS[role]}`,
        after: { email, name, role, active: true },
      });
      e.currentTarget.reset();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not add user.");
    } finally {
      setBusyId(null);
    }
  }

  if (!session.ready) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center">
        <Loader2 className="animate-spin text-brass-400" size={28} aria-label="Loading" />
      </div>
    );
  }

  if (!isAdmin) {
    return (
      <div className="mx-auto max-w-lg rounded-3xl border border-red-500/30 bg-red-500/5 p-8 text-center">
        <ShieldAlert className="mx-auto text-red-400" size={32} />
        <h1 className="mt-4 font-display text-xl text-cream-100">Admin only</h1>
        <p className="mt-2 text-sm text-cream-400">
          Managing users and roles is restricted to administrators.
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl">
      <header>
        <p className="text-eyebrow">Access control</p>
        <h1 className="text-title mt-3 text-cream-50">Users &amp; Roles</h1>
        <p className="mt-3 max-w-2xl text-sm leading-relaxed text-cream-400">
          A Firebase account alone grants nothing — public signup is enabled, so
          staff access comes from the record below. Create the account in the
          Firebase console first, then add its UID here with a role.
        </p>
      </header>

      {error && (
        <p role="alert" className="mt-6 flex items-center gap-2 text-sm text-red-400">
          <ShieldAlert size={16} /> {error}
        </p>
      )}

      {/* Add user */}
      <form
        onSubmit={addUser}
        className="mt-8 rounded-3xl border border-night-700/60 bg-night-900/50 p-6"
      >
        <h2 className="flex items-center gap-2 font-display text-lg text-cream-100">
          <UserPlus size={18} className="text-brass-400" /> Grant access
        </h2>
        <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Firebase UID" name="uid" placeholder="from Firebase console" required />
          <Field label="Email" name="email" type="email" required />
          <Field label="Full name" name="name" />
          <div>
            <label htmlFor="new-role" className="mb-1.5 block text-sm text-cream-300">
              Role
            </label>
            <select
              id="new-role"
              name="role"
              defaultValue="operator"
              className="w-full cursor-pointer rounded-xl border border-night-600 bg-night-800/60 px-4 py-3 text-cream-100 focus:border-brass-500 focus:outline-none"
            >
              {ROLES.map((r) => (
                <option key={r} value={r}>
                  {ROLE_LABELS[r]}
                </option>
              ))}
            </select>
          </div>
        </div>
        <button
          type="submit"
          disabled={busyId === "new"}
          className="mt-5 cursor-pointer rounded-xl bg-brass-500 px-6 py-3 text-sm font-medium text-night-950 transition-colors duration-300 hover:bg-brass-400 disabled:opacity-60"
        >
          {busyId === "new" ? "Adding…" : "Add user"}
        </button>
      </form>

      {/* Users */}
      <section className="mt-10">
        <h2 className="font-display text-lg text-cream-100">
          Staff accounts {rows.length > 0 && <span className="text-cream-500">({rows.length})</span>}
        </h2>

        {loading ? (
          <div className="mt-6 flex justify-center py-10">
            <Loader2 className="animate-spin text-brass-400" size={24} aria-label="Loading" />
          </div>
        ) : rows.length === 0 ? (
          <p className="mt-6 rounded-3xl border border-night-700/60 bg-night-900/40 p-8 text-center text-sm text-cream-400">
            No staff accounts yet. Add the first one above — use your own Firebase
            UID so you keep admin access once the bootstrap emails are removed.
          </p>
        ) : (
          <div className="mt-6 overflow-x-auto rounded-3xl border border-night-700/60">
            <table className="w-full min-w-[46rem] text-left text-sm">
              <thead className="bg-night-900/70 text-xs uppercase tracking-wider text-cream-500">
                <tr>
                  <th className="px-5 py-3 font-medium">Name</th>
                  <th className="px-5 py-3 font-medium">Email</th>
                  <th className="px-5 py-3 font-medium">Role</th>
                  <th className="px-5 py-3 font-medium">Access</th>
                  <th className="px-5 py-3 font-medium">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-night-800">
                {rows.map((row) => {
                  const isSelf = row.id === session.user?.uid;
                  return (
                    <tr key={row.id} className={row.active ? "" : "opacity-55"}>
                      <td className="px-5 py-4 text-cream-100">
                        {row.name}
                        {isSelf && <span className="ml-2 text-xs text-brass-400">(you)</span>}
                      </td>
                      <td className="px-5 py-4 text-cream-400">{row.email}</td>
                      <td className="px-5 py-4">
                        <select
                          aria-label={`Role for ${row.email}`}
                          value={row.role}
                          disabled={busyId === row.id || isSelf}
                          onChange={(e) => changeRole(row, e.target.value as Role)}
                          title={
                            isSelf
                              ? "You cannot change your own role — ask another admin."
                              : undefined
                          }
                          className="cursor-pointer rounded-lg border border-night-600 bg-night-800/60 px-3 py-2 text-cream-100 focus:border-brass-500 focus:outline-none disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          {ROLES.map((r) => (
                            <option key={r} value={r}>
                              {ROLE_LABELS[r]}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="px-5 py-4">
                        <StatusPill tone={ROLE_TONE[row.role]}>
                          <ShieldCheck size={13} />
                          {capabilitiesFor(row.role).length} permissions
                        </StatusPill>
                      </td>
                      <td className="px-5 py-4">
                        <button
                          onClick={() => toggleActive(row)}
                          disabled={busyId === row.id || isSelf}
                          title={
                            isSelf ? "You cannot deactivate your own account." : undefined
                          }
                          className="cursor-pointer disabled:cursor-not-allowed"
                        >
                          <StatusPill tone={row.active ? "positive" : "neutral"}>
                            {row.active ? "Active" : "Disabled"}
                          </StatusPill>
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Role reference */}
      <section className="mt-12">
        <h2 className="font-display text-lg text-cream-100">What each role can do</h2>
        <div className="mt-5 grid gap-4 sm:grid-cols-3">
          {ROLES.map((r) => (
            <div key={r} className="rounded-3xl border border-night-700/60 bg-night-900/40 p-5">
              <StatusPill tone={ROLE_TONE[r]}>{ROLE_LABELS[r]}</StatusPill>
              <p className="mt-3 text-2xl font-display text-cream-100">
                {capabilitiesFor(r).length}
              </p>
              <p className="text-xs text-cream-500">permissions</p>
              <p className="mt-3 text-xs leading-relaxed text-cream-400">
                {r === "admin" &&
                  "Full control, including marking invoices paid, wage rates, payroll, loan approval and the audit log."}
                {r === "manager" &&
                  "Runs daily operations: jobs, projects, estimates, inventory, purchasing and invoicing — but cannot mark invoices paid, set wages, run payroll or approve loans."}
                {r === "operator" &&
                  "Logs their own work, views assigned jobs, requests tools and advances."}
              </p>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

function Field({
  label,
  name,
  type = "text",
  placeholder,
  required,
}: {
  label: string;
  name: string;
  type?: string;
  placeholder?: string;
  required?: boolean;
}) {
  const id = `field-${name}`;
  return (
    <div>
      <label htmlFor={id} className="mb-1.5 block text-sm text-cream-300">
        {label}
        {required && <span className="ml-1 text-brass-400">*</span>}
      </label>
      <input
        id={id}
        name={name}
        type={type}
        required={required}
        placeholder={placeholder}
        className="w-full rounded-xl border border-night-600 bg-night-800/60 px-4 py-3 text-cream-100 placeholder:text-cream-600 focus:border-brass-500 focus:outline-none"
      />
    </div>
  );
}

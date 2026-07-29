"use client";

import { useEffect, useMemo, useState } from "react";
import { doc, onSnapshot, serverTimestamp, setDoc } from "firebase/firestore";
import { Lock, RotateCcw, Save, ShieldCheck } from "lucide-react";
import { getDb } from "@/lib/firebase";
import { COL } from "@/lib/erp/collections";
import { ROLE_LABELS, type Role } from "@/lib/erp/enums";
import { capabilitiesFor, type Capability } from "@/lib/erp/permissions";
import { CAPABILITY_GROUPS } from "@/lib/erp/capabilityGroups";
import { ROLE_TONE } from "@/lib/erp/statusTone";
import { writeAudit } from "@/lib/erp/audit";
import { StatusPill } from "@/components/admin/ui/StatusPill";
import { Button } from "@/components/admin/ui/Fields";
import { useErpSession } from "@/components/admin/ErpAuthProvider";

/** Roles whose permissions can be edited. Admin is fixed by design. */
const EDITABLE_ROLES: Role[] = ["manager", "operator"];

const SETTINGS_DOC_ID = "rolePermissions";

type Overrides = Partial<Record<Role, Capability[]>>;

/**
 * Role permissions.
 *
 * Admin is shown as a fixed summary and cannot be edited — a system where the
 * top role can have capabilities removed is one lockout away from being
 * unadministrable.
 *
 * Manager and Operator are editable, but capabilities marked `adminOnly` stay
 * locked. Those are the ones the Firestore rules hard-deny for non-admins, so
 * offering them here would produce a checkbox that appears to work and silently
 * fails at the database.
 */
export function RolePermissionsEditor() {
  const session = useErpSession();
  const isAdmin = session.role === "admin";

  const [overrides, setOverrides] = useState<Overrides>({});
  const [draft, setDraft] = useState<Overrides>({});
  const [openRole, setOpenRole] = useState<Role | null>(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const ref = doc(getDb(), COL.settings, SETTINGS_DOC_ID);
    return onSnapshot(
      ref,
      (snap) => {
        const data = (snap.data()?.roles ?? {}) as Overrides;
        setOverrides(data);
        setDraft(data);
      },
      () => {}
    );
  }, []);

  /** Saved override if present, else the code default. */
  function effective(role: Role, source: Overrides): Capability[] {
    return source[role] ?? [...capabilitiesFor(role)];
  }

  const dirty = useMemo(
    () =>
      EDITABLE_ROLES.some(
        (r) =>
          JSON.stringify([...effective(r, draft)].sort()) !==
          JSON.stringify([...effective(r, overrides)].sort())
      ),
    [draft, overrides]
  );

  function toggle(role: Role, capability: Capability, on: boolean) {
    setDraft((prev) => {
      const current = new Set(effective(role, prev));
      if (on) current.add(capability);
      else current.delete(capability);
      return { ...prev, [role]: [...current] };
    });
    setSaved(false);
  }

  async function save() {
    setBusy(true);
    setError("");
    try {
      const payload: Overrides = {};
      for (const r of EDITABLE_ROLES) payload[r] = effective(r, draft);

      await setDoc(
        doc(getDb(), COL.settings, SETTINGS_DOC_ID),
        { roles: payload, updatedAt: serverTimestamp(), updatedBy: session.user?.uid ?? "" },
        { merge: true }
      );

      await writeAudit(getDb(), {
        actor: {
          uid: session.user?.uid ?? "",
          email: session.user?.email ?? "",
          role: "admin",
        },
        action: "settings_change",
        collectionName: COL.settings,
        docId: SETTINGS_DOC_ID,
        summary: `Updated role permissions (${EDITABLE_ROLES.map(
          (r) => `${ROLE_LABELS[r]}: ${effective(r, draft).length}`
        ).join(", ")})`,
        before: { roles: overrides },
        after: { roles: payload },
      });

      setSaved(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save permissions.");
    } finally {
      setBusy(false);
    }
  }

  function resetRole(role: Role) {
    setDraft((prev) => {
      const next = { ...prev };
      delete next[role];
      return next;
    });
    setSaved(false);
  }

  if (!isAdmin) return null;

  return (
    <section className="mt-12">
      <h2 className="font-display text-lg text-cream-100">What each role can do</h2>
      <p className="mt-2 max-w-2xl text-sm text-cream-400">
        Admin access is fixed. Manager and Operator can be tailored — except for
        the finance and system controls marked with a lock, which stay
        administrator-only and are enforced by the database, not just this screen.
      </p>

      {/* Admin — read-only summary */}
      <div className="mt-6 rounded-3xl border border-night-700/60 bg-night-900/40 p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <StatusPill tone={ROLE_TONE.admin}>{ROLE_LABELS.admin}</StatusPill>
          <span className="flex items-center gap-1.5 text-xs text-cream-500">
            <Lock size={13} /> Fixed — cannot be edited
          </span>
        </div>
        <p className="mt-4 font-display text-2xl text-cream-100">
          {capabilitiesFor("admin").length}
          <span className="ml-2 text-sm font-normal text-cream-500">permissions</span>
        </p>
        <p className="mt-3 max-w-2xl text-sm leading-relaxed text-cream-400">
          Full control of the system: everything a manager can do, plus marking
          invoices paid, setting wage rates, running and approving payroll,
          approving loans and advances, approving estimates, company finances,
          user management, settings, the audit log, and deleting records.
        </p>
      </div>

      {/* Manager & Operator — editable */}
      <div className="mt-5 space-y-4">
        {EDITABLE_ROLES.map((role) => {
          const granted = new Set(effective(role, draft));
          const isOpen = openRole === role;
          const usingDefault = !draft[role];

          return (
            <div
              key={role}
              className="overflow-hidden rounded-3xl border border-night-700/60 bg-night-900/40"
            >
              <button
                type="button"
                onClick={() => setOpenRole(isOpen ? null : role)}
                aria-expanded={isOpen}
                className="flex w-full cursor-pointer items-center justify-between gap-4 p-6 text-left transition-colors hover:bg-night-900/60"
              >
                <span className="flex flex-wrap items-center gap-3">
                  <StatusPill tone={ROLE_TONE[role]}>{ROLE_LABELS[role]}</StatusPill>
                  <span className="text-sm text-cream-300">
                    {granted.size} permission{granted.size === 1 ? "" : "s"}
                  </span>
                  {!usingDefault && (
                    <span className="text-xs text-brass-400">customised</span>
                  )}
                </span>
                <span className="text-sm text-cream-500">{isOpen ? "Hide" : "Edit"}</span>
              </button>

              {isOpen && (
                <div className="border-t border-night-700/60 p-6">
                  <div className="grid gap-6 sm:grid-cols-2">
                    {CAPABILITY_GROUPS.map((group) => (
                      <fieldset key={group.key} className="min-w-0">
                        <legend className="mb-2 text-xs uppercase tracking-wider text-brass-400">
                          {group.title}
                        </legend>
                        <div className="space-y-2">
                          {group.capabilities.map((c) => {
                            const id = `${role}-${c.capability}`;
                            const locked = Boolean(c.adminOnly);
                            return (
                              <div key={c.capability}>
                                <label
                                  htmlFor={id}
                                  className={`flex items-start gap-2.5 text-sm ${
                                    locked
                                      ? "cursor-not-allowed text-cream-600"
                                      : "cursor-pointer text-cream-300"
                                  }`}
                                >
                                  <input
                                    id={id}
                                    type="checkbox"
                                    checked={locked ? false : granted.has(c.capability)}
                                    disabled={locked}
                                    onChange={(e) =>
                                      toggle(role, c.capability, e.target.checked)
                                    }
                                    className="mt-0.5 h-4 w-4 shrink-0 accent-brass-500 disabled:opacity-40"
                                  />
                                  <span className="min-w-0">
                                    {c.label}
                                    {locked && (
                                      <Lock
                                        size={11}
                                        className="ml-1.5 inline-block -translate-y-px text-cream-600"
                                        aria-label="Administrator only"
                                      />
                                    )}
                                    {c.hint && (
                                      <span className="block text-xs text-cream-600">
                                        {c.hint}
                                      </span>
                                    )}
                                  </span>
                                </label>
                              </div>
                            );
                          })}
                        </div>
                      </fieldset>
                    ))}
                  </div>

                  {!usingDefault && (
                    <button
                      type="button"
                      onClick={() => resetRole(role)}
                      className="mt-5 flex cursor-pointer items-center gap-2 text-xs text-cream-400 transition-colors hover:text-brass-300"
                    >
                      <RotateCcw size={13} /> Reset {ROLE_LABELS[role]} to defaults
                    </button>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {error && (
        <p role="alert" className="mt-4 text-sm text-red-400">
          {error}
        </p>
      )}

      {(dirty || saved) && (
        <div className="mt-5 flex flex-wrap items-center gap-4">
          <Button onClick={save} busy={busy} disabled={!dirty}>
            <span className="flex items-center gap-2">
              <Save size={15} /> Save permissions
            </span>
          </Button>
          {saved && !dirty && (
            <span className="flex items-center gap-1.5 text-sm text-emerald-400" role="status">
              <ShieldCheck size={15} /> Saved
            </span>
          )}
        </div>
      )}
    </section>
  );
}

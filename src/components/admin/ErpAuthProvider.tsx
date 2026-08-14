"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { doc, onSnapshot, serverTimestamp, setDoc } from "firebase/firestore";
import { onAuthStateChanged, type User } from "firebase/auth";
import { getDb, getFirebaseAuth } from "@/lib/firebase";
import { COL } from "@/lib/erp/collections";
import type { Role } from "@/lib/erp/enums";
import { UNGRANTABLE_CAPABILITIES, can, type Capability } from "@/lib/erp/permissions";

/**
 * Resolves the signed-in user's ERP role and exposes capability checks.
 *
 * The role lives in `users/{uid}.role` and is watched live, so revoking access
 * takes effect without the user re-authenticating. A signed-in session on its
 * own proves nothing, this project has public signup enabled, so a user
 * document with `active: true` is what makes someone staff.
 *
 * Capability checks here drive the UI only. Every gate is enforced again in
 * Firestore rules and Cloud Functions; hiding a button is not access control.
 */

export interface ErpSession {
  user: User | null;
  /**
   * The role the interface is behaving as — the assumed one while a super admin is switched,
   * otherwise the real one. Almost every caller wants this: it is what decides which screens
   * and buttons appear.
   */
  role: Role | null;
  /**
   * The role this login actually holds, whatever it is acting as.
   *
   * Read this only where the *identity* matters rather than the behaviour: writing an audit
   * entry, deciding whether the switcher itself may be used, and nothing else. Using it for a
   * capability check would let a switched super admin see screens they had switched away from.
   */
  realRole: Role | null;
  /** The role being acted as, or null when not switched. Drives the banner. */
  actingAs: Role | null;
  /** Switch the interface to another role, or back with null. Super admin only. */
  actAs: (role: Role | null) => void;
  /** Staff record linked to this login, when there is one. */
  staffId: string | null;
  displayName: string;
  /** True once the user doc lookup has settled, successfully or not. */
  ready: boolean;
  /** Signed in but with no active user document, not staff. */
  unauthorised: boolean;
  can: (capability: Capability) => boolean;
  canAny: (capabilities: Capability[]) => boolean;
  /**
   * True when the real role holds this, regardless of what is being acted as.
   *
   * For the few controls that must stay reachable while switched — the switcher itself, and
   * the banner's way back — so a super admin who switches to operator is not stranded in an
   * interface with no route home.
   */
  canReally: (capability: Capability) => boolean;
}

const EMPTY: ErpSession = {
  user: null,
  role: null,
  realRole: null,
  actingAs: null,
  actAs: () => {},
  staffId: null,
  displayName: "",
  ready: false,
  unauthorised: false,
  can: () => false,
  canAny: () => false,
  canReally: () => false,
};

/**
 * Emails that get admin access before a `users/{uid}` document exists.
 *
 * Must stay in sync with `bootstrapEmails()` in firestore.rules. Without this
 * the client is a chicken-and-egg trap: the rules would let these accounts
 * write their own user document, but the nav that leads to that screen is
 * filtered by a role read from the very document that doesn't exist yet.
 *
 * Remove both lists once real admin documents are in place.
 */
const BOOTSTRAP_ADMIN_EMAILS = ["admin@nightowl.com.ng", "info@nightowl.com.ng"];

function isBootstrapAdmin(email: string | null | undefined): boolean {
  return Boolean(email && BOOTSTRAP_ADMIN_EMAILS.includes(email.toLowerCase()));
}

const ErpAuthContext = createContext<ErpSession>(EMPTY);

export function useErpSession(): ErpSession {
  return useContext(ErpAuthContext);
}

/** Convenience hook for a single capability. */
export function useCan(capability: Capability): boolean {
  return useErpSession().can(capability);
}

/**
 * The audit actor for the signed-in user.
 *
 * Always the **real** role, plus the role being acted as when a super admin has switched. The
 * screens used to build this inline from `session.role`, which is the *effective* role — so once
 * switching existed, every one of them would have recorded an operator as the author of a super
 * admin's work. One helper means that decision is made once rather than in twenty-five places
 * that each looked correct on their own.
 */
export function useAuditActor() {
  const session = useErpSession();
  return useMemo(
    () => ({
      uid: session.user?.uid ?? "",
      email: session.user?.email ?? "",
      role: session.realRole ?? "manager",
      actingAs: session.actingAs,
    }),
    [session.user, session.realRole, session.actingAs]
  );
}

export function ErpAuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [realRole, setRealRole] = useState<Role | null>(null);
  const [staffId, setStaffId] = useState<string | null>(null);
  const [profileName, setProfileName] = useState("");
  const [profileReady, setProfileReady] = useState(false);
  /*
   * The role a super admin is currently acting as.
   *
   * Held in component state rather than persisted: a switch lasts for the session and a reload
   * returns to the real role, which is the safer default — nobody should discover days later
   * that they have been working inside a narrowed interface. Nothing about it is sent to the
   * database, so it cannot be mistaken for the caller's real grant by any rule.
   */
  const [actingAs, setActingAs] = useState<Role | null>(null);

  useEffect(() => {
    return onAuthStateChanged(getFirebaseAuth(), (u) => {
      setUser(u);
      setAuthReady(true);
      if (!u) {
        setRealRole(null);
        setStaffId(null);
        setProfileName("");
        setProfileReady(true);
      } else {
        // New user: hold `ready` false until the role document resolves, so the
        // UI never briefly renders as though the user had no permissions.
        setProfileReady(false);
      }
    });
  }, []);

  useEffect(() => {
    if (!user) return;

    /*
     * Bootstrap accounts come up as super admin, not admin.
     *
     * This is the escape hatch that exists before any `users/{uid}` document does, and the
     * settings it has to reach — including the role list itself — are now super-admin-only. As
     * plain admin it would have been locked out of the very screens it exists to set up, and
     * `bootstrapAdmin()` in the rules already grants the same level.
     */
    const fallbackRole: Role | null = isBootstrapAdmin(user.email) ? "super_admin" : null;

    const ref = doc(getDb(), COL.users, user.uid);
    return onSnapshot(
      ref,
      (snap) => {
        const data = snap.data();
        if (!snap.exists() || data?.active === false) {
          // Bootstrap accounts keep admin so they can create the missing
          // document; everyone else genuinely has no access.
          setRealRole(fallbackRole);
          setStaffId(null);
        } else {
          // `active` written as the string "true" by hand in the console would
          // otherwise read as truthy here but fail the rules' `== true` check,
          // so treat only a real boolean false as deactivation.
          setRealRole((data?.role as Role) ?? fallbackRole);
          setStaffId((data?.staffId as string) ?? null);
          setProfileName((data?.name as string) ?? "");
        }
        setProfileReady(true);
      },
      () => {
        // Rules denied the read. For a bootstrap account that still means admin;
        // otherwise it means "not staff".
        setRealRole(fallbackRole);
        setStaffId(null);
        setProfileReady(true);
      }
    );
  }, [user]);

  /** Records the sign-in timestamp once per session, best-effort. */
  useEffect(() => {
    if (!user || !realRole) return;
    setDoc(
      doc(getDb(), COL.users, user.uid),
      { lastLoginAt: serverTimestamp() },
      { merge: true }
    ).catch(() => {});
  }, [user, realRole]);

  /**
   * Admin-configured overrides for the Manager and Operator roles.
   *
   * Admin is deliberately absent: its capability set is fixed in code so the
   * top role can never be edited into a state where nobody can administer the
   * system.
   */
  const [overrides, setOverrides] = useState<Partial<Record<Role, Capability[]>>>({});

  useEffect(() => {
    if (!user) return;
    return onSnapshot(
      doc(getDb(), COL.settings, "rolePermissions"),
      (snap) => setOverrides((snap.data()?.roles ?? {}) as Partial<Record<Role, Capability[]>>),
      () => setOverrides({})
    );
  }, [user]);

  /** Resolves a capability against one specific role, honouring saved overrides. */
  const canAsRole = useCallback(
    (asRole: Role | null, capability: Capability) => {
      if (!asRole) return false;
      // The two senior roles always use the code list; overrides never apply to them, so the
      // top of the tree cannot be edited into a state where nobody can administer the system.
      if (asRole === "super_admin" || asRole === "admin") return can(asRole, capability);

      const custom = overrides[asRole];
      if (!custom) return can(asRole, capability);

      // Ungrantable capabilities are never handed to another role, whatever the saved list
      // says. The Firestore rules deny them regardless, so honouring one here would only
      // produce a button that fails on click.
      if (UNGRANTABLE_CAPABILITIES.includes(capability)) return false;

      return custom.includes(capability);
    },
    [overrides]
  );

  /*
   * The effective role: what the interface behaves as.
   *
   * Only a super admin may act as something else, checked against the *real* role so a switch
   * cannot be used to reach a role the login never held — switching to operator must not become
   * a route to switching onward into something else.
   */
  const canSwitch = realRole === "super_admin";
  const effectiveRole = canSwitch && actingAs ? actingAs : realRole;

  const canFn = useCallback(
    (capability: Capability) => canAsRole(effectiveRole, capability),
    [canAsRole, effectiveRole]
  );

  /** The real role's grants, for the controls that must survive a switch. */
  const canReallyFn = useCallback(
    (capability: Capability) => canAsRole(realRole, capability),
    [canAsRole, realRole]
  );

  const actAs = useCallback(
    (next: Role | null) => {
      if (!canSwitch) return;
      // Switching "to" super admin is the way back, not a further switch.
      setActingAs(next === null || next === "super_admin" ? null : next);
    },
    [canSwitch]
  );

  const canAnyFn = useCallback(
    (capabilities: Capability[]) => capabilities.some((c) => canFn(c)),
    [canFn]
  );

  const value = useMemo<ErpSession>(
    () => ({
      user,
      // `role` is the effective one, so the ~200 existing `session.role` and `session.can`
      // callers behave as the assumed role without any of them needing to know about switching.
      role: effectiveRole,
      realRole,
      actingAs: canSwitch ? actingAs : null,
      actAs,
      staffId,
      displayName: profileName || user?.email || "",
      ready: authReady && profileReady,
      // Judged on the real role: acting as something else is not a loss of access.
      unauthorised: Boolean(user) && profileReady && realRole === null,
      can: canFn,
      canAny: canAnyFn,
      canReally: canReallyFn,
    }),
    [
      user,
      effectiveRole,
      realRole,
      actingAs,
      canSwitch,
      actAs,
      staffId,
      profileName,
      authReady,
      profileReady,
      canFn,
      canAnyFn,
      canReallyFn,
    ]
  );

  return <ErpAuthContext.Provider value={value}>{children}</ErpAuthContext.Provider>;
}

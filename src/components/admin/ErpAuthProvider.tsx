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
import { ADMIN_ONLY_CAPABILITIES, can, type Capability } from "@/lib/erp/permissions";

/**
 * Resolves the signed-in user's ERP role and exposes capability checks.
 *
 * The role lives in `users/{uid}.role` and is watched live, so revoking access
 * takes effect without the user re-authenticating. A signed-in session on its
 * own proves nothing — this project has public signup enabled, so a user
 * document with `active: true` is what makes someone staff.
 *
 * Capability checks here drive the UI only. Every gate is enforced again in
 * Firestore rules and Cloud Functions; hiding a button is not access control.
 */

export interface ErpSession {
  user: User | null;
  role: Role | null;
  /** Staff record linked to this login, when there is one. */
  staffId: string | null;
  displayName: string;
  /** True once the user doc lookup has settled, successfully or not. */
  ready: boolean;
  /** Signed in but with no active user document — not staff. */
  unauthorised: boolean;
  can: (capability: Capability) => boolean;
  canAny: (capabilities: Capability[]) => boolean;
}

const EMPTY: ErpSession = {
  user: null,
  role: null,
  staffId: null,
  displayName: "",
  ready: false,
  unauthorised: false,
  can: () => false,
  canAny: () => false,
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

export function ErpAuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [role, setRole] = useState<Role | null>(null);
  const [staffId, setStaffId] = useState<string | null>(null);
  const [profileName, setProfileName] = useState("");
  const [profileReady, setProfileReady] = useState(false);

  useEffect(() => {
    return onAuthStateChanged(getFirebaseAuth(), (u) => {
      setUser(u);
      setAuthReady(true);
      if (!u) {
        setRole(null);
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

    const fallbackRole: Role | null = isBootstrapAdmin(user.email) ? "admin" : null;

    const ref = doc(getDb(), COL.users, user.uid);
    return onSnapshot(
      ref,
      (snap) => {
        const data = snap.data();
        if (!snap.exists() || data?.active === false) {
          // Bootstrap accounts keep admin so they can create the missing
          // document; everyone else genuinely has no access.
          setRole(fallbackRole);
          setStaffId(null);
        } else {
          // `active` written as the string "true" by hand in the console would
          // otherwise read as truthy here but fail the rules' `== true` check,
          // so treat only a real boolean false as deactivation.
          setRole((data?.role as Role) ?? fallbackRole);
          setStaffId((data?.staffId as string) ?? null);
          setProfileName((data?.name as string) ?? "");
        }
        setProfileReady(true);
      },
      () => {
        // Rules denied the read. For a bootstrap account that still means admin;
        // otherwise it means "not staff".
        setRole(fallbackRole);
        setStaffId(null);
        setProfileReady(true);
      }
    );
  }, [user]);

  /** Records the sign-in timestamp once per session, best-effort. */
  useEffect(() => {
    if (!user || !role) return;
    setDoc(
      doc(getDb(), COL.users, user.uid),
      { lastLoginAt: serverTimestamp() },
      { merge: true }
    ).catch(() => {});
  }, [user, role]);

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

  const canFn = useCallback(
    (capability: Capability) => {
      if (!role) return false;
      // Admin always uses the code list; overrides never apply to it.
      if (role === "admin") return can(role, capability);

      const custom = overrides[role];
      if (!custom) return can(role, capability);

      // Admin-only capabilities are never grantable to another role, whatever
      // the saved list says — the Firestore rules deny them regardless, so
      // honouring one here would only produce a button that fails on click.
      if (ADMIN_ONLY_CAPABILITIES.includes(capability)) return false;

      return custom.includes(capability);
    },
    [role, overrides]
  );

  const canAnyFn = useCallback(
    (capabilities: Capability[]) => capabilities.some((c) => canFn(c)),
    [canFn]
  );

  const value = useMemo<ErpSession>(
    () => ({
      user,
      role,
      staffId,
      displayName: profileName || user?.email || "",
      ready: authReady && profileReady,
      unauthorised: Boolean(user) && profileReady && role === null,
      can: canFn,
      canAny: canAnyFn,
    }),
    [user, role, staffId, profileName, authReady, profileReady, canFn, canAnyFn]
  );

  return <ErpAuthContext.Provider value={value}>{children}</ErpAuthContext.Provider>;
}

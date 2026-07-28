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
import { can, canAny, type Capability } from "@/lib/erp/permissions";

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

    const ref = doc(getDb(), COL.users, user.uid);
    return onSnapshot(
      ref,
      (snap) => {
        const data = snap.data();
        if (!snap.exists() || data?.active === false) {
          setRole(null);
          setStaffId(null);
        } else {
          setRole((data?.role as Role) ?? null);
          setStaffId((data?.staffId as string) ?? null);
          setProfileName((data?.name as string) ?? "");
        }
        setProfileReady(true);
      },
      () => {
        // Rules denied the read, which itself means "not staff".
        setRole(null);
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

  const canFn = useCallback((capability: Capability) => can(role, capability), [role]);
  const canAnyFn = useCallback(
    (capabilities: Capability[]) => canAny(role, capabilities),
    [role]
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

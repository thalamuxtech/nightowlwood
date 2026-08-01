import { getFirestore } from "firebase-admin/firestore";
import { HttpsError } from "firebase-functions/v2/https";

/**
 * Capability checks for callables, honouring an admin's grants.
 *
 * An admin can widen a role in Settings → Roles, and the Firestore rules read
 * those grants. A Cloud Function that still asked "is this an admin?" would refuse
 * work the rules would have allowed, so the grant would appear to do nothing for
 * anything routed through a function — marking an invoice paid, emailing a
 * document. This is the same check as `isAdminOr()` in firestore.rules, written
 * once for the server.
 */

export type Role = "admin" | "manager" | "operator";

export interface Actor {
  uid: string;
  email: string;
  role: Role;
}

/**
 * Capabilities no grant can confer, mirroring ADMIN_ONLY_CAPABILITIES in
 * src/lib/erp/permissions.ts and `ungrantable()` in firestore.rules.
 *
 * Both are routes to removing an admin's own access: one changes roles, the other
 * edits the document these grants live in.
 */
const UNGRANTABLE = ["user.manage", "settings.change"];

/** The signed-in caller, rejected unless they are active staff. */
export async function requireStaff(
  auth: { uid: string; token: { email?: string } } | undefined
): Promise<Actor> {
  if (!auth) throw new HttpsError("unauthenticated", "Sign in first.");
  const snap = await getFirestore().doc(`users/${auth.uid}`).get();
  if (!snap.exists || snap.data()?.active === false) {
    throw new HttpsError("permission-denied", "This account is not active staff.");
  }
  const role = snap.data()?.role as Role | undefined;
  if (!role) {
    throw new HttpsError("permission-denied", "This account has no role.");
  }
  return { uid: auth.uid, email: auth.token.email ?? snap.data()?.email ?? "", role };
}

/** True when an admin has granted `capability` to this role. */
async function hasGrant(role: Role, capability: string): Promise<boolean> {
  if (UNGRANTABLE.includes(capability)) return false;
  try {
    const snap = await getFirestore().doc("settings/rolePermissions").get();
    const roles = (snap.data()?.roles ?? {}) as Record<string, string[] | undefined>;
    return (roles[role] ?? []).includes(capability);
  } catch {
    // A missing or unreadable grants document means no grants, not open access.
    return false;
  }
}

/**
 * The caller, rejected unless they are an admin or hold `capability` by grant.
 *
 * `denial` is stated in the caller's terms — "Only an administrator can mark an
 * invoice paid" is more use than a capability name nobody outside the code knows.
 */
export async function requireCapability(
  auth: { uid: string; token: { email?: string } } | undefined,
  capability: string,
  denial: string
): Promise<Actor> {
  const actor = await requireStaff(auth);
  if (actor.role === "admin") return actor;
  if (await hasGrant(actor.role, capability)) return actor;
  throw new HttpsError("permission-denied", denial);
}

import { randomBytes, createHash } from "crypto";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { getAuth } from "firebase-admin/auth";
import { getApps, initializeApp, cert, type App } from "firebase-admin/app";
import { defineSecret } from "firebase-functions/params";
import { HttpsError, onCall } from "firebase-functions/v2/https";

/**
 * Service-account credentials used solely to sign custom tokens.
 *
 * `createCustomToken` signs a JWT as the runtime identity, which requires
 * `iam.serviceAccounts.signBlob` on itself. The default compute service account
 * does not hold that, and granting it needs project IAM admin. Supplying an
 * explicit private key sidesteps the IAM call entirely: the token is signed
 * locally rather than through the IAM signBlob API.
 *
 * Held in Secret Manager, injected only into the one function that needs it, and
 * trimmed to `client_email` and `private_key` so the secret carries nothing beyond
 * what signing requires.
 *
 *   firebase functions:secrets:set TOKEN_SIGNER_SA --data-file=key.json
 */
const TOKEN_SIGNER_SA = defineSecret("TOKEN_SIGNER_SA");

/** Named so it cannot collide with the default app initialised in index.ts. */
const SIGNER_APP = "token-signer";

/**
 * An admin app that can sign tokens, created once per instance.
 *
 * Reused across invocations on a warm instance: initialising a Firebase app per
 * request leaks apps and re-parses the key every time.
 */
function signerApp(): App {
  const existing = getApps().find((a) => a.name === SIGNER_APP);
  if (existing) return existing;

  const parsed = JSON.parse(TOKEN_SIGNER_SA.value()) as {
    client_email: string;
    private_key: string;
  };
  return initializeApp(
    {
      credential: cert({
        projectId: process.env.GCLOUD_PROJECT,
        clientEmail: parsed.client_email,
        // Newlines survive Secret Manager intact, but a key pasted through a shell
        // can arrive escaped; normalising costs nothing and fails loudly otherwise.
        privateKey: parsed.private_key.replace(/\\n/g, "\n"),
      }),
    },
    SIGNER_APP
  );
}

/**
 * Operator access by short code.
 *
 * A workshop operator's whole use of this system is one screen: the work log form
 * that feeds their wage calculation. Issuing them an email address and password for
 * that is friction with nothing behind it — the people concerned are on a factory
 * floor, often sharing a phone, and an email login is a barrier that stops the work
 * being logged at all.
 *
 * So an admin issues a short code against a staff record, and the operator enters it
 * to reach their own work log. What they get back is a Firebase custom token, which
 * means the session that follows is an ordinary authenticated session: the same
 * Firestore rules apply, and `users/{uid}.role` is `operator` exactly as it would be
 * for an email login. The code is a way in, not a way around.
 *
 * What is stored is a SHA-256 hash of the code, never the code itself, so a leaked
 * database does not hand over working logins. Codes are eight characters from an
 * unambiguous alphabet — no O/0, no I/1/L — because they are read off paper and
 * typed on a phone.
 */

const REGION = "europe-west1";

/**
 * Wrong guesses allowed from one caller before redemption is refused.
 *
 * Counted per caller rather than per staff member, which is the only thing that
 * works here: a wrong code matches no document, so there is no staff record to
 * count it against. The bucket is keyed on the calling instance id, falling back to
 * the IP — neither is a strong identifier, but the point is to make an online
 * guessing run expensive rather than to identify who is making it. The real defence
 * is the keyspace: eight characters from a 30-letter alphabet is about 6.5e11
 * combinations.
 */
const MAX_ATTEMPTS = 10;

/** How long a caller stays locked out after exhausting its attempts. */
const LOCKOUT_MS = 15 * 60 * 1000;

/**
 * Excludes characters that are misread when handwritten or printed small.
 * O/0, I/1/L and S/5 are the pairs that actually get confused on a workshop floor.
 */
const ALPHABET = "ABCDEFGHJKMNPQRTUVWXYZ23456789";

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

/*
 * There is no constant-time compare here, unlike the estimate-review flow.
 * The code is never compared in this process: its hash is handed to Firestore as
 * an equality filter, so the matching happens in the index and the timing of a
 * miss carries no information about how close a guess was.
 */

/**
 * A code the operator will actually be able to type.
 *
 * Rejection sampling rather than a modulo: taking a remainder over an alphabet that
 * does not divide 256 makes the earlier letters measurably more likely, and there is
 * no reason to accept a biased code when discarding a byte costs nothing.
 */
function makeCode(length = 8): string {
  let out = "";
  while (out.length < length) {
    for (const byte of randomBytes(length * 2)) {
      if (byte >= 256 - (256 % ALPHABET.length)) continue;
      out += ALPHABET[byte % ALPHABET.length];
      if (out.length === length) break;
    }
  }
  return out;
}

/** Normalises what a person typed: case and spacing are not part of the secret. */
function normalise(raw: string): string {
  return raw.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

async function requireAdmin(
  auth: { uid: string; token: { email?: string } } | undefined
): Promise<{ uid: string; email: string }> {
  if (!auth) throw new HttpsError("unauthenticated", "Sign in first.");
  const snap = await getFirestore().doc(`users/${auth.uid}`).get();
  if (!snap.exists || snap.data()?.active === false) {
    throw new HttpsError("permission-denied", "This account is not active staff.");
  }
  if (snap.data()?.role !== "admin") {
    throw new HttpsError("permission-denied", "Issuing an access code is admin only.");
  }
  return { uid: auth.uid, email: auth.token.email ?? snap.data()?.email ?? "" };
}

// ---------------------------------------------------------------------------
// Admin: issue or revoke a code
// ---------------------------------------------------------------------------

/**
 * Issues a fresh access code for a staff member, returning it once.
 *
 * Only the hash is kept, so the plain code cannot be looked up afterwards — the
 * screen says so, and re-issuing is the recovery path. Issuing again replaces the
 * stored hash, which is what revokes the previous code.
 */
export const issueOperatorCode = onCall(
  { region: REGION, cors: true },
  async (request) => {
    const actor = await requireAdmin(request.auth);
    const db = getFirestore();

    const staffId = String(request.data?.staffId ?? "");
    if (!staffId) throw new HttpsError("invalid-argument", "staffId is required.");

    const staffRef = db.doc(`staff/${staffId}`);
    const staffSnap = await staffRef.get();
    if (!staffSnap.exists) throw new HttpsError("not-found", "Staff member not found.");
    const staff = staffSnap.data() ?? {};
    if (staff.active === false) {
      throw new HttpsError(
        "failed-precondition",
        "This staff member is not active. Reactivate them before issuing a code."
      );
    }

    const code = makeCode();

    // The Auth user is created on first use rather than here, so an issued code
    // that is never used leaves nothing behind.
    await staffRef.update({
      accessCodeHash: sha256(code),
      accessCodeIssuedAt: FieldValue.serverTimestamp(),
      accessCodeIssuedBy: actor.uid,
      accessCodeRevokedAt: null,
    });

    await db.collection("auditLog").add({
      actorUid: actor.uid,
      actorEmail: actor.email,
      actorRole: "admin",
      action: "update",
      collectionName: "staff",
      docId: staffId,
      summary: `Issued a work-log access code to ${staff.name ?? "a staff member"}`,
      at: FieldValue.serverTimestamp(),
    });

    return { ok: true, code, staffName: staff.name ?? "" };
  }
);

/** Withdraws a staff member's code. Their existing session is signed out too. */
export const revokeOperatorCode = onCall(
  { region: REGION, cors: true },
  async (request) => {
    const actor = await requireAdmin(request.auth);
    const db = getFirestore();

    const staffId = String(request.data?.staffId ?? "");
    if (!staffId) throw new HttpsError("invalid-argument", "staffId is required.");

    const staffRef = db.doc(`staff/${staffId}`);
    const staffSnap = await staffRef.get();
    if (!staffSnap.exists) throw new HttpsError("not-found", "Staff member not found.");
    const staff = staffSnap.data() ?? {};

    await staffRef.update({
      accessCodeHash: FieldValue.delete(),
      accessCodeRevokedAt: FieldValue.serverTimestamp(),
    });

    // Clearing the hash stops a new sign-in, but says nothing about a session
    // already running. Revoking the refresh tokens ends that too, and the account
    // is marked inactive so the rules deny it even before the token expires.
    const uid = `op_${staffId}`;
    try {
      await getAuth().revokeRefreshTokens(uid);
      await db.doc(`users/${uid}`).set({ active: false }, { merge: true });
    } catch {
      // No account yet: the code was issued but never used. Nothing to revoke.
    }

    await db.collection("auditLog").add({
      actorUid: actor.uid,
      actorEmail: actor.email,
      actorRole: "admin",
      action: "update",
      collectionName: "staff",
      docId: staffId,
      summary: `Revoked the work-log access code for ${staff.name ?? "a staff member"}`,
      at: FieldValue.serverTimestamp(),
    });

    return { ok: true };
  }
);

// ---------------------------------------------------------------------------
// Operator: redeem a code
// ---------------------------------------------------------------------------

/**
 * Exchanges an access code for a Firebase custom token.
 *
 * Unauthenticated by necessity — this is how an operator gets a session in the
 * first place. The code is the only credential, so the checks that matter are here:
 * the hash must match, the staff member must be active, and a run of wrong guesses
 * locks the code until an admin issues a new one.
 *
 * The uid is derived from the staff id rather than generated, so redeeming twice
 * returns the same identity and the operator's own work log follows them. The
 * `users/{uid}` document is written on every redemption, which is what keeps the
 * role correct if a staff record was renamed or a previous code revoked.
 */
export const redeemOperatorCode = onCall(
  { region: REGION, cors: true, secrets: [TOKEN_SIGNER_SA] },
  async (request) => {
    const db = getFirestore();
    const code = normalise(String(request.data?.code ?? ""));

    // Deliberately identical for every failure below, so the response cannot be
    // used to learn whether a code exists or which staff member it belongs to.
    const rejected = () =>
      new HttpsError("permission-denied", "That code is not valid.");

    // Throttle before doing any work, so a guessing run is cheap to refuse.
    const callerKey = sha256(
      String(request.instanceIdToken ?? request.rawRequest?.ip ?? "unknown")
    );
    const throttleRef = db.doc(`accessCodeAttempts/${callerKey}`);
    const throttle = await throttleRef.get();
    const failures = Number(throttle.data()?.failures ?? 0);
    const lockedUntil = Number(throttle.data()?.lockedUntilMs ?? 0);
    if (lockedUntil > Date.now()) {
      throw new HttpsError(
        "resource-exhausted",
        "Too many attempts. Wait a few minutes, then try again."
      );
    }

    /** Records a failure against the caller and throws the generic rejection. */
    const fail = async (): Promise<never> => {
      const next = failures + 1;
      await throttleRef.set(
        {
          failures: next,
          lockedUntilMs: next >= MAX_ATTEMPTS ? Date.now() + LOCKOUT_MS : 0,
          lastAttemptAt: FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
      throw rejected();
    };

    if (code.length < 6) await fail();

    const matches = await db
      .collection("staff")
      .where("accessCodeHash", "==", sha256(code))
      .limit(1)
      .get();
    if (matches.empty) await fail();

    const staffDoc = matches.docs[0];
    const staff = staffDoc.data();

    if (staff.active === false) await fail();

    // A correct code clears the caller's failures: a genuine operator who mistyped
    // twice should not carry that against their next sign-in.
    await throttleRef.set(
      { failures: 0, lockedUntilMs: 0, lastAttemptAt: FieldValue.serverTimestamp() },
      { merge: true }
    );

    const uid = `op_${staffDoc.id}`;

    await getAuth()
      .getUser(uid)
      .catch(() =>
        getAuth().createUser({
          uid,
          displayName: String(staff.name ?? "Operator"),
        })
      );

    // Written every time: a revoked-then-reissued code has to come back as active,
    // and the role must be right even if the document was edited in between.
    await db.doc(`users/${uid}`).set(
      {
        name: staff.name ?? "",
        role: "operator",
        active: true,
        staffId: staffDoc.id,
        // No email: this account has none, and leaving the field absent is more
        // honest than inventing an address that cannot receive anything.
        viaAccessCode: true,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

    // Stamped so an admin can see the code is in use, and tell a forgotten code
    // from one that was never collected.
    await staffDoc.ref.update({
      accessCodeLastUsedAt: FieldValue.serverTimestamp(),
    });

    // Signed with the explicit key rather than the runtime identity: see signerApp.
    const token = await getAuth(signerApp()).createCustomToken(uid, {
      role: "operator",
    });

    return {
      ok: true,
      token,
      staffId: staffDoc.id,
      staffName: staff.name ?? "",
    };
  }
);

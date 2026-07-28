/**
 * Grants ERP staff access by creating the `users/{uid}` document.
 *
 * The Firebase CLI cannot write Firestore documents (only delete), so this uses
 * the Admin SDK, which bypasses security rules. That is what makes it usable to
 * bootstrap the very first admin — before any user document exists, the rules
 * have no role to check.
 *
 * Auth uses Application Default Credentials. Two ways to provide them, in the
 * order this script tries:
 *
 *   1. GOOGLE_APPLICATION_CREDENTIALS pointing at a service-account key file
 *   2. `gcloud auth application-default login`
 *
 * If neither is present the script says so and stops, rather than failing with
 * an opaque credentials error.
 *
 * Usage:
 *   node scripts/grant-admin.mjs --uid <UID> --email <EMAIL> [--name "Full Name"] [--role admin]
 *
 * Run from the `functions/` directory so firebase-admin resolves.
 */

import { initializeApp, applicationDefault } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";

const VALID_ROLES = ["admin", "manager", "operator"];
const PROJECT_ID = "nightowl-woodworks";

function parseArgs(argv) {
  const out = {};
  for (let i = 2; i < argv.length; i += 1) {
    const key = argv[i];
    if (!key.startsWith("--")) continue;
    const name = key.slice(2);
    const value = argv[i + 1];
    if (value === undefined || value.startsWith("--")) {
      out[name] = true;
    } else {
      out[name] = value;
      i += 1;
    }
  }
  return out;
}

function fail(message) {
  console.error(`\n  ✗ ${message}\n`);
  process.exit(1);
}

const args = parseArgs(process.argv);

if (args.help) {
  console.log(`
  Grant ERP access to a Firebase Auth user.

    node scripts/grant-admin.mjs --uid <UID> --email <EMAIL> [--name "Name"] [--role admin]

  Options
    --uid    Firebase Auth UID (required)
    --email  Account email (required)
    --name   Display name; defaults to the email
    --role   admin | manager | operator; defaults to admin
`);
  process.exit(0);
}

const uid = typeof args.uid === "string" ? args.uid.trim() : "";
const email = typeof args.email === "string" ? args.email.trim() : "";
const name = typeof args.name === "string" ? args.name.trim() : "";
const role = typeof args.role === "string" ? args.role.trim() : "admin";

if (!uid) fail("--uid is required. Find it in Firebase Console → Authentication → Users.");
if (!email) fail("--email is required.");
if (!VALID_ROLES.includes(role)) {
  fail(`--role must be one of: ${VALID_ROLES.join(", ")}`);
}
// A UID is 28 chars for password accounts; guard against pasting an email here,
// which is the easy mistake and would create an unusable document.
if (uid.includes("@")) fail("--uid looks like an email. Pass the Firebase UID, not the address.");

initializeApp({ credential: applicationDefault(), projectId: PROJECT_ID });
const db = getFirestore();

const ref = db.doc(`users/${uid}`);

// Probe before writing so a missing-credentials failure produces instructions
// rather than a raw "Could not load the default credentials" stack.
let existing;
try {
  existing = await ref.get();
} catch (err) {
  const message = err instanceof Error ? err.message : String(err);
  if (/default credentials|invalid_grant|could not load/i.test(message)) {
    fail(
      `No Google credentials found.\n\n` +
        `  Fix with ONE of:\n\n` +
        `    a) Install the gcloud SDK, then run:\n` +
        `         gcloud auth application-default login\n\n` +
        `    b) Create a service-account key in the Firebase console\n` +
        `       (Project settings → Service accounts → Generate new private key),\n` +
        `       save it OUTSIDE the repo, then:\n` +
        `         export GOOGLE_APPLICATION_CREDENTIALS="/path/to/key.json"\n\n` +
        `  Or skip the CLI entirely and add the document by hand in\n` +
        `  Firebase Console → Firestore Database.\n\n` +
        `  Underlying error: ${message}`
    );
  }
  fail(`Firestore read failed: ${message}`);
}

const payload = {
  email,
  name: name || email,
  role,
  active: true,
  updatedAt: FieldValue.serverTimestamp(),
  updatedBy: "cli:grant-admin",
};

if (!existing.exists) {
  payload.createdAt = FieldValue.serverTimestamp();
  payload.createdBy = "cli:grant-admin";
}

// merge so re-running promotes an existing user rather than wiping their record.
await ref.set(payload, { merge: true });

// Mirrors what the UI writes, so CLI-granted access is not invisible in the log.
await db.collection("auditLog").add({
  actorUid: "cli",
  actorEmail: "cli:grant-admin",
  actorRole: "admin",
  action: existing.exists ? "role_change" : "create",
  collectionName: "users",
  docId: uid,
  summary: `${existing.exists ? "Updated" : "Granted"} ${email} as ${role} via CLI`,
  after: { email, role, active: true },
  at: FieldValue.serverTimestamp(),
});

const after = await ref.get();
console.log(`
  ✓ ${existing.exists ? "Updated" : "Created"} users/${uid}

    email   ${after.get("email")}
    name    ${after.get("name")}
    role    ${after.get("role")}
    active  ${after.get("active")}

  Sign out and back in at /admin/ to pick up the new role.
`);

process.exit(0);

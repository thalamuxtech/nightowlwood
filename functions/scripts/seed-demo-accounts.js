/**
 * Creates the demo staff accounts the login screen offers as one-click fills.
 *
 * The admin account already existed; manager and operator did not, so there was no
 * way to see what those roles actually get. The three `zz_test_*` uids in Auth are
 * rules-test fixtures with no email or password and are left alone.
 *
 * Each account gets an Auth user and the matching `users/{uid}` document, because
 * the role lives in Firestore and the shell holds `ready` false until that document
 * resolves — an Auth user without one signs in to a "no role assigned" notice.
 *
 * Passwords are deliberately weak and published on the login screen. These are
 * demo accounts on demo data, and the point is that anyone reviewing the portal can
 * get in. Do not add real staff this way.
 *
 *   GOOGLE_APPLICATION_CREDENTIALS=... node scripts/seed-demo-accounts.js [--apply]
 */

const admin = require("firebase-admin");

const APPLY = process.argv.includes("--apply");

admin.initializeApp();
const auth = admin.auth();
const db = admin.firestore();

const ACCOUNTS = [
  {
    // A separate account rather than the real admin@nightowl.com.ng, whose
    // password is the owner's and is not published anywhere.
    uid: "demo_admin",
    email: "demo-admin@nightowl.com.ng",
    password: "NightowlDemo!2026",
    name: "Demo Admin",
    role: "admin",
    phone: "+234 800 000 0001",
  },
  {
    uid: "demo_manager",
    email: "manager@nightowl.com.ng",
    password: "NightowlDemo!2026",
    name: "Demo Manager",
    role: "manager",
    phone: "+234 800 000 0002",
  },
  {
    uid: "demo_operator",
    email: "operator@nightowl.com.ng",
    password: "NightowlDemo!2026",
    name: "Demo Operator",
    role: "operator",
    phone: "+234 800 000 0003",
  },
];

(async () => {
  console.log(APPLY ? "APPLYING\n" : "DRY RUN (pass --apply)\n");

  for (const a of ACCOUNTS) {
    let existing = null;
    try {
      existing = await auth.getUser(a.uid);
    } catch {
      // Not found; created below.
    }

    if (!APPLY) {
      console.log(
        `${a.role.padEnd(9)} ${a.email}  ${existing ? "(auth exists, would reset password)" : "(would create)"}`
      );
      continue;
    }

    if (existing) {
      await auth.updateUser(a.uid, {
        email: a.email,
        password: a.password,
        displayName: a.name,
        emailVerified: true,
        disabled: false,
      });
    } else {
      await auth.createUser({
        uid: a.uid,
        email: a.email,
        password: a.password,
        displayName: a.name,
        emailVerified: true,
      });
    }

    /*
     * An operator is linked to a staff record.
     *
     * The work-log rules match on `resource.data.staffId == myStaffId()`, reading
     * `staffId` off the user document — so an operator without one can create a
     * log but never read one back, and their own screen comes up empty with a
     * permission error. Linking the demo account to a real staff member is what
     * makes the operator portal actually usable.
     */
    let staffId;
    if (a.role === "operator") {
      const staff = await db
        .collection("staff")
        .where("active", "==", true)
        .limit(1)
        .get();
      staffId = staff.empty ? undefined : staff.docs[0].id;
      if (!staffId) console.log("  (no active staff to link the operator to)");
    }

    // The role document is what the admin shell actually reads.
    await db.doc(`users/${a.uid}`).set(
      {
        email: a.email,
        name: a.name,
        role: a.role,
        phone: a.phone,
        active: true,
        demo: true,
        ...(staffId ? { staffId } : {}),
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

    console.log(`${a.role.padEnd(9)} ${a.email}  ready`);
  }

  console.log(APPLY ? "\nDone." : "\nDry run complete.");
})().catch((e) => {
  console.error("FAILED:", e);
  process.exit(1);
});

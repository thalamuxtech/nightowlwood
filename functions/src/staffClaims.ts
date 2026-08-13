import { getAuth } from "firebase-admin/auth";
import { onDocumentWritten } from "firebase-functions/v2/firestore";

/**
 * Mirrors staff status onto the auth token as a custom claim.
 *
 * Firebase **Storage** rules cannot read Firestore. That is the whole reason this exists: every
 * other rule in this system decides authority by reading `users/{uid}`, and Storage is the one
 * place that cannot. Its rules previously fell back to "any signed-in user", which on a project
 * with public signup enabled meant a stranger who registered an account could overwrite the images
 * on the live public website and read customers' cutting lists.
 *
 * A custom claim is the one thing Storage rules *can* see. So the claim becomes the mirror of the
 * user document, maintained by this trigger rather than set by hand — a claim somebody has to
 * remember to apply is one that drifts from the record it is supposed to reflect.
 *
 * ## What is mirrored
 *
 * `staff: true` when the user document exists, is active, and carries a role. Nothing finer: this
 * is a coarse "is on the payroll" gate, and the fine-grained capability checks stay in Firestore
 * where they can be read properly. Encoding capabilities in a token would mean a permission change
 * did not take effect until the user signed in again.
 *
 * ## The propagation delay
 *
 * A custom claim reaches the client on the next ID-token refresh — up to an hour, or immediately on
 * `getIdToken(true)`. So a newly created staff member may not be able to upload for a few minutes.
 * That is acceptable for uploads and would not be for reads of business data, which is another
 * reason the claim carries only this one coarse fact.
 */
const REGION = "europe-west1";

export const syncStaffClaim = onDocumentWritten(
  { document: "users/{uid}", region: REGION },
  async (event) => {
    const uid = event.params.uid;
    const after = event.data?.after?.data();

    /*
     * Staff means: the document is there, active, and has a role.
     *
     * A deleted document, `active: false`, or a missing role all revoke the claim — which is what
     * makes deactivating somebody in the users screen actually stop them uploading, rather than
     * merely hiding the screens from them.
     */
    const isStaff =
      after !== undefined &&
      after.active !== false &&
      typeof after.role === "string" &&
      after.role.length > 0;

    try {
      const user = await getAuth().getUser(uid);
      const existing = (user.customClaims ?? {}) as { staff?: boolean };

      // Nothing to do when it already says the right thing. Avoids rewriting a token on every
      // unrelated edit to the user document, each of which would otherwise invalidate sessions.
      if (existing.staff === isStaff) return;

      await getAuth().setCustomUserClaims(uid, { ...existing, staff: isStaff });
      console.log(`staff claim for ${uid} set to ${isStaff}`);
    } catch (err) {
      /*
       * Never rethrown.
       *
       * A user document can exist for a uid with no auth account — a record created ahead of the
       * person signing up, or one left behind after an account was deleted. `getUser` throws
       * `auth/user-not-found` for those, which is expected rather than exceptional. Retrying would
       * spin forever on a document that will never have an account.
       */
      const code = (err as { code?: string }).code;
      if (code === "auth/user-not-found") return;
      console.error(`Could not sync the staff claim for ${uid}`, err);
    }
  }
);

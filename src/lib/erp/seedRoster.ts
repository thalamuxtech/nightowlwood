import {
  collection,
  getDocs,
  query,
  where,
  type Firestore,
} from "firebase/firestore";
import { COL } from "./collections";
import { toKobo } from "./money";
import { createStaff, updateStaff, type StaffInput } from "./hr";
import { createFixedCost, DEFAULT_FIXED_COSTS, loadFixedCosts } from "./fixedCosts";
import type { AuditActor } from "./audit";

/**
 * The workshop's actual roster and standing costs, as confirmed.
 *
 * Seeded through the same client path the app uses rather than as an admin script, so it
 * runs under the caller's own permissions and writes the same audit entries any manual
 * entry would. A script bypassing the rules could create records the rules would have
 * refused, and nothing would show who did it.
 *
 * **Idempotent by name.** Re-running updates the person rather than creating a second
 * "Bashir Usman", because the realistic failure here is running it twice and ending up
 * paying somebody twice. Matching on name is imperfect — two people can share one — but it
 * is what the source list gives, and a duplicate is caught on the next run rather than
 * compounding.
 */

/** Nicknames are how the floor refers to people, so the work log shows them. */
const ROSTER: StaffInput[] = [
  // --- Salaried ---
  {
    name: "Ibrahim Muhammad Adam",
    role: "manager",
    jobTitle: "Manager / Accountant",
    employmentType: "salary",
    monthlySalaryKobo: toKobo(80_000),
  },
  {
    name: "Adamu Musa Fari",
    role: "security",
    jobTitle: "Security / Janitor",
    employmentType: "salary",
    /*
     * ₦45,000: two roles, one person, one payslip.
     *
     * He is paid ₦25,000 as security and ₦20,000 as janitor. The salary run pays a person
     * rather than a post, so the combined figure is what belongs on the record — splitting
     * it across two staff entries would pay one man twice and count him twice in the
     * headcount. The split is kept in the notes so it can still be explained.
     */
    monthlySalaryKobo: toKobo(45_000),
    notes:
      "Combined role: ₦25,000 security + ₦20,000 janitor = ₦45,000 monthly.",
  },
  {
    name: "Muazu Abdullahi",
    role: "janitor",
    jobTitle: "Janitor",
    employmentType: "salary",
    monthlySalaryKobo: toKobo(10_000),
  },

  // --- Piece-rate operators ---
  {
    name: "Bashir Usman",
    nickname: "Bash",
    role: "edging_operator",
    jobTitle: "Edging Operator",
    employmentType: "wage",
    isOperator: true,
  },
  {
    name: "Abubakar Ibrahim",
    nickname: "Mal Habu",
    role: "cutting_operator",
    jobTitle: "Cutting Operator",
    employmentType: "wage",
    isOperator: true,
  },

  // --- Piece-rate assistants ---
  {
    name: "Usman Ibrahim",
    nickname: "Halifa",
    role: "assistant_operator",
    jobTitle: "Assistant Operator",
    employmentType: "wage",
    isAssistant: true,
  },
  {
    name: "Abdulmalik Hamisu",
    nickname: "Abdul",
    role: "assistant_operator",
    jobTitle: "Assistant Operator",
    employmentType: "wage",
    isAssistant: true,
  },
  {
    name: "Salim Sulaiman",
    role: "assistant_operator",
    jobTitle: "Assistant Operator",
    employmentType: "wage",
    isAssistant: true,
  },
  {
    name: "Dalhatu Ibrahim",
    nickname: "Saeed",
    role: "assistant_operator",
    jobTitle: "Assistant Operator",
    employmentType: "wage",
    isAssistant: true,
  },
  {
    name: "Lawal Bilyaminu",
    role: "assistant_operator",
    jobTitle: "Assistant Operator",
    employmentType: "wage",
    isAssistant: true,
  },
];

export interface SeedResult {
  staffCreated: number;
  staffUpdated: number;
  fixedCostsCreated: number;
  fixedCostsSkipped: number;
  notes: string[];
}

/**
 * Creates the roster and the standing fixed costs.
 *
 * Sequential rather than batched, deliberately: each `createStaff` writes its own audit
 * entry, and a batch would produce one write with eleven people in it and no per-person
 * trail. Eleven round trips for a one-off setup is not worth optimising away.
 */
export async function seedRoster(
  db: Firestore,
  actor: AuditActor
): Promise<SeedResult> {
  const result: SeedResult = {
    staffCreated: 0,
    staffUpdated: 0,
    fixedCostsCreated: 0,
    fixedCostsSkipped: 0,
    notes: [],
  };

  // --- Staff ---------------------------------------------------------------

  for (const person of ROSTER) {
    // Matched on name so a second run updates rather than duplicating. The query is
    // per-person rather than one read of the whole collection, because the collection may
    // already hold staff this seed does not know about.
    const existing = await getDocs(
      query(collection(db, COL.staff), where("name", "==", person.name))
    );

    if (existing.empty) {
      await createStaff(db, actor, person);
      result.staffCreated += 1;
    } else {
      /*
       * Updating an existing record preserves what is already there.
       *
       * Only the fields this seed actually knows are written: somebody may have added a
       * phone number, an address or a next of kin since, and a blind overwrite from a list
       * that has none of those would erase real information.
       */
      const current = existing.docs[0];
      const prev = current.data();
      await updateStaff(db, actor, current.id, {
        ...person,
        phone: prev.phone ?? person.phone,
        address: prev.address ?? person.address,
        staffNumber: prev.staffNumber ?? person.staffNumber,
        idNumber: prev.idNumber ?? person.idNumber,
        nextOfKinName: prev.nextOfKinName ?? person.nextOfKinName,
        nextOfKinPhone: prev.nextOfKinPhone ?? person.nextOfKinPhone,
        nextOfKinRelationship:
          prev.nextOfKinRelationship ?? person.nextOfKinRelationship,
        bankName: prev.bankName ?? person.bankName,
        bankAccount: prev.bankAccount ?? person.bankAccount,
        photoUrl: prev.photoUrl ?? person.photoUrl,
        hiredAt: prev.hiredAt?.toDate?.() ?? person.hiredAt,
        // A salary someone has since changed is not reverted to the seeded figure.
        monthlySalaryKobo:
          prev.monthlySalaryKobo ?? person.monthlySalaryKobo,
        notes: prev.notes ?? person.notes,
      });
      result.staffUpdated += 1;
    }
  }

  // --- Fixed costs ---------------------------------------------------------

  const existingCosts = await loadFixedCosts(db, true);
  const haveByName = new Set(
    existingCosts.map((c) => c.name.trim().toLowerCase())
  );

  for (const cost of DEFAULT_FIXED_COSTS) {
    if (haveByName.has(cost.name.trim().toLowerCase())) {
      result.fixedCostsSkipped += 1;
      continue;
    }
    await createFixedCost(db, actor, cost);
    result.fixedCostsCreated += 1;
  }

  result.notes.push(
    "Piece-rate operators and assistants have no salary figure — they are paid from the work log at the rates under Piece Rates.",
    "Adamu Musa Fari is on ₦45,000: ₦25,000 security plus ₦20,000 janitor, paid as one person on one payslip.",
    "Gum (₦65,000/bag), blades (₦145,000/set), diesel and maintenance are variable costs — recorded as expenses when bought, not as fixed commitments."
  );

  return result;
}

import {
  addDoc,
  collection,
  doc,
  getDoc,
  serverTimestamp,
  updateDoc,
  type Firestore,
} from "firebase/firestore";
import { COL } from "./collections";
import { writeAudit, type AuditActor } from "./audit";

/**
 * Customers and staff.
 *
 * Both were created inline from their pickers with a raw addDoc and no edit path
 * at all, which meant a misspelled name or a wrong phone number was permanent. A
 * customer record is referenced by every job and invoice raised for them, so it is
 * exactly the kind of record that has to stay correctable.
 *
 * Neither is deletable. A customer with history and a member of staff who appears
 * in past wage runs cannot be removed without orphaning those records, so both use
 * an `active` flag: inactive entries drop out of the pickers and keep their history.
 */

export interface CustomerInput {
  name: string;
  phone?: string;
  email?: string;
  address?: string;
  isServiceCustomer?: boolean;
  isProductClient?: boolean;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function validateCustomer(input: CustomerInput): void {
  if (!input.name.trim()) throw new Error("A customer needs a name.");
  if (input.email?.trim() && !EMAIL.test(input.email.trim())) {
    throw new Error("That email address does not look right.");
  }
}

export async function createCustomer(
  db: Firestore,
  actor: AuditActor,
  input: CustomerInput
): Promise<string> {
  validateCustomer(input);

  const ref = await addDoc(collection(db, COL.customers), {
    name: input.name.trim(),
    phone: input.phone?.trim() || null,
    email: input.email?.trim() || null,
    address: input.address?.trim() || null,
    isServiceCustomer: input.isServiceCustomer ?? true,
    isProductClient: input.isProductClient ?? false,
    active: true,
    createdAt: serverTimestamp(),
    createdBy: actor.uid,
  });

  await writeAudit(db, {
    actor,
    action: "create",
    collectionName: COL.customers,
    docId: ref.id,
    summary: `Added customer ${input.name.trim()}`,
    after: { name: input.name.trim() },
  });

  return ref.id;
}

/**
 * Corrects a customer record.
 *
 * Jobs and invoices hold a name-and-phone snapshot taken at the time they were
 * raised, and that is intentional: a document already sent to someone should not
 * silently change afterwards. Editing here fixes the record used from now on.
 */
export async function updateCustomer(
  db: Firestore,
  actor: AuditActor,
  customerId: string,
  input: CustomerInput
): Promise<void> {
  validateCustomer(input);

  const ref = doc(db, COL.customers, customerId);
  const snap = await getDoc(ref);
  if (!snap.exists()) throw new Error("That customer no longer exists.");
  const prev = snap.data();

  await updateDoc(ref, {
    name: input.name.trim(),
    phone: input.phone?.trim() || null,
    email: input.email?.trim() || null,
    address: input.address?.trim() || null,
    ...(input.isServiceCustomer === undefined
      ? {}
      : { isServiceCustomer: input.isServiceCustomer }),
    ...(input.isProductClient === undefined
      ? {}
      : { isProductClient: input.isProductClient }),
    updatedAt: serverTimestamp(),
    updatedBy: actor.uid,
  });

  await writeAudit(db, {
    actor,
    action: "update",
    collectionName: COL.customers,
    docId: customerId,
    summary: `Edited customer ${prev.name ?? ""}`,
    before: { name: prev.name ?? "", phone: prev.phone ?? null, email: prev.email ?? null },
    after: {
      name: input.name.trim(),
      phone: input.phone?.trim() || null,
      email: input.email?.trim() || null,
    },
  });
}

export async function setCustomerActive(
  db: Firestore,
  actor: AuditActor,
  customerId: string,
  active: boolean,
  name: string
): Promise<void> {
  await updateDoc(doc(db, COL.customers, customerId), {
    active,
    updatedAt: serverTimestamp(),
    updatedBy: actor.uid,
  });
  await writeAudit(db, {
    actor,
    action: "update",
    collectionName: COL.customers,
    docId: customerId,
    summary: `${active ? "Restored" : "Archived"} customer ${name}`,
    after: { active },
  });
}

export interface StaffInput {
  name: string;
  phone?: string;
  jobTitle?: string;
  isOperator?: boolean;
  isAssistant?: boolean;
}

function validateStaff(input: StaffInput): void {
  if (!input.name.trim()) throw new Error("A staff member needs a name.");
  // Someone who is neither cannot be selected anywhere, so the record would be
  // created and then be invisible, which reads as the save having failed.
  if (input.isOperator === false && input.isAssistant === false) {
    throw new Error("Mark them as an operator, an assistant, or both.");
  }
}

export async function createStaff(
  db: Firestore,
  actor: AuditActor,
  input: StaffInput
): Promise<string> {
  validateStaff(input);

  const ref = await addDoc(collection(db, COL.staff), {
    name: input.name.trim(),
    phone: input.phone?.trim() || null,
    jobTitle: input.jobTitle?.trim() || null,
    isOperator: input.isOperator ?? true,
    isAssistant: input.isAssistant ?? true,
    active: true,
    createdAt: serverTimestamp(),
    createdBy: actor.uid,
  });

  await writeAudit(db, {
    actor,
    action: "create",
    collectionName: COL.staff,
    docId: ref.id,
    summary: `Added staff member ${input.name.trim()}`,
    after: { name: input.name.trim() },
  });

  return ref.id;
}

/**
 * Corrects a staff record.
 *
 * Work logs and wage runs store the name they were recorded against, so fixing a
 * spelling here does not rewrite what has already been paid. That is deliberate:
 * a payslip already handed over should still match the record behind it.
 */
export async function updateStaff(
  db: Firestore,
  actor: AuditActor,
  staffId: string,
  input: StaffInput
): Promise<void> {
  validateStaff(input);

  const ref = doc(db, COL.staff, staffId);
  const snap = await getDoc(ref);
  if (!snap.exists()) throw new Error("That staff member no longer exists.");
  const prev = snap.data();

  await updateDoc(ref, {
    name: input.name.trim(),
    phone: input.phone?.trim() || null,
    jobTitle: input.jobTitle?.trim() || null,
    ...(input.isOperator === undefined ? {} : { isOperator: input.isOperator }),
    ...(input.isAssistant === undefined ? {} : { isAssistant: input.isAssistant }),
    updatedAt: serverTimestamp(),
    updatedBy: actor.uid,
  });

  await writeAudit(db, {
    actor,
    action: "update",
    collectionName: COL.staff,
    docId: staffId,
    summary: `Edited staff member ${prev.name ?? ""}`,
    before: { name: prev.name ?? "", phone: prev.phone ?? null },
    after: { name: input.name.trim(), phone: input.phone?.trim() || null },
  });
}

/**
 * Marks someone as no longer working here.
 *
 * The alternative, deleting them, would orphan every work log and wage run that
 * names them. A leaver simply stops appearing in the pickers.
 */
export async function setStaffActive(
  db: Firestore,
  actor: AuditActor,
  staffId: string,
  active: boolean,
  name: string
): Promise<void> {
  await updateDoc(doc(db, COL.staff, staffId), {
    active,
    updatedAt: serverTimestamp(),
    updatedBy: actor.uid,
  });
  await writeAudit(db, {
    actor,
    action: "update",
    collectionName: COL.staff,
    docId: staffId,
    summary: `${active ? "Reinstated" : "Marked as left"}: ${name}`,
    after: { active },
  });
}

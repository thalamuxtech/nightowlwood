import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  query,
  runTransaction,
  serverTimestamp,
  Timestamp,
  updateDoc,
  where,
  writeBatch,
  type Firestore,
} from "firebase/firestore";
import { COL, COUNTER, componentsPath, estimateLinesPath, featuresPath } from "./collections";
import type { ProductCategory, ProjectStatus } from "./enums";
import { applyPercentKobo, lineAmountKobo, sumKobo } from "./money";
import { allocateDocNumber } from "./numbering";
import { ESTIMATE_TEMPLATES } from "./estimateTemplates";
import { writeAudit, type AuditActor } from "./audit";

/**
 * Projects, components, features and estimates.
 *
 * The hierarchy is project > component > feature. A component is a physical
 * deliverable ("Main kitchen"), a feature is a priced line within it. Estimate
 * totals roll upward, and each level stores its own subtotal so a list view does
 * not have to read every descendant.
 */

export interface NewProjectInput {
  customerId: string;
  customerName: string;
  title: string;
  location?: string;
  targetDate?: Date;
  notes?: string;
}

export async function createProject(
  db: Firestore,
  actor: AuditActor,
  input: NewProjectInput
): Promise<{ projectId: string; projectNumber: string }> {
  const { formatted: projectNumber } = await allocateDocNumber(db, COUNTER.project);
  const ref = doc(collection(db, COL.projects));

  const batch = writeBatch(db);
  batch.set(ref, {
    projectNumber,
    customerId: input.customerId,
    customerName: input.customerName,
    title: input.title,
    location: input.location ?? null,
    status: "enquiry" satisfies ProjectStatus,
    startDate: serverTimestamp(),
    targetDate: input.targetDate ? Timestamp.fromDate(input.targetDate) : null,
    estimatedCostKobo: 0,
    actualCostKobo: 0,
    notes: input.notes ?? null,
    createdAt: serverTimestamp(),
    createdBy: actor.uid,
  });
  await batch.commit();

  await writeAudit(db, {
    actor,
    action: "create",
    collectionName: COL.projects,
    docId: ref.id,
    summary: `Created ${projectNumber}: ${input.title} for ${input.customerName}`,
    after: { projectNumber, title: input.title },
  });

  return { projectId: ref.id, projectNumber };
}

/**
 * Corrects a project's details.
 *
 * The project number is deliberately not editable: it is the reference quoted on
 * estimates, invoices and to the client, so renumbering after the fact would break
 * every document that already cites it. Everything a person types by hand is.
 *
 * Costs are excluded too. They are derived from the priced features beneath the
 * project, and letting them be typed over would put the header out of step with
 * the lines that justify it.
 */
export async function updateProjectDetails(
  db: Firestore,
  actor: AuditActor,
  projectId: string,
  input: {
    title: string;
    customerId: string;
    customerName: string;
    location?: string;
    targetDate?: Date | null;
    notes?: string;
  }
): Promise<void> {
  if (!input.title.trim()) throw new Error("A project needs a title.");
  if (!input.customerName.trim()) throw new Error("A project needs a client.");

  const ref = doc(db, COL.projects, projectId);
  const snap = await getDoc(ref);
  if (!snap.exists()) throw new Error("Project not found.");
  const prev = snap.data();

  await updateDoc(ref, {
    title: input.title.trim(),
    customerId: input.customerId,
    customerName: input.customerName.trim(),
    location: input.location?.trim() || null,
    targetDate: input.targetDate ? Timestamp.fromDate(input.targetDate) : null,
    notes: input.notes?.trim() || null,
    updatedAt: serverTimestamp(),
    updatedBy: actor.uid,
  });

  await writeAudit(db, {
    actor,
    action: "update",
    collectionName: COL.projects,
    docId: projectId,
    summary: `Edited ${prev.projectNumber ?? "project"}: ${input.title.trim()}`,
    before: { title: prev.title ?? "", customerName: prev.customerName ?? "" },
    after: { title: input.title.trim(), customerName: input.customerName.trim() },
  });
}

/**
 * Renames a component, or moves it in the ordering.
 *
 * The category is fixed after creation because it selected the template that
 * generated the feature rows; changing it would leave a closet's line items under
 * a component labelled as a kitchen. A component in the wrong category has to be
 * recreated, which is what removeComponent is for.
 */
export async function updateComponent(
  db: Firestore,
  actor: AuditActor,
  projectId: string,
  componentId: string,
  input: { name: string; order?: number }
): Promise<void> {
  if (!input.name.trim()) throw new Error("A component needs a name.");

  const ref = doc(db, `${componentsPath(projectId)}/${componentId}`);
  const snap = await getDoc(ref);
  if (!snap.exists()) throw new Error("That component no longer exists.");
  const prev = snap.data();

  await updateDoc(ref, {
    name: input.name.trim(),
    ...(input.order === undefined ? {} : { order: input.order }),
    updatedAt: serverTimestamp(),
    updatedBy: actor.uid,
  });

  await writeAudit(db, {
    actor,
    action: "update",
    collectionName: COL.projects,
    docId: projectId,
    summary: `Renamed component "${prev.name ?? ""}" to "${input.name.trim()}"`,
    before: { name: prev.name ?? "" },
    after: { name: input.name.trim() },
  });
}

export async function setProjectStatus(
  db: Firestore,
  actor: AuditActor,
  projectId: string,
  projectNumber: string,
  from: ProjectStatus,
  to: ProjectStatus
): Promise<void> {
  const patch: Record<string, unknown> = {
    status: to,
    updatedAt: serverTimestamp(),
    updatedBy: actor.uid,
  };
  if (to === "completed") patch.completedAt = serverTimestamp();

  await updateDoc(doc(db, COL.projects, projectId), patch);
  await writeAudit(db, {
    actor,
    action: "status_change",
    collectionName: COL.projects,
    docId: projectId,
    summary: `${projectNumber}: ${from} to ${to}`,
    before: { status: from },
    after: { status: to },
  });
}

/**
 * Adds a component, optionally pre-filling its features from the category
 * template.
 *
 * Template features are created at zero price: the item list is what the
 * business already uses as a checklist, and pre-filling prices with guesses
 * would be worse than leaving them blank, because a zero is obviously unpriced
 * while a wrong number looks deliberate.
 */
export async function addComponent(
  db: Firestore,
  actor: AuditActor,
  projectId: string,
  input: { name: string; category: ProductCategory; order: number; useTemplate: boolean }
): Promise<string> {
  const compRef = doc(collection(db, componentsPath(projectId)));
  const batch = writeBatch(db);

  batch.set(compRef, {
    name: input.name,
    category: input.category,
    status: "estimating" satisfies ProjectStatus,
    order: input.order,
    estimatedCostKobo: 0,
    createdAt: serverTimestamp(),
    createdBy: actor.uid,
  });

  if (input.useTemplate) {
    const template = ESTIMATE_TEMPLATES[input.category];
    template.items.forEach((t, i) => {
      batch.set(doc(collection(db, featuresPath(projectId, compRef.id))), {
        item: t.item,
        kind: t.kind,
        actualQuantity: null,
        quantity: 0,
        unitPriceKobo: 0,
        amountKobo: 0,
        order: i,
        createdAt: serverTimestamp(),
        createdBy: actor.uid,
      });
    });
  }

  await batch.commit();

  await writeAudit(db, {
    actor,
    action: "create",
    collectionName: COL.projects,
    docId: projectId,
    summary:
      `Added component "${input.name}" (${input.category})` +
      (input.useTemplate
        ? ` with ${ESTIMATE_TEMPLATES[input.category].items.length} template lines`
        : ""),
  });

  return compRef.id;
}

/**
 * Saves a feature's quantity and price, then rolls the totals up.
 *
 * Runs in a transaction over the component and project so two people pricing
 * different features of the same component cannot both read a stale subtotal.
 */
export async function saveFeature(
  db: Firestore,
  actor: AuditActor,
  projectId: string,
  componentId: string,
  featureId: string,
  values: {
    quantity: number;
    unitPriceKobo: number;
    actualQuantity?: number | null;
    notes?: string;
    /** Renames the line. Omitted leaves the existing label untouched, so callers
     *  that only price a templated row cannot blank its name by accident. */
    item?: string;
  }
): Promise<void> {
  const amountKobo = lineAmountKobo(values.quantity, values.unitPriceKobo);
  const featureRef = doc(db, `${featuresPath(projectId, componentId)}/${featureId}`);
  const compRef = doc(db, `${componentsPath(projectId)}/${componentId}`);
  const projRef = doc(db, COL.projects, projectId);

  // Sibling amounts are read outside the transaction: a feature edit by someone
  // else is caught by the transaction's own conflict check on the component doc.
  const siblings = await getDocs(collection(db, featuresPath(projectId, componentId)));
  const othersTotal = sumKobo(
    siblings.docs.filter((d) => d.id !== featureId).map((d) => d.data().amountKobo as number)
  );

  await runTransaction(db, async (tx) => {
    const compSnap = await tx.get(compRef);
    if (!compSnap.exists()) throw new Error("Component not found.");
    const projSnap = await tx.get(projRef);
    if (!projSnap.exists()) throw new Error("Project not found.");

    const previousComponentTotal = (compSnap.data().estimatedCostKobo as number) ?? 0;
    const nextComponentTotal = othersTotal + amountKobo;
    const projectTotal = (projSnap.data().estimatedCostKobo as number) ?? 0;

    tx.update(featureRef, {
      quantity: values.quantity,
      unitPriceKobo: values.unitPriceKobo,
      amountKobo,
      actualQuantity: values.actualQuantity ?? null,
      notes: values.notes ?? null,
      // Only written when supplied: an absent label must not overwrite the
      // template's own wording with an empty string.
      ...(values.item?.trim() ? { item: values.item.trim() } : {}),
      updatedAt: serverTimestamp(),
      updatedBy: actor.uid,
    });
    tx.update(compRef, { estimatedCostKobo: nextComponentTotal });
    tx.update(projRef, {
      // Adjust by the delta rather than recomputing from all components, which
      // would need a read of every sibling component too.
      estimatedCostKobo: projectTotal - previousComponentTotal + nextComponentTotal,
      updatedAt: serverTimestamp(),
      updatedBy: actor.uid,
    });
  });
}

export async function addFeature(
  db: Firestore,
  actor: AuditActor,
  projectId: string,
  componentId: string,
  input: { item: string; order: number }
): Promise<string> {
  const ref = doc(collection(db, featuresPath(projectId, componentId)));
  const batch = writeBatch(db);
  batch.set(ref, {
    item: input.item,
    kind: "material",
    actualQuantity: null,
    quantity: 0,
    unitPriceKobo: 0,
    amountKobo: 0,
    order: input.order,
    createdAt: serverTimestamp(),
    createdBy: actor.uid,
  });
  await batch.commit();
  return ref.id;
}

/** Removes a feature and rolls the totals back. */
export async function removeFeature(
  db: Firestore,
  actor: AuditActor,
  projectId: string,
  componentId: string,
  featureId: string,
  amountKobo: number
): Promise<void> {
  const compRef = doc(db, `${componentsPath(projectId)}/${componentId}`);
  const projRef = doc(db, COL.projects, projectId);

  await runTransaction(db, async (tx) => {
    const compSnap = await tx.get(compRef);
    const projSnap = await tx.get(projRef);
    if (!compSnap.exists() || !projSnap.exists()) throw new Error("Not found.");

    tx.delete(doc(db, `${featuresPath(projectId, componentId)}/${featureId}`));
    tx.update(compRef, {
      estimatedCostKobo: Math.max(
        0,
        ((compSnap.data().estimatedCostKobo as number) ?? 0) - amountKobo
      ),
    });
    tx.update(projRef, {
      estimatedCostKobo: Math.max(
        0,
        ((projSnap.data().estimatedCostKobo as number) ?? 0) - amountKobo
      ),
    });
  });
}

export async function removeComponent(
  db: Firestore,
  actor: AuditActor,
  projectId: string,
  componentId: string
): Promise<void> {
  // Firestore does not cascade, so features are removed explicitly or they are
  // orphaned and keep counting toward nothing.
  const features = await getDocs(collection(db, featuresPath(projectId, componentId)));
  for (let i = 0; i < features.docs.length; i += 400) {
    const b = writeBatch(db);
    features.docs.slice(i, i + 400).forEach((d) => b.delete(d.ref));
    await b.commit();
  }

  const compRef = doc(db, `${componentsPath(projectId)}/${componentId}`);
  const projRef = doc(db, COL.projects, projectId);

  await runTransaction(db, async (tx) => {
    const compSnap = await tx.get(compRef);
    const projSnap = await tx.get(projRef);
    if (!compSnap.exists() || !projSnap.exists()) return;
    const removed = (compSnap.data().estimatedCostKobo as number) ?? 0;
    tx.delete(compRef);
    tx.update(projRef, {
      estimatedCostKobo: Math.max(
        0,
        ((projSnap.data().estimatedCostKobo as number) ?? 0) - removed
      ),
    });
  });

  await writeAudit(db, {
    actor,
    action: "delete",
    collectionName: COL.projects,
    docId: projectId,
    summary: "Removed a component and its features",
  });
}

// ---------------------------------------------------------------------------
// Estimates
// ---------------------------------------------------------------------------

export interface EstimateTotals {
  subtotalKobo: number;
  errorMarginKobo: number;
  nightowlChargesKobo: number;
  totalKobo: number;
}

/**
 * Computes estimate totals.
 *
 * Both percentages apply to the **subtotal only**, never to each other. Charging
 * a margin on top of a margin is how a quote quietly inflates, and it is the
 * error the paper template invites by listing them as ordinary rows.
 */
export function computeEstimateTotals(
  subtotalKobo: number,
  errorMarginPercent: number,
  nightowlChargePercent: number
): EstimateTotals {
  const errorMarginKobo = applyPercentKobo(subtotalKobo, errorMarginPercent);
  const nightowlChargesKobo = applyPercentKobo(subtotalKobo, nightowlChargePercent);
  return {
    subtotalKobo,
    errorMarginKobo,
    nightowlChargesKobo,
    totalKobo: subtotalKobo + errorMarginKobo + nightowlChargesKobo,
  };
}

/**
 * Creates an estimate from the project's current component features.
 *
 * A snapshot, not a live view: the lines are copied so a later price edit on the
 * project does not silently restate an estimate the client has already seen.
 * Previous estimates for the project are marked superseded, and the version
 * number increments, so the history stays readable.
 */
export async function createEstimate(
  db: Firestore,
  actor: AuditActor,
  projectId: string,
  projectNumber: string,
  options: { errorMarginPercent: number; nightowlChargePercent: number }
): Promise<{ estimateId: string; version: number; totals: EstimateTotals }> {
  const compSnap = await getDocs(collection(db, componentsPath(projectId)));

  interface Line {
    category: ProductCategory;
    item: string;
    quantity: number;
    unitPriceKobo: number;
    amountKobo: number;
    actualQuantity: number | null;
    order: number;
  }
  const lines: Line[] = [];

  // Feature reads are issued together. A kitchen project carries a component per
  // room and each holds its own template rows, so serial reads made estimate
  // creation slower the more complete the project was.
  const featSnaps = await Promise.all(
    compSnap.docs.map((comp) => getDocs(collection(db, featuresPath(projectId, comp.id))))
  );

  for (let i = 0; i < compSnap.docs.length; i++) {
    const category = compSnap.docs[i].data().category as ProductCategory;
    for (const f of featSnaps[i].docs) {
      const d = f.data();
      // Skip untouched template rows: an estimate listing 178 zero-value lines
      // is unreadable, and the client only needs what was actually priced.
      if (!d.amountKobo) continue;
      lines.push({
        category,
        item: d.item ?? "",
        quantity: d.quantity ?? 0,
        unitPriceKobo: d.unitPriceKobo ?? 0,
        amountKobo: d.amountKobo ?? 0,
        actualQuantity: d.actualQuantity ?? null,
        order: d.order ?? 0,
      });
    }
  }

  const subtotal = sumKobo(lines.map((l) => l.amountKobo));
  const totals = computeEstimateTotals(
    subtotal,
    options.errorMarginPercent,
    options.nightowlChargePercent
  );

  // Supersede any live estimate for this project before adding the new one.
  //
  // Filtered server-side. Reading every estimate in the business to find one
  // project's was billed against the whole collection, so the cost of issuing an
  // estimate grew with every estimate ever issued.
  const existing = await getDocs(
    query(collection(db, COL.estimates), where("projectId", "==", projectId))
  );
  const mine = existing.docs.filter((d) => d.data().status !== "superseded");

  // Versions count every estimate for the project, including superseded ones.
  // Counting only live ones reused version numbers: supersede v1, and the next
  // estimate was v1 again, so two different documents shared a number.
  const version = existing.size + 1;

  const estRef = doc(collection(db, COL.estimates));
  let batch = writeBatch(db);
  let ops = 0;

  for (const d of mine) {
    batch.update(d.ref, { status: "superseded", updatedAt: serverTimestamp() });
    ops += 1;
  }

  batch.set(estRef, {
    projectId,
    projectNumber,
    version,
    status: "draft",
    subtotalKobo: totals.subtotalKobo,
    errorMarginPercent: options.errorMarginPercent,
    errorMarginKobo: totals.errorMarginKobo,
    nightowlChargesKobo: totals.nightowlChargesKobo,
    totalKobo: totals.totalKobo,
    createdAt: serverTimestamp(),
    createdBy: actor.uid,
  });
  ops += 1;

  for (const l of lines) {
    batch.set(doc(collection(db, estimateLinesPath(estRef.id))), l);
    ops += 1;
    if (ops >= 400) {
      await batch.commit();
      batch = writeBatch(db);
      ops = 0;
    }
  }
  if (ops > 0) await batch.commit();

  await writeAudit(db, {
    actor,
    action: "create",
    collectionName: COL.estimates,
    docId: estRef.id,
    summary: `Estimate v${version} for ${projectNumber}: ${lines.length} lines, total ${totals.totalKobo} kobo`,
    after: { version, totalKobo: totals.totalKobo, lineCount: lines.length },
  });

  return { estimateId: estRef.id, version, totals };
}

export async function approveEstimate(
  db: Firestore,
  actor: AuditActor,
  estimateId: string,
  projectId: string,
  totalKobo: number
): Promise<void> {
  const batch = writeBatch(db);
  batch.update(doc(db, COL.estimates, estimateId), {
    status: "approved",
    approvedBy: actor.uid,
    approvedAt: serverTimestamp(),
  });
  // Approving fixes the contract value and moves the project on.
  batch.update(doc(db, COL.projects, projectId), {
    status: "approved" satisfies ProjectStatus,
    contractValueKobo: totalKobo,
    updatedAt: serverTimestamp(),
    updatedBy: actor.uid,
  });
  await batch.commit();

  await writeAudit(db, {
    actor,
    action: "estimate_approve",
    collectionName: COL.estimates,
    docId: estimateId,
    summary: `Approved estimate at ${totalKobo} kobo and set the contract value`,
    after: { status: "approved", contractValueKobo: totalKobo },
  });
}

export async function deleteProject(
  db: Firestore,
  actor: AuditActor,
  projectId: string,
  projectNumber: string
): Promise<void> {
  const comps = await getDocs(collection(db, componentsPath(projectId)));
  for (const c of comps.docs) {
    const feats = await getDocs(collection(db, featuresPath(projectId, c.id)));
    for (let i = 0; i < feats.docs.length; i += 400) {
      const b = writeBatch(db);
      feats.docs.slice(i, i + 400).forEach((d) => b.delete(d.ref));
      await b.commit();
    }
    await deleteDoc(c.ref);
  }
  await deleteDoc(doc(db, COL.projects, projectId));

  await writeAudit(db, {
    actor,
    action: "delete",
    collectionName: COL.projects,
    docId: projectId,
    summary: `Deleted project ${projectNumber} and its components`,
  });
}

import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
  where,
  writeBatch,
  type Firestore,
} from "firebase/firestore";
import { COL, COUNTER, componentsPath, featuresPath } from "./collections";
import type {
  BoardType,
  EstimateStatus,
  ProductCategory,
  ProjectStatus,
} from "./enums";
import { applyPercentKobo, lineAmountKobo, sumKobo } from "./money";
import { allocateDocNumber } from "./numbering";
import { ESTIMATE_TEMPLATES } from "./estimateTemplates";
import { DEFAULT_INVOICE_SETTINGS } from "./settings";
import { writeAudit, type AuditActor } from "./audit";

/** Fallbacks when a project carries no rates of its own. */
const DEFAULT_ERROR_MARGIN_PERCENT = DEFAULT_INVOICE_SETTINGS.defaultErrorMarginPercent;
const DEFAULT_NIGHTOWL_CHARGE_PERCENT =
  DEFAULT_INVOICE_SETTINGS.defaultNightowlChargePercent;

/**
 * Projects, components, features and estimates.
 *
 * The hierarchy is project > component > feature. A component is a physical
 * deliverable ("Main kitchen"), a feature is a priced line within it. Estimate
 * totals roll upward, and each level stores its own subtotal so a list view does
 * not have to read every descendant.
 *
 * The project *is* its estimate. There is no snapshot: the ticked features are the
 * line items and the rates live on the project, so a corrected price is corrected
 * everywhere at once. Approving records the agreed figure in `contractValueKobo`,
 * which is what invoices bill against; the components stay editable after that, so
 * the agreed figure and the live sum can diverge, and the agreed one wins.
 */

/**
 * Whether a feature row belongs on the estimate.
 *
 * The tick is the answer where it exists. Rows written before the flag was
 * introduced have no `included` field, and for those a non-zero amount is the
 * only record of intent, so they stay in — a project priced last month keeps the
 * total it had. Written once and shared by the editor, the rollups and estimate
 * creation, because three copies of this rule would drift and the totals would
 * stop agreeing with the ticks on screen.
 *
 * Note that a legacy row keeps deciding by price until somebody actually ticks it:
 * `saveFeature` only writes the flag when a tick was passed, never when this
 * fallback was consulted. Persisting the fallback verdict froze it — pricing a
 * legacy row at zero to correct a typo wrote `included: false`, and restoring the
 * price then left the line off the estimate with the box still showing a tick's
 * worth of ambiguity.
 */
export function isIncluded(feature: {
  included?: boolean | null;
  amountKobo?: number | null;
}): boolean {
  if (feature.included === true) return true;
  if (feature.included === false) return false;
  return (feature.amountKobo ?? 0) > 0;
}

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
 * Template features are created at zero price and unticked: the item list is what
 * the business already uses as a checklist, and pre-filling prices with guesses
 * would be worse than leaving them blank, because a zero is obviously unpriced
 * while a wrong number looks deliberate. Every row is written, so the whole
 * checklist is visible and editable straight away; ticking a line is what puts it
 * on the estimate.
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
        included: false,
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
 * Saves a feature's quantity, price and inclusion, then rolls the totals up.
 *
 * Runs in a transaction over the component and project so two people pricing
 * different features of the same component cannot both read a stale subtotal.
 *
 * Only ticked lines count toward the rollups, so the component and project
 * subtotals always equal the sum of what the estimate would actually list.
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
    /** Whether the line goes on the estimate. Omitted leaves the stored tick
     *  alone, so pricing a row does not silently include or drop it. */
    included?: boolean;
    /**
     * Whether this line is boards, and which material.
     *
     * Ticking it makes the line's quantity count toward the project's board total, which is
     * what the cutting & edging charge is priced from. Both omitted leaves the stored values
     * alone, for the same reason `included` does: a caller that only reprices a row must not
     * silently un-flag it as boards.
     */
    isBoard?: boolean;
    boardType?: BoardType | null;
  }
): Promise<void> {
  const amountKobo = lineAmountKobo(values.quantity, values.unitPriceKobo);
  const featureRef = doc(db, `${featuresPath(projectId, componentId)}/${featureId}`);
  const compRef = doc(db, `${componentsPath(projectId)}/${componentId}`);
  const projRef = doc(db, COL.projects, projectId);

  await runTransaction(db, async (tx) => {
    const compSnap = await tx.get(compRef);
    if (!compSnap.exists()) throw new Error("Component not found.");
    const projSnap = await tx.get(projRef);
    if (!projSnap.exists()) throw new Error("Project not found.");

    /*
     * Adjusted by this row's own delta, never by re-summing its siblings.
     *
     * Summing the siblings was how this lost money. That read cannot go inside the
     * transaction — the client SDK's `tx.get` takes a document reference, not a
     * query — and outside it the rows are not in the transaction's read set. So when
     * two people ticked two rows of the same component, the second transaction did
     * retry (it reads compRef, which the first had just changed) but the retry
     * re-ran only this callback: the sibling sum was a stale closure value taken
     * before the first tick landed, and committing it erased the first row's
     * contribution.
     *
     * A delta has no such dependency. Only this row's before and after are needed,
     * both read here, and two rows changing concurrently each move the total by
     * their own difference. It is also one document read instead of a whole
     * component's worth.
     */
    const ownSnap = await tx.get(featureRef);
    if (!ownSnap.exists()) throw new Error("That line no longer exists.");
    const own = ownSnap.data();

    // The tick being saved wins; absent, the row's stored state decides.
    const nextIncluded =
      values.included ?? isIncluded({ included: own.included, amountKobo });
    const wasIncluded = isIncluded(own);

    const before = wasIncluded ? ((own.amountKobo as number) ?? 0) : 0;
    const after = nextIncluded ? amountKobo : 0;
    const delta = after - before;

    const previousComponentTotal = (compSnap.data().estimatedCostKobo as number) ?? 0;
    const nextComponentTotal = Math.max(0, previousComponentTotal + delta);
    const projectTotal = (projSnap.data().estimatedCostKobo as number) ?? 0;

    tx.update(featureRef, {
      quantity: values.quantity,
      unitPriceKobo: values.unitPriceKobo,
      amountKobo,
      // Only written when a tick was actually passed. Writing the fallback's verdict
      // would convert a legacy row's "decide by price" into a fixed answer the first
      // time anyone edited its quantity, which is not a decision the user made.
      ...(values.included === undefined ? {} : { included: values.included }),
      // Same omit-means-leave-alone rule as `included`: repricing a row must not un-flag it
      // as boards, or the cutting charge would quietly drop those sheets.
      ...(values.isBoard === undefined ? {} : { isBoard: values.isBoard }),
      ...(values.boardType === undefined ? {} : { boardType: values.boardType }),
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

/**
 * Adds a line that is not on the category template.
 *
 * Ticked on arrival, unlike a template row: someone typed this item in for this
 * job, so its inclusion is not in question the way a checklist entry's is.
 */
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
    included: true,
    order: input.order,
    createdAt: serverTimestamp(),
    createdBy: actor.uid,
  });
  await batch.commit();
  return ref.id;
}

/**
 * Removes a feature and rolls the totals back.
 *
 * What the row contributed is read from the document inside the transaction, not
 * taken from the caller. Two reasons. An unticked row was never added to the
 * subtotals, so subtracting its price would pull the totals below what the
 * remaining lines justify. And the caller's figure comes from a live listener,
 * which can be a repricing behind: deleting a row someone else had just changed
 * subtracted the amount the deleter's screen happened to show and left the
 * component permanently out by the difference.
 */
export async function removeFeature(
  db: Firestore,
  actor: AuditActor,
  projectId: string,
  componentId: string,
  featureId: string
): Promise<void> {
  const featureRef = doc(db, `${featuresPath(projectId, componentId)}/${featureId}`);
  const compRef = doc(db, `${componentsPath(projectId)}/${componentId}`);
  const projRef = doc(db, COL.projects, projectId);

  await runTransaction(db, async (tx) => {
    const compSnap = await tx.get(compRef);
    const projSnap = await tx.get(projRef);
    if (!compSnap.exists() || !projSnap.exists()) throw new Error("Not found.");

    const featSnap = await tx.get(featureRef);
    // Already gone: another tab removed it, and its amount has been taken off the
    // totals once already.
    if (!featSnap.exists()) return;
    const contributed = isIncluded(featSnap.data())
      ? ((featSnap.data().amountKobo as number) ?? 0)
      : 0;

    tx.delete(featureRef);
    tx.update(compRef, {
      estimatedCostKobo: Math.max(
        0,
        ((compSnap.data().estimatedCostKobo as number) ?? 0) - contributed
      ),
    });
    tx.update(projRef, {
      estimatedCostKobo: Math.max(
        0,
        ((projSnap.data().estimatedCostKobo as number) ?? 0) - contributed
      ),
    });
  });
}

/**
 * Ticks or unticks every feature in a component at once, then rebuilds the
 * subtotals from what is left ticked.
 *
 * Pricing a 33-row kitchen and then ticking each line individually is 33 writes
 * and 33 rollup transactions for one decision, so the bulk actions do it in
 * batches and recompute the component total from scratch afterwards rather than
 * by delta. Recomputing is safe here because every feature has just been read.
 *
 * `onlyPriced` ticks just the lines that carry an amount, which is the common
 * case: price the handful that apply, then include them in one go.
 */
export async function setComponentInclusion(
  db: Firestore,
  actor: AuditActor,
  projectId: string,
  componentId: string,
  included: boolean,
  options: { onlyPriced?: boolean } = {}
): Promise<number> {
  const feats = await getDocs(collection(db, featuresPath(projectId, componentId)));

  const targets = feats.docs.filter((d) => {
    if (included && options.onlyPriced && !((d.data().amountKobo as number) ?? 0)) {
      return false;
    }
    return isIncluded(d.data()) !== included;
  });
  if (targets.length === 0) return 0;

  for (let i = 0; i < targets.length; i += 400) {
    const b = writeBatch(db);
    targets.slice(i, i + 400).forEach((d) =>
      b.update(d.ref, {
        included,
        updatedAt: serverTimestamp(),
        updatedBy: actor.uid,
      })
    );
    await b.commit();
  }

  /*
   * The change this bulk action made, as a single delta.
   *
   * Expressed as a delta for the same reason saveFeature is: the totals cannot be
   * recomputed from a sibling query inside a transaction, because the client SDK's
   * `tx.get` takes a document reference rather than a query, and a sum computed
   * outside the transaction is not in its read set — so a concurrent single-row
   * save would be silently overwritten by whichever wrote last.
   *
   * Every target moved in the same direction, so the delta is just their amounts,
   * added on ticking and subtracted on clearing. Read from the same snapshot the
   * targets were selected from, which is what the batch wrote against.
   */
  const moved = sumKobo(targets.map((d) => (d.data().amountKobo as number) ?? 0));
  const delta = included ? moved : -moved;

  const compRef = doc(db, `${componentsPath(projectId)}/${componentId}`);
  const projRef = doc(db, COL.projects, projectId);
  await runTransaction(db, async (tx) => {
    const compSnap = await tx.get(compRef);
    const projSnap = await tx.get(projRef);
    if (!compSnap.exists() || !projSnap.exists()) throw new Error("Not found.");

    const previous = (compSnap.data().estimatedCostKobo as number) ?? 0;
    const projectTotal = (projSnap.data().estimatedCostKobo as number) ?? 0;
    tx.update(compRef, { estimatedCostKobo: Math.max(0, previous + delta) });
    tx.update(projRef, {
      estimatedCostKobo: Math.max(0, projectTotal + delta),
      updatedAt: serverTimestamp(),
      updatedBy: actor.uid,
    });
  });

  return targets.length;
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
 * The estimate's own figures, read off the project.
 *
 * There is no estimate document. The components and their ticked features *are*
 * the line items, `estimatedCostKobo` is already their rolled-up subtotal, and the
 * two percentages live on the project, so the totals are always current by
 * construction rather than by remembering to regenerate something.
 */
export function projectEstimateTotals(project: {
  estimatedCostKobo?: number | null;
  errorMarginPercent?: number | null;
  nightowlChargePercent?: number | null;
}): EstimateTotals {
  return computeEstimateTotals(
    project.estimatedCostKobo ?? 0,
    project.errorMarginPercent ?? DEFAULT_ERROR_MARGIN_PERCENT,
    project.nightowlChargePercent ?? DEFAULT_NIGHTOWL_CHARGE_PERCENT
  );
}

/**
 * Sets the margin and charge rates for the project's estimate.
 *
 * Separate from pricing a line because it is a different decision — what the
 * business adds on top, rather than what the work costs — and because these are the
 * two figures an external reviewer is explicitly not allowed to touch.
 */
export async function setProjectMargins(
  db: Firestore,
  actor: AuditActor,
  projectId: string,
  options: { errorMarginPercent: number; nightowlChargePercent: number }
): Promise<void> {
  if (options.errorMarginPercent < 0 || options.nightowlChargePercent < 0) {
    throw new Error("A percentage cannot be negative.");
  }

  await updateDoc(doc(db, COL.projects, projectId), {
    errorMarginPercent: options.errorMarginPercent,
    nightowlChargePercent: options.nightowlChargePercent,
    updatedAt: serverTimestamp(),
    updatedBy: actor.uid,
  });

  await writeAudit(db, {
    actor,
    action: "update",
    collectionName: COL.projects,
    docId: projectId,
    summary: `Estimate rates: ${options.errorMarginPercent}% margin, ${options.nightowlChargePercent}% Nightowl charge`,
    after: options,
  });
}

/**
 * Adds several components at once, each with its category template.
 *
 * A project is usually quoted as a kitchen *and* two closets *and* a run of doors,
 * and adding them one dialog at a time made the common case the slow one. Ordering
 * continues from what is already there so the sequence stays the estimator's.
 */
export async function addComponents(
  db: Firestore,
  actor: AuditActor,
  projectId: string,
  entries: Array<{
    name: string;
    category: ProductCategory;
    useTemplate: boolean;
  }>,
  startOrder: number
): Promise<string[]> {
  if (entries.length === 0) throw new Error("Choose at least one component.");

  const ids: string[] = [];
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    ids.push(
      await addComponent(db, actor, projectId, {
        name: e.name,
        category: e.category,
        order: startOrder + i,
        useTemplate: e.useTemplate,
      })
    );
  }
  return ids;
}

/*
 * The version is bumped server-side, by whichever call sends the estimate out —
 * `sendEstimateForReview` and `emailEstimate`. It deliberately has no client-side
 * equivalent: a version claimed in the browser and then not sent would leave a gap,
 * and the bump has to be atomic with the send that earns it.
 */

/**
 * Approves the estimate and fixes the contract value.
 *
 * Approving records what was agreed: the total at this moment becomes
 * `contractValueKobo`, which is what invoices bill against. The components stay
 * editable afterwards — there is no frozen copy to protect — so the agreed figure
 * and the live component sum can legitimately diverge later. `contractValueKobo`
 * is the agreed one, and invoicing reads it in preference for exactly that reason.
 */
export async function approveProjectEstimate(
  db: Firestore,
  actor: AuditActor,
  projectId: string,
  projectNumber: string,
  totalKobo: number
): Promise<void> {
  await updateDoc(doc(db, COL.projects, projectId), {
    estimateStatus: "approved" satisfies EstimateStatus,
    estimateApprovedBy: actor.uid,
    estimateApprovedAt: serverTimestamp(),
    status: "approved" satisfies ProjectStatus,
    contractValueKobo: totalKobo,
    updatedAt: serverTimestamp(),
    updatedBy: actor.uid,
  });

  await writeAudit(db, {
    actor,
    action: "estimate_approve",
    collectionName: COL.projects,
    docId: projectId,
    summary: `${projectNumber}: approved the estimate at ${totalKobo} kobo and set the contract value`,
    after: { estimateStatus: "approved", contractValueKobo: totalKobo },
  });
}

/** Returns an approved estimate to draft so it can be requoted. */
export async function reopenProjectEstimate(
  db: Firestore,
  actor: AuditActor,
  projectId: string,
  projectNumber: string
): Promise<void> {
  await updateDoc(doc(db, COL.projects, projectId), {
    estimateStatus: "draft" satisfies EstimateStatus,
    estimateApprovedBy: null,
    estimateApprovedAt: null,
    updatedAt: serverTimestamp(),
    updatedBy: actor.uid,
  });

  await writeAudit(db, {
    actor,
    action: "update",
    collectionName: COL.projects,
    docId: projectId,
    // The contract value is deliberately left standing: it is what was agreed, and
    // reopening to requote does not unagree it. Approving again overwrites it.
    summary: `${projectNumber}: reopened the estimate for requoting; the contract value stands until it is approved again`,
    after: { estimateStatus: "draft" },
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

"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { collection, doc, getDoc, onSnapshot, orderBy, query } from "firebase/firestore";
import {
  ArrowLeft,
  ChevronDown,
  ChevronRight,
  FileText,
  Loader2,
  PenLine,
  Plus,
  Trash2,
} from "lucide-react";
import { getDb } from "@/lib/firebase";
import { COL, componentsPath, featuresPath } from "@/lib/erp/collections";
import {
  PRODUCT_CATEGORIES,
  PRODUCT_CATEGORY_LABELS,
  PROJECT_STATUSES,
  PROJECT_STATUS_LABELS,
  type ProductCategory,
  type ProjectStatus,
} from "@/lib/erp/enums";
import { formatNaira, parseNairaInput, toNaira } from "@/lib/erp/money";
import { templateItemCount } from "@/lib/erp/estimateTemplates";
import {
  addComponent,
  addFeature,
  computeEstimateTotals,
  createEstimate,
  removeComponent,
  updateComponent,
  removeFeature,
  saveFeature,
  setProjectStatus,
} from "@/lib/erp/projects";
import { DEFAULT_INVOICE_SETTINGS, SETTINGS_DOC } from "@/lib/erp/settings";
import { PROJECT_STATUS_TONE } from "@/lib/erp/statusTone";
import { StatusPill } from "@/components/admin/ui/StatusPill";
import { ProjectDetailsEditor } from "@/components/admin/products/ProjectDetailsEditor";
import {
  Button,
  CheckboxField,
  NumberField,
  SelectField,
  TextField,
} from "@/components/admin/ui/Fields";
import { useErpSession } from "@/components/admin/ErpAuthProvider";

interface ProjectDoc {
  projectNumber: string;
  customerId: string;
  customerName: string;
  title: string;
  location?: string;
  status: ProjectStatus;
  estimatedCostKobo: number;
  contractValueKobo?: number;
  targetDateMs: number | null;
}

interface ComponentRow {
  id: string;
  name: string;
  category: ProductCategory;
  order: number;
  estimatedCostKobo: number;
}

interface FeatureRow {
  id: string;
  item: string;
  kind?: string;
  actualQuantity?: number | null;
  quantity: number;
  unitPriceKobo: number;
  amountKobo: number;
  order: number;
}

/**
 * Project detail with the estimate builder.
 *
 * Components expand to show their features, which are edited in place. Only the
 * expanded component subscribes to its features: a project with three components
 * from the template carries over 100 rows, and holding listeners on all of them
 * would be wasteful when the user is working on one.
 */
export function ProjectDetail() {
  const params = useSearchParams();
  const projectId = params.get("id") ?? "";
  const session = useErpSession();
  const canEdit = session.can("project.edit");
  const canApprove = session.can("estimate.approve");

  const [project, setProject] = useState<ProjectDoc | null>(null);
  const [editingDetails, setEditingDetails] = useState(false);
  const [components, setComponents] = useState<ComponentRow[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [missing, setMissing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [addingComponent, setAddingComponent] = useState(false);
  const [margins, setMargins] = useState({
    errorMarginPercent: DEFAULT_INVOICE_SETTINGS.defaultErrorMarginPercent,
    nightowlChargePercent: DEFAULT_INVOICE_SETTINGS.defaultNightowlChargePercent,
  });

  useEffect(() => {
    if (!projectId) {
      setLoading(false);
      setMissing(true);
      return;
    }
    return onSnapshot(
      doc(getDb(), COL.projects, projectId),
      (snap) => {
        if (!snap.exists()) {
          setMissing(true);
        } else {
          const x = snap.data();
          setProject({
            projectNumber: x.projectNumber ?? "",
            customerId: x.customerId ?? "",
            customerName: x.customerName ?? "",
            title: x.title ?? "",
            location: x.location ?? undefined,
            status: (x.status as ProjectStatus) ?? "enquiry",
            estimatedCostKobo: x.estimatedCostKobo ?? 0,
            contractValueKobo: x.contractValueKobo ?? undefined,
            targetDateMs: x.targetDate?.toMillis?.() ?? null,
          });
        }
        setLoading(false);
      },
      (e) => {
        setError(e.message);
        setLoading(false);
      }
    );
  }, [projectId]);

  useEffect(() => {
    if (!projectId) return;
    return onSnapshot(
      query(collection(getDb(), componentsPath(projectId)), orderBy("order", "asc")),
      (snap) =>
        setComponents(
          snap.docs.map((d) => ({
            id: d.id,
            name: d.data().name ?? "",
            category: (d.data().category as ProductCategory) ?? "kitchen",
            order: d.data().order ?? 0,
            estimatedCostKobo: d.data().estimatedCostKobo ?? 0,
          }))
        ),
      () => {}
    );
  }, [projectId]);

  // Margins default from settings but stay editable per estimate.
  useEffect(() => {
    getDoc(doc(getDb(), COL.settings, SETTINGS_DOC.invoice))
      .then((snap) => {
        if (!snap.exists()) return;
        const d = snap.data();
        setMargins({
          errorMarginPercent:
            d.defaultErrorMarginPercent ?? DEFAULT_INVOICE_SETTINGS.defaultErrorMarginPercent,
          nightowlChargePercent:
            d.defaultNightowlChargePercent ??
            DEFAULT_INVOICE_SETTINGS.defaultNightowlChargePercent,
        });
      })
      .catch(() => {});
  }, []);

  const actor = useMemo(
    () => ({
      uid: session.user?.uid ?? "",
      email: session.user?.email ?? "",
      role: session.role ?? "manager",
    }),
    [session.user, session.role]
  );

  const totals = useMemo(
    () =>
      computeEstimateTotals(
        project?.estimatedCostKobo ?? 0,
        margins.errorMarginPercent,
        margins.nightowlChargePercent
      ),
    [project?.estimatedCostKobo, margins]
  );

  async function generateEstimate() {
    if (!project) return;
    setBusy(true);
    setError("");
    try {
      const { version, totals: t } = await createEstimate(
        getDb(),
        actor,
        projectId,
        project.projectNumber,
        margins
      );
      setError("");
      alertVersion(version, t.totalKobo);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not create the estimate.");
    } finally {
      setBusy(false);
    }
  }

  function alertVersion(version: number, totalKobo: number) {
    // A transient confirmation rather than a modal: the estimate list below
    // updates live, so the message only needs to say what happened.
    setNotice(`Estimate v${version} created at ${formatNaira(totalKobo)}.`);
    setTimeout(() => setNotice(""), 6000);
  }
  const [notice, setNotice] = useState("");

  if (loading) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center">
        <Loader2 className="animate-spin text-brass-400" size={28} aria-label="Loading" />
      </div>
    );
  }

  if (missing || !project) {
    return (
      <div className="mx-auto max-w-lg rounded-3xl border border-night-700/60 bg-night-900/40 p-8 text-center">
        <p className="font-display text-lg text-cream-200">Project not found</p>
        <Link href="/admin/projects/" className="mt-5 inline-block">
          <Button variant="secondary">Back to projects</Button>
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl pb-24">
      <Link
        href="/admin/projects/"
        className="inline-flex items-center gap-2 text-sm text-cream-400 transition-colors hover:text-brass-300"
      >
        <ArrowLeft size={15} /> All projects
      </Link>

      <header className="mt-4 flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-eyebrow">{project.customerName}</p>
          <h1 className="text-title mt-2 text-cream-50">{project.title}</h1>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <StatusPill tone={PROJECT_STATUS_TONE[project.status]}>
              {PROJECT_STATUS_LABELS[project.status]}
            </StatusPill>
            <span className="text-xs text-cream-500">
              {project.projectNumber}
              {project.location ? ` · ${project.location}` : ""}
            </span>
            {project.targetDateMs && (
              <span className="text-xs text-cream-500">
                Target {new Date(project.targetDateMs).toLocaleDateString("en-GB")}
              </span>
            )}
          </div>
        </div>
        {canEdit && (
          <Button variant="secondary" onClick={() => setEditingDetails((v) => !v)}>
            <span className="flex items-center gap-1.5">
              <PenLine size={14} /> Edit details
            </span>
          </Button>
        )}
      </header>

      {editingDetails && canEdit && (
        <ProjectDetailsEditor
          projectId={projectId}
          projectNumber={project.projectNumber}
          project={project}
          actor={actor}
          onClose={() => setEditingDetails(false)}
          onError={setError}
        />
      )}

      {error && (
        <p role="alert" className="mt-6 text-sm text-red-400">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="mt-6 text-sm text-emerald-300">
          {notice}
        </p>
      )}

      {/* Estimate summary */}
      <section className="mt-8 rounded-3xl border border-brass-500/30 bg-night-900/40 p-6">
        <h2 className="font-display text-lg text-cream-100">Estimate</h2>
        <div className="mt-5 grid gap-4 sm:grid-cols-4">
          <Figure label="Materials & labour" value={formatNaira(totals.subtotalKobo)} />
          <Figure
            label={`Error margin ${margins.errorMarginPercent}%`}
            value={formatNaira(totals.errorMarginKobo)}
          />
          <Figure
            label={`Nightowl charge ${margins.nightowlChargePercent}%`}
            value={formatNaira(totals.nightowlChargesKobo)}
          />
          <Figure label="Total" value={formatNaira(totals.totalKobo)} accent />
        </div>

        {canEdit && (
          <>
            <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:w-2/3">
              <NumberField
                id="err-margin"
                label="Error margin (%)"
                value={String(margins.errorMarginPercent)}
                onChange={(v) =>
                  setMargins((m) => ({ ...m, errorMarginPercent: Number(v) || 0 }))
                }
              />
              <NumberField
                id="no-charge"
                label="Nightowl charge (%)"
                value={String(margins.nightowlChargePercent)}
                onChange={(v) =>
                  setMargins((m) => ({ ...m, nightowlChargePercent: Number(v) || 0 }))
                }
              />
            </div>
            <p className="mt-2 text-xs text-cream-500">
              Both percentages apply to the subtotal only, never to each other.
            </p>
            <div className="mt-5">
              <Button onClick={generateEstimate} busy={busy}>
                <span className="flex items-center gap-2">
                  <FileText size={15} /> Create estimate
                </span>
              </Button>
            </div>
          </>
        )}
      </section>

      {/* Components */}
      <section className="mt-8">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-display text-lg text-cream-100">
            Components{" "}
            {components.length > 0 && (
              <span className="text-cream-500">({components.length})</span>
            )}
          </h2>
          {canEdit && !addingComponent && (
            <button
              type="button"
              onClick={() => setAddingComponent(true)}
              className="flex cursor-pointer items-center gap-2 text-sm text-brass-300 transition-colors hover:text-brass-200"
            >
              <Plus size={15} /> Add component
            </button>
          )}
        </div>

        {addingComponent && (
          <AddComponentForm
            projectId={projectId}
            actor={actor}
            nextOrder={components.length}
            onClose={() => setAddingComponent(false)}
            onError={setError}
          />
        )}

        {components.length === 0 && !addingComponent ? (
          <p className="mt-5 rounded-3xl border border-night-700/60 bg-night-900/40 p-8 text-center text-sm text-cream-500">
            No components yet. Add one and choose its category to pull in the
            standard line items for that kind of work.
          </p>
        ) : (
          <div className="mt-5 space-y-3">
            {components.map((c) => (
              <ComponentPanel
                key={c.id}
                projectId={projectId}
                component={c}
                open={openId === c.id}
                onToggle={() => setOpenId(openId === c.id ? null : c.id)}
                canEdit={canEdit}
                actor={actor}
                onError={setError}
              />
            ))}
          </div>
        )}
      </section>

      {/* Status */}
      {canEdit && (
        <section className="mt-8 rounded-3xl border border-night-700/60 bg-night-900/30 p-6">
          <h2 className="font-display text-lg text-cream-100">Project status</h2>
          <div className="mt-4 flex flex-wrap gap-2">
            {PROJECT_STATUSES.filter((s) => s !== project.status).map((s) => (
              <button
                key={s}
                type="button"
                disabled={busy || (s === "approved" && !canApprove)}
                onClick={() =>
                  setProjectStatus(
                    getDb(),
                    actor,
                    projectId,
                    project.projectNumber,
                    project.status,
                    s
                  ).catch((e) =>
                    setError(e instanceof Error ? e.message : "Could not change status.")
                  )
                }
                title={
                  s === "approved" && !canApprove
                    ? "Approving a project is admin only"
                    : undefined
                }
                className="cursor-pointer rounded-xl border border-night-600 bg-night-800/60 px-4 py-2 text-xs text-cream-200 transition-all duration-300 hover:border-brass-500/60 hover:text-brass-300 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {PROJECT_STATUS_LABELS[s]}
              </button>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function AddComponentForm({
  projectId,
  actor,
  nextOrder,
  onClose,
  onError,
}: {
  projectId: string;
  actor: { uid: string; email: string; role: "admin" | "manager" | "operator" };
  nextOrder: number;
  onClose: () => void;
  onError: (m: string) => void;
}) {
  const [name, setName] = useState("");
  const [category, setCategory] = useState<ProductCategory>("kitchen");
  const [useTemplate, setUseTemplate] = useState(true);
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (!name.trim()) {
      onError("Name the component.");
      return;
    }
    setBusy(true);
    try {
      await addComponent(getDb(), actor, projectId, {
        name: name.trim(),
        category,
        order: nextOrder,
        useTemplate,
      });
      onClose();
    } catch (e) {
      onError(e instanceof Error ? e.message : "Could not add the component.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-5 rounded-2xl border border-brass-500/30 bg-night-950/40 p-5">
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField
          id="comp-name"
          label="Component name"
          value={name}
          onChange={setName}
          placeholder="Main kitchen"
          required
        />
        <SelectField
          id="comp-category"
          label="Category"
          value={category}
          onChange={(v) => setCategory(v as ProductCategory)}
          options={PRODUCT_CATEGORIES.map((c) => ({
            value: c,
            label: `${PRODUCT_CATEGORY_LABELS[c]} (${templateItemCount(c)} items)`,
          }))}
        />
      </div>
      <div className="mt-4">
        <CheckboxField
          id="comp-template"
          label={`Pre-fill the ${templateItemCount(category)} standard line items for ${PRODUCT_CATEGORY_LABELS[category]}`}
          checked={useTemplate}
          onChange={setUseTemplate}
        />
        <p className="mt-2 text-xs text-cream-600">
          Items are added unpriced. A zero is visibly unpriced; a guessed figure
          would look deliberate.
        </p>
      </div>
      <div className="mt-5 flex gap-3">
        <Button onClick={submit} busy={busy}>
          Add component
        </Button>
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

function ComponentPanel({
  projectId,
  component,
  open,
  onToggle,
  canEdit,
  actor,
  onError,
}: {
  projectId: string;
  component: ComponentRow;
  open: boolean;
  onToggle: () => void;
  canEdit: boolean;
  actor: { uid: string; email: string; role: "admin" | "manager" | "operator" };
  onError: (m: string) => void;
}) {
  const [features, setFeatures] = useState<FeatureRow[]>([]);
  const [showAll, setShowAll] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [draftName, setDraftName] = useState(component.name);
  const [savingName, setSavingName] = useState(false);
  const [newItem, setNewItem] = useState("");

  // Only the open component subscribes: a templated project carries well over a
  // hundred feature rows, and listening to all of them at once is wasteful.
  useEffect(() => {
    if (!open) return;
    return onSnapshot(
      query(collection(getDb(), featuresPath(projectId, component.id)), orderBy("order", "asc")),
      (snap) =>
        setFeatures(
          snap.docs.map((d) => ({
            id: d.id,
            item: d.data().item ?? "",
            kind: d.data().kind,
            actualQuantity: d.data().actualQuantity ?? null,
            quantity: d.data().quantity ?? 0,
            unitPriceKobo: d.data().unitPriceKobo ?? 0,
            amountKobo: d.data().amountKobo ?? 0,
            order: d.data().order ?? 0,
          }))
        ),
      () => {}
    );
  }, [open, projectId, component.id]);

  const priced = features.filter((f) => f.amountKobo > 0);
  // Unpriced template rows are hidden by default: showing 33 zero lines buries
  // the handful that have actually been costed.
  const visible = showAll ? features : priced;

  return (
    <div className="overflow-hidden rounded-3xl border border-night-700/60 bg-night-900/40">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="flex w-full cursor-pointer items-center justify-between gap-4 p-5 text-left transition-colors hover:bg-night-900/60"
      >
        <span className="flex min-w-0 items-center gap-3">
          {open ? (
            <ChevronDown size={16} className="shrink-0 text-brass-400" />
          ) : (
            <ChevronRight size={16} className="shrink-0 text-cream-500" />
          )}
          <span className="min-w-0">
            <span className="block truncate text-cream-100">{component.name}</span>
            <span className="block text-xs text-cream-500">
              {PRODUCT_CATEGORY_LABELS[component.category]}
            </span>
          </span>
        </span>
        <span className="shrink-0 font-display text-lg text-cream-50">
          {formatNaira(component.estimatedCostKobo)}
        </span>
      </button>

      {open && (
        <div className="border-t border-night-700/60 p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-xs text-cream-500">
              {priced.length} of {features.length} items priced
            </p>
            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => setShowAll((v) => !v)}
                className="cursor-pointer text-xs text-cream-400 transition-colors hover:text-brass-300"
              >
                {showAll ? "Show priced only" : `Show all ${features.length}`}
              </button>
              {canEdit && (
                <button
                  type="button"
                  onClick={() => {
                    setRenaming((v) => !v);
                    setDraftName(component.name);
                  }}
                  className="cursor-pointer text-xs text-cream-400 transition-colors hover:text-brass-300"
                >
                  Rename
                </button>
              )}
              {canEdit && (
                <button
                  type="button"
                  onClick={() =>
                    removeComponent(getDb(), actor, projectId, component.id).catch((e) =>
                      onError(e instanceof Error ? e.message : "Could not remove.")
                    )
                  }
                  className="cursor-pointer text-xs text-cream-500 transition-colors hover:text-red-400"
                >
                  Remove component
                </button>
              )}
            </div>
          </div>

          {renaming && canEdit && (
            <div className="mt-4 flex flex-wrap items-end gap-2 rounded-2xl border border-brass-500/30 bg-night-900/50 p-4">
              <span className="min-w-[14rem] flex-1">
                <TextField
                  id={`rename-${component.id}`}
                  label="Component name"
                  value={draftName}
                  onChange={setDraftName}
                />
              </span>
              <Button
                busy={savingName}
                onClick={() => {
                  setSavingName(true);
                  updateComponent(getDb(), actor, projectId, component.id, {
                    name: draftName,
                  })
                    .then(() => setRenaming(false))
                    .catch((e) =>
                      onError(e instanceof Error ? e.message : "Could not rename.")
                    )
                    .finally(() => setSavingName(false));
                }}
              >
                Save
              </Button>
              <Button variant="ghost" onClick={() => setRenaming(false)}>
                Cancel
              </Button>
            </div>
          )}

          {visible.length === 0 ? (
            <p className="mt-4 text-sm text-cream-500">
              Nothing priced yet. Use &ldquo;Show all&rdquo; to price the standard items.
            </p>
          ) : (
            <div className="mt-4 space-y-2">
              {visible.map((f) => (
                <FeatureRowEditor
                  key={f.id}
                  projectId={projectId}
                  componentId={component.id}
                  feature={f}
                  canEdit={canEdit}
                  actor={actor}
                  onError={onError}
                />
              ))}
            </div>
          )}

          {canEdit && (
            <div className="mt-5 flex flex-wrap items-end gap-3">
              <div className="min-w-[14rem] flex-1">
                <TextField
                  id={`add-item-${component.id}`}
                  label="Add an item not on the list"
                  value={newItem}
                  onChange={setNewItem}
                  placeholder="Bespoke handle"
                />
              </div>
              <Button
                variant="secondary"
                onClick={() => {
                  if (!newItem.trim()) return;
                  addFeature(getDb(), actor, projectId, component.id, {
                    item: newItem.trim(),
                    order: features.length,
                  })
                    .then(() => {
                      setNewItem("");
                      setShowAll(true);
                    })
                    .catch((e) =>
                      onError(e instanceof Error ? e.message : "Could not add the item.")
                    );
                }}
              >
                Add item
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * One feature row, saved on blur.
 *
 * Saving on blur rather than on every keystroke keeps a transaction per field
 * rather than per character, and the row shows its own amount so the effect of a
 * price is visible before the totals above catch up.
 */
function FeatureRowEditor({
  projectId,
  componentId,
  feature,
  canEdit,
  actor,
  onError,
}: {
  projectId: string;
  componentId: string;
  feature: FeatureRow;
  canEdit: boolean;
  actor: { uid: string; email: string; role: "admin" | "manager" | "operator" };
  onError: (m: string) => void;
}) {
  const [item, setItem] = useState(feature.item);
  const [qty, setQty] = useState(feature.quantity ? String(feature.quantity) : "");
  const [price, setPrice] = useState(
    feature.unitPriceKobo ? String(toNaira(feature.unitPriceKobo)) : ""
  );
  const [saving, setSaving] = useState(false);

  // Re-sync when the document changes underneath, e.g. another user edits it.
  useEffect(() => {
    setItem(feature.item);
    setQty(feature.quantity ? String(feature.quantity) : "");
    setPrice(feature.unitPriceKobo ? String(toNaira(feature.unitPriceKobo)) : "");
  }, [feature.item, feature.quantity, feature.unitPriceKobo]);

  const amount = (Number(qty) || 0) * parseNairaInput(price);

  async function commit() {
    const nextQty = Number(qty) || 0;
    const nextPrice = parseNairaInput(price);
    // A blank label falls back to the stored one: templated rows are named for a
    // reason, and an accidental clear should not leave a nameless line.
    const nextItem = item.trim() || feature.item;
    if (
      nextQty === feature.quantity &&
      nextPrice === feature.unitPriceKobo &&
      nextItem === feature.item
    )
      return;

    setSaving(true);
    try {
      await saveFeature(getDb(), actor, projectId, componentId, feature.id, {
        item: nextItem,
        quantity: nextQty,
        unitPriceKobo: nextPrice,
      });
    } catch (e) {
      onError(e instanceof Error ? e.message : "Could not save the line.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="grid items-end gap-3 rounded-xl border border-night-700/40 bg-night-950/30 p-3 sm:grid-cols-[1fr_5rem_7rem_7rem_2rem]">
      {/* The label sits in the same onBlur wrapper as the figures, so renaming a
          line commits on the way out just as pricing it does. */}
      <div className="min-w-0" onBlur={commit}>
        <TextField
          id={`i-${feature.id}`}
          label="Item"
          value={item}
          onChange={setItem}
          disabled={!canEdit}
        />
        {feature.kind === "derived" && (
          <p className="mt-1 text-xs text-cream-600">Lump sum or percentage</p>
        )}
      </div>
      {/* onBlur here rather than on the inputs: NumberField does not expose it,
          and a wrapper catches focus leaving either field. React's onBlur
          bubbles, unlike the native event. */}
      <div onBlur={commit}>
        <NumberField
          id={`q-${feature.id}`}
          label="Qty"
          value={qty}
          onChange={setQty}
          disabled={!canEdit}
        />
      </div>
      <div onBlur={commit}>
        <NumberField
          id={`p-${feature.id}`}
          label="Unit (₦)"
          value={price}
          onChange={setPrice}
          disabled={!canEdit}
        />
      </div>
      <div>
        <p className="mb-1.5 text-sm text-cream-300">Amount</p>
        <p
          className={`px-1 py-3 text-right text-sm ${
            amount > 0 ? "text-brass-300" : "text-cream-600"
          }`}
        >
          {amount > 0 ? formatNaira(amount) : "-"}
        </p>
      </div>
      {canEdit && (
        <div className="flex items-center justify-end gap-1 pb-3">
          {saving ? (
            <Loader2 size={14} className="animate-spin text-brass-400" />
          ) : (
            <>
              <button
                type="button"
                onClick={commit}
                aria-label={`Save ${feature.item}`}
                title="Save"
                className="cursor-pointer rounded px-1 text-xs text-brass-300 hover:text-brass-200"
              >
                Save
              </button>
              <button
                type="button"
                aria-label={`Remove ${feature.item}`}
                onClick={() =>
                  removeFeature(
                    getDb(),
                    actor,
                    projectId,
                    componentId,
                    feature.id,
                    feature.amountKobo
                  ).catch((e) =>
                    onError(e instanceof Error ? e.message : "Could not remove.")
                  )
                }
                className="cursor-pointer text-cream-600 transition-colors hover:text-red-400"
              >
                <Trash2 size={13} />
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function Figure({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent?: boolean;
}) {
  return (
    <div
      className={`rounded-2xl border p-4 ${
        accent ? "border-brass-500/40 bg-brass-500/5" : "border-night-700/60 bg-night-950/40"
      }`}
    >
      <p className="text-xs uppercase tracking-wider text-cream-500">{label}</p>
      <p
        className={`mt-1.5 font-display text-xl ${
          accent ? "text-brass-300" : "text-cream-100"
        }`}
      >
        {value}
      </p>
    </div>
  );
}

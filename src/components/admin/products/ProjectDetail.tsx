"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { collection, doc, getDoc, onSnapshot, orderBy, query } from "firebase/firestore";
import {
  ArrowLeft,
  Check,
  ChevronDown,
  ChevronRight,
  Clock,
  FileText,
  Loader2,
  PenLine,
  Percent,
  Plus,
  RotateCcw,
  Send,
  Trash2,
  UserCheck,
} from "lucide-react";
import { getDb } from "@/lib/firebase";
import { COL, componentsPath, featuresPath } from "@/lib/erp/collections";
import {
  ESTIMATE_STATUS_LABELS,
  PRODUCT_CATEGORIES,
  PRODUCT_CATEGORY_LABELS,
  PROJECT_STATUSES,
  PROJECT_STATUS_LABELS,
  type EstimateStatus,
  type ProductCategory,
  type ProjectStatus,
} from "@/lib/erp/enums";
import { formatNaira, parseNairaInput, toNaira } from "@/lib/erp/money";
import { templateItemCount } from "@/lib/erp/estimateTemplates";
import {
  addComponents,
  addFeature,
  approveProjectEstimate,
  computeEstimateTotals,
  isIncluded,
  removeComponent,
  reopenProjectEstimate,
  setComponentInclusion,
  setProjectMargins,
  updateComponent,
  removeFeature,
  saveFeature,
  setProjectStatus,
} from "@/lib/erp/projects";
import { DEFAULT_INVOICE_SETTINGS } from "@/lib/erp/settings";
import { ESTIMATE_STATUS_TONE, PROJECT_STATUS_TONE } from "@/lib/erp/statusTone";
import { StatusPill } from "@/components/admin/ui/StatusPill";
import { ProjectDetailsEditor } from "@/components/admin/products/ProjectDetailsEditor";
import { EstimatePdfModal } from "@/components/admin/products/EstimatePdfModal";
import { SendForReviewModal } from "@/components/admin/products/SendForReviewModal";
import {
  Button,
  CheckboxField,
  NumberField,
  TextField,
} from "@/components/admin/ui/Fields";
import { useErpSession } from "@/components/admin/ErpAuthProvider";

const fmtDay = (ms: number | null) =>
  ms
    ? new Date(ms).toLocaleDateString("en-GB", {
        day: "numeric",
        month: "short",
        year: "numeric",
      })
    : "";

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
  /* The estimate lives on the project; there is no separate document. */
  errorMarginPercent: number;
  nightowlChargePercent: number;
  estimateVersion: number;
  estimateStatus: EstimateStatus;
  estimateApprovedAtMs: number | null;
  reviewEmail?: string;
  reviewerName?: string;
  reviewSentAtMs: number | null;
  reviewExpiresAtMs: number | null;
  reviewedAtMs: number | null;
  reviewNotes?: string;
  lastEmailedTo?: string;
  lastEmailedAtMs: number | null;
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
  included: boolean;
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
  const canSendForReview = session.can("estimate.sendForReview");
  const canEditEstimate = session.can("estimate.edit");

  const [project, setProject] = useState<ProjectDoc | null>(null);
  const [editingDetails, setEditingDetails] = useState(false);
  const [components, setComponents] = useState<ComponentRow[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [missing, setMissing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [addingComponent, setAddingComponent] = useState(false);
  const [editingRates, setEditingRates] = useState(false);
  const [viewingPdf, setViewingPdf] = useState(false);
  const [sendingForReview, setSendingForReview] = useState(false);

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
          const ms = (v: unknown) =>
            (v as { toMillis?: () => number } | null)?.toMillis?.() ?? null;
          setProject({
            projectNumber: x.projectNumber ?? "",
            customerId: x.customerId ?? "",
            customerName: x.customerName ?? "",
            title: x.title ?? "",
            location: x.location ?? undefined,
            status: (x.status as ProjectStatus) ?? "enquiry",
            estimatedCostKobo: x.estimatedCostKobo ?? 0,
            contractValueKobo: x.contractValueKobo ?? undefined,
            targetDateMs: ms(x.targetDate),
            errorMarginPercent:
              x.errorMarginPercent ?? DEFAULT_INVOICE_SETTINGS.defaultErrorMarginPercent,
            nightowlChargePercent:
              x.nightowlChargePercent ??
              DEFAULT_INVOICE_SETTINGS.defaultNightowlChargePercent,
            estimateVersion: x.estimateVersion ?? 0,
            estimateStatus: (x.estimateStatus as EstimateStatus) ?? "draft",
            estimateApprovedAtMs: ms(x.estimateApprovedAt),
            reviewEmail: x.reviewEmail ?? undefined,
            reviewerName: x.reviewerName ?? undefined,
            reviewSentAtMs: ms(x.reviewSentAt),
            reviewExpiresAtMs: ms(x.reviewExpiresAt),
            reviewedAtMs: ms(x.reviewedAt),
            reviewNotes: x.reviewNotes ?? undefined,
            lastEmailedTo: x.lastEmailedTo ?? undefined,
            lastEmailedAtMs: ms(x.lastEmailedAt),
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

  // Read for the "email to client" field on the estimate PDF. A missing customer or
  // a customer with no email is normal, so this fails quietly.
  const [customerEmail, setCustomerEmail] = useState<string | undefined>();
  useEffect(() => {
    const id = project?.customerId;
    if (!id) return;
    getDoc(doc(getDb(), COL.customers, id))
      .then((snap) => setCustomerEmail(snap.data()?.email || undefined))
      .catch(() => {});
  }, [project?.customerId]);

  const actor = useMemo(
    () => ({
      uid: session.user?.uid ?? "",
      email: session.user?.email ?? "",
      role: session.role ?? "manager",
    }),
    [session.user, session.role]
  );

  // Derived from the project, so pricing a line moves the total immediately.
  const totals = useMemo(
    () =>
      computeEstimateTotals(
        project?.estimatedCostKobo ?? 0,
        project?.errorMarginPercent ?? DEFAULT_INVOICE_SETTINGS.defaultErrorMarginPercent,
        project?.nightowlChargePercent ??
          DEFAULT_INVOICE_SETTINGS.defaultNightowlChargePercent
      ),
    [project?.estimatedCostKobo, project?.errorMarginPercent, project?.nightowlChargePercent]
  );

  function notify(message: string) {
    setNotice(message);
    setTimeout(() => setNotice(""), 6000);
  }
  const [notice, setNotice] = useState("");

  const reviewExpired =
    !!project?.reviewSentAtMs &&
    !project?.reviewedAtMs &&
    project.reviewExpiresAtMs !== null &&
    project.reviewExpiresAtMs < Date.now();

  async function approve() {
    if (!project) return;
    setBusy(true);
    setError("");
    try {
      await approveProjectEstimate(
        getDb(),
        actor,
        projectId,
        project.projectNumber,
        totals.totalKobo
      );
      notify(
        `Approved. The contract value is now ${formatNaira(totals.totalKobo)}.`
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not approve the estimate.");
    } finally {
      setBusy(false);
    }
  }

  async function reopen() {
    if (!project) return;
    setBusy(true);
    setError("");
    try {
      await reopenProjectEstimate(getDb(), actor, projectId, project.projectNumber);
      notify("Reopened for requoting. The agreed contract value still stands.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not reopen the estimate.");
    } finally {
      setBusy(false);
    }
  }

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

      {viewingPdf && (
        <EstimatePdfModal
          projectId={projectId}
          projectNumber={project.projectNumber}
          version={project.estimateVersion}
          customerEmail={customerEmail}
          canEmail={session.role === "admin"}
          onClose={() => setViewingPdf(false)}
          onEmailed={(to) => notify(`Estimate emailed to ${to}.`)}
        />
      )}

      {sendingForReview && (
        <SendForReviewModal
          projectId={projectId}
          projectNumber={project.projectNumber}
          version={project.estimateVersion}
          components={components}
          onClose={() => setSendingForReview(false)}
          onSent={() => notify("Sent for review.")}
        />
      )}

      {/*
       * The estimate.
       *
       * One panel, not a list of versions: the components below are the line items,
       * so this is a live total of them rather than a separate document that has to
       * be regenerated to catch up.
       */}
      <section className="mt-8 rounded-3xl border border-brass-500/30 bg-night-900/40 p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="font-display text-lg text-cream-100">Estimate</h2>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <StatusPill tone={ESTIMATE_STATUS_TONE[project.estimateStatus]}>
                {ESTIMATE_STATUS_LABELS[project.estimateStatus]}
              </StatusPill>
              {project.estimateVersion > 0 && (
                <span className="text-xs text-cream-500">
                  v{project.estimateVersion} issued
                </span>
              )}
              {reviewExpired && (
                <StatusPill tone="danger" title="The review link has expired">
                  Link expired
                </StatusPill>
              )}
            </div>
          </div>
          <div className="text-right">
            <p className="text-xs uppercase tracking-wider text-cream-500">
              {project.contractValueKobo ? "Agreed contract" : "Estimate total"}
            </p>
            <p className="font-display text-2xl text-brass-300">
              {formatNaira(project.contractValueKobo ?? totals.totalKobo)}
            </p>
          </div>
        </div>

        <div className="mt-5 grid gap-4 sm:grid-cols-4">
          <Figure label="Materials & labour" value={formatNaira(totals.subtotalKobo)} />
          <Figure
            label={`Error margin ${project.errorMarginPercent}%`}
            value={formatNaira(totals.errorMarginKobo)}
          />
          <Figure
            label={`Nightowl charge ${project.nightowlChargePercent}%`}
            value={formatNaira(totals.nightowlChargesKobo)}
          />
          <Figure label="Total" value={formatNaira(totals.totalKobo)} accent />
        </div>

        {/* Where the estimate stands with the reviewer and the client, in words. */}
        {(project.reviewSentAtMs || project.lastEmailedTo) && (
          <div className="mt-4 space-y-1.5">
            {project.reviewSentAtMs && (
              <p className="flex flex-wrap items-center gap-1.5 text-xs text-cream-400">
                {project.reviewedAtMs ? (
                  <>
                    <UserCheck size={13} className="text-emerald-400" />
                    Review returned {fmtDay(project.reviewedAtMs)} by{" "}
                    {project.reviewerName || project.reviewEmail}
                  </>
                ) : (
                  <>
                    <Clock size={13} className="text-sky-400" />
                    With {project.reviewerName || project.reviewEmail} since{" "}
                    {fmtDay(project.reviewSentAtMs)}
                    {project.reviewExpiresAtMs && !reviewExpired && (
                      <span className="text-cream-600">
                        · expires {fmtDay(project.reviewExpiresAtMs)}
                      </span>
                    )}
                  </>
                )}
              </p>
            )}
            {project.lastEmailedTo && (
              <p className="text-xs text-cream-500">
                Sent to client {project.lastEmailedTo} on{" "}
                {fmtDay(project.lastEmailedAtMs)}
              </p>
            )}
          </div>
        )}

        {project.reviewNotes && (
          <p className="mt-3 rounded-xl border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs text-amber-200">
            <span className="font-medium">Reviewer&rsquo;s note:</span>{" "}
            {project.reviewNotes}
          </p>
        )}

        {editingRates && canEditEstimate && (
          <div className="mt-5 rounded-2xl border border-brass-500/30 bg-night-950/40 p-4">
            <RatesEditor
              projectId={projectId}
              actor={actor}
              errorMarginPercent={project.errorMarginPercent}
              nightowlChargePercent={project.nightowlChargePercent}
              onClose={() => setEditingRates(false)}
              onError={setError}
              onSaved={(t) => notify(`Estimate now ${formatNaira(t)}.`)}
            />
          </div>
        )}

        <div className="mt-5 flex flex-wrap gap-2">
          <Button variant="secondary" onClick={() => setViewingPdf(true)}>
            <span className="flex items-center gap-2">
              <FileText size={14} /> View / download
            </span>
          </Button>

          {canEditEstimate && (
            <Button variant="secondary" onClick={() => setEditingRates((v) => !v)}>
              <span className="flex items-center gap-2">
                <Percent size={14} /> {editingRates ? "Hide rates" : "Change rates"}
              </span>
            </Button>
          )}

          {canSendForReview && (
            <Button variant="secondary" onClick={() => setSendingForReview(true)}>
              <span className="flex items-center gap-2">
                <Send size={14} />
                {project.reviewSentAtMs && !project.reviewedAtMs
                  ? "Resend for review"
                  : "Send for review"}
              </span>
            </Button>
          )}

          {canApprove && project.estimateStatus !== "approved" && (
            <Button
              busy={busy}
              onClick={approve}
              title="Fixes the project's contract value at this total"
            >
              <span className="flex items-center gap-2">
                <Check size={14} /> Approve
              </span>
            </Button>
          )}

          {canApprove && project.estimateStatus === "approved" && (
            <Button variant="secondary" busy={busy} onClick={reopen}>
              <span className="flex items-center gap-2">
                <RotateCcw size={14} /> Reopen to requote
              </span>
            </Button>
          )}
        </div>

        {project.estimateStatus === "approved" && (
          <>
            <p className="mt-3 text-xs text-cream-500">
              Approved {fmtDay(project.estimateApprovedAtMs)}. The contract value is
              fixed at {formatNaira(project.contractValueKobo ?? 0)} and is what
              invoices bill against; editing components below changes the estimate but
              not the agreed figure.
            </p>
            {/* Said plainly rather than left to be noticed. The server refuses to
                email a drifted estimate, and finding that out at the point of
                sending is later than anyone wants to hear it. */}
            {!!project.contractValueKobo &&
              totals.totalKobo !== project.contractValueKobo && (
                <p className="mt-2 rounded-xl border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs text-amber-200">
                  Edited since approval: now {formatNaira(totals.totalKobo)} against
                  the agreed {formatNaira(project.contractValueKobo)}. Reopen and
                  re-approve, or restore the prices, before sending this to the
                  client.
                </p>
              )}
          </>
        )}
      </section>

      {/* Components — the estimate's line items */}
      <section className="mt-8">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="font-display text-lg text-cream-100">
              Components{" "}
              {components.length > 0 && (
                <span className="text-cream-500">({components.length})</span>
              )}
            </h2>
            <p className="mt-1 text-xs text-cream-500">
              These are the estimate&rsquo;s line items. What is ticked is what the
              client is quoted.
            </p>
          </div>
          {canEdit && !addingComponent && (
            <button
              type="button"
              onClick={() => setAddingComponent(true)}
              className="flex cursor-pointer items-center gap-2 text-sm text-brass-300 transition-colors hover:text-brass-200"
            >
              <Plus size={15} /> Add components
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
            onAdded={(n) =>
              notify(n === 1 ? "Component added." : `${n} components added.`)
            }
          />
        )}

        {components.length === 0 && !addingComponent ? (
          <p className="mt-5 rounded-3xl border border-night-700/60 bg-night-900/40 p-8 text-center text-sm text-cream-500">
            No components yet. Add one or more and each will pull in the standard line
            items for that kind of work.
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

/**
 * Sets the two rates the estimate adds on top of the components.
 *
 * Saved to the project rather than held on screen, so the figure here is the figure
 * the PDF prints and the client is quoted. Neither rate is a reviewer's to set.
 */
function RatesEditor({
  projectId,
  actor,
  errorMarginPercent,
  nightowlChargePercent,
  onClose,
  onError,
  onSaved,
}: {
  projectId: string;
  actor: { uid: string; email: string; role: "admin" | "manager" | "operator" };
  errorMarginPercent: number;
  nightowlChargePercent: number;
  onClose: () => void;
  onError: (m: string) => void;
  onSaved: (totalKobo: number) => void;
}) {
  const [margin, setMargin] = useState(String(errorMarginPercent));
  const [charge, setCharge] = useState(String(nightowlChargePercent));
  const [busy, setBusy] = useState(false);

  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2">
        <NumberField
          id="err-margin"
          label="Error margin (%)"
          value={margin}
          onChange={setMargin}
        />
        <NumberField
          id="no-charge"
          label="Nightowl charge (%)"
          value={charge}
          onChange={setCharge}
        />
      </div>
      <p className="mt-2 text-xs text-cream-500">
        Both apply to the component subtotal only, never to each other.
      </p>
      <div className="mt-4 flex gap-3">
        <Button
          busy={busy}
          onClick={() => {
            setBusy(true);
            setProjectMargins(getDb(), actor, projectId, {
              errorMarginPercent: Number(margin) || 0,
              nightowlChargePercent: Number(charge) || 0,
            })
              .then(() => {
                onClose();
                onSaved(0);
              })
              .catch((e: unknown) =>
                onError(e instanceof Error ? e.message : "Could not save the rates.")
              )
              .finally(() => setBusy(false));
          }}
        >
          Save rates
        </Button>
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
      </div>
    </>
  );
}

/**
 * Adds one or more components, each pre-filled from its category template.
 *
 * Multi-select because a project is quoted as a kitchen *and* two closets *and* a
 * run of doors, and adding them one dialog at a time made the common case the slow
 * one. Each ticked category gets a name field, defaulted to the category label so
 * the form is usable without typing but still editable when a project has two of
 * the same kind ("Kitchen" and "Pantry kitchen").
 */
function AddComponentForm({
  projectId,
  actor,
  nextOrder,
  onClose,
  onError,
  onAdded,
}: {
  projectId: string;
  actor: { uid: string; email: string; role: "admin" | "manager" | "operator" };
  nextOrder: number;
  onClose: () => void;
  onError: (m: string) => void;
  onAdded: (count: number) => void;
}) {
  const [picked, setPicked] = useState<Record<string, boolean>>({});
  const [names, setNames] = useState<Record<string, string>>({});
  const [useTemplate, setUseTemplate] = useState(true);
  const [busy, setBusy] = useState(false);

  const chosen = PRODUCT_CATEGORIES.filter((c) => picked[c]);
  const totalItems = chosen.reduce((s, c) => s + templateItemCount(c), 0);

  async function submit() {
    if (chosen.length === 0) {
      onError("Pick at least one component.");
      return;
    }
    setBusy(true);
    try {
      await addComponents(
        getDb(),
        actor,
        projectId,
        chosen.map((c) => ({
          name: (names[c] ?? "").trim() || PRODUCT_CATEGORY_LABELS[c],
          category: c,
          useTemplate,
        })),
        nextOrder
      );
      onAdded(chosen.length);
      onClose();
    } catch (e) {
      onError(e instanceof Error ? e.message : "Could not add the components.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-5 rounded-2xl border border-brass-500/30 bg-night-950/40 p-5">
      <p className="text-sm text-cream-300">
        Which components does this project include?
      </p>
      <div className="mt-3 space-y-2">
        {PRODUCT_CATEGORIES.map((c) => {
          const on = !!picked[c];
          return (
            <div
              key={c}
              className={`rounded-xl border p-3 transition-colors ${
                on
                  ? "border-brass-500/40 bg-brass-500/5"
                  : "border-night-700/50 bg-night-900/30"
              }`}
            >
              <label
                htmlFor={`pick-${c}`}
                className="flex cursor-pointer items-center gap-3 text-sm text-cream-200"
              >
                <input
                  id={`pick-${c}`}
                  type="checkbox"
                  checked={on}
                  onChange={(e) =>
                    setPicked((p) => ({ ...p, [c]: e.target.checked }))
                  }
                  className="h-4 w-4 cursor-pointer accent-brass-500"
                />
                <span className="flex-1">{PRODUCT_CATEGORY_LABELS[c]}</span>
                <span className="text-xs text-cream-500">
                  {templateItemCount(c)} items
                </span>
              </label>
              {/* The name only matters once the category is in, so it appears then
                  rather than presenting six empty boxes up front. */}
              {on && (
                <div className="mt-3">
                  <TextField
                    id={`name-${c}`}
                    label="Name it"
                    value={names[c] ?? ""}
                    onChange={(v) => setNames((p) => ({ ...p, [c]: v }))}
                    placeholder={PRODUCT_CATEGORY_LABELS[c]}
                    hint="Optional"
                  />
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="mt-4">
        <CheckboxField
          id="comp-template"
          label={
            chosen.length
              ? `Pre-fill ${totalItems} standard line items across ${chosen.length} ${
                  chosen.length === 1 ? "component" : "components"
                }`
              : "Pre-fill the standard line items"
          }
          checked={useTemplate}
          onChange={setUseTemplate}
        />
        <p className="mt-2 text-xs text-cream-600">
          Items are added unpriced and unticked. A zero is visibly unpriced; a guessed
          figure would look deliberate.
        </p>
      </div>

      <div className="mt-5 flex gap-3">
        <Button onClick={submit} busy={busy}>
          {chosen.length > 1 ? `Add ${chosen.length} components` : "Add component"}
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
  /** "included" hides the untouched checklist; "all" is the working view. */
  const [view, setView] = useState<"all" | "included">("all");
  const [renaming, setRenaming] = useState(false);
  const [draftName, setDraftName] = useState(component.name);
  const [savingName, setSavingName] = useState(false);
  const [newItem, setNewItem] = useState("");
  const [bulking, setBulking] = useState(false);

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
            included: isIncluded(d.data()),
            order: d.data().order ?? 0,
          }))
        ),
      () => {}
    );
  }, [open, projectId, component.id]);

  const included = features.filter((f) => f.included);
  const priced = features.filter((f) => f.amountKobo > 0);
  // Every row shows by default. The template is a checklist, and a checklist you
  // cannot see is not one: hiding the unpriced rows meant the 33 items a kitchen
  // is quoted from were only reachable through a toggle most people never found.
  const visible = view === "all" ? features : included;

  async function bulk(next: boolean, onlyPriced: boolean) {
    setBulking(true);
    try {
      await setComponentInclusion(
        getDb(),
        actor,
        projectId,
        component.id,
        next,
        { onlyPriced }
      );
    } catch (e) {
      onError(e instanceof Error ? e.message : "Could not update the lines.");
    } finally {
      setBulking(false);
    }
  }

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
              {included.length} of {features.length} items included
              {priced.length !== included.length && (
                <span className="text-cream-600"> · {priced.length} priced</span>
              )}
            </p>
            <div className="flex flex-wrap gap-3">
              <button
                type="button"
                onClick={() => setView((v) => (v === "all" ? "included" : "all"))}
                className="cursor-pointer text-xs text-cream-400 transition-colors hover:text-brass-300"
              >
                {view === "all"
                  ? `Show included only (${included.length})`
                  : `Show all ${features.length}`}
              </button>
              {canEdit && features.length > 0 && (
                <button
                  type="button"
                  disabled={bulking}
                  onClick={() => bulk(true, true)}
                  title="Tick every line that has an amount"
                  className="cursor-pointer text-xs text-cream-400 transition-colors hover:text-brass-300 disabled:opacity-50"
                >
                  Include priced
                </button>
              )}
              {canEdit && included.length > 0 && (
                <button
                  type="button"
                  disabled={bulking}
                  onClick={() => bulk(false, false)}
                  className="cursor-pointer text-xs text-cream-400 transition-colors hover:text-brass-300 disabled:opacity-50"
                >
                  Clear all
                </button>
              )}
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
              {features.length === 0
                ? "No line items. Add one below, or recreate the component with its template to pull in the standard checklist."
                : "Nothing included yet. Tick the lines this job needs, or use “Show all” to work through the checklist."}
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
                      setView("all");
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
 *
 * The tick saves immediately instead of on blur. It is a single decision with no
 * half-typed state to protect, and waiting for focus to leave a checkbox would
 * leave the totals disagreeing with what the box plainly shows.
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

  async function commit(overrides: { included?: boolean } = {}) {
    const nextQty = Number(qty) || 0;
    const nextPrice = parseNairaInput(price);
    // A blank label falls back to the stored one: templated rows are named for a
    // reason, and an accidental clear should not leave a nameless line.
    const nextItem = item.trim() || feature.item;
    if (
      overrides.included === undefined &&
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
        ...overrides,
      });
    } catch (e) {
      onError(e instanceof Error ? e.message : "Could not save the line.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      className={`grid items-end gap-3 rounded-xl border p-3 transition-colors sm:grid-cols-[1.5rem_1fr_5rem_7rem_7rem_2rem] ${
        feature.included
          ? "border-brass-500/30 bg-night-950/50"
          : "border-night-700/40 bg-night-950/20"
      }`}
    >
      {/* The tick is the first thing in the row because it is the first decision:
          whether this job needs the item at all, before what it costs. */}
      <div className="flex items-center pb-3.5">
        <input
          id={`inc-${feature.id}`}
          type="checkbox"
          checked={feature.included}
          disabled={!canEdit || saving}
          onChange={(e) => commit({ included: e.target.checked })}
          aria-label={`Include ${feature.item} in the estimate`}
          title={
            feature.included ? "Included in the estimate" : "Not on the estimate"
          }
          className="h-4 w-4 cursor-pointer accent-brass-500 disabled:cursor-not-allowed"
        />
      </div>
      {/* The label sits in the same onBlur wrapper as the figures, so renaming a
          line commits on the way out just as pricing it does. */}
      <div className="min-w-0" onBlur={() => commit()}>
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
      <div onBlur={() => commit()}>
        <NumberField
          id={`q-${feature.id}`}
          label="Qty"
          value={qty}
          onChange={setQty}
          disabled={!canEdit}
        />
      </div>
      <div onBlur={() => commit()}>
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
        {/* A priced but unticked line shows its figure struck through: the number
            is real, it just is not in the total, and blanking it would look like
            the price had been lost. */}
        <p
          className={`px-1 py-3 text-right text-sm ${
            amount > 0
              ? feature.included
                ? "text-brass-300"
                : "text-cream-600 line-through"
              : "text-cream-600"
          }`}
          title={
            amount > 0 && !feature.included ? "Priced, but not on the estimate" : undefined
          }
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
                onClick={() => commit()}
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
                    feature.id
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

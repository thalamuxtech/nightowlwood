"use client";

import { useEffect, useState } from "react";
import {
  collection,
  getCountFromServer,
  onSnapshot,
  query,
  where,
} from "firebase/firestore";
import {
  Check,
  ChevronDown,
  ChevronRight,
  Clock,
  FileText,
  Loader2,
  Send,
  UserCheck,
} from "lucide-react";
import { getDb } from "@/lib/firebase";
import { COL, estimateLinesPath } from "@/lib/erp/collections";
import { ESTIMATE_STATUS_LABELS, type EstimateStatus } from "@/lib/erp/enums";
import { ESTIMATE_STATUS_TONE } from "@/lib/erp/statusTone";
import { formatNaira } from "@/lib/erp/money";
import { approveEstimate } from "@/lib/erp/projects";
import type { AuditActor } from "@/lib/erp/audit";
import { StatusPill } from "@/components/admin/ui/StatusPill";
import { Button } from "@/components/admin/ui/Fields";
import { EstimatePdfModal } from "@/components/admin/products/EstimatePdfModal";
import { EstimateLinesEditor } from "@/components/admin/products/EstimateLinesEditor";
import { SendForReviewModal } from "@/components/admin/products/SendForReviewModal";

/**
 * The estimates issued for a project.
 *
 * Every version is listed, superseded ones included. An estimate is a thing that was
 * sent to someone, so the history is the record of what the client has seen; hiding
 * the old versions would make a disagreement about "what you quoted me" impossible
 * to settle from the system.
 *
 * Three things happen from here: view or download the PDF, send it to an outside
 * professional for review, and approve it. Approving fixes the project's contract
 * value, so it is the one action gated on its own capability.
 */

interface EstimateRow {
  id: string;
  version: number;
  status: EstimateStatus;
  subtotalKobo: number;
  errorMarginPercent: number;
  nightowlChargesKobo: number;
  totalKobo: number;
  createdAtMs: number | null;
  reviewEmail?: string;
  reviewerName?: string;
  reviewSentAtMs: number | null;
  reviewExpiresAtMs: number | null;
  reviewedAtMs: number | null;
  reviewNotes?: string;
  lastEmailedTo?: string;
  lastEmailedAtMs: number | null;
  lineCount: number;
}

const ms = (v: unknown): number | null => {
  const t = v as { toMillis?: () => number } | null | undefined;
  return typeof t?.toMillis === "function" ? t.toMillis() : null;
};

const fmtDate = (v: number | null) =>
  v ? new Date(v).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "";

export function ProjectEstimates({
  projectId,
  projectNumber,
  customerEmail,
  actor,
  canSendForReview,
  canApprove,
  canEditLines,
  isAdmin,
  onError,
  onNotice,
}: {
  projectId: string;
  projectNumber: string;
  customerEmail?: string;
  actor: AuditActor;
  canSendForReview: boolean;
  canApprove: boolean;
  canEditLines: boolean;
  /** Emailing a client is admin-only server-side; the button follows. */
  isAdmin: boolean;
  onError: (m: string) => void;
  onNotice: (m: string) => void;
}) {
  const [rows, setRows] = useState<EstimateRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [viewing, setViewing] = useState<EstimateRow | null>(null);
  const [reviewing, setReviewing] = useState<EstimateRow | null>(null);
  const [approvingId, setApprovingId] = useState<string | null>(null);
  /** Only one estimate's lines are subscribed at a time; each carries dozens. */
  const [openId, setOpenId] = useState<string | null>(null);

  useEffect(() => {
    if (!projectId) return;
    // Filtered server-side on projectId. Reading the whole estimates collection to
    // find one project's would bill against every estimate the business has issued.
    return onSnapshot(
      query(collection(getDb(), COL.estimates), where("projectId", "==", projectId)),
      (snap) => {
        const next = snap.docs.map((d) => {
          const x = d.data();
          return {
            id: d.id,
            version: x.version ?? 1,
            status: (x.status as EstimateStatus) ?? "draft",
            subtotalKobo: x.subtotalKobo ?? 0,
            errorMarginPercent: x.errorMarginPercent ?? 0,
            nightowlChargesKobo: x.nightowlChargesKobo ?? 0,
            totalKobo: x.totalKobo ?? 0,
            createdAtMs: ms(x.createdAt),
            reviewEmail: x.reviewEmail || undefined,
            reviewerName: x.reviewerName || undefined,
            reviewSentAtMs: ms(x.reviewSentAt),
            reviewExpiresAtMs: ms(x.reviewExpiresAt),
            reviewedAtMs: ms(x.reviewedAt),
            reviewNotes: x.reviewNotes || undefined,
            lastEmailedTo: x.lastEmailedTo || undefined,
            lastEmailedAtMs: ms(x.lastEmailedAt),
            lineCount: 0,
          } satisfies EstimateRow;
        });
        // Newest first. Ordered here rather than in the query: an orderBy alongside
        // the projectId filter needs a composite index, and a project has a handful
        // of estimates at most.
        next.sort((a, b) => b.version - a.version);
        setRows(next);
        setLoading(false);
      },
      (e) => {
        onError(e.message);
        setLoading(false);
      }
    );
  }, [projectId, onError]);

  /**
   * Opens the review dialog with the line count filled in.
   *
   * Counted on demand with an aggregation query rather than carried on every row: the
   * count is only needed for the one estimate being sent, and it appears in the
   * reviewer's email, so it should be right at the moment of sending. A failed count
   * is not worth blocking the send for — the figure is informational.
   */
  async function openReview(row: EstimateRow) {
    setReviewing(row);
    try {
      const snap = await getCountFromServer(
        collection(getDb(), estimateLinesPath(row.id))
      );
      const lineCount = snap.data().count;
      setReviewing((current) =>
        current && current.id === row.id ? { ...current, lineCount } : current
      );
    } catch {
      // Leaves the count at zero; the modal reads "0 priced lines will be sent",
      // which is wrong but harmless next to refusing to open the dialog.
    }
  }

  async function approve(row: EstimateRow) {
    setApprovingId(row.id);
    try {
      await approveEstimate(getDb(), actor, row.id, projectId, row.totalKobo);
      onNotice(
        `Estimate v${row.version} approved. The contract value is now ${formatNaira(row.totalKobo)}.`
      );
    } catch (e) {
      onError(e instanceof Error ? e.message : "Could not approve the estimate.");
    } finally {
      setApprovingId(null);
    }
  }

  if (loading) {
    return (
      <section className="mt-8">
        <h2 className="font-display text-lg text-cream-100">Estimates</h2>
        <div className="mt-5 flex justify-center rounded-3xl border border-night-700/60 bg-night-900/40 p-8">
          <Loader2 className="animate-spin text-brass-400" size={22} aria-label="Loading" />
        </div>
      </section>
    );
  }

  return (
    <section className="mt-8">
      {viewing && (
        <EstimatePdfModal
          estimateId={viewing.id}
          projectNumber={projectNumber}
          version={viewing.version}
          customerEmail={customerEmail}
          // The server refuses to email a mid-review or superseded estimate; the
          // button is hidden for the same cases so it cannot be tried and fail.
          canEmail={
            isAdmin && viewing.status !== "in_review" && viewing.status !== "superseded"
          }
          onClose={() => setViewing(null)}
          onEmailed={(to) => onNotice(`Estimate emailed to ${to}.`)}
        />
      )}

      {reviewing && (
        <SendForReviewModal
          estimateId={reviewing.id}
          projectNumber={projectNumber}
          version={reviewing.version}
          lineCount={reviewing.lineCount}
          onClose={() => setReviewing(null)}
          onSent={() => onNotice("Sent for review.")}
        />
      )}

      <h2 className="font-display text-lg text-cream-100">
        Estimates {rows.length > 0 && <span className="text-cream-500">({rows.length})</span>}
      </h2>

      {rows.length === 0 ? (
        <p className="mt-5 rounded-3xl border border-night-700/60 bg-night-900/40 p-8 text-center text-sm text-cream-500">
          No estimates yet. Tick the line items this job includes above, then use
          &ldquo;Create estimate&rdquo; to snapshot them into a versioned document.
        </p>
      ) : (
        <div className="mt-5 space-y-3">
          {rows.map((r) => {
            const expired =
              r.status === "in_review" &&
              r.reviewExpiresAtMs !== null &&
              r.reviewExpiresAtMs < Date.now();

            return (
              <div
                key={r.id}
                className={`rounded-3xl border p-5 ${
                  r.status === "approved"
                    ? "border-emerald-500/30 bg-emerald-500/5"
                    : r.status === "superseded"
                      ? "border-night-700/40 bg-night-900/20"
                      : "border-night-700/60 bg-night-900/40"
                }`}
              >
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-3">
                      <span className="font-display text-base text-cream-100">
                        Version {r.version}
                      </span>
                      <StatusPill tone={ESTIMATE_STATUS_TONE[r.status]}>
                        {ESTIMATE_STATUS_LABELS[r.status]}
                      </StatusPill>
                      {expired && (
                        <StatusPill tone="danger" title="The review link has expired">
                          Link expired
                        </StatusPill>
                      )}
                    </div>
                    <p className="mt-2 text-xs text-cream-500">
                      Created {fmtDate(r.createdAtMs)} · subtotal{" "}
                      {formatNaira(r.subtotalKobo)}
                    </p>

                    {/* Review state, in words. Who has it and whether it came back is
                        the question this panel exists to answer. */}
                    {r.reviewSentAtMs && (
                      <p className="mt-2 flex flex-wrap items-center gap-1.5 text-xs text-cream-400">
                        {r.reviewedAtMs ? (
                          <>
                            <UserCheck size={13} className="text-emerald-400" />
                            Returned {fmtDate(r.reviewedAtMs)} by{" "}
                            {r.reviewerName || r.reviewEmail}
                          </>
                        ) : (
                          <>
                            <Clock size={13} className="text-sky-400" />
                            With {r.reviewerName || r.reviewEmail} since{" "}
                            {fmtDate(r.reviewSentAtMs)}
                            {r.reviewExpiresAtMs && !expired && (
                              <span className="text-cream-600">
                                · expires {fmtDate(r.reviewExpiresAtMs)}
                              </span>
                            )}
                          </>
                        )}
                      </p>
                    )}

                    {r.lastEmailedTo && (
                      <p className="mt-1.5 text-xs text-cream-500">
                        Sent to client {r.lastEmailedTo} on{" "}
                        {fmtDate(r.lastEmailedAtMs)}
                      </p>
                    )}

                    {r.reviewNotes && (
                      <p className="mt-3 rounded-xl border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs text-amber-200">
                        <span className="font-medium">Reviewer&rsquo;s note:</span>{" "}
                        {r.reviewNotes}
                      </p>
                    )}
                  </div>

                  <div className="text-right">
                    <p className="font-display text-xl text-brass-300">
                      {formatNaira(r.totalKobo)}
                    </p>
                  </div>
                </div>

                <div className="mt-4 flex flex-wrap gap-2">
                  <Button
                    variant="secondary"
                    onClick={() => setOpenId(openId === r.id ? null : r.id)}
                  >
                    <span className="flex items-center gap-2">
                      {openId === r.id ? (
                        <ChevronDown size={14} />
                      ) : (
                        <ChevronRight size={14} />
                      )}
                      {r.status === "approved" ? "View lines" : "Edit lines"}
                    </span>
                  </Button>

                  <Button variant="secondary" onClick={() => setViewing(r)}>
                    <span className="flex items-center gap-2">
                      <FileText size={14} /> View / download
                    </span>
                  </Button>

                  {canSendForReview &&
                    r.status !== "approved" &&
                    r.status !== "superseded" && (
                      <Button variant="secondary" onClick={() => openReview(r)}>
                        <span className="flex items-center gap-2">
                          <Send size={14} />
                          {r.reviewSentAtMs && !r.reviewedAtMs
                            ? "Resend for review"
                            : "Send for review"}
                        </span>
                      </Button>
                    )}

                  {canApprove &&
                    r.status !== "approved" &&
                    r.status !== "superseded" && (
                      <Button
                        busy={approvingId === r.id}
                        onClick={() => approve(r)}
                        title="Fixes the project's contract value at this total"
                      >
                        <span className="flex items-center gap-2">
                          <Check size={14} /> Approve
                        </span>
                      </Button>
                    )}
                </div>

                {openId === r.id && (
                  <EstimateLinesEditor
                    estimateId={r.id}
                    actor={actor}
                    locked={r.status === "approved" || !canEditLines}
                    errorMarginPercent={r.errorMarginPercent}
                    nightowlChargePercent={
                      r.subtotalKobo > 0
                        ? Math.round((r.nightowlChargesKobo / r.subtotalKobo) * 1000) / 10
                        : 0
                    }
                    onError={onError}
                    onNotice={onNotice}
                  />
                )}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

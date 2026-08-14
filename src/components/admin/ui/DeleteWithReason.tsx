"use client";

import { useState } from "react";
import { AlertTriangle, ShieldAlert, Trash2 } from "lucide-react";
import { getDb } from "@/lib/firebase";
import { clearStaleLock, deleteOrRequest } from "@/lib/erp/approvals";
import { Button, TextAreaField } from "@/components/admin/ui/Fields";
import { useAuditActor, useErpSession } from "@/components/admin/ErpAuthProvider";

/**
 * The delete control for records whose removal changes what somebody is owed.
 *
 * It always asks why, and it decides on its own whether that becomes a deletion or a
 * request — so the caller does not branch on role. A `window.confirm` cannot capture a
 * reason, which is why this replaces them.
 *
 * **It is not on every delete, by design.** Approval only means something when the approver
 * is a different person who will actually read the request; route every supplier and stock
 * item through it in a one-admin workshop and you get an inbox rubber-stamped weekly, which
 * is worse than no gate because the trail then claims scrutiny that did not happen. So this
 * guards the deletes that move money — work logs, wage and salary runs, recorded payments —
 * and everything else keeps its direct delete plus its audit entry, which already records
 * who did it and why. Which operations require approval is configurable in Settings, so the
 * line can move without a code change.
 *
 * `hardDelete` is supplied by the caller because teardown is module-specific: a project
 * purchase has to take its expense with it, a wage run its lines. Those rules live with
 * the module that owns them, not here.
 */
export function DeleteWithReason({
  targetCollection,
  targetId,
  targetLabel,
  /** What is being removed, in a sentence, for the confirmation copy. */
  description,
  before,
  hardDelete,
  onDone,
  onError,
  /** Set when the record already has a change awaiting a decision. */
  locked,
  size = "icon",
  startOpen,
}: {
  targetCollection: string;
  targetId: string;
  targetLabel: string;
  description?: string;
  before?: Record<string, unknown>;
  hardDelete: () => Promise<void>;
  onDone: (message: string) => void;
  onError: (message: string) => void;
  locked?: boolean;
  size?: "icon" | "button";
  /**
   * Renders the reason panel straight away, without its own trigger.
   *
   * For callers that already have a delete button — a table row whose narrow action cell
   * cannot hold the panel, so the row below opens it instead.
   */
  startOpen?: boolean;
}) {
  const session = useErpSession();
  const actor = useAuditActor();
  /**
   * Whether this person may delete outright.
   *
   * `record.delete` is the direct-deletion grant; anyone else with `approval.request`
   * gets a queued request instead. Read as capabilities rather than roles so an admin can
   * widen or narrow either without a code change.
   */
  const canDeleteDirectly = session.can("record.delete");
  const canRequest = session.can("approval.request");

  const [open, setOpen] = useState(startOpen === true);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  // Nothing to offer: no direct grant and no ability to ask.
  if (!canDeleteDirectly && !canRequest) return null;

  if (locked) {
    return (
      <span className="flex items-center gap-1.5 text-xs text-amber-300">
        <span
          title="A change on this record is already waiting for a decision."
          className="flex items-center gap-1"
        >
          <AlertTriangle size={13} /> pending
        </span>
        {/*
         * The escape hatch, for whoever can decide requests.
         *
         * A lock outlives its request if the request document is deleted, and the record was
         * then uneditable forever with nothing in the queue to explain why — the only fix was
         * the Firebase console. `clearStaleLock` refuses to touch a lock whose request is
         * genuinely still open, so this cannot be used to skip a decision.
         */}
        {session.can("approval.decide") && (
          <button
            type="button"
            onClick={async () => {
              try {
                await clearStaleLock(getDb(), actor, targetCollection, targetId);
                onDone("Cleared the stale lock on that record.");
              } catch (e) {
                onError(
                  e instanceof Error ? e.message : "Could not clear the lock on that record."
                );
              }
            }}
            title="Clear the lock if its request is gone or already decided"
            className="cursor-pointer text-cream-500 underline decoration-dotted transition-all duration-300 hover:text-cream-300"
          >
            clear
          </button>
        )}
      </span>
    );
  }

  async function submit() {
    const trimmed = reason.trim();
    if (!trimmed) {
      onError("Give a reason. It is recorded either way.");
      return;
    }
    setBusy(true);
    try {
      const res = await deleteOrRequest(getDb(), actor, {
        targetCollection,
        targetId,
        targetLabel,
        reason: trimmed,
        canDeleteDirectly,
        before,
        hardDelete,
      });
      onDone(
        res.outcome === "deleted"
          ? `${targetLabel} deleted.`
          : `Sent for approval: ${targetLabel} cannot be removed until an administrator agrees.`
      );
      setOpen(false);
      setReason("");
    } catch (e) {
      onError(e instanceof Error ? e.message : "Could not complete that.");
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return size === "icon" ? (
      <button
        type="button"
        aria-label={`Delete ${targetLabel}`}
        title={
          canDeleteDirectly
            ? "Delete. A reason is recorded."
            : "Request deletion. An administrator has to agree."
        }
        onClick={() => setOpen(true)}
        className="cursor-pointer text-cream-500 transition-colors hover:text-red-400"
      >
        <Trash2 size={15} />
      </button>
    ) : (
      <Button variant="danger" onClick={() => setOpen(true)}>
        <span className="flex items-center gap-1.5">
          <Trash2 size={14} />
          {canDeleteDirectly ? "Delete" : "Request deletion"}
        </span>
      </Button>
    );
  }

  return (
    <div className="mt-3 w-full rounded-2xl border border-red-500/40 bg-red-500/5 p-4">
      <p className="flex items-start gap-2 text-sm text-red-300">
        <ShieldAlert size={16} className="mt-0.5 shrink-0" />
        <span>
          {canDeleteDirectly
            ? `Delete ${targetLabel}?`
            : `Ask to delete ${targetLabel}?`}
          {description && (
            <span className="mt-1 block text-cream-400">{description}</span>
          )}
          {!canDeleteDirectly && (
            <span className="mt-1 block text-cream-400">
              Nothing is removed until an administrator approves it. The record is locked
              from other changes meanwhile.
            </span>
          )}
        </span>
      </p>

      <div className="mt-3">
        <TextAreaField
          id={`del-reason-${targetId}`}
          label="Reason"
          value={reason}
          onChange={setReason}
          rows={2}
          placeholder="e.g. entered against the wrong customer"
        />
      </div>

      <div className="mt-3 flex flex-wrap gap-3">
        <Button variant="danger" onClick={submit} busy={busy}>
          {canDeleteDirectly ? "Delete" : "Send for approval"}
        </Button>
        <Button
          variant="ghost"
          onClick={() => {
            setOpen(false);
            setReason("");
          }}
        >
          Cancel
        </Button>
      </div>
    </div>
  );
}

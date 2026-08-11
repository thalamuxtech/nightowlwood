"use client";

import { useState } from "react";
import { AlertTriangle, ShieldAlert, Trash2 } from "lucide-react";
import { getDb } from "@/lib/firebase";
import { deleteOrRequest } from "@/lib/erp/approvals";
import { Button, TextAreaField } from "@/components/admin/ui/Fields";
import { useErpSession } from "@/components/admin/ErpAuthProvider";

/**
 * The one delete control every screen should use.
 *
 * It always asks why, and it decides on its own whether that becomes a deletion or a
 * request — so no screen has to branch on role, and none can quietly skip the queue. A
 * `window.confirm` cannot capture a reason, which is why this replaces them.
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
      <span
        title="A change on this record is already waiting for a decision."
        className="flex items-center gap-1 text-xs text-amber-300"
      >
        <AlertTriangle size={13} /> pending
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
      const res = await deleteOrRequest(getDb(), {
        uid: session.user?.uid ?? "",
        email: session.user?.email ?? "",
        role: session.role ?? "manager",
      }, {
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

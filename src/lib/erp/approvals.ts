import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  updateDoc,
  where,
  type Firestore,
} from "firebase/firestore";
import { COL } from "./collections";
import type { ApprovalRequest } from "./types";
import { writeAudit, type AuditActor } from "./audit";

/**
 * Approval workflow for deletions and consequential edits.
 *
 * Nothing destructive happens because one person clicked a button. A request carries a
 * reason, an admin sees the reason and the exact before/after, and only then does the
 * change land. The audit log records both halves — who asked and who allowed it — which
 * is what makes a dispute months later answerable.
 *
 * Three decisions worth stating:
 *
 * 1. **The change is held, not applied-and-reverted.** A reverted write has already been
 *    seen: a wage run would have read a deleted work log, a report would have shown a
 *    changed figure. Storing the intent and applying it once, on approval, means the
 *    record only ever passes through states somebody authorised.
 *
 * 2. **The target is locked while pending.** `pendingApprovalId` is written on the record
 *    itself, so every screen can show that a change is in flight and refuse a second one.
 *    Two people editing the same figure through two queued requests, each approved
 *    against a before-image that no longer holds, is the failure this prevents.
 *
 * 3. **An admin's own action still records a reason.** It applies immediately — there is
 *    nobody above them to ask — but the reason is captured and audited exactly the same
 *    way. The value of a reason is the record, not the gatekeeping.
 */

/** Fields the workflow writes on a target record. Never business data. */
export const APPROVAL_LOCK_FIELDS = ["pendingApprovalId", "pendingApprovalKind"] as const;

export interface RaiseRequestInput {
  kind: "delete" | "update";
  targetCollection: string;
  targetId: string;
  /** Reads in the queue without resolving the target, e.g. "INV-2026-0007 · Musa". */
  targetLabel: string;
  reason: string;
  /** Fields to write on approval. Omitted for a deletion. */
  payload?: Record<string, unknown>;
  /** The fields being changed, as they stand now, for the reviewer to compare against. */
  before?: Record<string, unknown>;
}

/**
 * Raises a request and marks the target as having one pending.
 *
 * Both in one transaction: a request whose target is not locked lets a second request be
 * raised against the same record, and a locked record with no request can never be
 * unlocked.
 */
export async function requestApproval(
  db: Firestore,
  actor: AuditActor,
  input: RaiseRequestInput
): Promise<string> {
  const reason = input.reason.trim();
  if (!reason) {
    throw new Error("Give a reason. It is recorded against whoever approves this.");
  }
  if (reason.length < 4) {
    throw new Error("Give a fuller reason — this is what an approver has to judge.");
  }

  const targetRef = doc(db, input.targetCollection, input.targetId);
  const requestRef = doc(collection(db, COL.approvals));

  await runTransaction(db, async (tx) => {
    const snap = await tx.get(targetRef);
    if (!snap.exists()) throw new Error("That record no longer exists.");

    const existing = snap.data().pendingApprovalId;
    if (existing) {
      throw new Error(
        "A change is already awaiting approval on this record. That has to be decided first."
      );
    }

    tx.set(requestRef, {
      kind: input.kind,
      targetCollection: input.targetCollection,
      targetId: input.targetId,
      targetLabel: input.targetLabel,
      reason,
      payload: input.payload ?? null,
      before: input.before ?? null,
      status: "pending",
      requestedByUid: actor.uid,
      requestedByEmail: actor.email,
      requestedAt: serverTimestamp(),
      createdAt: serverTimestamp(),
      createdBy: actor.uid,
    });

    tx.update(targetRef, {
      pendingApprovalId: requestRef.id,
      pendingApprovalKind: input.kind,
    });
  });

  await writeAudit(db, {
    actor,
    action: "approval_request",
    collectionName: input.targetCollection,
    docId: input.targetId,
    summary:
      `Requested ${input.kind} of ${input.targetLabel}: ${reason}`,
    before: input.before,
    after: input.payload,
  });

  return requestRef.id;
}

/**
 * Approves a request and applies the change it was holding.
 *
 * The apply and the decision are one transaction, so a request can never read as approved
 * while the change it authorised did not land. If applying fails the whole thing rolls
 * back and the request stays pending, which is recoverable — the alternative is an
 * approved request nobody can tell was never carried out.
 */
export async function approveRequest(
  db: Firestore,
  actor: AuditActor,
  requestId: string,
  note?: string
): Promise<{ applied: "deleted" | "updated" }> {
  const requestRef = doc(db, COL.approvals, requestId);

  const outcome = await runTransaction(db, async (tx) => {
    const snap = await tx.get(requestRef);
    if (!snap.exists()) throw new Error("That request no longer exists.");
    const req = snap.data() as ApprovalRequest;

    if (req.status !== "pending") {
      throw new Error(`This request is already ${req.status}.`);
    }

    const targetRef = doc(db, req.targetCollection, req.targetId);
    const targetSnap = await tx.get(targetRef);

    // Gone already — someone removed it by another route. The request is closed rather
    // than left pending forever, and the audit entry says what happened.
    if (!targetSnap.exists()) {
      tx.update(requestRef, {
        status: "approved",
        decidedByUid: actor.uid,
        decidedByEmail: actor.email,
        decidedAt: serverTimestamp(),
        decisionNote: note?.trim() || null,
        applyError: "The record no longer existed when this was approved.",
      });
      return "deleted" as const;
    }

    if (req.kind === "delete") {
      tx.delete(targetRef);
    } else {
      const payload = (req.payload ?? {}) as Record<string, unknown>;
      tx.update(targetRef, {
        ...payload,
        // The lock is released in the same write that applies the change, so the record
        // is never left flagged as pending after its request was decided.
        pendingApprovalId: null,
        pendingApprovalKind: null,
        updatedAt: serverTimestamp(),
        updatedBy: actor.uid,
      });
    }

    tx.update(requestRef, {
      status: "approved",
      decidedByUid: actor.uid,
      decidedByEmail: actor.email,
      decidedAt: serverTimestamp(),
      decisionNote: note?.trim() || null,
    });

    return req.kind === "delete" ? ("deleted" as const) : ("updated" as const);
  });

  const req = (await getDoc(requestRef)).data() as ApprovalRequest | undefined;

  await writeAudit(db, {
    actor,
    action: "approval_approve",
    collectionName: req?.targetCollection ?? COL.approvals,
    docId: req?.targetId ?? requestId,
    summary:
      `Approved ${req?.kind ?? "change"} of ${req?.targetLabel ?? requestId}, ` +
      `requested by ${req?.requestedByEmail ?? "unknown"}: ${req?.reason ?? ""}` +
      (note?.trim() ? ` — ${note.trim()}` : ""),
    before: req?.before ?? undefined,
    after: (req?.payload as Record<string, unknown> | undefined) ?? undefined,
  });

  return { applied: outcome };
}

/** Refuses a request and unlocks the record, leaving it exactly as it was. */
export async function rejectRequest(
  db: Firestore,
  actor: AuditActor,
  requestId: string,
  note: string
): Promise<void> {
  if (!note.trim()) {
    throw new Error("Say why it is refused, so the requester learns something.");
  }

  const requestRef = doc(db, COL.approvals, requestId);

  await runTransaction(db, async (tx) => {
    const snap = await tx.get(requestRef);
    if (!snap.exists()) throw new Error("That request no longer exists.");
    const req = snap.data() as ApprovalRequest;
    if (req.status !== "pending") {
      throw new Error(`This request is already ${req.status}.`);
    }

    const targetRef = doc(db, req.targetCollection, req.targetId);
    const targetSnap = await tx.get(targetRef);
    if (targetSnap.exists()) {
      tx.update(targetRef, { pendingApprovalId: null, pendingApprovalKind: null });
    }

    tx.update(requestRef, {
      status: "rejected",
      decidedByUid: actor.uid,
      decidedByEmail: actor.email,
      decidedAt: serverTimestamp(),
      decisionNote: note.trim(),
    });
  });

  const req = (await getDoc(requestRef)).data() as ApprovalRequest | undefined;

  await writeAudit(db, {
    actor,
    action: "approval_reject",
    collectionName: req?.targetCollection ?? COL.approvals,
    docId: req?.targetId ?? requestId,
    summary:
      `Refused ${req?.kind ?? "change"} of ${req?.targetLabel ?? requestId}, ` +
      `requested by ${req?.requestedByEmail ?? "unknown"}: ${note.trim()}`,
  });
}

/**
 * Withdraws one's own pending request.
 *
 * The requester can take it back — they realised they were wrong, or the situation
 * changed — without needing an admin to refuse it. It cannot touch anyone else's request,
 * which is why the requester's uid is checked rather than a capability.
 */
export async function cancelRequest(
  db: Firestore,
  actor: AuditActor,
  requestId: string
): Promise<void> {
  const requestRef = doc(db, COL.approvals, requestId);

  await runTransaction(db, async (tx) => {
    const snap = await tx.get(requestRef);
    if (!snap.exists()) throw new Error("That request no longer exists.");
    const req = snap.data() as ApprovalRequest;

    if (req.status !== "pending") {
      throw new Error(`This request is already ${req.status}.`);
    }
    if (req.requestedByUid !== actor.uid) {
      throw new Error("Only whoever raised a request can withdraw it.");
    }

    const targetRef = doc(db, req.targetCollection, req.targetId);
    const targetSnap = await tx.get(targetRef);
    if (targetSnap.exists()) {
      tx.update(targetRef, { pendingApprovalId: null, pendingApprovalKind: null });
    }

    tx.update(requestRef, {
      status: "cancelled",
      decidedByUid: actor.uid,
      decidedByEmail: actor.email,
      decidedAt: serverTimestamp(),
    });
  });

  await writeAudit(db, {
    actor,
    action: "approval_cancel",
    collectionName: COL.approvals,
    docId: requestId,
    summary: "Withdrew a pending change request",
  });
}

/**
 * Deletes a record, or asks for permission to.
 *
 * The single entry point every screen's delete button should call. An admin's deletion
 * happens now, with the reason recorded; anyone else's becomes a request. Callers do not
 * branch on role, which is what stops one screen quietly skipping the queue.
 *
 * `hardDelete` is passed in rather than performed here, because a record with
 * subcollections or paired documents needs its own teardown — a project purchase has to
 * take its expense with it, a wage run has to take its lines. Those rules belong with the
 * module that owns them.
 */
export async function deleteOrRequest(
  db: Firestore,
  actor: AuditActor,
  input: {
    targetCollection: string;
    targetId: string;
    targetLabel: string;
    reason: string;
    /** True when the caller may delete outright. Read from a capability, not a role. */
    canDeleteDirectly: boolean;
    before?: Record<string, unknown>;
    /** Performs the real removal, including any paired records. */
    hardDelete: () => Promise<void>;
  }
): Promise<{ outcome: "deleted" | "requested"; requestId?: string }> {
  const reason = input.reason.trim();
  if (!reason) {
    throw new Error("Give a reason for removing this. It is recorded either way.");
  }

  if (!input.canDeleteDirectly) {
    const requestId = await requestApproval(db, actor, {
      kind: "delete",
      targetCollection: input.targetCollection,
      targetId: input.targetId,
      targetLabel: input.targetLabel,
      reason,
      before: input.before,
    });
    return { outcome: "requested", requestId };
  }

  await input.hardDelete();

  await writeAudit(db, {
    actor,
    action: "delete",
    collectionName: input.targetCollection,
    docId: input.targetId,
    summary: `Deleted ${input.targetLabel}: ${reason}`,
    before: input.before,
  });

  return { outcome: "deleted" };
}

/** Requests still awaiting a decision, newest first. */
export async function loadPendingApprovals(
  db: Firestore,
  max = 100
): Promise<ApprovalRequest[]> {
  const snap = await getDocs(
    query(
      collection(db, COL.approvals),
      where("status", "==", "pending"),
      orderBy("requestedAt", "desc"),
      limit(max)
    )
  );
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }) as ApprovalRequest);
}

/**
 * Clears a lock left behind by a request that no longer exists.
 *
 * A safety valve, not part of the normal flow. If a request document is removed directly
 * in the console, its target stays flagged as pending and becomes uneditable with nothing
 * in the queue to explain why. Admin only, and audited, because it bypasses the workflow.
 */
export async function clearStaleLock(
  db: Firestore,
  actor: AuditActor,
  targetCollection: string,
  targetId: string
): Promise<void> {
  const targetRef = doc(db, targetCollection, targetId);
  const snap = await getDoc(targetRef);
  if (!snap.exists()) throw new Error("That record no longer exists.");

  const pendingId = snap.data().pendingApprovalId as string | undefined;
  if (!pendingId) throw new Error("This record has no pending change.");

  const reqSnap = await getDoc(doc(db, COL.approvals, pendingId));
  if (reqSnap.exists() && reqSnap.data().status === "pending") {
    throw new Error(
      "That request is still open. Approve or refuse it rather than clearing the lock."
    );
  }

  await updateDoc(targetRef, { pendingApprovalId: null, pendingApprovalKind: null });

  await writeAudit(db, {
    actor,
    action: "update",
    collectionName: targetCollection,
    docId: targetId,
    summary: `Cleared a stale pending-change lock (request ${pendingId} was gone or decided)`,
  });
}

/** True when a record is waiting on a decision and must not be changed. */
export function isLocked(record: { pendingApprovalId?: string | null }): boolean {
  return Boolean(record.pendingApprovalId);
}

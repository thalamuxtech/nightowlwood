"use client";

import { useEffect, useMemo, useState } from "react";
import { collection, limit, onSnapshot, orderBy, query, where } from "firebase/firestore";
import {
  Check,
  ClipboardCheck,
  Loader2,
  ShieldAlert,
  Trash2,
  X,
} from "lucide-react";
import { getDb } from "@/lib/firebase";
import { COL } from "@/lib/erp/collections";
import {
  approveRequest,
  cancelRequest,
  rejectRequest,
} from "@/lib/erp/approvals";
import type { ApprovalRequest } from "@/lib/erp/types";
import { Button, EmptyState, TextField } from "@/components/admin/ui/Fields";
import { StatusPill } from "@/components/admin/ui/StatusPill";
import { useErpSession } from "@/components/admin/ErpAuthProvider";

type Filter = "pending" | "decided" | "mine";

/**
 * The approvals queue.
 *
 * Deletions and consequential edits arrive here instead of happening. Whoever asked said
 * why; whoever decides sees that reason next to the exact before-and-after, and both halves
 * are recorded against them in the audit log.
 *
 * The reviewer sees the *stored* before-image rather than re-reading the record, which is
 * deliberate: what matters is what the requester was looking at when they asked. If the
 * record has moved since, the diff shown is still the one the request was made about.
 */
export function ApprovalsScreen() {
  const session = useErpSession();
  const canDecide = session.can("approval.decide");

  const [rows, setRows] = useState<ApprovalRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [filter, setFilter] = useState<Filter>("pending");
  const [busyId, setBusyId] = useState<string | null>(null);
  /** Per-row note, so refusing one request cannot pick up another's text. */
  const [notes, setNotes] = useState<Record<string, string>>({});

  useEffect(() => {
    const base = collection(getDb(), COL.approvals);
    const q =
      filter === "pending"
        ? query(
            base,
            where("status", "==", "pending"),
            orderBy("requestedAt", "desc"),
            limit(100)
          )
        : query(base, orderBy("requestedAt", "desc"), limit(150));

    return onSnapshot(
      q,
      (snap) => {
        setRows(
          snap.docs.map((d) => ({ id: d.id, ...d.data() }) as ApprovalRequest)
        );
        setLoading(false);
      },
      (e) => {
        setError(
          e.code === "permission-denied"
            ? "You do not have permission to see the approvals queue."
            : e.message
        );
        setLoading(false);
      }
    );
  }, [filter]);

  const actor = useMemo(
    () => ({
      uid: session.user?.uid ?? "",
      email: session.user?.email ?? "",
      role: session.role ?? "manager",
    }),
    [session.user, session.role]
  );

  const visible = useMemo(() => {
    if (filter === "mine") {
      return rows.filter((r) => r.requestedByUid === actor.uid);
    }
    if (filter === "decided") {
      return rows.filter((r) => r.status !== "pending");
    }
    return rows.filter((r) => r.status === "pending");
  }, [rows, filter, actor.uid]);

  const pendingCount = rows.filter((r) => r.status === "pending").length;

  function flash(message: string) {
    setNotice(message);
    setTimeout(() => setNotice(""), 6000);
  }

  if (!session.ready) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center">
        <Loader2 className="animate-spin text-brass-400" size={28} aria-label="Loading" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl pb-20">
      <header>
        <p className="text-eyebrow">Admin</p>
        <h1 className="text-title mt-3 text-cream-50">Approvals</h1>
        <p className="mt-3 max-w-2xl text-sm leading-relaxed text-cream-400">
          Deletions and changes waiting on a decision. Each carries the reason it was asked
          for, and both the request and the decision are recorded in the activity log.
        </p>
      </header>

      {error && (
        <p
          role="alert"
          className="mt-6 flex items-start gap-2 rounded-xl border border-red-500/30 bg-red-500/5 px-4 py-3 text-sm text-red-400"
        >
          <ShieldAlert size={16} className="mt-0.5 shrink-0" /> {error}
        </p>
      )}
      {notice && (
        <p role="status" className="mt-6 text-sm text-emerald-300">
          {notice}
        </p>
      )}

      <div className="mt-8 flex flex-wrap gap-2">
        <Chip
          active={filter === "pending"}
          onClick={() => setFilter("pending")}
          label={pendingCount > 0 ? `Waiting (${pendingCount})` : "Waiting"}
        />
        <Chip active={filter === "mine"} onClick={() => setFilter("mine")} label="Mine" />
        <Chip
          active={filter === "decided"}
          onClick={() => setFilter("decided")}
          label="Decided"
        />
      </div>

      {loading ? (
        <div className="mt-10 flex justify-center py-10">
          <Loader2 className="animate-spin text-brass-400" size={26} aria-label="Loading" />
        </div>
      ) : visible.length === 0 ? (
        <div className="mt-8">
          <EmptyState
            title={
              filter === "pending"
                ? "Nothing waiting"
                : filter === "mine"
                  ? "You have not asked for anything"
                  : "Nothing decided yet"
            }
            hint={
              filter === "pending"
                ? "Requests to delete or change a record appear here for a decision."
                : undefined
            }
          />
        </div>
      ) : (
        <ul className="mt-6 space-y-3">
          {visible.map((r) => {
            const pending = r.status === "pending";
            const mine = r.requestedByUid === actor.uid;
            return (
              <li
                key={r.id}
                className="rounded-2xl border border-night-700/60 bg-night-900/40 p-5"
              >
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div className="min-w-0">
                    <p className="flex flex-wrap items-center gap-2">
                      <span
                        className={`flex items-center gap-1.5 rounded-md px-2 py-0.5 text-[0.7rem] font-medium ${
                          r.kind === "delete"
                            ? "bg-red-500/15 text-red-300"
                            : "bg-brass-500/15 text-brass-300"
                        }`}
                      >
                        {r.kind === "delete" ? <Trash2 size={11} /> : null}
                        {r.kind === "delete" ? "Delete" : "Change"}
                      </span>
                      <span className="font-medium text-cream-100">{r.targetLabel}</span>
                      {!pending && (
                        <StatusPill
                          tone={
                            r.status === "approved"
                              ? "positive"
                              : r.status === "rejected"
                                ? "danger"
                                : "neutral"
                          }
                        >
                          {r.status}
                        </StatusPill>
                      )}
                    </p>

                    {/* The reason, given prominence. It is the thing being judged. */}
                    <p className="mt-2 border-l-2 border-night-600 pl-3 text-sm leading-relaxed text-cream-300">
                      {r.reason}
                    </p>

                    <p className="mt-2 text-xs text-cream-500">
                      {r.requestedByEmail}
                      <span className="mx-1.5 text-cream-700">·</span>
                      {r.requestedAt?.toMillis
                        ? new Date(r.requestedAt.toMillis()).toLocaleString("en-GB", {
                            day: "numeric",
                            month: "short",
                            hour: "2-digit",
                            minute: "2-digit",
                          })
                        : "just now"}
                      <span className="mx-1.5 text-cream-700">·</span>
                      <span className="font-mono text-[0.7rem]">
                        {r.targetCollection}
                      </span>
                    </p>

                    {!pending && r.decisionNote && (
                      <p className="mt-2 text-xs text-cream-400">
                        {r.status === "rejected" ? "Refused" : "Noted"}:{" "}
                        {r.decisionNote}
                        {r.decidedByEmail && (
                          <span className="text-cream-600"> — {r.decidedByEmail}</span>
                        )}
                      </p>
                    )}

                    {/* Set when the record had already gone by the time this was
                        approved, so the queue does not pretend the change landed. */}
                    {r.applyError && (
                      <p className="mt-2 text-xs text-amber-300">{r.applyError}</p>
                    )}
                  </div>
                </div>

                {/* What would change. Shown for an edit, since a reason alone cannot be
                    judged without the figures it is about. */}
                {r.kind === "update" && (r.before || r.payload) && (
                  <div className="mt-4 grid gap-3 border-t border-night-800 pt-3 sm:grid-cols-2">
                    <FieldSet title="Now" data={r.before} />
                    <FieldSet title="Would become" data={r.payload} tone="change" />
                  </div>
                )}

                {pending && (
                  <div className="mt-4 flex flex-wrap items-end gap-3 border-t border-night-800 pt-4">
                    {canDecide && (
                      <>
                        <div className="min-w-[16rem] flex-1">
                          <TextField
                            id={`note-${r.id}`}
                            label="Note (required to refuse)"
                            value={notes[r.id] ?? ""}
                            onChange={(v) =>
                              setNotes((prev) => ({ ...prev, [r.id]: v }))
                            }
                            placeholder="Why this is allowed, or why not"
                          />
                        </div>
                        <Button
                          busy={busyId === r.id}
                          onClick={() => {
                            if (
                              r.kind === "delete" &&
                              !window.confirm(
                                `Approve deletion of ${r.targetLabel}? This cannot be undone.`
                              )
                            )
                              return;
                            setBusyId(r.id);
                            setError("");
                            approveRequest(getDb(), actor, r.id, notes[r.id])
                              .then((res) =>
                                flash(
                                  `${r.targetLabel} ${
                                    res.applied === "deleted" ? "deleted" : "updated"
                                  }.`
                                )
                              )
                              .catch((e) =>
                                setError(
                                  e instanceof Error ? e.message : "Could not approve."
                                )
                              )
                              .finally(() => setBusyId(null));
                          }}
                        >
                          <span className="flex items-center gap-1.5">
                            <Check size={14} /> Approve
                          </span>
                        </Button>
                        <Button
                          variant="danger"
                          busy={busyId === r.id}
                          onClick={() => {
                            const note = (notes[r.id] ?? "").trim();
                            if (!note) {
                              setError(
                                "Add a note saying why it is refused, so the requester learns something."
                              );
                              return;
                            }
                            setBusyId(r.id);
                            setError("");
                            rejectRequest(getDb(), actor, r.id, note)
                              .then(() => flash(`Request on ${r.targetLabel} refused.`))
                              .catch((e) =>
                                setError(
                                  e instanceof Error ? e.message : "Could not refuse."
                                )
                              )
                              .finally(() => setBusyId(null));
                          }}
                        >
                          <span className="flex items-center gap-1.5">
                            <X size={14} /> Refuse
                          </span>
                        </Button>
                      </>
                    )}

                    {/* The requester can take their own request back without needing an
                        admin to refuse it. */}
                    {mine && (
                      <Button
                        variant="ghost"
                        busy={busyId === r.id}
                        onClick={() => {
                          setBusyId(r.id);
                          cancelRequest(getDb(), actor, r.id)
                            .then(() => flash("Request withdrawn."))
                            .catch((e) =>
                              setError(
                                e instanceof Error ? e.message : "Could not withdraw."
                              )
                            )
                            .finally(() => setBusyId(null));
                        }}
                      >
                        Withdraw
                      </Button>
                    )}

                    {!canDecide && !mine && (
                      <p className="text-xs text-cream-600">
                        Waiting on an administrator.
                      </p>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {canDecide && pendingCount === 0 && !loading && filter === "pending" && (
        <p className="mt-6 flex items-center gap-2 text-xs text-cream-600">
          <ClipboardCheck size={14} /> Nothing is waiting on you.
        </p>
      )}
    </div>
  );
}

function FieldSet({
  title,
  data,
  tone,
}: {
  title: string;
  data?: Record<string, unknown> | null;
  tone?: "change";
}) {
  if (!data || Object.keys(data).length === 0) {
    return (
      <div>
        <p className="text-xs uppercase tracking-wider text-cream-600">{title}</p>
        <p className="mt-1 text-xs text-cream-600">not recorded</p>
      </div>
    );
  }
  return (
    <div>
      <p className="text-xs uppercase tracking-wider text-cream-600">{title}</p>
      <dl className="mt-1.5 space-y-1">
        {Object.entries(data).map(([k, v]) => (
          <div key={k} className="flex flex-wrap gap-2 text-xs">
            <dt className="text-cream-500">{k}</dt>
            <dd
              className={`break-all font-mono ${
                tone === "change" ? "text-brass-300" : "text-cream-300"
              }`}
            >
              {v === null
                ? "null"
                : typeof v === "object"
                  ? JSON.stringify(v)
                  : String(v)}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function Chip({
  active,
  onClick,
  label,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`cursor-pointer rounded-full border px-4 py-2 text-xs font-medium transition-all duration-300 ${
        active
          ? "border-brass-500 bg-brass-500 text-night-950"
          : "border-night-600 text-cream-300 hover:border-brass-500/60 hover:text-brass-300"
      }`}
    >
      {label}
    </button>
  );
}

"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { collection, doc, onSnapshot, orderBy, query } from "firebase/firestore";
import {
  ArrowLeft,
  BadgeCheck,
  Loader2,
  PenLine,
  Plus,
  FileText,
  Printer,
  ShieldAlert,
  Trash2,
} from "lucide-react";
import { getDb } from "@/lib/firebase";
import { COL, jobLinesPath, jobPaymentsPath } from "@/lib/erp/collections";
import {
  BOARD_TYPES,
  BOARD_TYPE_LABELS,
  JOB_STATUS_FLOW,
  JOB_STATUS_LABELS,
  PAYMENT_METHODS,
  PAYMENT_METHOD_LABELS,
  SERVICE_TYPES,
  SERVICE_TYPE_LABELS,
  type BoardType,
  type JobStatus,
  type PaymentMethod,
  type ServiceType,
} from "@/lib/erp/enums";
import { formatNaira, lineAmountKobo, parseNairaInput, toNaira } from "@/lib/erp/money";
import {
  addJobLine,
  advanceJobStatus,
  recordJobPayment,
  removeJobLine,
  updateJobLine,
} from "@/lib/erp/serviceJobs";
import { JOB_STATUS_TONE } from "@/lib/erp/statusTone";
import type { BoardBreakdown } from "@/lib/erp/types";
import { StatusPill } from "@/components/admin/ui/StatusPill";
import {
  Button,
  NumberField,
  SelectField,
  TextField,
} from "@/components/admin/ui/Fields";
import { useAuditActor, useErpSession } from "@/components/admin/ErpAuthProvider";
import { HeldBoardsPanel } from "./HeldBoardsPanel";
import { JobSheet } from "./JobSheet";
import { JobDetailsEditor } from "./JobDetailsEditor";
import { PrintPreview } from "@/components/admin/ui/PrintPreview";
import type { AuditActor } from "@/lib/erp/audit";

interface JobDoc {
  jobNumber: string;
  customerId: string;
  customerName: string;
  customerPhone?: string;
  staffName?: string;
  boards: BoardBreakdown;
  accessories?: string;
  repName?: string;
  repPhone?: string;
  status: JobStatus;
  quantityCheck?: boolean;
  qualityCheck?: boolean;
  pickupBy?: string;
  pickupPhone?: string;
  totalKobo: number;
  paidKobo: number;
  balanceKobo: number;
  notes?: string;
  receivedAtMs: number | null;
}

interface LineRow {
  id: string;
  serviceType: ServiceType;
  boardType?: BoardType;
  quantity: number;
  unitPriceKobo: number;
  amountKobo: number;
}

interface PaymentRow {
  id: string;
  dateMs: number | null;
  description: string;
  amountKobo: number;
  method: PaymentMethod;
}

/**
 * Service job detail: the working screen for a single job.
 *
 * Reads by id from the query string rather than a dynamic route, because the
 * site is a static export and per-job paths cannot be prerendered.
 */
export function JobDetail() {
  const params = useSearchParams();
  const jobId = params.get("id") ?? "";
  const session = useErpSession();

  const [job, setJob] = useState<JobDoc | null>(null);
  const [lines, setLines] = useState<LineRow[]>([]);
  const [payments, setPayments] = useState<PaymentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [missing, setMissing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [previewing, setPreviewing] = useState(false);
  const [printing, setPrinting] = useState(false);
  /** Where the job is being moved to, chosen before it is confirmed. */
  const [nextStatus, setNextStatus] = useState("");

  const canEdit = session.can("job.edit");
  const canPay = session.can("job.recordPayment");

  useEffect(() => {
    if (!jobId) {
      setLoading(false);
      setMissing(true);
      return;
    }
    return onSnapshot(
      doc(getDb(), COL.serviceJobs, jobId),
      (snap) => {
        if (!snap.exists()) {
          setMissing(true);
        } else {
          const d = snap.data();
          setJob({
            jobNumber: d.jobNumber ?? "",
            customerId: d.customerId ?? "",
            customerName: d.customerName ?? "",
            customerPhone: d.customerPhone ?? undefined,
            staffName: d.staffName ?? undefined,
            boards: (d.boards as BoardBreakdown) ?? {},
            accessories: d.accessories ?? undefined,
            repName: d.repName ?? undefined,
            repPhone: d.repPhone ?? undefined,
            status: (d.status as JobStatus) ?? "received",
            quantityCheck: d.quantityCheck ?? undefined,
            qualityCheck: d.qualityCheck ?? undefined,
            pickupBy: d.pickupBy ?? undefined,
            pickupPhone: d.pickupPhone ?? undefined,
            totalKobo: d.totalKobo ?? 0,
            paidKobo: d.paidKobo ?? 0,
            balanceKobo: d.balanceKobo ?? 0,
            notes: d.notes ?? undefined,
            receivedAtMs: d.receivedAt?.toMillis?.() ?? null,
          });
        }
        setLoading(false);
      },
      (e) => {
        setError(e.message);
        setLoading(false);
      }
    );
  }, [jobId]);

  useEffect(() => {
    if (!jobId) return;
    return onSnapshot(collection(getDb(), jobLinesPath(jobId)), (snap) =>
      setLines(
        snap.docs.map((d) => ({
          id: d.id,
          serviceType: d.data().serviceType,
          boardType: d.data().boardType ?? undefined,
          quantity: d.data().quantity ?? 0,
          unitPriceKobo: d.data().unitPriceKobo ?? 0,
          amountKobo: d.data().amountKobo ?? 0,
        }))
      )
    );
  }, [jobId]);

  useEffect(() => {
    if (!jobId) return;
    return onSnapshot(
      query(collection(getDb(), jobPaymentsPath(jobId)), orderBy("date", "asc")),
      (snap) =>
        setPayments(
          snap.docs.map((d) => ({
            id: d.id,
            dateMs: d.data().date?.toMillis?.() ?? null,
            description: d.data().description ?? "",
            amountKobo: d.data().amountKobo ?? 0,
            method: d.data().method ?? "cash",
          }))
        )
    );
  }, [jobId]);

  const actor = useAuditActor();

  async function move(to: JobStatus) {
    if (!job) return;
    setBusy(true);
    setError("");
    try {
      await advanceJobStatus(getDb(), actor, jobId, job.jobNumber, job.status, to);
      // Cleared on success: the status just moved, so the destination that was chosen is no
      // longer one of the options and leaving it selected would offer a move that cannot happen.
      setNextStatus("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not change status.");
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

  if (missing || !job) {
    return (
      <div className="mx-auto max-w-lg rounded-3xl border border-night-700/60 bg-night-900/40 p-8 text-center">
        <p className="font-display text-lg text-cream-200">Job not found</p>
        <p className="mt-2 text-sm text-cream-500">
          It may have been deleted, or the link is incomplete.
        </p>
        <Link href="/admin/jobs/" className="mt-5 inline-block">
          <Button variant="secondary">Back to jobs</Button>
        </Link>
      </div>
    );
  }

  const nextStates = JOB_STATUS_FLOW[job.status];

  return (
    <div className="mx-auto max-w-5xl pb-20">
      {/* Print view is rendered off-screen and swapped in by the print stylesheet */}
      {previewing && (
        <PrintPreview
          title={`Job order ${job.jobNumber}`}
          paper="a4-portrait"
          onPrint={() => setPrinting(true)}
          onClose={() => setPreviewing(false)}
        >
          <JobSheet
            job={job}
            lines={lines}
            payments={payments}
            autoPrint={false}
            onDone={() => {}}
          />
        </PrintPreview>
      )}

      {printing && (
        <JobSheet
          job={job}
          lines={lines}
          payments={payments}
          onDone={() => {
            setPrinting(false);
            setPreviewing(false);
          }}
        />
      )}

      <div className="print:hidden">
        <Link
          href="/admin/jobs/"
          className="inline-flex items-center gap-2 text-sm text-cream-400 transition-colors hover:text-brass-300"
        >
          <ArrowLeft size={15} /> All jobs
        </Link>

        <header className="mt-4 flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-eyebrow">{job.customerName}</p>
            <h1 className="text-title mt-2 text-cream-50">{job.jobNumber}</h1>
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <StatusPill tone={JOB_STATUS_TONE[job.status]}>
                {JOB_STATUS_LABELS[job.status]}
              </StatusPill>
              {job.receivedAtMs && (
                <span className="text-xs text-cream-500">
                  Received{" "}
                  {new Date(job.receivedAtMs).toLocaleDateString("en-GB", {
                    day: "numeric",
                    month: "long",
                    year: "numeric",
                  })}
                </span>
              )}
            </div>
          </div>
          <Button variant="secondary" onClick={() => setPreviewing(true)}>
            <span className="flex items-center gap-2">
              <FileText size={15} /> View &amp; download
            </span>
          </Button>
        </header>

        {error && (
          <p role="alert" className="mt-6 text-sm text-red-400">
            {error}
          </p>
        )}

        {/* Money summary */}
        <div className="mt-8 grid gap-4 sm:grid-cols-3">
          <Tile label="Total" value={formatNaira(job.totalKobo)} />
          <Tile label="Paid" value={formatNaira(job.paidKobo)} tone="good" />
          <Tile
            label="Balance"
            value={formatNaira(job.balanceKobo)}
            tone={job.balanceKobo > 0 ? "warn" : "good"}
          />
        </div>

        {/* The customer's own boards, above the status controls on purpose: whether their
            property has been handed back is part of deciding the job is finished. */}
        <HeldBoardsPanel jobId={jobId} customerName={job.customerName} />

        {/* Status pipeline */}
        {canEdit && nextStates.length > 0 && (
          <section className="mt-8 rounded-3xl border border-night-700/60 bg-night-900/30 p-6">
            <h2 className="font-display text-lg text-cream-100">Move this job</h2>
            <p className="mt-1.5 text-sm text-cream-400">
              Currently {JOB_STATUS_LABELS[job.status].toLowerCase()}. Choose where it goes next.
            </p>

            {/* A choice then a confirm, rather than a row of buttons that each act on the first
                click. Advancing a job is not reversible from here — a mis-tap on "Collected" ends
                the pipeline — so the destination is selected first and stays visible while the
                move is confirmed. */}
            <div className="mt-4 flex flex-wrap items-end gap-3">
              <div className="min-w-[14rem] flex-1">
                <SelectField
                  id="job-next-status"
                  label="Move to"
                  value={nextStatus}
                  onChange={(v) => setNextStatus(v as JobStatus)}
                  options={nextStates.map((s) => ({
                    value: s,
                    label: JOB_STATUS_LABELS[s],
                  }))}
                  placeholder="Choose a status…"
                />
              </div>
              <Button
                onClick={() => nextStatus && move(nextStatus as JobStatus)}
                busy={busy}
                disabled={!nextStatus}
              >
                Move it
              </Button>
            </div>
          </section>
        )}

        <JobDetailsCard
          job={job}
          jobId={jobId}
          actor={actor}
          canEdit={canEdit}
          onError={setError}
        />

        <LinesSection
          jobId={jobId}
          lines={lines}
          canEdit={canEdit}
          actor={actor}
          onError={setError}
        />

        <PaymentsSection
          jobId={jobId}
          jobNumber={job.jobNumber}
          payments={payments}
          balanceKobo={job.balanceKobo}
          canPay={canPay}
          actor={actor}
          onError={setError}
        />
      </div>
    </div>
  );
}

function Tile({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "good" | "warn";
}) {
  const colour =
    tone === "good" ? "text-emerald-300" : tone === "warn" ? "text-amber-300" : "text-cream-50";
  return (
    <div className="rounded-3xl border border-night-700/60 bg-night-900/40 p-5">
      <p className="text-xs uppercase tracking-wider text-cream-500">{label}</p>
      <p className={`mt-2 font-display text-2xl ${colour}`}>{value}</p>
    </div>
  );
}

function JobDetailsCard({
  job,
  jobId,
  actor,
  canEdit,
  onError,
}: {
  job: JobDoc;
  jobId: string;
  actor: AuditActor;
  canEdit: boolean;
  onError: (m: string) => void;
}) {
  const [editing, setEditing] = useState(false);

  const boards = Object.entries(job.boards).filter(
    ([, v]) => typeof v === "number" && v > 0
  ) as Array<[string, number]>;

  return (
    <section className="mt-6 rounded-3xl border border-night-700/60 bg-night-900/30 p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-display text-lg text-cream-100">Job details</h2>
        {canEdit && !editing && (
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="flex cursor-pointer items-center gap-2 text-sm text-brass-300 transition-colors hover:text-brass-200"
          >
            <PenLine size={15} /> Edit details
          </button>
        )}
      </div>
      <dl className="mt-5 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
        <Detail label="Customer" value={job.customerName} />
        <Detail label="Phone" value={job.customerPhone} />
        <Detail label="Received by" value={job.staffName} />
        <Detail
          label="Boards"
          value={
            boards.length
              ? boards
                  .map(([k, v]) => `${BOARD_TYPE_LABELS[k as BoardType] ?? k} ${v}`)
                  .join(", ")
              : undefined
          }
        />
        <Detail label="Accessories" value={job.accessories} />
        <Detail
          label="Client / rep"
          value={
            job.repName
              ? `${job.repName}${job.repPhone ? ` (${job.repPhone})` : ""}`
              : undefined
          }
        />
        {job.pickupBy && (
          <Detail
            label="Collected by"
            value={`${job.pickupBy}${job.pickupPhone ? ` (${job.pickupPhone})` : ""}`}
          />
        )}
        {job.notes && <Detail label="Notes" value={job.notes} wide />}
      </dl>

      {editing && (
        <JobDetailsEditor
          jobId={jobId}
          job={job}
          actor={actor}
          onClose={() => setEditing(false)}
          onError={onError}
        />
      )}
    </section>
  );
}

function Detail({
  label,
  value,
  wide,
}: {
  label: string;
  value?: string;
  wide?: boolean;
}) {
  return (
    <div className={wide ? "sm:col-span-2 lg:col-span-3" : undefined}>
      <dt className="text-xs uppercase tracking-wider text-cream-500">{label}</dt>
      <dd className="mt-1 text-sm text-cream-100">{value || "-"}</dd>
    </div>
  );
}

function LinesSection({
  jobId,
  lines,
  canEdit,
  actor,
  onError,
}: {
  jobId: string;
  lines: LineRow[];
  canEdit: boolean;
  actor: AuditActor;
  onError: (m: string) => void;
}) {
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);
  const [serviceType, setServiceType] = useState<ServiceType | "">("");
  const [boardType, setBoardType] = useState<BoardType | "">("");
  const [quantity, setQuantity] = useState("");
  const [price, setPrice] = useState("");

  async function add() {
    if (!serviceType || !Number(quantity)) {
      onError("Choose a service and enter a quantity.");
      return;
    }
    setBusy(true);
    try {
      await addJobLine(getDb(), actor, jobId, {
        serviceType,
        boardType: (boardType || undefined) as BoardType | undefined,
        quantity: Number(quantity),
        unitPriceKobo: parseNairaInput(price),
      });
      setServiceType("");
      setBoardType("");
      setQuantity("");
      setPrice("");
      setAdding(false);
    } catch (e) {
      onError(e instanceof Error ? e.message : "Could not add the line.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="mt-6 rounded-3xl border border-night-700/60 bg-night-900/30 p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-display text-lg text-cream-100">Work &amp; pricing</h2>
        {canEdit && !adding && (
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="flex cursor-pointer items-center gap-2 text-sm text-brass-300 transition-colors hover:text-brass-200"
          >
            <Plus size={15} /> Add line
          </button>
        )}
      </div>

      {lines.length === 0 && !adding ? (
        <p className="mt-5 text-sm text-cream-500">No work lines yet.</p>
      ) : (
        <div className="mt-5 overflow-x-auto">
          <table className="w-full min-w-[38rem] text-left text-sm">
            <thead className="text-xs uppercase tracking-wider text-cream-500">
              <tr>
                <th className="pb-3 font-medium">Service</th>
                <th className="pb-3 font-medium">Board</th>
                <th className="pb-3 text-right font-medium">Qty</th>
                <th className="pb-3 text-right font-medium">Unit</th>
                <th className="pb-3 text-right font-medium">Amount</th>
                {canEdit && <th className="pb-3" />}
              </tr>
            </thead>
            <tbody className="divide-y divide-night-800">
              {lines.map((l) => (
                <LineRowEditor
                  key={l.id}
                  jobId={jobId}
                  line={l}
                  canEdit={canEdit}
                  actor={actor}
                  onError={onError}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}

      {adding && (
        <div className="mt-5 rounded-2xl border border-night-700/60 bg-night-950/40 p-4">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <SelectField
              id="add-service"
              label="Service"
              value={serviceType}
              onChange={(v) => setServiceType(v as ServiceType)}
              placeholder="Select…"
              options={SERVICE_TYPES.map((s) => ({ value: s, label: SERVICE_TYPE_LABELS[s] }))}
            />
            <SelectField
              id="add-board"
              label="Board"
              value={boardType}
              onChange={(v) => setBoardType(v as BoardType)}
              placeholder="-"
              options={BOARD_TYPES.map((b) => ({ value: b, label: BOARD_TYPE_LABELS[b] }))}
            />
            <NumberField id="add-qty" label="Quantity" value={quantity} onChange={setQuantity} />
            <NumberField id="add-price" label="Unit price (₦)" value={price} onChange={setPrice} />
          </div>
          <p className="mt-3 text-right text-sm text-brass-300">
            {formatNaira(lineAmountKobo(Number(quantity) || 0, parseNairaInput(price)))}
          </p>
          <div className="mt-3 flex gap-3">
            <Button onClick={add} busy={busy}>
              Add line
            </Button>
            <Button variant="ghost" onClick={() => setAdding(false)}>
              Cancel
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}

/**
 * One work line, read-only until the pencil is pressed.
 *
 * Only quantity and unit price open for editing. Changing the service or board
 * type would make the line a different piece of work, which is an add and a
 * remove rather than a correction, and the audit trail reads better that way.
 */
function LineRowEditor({
  jobId,
  line,
  canEdit,
  actor,
  onError,
}: {
  jobId: string;
  line: LineRow;
  canEdit: boolean;
  actor: AuditActor;
  onError: (m: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [quantity, setQuantity] = useState(String(line.quantity));
  const [price, setPrice] = useState(String(toNaira(line.unitPriceKobo)));

  function open() {
    // Re-seed from the document each time, so a cancelled edit does not leave
    // stale figures waiting in the fields for the next attempt.
    setQuantity(String(line.quantity));
    setPrice(String(toNaira(line.unitPriceKobo)));
    setEditing(true);
  }

  async function save() {
    const nextQty = Number(quantity);
    if (!nextQty) {
      onError("Enter a quantity.");
      return;
    }
    setSaving(true);
    try {
      await updateJobLine(getDb(), actor, jobId, line.id, {
        serviceType: line.serviceType,
        boardType: line.boardType,
        quantity: nextQty,
        unitPriceKobo: parseNairaInput(price),
      });
      setEditing(false);
    } catch (e) {
      onError(e instanceof Error ? e.message : "Could not save the line.");
    } finally {
      setSaving(false);
    }
  }

  if (editing) {
    return (
      <tr>
        <td className="py-3 text-cream-100">{SERVICE_TYPE_LABELS[line.serviceType]}</td>
        <td className="py-3 text-cream-400">
          {line.boardType ? BOARD_TYPE_LABELS[line.boardType] : "-"}
        </td>
        <td className="py-3 pr-2">
          <NumberField
            id={`edit-qty-${line.id}`}
            label="Qty"
            value={quantity}
            onChange={setQuantity}
          />
        </td>
        <td className="py-3 pr-2">
          <NumberField
            id={`edit-price-${line.id}`}
            label="Unit (₦)"
            value={price}
            onChange={setPrice}
          />
        </td>
        <td className="py-3 text-right text-brass-300">
          {formatNaira(lineAmountKobo(Number(quantity) || 0, parseNairaInput(price)))}
        </td>
        <td className="py-3 pl-3 text-right">
          <div className="flex justify-end gap-2">
            <Button onClick={save} busy={saving}>
              Save
            </Button>
            <Button variant="ghost" onClick={() => setEditing(false)}>
              Cancel
            </Button>
          </div>
        </td>
      </tr>
    );
  }

  return (
    <tr>
      <td className="py-3 text-cream-100">{SERVICE_TYPE_LABELS[line.serviceType]}</td>
      <td className="py-3 text-cream-400">
        {line.boardType ? BOARD_TYPE_LABELS[line.boardType] : "-"}
      </td>
      <td className="py-3 text-right text-cream-200">{line.quantity}</td>
      <td className="py-3 text-right text-cream-400">{formatNaira(line.unitPriceKobo)}</td>
      <td className="py-3 text-right text-cream-100">{formatNaira(line.amountKobo)}</td>
      {canEdit && (
        <td className="py-3 pl-3 text-right">
          <div className="flex justify-end gap-3">
            <button
              type="button"
              aria-label="Edit line"
              onClick={open}
              className="cursor-pointer text-cream-500 transition-colors hover:text-brass-300"
            >
              <PenLine size={15} />
            </button>
            <button
              type="button"
              aria-label="Remove line"
              onClick={() =>
                removeJobLine(getDb(), actor, jobId, line.id, line.amountKobo).catch((e) =>
                  onError(e instanceof Error ? e.message : "Could not remove.")
                )
              }
              className="cursor-pointer text-cream-500 transition-colors hover:text-red-400"
            >
              <Trash2 size={15} />
            </button>
          </div>
        </td>
      )}
    </tr>
  );
}

function PaymentsSection({
  jobId,
  jobNumber,
  payments,
  balanceKobo,
  canPay,
  actor,
  onError,
}: {
  jobId: string;
  jobNumber: string;
  payments: PaymentRow[];
  balanceKobo: number;
  canPay: boolean;
  actor: AuditActor;
  onError: (m: string) => void;
}) {
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);
  const [amount, setAmount] = useState("");
  const [description, setDescription] = useState("");
  const [method, setMethod] = useState<PaymentMethod>("cash");

  async function add() {
    const kobo = parseNairaInput(amount);
    if (kobo <= 0) {
      onError("Enter a payment amount.");
      return;
    }
    setBusy(true);
    try {
      await recordJobPayment(getDb(), actor, jobId, jobNumber, {
        description: description.trim() || "Payment",
        amountKobo: kobo,
        method,
      });
      setAmount("");
      setDescription("");
      setAdding(false);
    } catch (e) {
      onError(e instanceof Error ? e.message : "Could not record the payment.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="mt-6 rounded-3xl border border-night-700/60 bg-night-900/30 p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-display text-lg text-cream-100">Payment history</h2>
        {canPay && !adding && (
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="flex cursor-pointer items-center gap-2 text-sm text-brass-300 transition-colors hover:text-brass-200"
          >
            <Plus size={15} /> Record payment
          </button>
        )}
      </div>

      {payments.length === 0 ? (
        <p className="mt-5 text-sm text-cream-500">No payments recorded.</p>
      ) : (
        <ul className="mt-5 divide-y divide-night-800">
          {payments.map((p) => (
            <li key={p.id} className="flex items-center justify-between gap-4 py-3">
              <div className="min-w-0">
                <p className="truncate text-sm text-cream-100">{p.description}</p>
                <p className="text-xs text-cream-500">
                  {p.dateMs ? new Date(p.dateMs).toLocaleDateString("en-GB") : "-"} ·{" "}
                  {PAYMENT_METHOD_LABELS[p.method]}
                </p>
              </div>
              <span className="shrink-0 text-sm text-emerald-300">
                {formatNaira(p.amountKobo)}
              </span>
            </li>
          ))}
        </ul>
      )}

      {balanceKobo <= 0 && payments.length > 0 && (
        <p className="mt-4 flex items-center gap-2 text-sm text-emerald-300">
          <BadgeCheck size={16} /> Fully settled
        </p>
      )}

      {adding && (
        <div className="mt-5 rounded-2xl border border-night-700/60 bg-night-950/40 p-4">
          <div className="grid gap-4 sm:grid-cols-3">
            <NumberField id="pay-amount" label="Amount (₦)" value={amount} onChange={setAmount} />
            <TextField
              id="pay-desc"
              label="Description"
              value={description}
              onChange={setDescription}
              placeholder="Deposit"
            />
            <SelectField
              id="pay-method"
              label="Method"
              value={method}
              onChange={(v) => setMethod(v as PaymentMethod)}
              options={PAYMENT_METHODS.map((m) => ({
                value: m,
                label: PAYMENT_METHOD_LABELS[m],
              }))}
            />
          </div>
          <div className="mt-3 flex gap-3">
            <Button onClick={add} busy={busy}>
              Record
            </Button>
            <Button variant="ghost" onClick={() => setAdding(false)}>
              Cancel
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}

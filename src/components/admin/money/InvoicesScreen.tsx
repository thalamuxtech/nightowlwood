"use client";

import { useEffect, useMemo, useState } from "react";
import { collection, limit, onSnapshot, orderBy, query } from "firebase/firestore";
import { getFunctions, httpsCallable } from "firebase/functions";
import {
  BadgeCheck,
  FileText,
  Loader2,
  Paperclip,
  PenLine,
  Send,
  ShieldAlert,
  Trash2,
} from "lucide-react";
import { getDb, getFirebaseApp } from "@/lib/firebase";
import { COL , invoiceAttachmentsPath } from "@/lib/erp/collections";
import {
  INVOICE_STATUSES,
  INVOICE_STATUS_LABELS,
  type InvoiceStatus,
  type TaxMode,
} from "@/lib/erp/enums";
import { formatNaira, parseNairaInput } from "@/lib/erp/money";
import {
  createInvoiceFromJob,
  createInvoiceFromProject,
  deleteDraftInvoice,
  issueInvoice,
  recordInvoicePayment,
  voidInvoice,
} from "@/lib/erp/invoices";
import { InvoiceEditor } from "@/components/admin/money/InvoiceEditor";
import { FileAttachments } from "@/components/admin/ui/FileAttachments";
import { INVOICE_STATUS_TONE } from "@/lib/erp/statusTone";
import { StatusPill } from "@/components/admin/ui/StatusPill";
import {
  Button,
  EmptyState,
  NumberField,
  SelectField,
} from "@/components/admin/ui/Fields";
import { type InvoiceLike } from "@/components/admin/print/InvoiceSheet";
import { InvoicePdfModal } from "@/components/admin/money/InvoicePdfModal";
import { useErpSession } from "@/components/admin/ErpAuthProvider";

const REGION = "europe-west1";

interface InvoiceRow extends InvoiceLike {
  id: string;
  customerEmail?: string;
  commissionPercent?: number;
  commissionKobo?: number;
  commissionNote?: string;
  discountPercent?: number;
  discountKobo?: number;
  taxMode?: TaxMode;
}

interface SourceOption {
  id: string;
  label: string;
  kind: "job" | "project";
}

/**
 * Invoices.
 *
 * Invoices are generated from a job or project rather than typed, so the figure
 * billed is the figure recorded. Managers can create, issue and take payment;
 * only an admin can declare an invoice settled, and that goes through a Cloud
 * Function rather than a client write.
 */
export function InvoicesScreen() {
  const session = useErpSession();
  // Marking paid and emailing an invoice. Grantable, so read as a capability.
  const isAdmin = session.can("invoice.markPaid");
  const canCreate = session.can("invoice.create");
  /** Editing a draft's lines, tax, commission and discount. */
  const canEdit = session.can("invoice.edit");
  /** Cancelling a document already issued to a customer. */
  const canVoid = session.can("invoice.void");
  /** Deleting a never-issued draft. */
  const canDelete = session.can("record.delete");

  const [rows, setRows] = useState<InvoiceRow[]>([]);
  const [jobs, setJobs] = useState<SourceOption[]>([]);
  const [projects, setProjects] = useState<SourceOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [statusFilter, setStatusFilter] = useState<InvoiceStatus | "all">("all");
  const [source, setSource] = useState("");
  /** The invoice whose server-rendered PDF is open for review, download or email. */
  const [pdfFor, setPdfFor] = useState<InvoiceRow | null>(null);
  const [payingId, setPayingId] = useState<string | null>(null);
  /**
   * Which invoice has its attachments panel open.
   *
   * Opened on demand rather than always: the panel reads a subcollection, and a list of thirty
   * invoices would otherwise fire thirty reads on every render of the screen.
   */
  const [attachmentsFor, setAttachmentsFor] = useState<string | null>(null);
  const [payAmount, setPayAmount] = useState("");
  /** Open when raising a standalone invoice. */
  const [composing, setComposing] = useState(false);
  /** The draft being corrected. */
  const [editingId, setEditingId] = useState<string | null>(null);

  useEffect(() => {
    const q = query(collection(getDb(), COL.invoices), orderBy("createdAt", "desc"), limit(200));
    return onSnapshot(
      q,
      (snap) => {
        setRows(
          snap.docs.map((d) => {
            const x = d.data();
            return {
              id: d.id,
              invoiceNumber: x.invoiceNumber ?? "",
              type: (x.type as "service" | "project") ?? "service",
              customerName: x.customerName ?? "",
              customerPhone: x.customerPhone ?? undefined,
              customerEmail: x.customerEmail ?? undefined,
              reference: x.reference ?? undefined,
              lines: x.lines ?? [],
              subtotalKobo: x.subtotalKobo ?? 0,
              discountPercent: x.discountPercent ?? 0,
              discountKobo: x.discountKobo ?? 0,
              // An invoice written before `taxMode` existed charged tax on top when
              // it had a rate, so that is what it must keep saying.
              taxMode:
                (x.taxMode as TaxMode) ??
                ((x.taxPercent ?? 0) > 0 ? "exclusive" : "none"),
              taxPercent: x.taxPercent ?? 0,
              taxKobo: x.taxKobo ?? 0,
              taxLabel: x.taxLabel ?? "VAT",
              commissionPercent: x.commissionPercent ?? 0,
              commissionKobo: x.commissionKobo ?? 0,
              commissionNote: x.commissionNote ?? undefined,
              totalKobo: x.totalKobo ?? 0,
              amountPaidKobo: x.amountPaidKobo ?? 0,
              balanceKobo: x.balanceKobo ?? 0,
              status: (x.status as InvoiceStatus) ?? "draft",
              issuedAtMs: x.issuedAt?.toMillis?.() ?? null,
              dueAtMs: x.dueAt?.toMillis?.() ?? null,
              notes: x.notes ?? undefined,
            };
          })
        );
        setLoading(false);
      },
      (e) => {
        setError(e.message);
        setLoading(false);
      }
    );
  }, []);

  // Sources for a new invoice: collected jobs with a balance, and approved or
  // completed projects. Offering every job would bury the ones ready to bill.
  useEffect(() => {
    const unsubJobs = onSnapshot(
      query(collection(getDb(), COL.serviceJobs), orderBy("receivedAt", "desc"), limit(100)),
      (snap) =>
        setJobs(
          snap.docs
            .filter((d) => (d.data().totalKobo ?? 0) > 0)
            .map((d) => ({
              id: d.id,
              kind: "job" as const,
              label: `${d.data().jobNumber} · ${d.data().customerName} · ${formatNaira(d.data().totalKobo ?? 0)}`,
            }))
        ),
      () => {}
    );
    const unsubProjects = onSnapshot(
      query(collection(getDb(), COL.projects), orderBy("createdAt", "desc"), limit(100)),
      (snap) =>
        setProjects(
          snap.docs
            .filter((d) => ["approved", "in_production", "installing", "completed"].includes(d.data().status))
            .map((d) => ({
              id: d.id,
              kind: "project" as const,
              label: `${d.data().projectNumber} · ${d.data().title}`,
            }))
        ),
      () => {}
    );
    return () => {
      unsubJobs();
      unsubProjects();
    };
  }, []);

  const actor = useMemo(
    () => ({
      uid: session.user?.uid ?? "",
      email: session.user?.email ?? "",
      role: session.role ?? "manager",
    }),
    [session.user, session.role]
  );

  const sources = useMemo(() => [...jobs, ...projects], [jobs, projects]);

  const visible = useMemo(
    () => (statusFilter === "all" ? rows : rows.filter((r) => r.status === statusFilter)),
    [rows, statusFilter]
  );

  const totals = useMemo(() => {
    const live = rows.filter((r) => r.status !== "void" && r.status !== "draft");
    return {
      outstanding: live.reduce((s, r) => s + r.balanceKobo, 0),
      overdue: live
        .filter((r) => r.balanceKobo > 0 && r.dueAtMs !== null && r.dueAtMs < Date.now())
        .reduce((s, r) => s + r.balanceKobo, 0),
      billed: live.reduce((s, r) => s + r.totalKobo, 0),
      // Commission owed on issued invoices. A cost the business has committed to by
      // raising them, so it belongs next to the receivable rather than hidden on
      // each document.
      commission: live.reduce((s, r) => s + (r.commissionKobo ?? 0), 0),
    };
  }, [rows]);

  async function generate() {
    const chosen = sources.find((s) => s.id === source);
    if (!chosen) {
      setError("Choose a job or project to invoice.");
      return;
    }
    setBusyId("new");
    setError("");
    try {
      const res =
        chosen.kind === "job"
          ? await createInvoiceFromJob(getDb(), actor, chosen.id)
          : await createInvoiceFromProject(getDb(), actor, chosen.id);
      setNotice(`${res.invoiceNumber} created as a draft.`);
      setSource("");
      setTimeout(() => setNotice(""), 6000);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not create the invoice.");
    } finally {
      setBusyId(null);
    }
  }

  async function markPaid(row: InvoiceRow) {
    setBusyId(row.id);
    setError("");
    try {
      const fn = httpsCallable<
        { invoiceId: string; sendReceipt: boolean },
        { invoiceNumber: string; settledKobo: number; receiptSent: boolean }
      >(getFunctions(getFirebaseApp(), REGION), "markInvoicePaid");
      const res = await fn({ invoiceId: row.id, sendReceipt: true });
      setNotice(
        `${res.data.invoiceNumber} marked paid.` +
          (res.data.receiptSent ? " Receipt emailed." : "")
      );
      setTimeout(() => setNotice(""), 6000);
    } catch (e) {
      setError(describeError(e));
    } finally {
      setBusyId(null);
    }
  }

  if (!session.ready) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center">
        <Loader2 className="animate-spin text-brass-400" size={28} aria-label="Loading" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl pb-20">
      {pdfFor && (
        <InvoicePdfModal
          invoiceId={pdfFor.id}
          invoiceNumber={pdfFor.invoiceNumber}
          customerEmail={pdfFor.customerEmail}
          // A draft is not a request for payment and a void invoice is not owed,
          // so neither may be sent. The server enforces this too.
          canEmail={isAdmin && pdfFor.status !== "draft" && pdfFor.status !== "void"}
          onClose={() => setPdfFor(null)}
          onEmailed={(to) => {
            setNotice(`${pdfFor.invoiceNumber} emailed to ${to}.`);
            setTimeout(() => setNotice(""), 6000);
          }}
        />
      )}

      <div className="print:hidden">
        <header>
          <p className="text-eyebrow">Money</p>
          <h1 className="text-title mt-3 text-cream-50">Invoices</h1>
          <p className="mt-3 max-w-2xl text-sm leading-relaxed text-cream-400">
            Generated from a job or project, so the amount billed is the amount
            recorded. Only an administrator can mark one paid.
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

        <div
          className={`mt-8 grid gap-4 ${
            totals.commission > 0 ? "sm:grid-cols-2 lg:grid-cols-4" : "sm:grid-cols-3"
          }`}
        >
          <Tile label="Outstanding" value={formatNaira(totals.outstanding)} tone={totals.outstanding > 0 ? "warn" : undefined} />
          <Tile label="Overdue" value={formatNaira(totals.overdue)} tone={totals.overdue > 0 ? "danger" : undefined} />
          <Tile label="Billed" value={formatNaira(totals.billed)} />
          {totals.commission > 0 && (
            <Tile
              label="Commission owed"
              value={formatNaira(totals.commission)}
              tone="warn"
            />
          )}
        </div>

        {canCreate && !composing && editingId === null && (
          <section className="mt-8 rounded-3xl border border-night-700/60 bg-night-900/30 p-6">
            <h2 className="flex items-center gap-2 font-display text-lg text-cream-100">
              <FileText size={18} className="text-brass-400" /> Create an invoice
            </h2>
            <div className="mt-5 grid gap-4 sm:grid-cols-[1fr_auto] sm:items-end">
              <SelectField
                id="inv-source"
                label="From a job or project"
                value={source}
                onChange={setSource}
                placeholder={sources.length ? "Select…" : "Nothing ready to invoice yet"}
                options={sources.map((s) => ({ value: s.id, label: s.label }))}
              />
              <Button onClick={generate} busy={busyId === "new"} disabled={!source}>
                Create draft
              </Button>
            </div>
            <p className="mt-2 text-xs text-cream-500">
              Jobs carry their payments across, so an invoice raised after a deposit
              shows the real balance. Project invoices list each priced component and
              addon as its own line.
            </p>

            {/* The standalone route. Billing that is not a job or a project — a
                delivery, a call-out, a one-off supply — previously had nowhere to go,
                so it was either invoiced on paper or a fake job was raised for it. */}
            <div className="mt-5 border-t border-night-700/60 pt-5">
              <Button variant="secondary" onClick={() => setComposing(true)}>
                <span className="flex items-center gap-1.5">
                  <PenLine size={14} /> Invoice something else
                </span>
              </Button>
              <p className="mt-2 text-xs text-cream-500">
                Type the lines by hand for work with no job or project behind it.
              </p>
            </div>
          </section>
        )}

        {composing && (
          <InvoiceEditor
            actor={actor}
            onClose={() => setComposing(false)}
            onSaved={(m) => {
              setNotice(m);
              setTimeout(() => setNotice(""), 6000);
            }}
          />
        )}

        <div className="mt-8 flex flex-wrap gap-2">
          <Chip active={statusFilter === "all"} onClick={() => setStatusFilter("all")} label="All" />
          {INVOICE_STATUSES.map((s) => (
            <Chip
              key={s}
              active={statusFilter === s}
              onClick={() => setStatusFilter(s)}
              label={INVOICE_STATUS_LABELS[s]}
            />
          ))}
        </div>

        {loading ? (
          <div className="mt-10 flex justify-center py-10">
            <Loader2 className="animate-spin text-brass-400" size={26} aria-label="Loading" />
          </div>
        ) : visible.length === 0 ? (
          <div className="mt-8">
            <EmptyState
              title={rows.length === 0 ? "No invoices yet" : "Nothing with this status"}
              hint={
                rows.length === 0
                  ? "Create one from a priced job or an approved project."
                  : "Try a different status."
              }
            />
          </div>
        ) : (
          <div className="mt-8 space-y-3">
            {visible.map((r) => {
              const overdue =
                r.balanceKobo > 0 && r.dueAtMs !== null && r.dueAtMs < Date.now();
              return (
                <div
                  key={r.id}
                  className="rounded-2xl border border-night-700/60 bg-night-900/40 p-5"
                >
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div className="min-w-0">
                      <p className="flex flex-wrap items-center gap-2.5">
                        <span className="font-medium text-cream-100">
                          {r.invoiceNumber}
                        </span>
                        <StatusPill tone={overdue ? "danger" : INVOICE_STATUS_TONE[r.status]}>
                          {overdue ? "Overdue" : INVOICE_STATUS_LABELS[r.status]}
                        </StatusPill>
                      </p>
                      <p className="mt-1 text-sm text-cream-300">{r.customerName}</p>
                      <p className="text-xs text-cream-500">
                        {r.reference ? `${r.reference} · ` : ""}
                        {r.lines.length} line{r.lines.length === 1 ? "" : "s"}
                        {r.dueAtMs
                          ? ` · due ${new Date(r.dueAtMs).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}`
                          : ""}
                      </p>
                      {/* What makes up the figure, where it is not simply the sum of
                          the lines. Discount, tax treatment and commission all change
                          how the total should be read. */}
                      {((r.discountKobo ?? 0) > 0 ||
                        r.taxKobo > 0 ||
                        (r.commissionKobo ?? 0) > 0) && (
                        <p className="mt-1 flex flex-wrap gap-x-3 text-xs text-cream-600">
                          {(r.discountKobo ?? 0) > 0 && (
                            <span>−{formatNaira(r.discountKobo ?? 0)} discount</span>
                          )}
                          {r.taxKobo > 0 && (
                            <span>
                              {formatNaira(r.taxKobo)} {r.taxLabel ?? "tax"}
                              {r.taxMode === "inclusive" ? " (incl.)" : ""}
                            </span>
                          )}
                          {(r.commissionKobo ?? 0) > 0 && (
                            <span className="text-amber-400/80">
                              {formatNaira(r.commissionKobo ?? 0)} commission
                              {r.commissionNote ? ` · ${r.commissionNote}` : ""}
                            </span>
                          )}
                        </p>
                      )}
                    </div>
                    <div className="text-right">
                      <p className="font-display text-xl text-cream-50">
                        {formatNaira(r.totalKobo)}
                      </p>
                      {r.balanceKobo > 0 ? (
                        <p className="text-xs text-amber-300">
                          {formatNaira(r.balanceKobo)} outstanding
                        </p>
                      ) : (
                        <p className="flex items-center justify-end gap-1 text-xs text-emerald-300">
                          <BadgeCheck size={12} /> Settled
                        </p>
                      )}
                    </div>
                  </div>

                  <div className="mt-4 flex flex-wrap gap-2">
                    {/* One action for the document: view it, download it, or email
                        it, all the same server-rendered PDF. The old print-only
                        route offered no way to keep or send a copy, and the PDF
                        viewer can print anyway. */}
                    <Button variant="secondary" onClick={() => setPdfFor(r)}>
                      <span className="flex items-center gap-1.5">
                        <FileText size={14} /> View &amp; download
                      </span>
                    </Button>
                    {/* Supporting documents. Opened on demand, because the panel reads a
                        subcollection and a list of thirty invoices would otherwise fire thirty
                        reads for panels nobody looked at. */}
                    <Button
                      variant="ghost"
                      onClick={() =>
                        setAttachmentsFor(attachmentsFor === r.id ? null : r.id)
                      }
                    >
                      <span className="flex items-center gap-1.5">
                        <Paperclip size={14} />
                        {attachmentsFor === r.id ? "Hide documents" : "Documents"}
                      </span>
                    </Button>

                    {r.status === "draft" && canEdit && (
                      <Button
                        variant="secondary"
                        onClick={() => setEditingId(editingId === r.id ? null : r.id)}
                      >
                        <span className="flex items-center gap-1.5">
                          <PenLine size={14} /> Edit
                        </span>
                      </Button>
                    )}

                    {r.status === "draft" && canCreate && (
                      <Button
                        onClick={() =>
                          issueInvoice(getDb(), actor, r.id, r.invoiceNumber).catch((e) =>
                            setError(e instanceof Error ? e.message : "Could not issue.")
                          )
                        }
                        busy={busyId === r.id}
                      >
                        <span className="flex items-center gap-1.5">
                          <Send size={14} /> Issue
                        </span>
                      </Button>
                    )}

                    {/* A never-issued draft can go. Anything issued is voided
                        instead, which keeps its number in the sequence — a gap in an
                        invoice sequence is the first thing an auditor asks about. */}
                    {r.status === "draft" && canDelete && (
                      <button
                        type="button"
                        aria-label={`Delete draft ${r.invoiceNumber}`}
                        disabled={busyId === r.id}
                        onClick={() => {
                          if (
                            !window.confirm(
                              `Delete draft ${r.invoiceNumber}? It has never been issued, so nothing has reached the customer.`
                            )
                          )
                            return;
                          setBusyId(r.id);
                          deleteDraftInvoice(getDb(), actor, r.id)
                            .then(() => {
                              setNotice(`${r.invoiceNumber} deleted.`);
                              setTimeout(() => setNotice(""), 6000);
                            })
                            .catch((e) =>
                              setError(
                                e instanceof Error ? e.message : "Could not delete."
                              )
                            )
                            .finally(() => setBusyId(null));
                        }}
                        className="cursor-pointer px-2 text-cream-500 transition-colors hover:text-red-400 disabled:opacity-40"
                      >
                        <Trash2 size={15} />
                      </button>
                    )}

                    {r.status !== "draft" && r.status !== "void" && canVoid && (
                      <button
                        type="button"
                        onClick={() => {
                          const reason = window.prompt(
                            `Void ${r.invoiceNumber}? Give a reason — it stays on the record.`
                          );
                          if (!reason?.trim()) return;
                          setBusyId(r.id);
                          voidInvoice(getDb(), actor, r.id, r.invoiceNumber, reason.trim())
                            .then(() => {
                              setNotice(`${r.invoiceNumber} voided.`);
                              setTimeout(() => setNotice(""), 6000);
                            })
                            .catch((e) =>
                              setError(
                                e instanceof Error ? e.message : "Could not void."
                              )
                            )
                            .finally(() => setBusyId(null));
                        }}
                        className="cursor-pointer px-2 text-xs text-cream-500 transition-colors hover:text-red-400"
                      >
                        Void
                      </button>
                    )}

                    {r.balanceKobo > 0 && r.status !== "draft" && r.status !== "void" && (
                      <>
                        {payingId === r.id ? (
                          <span className="flex flex-wrap items-end gap-2">
                            <span className="w-36">
                              <NumberField
                                id={`pay-${r.id}`}
                                label="Amount (₦)"
                                value={payAmount}
                                onChange={setPayAmount}
                              />
                            </span>
                            <Button
                              busy={busyId === r.id}
                              onClick={() => {
                                setBusyId(r.id);
                                recordInvoicePayment(
                                  getDb(),
                                  actor,
                                  r.id,
                                  r.invoiceNumber,
                                  parseNairaInput(payAmount)
                                )
                                  .then(() => {
                                    setPayingId(null);
                                    setPayAmount("");
                                  })
                                  .catch((e) =>
                                    setError(
                                      e instanceof Error ? e.message : "Could not record."
                                    )
                                  )
                                  .finally(() => setBusyId(null));
                              }}
                            >
                              Record
                            </Button>
                            <Button variant="ghost" onClick={() => setPayingId(null)}>
                              Cancel
                            </Button>
                          </span>
                        ) : (
                          <Button variant="secondary" onClick={() => setPayingId(r.id)}>
                            Record payment
                          </Button>
                        )}

                        {isAdmin && (
                          <Button onClick={() => markPaid(r)} busy={busyId === r.id}>
                            Mark paid
                          </Button>
                        )}
                      </>
                    )}
                  </div>

                  {!isAdmin && r.balanceKobo > 0 && r.status !== "draft" && (
                    <p className="mt-3 text-xs text-cream-600">
                      Marking an invoice paid is restricted to administrators.
                    </p>
                  )}

                  {/* The editor opens under the invoice it changes, so the figures
                      being restated stay in view while they are retyped. */}
                  {editingId === r.id && r.status === "draft" && (
                    <InvoiceEditor
                      actor={actor}
                      editing={{
                        id: r.id,
                        invoiceNumber: r.invoiceNumber,
                        customerName: r.customerName,
                        customerPhone: r.customerPhone,
                        customerEmail: r.customerEmail,
                        reference: r.reference,
                        lines: r.lines,
                        taxMode: r.taxMode,
                        taxPercent: r.taxPercent,
                        taxLabel: r.taxLabel,
                        commissionPercent: r.commissionPercent,
                        commissionNote: r.commissionNote,
                        discountPercent: r.discountPercent,
                        discountKobo: r.discountKobo,
                        notes: r.notes,
                      }}
                      onClose={() => setEditingId(null)}
                      onSaved={(m) => {
                        setNotice(m);
                        setTimeout(() => setNotice(""), 6000);
                      }}
                    />
                  )}

                  {/* Supporting documents, on the invoice they belong to.
                      The brief's reason, verbatim: "for customers when creating an invoice we can be
                      able to attach supporting documents (mostly cutting list document) with option
                      of printing... this is to prevent loss of customer cutting list document."
                      Only on the expanded row, so a list of thirty invoices does not fire thirty
                      subcollection reads. */}
                  {attachmentsFor === r.id && (
                    <div className="mt-4">
                      <FileAttachments
                        path={invoiceAttachmentsPath(r.id)}
                        storageFolder="invoices"
                        actor={actor}
                        canEdit={canCreate}
                        title="Supporting documents"
                        hint="The customer's cutting list, drawings, a signed sheet. Kept here so the paper copy cannot go missing."
                      />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
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
  tone?: "warn" | "danger";
}) {
  const colour =
    tone === "danger" ? "text-red-300" : tone === "warn" ? "text-amber-300" : "text-cream-50";
  return (
    <div className="rounded-3xl border border-night-700/60 bg-night-900/40 p-5">
      <p className="text-xs uppercase tracking-wider text-cream-500">{label}</p>
      <p className={`mt-2 font-display text-2xl ${colour}`}>{value}</p>
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

function describeError(e: unknown): string {
  if (typeof e === "object" && e !== null && "message" in e) {
    return String((e as { message: string }).message);
  }
  return "Something went wrong.";
}

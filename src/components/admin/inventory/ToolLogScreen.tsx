"use client";

import { useEffect, useMemo, useState } from "react";
import { collection, limit, onSnapshot, orderBy, query } from "firebase/firestore";
import {
  AlertTriangle,
  Loader2,
  Plus,
  FileText,
  Printer,
  ShieldAlert,
  Trash2,
  Wrench,
} from "lucide-react";
import { getDb } from "@/lib/firebase";
import { COL, toolItemsPath } from "@/lib/erp/collections";
import {
  TOOL_REQUEST_STATUS_LABELS,
  type ToolRequestStatus,
} from "@/lib/erp/enums";
import { createToolRequest, issueTools, returnTools } from "@/lib/erp/inventory";
import { fromDateInputValue, toDateInputValue } from "@/lib/erp/workLogs";
import { TOOL_REQUEST_STATUS_TONE } from "@/lib/erp/statusTone";
import { StatusPill } from "@/components/admin/ui/StatusPill";
import {
  Button,
  EmptyState,
  NumberField,
  TextField,
} from "@/components/admin/ui/Fields";
import { PrintPreview } from "@/components/admin/ui/PrintPreview";
import { useErpSession } from "@/components/admin/ErpAuthProvider";
import { StaffPicker, type PickedStaff } from "@/components/admin/services/StaffPicker";
import { ToolRequestSheet } from "@/components/admin/print/ToolRequestSheet";

interface ItemRow {
  id: string;
  name: string;
  description?: string;
  quantityRequested: number;
  quantityIssued?: number | null;
  quantityReturned?: number | null;
  remarks?: string;
}

interface RequestRow {
  id: string;
  requestNumber: string;
  jobName: string;
  jobLocation?: string;
  requestedByName: string;
  status: ToolRequestStatus;
  requestDateMs: number | null;
  expectedReturnMs: number | null;
  issuedByName?: string;
  returnedByName?: string;
  returnedDateMs: number | null;
}

interface DraftItem {
  key: string;
  name: string;
  description: string;
  qty: string;
}

let seq = 0;
const blankItem = (): DraftItem => ({
  key: `t${seq++}`,
  name: "",
  description: "",
  qty: "1",
});

/**
 * Tool request, issue and return log.
 *
 * The question this answers is what is off site and overdue. Overdue requests
 * sort first, because a tool that has not come back is the only entry that needs
 * a decision today.
 */
export function ToolLogScreen() {
  const session = useErpSession();
  const canIssue = session.can("tool.issue");
  const canRequest = session.can("tool.request");

  const [rows, setRows] = useState<RequestRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [adding, setAdding] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [printRequest, setPrintRequest] = useState<{
    request: RequestRow;
    items: ItemRow[];
  } | null>(null);
  const [printing, setPrinting] = useState(false);

  useEffect(() => {
    const q = query(
      collection(getDb(), COL.toolRequests),
      orderBy("requestDate", "desc"),
      limit(100)
    );
    return onSnapshot(
      q,
      (snap) => {
        setRows(
          snap.docs.map((d) => {
            const x = d.data();
            return {
              id: d.id,
              requestNumber: x.requestNumber ?? "",
              jobName: x.jobName ?? "",
              jobLocation: x.jobLocation ?? undefined,
              requestedByName: x.requestedByName ?? "",
              status: (x.status as ToolRequestStatus) ?? "requested",
              requestDateMs: x.requestDate?.toMillis?.() ?? null,
              expectedReturnMs: x.expectedReturnDate?.toMillis?.() ?? null,
              issuedByName: x.issuedByName ?? undefined,
              returnedByName: x.returnedByName ?? undefined,
              returnedDateMs: x.returnedDate?.toMillis?.() ?? null,
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

  const actor = useMemo(
    () => ({
      uid: session.user?.uid ?? "",
      email: session.user?.email ?? "",
      role: session.role ?? "operator",
    }),
    [session.user, session.role]
  );

  const isOverdue = (r: RequestRow) =>
    (r.status === "issued" || r.status === "partially_returned") &&
    r.expectedReturnMs !== null &&
    r.expectedReturnMs < Date.now();

  /** Overdue first: an unreturned tool is the only row needing a decision. */
  const sorted = useMemo(() => {
    const rank = (r: RequestRow) => {
      if (isOverdue(r)) return 0;
      if (r.status === "issued" || r.status === "partially_returned") return 1;
      if (r.status === "requested") return 2;
      return 3;
    };
    return [...rows].sort(
      (a, b) => rank(a) - rank(b) || (b.requestDateMs ?? 0) - (a.requestDateMs ?? 0)
    );
  }, [rows]);

  const stats = useMemo(
    () => ({
      offSite: rows.filter((r) => r.status === "issued" || r.status === "partially_returned")
        .length,
      overdue: rows.filter(isOverdue).length,
      awaiting: rows.filter((r) => r.status === "requested").length,
    }),
    [rows]
  );

  return (
    <div className="mx-auto max-w-5xl pb-20">
      {printRequest && (
        <PrintPreview
          title={`Tools request ${printRequest.request.requestNumber}`}
          paper="a4-portrait"
          onPrint={() => setPrinting(true)}
          onClose={() => {
            setPrintRequest(null);
            setPrinting(false);
          }}
        >
          <ToolRequestSheet
            request={printRequest.request}
            items={printRequest.items}
            autoPrint={false}
            onDone={() => {}}
          />
        </PrintPreview>
      )}
      {printing && printRequest && (
        <ToolRequestSheet
          request={printRequest.request}
          items={printRequest.items}
          onDone={() => {
            setPrinting(false);
            setPrintRequest(null);
          }}
        />
      )}

      <div className="print:hidden">
        <header className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-eyebrow">Tools</p>
            <h1 className="text-title mt-3 text-cream-50">Tool log</h1>
            <p className="mt-3 max-w-2xl text-sm leading-relaxed text-cream-400">
              What has left the factory, who took it, and whether it came back.
            </p>
          </div>
          {canRequest && !adding && (
            <Button onClick={() => setAdding(true)}>
              <span className="flex items-center gap-2">
                <Plus size={15} /> New request
              </span>
            </Button>
          )}
        </header>

        {error && (
          <p
            role="alert"
            className="mt-6 flex items-start gap-2 rounded-xl border border-red-500/30 bg-red-500/5 px-4 py-3 text-sm text-red-400"
          >
            <ShieldAlert size={16} className="mt-0.5 shrink-0" /> {error}
          </p>
        )}

        <div className="mt-8 grid gap-4 sm:grid-cols-3">
          <Tile label="Off site" value={String(stats.offSite)} />
          <Tile
            label="Overdue"
            value={String(stats.overdue)}
            tone={stats.overdue > 0 ? "danger" : undefined}
          />
          <Tile
            label="Awaiting issue"
            value={String(stats.awaiting)}
            tone={stats.awaiting > 0 ? "warn" : undefined}
          />
        </div>

        {adding && (
          <NewRequestForm actor={actor} onClose={() => setAdding(false)} onError={setError} />
        )}

        {loading ? (
          <div className="mt-10 flex justify-center py-10">
            <Loader2 className="animate-spin text-brass-400" size={26} aria-label="Loading" />
          </div>
        ) : sorted.length === 0 ? (
          <div className="mt-8">
            <EmptyState
              title="No tool requests"
              hint="Raise one when tools leave the factory for a site."
            />
          </div>
        ) : (
          <div className="mt-8 space-y-3">
            {sorted.map((r) => (
              <RequestPanel
                key={r.id}
                request={r}
                overdue={isOverdue(r)}
                open={openId === r.id}
                onToggle={() => setOpenId(openId === r.id ? null : r.id)}
                canIssue={canIssue}
                actor={actor}
                onError={setError}
                onPrint={(items) => setPrintRequest({ request: r, items })}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function RequestPanel({
  request,
  overdue,
  open,
  onToggle,
  canIssue,
  actor,
  onError,
  onPrint,
}: {
  request: RequestRow;
  overdue: boolean;
  open: boolean;
  onToggle: () => void;
  canIssue: boolean;
  actor: { uid: string; email: string; role: "admin" | "manager" | "operator" };
  onError: (m: string) => void;
  onPrint: (items: ItemRow[]) => void;
}) {
  const [items, setItems] = useState<ItemRow[]>([]);
  const [issuing, setIssuing] = useState(false);
  const [returning, setReturning] = useState(false);
  const [byName, setByName] = useState("");
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    return onSnapshot(
      collection(getDb(), toolItemsPath(request.id)),
      (snap) =>
        setItems(
          snap.docs.map((d) => ({
            id: d.id,
            name: d.data().name ?? "",
            description: d.data().description ?? undefined,
            quantityRequested: d.data().quantityRequested ?? 0,
            quantityIssued: d.data().quantityIssued ?? null,
            quantityReturned: d.data().quantityReturned ?? null,
            remarks: d.data().remarks ?? undefined,
          }))
        ),
      () => {}
    );
  }, [open, request.id]);

  async function doIssue() {
    if (!byName.trim()) {
      onError("Record who issued the tools.");
      return;
    }
    setBusy(true);
    try {
      await issueTools(
        getDb(),
        actor,
        request.id,
        request.requestNumber,
        items.map((i) => ({
          itemId: i.id,
          quantityIssued: Number(amounts[i.id] ?? i.quantityRequested) || 0,
        })),
        byName.trim()
      );
      setIssuing(false);
      setByName("");
      setAmounts({});
    } catch (e) {
      onError(e instanceof Error ? e.message : "Could not issue the tools.");
    } finally {
      setBusy(false);
    }
  }

  async function doReturn() {
    if (!byName.trim()) {
      onError("Record who returned the tools.");
      return;
    }
    setBusy(true);
    try {
      const res = await returnTools(
        getDb(),
        actor,
        request.id,
        request.requestNumber,
        items.map((i) => ({
          itemId: i.id,
          quantityIssued: i.quantityIssued ?? 0,
          quantityReturned: Number(amounts[i.id] ?? i.quantityIssued ?? 0) || 0,
        })),
        byName.trim()
      );
      if (!res.complete) {
        onError(
          "Recorded as a partial return: not every issued tool is back, so it stays on the overdue list."
        );
      }
      setReturning(false);
      setByName("");
      setAmounts({});
    } catch (e) {
      onError(e instanceof Error ? e.message : "Could not record the return.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className={`overflow-hidden rounded-2xl border ${
        overdue ? "border-red-500/40 bg-red-500/5" : "border-night-700/60 bg-night-900/40"
      }`}
    >
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="flex w-full cursor-pointer items-center justify-between gap-4 p-5 text-left"
      >
        <span className="flex min-w-0 items-center gap-3">
          <Wrench
            size={17}
            className={`shrink-0 ${overdue ? "text-red-400" : "text-cream-500"}`}
          />
          <span className="min-w-0">
            <span className="block truncate text-cream-100">{request.jobName}</span>
            <span className="block text-xs text-cream-500">
              {request.requestNumber} · {request.requestedByName}
              {request.jobLocation ? ` · ${request.jobLocation}` : ""}
            </span>
          </span>
        </span>
        <span className="flex shrink-0 items-center gap-3">
          {overdue && (
            <StatusPill tone="danger">
              <AlertTriangle size={12} /> Overdue
            </StatusPill>
          )}
          <StatusPill tone={TOOL_REQUEST_STATUS_TONE[request.status]}>
            {TOOL_REQUEST_STATUS_LABELS[request.status]}
          </StatusPill>
        </span>
      </button>

      {open && (
        <div className="border-t border-night-700/60 p-5">
          <dl className="grid gap-4 text-sm sm:grid-cols-3">
            <Detail
              label="Requested"
              value={
                request.requestDateMs
                  ? new Date(request.requestDateMs).toLocaleDateString("en-GB")
                  : "-"
              }
            />
            <Detail
              label="Due back"
              value={
                request.expectedReturnMs
                  ? new Date(request.expectedReturnMs).toLocaleDateString("en-GB")
                  : "Not set"
              }
            />
            <Detail label="Issued by" value={request.issuedByName ?? "-"} />
          </dl>

          <h3 className="mt-5 text-xs uppercase tracking-wider text-cream-500">Tools</h3>
          <ul className="mt-2 divide-y divide-night-800">
            {items.map((i) => {
              const outstanding =
                (i.quantityIssued ?? 0) - (i.quantityReturned ?? 0);
              return (
                <li key={i.id} className="flex items-center justify-between gap-4 py-2.5">
                  <span className="min-w-0">
                    <span className="text-sm text-cream-200">{i.name}</span>
                    {i.description && (
                      <span className="block text-xs text-cream-500">{i.description}</span>
                    )}
                  </span>
                  <span className="shrink-0 text-right text-xs">
                    <span className="block text-cream-400">
                      {i.quantityRequested} requested
                      {i.quantityIssued != null ? ` · ${i.quantityIssued} issued` : ""}
                      {i.quantityReturned != null ? ` · ${i.quantityReturned} back` : ""}
                    </span>
                    {outstanding > 0 && (
                      <span className="block text-amber-300">{outstanding} outstanding</span>
                    )}
                  </span>
                </li>
              );
            })}
          </ul>

          <div className="mt-5 flex flex-wrap gap-2">
            <Button variant="secondary" onClick={() => onPrint(items)}>
              <span className="flex items-center gap-1.5">
                <FileText size={14} /> View &amp; download
              </span>
            </Button>

            {canIssue && request.status === "requested" && !issuing && (
              <Button
                onClick={() => {
                  setIssuing(true);
                  setAmounts(
                    Object.fromEntries(items.map((i) => [i.id, String(i.quantityRequested)]))
                  );
                }}
              >
                Issue tools
              </Button>
            )}
            {canIssue &&
              (request.status === "issued" || request.status === "partially_returned") &&
              !returning && (
                <Button
                  onClick={() => {
                    setReturning(true);
                    setAmounts(
                      Object.fromEntries(
                        items.map((i) => [i.id, String(i.quantityIssued ?? 0)])
                      )
                    );
                  }}
                >
                  Record return
                </Button>
              )}
          </div>

          {(issuing || returning) && (
            <div className="mt-5 rounded-xl border border-brass-500/30 bg-night-950/40 p-4">
              <p className="text-sm text-cream-200">
                {issuing ? "Issuing tools" : "Recording a return"}
              </p>
              <div className="mt-3 space-y-2">
                {items.map((i) => (
                  <div key={i.id} className="flex items-end gap-3">
                    <span className="min-w-0 flex-1 truncate pb-3 text-sm text-cream-300">
                      {i.name}
                    </span>
                    <span className="w-24">
                      <NumberField
                        id={`amt-${i.id}`}
                        label={issuing ? "Issue" : "Returned"}
                        value={amounts[i.id] ?? ""}
                        onChange={(v) => setAmounts((p) => ({ ...p, [i.id]: v }))}
                      />
                    </span>
                  </div>
                ))}
              </div>
              <div className="mt-3">
                <TextField
                  id={`by-${request.id}`}
                  label={issuing ? "Issued by" : "Returned by"}
                  value={byName}
                  onChange={setByName}
                  required
                />
              </div>
              {returning && (
                <p className="mt-2 text-xs text-cream-500">
                  Anything short of the issued quantity stays on the overdue list, so a
                  missing tool cannot quietly drop off.
                </p>
              )}
              <div className="mt-4 flex gap-2">
                <Button onClick={issuing ? doIssue : doReturn} busy={busy}>
                  {issuing ? "Confirm issue" : "Confirm return"}
                </Button>
                <Button
                  variant="ghost"
                  onClick={() => {
                    setIssuing(false);
                    setReturning(false);
                  }}
                >
                  Cancel
                </Button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function NewRequestForm({
  actor,
  onClose,
  onError,
}: {
  actor: { uid: string; email: string; role: "admin" | "manager" | "operator" };
  onClose: () => void;
  onError: (m: string) => void;
}) {
  const [jobName, setJobName] = useState("");
  const [location, setLocation] = useState("");
  const [staff, setStaff] = useState<PickedStaff | null>(null);
  const [dueBack, setDueBack] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() + 3);
    return toDateInputValue(d);
  });
  const [items, setItems] = useState<DraftItem[]>([blankItem()]);
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (!jobName.trim()) {
      onError("Name the job the tools are for.");
      return;
    }
    if (!staff) {
      onError("Select who is requesting.");
      return;
    }
    const ready = items.filter((i) => i.name.trim() && Number(i.qty) > 0);
    if (ready.length === 0) {
      onError("List at least one tool with a quantity.");
      return;
    }

    setBusy(true);
    try {
      await createToolRequest(getDb(), actor, {
        jobName: jobName.trim(),
        jobLocation: location.trim() || undefined,
        requestedByStaffId: staff.id,
        requestedByName: staff.name,
        expectedReturnDate: dueBack ? fromDateInputValue(dueBack) : undefined,
        items: ready.map((i) => ({
          name: i.name.trim(),
          description: i.description.trim() || undefined,
          quantityRequested: Number(i.qty),
        })),
      });
      onClose();
    } catch (e) {
      onError(e instanceof Error ? e.message : "Could not create the request.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="mt-6 rounded-3xl border border-brass-500/30 bg-night-900/40 p-6">
      <h2 className="font-display text-lg text-cream-100">New tool request</h2>
      <div className="mt-5 grid gap-4 sm:grid-cols-2">
        <TextField
          id="tool-job"
          label="Job name"
          value={jobName}
          onChange={setJobName}
          placeholder="Yakubu kitchen install"
          required
        />
        <TextField
          id="tool-loc"
          label="Job location"
          value={location}
          onChange={setLocation}
          placeholder="Gwarinpa"
        />
        <StaffPicker
          value={staff}
          onChange={setStaff}
          createdBy={actor.uid}
          label="Requested by"
          required
        />
        <div>
          <label htmlFor="tool-due" className="mb-1.5 block text-sm text-cream-300">
            Due back
          </label>
          <input
            id="tool-due"
            type="date"
            value={dueBack}
            onChange={(e) => setDueBack(e.target.value)}
            className="w-full rounded-xl border border-night-600 bg-night-800/60 px-4 py-3 text-cream-100 focus:border-brass-500 focus:outline-none"
          />
        </div>
      </div>

      <h3 className="mt-6 text-sm text-cream-300">Tools</h3>
      <div className="mt-2 space-y-2">
        {items.map((i, idx) => (
          <div key={i.key} className="grid items-end gap-3 sm:grid-cols-[1fr_1fr_5rem_2rem]">
            <TextField
              id={`t-name-${i.key}`}
              label={idx === 0 ? "Tool" : ""}
              value={i.name}
              onChange={(v) =>
                setItems((p) => p.map((x) => (x.key === i.key ? { ...x, name: v } : x)))
              }
              placeholder="Cordless drill"
            />
            <TextField
              id={`t-desc-${i.key}`}
              label={idx === 0 ? "Description" : ""}
              value={i.description}
              onChange={(v) =>
                setItems((p) =>
                  p.map((x) => (x.key === i.key ? { ...x, description: v } : x))
                )
              }
            />
            <NumberField
              id={`t-qty-${i.key}`}
              label={idx === 0 ? "Qty" : ""}
              value={i.qty}
              onChange={(v) =>
                setItems((p) => p.map((x) => (x.key === i.key ? { ...x, qty: v } : x)))
              }
            />
            {items.length > 1 && (
              <button
                type="button"
                aria-label={`Remove tool ${idx + 1}`}
                onClick={() => setItems((p) => p.filter((x) => x.key !== i.key))}
                className="mb-3 cursor-pointer text-cream-500 transition-colors hover:text-red-400"
              >
                <Trash2 size={15} />
              </button>
            )}
          </div>
        ))}
      </div>
      <button
        type="button"
        onClick={() => setItems((p) => [...p, blankItem()])}
        className="mt-3 flex cursor-pointer items-center gap-2 text-sm text-brass-300 transition-colors hover:text-brass-200"
      >
        <Plus size={15} /> Add another tool
      </button>

      <div className="mt-5 flex gap-3">
        <Button onClick={submit} busy={busy}>
          Create request
        </Button>
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
      </div>
    </section>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wider text-cream-500">{label}</dt>
      <dd className="mt-0.5 text-cream-100">{value}</dd>
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

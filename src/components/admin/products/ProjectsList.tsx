"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { collection, limit, onSnapshot, orderBy, query } from "firebase/firestore";
import { Loader2, Plus, Search, ShieldAlert } from "lucide-react";
import { getDb } from "@/lib/firebase";
import { COL } from "@/lib/erp/collections";
import {
  PROJECT_STATUSES,
  PROJECT_STATUS_LABELS,
  type ProjectStatus,
} from "@/lib/erp/enums";
import { formatNaira } from "@/lib/erp/money";
import { createProject } from "@/lib/erp/projects";
import { PROJECT_STATUS_TONE } from "@/lib/erp/statusTone";
import { StatusPill } from "@/components/admin/ui/StatusPill";
import { Button, EmptyState, TextField } from "@/components/admin/ui/Fields";
import { useErpSession } from "@/components/admin/ErpAuthProvider";
import { CustomerPicker, type PickedCustomer } from "@/components/admin/services/CustomerPicker";

interface ProjectRow {
  id: string;
  projectNumber: string;
  customerName: string;
  title: string;
  location?: string;
  status: ProjectStatus;
  estimatedCostKobo: number;
  contractValueKobo?: number;
  targetDateMs: number | null;
}

/** Statuses treated as live work, for the default filter. */
const OPEN: ProjectStatus[] = [
  "enquiry",
  "estimating",
  "awaiting_approval",
  "approved",
  "in_production",
  "installing",
];

/**
 * Projects list.
 *
 * Defaults to live work rather than all history: the question in front of a
 * manager is what is running now, and completed projects are one click away.
 */
export function ProjectsList() {
  const session = useErpSession();
  const [rows, setRows] = useState<ProjectRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [statusFilter, setStatusFilter] = useState<ProjectStatus | "open" | "all">("open");
  const [term, setTerm] = useState("");
  const [creating, setCreating] = useState(false);

  const canCreate = session.can("project.create");

  useEffect(() => {
    const q = query(
      collection(getDb(), COL.projects),
      orderBy("createdAt", "desc"),
      limit(200)
    );
    return onSnapshot(
      q,
      (snap) => {
        setRows(
          snap.docs.map((d) => {
            const x = d.data();
            return {
              id: d.id,
              projectNumber: x.projectNumber ?? "",
              customerName: x.customerName ?? "",
              title: x.title ?? "",
              location: x.location ?? undefined,
              status: (x.status as ProjectStatus) ?? "enquiry",
              estimatedCostKobo: x.estimatedCostKobo ?? 0,
              contractValueKobo: x.contractValueKobo ?? undefined,
              targetDateMs: x.targetDate?.toMillis?.() ?? null,
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

  const counts = useMemo(() => {
    const c: Partial<Record<ProjectStatus, number>> = {};
    for (const r of rows) c[r.status] = (c[r.status] ?? 0) + 1;
    return c;
  }, [rows]);

  const visible = useMemo(() => {
    const t = term.trim().toLowerCase();
    return rows.filter((r) => {
      const statusOk =
        statusFilter === "all"
          ? true
          : statusFilter === "open"
            ? OPEN.includes(r.status)
            : r.status === statusFilter;
      if (!statusOk) return false;
      if (!t) return true;
      return (
        r.projectNumber.toLowerCase().includes(t) ||
        r.title.toLowerCase().includes(t) ||
        r.customerName.toLowerCase().includes(t)
      );
    });
  }, [rows, statusFilter, term]);

  const pipelineValue = useMemo(
    () =>
      rows
        .filter((r) => OPEN.includes(r.status))
        .reduce((s, r) => s + (r.contractValueKobo ?? r.estimatedCostKobo), 0),
    [rows]
  );

  return (
    <div className="mx-auto max-w-7xl pb-20">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-eyebrow">Products</p>
          <h1 className="text-title mt-3 text-cream-50">Projects</h1>
          <p className="mt-3 max-w-2xl text-sm leading-relaxed text-cream-400">
            Client work built from components and priced features: kitchens,
            closets, doors, TV walls and bedsets.
          </p>
        </div>
        {canCreate && !creating && (
          <Button onClick={() => setCreating(true)}>
            <span className="flex items-center gap-2">
              <Plus size={15} /> New project
            </span>
          </Button>
        )}
      </header>

      {error && (
        <p role="alert" className="mt-6 flex items-center gap-2 text-sm text-red-400">
          <ShieldAlert size={16} /> {error}
        </p>
      )}

      {creating && <NewProjectForm onClose={() => setCreating(false)} onError={setError} />}

      <div className="mt-8 grid gap-4 sm:grid-cols-3">
        <Tile label="Live projects" value={String(rows.filter((r) => OPEN.includes(r.status)).length)} />
        <Tile
          label="Awaiting approval"
          value={String(counts.awaiting_approval ?? 0)}
          tone={counts.awaiting_approval ? "warn" : undefined}
        />
        <Tile label="Pipeline value" value={formatNaira(pipelineValue)} />
      </div>

      <div className="mt-8 flex flex-wrap items-center gap-2">
        <Chip active={statusFilter === "open"} onClick={() => setStatusFilter("open")} label="Live" />
        {PROJECT_STATUSES.map((s) => (
          <Chip
            key={s}
            active={statusFilter === s}
            onClick={() => setStatusFilter(s)}
            label={`${PROJECT_STATUS_LABELS[s]}${counts[s] ? ` (${counts[s]})` : ""}`}
          />
        ))}
        <Chip active={statusFilter === "all"} onClick={() => setStatusFilter("all")} label="All" />

        <div className="relative ml-auto">
          <Search
            size={15}
            aria-hidden
            className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-cream-500"
          />
          <input
            type="search"
            value={term}
            onChange={(e) => setTerm(e.target.value)}
            placeholder="Project, client or number"
            aria-label="Search projects"
            className="w-60 rounded-xl border border-night-600 bg-night-800/60 py-2.5 pl-9 pr-3 text-sm text-cream-100 placeholder:text-cream-600 focus:border-brass-500 focus:outline-none"
          />
        </div>
      </div>

      {loading ? (
        <div className="mt-10 flex justify-center py-10">
          <Loader2 className="animate-spin text-brass-400" size={26} aria-label="Loading" />
        </div>
      ) : visible.length === 0 ? (
        <div className="mt-8">
          <EmptyState
            title={rows.length === 0 ? "No projects yet" : "Nothing matches this filter"}
            hint={
              rows.length === 0
                ? "Create a project, add its components, then price the features to build an estimate."
                : "Try a different status or clear the search."
            }
          />
        </div>
      ) : (
        <div className="mt-8 overflow-x-auto rounded-3xl border border-night-700/60">
          <table className="w-full min-w-[56rem] text-left text-sm">
            <thead className="bg-night-900/70 text-xs uppercase tracking-wider text-cream-500">
              <tr>
                <th className="px-5 py-3 font-medium">Project</th>
                <th className="px-5 py-3 font-medium">Client</th>
                <th className="px-5 py-3 font-medium">Status</th>
                <th className="px-5 py-3 font-medium">Target</th>
                <th className="px-5 py-3 text-right font-medium">Estimated</th>
                <th className="px-5 py-3 text-right font-medium">Contract</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-night-800">
              {visible.map((r) => (
                <tr key={r.id} className="transition-colors hover:bg-night-900/40">
                  <td className="px-5 py-4">
                    <Link
                      href={`/admin/projects/detail/?id=${r.id}`}
                      className="font-medium text-brass-300 underline-offset-4 hover:underline"
                    >
                      {r.title || r.projectNumber}
                    </Link>
                    <span className="block text-xs text-cream-500">
                      {r.projectNumber}
                      {r.location ? ` · ${r.location}` : ""}
                    </span>
                  </td>
                  <td className="px-5 py-4 text-cream-100">{r.customerName}</td>
                  <td className="px-5 py-4">
                    <StatusPill tone={PROJECT_STATUS_TONE[r.status]}>
                      {PROJECT_STATUS_LABELS[r.status]}
                    </StatusPill>
                  </td>
                  <td className="px-5 py-4 text-xs text-cream-400">
                    {r.targetDateMs
                      ? new Date(r.targetDateMs).toLocaleDateString("en-GB", {
                          day: "numeric",
                          month: "short",
                        })
                      : "-"}
                  </td>
                  <td className="px-5 py-4 text-right text-cream-200">
                    {formatNaira(r.estimatedCostKobo)}
                  </td>
                  <td className="px-5 py-4 text-right">
                    {r.contractValueKobo ? (
                      <span className="text-emerald-300">
                        {formatNaira(r.contractValueKobo)}
                      </span>
                    ) : (
                      <span className="text-cream-600">-</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function NewProjectForm({
  onClose,
  onError,
}: {
  onClose: () => void;
  onError: (m: string) => void;
}) {
  const session = useErpSession();
  const [customer, setCustomer] = useState<PickedCustomer | null>(null);
  const [title, setTitle] = useState("");
  const [location, setLocation] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (!customer) {
      onError("Select or create the client.");
      return;
    }
    if (!title.trim()) {
      onError("Give the project a title.");
      return;
    }
    setBusy(true);
    try {
      await createProject(
        getDb(),
        {
          uid: session.user?.uid ?? "",
          email: session.user?.email ?? "",
          role: session.role ?? "manager",
        },
        {
          customerId: customer.id,
          customerName: customer.name,
          title: title.trim(),
          location: location.trim() || undefined,
        }
      );
      onClose();
    } catch (e) {
      onError(e instanceof Error ? e.message : "Could not create the project.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="mt-6 rounded-3xl border border-brass-500/30 bg-night-900/40 p-6">
      <h2 className="font-display text-lg text-cream-100">New project</h2>
      <div className="mt-5 grid gap-4 sm:grid-cols-3">
        <CustomerPicker
          value={customer}
          onChange={setCustomer}
          createdBy={session.user?.uid ?? ""}
        />
        <TextField
          id="proj-title"
          label="Project title"
          value={title}
          onChange={setTitle}
          placeholder="Yakubu 4-bedroom"
          required
        />
        <TextField
          id="proj-location"
          label="Location"
          value={location}
          onChange={setLocation}
          placeholder="Gwarinpa, Abuja"
        />
      </div>
      <div className="mt-5 flex gap-3">
        <Button onClick={submit} busy={busy}>
          Create project
        </Button>
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
      </div>
    </section>
  );
}

function Tile({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "warn";
}) {
  return (
    <div className="rounded-3xl border border-night-700/60 bg-night-900/40 p-5">
      <p className="text-xs uppercase tracking-wider text-cream-500">{label}</p>
      <p
        className={`mt-2 font-display text-2xl ${
          tone === "warn" ? "text-amber-300" : "text-cream-50"
        }`}
      >
        {value}
      </p>
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

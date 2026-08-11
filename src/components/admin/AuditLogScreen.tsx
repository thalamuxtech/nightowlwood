"use client";

import { useEffect, useMemo, useState } from "react";
import { collection, limit, onSnapshot, orderBy, query } from "firebase/firestore";
import { ChevronDown, Loader2, ScrollText, Search, ShieldAlert } from "lucide-react";
import { getDb } from "@/lib/firebase";
import { COL } from "@/lib/erp/collections";
import { ROLE_LABELS, type Role } from "@/lib/erp/enums";
import { EmptyState, SelectField, TextField } from "@/components/admin/ui/Fields";
import { useErpSession } from "@/components/admin/ErpAuthProvider";

interface Entry {
  id: string;
  actorUid: string;
  actorEmail: string;
  actorRole: Role;
  action: string;
  collectionName: string;
  docId: string;
  summary?: string;
  before?: Record<string, unknown>;
  after?: Record<string, unknown>;
  atMs: number | null;
}

/** How many entries to hold on screen. */
const PAGE = 200;

/**
 * Actions grouped for filtering.
 *
 * Grouped rather than offering the raw action list, which is thirty-odd dotted names
 * that mean nothing to whoever is looking. The questions people actually arrive with
 * are "who touched the money", "who changed someone's pay" and "what was deleted".
 */
const LENSES: Array<{ key: string; label: string; matches: (a: string) => boolean }> = [
  { key: "all", label: "Everything", matches: () => true },
  {
    key: "money",
    label: "Money",
    matches: (a) =>
      a.startsWith("invoice") || a.startsWith("payment") || a === "create" || a === "update",
  },
  {
    key: "payroll",
    label: "Payroll",
    matches: (a) => a.startsWith("wage") || a.startsWith("loan"),
  },
  {
    key: "deletions",
    label: "Deletions",
    matches: (a) => a === "delete",
  },
  {
    key: "access",
    label: "Access & settings",
    matches: (a) =>
      a === "role_change" || a === "user_deactivate" || a === "settings_change" || a === "login",
  },
];

/**
 * The activity log.
 *
 * Every mutation to money, payroll, stock or status has always written an entry here —
 * `writeAudit` is called from every write path, and the rules allow create but never
 * update or delete, so the trail cannot be rewritten even by an admin. What was
 * missing was any way to *read* it, which made the trail useless for exactly the
 * disputes it exists to settle: who marked that invoice paid, who changed that wage
 * rate, who deleted that work log.
 *
 * Read-only by construction. There are no actions on this screen, because an audit log
 * you can act on is not an audit log.
 */
export function AuditLogScreen() {
  const session = useErpSession();

  const [entries, setEntries] = useState<Entry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [lens, setLens] = useState("all");
  const [term, setTerm] = useState("");
  const [actor, setActor] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);

  useEffect(() => {
    return onSnapshot(
      query(collection(getDb(), COL.auditLog), orderBy("at", "desc"), limit(PAGE)),
      (snap) => {
        setEntries(
          snap.docs.map((d) => {
            const x = d.data();
            return {
              id: d.id,
              actorUid: x.actorUid ?? "",
              actorEmail: x.actorEmail ?? "",
              actorRole: (x.actorRole as Role) ?? "manager",
              action: x.action ?? "",
              collectionName: x.collectionName ?? "",
              docId: x.docId ?? "",
              summary: x.summary ?? undefined,
              before: (x.before as Record<string, unknown>) ?? undefined,
              after: (x.after as Record<string, unknown>) ?? undefined,
              atMs: x.at?.toMillis?.() ?? null,
            };
          })
        );
        setLoading(false);
      },
      (e) => {
        setError(
          e.code === "permission-denied"
            ? "You do not have permission to read the activity log."
            : e.message
        );
        setLoading(false);
      }
    );
  }, []);

  /** Everyone who appears in the loaded window, for the actor filter. */
  const actors = useMemo(() => {
    const seen = new Map<string, string>();
    for (const e of entries) if (e.actorEmail) seen.set(e.actorEmail, e.actorEmail);
    return [...seen.keys()].sort();
  }, [entries]);

  const visible = useMemo(() => {
    const lensFn = LENSES.find((l) => l.key === lens)?.matches ?? (() => true);
    const needle = term.trim().toLowerCase();
    return entries.filter((e) => {
      if (!lensFn(e.action)) return false;
      if (actor && e.actorEmail !== actor) return false;
      if (!needle) return true;
      // Searched across the fields someone would actually recall: the summary text,
      // the document number in it, the collection, and who did it.
      return (
        (e.summary ?? "").toLowerCase().includes(needle) ||
        e.collectionName.toLowerCase().includes(needle) ||
        e.action.toLowerCase().includes(needle) ||
        e.actorEmail.toLowerCase().includes(needle) ||
        e.docId.toLowerCase().includes(needle)
      );
    });
  }, [entries, lens, actor, term]);

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
        <h1 className="text-title mt-3 text-cream-50">Activity log</h1>
        <p className="mt-3 max-w-2xl text-sm leading-relaxed text-cream-400">
          Every change to money, payroll, stock and status, with who made it and when.
          Entries can be added but never edited or removed — not by anyone, including an
          administrator.
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

      <div className="mt-8 flex flex-wrap gap-2">
        {LENSES.map((l) => (
          <button
            key={l.key}
            type="button"
            onClick={() => setLens(l.key)}
            aria-pressed={lens === l.key}
            className={`cursor-pointer rounded-full border px-4 py-2 text-xs font-medium transition-all duration-300 ${
              lens === l.key
                ? "border-brass-500 bg-brass-500 text-night-950"
                : "border-night-600 text-cream-300 hover:border-brass-500/60 hover:text-brass-300"
            }`}
          >
            {l.label}
          </button>
        ))}
      </div>

      <div className="mt-5 grid gap-4 sm:grid-cols-2">
        <TextField
          id="audit-search"
          label="Search"
          value={term}
          onChange={setTerm}
          placeholder="Invoice number, staff name, anything in the summary"
        />
        <SelectField
          id="audit-actor"
          label="Who"
          value={actor}
          onChange={setActor}
          placeholder="Anyone"
          options={actors.map((a) => ({ value: a, label: a }))}
        />
      </div>

      {loading ? (
        <div className="mt-10 flex justify-center py-10">
          <Loader2 className="animate-spin text-brass-400" size={26} aria-label="Loading" />
        </div>
      ) : visible.length === 0 ? (
        <div className="mt-8">
          <EmptyState
            title={entries.length === 0 ? "Nothing logged yet" : "Nothing matches"}
            hint={
              entries.length === 0
                ? "Entries appear here as soon as anyone records or changes something."
                : "Try a different filter or search term."
            }
          />
        </div>
      ) : (
        <>
          <p className="mt-6 text-xs text-cream-500">
            {visible.length} of the last {entries.length} entries
            {entries.length === PAGE && ` (the ${PAGE} most recent are loaded)`}
          </p>

          <ul className="mt-3 space-y-2">
            {visible.map((e) => {
              const hasDetail =
                (e.before && Object.keys(e.before).length > 0) ||
                (e.after && Object.keys(e.after).length > 0);
              const open = openId === e.id;
              return (
                <li
                  key={e.id}
                  className="rounded-2xl border border-night-700/60 bg-night-900/40 p-4"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="flex flex-wrap items-center gap-2 text-sm">
                        <span className="rounded-md bg-night-800 px-2 py-0.5 font-mono text-[0.7rem] text-brass-300">
                          {e.action}
                        </span>
                        <span className="text-cream-100">
                          {e.summary ?? `${e.collectionName}/${e.docId}`}
                        </span>
                      </p>
                      <p className="mt-1.5 text-xs text-cream-500">
                        {e.actorEmail || "unknown"}
                        <span className="mx-1.5 text-cream-700">·</span>
                        {ROLE_LABELS[e.actorRole] ?? e.actorRole}
                        <span className="mx-1.5 text-cream-700">·</span>
                        {e.collectionName}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-3">
                      <span className="text-xs text-cream-500">
                        {e.atMs
                          ? new Date(e.atMs).toLocaleString("en-GB", {
                              day: "numeric",
                              month: "short",
                              hour: "2-digit",
                              minute: "2-digit",
                            })
                          : "pending"}
                      </span>
                      {hasDetail && (
                        <button
                          type="button"
                          aria-expanded={open}
                          aria-label={open ? "Hide what changed" : "Show what changed"}
                          onClick={() => setOpenId(open ? null : e.id)}
                          className="cursor-pointer text-cream-500 transition-colors hover:text-brass-300"
                        >
                          <ChevronDown
                            size={15}
                            className={`transition-transform duration-200 ${
                              open ? "rotate-180" : ""
                            }`}
                          />
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Before and after, side by side. For money, what a figure was
                      changed *from* is as important as what it became. */}
                  {open && hasDetail && (
                    <div className="mt-3 grid gap-3 border-t border-night-800 pt-3 sm:grid-cols-2">
                      <FieldSet title="Before" data={e.before} />
                      <FieldSet title="After" data={e.after} />
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </>
      )}
    </div>
  );
}

function FieldSet({
  title,
  data,
}: {
  title: string;
  data?: Record<string, unknown>;
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
            <dd className="break-all font-mono text-cream-300">
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

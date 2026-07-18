"use client";

import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Mail, MessageCircle, Phone, Trash2, X } from "lucide-react";
import {
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  orderBy,
  query,
  updateDoc,
} from "firebase/firestore";
import { getDb } from "@/lib/firebase";
import type { Inquiry, InquiryStatus } from "@/lib/types";

const STATUSES: InquiryStatus[] = ["new", "contacted", "scheduled", "closed"];

const STATUS_STYLE: Record<InquiryStatus, string> = {
  new: "bg-brass-500/15 text-brass-300 border-brass-500/40",
  contacted: "bg-sky-500/10 text-sky-300 border-sky-500/40",
  scheduled: "bg-violet-500/10 text-violet-300 border-violet-500/40",
  closed: "bg-emerald-500/10 text-emerald-300 border-emerald-500/40",
};

export default function InquiriesPage() {
  const [inquiries, setInquiries] = useState<Inquiry[]>([]);
  const [filter, setFilter] = useState<InquiryStatus | "all">("all");
  const [selected, setSelected] = useState<Inquiry | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const q = query(collection(getDb(), "inquiries"), orderBy("createdAt", "desc"));
    return onSnapshot(q, (snap) => {
      setInquiries(snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Inquiry));
      setLoading(false);
    });
  }, []);

  const filtered = useMemo(
    () => (filter === "all" ? inquiries : inquiries.filter((i) => i.status === filter)),
    [inquiries, filter]
  );

  async function setStatus(inquiry: Inquiry, status: InquiryStatus) {
    await updateDoc(doc(getDb(), "inquiries", inquiry.id), { status });
    setSelected((s) => (s && s.id === inquiry.id ? { ...s, status } : s));
  }

  async function remove(inquiry: Inquiry) {
    if (!window.confirm(`Delete the inquiry from ${inquiry.name}? This cannot be undone.`)) return;
    await deleteDoc(doc(getDb(), "inquiries", inquiry.id));
    setSelected(null);
  }

  return (
    <div className="mx-auto max-w-6xl">
      <h1 className="font-display text-3xl text-cream-50">Inquiries</h1>
      <p className="mt-1 text-sm text-cream-500">
        Every quote request from the website, live from Firestore.
      </p>

      <div className="mt-6 flex flex-wrap gap-2">
        {(["all", ...STATUSES] as const).map((s) => (
          <button
            key={s}
            onClick={() => setFilter(s)}
            className={`cursor-pointer rounded-full border px-4 py-2 text-sm capitalize transition-all duration-200 ${
              filter === s
                ? "border-brass-500 bg-brass-500 text-night-950"
                : "border-night-600 text-cream-300 hover:border-brass-500/50"
            }`}
          >
            {s}
          </button>
        ))}
      </div>

      <div className="mt-6 overflow-x-auto rounded-2xl border border-night-700/70 bg-night-900">
        <table className="w-full min-w-[640px] text-left text-sm">
          <thead>
            <tr className="border-b border-night-700/60 text-xs uppercase tracking-wider text-cream-500">
              <th className="px-6 py-4 font-medium">Name</th>
              <th className="px-6 py-4 font-medium">Project</th>
              <th className="px-6 py-4 font-medium">Budget</th>
              <th className="px-6 py-4 font-medium">Received</th>
              <th className="px-6 py-4 font-medium">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-night-700/40">
            {loading && (
              <tr>
                <td colSpan={5} className="px-6 py-8 text-center text-cream-500">
                  Loading…
                </td>
              </tr>
            )}
            {!loading && filtered.length === 0 && (
              <tr>
                <td colSpan={5} className="px-6 py-8 text-center text-cream-500">
                  No inquiries {filter !== "all" ? `with status “${filter}”` : "yet"}.
                </td>
              </tr>
            )}
            {filtered.map((inquiry) => (
              <tr
                key={inquiry.id}
                onClick={() => setSelected(inquiry)}
                className="cursor-pointer transition-colors duration-150 hover:bg-night-800/60"
              >
                <td className="px-6 py-4">
                  <p className="font-medium text-cream-100">{inquiry.name}</p>
                  <p className="text-xs text-cream-500">{inquiry.email}</p>
                </td>
                <td className="px-6 py-4 text-cream-300">{inquiry.projectType}</td>
                <td className="px-6 py-4 text-cream-300">{inquiry.budget}</td>
                <td className="px-6 py-4 text-cream-400">
                  {inquiry.createdAt?.toDate?.().toLocaleDateString() ?? "—"}
                </td>
                <td className="px-6 py-4">
                  <span
                    className={`inline-block rounded-full border px-3 py-1 text-xs capitalize ${STATUS_STYLE[inquiry.status] ?? ""}`}
                  >
                    {inquiry.status}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Detail drawer */}
      <AnimatePresence>
        {selected && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-night-950/70 backdrop-blur-sm"
            onClick={() => setSelected(null)}
          >
            <motion.aside
              initial={{ x: "100%" }}
              animate={{ x: 0 }}
              exit={{ x: "100%" }}
              transition={{ type: "spring", damping: 28, stiffness: 260 }}
              onClick={(e) => e.stopPropagation()}
              className="absolute right-0 top-0 flex h-full w-full max-w-md flex-col overflow-y-auto border-l border-night-700/70 bg-night-900 p-7"
              role="dialog"
              aria-label={`Inquiry from ${selected.name}`}
            >
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h2 className="font-display text-2xl text-cream-50">{selected.name}</h2>
                  <p className="mt-1 text-sm text-cream-500">
                    {selected.createdAt?.toDate?.().toLocaleString() ?? ""}
                  </p>
                </div>
                <button
                  onClick={() => setSelected(null)}
                  aria-label="Close"
                  className="flex h-10 w-10 shrink-0 cursor-pointer items-center justify-center rounded-full border border-night-600 text-cream-300 transition-colors hover:border-brass-500 hover:text-brass-400"
                >
                  <X size={18} />
                </button>
              </div>

              <div className="mt-6 space-y-2 text-sm">
                <a
                  href={`mailto:${selected.email}`}
                  className="flex items-center gap-2.5 text-cream-200 transition-colors hover:text-brass-300"
                >
                  <Mail size={15} className="text-brass-500" /> {selected.email}
                </a>
                {selected.phone && (
                  <>
                    <a
                      href={`tel:${selected.phone}`}
                      className="flex items-center gap-2.5 text-cream-200 transition-colors hover:text-brass-300"
                    >
                      <Phone size={15} className="text-brass-500" /> {selected.phone}
                    </a>
                    <a
                      href={`https://wa.me/${selected.phone.replace(/[^0-9]/g, "")}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-2.5 text-cream-200 transition-colors hover:text-brass-300"
                    >
                      <MessageCircle size={15} className="text-brass-500" /> Reply on WhatsApp
                    </a>
                  </>
                )}
              </div>

              <dl className="mt-6 grid grid-cols-2 gap-4 rounded-xl border border-night-700/60 bg-night-800/50 p-5 text-sm">
                <div>
                  <dt className="text-xs uppercase tracking-wider text-cream-500">Project type</dt>
                  <dd className="mt-1 text-cream-100">{selected.projectType}</dd>
                </div>
                <div>
                  <dt className="text-xs uppercase tracking-wider text-cream-500">Budget</dt>
                  <dd className="mt-1 text-cream-100">{selected.budget}</dd>
                </div>
              </dl>

              <div className="mt-6">
                <h3 className="text-xs uppercase tracking-wider text-cream-500">Message</h3>
                <p className="mt-2 whitespace-pre-wrap rounded-xl border border-night-700/60 bg-night-800/50 p-5 text-sm leading-relaxed text-cream-200">
                  {selected.message}
                </p>
              </div>

              <div className="mt-6">
                <h3 className="text-xs uppercase tracking-wider text-cream-500">Status</h3>
                <div className="mt-3 grid grid-cols-2 gap-2">
                  {STATUSES.map((s) => (
                    <button
                      key={s}
                      onClick={() => setStatus(selected, s)}
                      className={`cursor-pointer rounded-xl border px-4 py-2.5 text-sm capitalize transition-all duration-200 ${
                        selected.status === s
                          ? STATUS_STYLE[s]
                          : "border-night-600 text-cream-400 hover:border-cream-500/40"
                      }`}
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>

              <button
                onClick={() => remove(selected)}
                className="mt-auto flex cursor-pointer items-center justify-center gap-2 rounded-xl border border-red-500/40 px-4 py-3 pt-3 text-sm text-red-400 transition-colors duration-200 hover:bg-red-950/40 mt-8"
              >
                <Trash2 size={16} /> Delete inquiry
              </button>
            </motion.aside>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

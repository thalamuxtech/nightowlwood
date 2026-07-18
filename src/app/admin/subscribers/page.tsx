"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Download, Trash2, Users } from "lucide-react";
import { collection, deleteDoc, doc, onSnapshot, orderBy, query } from "firebase/firestore";
import { getDb } from "@/lib/firebase";
import type { Subscriber } from "@/lib/types";

export default function SubscribersAdminPage() {
  const [subscribers, setSubscribers] = useState<Subscriber[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const q = query(collection(getDb(), "subscribers"), orderBy("createdAt", "desc"));
    return onSnapshot(q, (snap) => {
      setSubscribers(snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Subscriber));
      setLoading(false);
    });
  }, []);

  function exportCsv() {
    const rows = [
      "email,subscribed_at",
      ...subscribers.map(
        (s) => `${s.email},${s.createdAt?.toDate?.().toISOString() ?? ""}`
      ),
    ];
    const blob = new Blob([rows.join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `nightowl-subscribers-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function remove(sub: Subscriber) {
    if (!window.confirm(`Remove ${sub.email} from the list?`)) return;
    await deleteDoc(doc(getDb(), "subscribers", sub.id));
  }

  return (
    <div className="mx-auto max-w-3xl">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl text-cream-50">Subscribers</h1>
          <p className="mt-1 text-sm text-cream-500">
            Newsletter signups from the site footer.
          </p>
        </div>
        <button
          onClick={exportCsv}
          disabled={subscribers.length === 0}
          className="inline-flex cursor-pointer items-center gap-2 rounded-full border border-night-600 px-6 py-3 text-sm text-cream-200 transition-colors hover:border-brass-500/60 hover:text-brass-300 disabled:opacity-50"
        >
          <Download size={16} /> Export CSV
        </button>
      </div>

      <div className="mt-8 overflow-hidden rounded-2xl border border-night-700/70 bg-night-900">
        {loading && <p className="p-8 text-center text-sm text-cream-500">Loading…</p>}
        {!loading && subscribers.length === 0 && (
          <div className="p-12 text-center">
            <Users size={32} className="mx-auto text-brass-400" aria-hidden />
            <p className="mt-3 text-sm text-cream-500">No subscribers yet.</p>
          </div>
        )}
        <ul className="divide-y divide-night-700/40">
          {subscribers.map((sub, i) => (
            <motion.li
              key={sub.id}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: Math.min(i * 0.03, 0.4) }}
              className="flex items-center justify-between gap-4 px-6 py-4"
            >
              <div className="min-w-0">
                <p className="truncate text-cream-100">{sub.email}</p>
                <p className="text-xs text-cream-500">
                  {sub.createdAt?.toDate?.().toLocaleDateString() ?? "-"}
                </p>
              </div>
              <button
                onClick={() => remove(sub)}
                aria-label={`Remove ${sub.email}`}
                className="flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-lg border border-red-500/30 text-red-400 transition-colors hover:bg-red-950/40"
              >
                <Trash2 size={14} />
              </button>
            </motion.li>
          ))}
        </ul>
      </div>
      <p className="mt-4 text-right text-xs text-cream-500">
        {subscribers.length} subscriber{subscribers.length === 1 ? "" : "s"}
      </p>
    </div>
  );
}

"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import {
  ArrowRight,
  CalendarCheck,
  CheckCheck,
  GraduationCap,
  Inbox,
  MailOpen,
  Newspaper,
  PhoneCall,
  Users,
} from "lucide-react";
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from "recharts";
import { collection, onSnapshot, orderBy, query } from "firebase/firestore";
import { getDb } from "@/lib/firebase";
import type { Inquiry, InquiryStatus } from "@/lib/types";

const STATUS_META: Record<InquiryStatus, { label: string; icon: typeof Inbox; color: string }> = {
  new: { label: "New", icon: Inbox, color: "text-brass-400" },
  contacted: { label: "Contacted", icon: PhoneCall, color: "text-sky-400" },
  scheduled: { label: "Scheduled", icon: CalendarCheck, color: "text-violet-400" },
  closed: { label: "Closed", icon: CheckCheck, color: "text-emerald-400" },
};

/** Live document counts across the other admin collections. */
function useCollectionCounts() {
  const [counts, setCounts] = useState<Record<string, number | null>>({
    posts: null,
    internApplications: null,
    contacts: null,
    subscribers: null,
  });
  useEffect(() => {
    const unsubs = Object.keys(counts).map((name) =>
      onSnapshot(collection(getDb(), name), (snap) =>
        setCounts((c) => ({ ...c, [name]: snap.size }))
      )
    );
    return () => unsubs.forEach((u) => u());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return counts;
}

const OTHER_TILES = [
  { key: "posts", label: "Blog posts", icon: Newspaper, href: "/admin/blog/" },
  { key: "internApplications", label: "Internship applications", icon: GraduationCap, href: "/admin/internships/" },
  { key: "contacts", label: "Contact messages", icon: MailOpen, href: "/admin/contacts/" },
  { key: "subscribers", label: "Subscribers", icon: Users, href: "/admin/subscribers/" },
];

export default function AdminOverviewPage() {
  const [inquiries, setInquiries] = useState<Inquiry[]>([]);
  const [loading, setLoading] = useState(true);
  const otherCounts = useCollectionCounts();

  useEffect(() => {
    const q = query(collection(getDb(), "inquiries"), orderBy("createdAt", "desc"));
    return onSnapshot(q, (snap) => {
      setInquiries(snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Inquiry));
      setLoading(false);
    });
  }, []);

  const counts = useMemo(() => {
    const c: Record<InquiryStatus, number> = { new: 0, contacted: 0, scheduled: 0, closed: 0 };
    for (const i of inquiries) c[i.status] = (c[i.status] ?? 0) + 1;
    return c;
  }, [inquiries]);

  const trend = useMemo(() => {
    const days: { date: string; label: string; count: number }[] = [];
    const now = new Date();
    for (let d = 29; d >= 0; d--) {
      const day = new Date(now);
      day.setDate(now.getDate() - d);
      days.push({
        date: day.toISOString().slice(0, 10),
        label: day.toLocaleDateString(undefined, { month: "short", day: "numeric" }),
        count: 0,
      });
    }
    for (const i of inquiries) {
      const ts = i.createdAt?.toDate?.();
      if (!ts) continue;
      const key = ts.toISOString().slice(0, 10);
      const bucket = days.find((x) => x.date === key);
      if (bucket) bucket.count++;
    }
    return days;
  }, [inquiries]);

  return (
    <div className="mx-auto max-w-6xl">
      <h1 className="font-display text-3xl text-cream-50">Overview</h1>
      <p className="mt-1 text-sm text-cream-500">
        Live view of quote requests and pipeline status.
      </p>

      <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {(Object.keys(STATUS_META) as InquiryStatus[]).map((status, idx) => {
          const meta = STATUS_META[status];
          const Icon = meta.icon;
          return (
            <motion.div
              key={status}
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: idx * 0.06, duration: 0.5 }}
              className="rounded-2xl border border-night-700/70 bg-night-900 p-6"
            >
              <div className="flex items-center justify-between">
                <span className="text-sm text-cream-400">{meta.label}</span>
                <Icon size={18} className={meta.color} />
              </div>
              <p className="mt-3 font-display text-4xl text-cream-50">
                {loading ? "–" : counts[status]}
              </p>
            </motion.div>
          );
        })}
      </div>

      <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {OTHER_TILES.map(({ key, label, icon: Icon, href }, idx) => (
          <motion.div
            key={key}
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.25 + idx * 0.06, duration: 0.5 }}
          >
            <Link
              href={href}
              className="block rounded-2xl border border-night-700/70 bg-night-900 p-6 transition-colors duration-300 hover:border-brass-500/40"
            >
              <div className="flex items-center justify-between">
                <span className="text-sm text-cream-400">{label}</span>
                <Icon size={18} className="text-brass-400" />
              </div>
              <p className="mt-3 font-display text-4xl text-cream-50">
                {otherCounts[key] ?? "–"}
              </p>
            </Link>
          </motion.div>
        ))}
      </div>

      <div className="mt-8 rounded-2xl border border-night-700/70 bg-night-900 p-6">
        <h2 className="font-display text-lg text-cream-100">Inquiries — last 30 days</h2>
        <div className="mt-4 h-64">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={trend} margin={{ left: -28, right: 8, top: 8 }}>
              <defs>
                <linearGradient id="brass" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#c98f43" stopOpacity={0.55} />
                  <stop offset="100%" stopColor="#c98f43" stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke="#2a211a" vertical={false} />
              <XAxis
                dataKey="label"
                tick={{ fill: "#a8987a", fontSize: 11 }}
                tickLine={false}
                axisLine={false}
                interval={6}
              />
              <YAxis
                allowDecimals={false}
                tick={{ fill: "#a8987a", fontSize: 11 }}
                tickLine={false}
                axisLine={false}
              />
              <Tooltip
                contentStyle={{
                  background: "#1d1712",
                  border: "1px solid #3b2f24",
                  borderRadius: 12,
                  color: "#f5efe2",
                }}
                labelStyle={{ color: "#a8987a" }}
              />
              <Area
                type="monotone"
                dataKey="count"
                name="Inquiries"
                stroke="#c98f43"
                strokeWidth={2}
                fill="url(#brass)"
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="mt-8 rounded-2xl border border-night-700/70 bg-night-900">
        <div className="flex items-center justify-between p-6 pb-2">
          <h2 className="font-display text-lg text-cream-100">Latest requests</h2>
          <Link
            href="/admin/inquiries/"
            className="inline-flex items-center gap-1.5 text-sm text-brass-400 transition-colors hover:text-brass-300"
          >
            View all <ArrowRight size={15} />
          </Link>
        </div>
        <ul className="divide-y divide-night-700/50 px-6 pb-4">
          {loading && <li className="py-5 text-sm text-cream-500">Loading…</li>}
          {!loading && inquiries.length === 0 && (
            <li className="py-5 text-sm text-cream-500">
              No inquiries yet — they&apos;ll appear here the moment the quote form is used.
            </li>
          )}
          {inquiries.slice(0, 5).map((inquiry) => (
            <li key={inquiry.id} className="flex items-center justify-between gap-4 py-4">
              <div className="min-w-0">
                <p className="truncate font-medium text-cream-100">{inquiry.name}</p>
                <p className="truncate text-sm text-cream-500">
                  {inquiry.projectType} · {inquiry.budget}
                </p>
              </div>
              <span className={`shrink-0 text-xs uppercase tracking-wider ${STATUS_META[inquiry.status]?.color ?? "text-cream-400"}`}>
                {STATUS_META[inquiry.status]?.label ?? inquiry.status}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

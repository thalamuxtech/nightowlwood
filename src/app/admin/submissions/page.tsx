"use client";

import { useState } from "react";
import { GraduationCap, Inbox, MailOpen, Users } from "lucide-react";
import { RecordsBoard } from "@/components/admin/RecordsBoard";
import { SubscribersPanel } from "@/components/admin/SubscribersPanel";
import { InquiriesPanel } from "@/components/admin/InquiriesPanel";
import { RequireCapability } from "@/components/admin/RequireCapability";

type Tab = "messages" | "subscribers" | "internships" | "inquiries";

const TABS: Array<{ id: Tab; label: string; icon: typeof Inbox }> = [
  { id: "messages", label: "Messages", icon: MailOpen },
  { id: "subscribers", label: "Subscribers", icon: Users },
  { id: "internships", label: "Internship Applications", icon: GraduationCap },
  { id: "inquiries", label: "Inquiries", icon: Inbox },
];

/**
 * Everything the public site submits, in one place.
 *
 * These were four sidebar entries reading from four collections, each thin on
 * its own. Grouping them by what they are, inbound submissions, keeps the nav
 * short and puts related work side by side.
 */
function SubmissionsPageInner() {
  const [tab, setTab] = useState<Tab>("messages");

  return (
    <div className="mx-auto max-w-6xl">
      <h1 className="font-display text-3xl text-cream-50">Submissions</h1>
      <p className="mt-1 text-sm text-cream-500">
        Everything sent in from the website.
      </p>

      <div
        role="tablist"
        aria-label="Submission types"
        className="mt-6 flex gap-1 overflow-x-auto border-b border-night-700/60"
      >
        {TABS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            onClick={() => setTab(id)}
            className={`-mb-px flex shrink-0 cursor-pointer items-center gap-2 border-b-2 px-4 py-3 text-sm font-medium transition-colors duration-200 ${
              tab === id
                ? "border-brass-500 text-brass-300"
                : "border-transparent text-cream-400 hover:text-cream-200"
            }`}
          >
            <Icon size={15} />
            {label}
          </button>
        ))}
      </div>

      <div className="mt-8">
        {tab === "messages" && (
          <RecordsBoard
            title=""
            subtitle="General messages from the contact page, live from Firestore."
            collectionName="contacts"
            columns={[{ key: "subject", label: "Subject" }]}
            detailFields={[{ key: "subject", label: "Subject" }]}
          />
        )}
        {tab === "subscribers" && <SubscribersPanel />}
        {tab === "internships" && (
          <RecordsBoard
            title=""
            subtitle="Applications from the careers page, live from Firestore."
            collectionName="internApplications"
            columns={[{ key: "area", label: "Area of interest" }]}
            detailFields={[
              { key: "area", label: "Area of interest" },
              { key: "background", label: "Education / experience" },
            ]}
          />
        )}
        {tab === "inquiries" && <InquiriesPanel />}
      </div>
    </div>
  );
}

/**
 * Guarded at the route rather than inside the screen: hiding the sidebar link is
 * not access control, since the URL can still be typed or bookmarked.
 */
export default function SubmissionsPage() {
  return (
    <RequireCapability capability="customer.edit">
      <SubmissionsPageInner />
    </RequireCapability>
  );
}

"use client";

import { useState } from "react";
import { MailOpen, Users } from "lucide-react";
import { RecordsBoard } from "@/components/admin/RecordsBoard";
import { SubscribersPanel } from "@/components/admin/SubscribersPanel";

type Tab = "messages" | "subscribers";

/**
 * Contact messages and newsletter subscribers.
 *
 * Combined behind tabs rather than two sidebar entries: both are inbound
 * contact details from the public site, and each was thin enough on its own to
 * make the nav longer than it needed to be.
 */
export default function ContactsAdminPage() {
  const [tab, setTab] = useState<Tab>("messages");

  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="font-display text-3xl text-cream-50">Messages &amp; Subscribers</h1>

      <div
        role="tablist"
        aria-label="Contact records"
        className="mt-6 flex gap-2 border-b border-night-700/60"
      >
        <TabButton
          active={tab === "messages"}
          onClick={() => setTab("messages")}
          icon={<MailOpen size={15} />}
          label="Messages"
        />
        <TabButton
          active={tab === "subscribers"}
          onClick={() => setTab("subscribers")}
          icon={<Users size={15} />}
          label="Subscribers"
        />
      </div>

      <div className="mt-8">
        {tab === "messages" ? (
          <RecordsBoard
            title=""
            subtitle="General messages from the contact page, live from Firestore."
            collectionName="contacts"
            columns={[{ key: "subject", label: "Subject" }]}
            detailFields={[{ key: "subject", label: "Subject" }]}
          />
        ) : (
          <SubscribersPanel />
        )}
      </div>
    </div>
  );
}

function TabButton({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={`-mb-px flex cursor-pointer items-center gap-2 border-b-2 px-4 py-3 text-sm font-medium transition-colors duration-200 ${
        active
          ? "border-brass-500 text-brass-300"
          : "border-transparent text-cream-400 hover:text-cream-200"
      }`}
    >
      {icon}
      {label}
    </button>
  );
}

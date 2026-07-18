"use client";

import { RecordsBoard } from "@/components/admin/RecordsBoard";

export default function ContactsAdminPage() {
  return (
    <RecordsBoard
      title="Contact Messages"
      subtitle="General messages from the contact page, live from Firestore."
      collectionName="contacts"
      columns={[{ key: "subject", label: "Subject" }]}
      detailFields={[{ key: "subject", label: "Subject" }]}
    />
  );
}

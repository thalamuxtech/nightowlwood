"use client";

import { RecordsBoard } from "@/components/admin/RecordsBoard";

export default function InternshipsAdminPage() {
  return (
    <RecordsBoard
      title="Internship Applications"
      subtitle="Applications from the careers page, live from Firestore."
      collectionName="internApplications"
      columns={[{ key: "area", label: "Area of interest" }]}
      detailFields={[
        { key: "area", label: "Area of interest" },
        { key: "background", label: "Education / experience" },
      ]}
    />
  );
}

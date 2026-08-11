import type { Metadata } from "next";
import { AuditLogScreen } from "@/components/admin/AuditLogScreen";
import { RequireCapability } from "@/components/admin/RequireCapability";

export const metadata: Metadata = {
  title: "Activity Log",
  robots: { index: false, follow: false },
};

export default function AuditPage() {
  return (
    <RequireCapability capability="audit.view">
      <AuditLogScreen />
    </RequireCapability>
  );
}

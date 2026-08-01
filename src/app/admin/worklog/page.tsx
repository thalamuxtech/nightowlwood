import type { Metadata } from "next";
import { WorkLogScreen } from "@/components/admin/payroll/WorkLogScreen";
import { RequireCapability } from "@/components/admin/RequireCapability";

export const metadata: Metadata = {
  title: "Work Log",
  robots: { index: false, follow: false },
};

export default function WorkLogPage() {
  return (
    <RequireCapability capability="worklog.create">
      <WorkLogScreen />
    </RequireCapability>
  );
}

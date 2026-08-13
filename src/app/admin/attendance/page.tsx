import type { Metadata } from "next";
import { AttendanceScreen } from "@/components/admin/hr/AttendanceScreen";
import { RequireCapability } from "@/components/admin/RequireCapability";

export const metadata: Metadata = {
  title: "Attendance",
  robots: { index: false, follow: false },
};

export default function AttendancePage() {
  return (
    <RequireCapability capability="staff.view">
      <AttendanceScreen />
    </RequireCapability>
  );
}

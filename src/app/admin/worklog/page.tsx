import type { Metadata } from "next";
import { WorkLogScreen } from "@/components/admin/payroll/WorkLogScreen";

export const metadata: Metadata = {
  title: "Work Log",
  robots: { index: false, follow: false },
};

export default function WorkLogPage() {
  return <WorkLogScreen />;
}

import type { Metadata } from "next";
import { LeadTrackerScreen } from "@/components/admin/marketing/LeadTrackerScreen";
import { RequireCapability } from "@/components/admin/RequireCapability";

export const metadata: Metadata = {
  title: "Lead Tracker",
  robots: { index: false, follow: false },
};

export default function LeadsPage() {
  return (
    <RequireCapability capability="marketing.view">
      <LeadTrackerScreen />
    </RequireCapability>
  );
}

import type { Metadata } from "next";
import { ActivityTargetsScreen } from "@/components/admin/marketing/ActivityTargetsScreen";
import { RequireCapability } from "@/components/admin/RequireCapability";

export const metadata: Metadata = {
  title: "Daily Targets",
  robots: { index: false, follow: false },
};

export default function ActivityTargetsPage() {
  return (
    <RequireCapability capability="marketing.view">
      <ActivityTargetsScreen />
    </RequireCapability>
  );
}

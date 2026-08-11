import type { Metadata } from "next";
import { SiteVisitScreen } from "@/components/admin/marketing/SiteVisitScreen";
import { RequireCapability } from "@/components/admin/RequireCapability";

export const metadata: Metadata = {
  title: "Site Visits",
  robots: { index: false, follow: false },
};

export default function SiteVisitsPage() {
  return (
    <RequireCapability capability="marketing.view">
      <SiteVisitScreen />
    </RequireCapability>
  );
}

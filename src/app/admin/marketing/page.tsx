import type { Metadata } from "next";
import { MarketingDashboard } from "@/components/admin/marketing/MarketingDashboard";
import { RequireCapability } from "@/components/admin/RequireCapability";

export const metadata: Metadata = {
  title: "Marketing",
  robots: { index: false, follow: false },
};

export default function MarketingPage() {
  return (
    <RequireCapability capability="marketing.view">
      <MarketingDashboard />
    </RequireCapability>
  );
}

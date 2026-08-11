import type { Metadata } from "next";
import { MarketingSummaryScreen } from "@/components/admin/marketing/MarketingSummaryScreen";
import { RequireCapability } from "@/components/admin/RequireCapability";

export const metadata: Metadata = {
  title: "Marketing Summary",
  robots: { index: false, follow: false },
};

export default function MarketingSummaryPage() {
  return (
    <RequireCapability capability="marketing.view">
      <MarketingSummaryScreen />
    </RequireCapability>
  );
}

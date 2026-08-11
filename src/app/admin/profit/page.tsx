import type { Metadata } from "next";
import { ProfitScreen } from "@/components/admin/money/ProfitScreen";
import { RequireCapability } from "@/components/admin/RequireCapability";

export const metadata: Metadata = {
  title: "Profit & Loss",
  robots: { index: false, follow: false },
};

export default function ProfitPage() {
  return (
    <RequireCapability capability="profit.view">
      <ProfitScreen />
    </RequireCapability>
  );
}

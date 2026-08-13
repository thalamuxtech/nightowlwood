import type { Metadata } from "next";
import { FixedCostsScreen } from "@/components/admin/money/FixedCostsScreen";
import { RequireCapability } from "@/components/admin/RequireCapability";

export const metadata: Metadata = {
  title: "Fixed Costs",
  robots: { index: false, follow: false },
};

export default function FixedCostsPage() {
  return (
    <RequireCapability capability="expense.view">
      <FixedCostsScreen />
    </RequireCapability>
  );
}

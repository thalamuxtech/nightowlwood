import type { Metadata } from "next";
import { MetersScreen } from "@/components/admin/money/MetersScreen";
import { RequireCapability } from "@/components/admin/RequireCapability";

export const metadata: Metadata = {
  title: "Power Meters",
  robots: { index: false, follow: false },
};

export default function MetersPage() {
  return (
    <RequireCapability capability="expense.view">
      <MetersScreen />
    </RequireCapability>
  );
}

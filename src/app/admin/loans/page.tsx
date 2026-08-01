import type { Metadata } from "next";
import { LoansScreen } from "@/components/admin/payroll/LoansScreen";
import { RequireCapability } from "@/components/admin/RequireCapability";

export const metadata: Metadata = {
  title: "Loans & Advances",
  robots: { index: false, follow: false },
};

export default function LoansPage() {
  return (
    <RequireCapability capability="loan.request">
      <LoansScreen />
    </RequireCapability>
  );
}

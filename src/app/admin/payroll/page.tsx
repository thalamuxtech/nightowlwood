import type { Metadata } from "next";
import { WageRunScreen } from "@/components/admin/payroll/WageRunScreen";
import { RequireCapability } from "@/components/admin/RequireCapability";

export const metadata: Metadata = {
  title: "Payroll",
  robots: { index: false, follow: false },
};

export default function PayrollPage() {
  return (
    <RequireCapability capability="wage.run">
      <WageRunScreen />
    </RequireCapability>
  );
}

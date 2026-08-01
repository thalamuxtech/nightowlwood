import type { Metadata } from "next";
import { SalaryRunScreen } from "@/components/admin/payroll/SalaryRunScreen";
import { RequireCapability } from "@/components/admin/RequireCapability";

export const metadata: Metadata = {
  title: "Salaries",
  robots: { index: false, follow: false },
};

export default function SalariesPage() {
  return (
    <RequireCapability capability="wage.run">
      <SalaryRunScreen />
    </RequireCapability>
  );
}

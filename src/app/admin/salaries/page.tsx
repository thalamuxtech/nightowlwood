import type { Metadata } from "next";
import { SalaryRunScreen } from "@/components/admin/payroll/SalaryRunScreen";

export const metadata: Metadata = {
  title: "Salaries",
  robots: { index: false, follow: false },
};

export default function SalariesPage() {
  return <SalaryRunScreen />;
}

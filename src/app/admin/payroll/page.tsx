import type { Metadata } from "next";
import { WageRunScreen } from "@/components/admin/payroll/WageRunScreen";

export const metadata: Metadata = {
  title: "Payroll",
  robots: { index: false, follow: false },
};

export default function PayrollPage() {
  return <WageRunScreen />;
}

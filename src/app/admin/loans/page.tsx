import type { Metadata } from "next";
import { LoansScreen } from "@/components/admin/payroll/LoansScreen";

export const metadata: Metadata = {
  title: "Loans & Advances",
  robots: { index: false, follow: false },
};

export default function LoansPage() {
  return <LoansScreen />;
}

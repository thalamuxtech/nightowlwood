import type { Metadata } from "next";
import { WageRatesScreen } from "@/components/admin/payroll/WageRatesScreen";

export const metadata: Metadata = {
  title: "Piece rates",
  robots: { index: false, follow: false },
};

export default function WageRatesPage() {
  return <WageRatesScreen />;
}

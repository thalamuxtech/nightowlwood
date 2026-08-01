import type { Metadata } from "next";
import { WageRatesScreen } from "@/components/admin/payroll/WageRatesScreen";
import { RequireCapability } from "@/components/admin/RequireCapability";

export const metadata: Metadata = {
  title: "Piece rates",
  robots: { index: false, follow: false },
};

export default function WageRatesPage() {
  return (
    <RequireCapability capability="wage.editRates">
      <WageRatesScreen />
    </RequireCapability>
  );
}

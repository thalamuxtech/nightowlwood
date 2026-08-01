import type { Metadata } from "next";
import { ProcurementScreen } from "@/components/admin/inventory/ProcurementScreen";
import { RequireCapability } from "@/components/admin/RequireCapability";

export const metadata: Metadata = {
  title: "Suppliers & Brands",
  robots: { index: false, follow: false },
};

export default function ProcurementPage() {
  return (
    <RequireCapability capability="supplier.view">
      <ProcurementScreen />
    </RequireCapability>
  );
}

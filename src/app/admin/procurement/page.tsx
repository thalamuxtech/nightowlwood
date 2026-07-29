import type { Metadata } from "next";
import { ProcurementScreen } from "@/components/admin/inventory/ProcurementScreen";

export const metadata: Metadata = {
  title: "Suppliers & Brands",
  robots: { index: false, follow: false },
};

export default function ProcurementPage() {
  return <ProcurementScreen />;
}

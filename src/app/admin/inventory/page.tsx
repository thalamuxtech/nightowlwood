import type { Metadata } from "next";
import { InventoryScreen } from "@/components/admin/inventory/InventoryScreen";

export const metadata: Metadata = {
  title: "Inventory",
  robots: { index: false, follow: false },
};

export default function InventoryPage() {
  return <InventoryScreen />;
}

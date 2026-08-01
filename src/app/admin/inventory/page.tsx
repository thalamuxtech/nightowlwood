import type { Metadata } from "next";
import { InventoryScreen } from "@/components/admin/inventory/InventoryScreen";
import { RequireCapability } from "@/components/admin/RequireCapability";

export const metadata: Metadata = {
  title: "Inventory",
  robots: { index: false, follow: false },
};

export default function InventoryPage() {
  return (
    <RequireCapability capability="inventory.view">
      <InventoryScreen />
    </RequireCapability>
  );
}

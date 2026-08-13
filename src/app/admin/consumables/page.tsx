import type { Metadata } from "next";
import { ConsumableCyclesScreen } from "@/components/admin/inventory/ConsumableCyclesScreen";
import { RequireCapability } from "@/components/admin/RequireCapability";

export const metadata: Metadata = {
  title: "Blades & Gum",
  robots: { index: false, follow: false },
};

export default function ConsumablesPage() {
  return (
    <RequireCapability capability="inventory.view">
      <ConsumableCyclesScreen />
    </RequireCapability>
  );
}

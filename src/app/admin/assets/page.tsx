import type { Metadata } from "next";
import { FixedAssetsScreen } from "@/components/admin/inventory/FixedAssetsScreen";
import { RequireCapability } from "@/components/admin/RequireCapability";

export const metadata: Metadata = {
  title: "Fixed Assets",
  robots: { index: false, follow: false },
};

export default function AssetsPage() {
  return (
    <RequireCapability capability="inventory.view">
      <FixedAssetsScreen />
    </RequireCapability>
  );
}

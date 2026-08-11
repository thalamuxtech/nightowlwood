import type { Metadata } from "next";
import { PosScreen } from "@/components/admin/money/PosScreen";
import { RequireCapability } from "@/components/admin/RequireCapability";

export const metadata: Metadata = {
  title: "Counter Sales",
  robots: { index: false, follow: false },
};

export default function PosPage() {
  return (
    <RequireCapability capability="sale.view">
      <PosScreen />
    </RequireCapability>
  );
}

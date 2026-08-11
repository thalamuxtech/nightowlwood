import type { Metadata } from "next";
import { CuttingListsScreen } from "@/components/admin/services/CuttingListsScreen";
import { RequireCapability } from "@/components/admin/RequireCapability";

export const metadata: Metadata = {
  title: "Cutting Lists",
  robots: { index: false, follow: false },
};

export default function CuttingListsPage() {
  return (
    <RequireCapability capability="job.view">
      <CuttingListsScreen />
    </RequireCapability>
  );
}

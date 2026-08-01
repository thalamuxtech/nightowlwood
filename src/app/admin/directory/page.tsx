import type { Metadata } from "next";
import { DirectoryScreen } from "@/components/admin/directory/DirectoryScreen";
import { RequireCapability } from "@/components/admin/RequireCapability";

export const metadata: Metadata = {
  title: "Directory",
  robots: { index: false, follow: false },
};

export default function DirectoryPage() {
  return (
    <RequireCapability capability="customer.edit">
      <DirectoryScreen />
    </RequireCapability>
  );
}

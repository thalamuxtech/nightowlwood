import type { Metadata } from "next";
import { ToolLogScreen } from "@/components/admin/inventory/ToolLogScreen";
import { RequireCapability } from "@/components/admin/RequireCapability";

export const metadata: Metadata = {
  title: "Tool Log",
  robots: { index: false, follow: false },
};

export default function ToolsPage() {
  return (
    <RequireCapability capability="tool.request">
      <ToolLogScreen />
    </RequireCapability>
  );
}

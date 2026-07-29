import type { Metadata } from "next";
import { ToolLogScreen } from "@/components/admin/inventory/ToolLogScreen";

export const metadata: Metadata = {
  title: "Tool Log",
  robots: { index: false, follow: false },
};

export default function ToolsPage() {
  return <ToolLogScreen />;
}

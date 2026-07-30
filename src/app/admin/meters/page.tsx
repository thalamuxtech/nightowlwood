import type { Metadata } from "next";
import { MetersScreen } from "@/components/admin/money/MetersScreen";

export const metadata: Metadata = {
  title: "Power Meters",
  robots: { index: false, follow: false },
};

export default function MetersPage() {
  return <MetersScreen />;
}

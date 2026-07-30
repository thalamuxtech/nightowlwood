import type { Metadata } from "next";
import { DirectoryScreen } from "@/components/admin/directory/DirectoryScreen";

export const metadata: Metadata = {
  title: "Directory",
  robots: { index: false, follow: false },
};

export default function DirectoryPage() {
  return <DirectoryScreen />;
}

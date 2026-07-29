import type { Metadata } from "next";
import { InvoicesScreen } from "@/components/admin/money/InvoicesScreen";

export const metadata: Metadata = {
  title: "Invoices",
  robots: { index: false, follow: false },
};

export default function InvoicesPage() {
  return <InvoicesScreen />;
}

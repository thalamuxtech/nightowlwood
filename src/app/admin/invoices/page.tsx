import type { Metadata } from "next";
import { InvoicesScreen } from "@/components/admin/money/InvoicesScreen";
import { RequireCapability } from "@/components/admin/RequireCapability";

export const metadata: Metadata = {
  title: "Invoices",
  robots: { index: false, follow: false },
};

export default function InvoicesPage() {
  return (
    <RequireCapability capability="invoice.view">
      <InvoicesScreen />
    </RequireCapability>
  );
}

import type { Metadata } from "next";
import { QuoteRequestsScreen } from "@/components/admin/marketing/QuoteRequestsScreen";
import { RequireCapability } from "@/components/admin/RequireCapability";

export const metadata: Metadata = {
  title: "Quotation Requests",
  robots: { index: false, follow: false },
};

export default function QuotationRequestsPage() {
  return (
    <RequireCapability capability="marketing.view">
      <QuoteRequestsScreen />
    </RequireCapability>
  );
}

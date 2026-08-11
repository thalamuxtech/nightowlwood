import type { Metadata } from "next";
import { ApprovalsScreen } from "@/components/admin/ApprovalsScreen";
import { RequireCapability } from "@/components/admin/RequireCapability";

export const metadata: Metadata = {
  title: "Approvals",
  robots: { index: false, follow: false },
};

/**
 * Guarded on `approval.request`, not `approval.decide`.
 *
 * Whoever raises a request has to be able to see what happened to it — the queue is where
 * a refusal and its reason are read. Deciding is gated inside the screen, per row.
 */
export default function ApprovalsPage() {
  return (
    <RequireCapability capability="approval.request">
      <ApprovalsScreen />
    </RequireCapability>
  );
}

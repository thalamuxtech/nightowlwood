import type { Metadata } from "next";
import { StaffScreen } from "@/components/admin/hr/StaffScreen";
import { RequireCapability } from "@/components/admin/RequireCapability";

export const metadata: Metadata = {
  title: "Staff & HR",
  robots: { index: false, follow: false },
};

/**
 * Guarded on `staff.view`.
 *
 * Seeing who works here is ordinary; editing records needs `staff.edit` and issuing
 * letters or ID cards needs `hr.manage`, both checked inside the screen. Pay figures are
 * gated separately again, so a supervisor can look up a phone number without seeing
 * everyone's salary.
 */
export default function StaffPage() {
  return (
    <RequireCapability capability="staff.view">
      <StaffScreen />
    </RequireCapability>
  );
}

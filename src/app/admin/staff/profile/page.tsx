import type { Metadata } from "next";
import { StaffProfilePage } from "@/components/admin/hr/StaffProfilePage";
import { RequireCapability } from "@/components/admin/RequireCapability";

export const metadata: Metadata = {
  title: "Staff Profile",
  robots: { index: false, follow: false },
};

/**
 * One person's profile, addressed by `?id=`.
 *
 * A query parameter rather than a dynamic `[id]` segment because this app is a static export:
 * `output: 'export'` cannot prerender a route whose ids are only known at runtime, and the staff
 * list changes every time someone is hired.
 */
export default function Page() {
  return (
    <RequireCapability capability="staff.view">
      <StaffProfilePage />
    </RequireCapability>
  );
}

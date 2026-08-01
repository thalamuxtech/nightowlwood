import type { Metadata } from "next";
import { Suspense } from "react";
import { JobDetail } from "@/components/admin/services/JobDetail";
import { RequireCapability } from "@/components/admin/RequireCapability";

export const metadata: Metadata = {
  title: "Job",
  robots: { index: false, follow: false },
};

export default function JobDetailPage() {
  // useSearchParams needs a Suspense boundary in the app router.
  return (
    <Suspense fallback={null}>
      <RequireCapability capability="job.view">
        <JobDetail />
      </RequireCapability>
    </Suspense>
  );
}

import type { Metadata } from "next";
import { JobsList } from "@/components/admin/services/JobsList";
import { RequireCapability } from "@/components/admin/RequireCapability";

export const metadata: Metadata = {
  title: "Service Jobs",
  robots: { index: false, follow: false },
};

export default function JobsPage() {
  return (
    <RequireCapability capability="job.view">
      <JobsList />
    </RequireCapability>
  );
}

import type { Metadata } from "next";
import { JobIntakeForm } from "@/components/admin/services/JobIntakeForm";
import { RequireCapability } from "@/components/admin/RequireCapability";

export const metadata: Metadata = {
  title: "New Job",
  robots: { index: false, follow: false },
};

export default function NewJobPage() {
  return (
    <RequireCapability capability="job.create">
      <JobIntakeForm />
    </RequireCapability>
  );
}

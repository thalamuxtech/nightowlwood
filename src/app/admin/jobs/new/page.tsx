import type { Metadata } from "next";
import { JobIntakeForm } from "@/components/admin/services/JobIntakeForm";

export const metadata: Metadata = {
  title: "New Job",
  robots: { index: false, follow: false },
};

export default function NewJobPage() {
  return <JobIntakeForm />;
}

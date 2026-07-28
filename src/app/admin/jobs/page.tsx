import type { Metadata } from "next";
import { JobsList } from "@/components/admin/services/JobsList";

export const metadata: Metadata = {
  title: "Service Jobs",
  robots: { index: false, follow: false },
};

export default function JobsPage() {
  return <JobsList />;
}

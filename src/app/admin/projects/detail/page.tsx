import type { Metadata } from "next";
import { Suspense } from "react";
import { ProjectDetail } from "@/components/admin/products/ProjectDetail";

export const metadata: Metadata = {
  title: "Project",
  robots: { index: false, follow: false },
};

export default function ProjectDetailPage() {
  // useSearchParams needs a Suspense boundary in the app router.
  return (
    <Suspense fallback={null}>
      <ProjectDetail />
    </Suspense>
  );
}

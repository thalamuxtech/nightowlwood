import type { Metadata } from "next";
import { Suspense } from "react";
import { ProjectDetail } from "@/components/admin/products/ProjectDetail";
import { RequireCapability } from "@/components/admin/RequireCapability";

export const metadata: Metadata = {
  title: "Project",
  robots: { index: false, follow: false },
};

export default function ProjectDetailPage() {
  // useSearchParams needs a Suspense boundary in the app router.
  return (
    <Suspense fallback={null}>
      <RequireCapability capability="project.view">
        <ProjectDetail />
      </RequireCapability>
    </Suspense>
  );
}

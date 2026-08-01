import type { Metadata } from "next";
import { ProjectsList } from "@/components/admin/products/ProjectsList";
import { RequireCapability } from "@/components/admin/RequireCapability";

export const metadata: Metadata = {
  title: "Projects",
  robots: { index: false, follow: false },
};

export default function ProjectsPage() {
  return (
    <RequireCapability capability="project.view">
      <ProjectsList />
    </RequireCapability>
  );
}

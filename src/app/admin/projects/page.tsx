import type { Metadata } from "next";
import { ProjectsList } from "@/components/admin/products/ProjectsList";

export const metadata: Metadata = {
  title: "Projects",
  robots: { index: false, follow: false },
};

export default function ProjectsPage() {
  return <ProjectsList />;
}

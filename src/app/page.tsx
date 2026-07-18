import type { Metadata } from "next";
import { SiteShell } from "@/components/site/SiteShell";
import { HomeContent } from "@/components/site/HomeContent";

export const metadata: Metadata = {
  title: "Nightowl Woodworks Ltd | Precision Wood Processing in Nigeria",
  description:
    "Industrial-grade precision cutting, edge banding, and custom fabrication for construction and interior projects. 150+ boards a day, 1000+ projects delivered.",
};

export default function HomePage() {
  return (
    <SiteShell>
      <HomeContent />
    </SiteShell>
  );
}

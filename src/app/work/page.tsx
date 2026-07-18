import type { Metadata } from "next";
import { SiteShell } from "@/components/site/SiteShell";
import { PageHero } from "@/components/site/PageHero";
import { WorkGallery } from "@/components/site/WorkGallery";
import { SocialShowcase } from "@/components/site/SocialShowcase";

export const metadata: Metadata = {
  title: "Our Work — Projects & Live Production",
  description:
    "Kitchens, closets, consoles, doors, and custom fabrication — explore Nightowl Woodworks projects and watch live production on TikTok and Instagram.",
};

export default function WorkPage() {
  return (
    <SiteShell>
      <PageHero
        eyebrow="Our work"
        title="Real projects. Live production. Verified quality."
        intro="From fitted kitchens to commercial interiors — every component cut, banded, and finished in our own facility."
        image="/images/kitchen.jpg"
        imageAlt="Custom fitted kitchen produced by Nightowl Woodworks"
      />
      <WorkGallery />
      <SocialShowcase />
    </SiteShell>
  );
}

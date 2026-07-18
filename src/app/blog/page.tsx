import type { Metadata } from "next";
import { SiteShell } from "@/components/site/SiteShell";
import { PageHero } from "@/components/site/PageHero";
import { BlogList } from "@/components/site/BlogList";

export const metadata: Metadata = {
  alternates: { canonical: "/blog/" },
  title: "Blog | Wood Knowledge from the Factory Floor",
  description:
    "Expert answers to real questions about the best woods for kitchens, finishes that last, and lessons from the Nightowl Woodworks production floor.",
};

export default function BlogPage() {
  return (
    <SiteShell>
      <PageHero
        eyebrow="The Nightowl blog"
        title="Wood knowledge from the factory floor"
        intro="Practical answers to the questions clients ask us about materials, finishes, budgeting, and what quality really looks like."
        image="/images/factory.jpg"
        imageAlt="Inside the Nightowl Woodworks production facility"
      />
      <BlogList />
    </SiteShell>
  );
}

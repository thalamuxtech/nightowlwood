import type { Metadata } from "next";
import { Suspense } from "react";
import { SiteShell } from "@/components/site/SiteShell";
import { BlogPost } from "@/components/site/BlogPost";

export const metadata: Metadata = {
  title: "Article",
  description: "An article from the Nightowl Woodworks blog.",
};

export default function BlogPostPage() {
  return (
    <SiteShell>
      <Suspense>
        <BlogPost />
      </Suspense>
    </SiteShell>
  );
}

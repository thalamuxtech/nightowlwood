import type { MetadataRoute } from "next";
import posts from "@/content/posts.json";
import { SITE } from "@/lib/content";

export const dynamic = "force-static";

export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();
  const pages: { path: string; priority: number; freq: "daily" | "weekly" | "monthly" }[] = [
    { path: "", priority: 1, freq: "weekly" },
    { path: "services/", priority: 0.9, freq: "monthly" },
    { path: "work/", priority: 0.9, freq: "weekly" },
    { path: "blog/", priority: 0.8, freq: "daily" },
    { path: "about/", priority: 0.7, freq: "monthly" },
    { path: "contact/", priority: 0.9, freq: "monthly" },
    { path: "careers/", priority: 0.6, freq: "monthly" },
  ];

  return [
    ...pages.map((p) => ({
      url: `${SITE.url}/${p.path}`,
      lastModified: now,
      changeFrequency: p.freq,
      priority: p.priority,
    })),
    ...posts.map((post) => ({
      url: `${SITE.url}/blog/${post.slug}/`,
      lastModified: new Date(post.updatedAt ?? post.createdAt ?? now),
      changeFrequency: "monthly" as const,
      priority: 0.7,
    })),
  ];
}

// Fetch published blog posts from Firestore (public REST, no auth) and write
// them to src/content/posts.json so blog articles are statically prerendered
// with real HTML for search engines. Runs automatically before every build.
import { writeFileSync, existsSync, mkdirSync } from "node:fs";

const OUT = "src/content/posts.json";

try {
  const res = await fetch(
    "https://firestore.googleapis.com/v1/projects/nightowl-woodworks/databases/(default)/documents:runQuery",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        structuredQuery: {
          from: [{ collectionId: "posts" }],
          where: {
            fieldFilter: {
              field: { fieldPath: "published" },
              op: "EQUAL",
              value: { booleanValue: true },
            },
          },
          orderBy: [{ field: { fieldPath: "createdAt" }, direction: "DESCENDING" }],
          limit: 500,
        },
      }),
    }
  );
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const rows = await res.json();
  const posts = rows
    .filter((r) => r.document)
    .map(({ document: d }) => {
      const f = d.fields ?? {};
      return {
        slug: d.name.split("/").pop(),
        title: f.title?.stringValue ?? "",
        excerpt: f.excerpt?.stringValue ?? "",
        contentMd: f.contentMd?.stringValue ?? "",
        images: (f.images?.arrayValue?.values ?? []).map((v) => v.stringValue).filter(Boolean),
        createdAt: f.createdAt?.timestampValue ?? null,
        updatedAt: f.updatedAt?.timestampValue ?? null,
      };
    });
  mkdirSync("src/content", { recursive: true });
  writeFileSync(OUT, JSON.stringify(posts, null, 2));
  console.log(`snapshot-posts: wrote ${posts.length} published post(s)`);
} catch (err) {
  if (existsSync(OUT)) {
    console.warn(`snapshot-posts: fetch failed (${err.message}); keeping existing posts.json`);
  } else {
    mkdirSync("src/content", { recursive: true });
    writeFileSync(OUT, "[]");
    console.warn(`snapshot-posts: fetch failed (${err.message}); wrote empty posts.json`);
  }
}

import type { Metadata } from "next";
import Link from "next/link";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { ArrowLeft, ArrowRight, CalendarDays } from "lucide-react";
import posts from "@/content/posts.json";
import { SITE } from "@/lib/content";
import { SiteShell } from "@/components/site/SiteShell";
import { ImageSlider } from "@/components/site/ImageSlider";

export const dynamicParams = false;

export function generateStaticParams() {
  return posts.map((p) => ({ slug: p.slug }));
}

function getPost(slug: string) {
  return posts.find((p) => p.slug === slug);
}

function formatDate(iso: string | null) {
  if (!iso) return "";
  return new Intl.DateTimeFormat("en-GB", {
    year: "numeric",
    month: "long",
    day: "numeric",
  }).format(new Date(iso));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const post = getPost(slug);
  if (!post) return {};
  return {
    title: post.title,
    description: post.excerpt,
    alternates: { canonical: `/blog/${post.slug}/` },
    openGraph: {
      title: post.title,
      description: post.excerpt,
      type: "article",
      images: post.images.length > 0 ? [post.images[0]] : undefined,
    },
  };
}

export default async function BlogArticlePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const post = getPost(slug)!;

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: post.title,
    description: post.excerpt,
    image: post.images,
    datePublished: post.createdAt,
    dateModified: post.updatedAt ?? post.createdAt,
    author: { "@type": "Organization", name: SITE.name, url: SITE.url },
    publisher: {
      "@type": "Organization",
      name: SITE.name,
      logo: { "@type": "ImageObject", url: `${SITE.url}/images/nightowl.png` },
    },
    mainEntityOfPage: `${SITE.url}/blog/${post.slug}/`,
  };

  return (
    <SiteShell>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <article className="mx-auto max-w-3xl px-5 pb-24 pt-36 sm:px-8">
        <Link
          href="/blog/"
          className="inline-flex items-center gap-1.5 text-sm text-brass-300 transition-colors hover:text-brass-200"
        >
          <ArrowLeft size={15} /> All articles
        </Link>
        <h1 className="text-title mt-5 text-cream-50">{post.title}</h1>
        <p className="mt-4 flex items-center gap-2 text-sm text-cream-500">
          <CalendarDays size={15} className="text-brass-500" />
          {formatDate(post.createdAt)}
          <span aria-hidden>·</span> {SITE.shortName}
        </p>

        {post.images.length > 0 && (
          <div className="mt-9">
            <ImageSlider images={post.images} alt={post.title} />
          </div>
        )}

        <div className="prose-nightowl mt-10">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{post.contentMd}</ReactMarkdown>
        </div>

        <div className="glass mt-14 rounded-3xl !border-brass-500/30 p-8 text-center">
          <h2 className="font-display text-2xl text-cream-50">Planning a project?</h2>
          <p className="mx-auto mt-2 max-w-md text-sm text-cream-400">
            Get expert advice and an honest quote from the team behind this article.
          </p>
          <Link
            href="/contact/"
            className="group mt-6 inline-flex items-center gap-2 rounded-full bg-brass-500 px-7 py-3.5 font-medium text-night-950 transition-all duration-300 hover:bg-brass-400 hover:shadow-glow"
          >
            Get a quote
            <ArrowRight size={17} className="transition-transform duration-300 group-hover:translate-x-1" />
          </Link>
        </div>
      </article>
    </SiteShell>
  );
}

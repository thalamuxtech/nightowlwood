"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { motion } from "framer-motion";
import { ArrowLeft, ArrowRight, CalendarDays } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { doc, getDoc } from "firebase/firestore";
import { getDb } from "@/lib/firebase";
import type { Post } from "@/lib/types";
import { ImageSlider } from "./ImageSlider";

const EASE = [0.22, 1, 0.36, 1] as const;

export function BlogPost() {
  const params = useSearchParams();
  const slug = params.get("s") ?? "";
  const [post, setPost] = useState<Post | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "missing">("loading");

  useEffect(() => {
    if (!slug) {
      setState("missing");
      return;
    }
    getDoc(doc(getDb(), "posts", slug))
      .then((snap) => {
        if (snap.exists() && snap.data().published) {
          const data = { id: snap.id, ...snap.data() } as Post;
          setPost(data);
          document.title = `${data.title} — Nightowl Woodworks`;
          setState("ready");
        } else {
          setState("missing");
        }
      })
      .catch(() => setState("missing"));
  }, [slug]);

  if (state === "loading") {
    return (
      <div className="mx-auto max-w-3xl animate-pulse px-5 pb-24 pt-40 sm:px-8" role="status" aria-label="Loading article">
        <div className="h-3 w-32 rounded bg-night-700" />
        <div className="mt-4 h-10 w-4/5 rounded bg-night-700" />
        <div className="mt-8 aspect-[16/9] rounded-2xl bg-night-800" />
        <div className="mt-8 space-y-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-3 rounded bg-night-800" style={{ width: `${95 - (i % 3) * 12}%` }} />
          ))}
        </div>
      </div>
    );
  }

  if (state === "missing" || !post) {
    return (
      <div className="mx-auto max-w-xl px-5 pb-24 pt-44 text-center sm:px-8">
        <h1 className="text-title text-cream-50">Article not found</h1>
        <p className="mt-4 text-cream-400">
          This article may have been unpublished or the link is incomplete.
        </p>
        <Link
          href="/blog/"
          className="mt-8 inline-flex items-center gap-2 rounded-full bg-brass-500 px-7 py-3.5 font-medium text-night-950 transition-all duration-300 hover:bg-brass-400"
        >
          <ArrowLeft size={17} /> Back to the blog
        </Link>
      </div>
    );
  }

  return (
    <article className="mx-auto max-w-3xl px-5 pb-24 pt-36 sm:px-8">
      <motion.div initial={{ opacity: 0, y: 22 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.7, ease: EASE }}>
        <Link
          href="/blog/"
          className="inline-flex items-center gap-1.5 text-sm text-brass-300 transition-colors hover:text-brass-200"
        >
          <ArrowLeft size={15} /> All articles
        </Link>
        <h1 className="text-title mt-5 text-cream-50">{post.title}</h1>
        <p className="mt-4 flex items-center gap-2 text-sm text-cream-500">
          <CalendarDays size={15} className="text-brass-500" />
          {post.createdAt?.toDate?.().toLocaleDateString(undefined, {
            year: "numeric",
            month: "long",
            day: "numeric",
          })}
          <span aria-hidden>·</span> Nightowl Woodworks
        </p>
      </motion.div>

      {post.images.length > 0 && (
        <motion.div
          initial={{ opacity: 0, y: 26 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, delay: 0.15, ease: EASE }}
          className="mt-9"
        >
          <ImageSlider images={post.images} alt={post.title} />
        </motion.div>
      )}

      <motion.div
        initial={{ opacity: 0, y: 26 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.8, delay: 0.28, ease: EASE }}
        className="prose-nightowl mt-10"
      >
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{post.contentMd}</ReactMarkdown>
      </motion.div>

      <motion.div
        initial={{ opacity: 0 }}
        whileInView={{ opacity: 1 }}
        viewport={{ once: true }}
        transition={{ duration: 0.8 }}
        className="mt-14 rounded-2xl border border-brass-500/30 bg-night-800/50 p-8 text-center"
      >
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
      </motion.div>
    </article>
  );
}

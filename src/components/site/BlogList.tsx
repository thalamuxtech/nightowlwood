"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import { ArrowRight, BookOpen } from "lucide-react";
import { collection, onSnapshot, orderBy, query, where } from "firebase/firestore";
import { getDb } from "@/lib/firebase";
import type { Post } from "@/lib/types";

const EASE = [0.22, 1, 0.36, 1] as const;

export function BlogList() {
  const [posts, setPosts] = useState<Post[] | null>(null);

  useEffect(() => {
    const q = query(
      collection(getDb(), "posts"),
      where("published", "==", true),
      orderBy("createdAt", "desc")
    );
    return onSnapshot(
      q,
      (snap) => setPosts(snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Post)),
      () => setPosts([])
    );
  }, []);

  return (
    <section className="mx-auto max-w-7xl px-5 py-16 sm:px-8 lg:py-24">
      {posts === null && <SkeletonGrid />}

      {posts?.length === 0 && (
        <div className="mx-auto max-w-md rounded-2xl border border-dashed border-night-600 p-12 text-center">
          <BookOpen size={36} className="mx-auto text-brass-400" aria-hidden />
          <h2 className="mt-4 font-display text-xl text-cream-100">First posts coming soon</h2>
          <p className="mt-2 text-sm text-cream-400">
            We&apos;re writing up answers to the questions clients ask us most. Check back shortly.
          </p>
        </div>
      )}

      {posts && posts.length > 0 && (
        <div className="grid gap-8 sm:grid-cols-2 lg:grid-cols-3">
          {posts.map((post, i) => (
            <motion.article
              key={post.id}
              initial={{ opacity: 0, y: 28 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-60px" }}
              transition={{ duration: 0.7, delay: (i % 3) * 0.08, ease: EASE }}
              className="glass group flex flex-col overflow-hidden rounded-3xl transition-all duration-400 hover:-translate-y-1.5 hover:shadow-glow"
            >
              <Link href={`/blog/post/?s=${encodeURIComponent(post.id)}`} className="flex h-full flex-col">
                {post.images.length > 0 && (
                  <div className="relative aspect-[16/9] overflow-hidden bg-night-800">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={post.images[0]}
                      alt={post.title}
                      loading="lazy"
                      className="h-full w-full object-cover transition-transform duration-700 group-hover:scale-107"
                    />
                    {post.images.length > 1 && (
                      <span className="absolute right-3 top-3 rounded-full bg-night-950/75 px-2.5 py-1 text-xs text-cream-200 backdrop-blur-sm">
                        {post.images.length} photos
                      </span>
                    )}
                  </div>
                )}
                <div className="flex flex-1 flex-col p-6">
                  <p className="text-xs uppercase tracking-[0.2em] text-brass-400">
                    {post.createdAt?.toDate?.().toLocaleDateString(undefined, {
                      year: "numeric",
                      month: "long",
                      day: "numeric",
                    }) ?? ""}
                  </p>
                  <h2 className="mt-2 font-display text-xl leading-snug text-cream-50">
                    {post.title}
                  </h2>
                  <p className="mt-2 line-clamp-3 flex-1 text-sm leading-relaxed text-cream-400">
                    {post.excerpt}
                  </p>
                  <span className="mt-4 inline-flex items-center gap-1.5 text-sm font-medium text-brass-300">
                    Read article
                    <ArrowRight size={15} className="transition-transform duration-300 group-hover:translate-x-1" />
                  </span>
                </div>
              </Link>
            </motion.article>
          ))}
        </div>
      )}
    </section>
  );
}

function SkeletonGrid() {
  return (
    <div className="grid gap-8 sm:grid-cols-2 lg:grid-cols-3" aria-label="Loading posts" role="status">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="glass animate-pulse overflow-hidden rounded-3xl">
          <div className="aspect-[16/9] bg-night-800" />
          <div className="space-y-3 p-6">
            <div className="h-3 w-24 rounded bg-night-700" />
            <div className="h-5 w-3/4 rounded bg-night-700" />
            <div className="h-3 w-full rounded bg-night-800" />
            <div className="h-3 w-2/3 rounded bg-night-800" />
          </div>
        </div>
      ))}
    </div>
  );
}

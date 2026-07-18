"use client";

import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { collection, onSnapshot, orderBy, query, where } from "firebase/firestore";
import { getDb } from "@/lib/firebase";
import { WORK_ITEMS } from "@/lib/content";

const EASE = [0.22, 1, 0.36, 1] as const;

interface GalleryItem {
  id: string;
  title: string;
  category: string;
  description: string;
  imageUrl: string;
}

const FALLBACK: GalleryItem[] = WORK_ITEMS.map((w) => ({
  id: w.slug,
  title: w.title,
  category: w.category,
  description: w.description,
  imageUrl: w.image,
}));

/** Filterable work grid, managed from the admin dashboard (Firestore-backed). */
export function WorkGallery() {
  const [items, setItems] = useState<GalleryItem[]>(FALLBACK);
  const [category, setCategory] = useState("All");
  const [active, setActive] = useState<number | null>(null);

  useEffect(() => {
    const q = query(
      collection(getDb(), "workItems"),
      where("published", "==", true),
      orderBy("order", "asc")
    );
    return onSnapshot(
      q,
      (snap) => {
        if (snap.empty) return; // keep fallback if the collection is empty
        setItems(
          snap.docs.map((d) => {
            const data = d.data();
            return {
              id: d.id,
              title: data.title ?? "",
              category: data.category ?? "Custom",
              description: data.description ?? "",
              imageUrl: data.imageUrl ?? "",
            };
          })
        );
      },
      () => {} // on error keep the static fallback
    );
  }, []);

  const categories = useMemo(
    () => ["All", ...Array.from(new Set(items.map((i) => i.category)))],
    [items]
  );

  const visible = useMemo(
    () => (category === "All" ? items : items.filter((i) => i.category === category)),
    [items, category]
  );

  return (
    <section className="mx-auto max-w-7xl px-5 py-16 sm:px-8 lg:py-24">
      {/* Category chips */}
      <div className="flex flex-wrap gap-3" role="tablist" aria-label="Filter work by category">
        {categories.map((c) => (
          <button
            key={c}
            role="tab"
            aria-selected={category === c}
            onClick={() => {
              setCategory(c);
              setActive(null);
            }}
            className={`cursor-pointer rounded-full border px-5 py-2.5 text-sm font-medium transition-all duration-300 ${
              category === c
                ? "border-brass-500 bg-brass-500 text-night-950 shadow-glow"
                : "border-night-600 text-cream-300 hover:border-brass-500/60 hover:text-brass-300"
            }`}
          >
            {c}
          </button>
        ))}
      </div>

      {/* Grid */}
      <motion.div layout className="mt-10 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
        <AnimatePresence mode="popLayout">
          {visible.map((item, i) => (
            <motion.button
              layout
              key={item.id}
              initial={{ opacity: 0, scale: 0.94 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.94 }}
              transition={{ duration: 0.5, ease: EASE }}
              onClick={() => setActive(i)}
              className="group relative aspect-[4/3] cursor-pointer overflow-hidden rounded-3xl text-left shadow-card"
              aria-label={`Open ${item.title}`}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={item.imageUrl}
                alt={item.title}
                loading="lazy"
                className="absolute inset-0 h-full w-full object-cover transition-transform duration-700 group-hover:scale-108"
              />
              <span className="absolute inset-0 flex flex-col justify-end bg-gradient-to-t from-night-950/90 via-night-950/20 to-transparent p-6">
                <span className="text-[0.68rem] uppercase tracking-[0.25em] text-brass-400">
                  {item.category}
                </span>
                <span className="mt-1 font-display text-xl text-cream-50">{item.title}</span>
              </span>
            </motion.button>
          ))}
        </AnimatePresence>
      </motion.div>

      <Lightbox items={visible} active={active} setActive={setActive} />
    </section>
  );
}

function Lightbox({
  items,
  active,
  setActive,
}: {
  items: GalleryItem[];
  active: number | null;
  setActive: (i: number | null) => void;
}) {
  useEffect(() => {
    if (active === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setActive(null);
      if (e.key === "ArrowRight") setActive((active + 1) % items.length);
      if (e.key === "ArrowLeft") setActive((active - 1 + items.length) % items.length);
    };
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [active, items.length, setActive]);

  const item = active !== null ? items[active] : null;

  return (
    <AnimatePresence>
      {item && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[60] flex flex-col items-center justify-center bg-night-950/95 p-4 backdrop-blur-md sm:p-10"
          role="dialog"
          aria-modal="true"
          aria-label={item.title}
          onClick={() => setActive(null)}
        >
          <motion.figure
            key={item.id}
            initial={{ scale: 0.94, y: 20, opacity: 0 }}
            animate={{ scale: 1, y: 0, opacity: 1 }}
            exit={{ scale: 0.96, y: 12, opacity: 0 }}
            transition={{ duration: 0.4, ease: EASE }}
            drag="x"
            dragConstraints={{ left: 0, right: 0 }}
            dragElastic={0.6}
            onDragEnd={(_, info) => {
              if (info.offset.x < -80) setActive(((active ?? 0) + 1) % items.length);
              else if (info.offset.x > 80)
                setActive(((active ?? 0) - 1 + items.length) % items.length);
            }}
            onClick={(e) => e.stopPropagation()}
            className="flex max-h-full w-full max-w-5xl flex-col"
          >
            {/* Full image, never cropped — letterboxed on the dark stage */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={item.imageUrl}
              alt={item.title}
              className="mx-auto max-h-[72vh] w-auto max-w-full rounded-2xl object-contain"
            />
            <figcaption className="mx-auto mt-4 max-w-2xl px-1 text-center">
              <p className="text-[0.68rem] uppercase tracking-[0.25em] text-brass-400">
                {item.category} · {((active ?? 0) + 1)} / {items.length}
              </p>
              <h3 className="mt-1 font-display text-2xl text-cream-50">{item.title}</h3>
              <p className="mt-1 text-sm text-cream-400">{item.description}</p>
            </figcaption>
          </motion.figure>

          {/* Controls */}
          <button
            aria-label="Close"
            onClick={() => setActive(null)}
            className="absolute right-4 top-4 flex h-12 w-12 cursor-pointer items-center justify-center rounded-full border border-night-600 bg-night-900/60 text-cream-200 backdrop-blur-sm transition-colors duration-300 hover:border-brass-500 hover:text-brass-400"
          >
            <X size={22} />
          </button>
          <button
            aria-label="Previous image"
            onClick={(e) => {
              e.stopPropagation();
              setActive(((active ?? 0) - 1 + items.length) % items.length);
            }}
            className="absolute left-3 top-1/2 flex h-12 w-12 -translate-y-1/2 cursor-pointer items-center justify-center rounded-full border border-night-600 bg-night-900/60 text-cream-200 backdrop-blur-sm transition-colors duration-300 hover:border-brass-500 hover:text-brass-400"
          >
            <ChevronLeft size={22} />
          </button>
          <button
            aria-label="Next image"
            onClick={(e) => {
              e.stopPropagation();
              setActive(((active ?? 0) + 1) % items.length);
            }}
            className="absolute right-3 top-1/2 flex h-12 w-12 -translate-y-1/2 cursor-pointer items-center justify-center rounded-full border border-night-600 bg-night-900/60 text-cream-200 backdrop-blur-sm transition-colors duration-300 hover:border-brass-500 hover:text-brass-400"
          >
            <ChevronRight size={22} />
          </button>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

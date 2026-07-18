"use client";

import { useEffect, useMemo, useState } from "react";
import Image from "next/image";
import { AnimatePresence, motion } from "framer-motion";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { WORK_ITEMS, type WorkItem } from "@/lib/content";

const CATEGORIES = ["All", ...Array.from(new Set(WORK_ITEMS.map((w) => w.category)))];
const EASE = [0.22, 1, 0.36, 1] as const;

/** Filterable work grid with a swipe/keyboard-friendly lightbox. */
export function WorkGallery() {
  const [category, setCategory] = useState("All");
  const [active, setActive] = useState<number | null>(null);

  const items = useMemo(
    () => (category === "All" ? WORK_ITEMS : WORK_ITEMS.filter((w) => w.category === category)),
    [category]
  );

  return (
    <section className="mx-auto max-w-7xl px-5 py-16 sm:px-8 lg:py-24">
      {/* Category chips */}
      <div className="flex flex-wrap gap-3" role="tablist" aria-label="Filter work by category">
        {CATEGORIES.map((c) => (
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
          {items.map((item, i) => (
            <motion.button
              layout
              key={item.slug}
              initial={{ opacity: 0, scale: 0.94 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.94 }}
              transition={{ duration: 0.5, ease: EASE }}
              onClick={() => setActive(i)}
              className="group relative aspect-[4/3] cursor-pointer overflow-hidden rounded-2xl text-left shadow-card"
              aria-label={`Open ${item.title}`}
            >
              <Image
                src={item.image}
                alt={item.alt}
                fill
                sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"
                className="object-cover transition-transform duration-700 group-hover:scale-108"
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

      <Lightbox items={items} active={active} setActive={setActive} />
    </section>
  );
}

function Lightbox({
  items,
  active,
  setActive,
}: {
  items: WorkItem[];
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
          className="fixed inset-0 z-[60] flex items-center justify-center bg-night-950/95 p-4 backdrop-blur-md sm:p-10"
          role="dialog"
          aria-modal="true"
          aria-label={item.title}
          onClick={() => setActive(null)}
        >
          <motion.figure
            initial={{ scale: 0.92, y: 24 }}
            animate={{ scale: 1, y: 0 }}
            exit={{ scale: 0.94, y: 16 }}
            transition={{ duration: 0.45, ease: EASE }}
            drag="x"
            dragConstraints={{ left: 0, right: 0 }}
            dragElastic={0.6}
            onDragEnd={(_, info) => {
              if (info.offset.x < -80) setActive(((active ?? 0) + 1) % items.length);
              else if (info.offset.x > 80)
                setActive(((active ?? 0) - 1 + items.length) % items.length);
            }}
            onClick={(e) => e.stopPropagation()}
            className="relative w-full max-w-4xl"
          >
            <div className="relative aspect-[4/3] overflow-hidden rounded-2xl">
              <Image
                src={item.image}
                alt={item.alt}
                fill
                sizes="(max-width: 1024px) 100vw, 896px"
                className="object-cover"
                priority
              />
            </div>
            <figcaption className="mt-4 flex items-start justify-between gap-4 px-1">
              <div>
                <p className="text-[0.68rem] uppercase tracking-[0.25em] text-brass-400">
                  {item.category}
                </p>
                <h3 className="mt-1 font-display text-2xl text-cream-50">{item.title}</h3>
                <p className="mt-1 text-sm text-cream-400">{item.description}</p>
              </div>
            </figcaption>
          </motion.figure>

          {/* Controls */}
          <button
            aria-label="Close"
            onClick={() => setActive(null)}
            className="absolute right-4 top-4 flex h-12 w-12 cursor-pointer items-center justify-center rounded-full border border-night-600 text-cream-200 transition-colors duration-300 hover:border-brass-500 hover:text-brass-400"
          >
            <X size={22} />
          </button>
          <button
            aria-label="Previous"
            onClick={(e) => {
              e.stopPropagation();
              setActive(((active ?? 0) - 1 + items.length) % items.length);
            }}
            className="absolute left-3 top-1/2 hidden h-12 w-12 -translate-y-1/2 cursor-pointer items-center justify-center rounded-full border border-night-600 text-cream-200 transition-colors duration-300 hover:border-brass-500 hover:text-brass-400 sm:flex"
          >
            <ChevronLeft size={22} />
          </button>
          <button
            aria-label="Next"
            onClick={(e) => {
              e.stopPropagation();
              setActive(((active ?? 0) + 1) % items.length);
            }}
            className="absolute right-3 top-1/2 hidden h-12 w-12 -translate-y-1/2 cursor-pointer items-center justify-center rounded-full border border-night-600 text-cream-200 transition-colors duration-300 hover:border-brass-500 hover:text-brass-400 sm:flex"
          >
            <ChevronRight size={22} />
          </button>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";

interface ImageSliderProps {
  images: string[];
  alt: string;
  interval?: number;
  className?: string;
}

/**
 * Auto-advancing crossfade slider with dots and pause-on-hover.
 * Renders a plain image when there is only one.
 */
export function ImageSlider({ images, alt, interval = 4500, className = "" }: ImageSliderProps) {
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const reduce = useReducedMotion();

  useEffect(() => {
    if (images.length < 2 || paused || reduce) return;
    const t = setInterval(() => setIndex((i) => (i + 1) % images.length), interval);
    return () => clearInterval(t);
  }, [images.length, paused, interval, reduce]);

  if (images.length === 0) return null;

  return (
    <div
      className={`group relative overflow-hidden rounded-2xl bg-night-800 ${className}`}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      role="region"
      aria-roledescription="carousel"
      aria-label={alt}
    >
      <div className="relative aspect-[16/9]">
        <AnimatePresence initial={false}>
          <motion.img
            key={images[index]}
            src={images[index]}
            alt={`${alt} — image ${index + 1} of ${images.length}`}
            initial={{ opacity: 0, scale: 1.04 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.9, ease: [0.22, 1, 0.36, 1] }}
            className="absolute inset-0 h-full w-full object-cover"
            loading="lazy"
          />
        </AnimatePresence>
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-night-950/15 to-transparent" />
      </div>

      {images.length > 1 && (
        <div className="absolute inset-x-0 bottom-3 flex justify-center gap-2">
          {images.map((_, i) => (
            <button
              key={i}
              onClick={() => setIndex(i)}
              aria-label={`Go to image ${i + 1}`}
              aria-current={i === index}
              className={`h-2 cursor-pointer rounded-full transition-all duration-400 ${
                i === index ? "w-7 bg-brass-400" : "w-2 bg-cream-100/50 hover:bg-cream-100/80"
              }`}
            />
          ))}
        </div>
      )}
    </div>
  );
}

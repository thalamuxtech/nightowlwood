"use client";

import Image from "next/image";
import { motion } from "framer-motion";
import { WordsReveal } from "@/components/motion/Reveal";

interface PageHeroProps {
  eyebrow: string;
  title: string;
  intro?: string;
  image?: string;
  imageAlt?: string;
}

const EASE = [0.22, 1, 0.36, 1] as const;

/** Compact hero used by inner pages. */
export function PageHero({ eyebrow, title, intro, image, imageAlt = "" }: PageHeroProps) {
  return (
    <section className="relative flex min-h-[62svh] items-end overflow-hidden pb-16 pt-40">
      {image && (
        <div className="absolute inset-0 -z-10">
          <Image src={image} alt={imageAlt} fill priority sizes="100vw" className="object-cover" />
          <div className="absolute inset-0 bg-gradient-to-b from-night-950/85 via-night-950/70 to-night-950" />
        </div>
      )}
      <div className="mx-auto w-full max-w-7xl px-5 sm:px-8">
        <motion.p
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, delay: 0.1, ease: EASE }}
          className="text-eyebrow"
        >
          {eyebrow}
        </motion.p>
        <h1 className="text-title mt-5 max-w-3xl text-cream-50">
          <WordsReveal text={title} />
        </h1>
        {intro && (
          <motion.p
            initial={{ opacity: 0, y: 18 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, delay: 0.9, ease: EASE }}
            className="mt-6 max-w-2xl leading-relaxed text-cream-300"
          >
            {intro}
          </motion.p>
        )}
      </div>
    </section>
  );
}

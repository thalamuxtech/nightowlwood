"use client";

import { motion, useReducedMotion, type Variants } from "framer-motion";
import type { ReactNode } from "react";

const EASE = [0.22, 1, 0.36, 1] as const;

interface RevealProps {
  children: ReactNode;
  delay?: number;
  y?: number;
  className?: string;
  once?: boolean;
}

/** Fade-and-rise reveal on scroll into view. */
export function Reveal({ children, delay = 0, y = 32, className, once = true }: RevealProps) {
  const reduce = useReducedMotion();
  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, y: reduce ? 0 : y }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once, margin: "-80px" }}
      transition={{ duration: 0.9, delay, ease: EASE }}
    >
      {children}
    </motion.div>
  );
}

interface StaggerProps {
  children: ReactNode;
  className?: string;
  stagger?: number;
}

const containerVariants: Variants = {
  hidden: {},
  show: (stagger: number) => ({
    transition: { staggerChildren: stagger },
  }),
};

export function Stagger({ children, className, stagger = 0.12 }: StaggerProps) {
  return (
    <motion.div
      className={className}
      variants={containerVariants}
      custom={stagger}
      initial="hidden"
      whileInView="show"
      viewport={{ once: true, margin: "-80px" }}
    >
      {children}
    </motion.div>
  );
}

export const staggerItem: Variants = {
  hidden: { opacity: 0, y: 28 },
  show: { opacity: 1, y: 0, transition: { duration: 0.8, ease: EASE } },
};

/** Per-word cascading headline reveal. */
export function WordsReveal({ text, className }: { text: string; className?: string }) {
  const words = text.split(" ");
  return (
    <motion.span
      className={className}
      initial="hidden"
      animate="show"
      variants={{ hidden: {}, show: { transition: { staggerChildren: 0.09, delayChildren: 0.35 } } }}
      aria-label={text}
    >
      {words.map((word, i) => (
        <span key={i} className="inline-block overflow-hidden pb-1 align-bottom" aria-hidden>
          <motion.span
            className="inline-block"
            variants={{
              hidden: { y: "110%", rotate: 3 },
              show: { y: 0, rotate: 0, transition: { duration: 0.85, ease: EASE } },
            }}
          >
            {word}
          </motion.span>
          {i < words.length - 1 ? " " : ""}
        </span>
      ))}
    </motion.span>
  );
}

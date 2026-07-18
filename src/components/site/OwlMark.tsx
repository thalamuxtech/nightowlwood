"use client";

import { motion, useReducedMotion } from "framer-motion";

/**
 * Nightowl Woodworks peeking-owl mark, redrawn as a theme-aware SVG
 * (echoes the brand logo's owl with heavy brows peeking over the wordmark).
 * Renders in currentColor and supports a stroke "draw-on" animation.
 */
export function OwlMark({ size = 44, animate = true }: { size?: number; animate?: boolean }) {
  const reduce = useReducedMotion();
  const draw = animate && !reduce;

  const stroke = {
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 3,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  };

  const path = (d: string, delay: number, key: string, extra?: object) =>
    draw ? (
      <motion.path
        key={key}
        d={d}
        {...stroke}
        {...extra}
        initial={{ pathLength: 0, opacity: 0 }}
        animate={{ pathLength: 1, opacity: 1 }}
        transition={{ duration: 1.0, delay, ease: "easeInOut" }}
      />
    ) : (
      <path key={key} d={d} {...stroke} {...extra} />
    );

  return (
    <svg
      width={size}
      height={size * 0.75}
      viewBox="0 0 120 90"
      role="img"
      aria-label="Nightowl Woodworks owl mark"
    >
      {/* Head dome peeking over a ledge */}
      {path("M 14 82 Q 16 44 38 28 Q 50 20 60 20 Q 70 20 82 28 Q 104 44 106 82", 0, "dome")}
      {/* Ear tufts */}
      {path("M 52 22 L 56 12 L 60 20 L 64 12 L 68 22", 0.5, "tufts")}
      {/* Heavy brow sweeping across */}
      {path("M 18 46 Q 40 30 58 40 Q 62 42 66 40 Q 84 30 104 46 Q 84 40 66 46 Q 62 48 58 46 Q 40 40 18 46 Z", 0.7, "brow")}
      {/* Eyes */}
      {path("M 42 58 A 9 9 0 1 0 42.01 58", 1.1, "eyeL")}
      {path("M 78 58 A 9 9 0 1 0 78.01 58", 1.2, "eyeR")}
      {/* Pupils: constant gentle glancing (left, hold, right, recentre) */}
      <motion.g
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.5, delay: draw ? 1.35 : 0 }}
      >
        <motion.g
          animate={
            reduce
              ? undefined
              : {
                  x: [0, -3.5, -3.5, 0, 3.5, 3.5, 0, 0],
                  y: [0, 1, 1, 0, 1, 1, 0, 0],
                }
          }
          transition={{
            duration: 7,
            times: [0, 0.12, 0.3, 0.42, 0.55, 0.75, 0.86, 1],
            repeat: Infinity,
            ease: "easeInOut",
            delay: draw ? 2 : 0.8,
          }}
        >
          <circle cx="42" cy="58" r="2.6" fill="currentColor" />
          <circle cx="78" cy="58" r="2.6" fill="currentColor" />
        </motion.g>
      </motion.g>
      {/* Beak */}
      {path("M 60 60 L 56 70 Q 60 74 64 70 Z", 1.5, "beak")}
      {/* Eye flare lines */}
      {path("M 26 54 L 31 56 M 27 62 L 32 62", 1.55, "flareL")}
      {path("M 94 54 L 89 56 M 93 62 L 88 62", 1.6, "flareR")}
      {/* Ledge */}
      {path("M 8 82 L 112 82", 1.7, "ledge")}
    </svg>
  );
}

"use client";

import { motion, useReducedMotion } from "framer-motion";
import {
  OWL_BODY,
  OWL_BROW,
  OWL_PUPILS,
  OWL_RATIO,
  OWL_TRAVEL,
  OWL_VIEWBOX,
} from "./owl-paths";

/**
 * The Nightowl Woodworks owl mark, vector-traced 1:1 from the brand logo
 * (planning/brand/logomini.png). Body and pupils render in currentColor;
 * the brow uses the lighter brand tone. The pupils glance side to side
 * in a constant loop.
 */
export function OwlMark({ size = 44, animate = true }: { size?: number; animate?: boolean }) {
  const reduce = useReducedMotion();
  const entrance = animate && !reduce;
  const t = OWL_TRAVEL;

  return (
    <motion.svg
      width={size}
      height={Math.round(size * OWL_RATIO)}
      viewBox={OWL_VIEWBOX}
      role="img"
      aria-label="Nightowl Woodworks owl mark"
      initial={entrance ? { opacity: 0, scale: 0.82 } : undefined}
      animate={entrance ? { opacity: 1, scale: 1 } : undefined}
      transition={{ type: "spring", stiffness: 170, damping: 17 }}
    >
      {OWL_BODY.map((d, i) => (
        <path key={`b${i}`} d={d} fill="currentColor" fillRule="evenodd" />
      ))}
      {OWL_BROW.map((d, i) => (
        <path key={`w${i}`} d={d} fill="#ecc98f" fillRule="evenodd" />
      ))}
      {/* Pupils: constant glancing loop (left, hold, right, recentre) */}
      <motion.g
        animate={
          reduce
            ? undefined
            : {
                x: [0, -t, -t, t, t, 0],
                y: [0, t / 2, t / 2, t / 2, t / 2, 0],
              }
        }
        transition={{
          duration: 6,
          times: [0, 0.14, 0.32, 0.52, 0.72, 0.86],
          repeat: Infinity,
          ease: "easeInOut",
          delay: entrance ? 1.2 : 0.6,
        }}
      >
        {OWL_PUPILS.map((d, i) => (
          <path key={`p${i}`} d={d} fill="currentColor" fillRule="evenodd" />
        ))}
      </motion.g>
    </motion.svg>
  );
}

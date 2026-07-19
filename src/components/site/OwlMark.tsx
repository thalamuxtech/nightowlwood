"use client";

import { useId } from "react";
import { motion, useReducedMotion } from "framer-motion";
import {
  OWL_BODY,
  OWL_BROW,
  OWL_EYES,
  OWL_PUPILS,
  OWL_RATIO,
  OWL_TRAVEL,
  OWL_VIEWBOX,
} from "./owl-paths";

/**
 * The Nightowl Woodworks owl mark, vector-traced 1:1 from the brand logo.
 * Body and pupils render in currentColor; the brow uses the lighter brand
 * tone. The pupils dart side to side and the owl blinks via body-coloured
 * eyelids sliding inside clip-masked eye circles.
 */
export function OwlMark({ size = 44, animate = true }: { size?: number; animate?: boolean }) {
  const reduce = useReducedMotion();
  const uid = useId();
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
      <defs>
        {OWL_EYES.map((e, i) => (
          <clipPath key={i} id={`${uid}-eye-${i}`}>
            <circle cx={e.cx} cy={e.cy} r={e.r} />
          </clipPath>
        ))}
      </defs>

      {OWL_BODY.map((d, i) => (
        <path key={`b${i}`} d={d} fill="currentColor" fillRule="evenodd" />
      ))}
      {OWL_BROW.map((d, i) => (
        <path key={`w${i}`} d={d} fill="#ecc98f" fillRule="evenodd" />
      ))}

      {/* Pupils: wide darting glance (left, hold, right, recentre) */}
      <motion.g
        animate={
          reduce
            ? undefined
            : {
                x: [0, -t, -t, 0, t, t, 0, 0],
                y: [0, t / 2, t / 2, 0, t / 2, t / 2, 0, 0],
              }
        }
        transition={{
          duration: 5.5,
          times: [0, 0.09, 0.28, 0.37, 0.46, 0.65, 0.74, 1],
          repeat: Infinity,
          ease: "easeInOut",
          delay: entrance ? 1.2 : 0.5,
        }}
      >
        {OWL_PUPILS.map((d, i) => (
          <path key={`p${i}`} d={d} fill="currentColor" fillRule="evenodd" />
        ))}
      </motion.g>

      {/* Full blink: eyelids drop inside the clipped eye circles */}
      {!reduce &&
        OWL_EYES.map((e, i) => {
          const lid = e.r * 2 + 6;
          return (
            <g key={`lid${i}`} clipPath={`url(#${uid}-eye-${i})`}>
              <motion.rect
                x={e.cx - e.r - 3}
                y={e.cy - e.r - 3}
                width={e.r * 2 + 6}
                height={e.r * 2 + 6}
                fill="currentColor"
                initial={{ y: -lid }}
                animate={{ y: [-lid, -lid, 0, -lid, -lid] }}
                transition={{
                  duration: 4.4,
                  times: [0, 0.88, 0.92, 0.96, 1],
                  repeat: Infinity,
                  ease: "easeInOut",
                  delay: entrance ? 1.6 : 0.8,
                }}
              />
            </g>
          );
        })}
    </motion.svg>
  );
}

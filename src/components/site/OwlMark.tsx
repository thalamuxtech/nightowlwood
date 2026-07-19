"use client";

import { useId } from "react";
import { motion, useReducedMotion } from "framer-motion";
import {
  OWL_EYES,
  OWL_MAIN_BROW,
  OWL_MAIN_DARK,
  OWL_PUPILS,
  OWL_RATIO,
  OWL_SMALL_BROW,
  OWL_SMALL_DARK,
  OWL_TRAVEL,
  OWL_VIEWBOX,
} from "./owl-paths";

/**
 * The Nightowl Woodworks owl mark in the outline (line-art) style,
 * vector-traced 1:1 from the brand logo. Head and brow are stroked,
 * pupils and flare marks are solid. The pupils glance side to side
 * and the owl blinks via lids sliding inside clip-masked eye circles.
 */
export function OwlMark({ size = 44, animate = true }: { size?: number; animate?: boolean }) {
  const reduce = useReducedMotion();
  const uid = useId();
  const entrance = animate && !reduce;
  const t = OWL_TRAVEL;

  const strokeProps = {
    fill: "none",
    stroke: "currentColor",
    strokeLinejoin: "round" as const,
    vectorEffect: "non-scaling-stroke" as const,
    strokeWidth: 1.6,
  };

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

      {/* Stroked head + brow */}
      {OWL_MAIN_DARK.map((d, i) => (
        <path key={`md${i}`} d={d} {...strokeProps} />
      ))}
      {OWL_MAIN_BROW.map((d, i) => (
        <path key={`mb${i}`} d={d} {...strokeProps} stroke="#ecc98f" />
      ))}

      {/* Solid flare marks */}
      {OWL_SMALL_DARK.map((d, i) => (
        <path key={`sd${i}`} d={d} fill="currentColor" fillRule="evenodd" />
      ))}
      {OWL_SMALL_BROW.map((d, i) => (
        <path key={`sb${i}`} d={d} fill="#ecc98f" fillRule="evenodd" />
      ))}

      {/* Pupils: darting glance (left, hold, right, recentre) */}
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
          duration: 7.5,
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

      {/* Full blink: lids drop inside the clipped eye circles */}
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
                  duration: 6.5,
                  times: [0, 0.9, 0.935, 0.97, 1],
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

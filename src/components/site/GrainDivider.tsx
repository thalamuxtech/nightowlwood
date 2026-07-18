"use client";

import { motion, useReducedMotion } from "framer-motion";

/**
 * Decorative wood-grain SVG divider.
 * Lines draw themselves on scroll into view, then keep gently drifting,
 * while a brass shimmer sweeps along them.
 */
export function GrainDivider({ flip = false }: { flip?: boolean }) {
  const reduce = useReducedMotion();

  const lines = [
    { d: "M0 30 C 240 10, 480 50, 720 30 S 1200 10, 1440 30", w: 1, drift: 4 },
    { d: "M0 44 C 260 28, 520 60, 760 44 S 1220 26, 1440 44", w: 1.5, drift: -5 },
    { d: "M0 16 C 220 34, 500 0, 740 16 S 1180 36, 1440 16", w: 1, drift: 3 },
  ];

  return (
    <div aria-hidden className={`relative h-16 w-full overflow-hidden ${flip ? "rotate-180" : ""}`}>
      <svg
        viewBox="0 0 1440 60"
        preserveAspectRatio="none"
        className="absolute inset-0 h-full w-full text-walnut-500/40"
      >
        <defs>
          <linearGradient id="grain-shimmer" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" stopColor="transparent" />
            <stop offset="0.5" stopColor="#dba95f" stopOpacity="0.55" />
            <stop offset="1" stopColor="transparent" />
          </linearGradient>
        </defs>

        {lines.map((line, i) => (
          <motion.g
            key={i}
            animate={
              reduce
                ? undefined
                : { y: [0, line.drift, 0, -line.drift * 0.6, 0] }
            }
            transition={{ duration: 11 + i * 2.5, repeat: Infinity, ease: "easeInOut" }}
          >
            {/* Base grain line — draws on, then stays */}
            <motion.path
              d={line.d}
              fill="none"
              stroke="currentColor"
              strokeWidth={line.w}
              initial={{ pathLength: 0, opacity: 0 }}
              whileInView={{ pathLength: 1, opacity: 1 }}
              viewport={{ once: true }}
              transition={{ duration: 1.8, delay: i * 0.25, ease: "easeInOut" }}
            />
            {/* Brass shimmer sweeping along the line */}
            {!reduce && (
              <motion.path
                d={line.d}
                fill="none"
                stroke="url(#grain-shimmer)"
                strokeWidth={line.w + 0.6}
                strokeLinecap="round"
                pathLength={1}
                strokeDasharray="0.18 0.82"
                animate={{ strokeDashoffset: [1.18, -0.18] }}
                transition={{
                  duration: 6.5,
                  delay: 2 + i * 1.8,
                  repeat: Infinity,
                  repeatDelay: 3.5,
                  ease: "easeInOut",
                }}
              />
            )}
          </motion.g>
        ))}

        {/* Knot — draws on, then softly pulses */}
        <motion.circle
          cx={1080}
          cy={30}
          r={6}
          fill="none"
          stroke="currentColor"
          strokeWidth={1.2}
          initial={{ scale: 0, opacity: 0 }}
          whileInView={{ scale: 1, opacity: 1 }}
          viewport={{ once: true }}
          transition={{ duration: 0.7, delay: 1.4 }}
        />
        {!reduce && (
          <motion.circle
            cx={1080}
            cy={30}
            r={6}
            fill="none"
            stroke="#dba95f"
            strokeWidth={1}
            animate={{ r: [6, 11], opacity: [0.5, 0] }}
            transition={{ duration: 2.6, repeat: Infinity, repeatDelay: 2.4, ease: "easeOut" }}
          />
        )}
      </svg>
    </div>
  );
}

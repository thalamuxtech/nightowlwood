"use client";

import { motion } from "framer-motion";

/** Decorative wood-grain SVG divider that draws itself on scroll into view. */
export function GrainDivider({ flip = false }: { flip?: boolean }) {
  const lines = [
    "M0 30 C 240 10, 480 50, 720 30 S 1200 10, 1440 30",
    "M0 44 C 260 28, 520 60, 760 44 S 1220 26, 1440 44",
    "M0 16 C 220 34, 500 0, 740 16 S 1180 36, 1440 16",
  ];
  return (
    <div aria-hidden className={`relative h-16 w-full overflow-hidden ${flip ? "rotate-180" : ""}`}>
      <svg
        viewBox="0 0 1440 60"
        preserveAspectRatio="none"
        className="absolute inset-0 h-full w-full text-walnut-500/40"
      >
        {lines.map((d, i) => (
          <motion.path
            key={i}
            d={d}
            fill="none"
            stroke="currentColor"
            strokeWidth={i === 1 ? 1.5 : 1}
            initial={{ pathLength: 0, opacity: 0 }}
            whileInView={{ pathLength: 1, opacity: 1 }}
            viewport={{ once: true }}
            transition={{ duration: 1.8, delay: i * 0.25, ease: "easeInOut" }}
          />
        ))}
        {/* Knot */}
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
      </svg>
    </div>
  );
}

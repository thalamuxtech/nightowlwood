"use client";

import { useMemo } from "react";
import { motion, useReducedMotion } from "framer-motion";

/**
 * Ambient floating sawdust motes for hero sections.
 * Pure CSS-transform animation — cheap, and skipped under reduced motion.
 */
export function SawdustParticles({ count = 18 }: { count?: number }) {
  const reduce = useReducedMotion();

  const motes = useMemo(
    () =>
      Array.from({ length: count }, (_, i) => {
        // Deterministic pseudo-random layout so SSR and client agree.
        const seed = (i * 2654435761) % 1000;
        const r = (n: number) => ((seed * (n + 1)) % 997) / 997;
        return {
          left: `${5 + r(1) * 90}%`,
          top: `${8 + r(2) * 84}%`,
          size: 1.5 + r(3) * 2.6,
          duration: 9 + r(4) * 14,
          delay: r(5) * -20,
          drift: 14 + r(6) * 30,
          opacity: 0.14 + r(7) * 0.3,
        };
      }),
    [count]
  );

  if (reduce) return null;

  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
      {motes.map((m, i) => (
        <motion.span
          key={i}
          className="absolute rounded-full bg-brass-300"
          style={{
            left: m.left,
            top: m.top,
            width: m.size,
            height: m.size,
            opacity: m.opacity,
            boxShadow: "0 0 6px 1px rgb(219 169 95 / 0.25)",
          }}
          animate={{
            y: [0, -m.drift, 0],
            x: [0, m.drift * 0.5, -m.drift * 0.3, 0],
            opacity: [m.opacity, m.opacity * 1.8, m.opacity],
          }}
          transition={{
            duration: m.duration,
            delay: m.delay,
            repeat: Infinity,
            ease: "easeInOut",
          }}
        />
      ))}
    </div>
  );
}

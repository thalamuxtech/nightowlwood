"use client";

import { useEffect, useRef } from "react";
import { animate, useInView, useReducedMotion } from "framer-motion";

interface CounterProps {
  value: number;
  suffix?: string;
  className?: string;
  duration?: number;
}

/** Counts up from 0 when scrolled into view. */
export function Counter({ value, suffix = "", className, duration = 2 }: CounterProps) {
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true, margin: "-60px" });
  const reduce = useReducedMotion();

  useEffect(() => {
    if (!inView || !ref.current) return;
    if (reduce) {
      ref.current.textContent = `${value}${suffix}`;
      return;
    }
    const controls = animate(0, value, {
      duration,
      ease: [0.22, 1, 0.36, 1],
      onUpdate: (v) => {
        if (ref.current) ref.current.textContent = `${Math.round(v)}${suffix}`;
      },
    });
    return () => controls.stop();
  }, [inView, value, suffix, duration, reduce]);

  return (
    <span ref={ref} className={className} aria-label={`${value}${suffix}`}>
      0{suffix}
    </span>
  );
}

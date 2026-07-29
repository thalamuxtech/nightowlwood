"use client";

import { useEffect, useRef } from "react";
import { animate, useReducedMotion } from "framer-motion";

/**
 * Counter that re-animates whenever the value changes.
 *
 * The site's `Counter` fires once on scroll into view, which is right for a
 * marketing page but wrong for a live dashboard: Firestore pushes updates while
 * the screen is open, and a once-only counter would freeze on its first figure.
 * This tweens from the previous value to the new one, so a change reads as
 * movement rather than a silent replacement.
 */
export function LiveCounter({
  value,
  format,
  className,
  duration = 0.9,
}: {
  value: number;
  /** Formats the tweened number, e.g. formatNaira or a plain string cast. */
  format?: (n: number) => string;
  className?: string;
  duration?: number;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const previous = useRef(0);
  const reduce = useReducedMotion();

  const render = format ?? ((n: number) => String(Math.round(n)));

  useEffect(() => {
    const node = ref.current;
    if (!node) return;

    if (reduce) {
      node.textContent = render(value);
      previous.current = value;
      return;
    }

    const from = previous.current;
    previous.current = value;

    // A first paint from 0 is the introduction; later changes tween from where
    // the number already was, so the eye follows the delta.
    const controls = animate(from, value, {
      duration: from === 0 ? duration : Math.min(duration, 0.5),
      ease: [0.22, 1, 0.36, 1],
      onUpdate: (v) => {
        node.textContent = render(v);
      },
    });
    return () => controls.stop();
    // `render` is intentionally excluded: an inline formatter would be a new
    // function each render and restart the tween on every parent update.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, reduce, duration]);

  return (
    <span ref={ref} className={className}>
      {render(value)}
    </span>
  );
}

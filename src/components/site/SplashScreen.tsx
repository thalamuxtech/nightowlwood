"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { OwlMark } from "./OwlMark";

/**
 * Branded loading screen: the owl mark draws itself on over the dark
 * backdrop, then the overlay fades out. Shown once per browser session.
 */
export function SplashScreen() {
  const [show, setShow] = useState(false);
  const reduce = useReducedMotion();

  useEffect(() => {
    if (sessionStorage.getItem("nw-splash") === "1") return;
    sessionStorage.setItem("nw-splash", "1");
    setShow(true);
    document.body.style.overflow = "hidden";
    const t = setTimeout(() => {
      setShow(false);
      document.body.style.overflow = "";
    }, reduce ? 500 : 2400);
    return () => {
      clearTimeout(t);
      document.body.style.overflow = "";
    };
  }, [reduce]);

  return (
    <AnimatePresence>
      {show && (
        <motion.div
          initial={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
          className="fixed inset-0 z-[100] flex flex-col items-center justify-center bg-night-950"
          aria-hidden
        >
          <span className="text-brass-400">
            <OwlMark size={140} />
          </span>
          <motion.p
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.8, duration: 0.7 }}
            className="mt-6 font-display text-2xl tracking-wide text-cream-100"
          >
            Nightowl Woodworks
          </motion.p>
          <motion.p
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 1.2, duration: 0.7 }}
            className="mt-1 text-[0.65rem] uppercase tracking-[0.4em] text-cream-500"
          >
            Precision in every cut
          </motion.p>
          <motion.span
            initial={{ scaleX: 0 }}
            animate={{ scaleX: 1 }}
            transition={{ duration: reduce ? 0.3 : 2, ease: "easeInOut" }}
            className="mt-8 block h-0.5 w-40 origin-left rounded-full bg-gradient-to-r from-brass-600 via-brass-400 to-brass-300"
          />
        </motion.div>
      )}
    </AnimatePresence>
  );
}

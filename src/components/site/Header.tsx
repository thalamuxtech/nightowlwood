"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { AnimatePresence, motion, useScroll } from "framer-motion";
import { Menu, X } from "lucide-react";
import { NAV_LINKS, SITE } from "@/lib/content";
import { OwlMark } from "./OwlMark";

export function Header() {
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const pathname = usePathname();
  const { scrollY } = useScroll();

  useEffect(() => {
    return scrollY.on("change", (v) => setScrolled(v > 24));
  }, [scrollY]);

  useEffect(() => {
    document.body.style.overflow = open ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [open]);

  const isActive = (href: string) =>
    href === "/" ? pathname === "/" : pathname.startsWith(href.replace(/\/$/, ""));

  return (
    <>
      <motion.header
        initial={{ y: -80, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ duration: 0.8, ease: [0.22, 1, 0.36, 1] }}
        className={`fixed inset-x-0 top-0 z-50 transition-all duration-500 ${
          scrolled ? "bg-night-950/85 shadow-card backdrop-blur-xl" : "bg-transparent"
        }`}
      >
        <div className="mx-auto flex h-20 max-w-7xl items-center justify-between px-5 sm:px-8">
          <Link
            href="/"
            className="flex items-center gap-3 text-cream-100 transition-colors duration-300 hover:text-brass-400"
            aria-label={`${SITE.shortName} home`}
            onClick={() => setOpen(false)}
          >
            <span className="text-brass-400">
              <OwlMark size={44} />
            </span>
            <span className="hidden flex-col leading-tight sm:flex">
              <span className="font-display text-lg tracking-wide">Nightowl</span>
              <span className="text-[0.62rem] uppercase tracking-[0.34em] text-cream-400">
                Woodworks
              </span>
            </span>
          </Link>

          <nav className="hidden items-center gap-9 md:flex" aria-label="Primary">
            {NAV_LINKS.slice(0, 5).map((link) => (
              <Link
                key={link.href}
                href={link.href}
                aria-current={isActive(link.href) ? "page" : undefined}
                className="link-lined text-sm font-medium tracking-wide text-cream-200 transition-colors duration-300 hover:text-cream-50"
              >
                {link.label}
              </Link>
            ))}
            <Link
              href="/contact/"
              className="rounded-full border border-brass-500/60 px-6 py-2.5 text-sm font-medium tracking-wide text-brass-300 transition-all duration-300 hover:bg-brass-500 hover:text-night-950 hover:shadow-glow"
            >
              Get a Quote
            </Link>
          </nav>

          <button
            type="button"
            className="flex h-11 w-11 cursor-pointer items-center justify-center rounded-full text-cream-100 transition-colors duration-300 hover:text-brass-400 md:hidden"
            aria-label={open ? "Close menu" : "Open menu"}
            aria-expanded={open}
            onClick={() => setOpen((v) => !v)}
          >
            {open ? <X size={26} /> : <Menu size={26} />}
          </button>
        </div>
      </motion.header>

      {/* Full-screen mobile menu */}
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.35 }}
            className="fixed inset-0 z-40 flex flex-col justify-center bg-night-950/97 px-8 backdrop-blur-2xl md:hidden"
          >
            <nav className="flex flex-col gap-2" aria-label="Mobile">
              {NAV_LINKS.map((link, i) => (
                <motion.div
                  key={link.href}
                  initial={{ opacity: 0, x: -32 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.12 + i * 0.08, duration: 0.55, ease: [0.22, 1, 0.36, 1] }}
                >
                  <Link
                    href={link.href}
                    onClick={() => setOpen(false)}
                    aria-current={isActive(link.href) ? "page" : undefined}
                    className={`block py-4 font-display text-4xl transition-colors duration-300 ${
                      isActive(link.href) ? "text-brass-400" : "text-cream-100 hover:text-brass-300"
                    }`}
                  >
                    {link.label}
                  </Link>
                </motion.div>
              ))}
            </nav>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.5 }}
              className="mt-12 space-y-1 text-sm text-cream-400"
            >
              <p>{SITE.name}, {SITE.location}</p>
              <a
                href={SITE.whatsappHref}
                target="_blank"
                rel="noopener noreferrer"
                className="block text-brass-400"
              >
                WhatsApp {SITE.whatsappNumber}
              </a>
              <a href={SITE.instagram} target="_blank" rel="noopener noreferrer" className="block">
                Instagram {SITE.instagramHandle}
              </a>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}

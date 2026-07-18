"use client";

import Image from "next/image";
import { motion } from "framer-motion";
import { Instagram, Music2, BadgeCheck, Clapperboard, Hammer } from "lucide-react";
import { SITE } from "@/lib/content";
import { Reveal } from "@/components/motion/Reveal";
import { SectionHeading } from "./SectionHeading";

const BADGES = [
  { icon: Hammer, label: "Real Projects" },
  { icon: Clapperboard, label: "Live Production" },
  { icon: BadgeCheck, label: "Verified Quality" },
];

export function SocialShowcase() {
  return (
    <section className="bg-night-900 py-20 lg:py-28">
      <div className="mx-auto grid max-w-7xl items-center gap-12 px-5 sm:px-8 lg:grid-cols-2">
        <Reveal>
          <div className="relative mx-auto max-w-[300px] overflow-hidden rounded-3xl border border-night-700/70 shadow-card sm:max-w-xs">
            <Image
              src="/images/social-showcase.jpg"
              alt="Nightowl Woodworks production videos and projects on social media"
              width={600}
              height={800}
              className="h-auto w-full object-contain"
            />
          </div>
        </Reveal>
        <div>
          <SectionHeading
            align="left"
            eyebrow="Follow the process"
            title="Watch the shop at work"
            intro="Our latest projects, finishing, and installation work, documented as it happens. Watch real production videos that show the workflow and attention to detail behind every order."
          />
          <div className="mt-8 flex flex-wrap gap-3">
            {BADGES.map(({ icon: Icon, label }) => (
              <span
                key={label}
                className="inline-flex items-center gap-2 rounded-full border border-brass-500/30 bg-night-800/70 px-5 py-2.5 text-xs font-medium uppercase tracking-[0.15em] text-brass-300"
              >
                <Icon size={14} /> {label}
              </span>
            ))}
          </div>
          <div className="mt-9 flex flex-col gap-4 sm:flex-row">
            <motion.a
              whileHover={{ y: -2 }}
              href={SITE.tiktok}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center justify-center gap-2.5 rounded-full bg-cream-50 px-7 py-3.5 font-medium text-night-950 transition-colors duration-300 hover:bg-brass-300"
            >
              <Music2 size={18} /> Watch on TikTok
            </motion.a>
            <motion.a
              whileHover={{ y: -2 }}
              href={SITE.instagram}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center justify-center gap-2.5 rounded-full border border-cream-200/30 px-7 py-3.5 font-medium text-cream-100 transition-all duration-300 hover:border-brass-400 hover:text-brass-300"
            >
              <Instagram size={18} /> View on Instagram
            </motion.a>
          </div>
        </div>
      </div>
    </section>
  );
}

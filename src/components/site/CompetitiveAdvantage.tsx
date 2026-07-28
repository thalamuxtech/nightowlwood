"use client";

import Link from "next/link";
import { motion, useReducedMotion } from "framer-motion";
import { SectionHeading } from "@/components/site/SectionHeading";
import { ServiceIcon } from "@/components/site/ServiceIcon";
import { Reveal, Stagger, staggerItem } from "@/components/motion/Reveal";
import { ADVANTAGE_DETAILS } from "@/lib/content";

const EASE = [0.22, 1, 0.36, 1] as const;

/**
 * Why clients choose Nightowl over a general workshop. Each card leads with the
 * benefit and closes with a proof point, so the section argues rather than
 * asserts.
 */
export function CompetitiveAdvantage() {
  const reduce = useReducedMotion();

  return (
    <section className="relative overflow-hidden border-y border-night-800/60 bg-night-900/30">
      {/* Soft brass wash behind the grid, echoing the section dividers */}
      <span
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-brass-500/40 to-transparent"
      />

      <div className="mx-auto max-w-7xl px-5 py-16 sm:px-8 lg:py-24">
        <SectionHeading
          eyebrow="Competitive advantage"
          title="Why specifiers keep coming back"
          intro="Precision board processing is a supply-chain decision, not just a purchase. These are the four things that decide whether your joinery package lands on time and installs cleanly."
          // Fraunces is variable, so 700 is available; the stock .text-title
          // weight of 500 reads too light for this section's headline.
          titleClassName="!font-bold tracking-tight text-white"
        />

        <Stagger className="mt-14 grid gap-6 sm:grid-cols-2 lg:grid-cols-4" stagger={0.1}>
          {ADVANTAGE_DETAILS.map((item) => (
            <motion.article
              key={item.key}
              variants={staggerItem}
              whileHover={reduce ? undefined : { y: -6 }}
              transition={{ duration: 0.4, ease: EASE }}
              className="glass group flex h-full flex-col rounded-3xl p-8 transition-shadow duration-300 hover:shadow-glow"
            >
              <span className="inline-block text-brass-400 transition-transform duration-500 group-hover:scale-110">
                <ServiceIcon name={item.icon} size={44} />
              </span>

              <p className="text-eyebrow mt-6">{item.label}</p>
              <h3 className="mt-2 font-display text-xl leading-snug text-cream-50">
                {item.title}
              </h3>
              <p className="mt-3 text-sm leading-relaxed text-cream-400">{item.description}</p>

              {/* Proof point sits in a fixed-height footer so the brass rules
                  line up across the row regardless of description length. The
                  rule is a flex sibling, so it stays put when the text wraps. */}
              <div className="mt-auto flex min-h-[4.5rem] items-start gap-2 pt-6">
                <span aria-hidden className="mt-[0.55rem] h-px w-6 shrink-0 bg-brass-500/60" />
                <p className="text-xs font-medium leading-relaxed text-brass-300">{item.proof}</p>
              </div>
            </motion.article>
          ))}
        </Stagger>

        <Reveal delay={0.2} className="mt-12 text-center">
          <Link
            href="/contact/"
            className="inline-flex items-center gap-2 rounded-full border border-brass-500/40 bg-night-800/70 px-7 py-3 text-sm font-medium text-brass-300 transition-all duration-300 hover:border-brass-500 hover:text-brass-200 hover:shadow-glow"
          >
            Request a quote for your project
            <span aria-hidden>&rarr;</span>
          </Link>
        </Reveal>
      </div>
    </section>
  );
}

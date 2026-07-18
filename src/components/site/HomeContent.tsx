"use client";

import Image from "next/image";
import Link from "next/link";
import { motion, useScroll, useTransform, useReducedMotion } from "framer-motion";
import { useRef } from "react";
import { ArrowRight, CheckCircle2, Quote } from "lucide-react";
import {
  ABOUT,
  ADVANTAGES,
  AWARD,
  COMPLIANCE,
  INDUSTRIES,
  MACHINES,
  PROCESS,
  SERVICES,
  SITE,
  STATS,
  TESTIMONIALS,
  WORK_ITEMS,
} from "@/lib/content";
import { Reveal, Stagger, staggerItem, WordsReveal } from "@/components/motion/Reveal";
import { Counter } from "@/components/motion/Counter";
import { Tilt3D } from "@/components/motion/Tilt3D";
import { SawdustParticles } from "@/components/motion/SawdustParticles";
import { SectionHeading } from "./SectionHeading";
import { ServiceIcon } from "./ServiceIcon";
import { GrainDivider } from "./GrainDivider";
import { motion as m } from "framer-motion";

const EASE = [0.22, 1, 0.36, 1] as const;

export function HomeContent() {
  return (
    <>
      <Hero />
      <StatsBand />
      <AboutTeaser />
      <ServicesGrid />
      <WorkStrip />
      <IndustriesBand />
      <ProcessTimeline />
      <MachinesBand />
      <Testimonials />
      <AwardTeaser />
      <ComplianceStrip />
      <CtaBand />
    </>
  );
}

function Hero() {
  const ref = useRef<HTMLDivElement>(null);
  const reduce = useReducedMotion();
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start start", "end start"] });
  const y = useTransform(scrollYProgress, [0, 1], ["0%", reduce ? "0%" : "22%"]);
  const scale = useTransform(scrollYProgress, [0, 1], [1.08, reduce ? 1.08 : 1.22]);
  const opacity = useTransform(scrollYProgress, [0, 0.85], [1, 0.25]);

  return (
    <section ref={ref} className="relative flex min-h-svh items-center overflow-hidden">
      <motion.div style={{ y, scale }} className="absolute inset-0 -z-10">
        <Image
          src="/images/hero.jpg"
          alt="Precision wood processing at the Nightowl Woodworks factory"
          fill
          priority
          className="object-cover"
          sizes="100vw"
        />
        <div className="absolute inset-0 bg-gradient-to-b from-night-950/65 via-night-950/25 to-night-950" />
      </motion.div>

      <SawdustParticles />

      <motion.div style={{ opacity }} className="mx-auto w-full max-w-7xl px-5 pt-24 sm:px-8">
        <motion.p
          initial={{ opacity: 0, y: 18 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, delay: 0.15, ease: EASE }}
          className="text-eyebrow"
        >
          Nightowl Woodworks Ltd, {SITE.location}
        </motion.p>

        <h1 className="text-display mt-6 max-w-4xl text-cream-50">
          <WordsReveal text="Precision wood processing." />
          <span className="block text-brass-400">
            <WordsReveal text="Engineered for your build." />
          </span>
        </h1>

        <motion.p
          initial={{ opacity: 0, y: 22 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.9, delay: 1.05, ease: EASE }}
          className="mt-7 max-w-xl text-lg leading-relaxed text-cream-200 sm:text-xl"
        >
          Industrial-grade cutting, edge banding, and custom fabrication for
          construction and interiors. {SITE.slogan}
        </motion.p>

        <motion.div
          initial={{ opacity: 0, y: 22 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.9, delay: 1.25, ease: EASE }}
          className="mt-10 flex flex-col gap-4 sm:flex-row"
        >
          <Link
            href="/contact/"
            className="group inline-flex items-center justify-center gap-2 rounded-full bg-brass-500 px-8 py-4 font-medium text-night-950 transition-all duration-300 hover:bg-brass-400 hover:shadow-glow"
          >
            Get a quote today
            <ArrowRight size={18} className="transition-transform duration-300 group-hover:translate-x-1" />
          </Link>
          <Link
            href="/work/"
            className="inline-flex items-center justify-center gap-2 rounded-full border border-cream-200/30 px-8 py-4 font-medium text-cream-100 backdrop-blur-sm transition-all duration-300 hover:border-brass-400 hover:text-brass-300"
          >
            See our work
          </Link>
        </motion.div>
      </motion.div>

      {/* Scroll cue */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 2 }}
        className="absolute bottom-8 left-1/2 -translate-x-1/2"
        aria-hidden
      >
        <motion.span
          animate={{ y: [0, 10, 0] }}
          transition={{ duration: 1.8, repeat: Infinity, ease: "easeInOut" }}
          className="block h-10 w-6 rounded-full border border-cream-200/40 p-1.5"
        >
          <span className="block h-2 w-1 rounded-full bg-brass-400 mx-auto" />
        </motion.span>
      </motion.div>
    </section>
  );
}

function StatsBand() {
  return (
    <section className="bg-woodplanks relative py-16 sm:py-20">
      <div className="mx-auto grid max-w-5xl grid-cols-1 gap-6 px-5 sm:grid-cols-3 sm:px-8">
        {STATS.map((stat, i) => (
          <Reveal key={stat.label} delay={i * 0.12}>
            <div className="glass rounded-3xl px-6 py-8 text-center">
              <p className="font-display text-5xl text-brass-400 sm:text-6xl">
                <Counter value={stat.value} suffix={stat.suffix} />
              </p>
              <p className="mt-3 text-sm uppercase tracking-[0.2em] text-cream-300">{stat.label}</p>
            </div>
          </Reveal>
        ))}
      </div>
    </section>
  );
}

function AboutTeaser() {
  return (
    <section className="mx-auto grid max-w-7xl items-center gap-12 px-5 py-24 sm:px-8 lg:grid-cols-2 lg:py-32">
      <Reveal>
        <div className="relative overflow-hidden rounded-3xl shadow-card">
          <Image
            src="/images/factory.jpg"
            alt="Inside the Nightowl Woodworks production facility"
            width={960}
            height={720}
            className="h-full w-full object-cover transition-transform duration-700 hover:scale-105"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-night-950/30 to-transparent" />
        </div>
      </Reveal>
      <div>
        <SectionHeading
          align="left"
          eyebrow="About us"
          title="A modern factory with a craftsman's eye"
          intro={ABOUT.paragraphs[0]}
        />
        <Reveal delay={0.15}>
          <p className="mt-4 leading-relaxed text-cream-400">{ABOUT.paragraphs[1]}</p>
        </Reveal>
        <Stagger className="mt-8 grid grid-cols-2 gap-4" stagger={0.1}>
          {ABOUT.pillars.map((pillar) => (
            <m.div key={pillar} variants={staggerItem} className="flex items-center gap-2.5">
              <CheckCircle2 size={18} className="shrink-0 text-brass-500" />
              <span className="text-sm font-medium text-cream-200">{pillar}</span>
            </m.div>
          ))}
        </Stagger>
        <Reveal delay={0.3}>
          <Link
            href="/about/"
            className="link-lined mt-9 inline-flex items-center gap-2 text-sm font-medium text-brass-300"
          >
            More about the studio <ArrowRight size={16} />
          </Link>
        </Reveal>
      </div>
    </section>
  );
}

function ServicesGrid() {
  return (
    <section className="bg-night-900 py-24 lg:py-32">
      <div className="mx-auto max-w-7xl px-5 sm:px-8">
        <SectionHeading
          eyebrow="Our services"
          title="From raw board to ready component"
          intro="Six services on one production line, covering everything your project needs between the drawing and the install."
        />
        <Stagger className="mt-14 grid gap-6 sm:grid-cols-2 lg:grid-cols-3" stagger={0.08}>
          {SERVICES.map((service) => (
            <m.div key={service.key} variants={staggerItem} className="h-full">
              <Tilt3D className="h-full">
                <article className="glass group relative h-full overflow-hidden rounded-3xl p-8 transition-all duration-400 hover:shadow-glow">
                  <span className="inline-block text-brass-400 transition-transform duration-500 group-hover:scale-110">
                    <ServiceIcon name={service.key} />
                  </span>
                  <h3 className="mt-5 font-display text-xl text-cream-50">{service.title}</h3>
                  <p className="mt-3 text-sm leading-relaxed text-cream-400">{service.description}</p>
                  <span
                    aria-hidden
                    className="absolute inset-x-0 bottom-0 h-0.5 origin-left scale-x-0 bg-gradient-to-r from-brass-500 to-brass-300 transition-transform duration-500 group-hover:scale-x-100"
                  />
                </article>
              </Tilt3D>
            </m.div>
          ))}
        </Stagger>
      </div>
    </section>
  );
}

function WorkStrip() {
  return (
    <section className="py-24 lg:py-32">
      <div className="mx-auto max-w-7xl px-5 sm:px-8">
        <div className="flex flex-wrap items-end justify-between gap-6">
          <SectionHeading
            align="left"
            eyebrow="Project applications"
            title="Built for real projects"
          />
          <Reveal delay={0.2}>
            <Link
              href="/work/"
              className="link-lined inline-flex items-center gap-2 text-sm font-medium text-brass-300"
            >
              View all work <ArrowRight size={16} />
            </Link>
          </Reveal>
        </div>
        <Stagger className="mt-12 grid gap-6 sm:grid-cols-2 lg:grid-cols-3" stagger={0.09}>
          {WORK_ITEMS.slice(0, 6).map((item) => (
            <m.figure
              key={item.slug}
              variants={staggerItem}
              className="group relative aspect-[4/3] overflow-hidden rounded-3xl shadow-card"
            >
              <Image
                src={item.image}
                alt={item.alt}
                fill
                sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"
                className="object-cover transition-transform duration-700 group-hover:scale-108"
              />
              <figcaption className="absolute inset-0 flex flex-col justify-end bg-gradient-to-t from-night-950/85 via-night-950/10 to-transparent p-6">
                <span className="text-[0.68rem] uppercase tracking-[0.25em] text-brass-400">
                  {item.category}
                </span>
                <h3 className="mt-1 font-display text-xl text-cream-50">{item.title}</h3>
                <p className="mt-1 max-h-0 overflow-hidden text-sm text-cream-300 opacity-0 transition-all duration-500 group-hover:max-h-20 group-hover:opacity-100">
                  {item.description}
                </p>
              </figcaption>
            </m.figure>
          ))}
        </Stagger>
      </div>
    </section>
  );
}

function IndustriesBand() {
  return (
    <section className="bg-night-900 py-24 lg:py-28">
      <div className="mx-auto max-w-7xl px-5 sm:px-8">
        <SectionHeading
          eyebrow="Who we serve"
          title="A production partner for professionals"
        />
        <Stagger className="mt-14 grid gap-6 md:grid-cols-3" stagger={0.1}>
          {INDUSTRIES.map((industry) => (
            <m.div
              key={industry.key}
              variants={staggerItem}
              className="glass rounded-3xl p-8 text-center transition-all duration-300 hover:shadow-glow"
            >
              <span className="mx-auto inline-block text-brass-400">
                <ServiceIcon name={industry.key} size={44} />
              </span>
              <h3 className="mt-4 font-display text-lg text-cream-50">{industry.title}</h3>
              <p className="mt-2 text-sm text-cream-400">{industry.description}</p>
            </m.div>
          ))}
        </Stagger>
        <Reveal delay={0.2} className="mt-10">
          <ul className="flex flex-wrap justify-center gap-3">
            {ADVANTAGES.map((advantage) => (
              <li
                key={advantage}
                className="rounded-full border border-brass-500/30 bg-night-800/70 px-5 py-2 text-xs font-medium uppercase tracking-[0.18em] text-brass-300"
              >
                {advantage}
              </li>
            ))}
          </ul>
        </Reveal>
      </div>
    </section>
  );
}

function ProcessTimeline() {
  return (
    <section className="py-24 lg:py-32">
      <div className="mx-auto max-w-4xl px-5 sm:px-8">
        <SectionHeading
          eyebrow="Quality & process assurance"
          title="How we control quality"
        />
        <div className="relative mt-16">
          <span
            aria-hidden
            className="absolute left-6 top-0 h-full w-px bg-gradient-to-b from-brass-500/60 via-walnut-500/40 to-transparent sm:left-1/2"
          />
          {PROCESS.map((phase, i) => (
            <Reveal
              key={phase.step}
              delay={i * 0.08}
              className={`relative mb-12 pl-16 sm:w-1/2 sm:pl-0 ${
                i % 2 === 0 ? "sm:pr-14 sm:text-right" : "sm:ml-auto sm:pl-14"
              }`}
            >
              <span
                className={`ring-endgrain absolute left-6 top-1 flex h-11 w-11 -translate-x-1/2 items-center justify-center rounded-full border border-brass-500/50 font-display text-sm text-brass-400 shadow-glow ${
                  i % 2 === 0 ? "sm:left-auto sm:right-0 sm:translate-x-1/2" : "sm:left-0 sm:-translate-x-1/2"
                }`}
              >
                {phase.step}
              </span>
              <h3 className="font-display text-xl text-cream-50">{phase.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-cream-400">{phase.description}</p>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}

function MachinesBand() {
  return (
    <section className="bg-night-900 py-24 lg:py-28">
      <div className="mx-auto max-w-7xl px-5 sm:px-8">
        <SectionHeading
          eyebrow="Our machines"
          title="Our machines"
        />
        <div className="mt-14 grid gap-8 md:grid-cols-2">
          {MACHINES.map((machine, i) => (
            <Reveal key={machine.title} delay={i * 0.12}>
              <figure className="glass group overflow-hidden rounded-3xl">
                <div className="relative aspect-[16/10] overflow-hidden">
                  <Image
                    src={machine.image}
                    alt={machine.alt}
                    fill
                    sizes="(max-width: 768px) 100vw, 50vw"
                    className="object-cover transition-transform duration-700 group-hover:scale-106"
                  />
                </div>
                <figcaption className="p-7">
                  <h3 className="font-display text-xl text-cream-50">{machine.title}</h3>
                  <p className="mt-2 text-sm text-cream-400">{machine.description}</p>
                </figcaption>
              </figure>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}

function Testimonials() {
  return (
    <section className="py-24 lg:py-32">
      <div className="mx-auto max-w-7xl px-5 sm:px-8">
        <SectionHeading eyebrow="What our clients say" title="What our clients say" />
        <Stagger className="mt-14 grid gap-6 md:grid-cols-3" stagger={0.12}>
          {TESTIMONIALS.map((t) => (
            <m.blockquote
              key={t.author}
              variants={staggerItem}
              className="glass flex flex-col rounded-3xl p-8"
            >
              <Quote size={28} className="text-brass-500/70" aria-hidden />
              <p className="mt-4 flex-1 leading-relaxed text-cream-200">“{t.quote}”</p>
              <footer className="mt-6 border-t border-night-700/60 pt-4">
                <p className="font-medium text-cream-50">{t.author}</p>
                <p className="text-xs uppercase tracking-[0.2em] text-brass-400">{t.role}</p>
              </footer>
            </m.blockquote>
          ))}
        </Stagger>
      </div>
    </section>
  );
}

function AwardTeaser() {
  return (
    <section className="bg-night-900 py-24 lg:py-28">
      <div className="mx-auto grid max-w-7xl items-center gap-12 px-5 sm:px-8 lg:grid-cols-2">
        <div>
          <SectionHeading
            align="left"
            eyebrow="News"
            title="Recognised for excellence"
            intro={`Winner of the ${AWARD.headline} at the Nile University innovation and entrepreneurship competition.`}
          />
          <Reveal delay={0.2}>
            <Link
              href="/about/#award"
              className="link-lined mt-8 inline-flex items-center gap-2 text-sm font-medium text-brass-300"
            >
              Read the story <ArrowRight size={16} />
            </Link>
          </Reveal>
        </div>
        <Stagger className="grid grid-cols-2 gap-4" stagger={0.1}>
          {AWARD.images.map((img) => (
            <m.div
              key={img.src}
              variants={staggerItem}
              className="relative aspect-square overflow-hidden rounded-3xl shadow-card"
            >
              <Image
                src={img.src}
                alt={img.alt}
                fill
                sizes="(max-width: 1024px) 50vw, 25vw"
                className="object-cover transition-transform duration-700 hover:scale-107"
              />
            </m.div>
          ))}
        </Stagger>
      </div>
    </section>
  );
}

function ComplianceStrip() {
  return (
    <section className="py-16">
      <div className="mx-auto max-w-5xl px-5 sm:px-8">
        <Reveal>
          <p className="text-center text-xs uppercase tracking-[0.3em] text-cream-500">
            Corporate compliance
          </p>
        </Reveal>
        <Stagger className="mt-8 flex flex-wrap items-center justify-center gap-8" stagger={0.06}>
          {COMPLIANCE.map((badge) => (
            <m.div key={badge.name} variants={staggerItem} className="flex flex-col items-center gap-2">
              <Image
                src={badge.image}
                alt={badge.alt}
                width={56}
                height={56}
                className="h-14 w-14 rounded-full bg-cream-50 object-contain p-1.5"
              />
              <span className="text-[0.65rem] uppercase tracking-[0.2em] text-cream-500">
                {badge.name}
              </span>
            </m.div>
          ))}
        </Stagger>
      </div>
    </section>
  );
}

function CtaBand() {
  return (
    <section className="bg-woodgrain relative overflow-hidden py-14 lg:py-16">
      <div className="absolute inset-0 -z-10">
        <Image
          src="/images/cutting.jpg"
          alt=""
          aria-hidden
          fill
          sizes="100vw"
          className="object-cover opacity-50"
        />
        <div className="absolute inset-0 bg-gradient-to-b from-night-950 via-night-950/55 to-night-950" />
      </div>
      <GrainDivider />
      <span
        aria-hidden
        className="text-wood3d pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 select-none whitespace-nowrap font-display font-semibold uppercase tracking-[0.08em] opacity-35"
        style={{ fontSize: "clamp(4rem, 16vw, 13rem)" }}
      >
        Precision
      </span>
      <div className="mx-auto max-w-3xl px-5 py-4 text-center sm:px-8">
        <Reveal>
          <h2 className="text-title text-cream-50">
            Your next project deserves <span className="text-brass-400">precision</span>.
          </h2>
          <p className="mx-auto mt-5 max-w-xl leading-relaxed text-cream-300">
            Send us your drawings or describe the job. We&apos;ll respond with an
            honest quote and a realistic timeline.
          </p>
          <div className="mt-9 flex flex-col justify-center gap-4 sm:flex-row">
            <Link
              href="/contact/"
              className="group inline-flex items-center justify-center gap-2 rounded-full bg-brass-500 px-8 py-4 font-medium text-night-950 transition-all duration-300 hover:bg-brass-400 hover:shadow-glow"
            >
              Get a quote
              <ArrowRight size={18} className="transition-transform duration-300 group-hover:translate-x-1" />
            </Link>
            <a
              href={SITE.whatsappHref}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center justify-center gap-2 rounded-full border border-cream-200/30 px-8 py-4 font-medium text-cream-100 transition-all duration-300 hover:border-brass-400 hover:text-brass-300"
            >
              Chat on WhatsApp
            </a>
          </div>
        </Reveal>
      </div>
    </section>
  );
}

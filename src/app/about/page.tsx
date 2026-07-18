import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { ArrowRight, CheckCircle2, Compass, Play, Target } from "lucide-react";
import { ABOUT, AWARD, COMPLIANCE, SITE, TEAM } from "@/lib/content";
import { SiteShell } from "@/components/site/SiteShell";
import { PageHero } from "@/components/site/PageHero";
import { SectionHeading } from "@/components/site/SectionHeading";
import { Reveal } from "@/components/motion/Reveal";
import { GrainDivider } from "@/components/site/GrainDivider";

export const metadata: Metadata = {
  title: "About — A Modern Wood Processing Company",
  description:
    "Nightowl Woodworks Ltd combines modern machinery with skilled craftsmanship to deliver precision wood processing for construction and interior projects in Nigeria.",
};

export default function AboutPage() {
  return (
    <SiteShell>
      <PageHero
        eyebrow="About us"
        title="Modern machinery. Skilled hands. One standard."
        intro={ABOUT.paragraphs[0]}
        image="/images/factory.jpg"
        imageAlt="Inside the Nightowl Woodworks production facility"
      />

      {/* Story + pillars */}
      <section className="mx-auto max-w-4xl px-5 py-20 sm:px-8 lg:py-28">
        <Reveal>
          <p className="text-lg leading-relaxed text-cream-200">{ABOUT.paragraphs[1]}</p>
          <p className="mt-5 leading-relaxed text-cream-400">{ABOUT.paragraphs[2]}</p>
        </Reveal>
        <Reveal delay={0.15}>
          <ul className="mt-10 grid grid-cols-2 gap-4 sm:grid-cols-4">
            {ABOUT.pillars.map((pillar) => (
              <li
                key={pillar}
                className="flex flex-col items-center gap-2 rounded-2xl border border-night-700/60 bg-night-800/40 p-5 text-center"
              >
                <CheckCircle2 size={20} className="text-brass-500" />
                <span className="text-sm font-medium text-cream-200">{pillar}</span>
              </li>
            ))}
          </ul>
        </Reveal>
      </section>

      {/* Vision & Mission */}
      <section className="bg-night-900 py-20 lg:py-28">
        <div className="mx-auto grid max-w-6xl gap-8 px-5 sm:px-8 md:grid-cols-2">
          <Reveal>
            <div className="h-full rounded-2xl border border-night-700/70 bg-night-800/50 p-9">
              <Compass size={32} className="text-brass-400" aria-hidden />
              <h2 className="mt-5 font-display text-2xl text-cream-50">Our Vision</h2>
              <p className="mt-4 leading-relaxed text-cream-300">{ABOUT.vision}</p>
            </div>
          </Reveal>
          <Reveal delay={0.12}>
            <div className="h-full rounded-2xl border border-night-700/70 bg-night-800/50 p-9">
              <Target size={32} className="text-brass-400" aria-hidden />
              <h2 className="mt-5 font-display text-2xl text-cream-50">Our Mission</h2>
              <p className="mt-4 leading-relaxed text-cream-300">{ABOUT.mission}</p>
            </div>
          </Reveal>
        </div>
      </section>

      {/* Team */}
      <section className="mx-auto grid max-w-7xl items-center gap-12 px-5 py-20 sm:px-8 lg:grid-cols-2 lg:py-28">
        <div className="order-2 lg:order-1">
          <SectionHeading align="left" eyebrow="Our team" title="The people behind the precision" />
          {TEAM.paragraphs.map((paragraph, i) => (
            <Reveal key={i} delay={0.1 + i * 0.08}>
              <p className={`leading-relaxed ${i === 0 ? "mt-6 text-cream-200" : "mt-4 text-cream-400"}`}>
                {paragraph}
              </p>
            </Reveal>
          ))}
        </div>
        <Reveal className="order-1 lg:order-2">
          <div className="relative overflow-hidden rounded-2xl shadow-card">
            <Image
              src="/images/team.jpg"
              alt="The Nightowl Woodworks team at the production facility"
              width={960}
              height={720}
              className="h-full w-full object-cover transition-transform duration-700 hover:scale-105"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-night-950/40 to-transparent" />
          </div>
        </Reveal>
      </section>

      {/* Award */}
      <section id="award" className="relative bg-night-900 py-20 lg:py-28">
        <GrainDivider />
        <div className="mx-auto max-w-7xl px-5 pt-10 sm:px-8">
          <SectionHeading
            eyebrow="News"
            title={AWARD.headline}
          />
          <div className="mt-12 grid items-start gap-12 lg:grid-cols-2">
            <div>
              {AWARD.paragraphs.map((paragraph, i) => (
                <Reveal key={i} delay={i * 0.08}>
                  <p className={`leading-relaxed ${i === 0 ? "text-cream-200" : "mt-4 text-cream-400"}`}>
                    {paragraph}
                  </p>
                </Reveal>
              ))}
              <Reveal delay={0.3}>
                <a
                  href={SITE.pitchVideo}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-8 inline-flex items-center gap-2.5 rounded-full bg-brass-500 px-7 py-3.5 font-medium text-night-950 transition-all duration-300 hover:bg-brass-400 hover:shadow-glow"
                >
                  <Play size={18} /> Watch our pitch video
                </a>
              </Reveal>
            </div>
            <div className="grid grid-cols-2 gap-4">
              {AWARD.images.map((img, i) => (
                <Reveal key={img.src} delay={i * 0.08}>
                  <div className="relative aspect-square overflow-hidden rounded-2xl shadow-card">
                    <Image
                      src={img.src}
                      alt={img.alt}
                      fill
                      sizes="(max-width: 1024px) 50vw, 25vw"
                      className="object-cover transition-transform duration-700 hover:scale-107"
                    />
                  </div>
                </Reveal>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* Compliance + CTA */}
      <section className="mx-auto max-w-5xl px-5 py-20 text-center sm:px-8">
        <SectionHeading
          eyebrow="Corporate compliance"
          title="Registered. Certified. Accountable."
        />
        <Reveal delay={0.15}>
          <div className="mt-10 flex flex-wrap items-center justify-center gap-8">
            {COMPLIANCE.map((badge) => (
              <div key={badge.name} className="flex flex-col items-center gap-2">
                <Image
                  src={badge.image}
                  alt={badge.alt}
                  width={64}
                  height={64}
                  className="h-16 w-16 rounded-full bg-cream-50 object-contain p-2"
                />
                <span className="text-[0.65rem] uppercase tracking-[0.2em] text-cream-500">
                  {badge.name}
                </span>
              </div>
            ))}
          </div>
        </Reveal>
        <Reveal delay={0.25}>
          <Link
            href="/contact/"
            className="group mt-12 inline-flex items-center justify-center gap-2 rounded-full bg-brass-500 px-8 py-4 font-medium text-night-950 transition-all duration-300 hover:bg-brass-400 hover:shadow-glow"
          >
            Work with us
            <ArrowRight size={18} className="transition-transform duration-300 group-hover:translate-x-1" />
          </Link>
        </Reveal>
      </section>
    </SiteShell>
  );
}

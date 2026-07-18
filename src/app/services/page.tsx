import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { MACHINES, PROCESS, SERVICES } from "@/lib/content";
import { SiteShell } from "@/components/site/SiteShell";
import { SectionHeading } from "@/components/site/SectionHeading";
import { ServiceIcon } from "@/components/site/ServiceIcon";
import { Reveal } from "@/components/motion/Reveal";
import { PageHero } from "@/components/site/PageHero";

export const metadata: Metadata = {
  alternates: { canonical: "/services/" },
  title: "Services | Precision Cutting, Edge Banding & Fabrication",
  description:
    "Precision cutting, edge banding, fabrication, custom processing, delivery, and technical advisory from Nightowl Woodworks Ltd.",
};

export default function ServicesPage() {
  return (
    <SiteShell>
      <PageHero
        eyebrow="Our services"
        title="Everything between the drawing and the install"
        intro="Six services on one modern production line. Bring us a cutting list, a technical drawing, or just an idea, and we take it from raw board to ready component."
        image="/images/edging.jpg"
        imageAlt="Edge banding machine finishing panels at Nightowl Woodworks"
      />

      <section className="mx-auto max-w-7xl px-5 py-20 sm:px-8 lg:py-28">
        <div className="grid gap-6 md:grid-cols-2">
          {SERVICES.map((service, i) => (
            <Reveal key={service.key} delay={(i % 2) * 0.1}>
              <article className="glass group flex h-full gap-6 rounded-3xl p-8 transition-all duration-400 hover:-translate-y-1 hover:shadow-glow">
                <span className="shrink-0 text-brass-400 transition-transform duration-500 group-hover:scale-110">
                  <ServiceIcon name={service.key} size={46} />
                </span>
                <div>
                  <h2 className="font-display text-2xl text-cream-50">{service.title}</h2>
                  <p className="mt-3 leading-relaxed text-cream-400">{service.description}</p>
                </div>
              </article>
            </Reveal>
          ))}
        </div>
      </section>

      <section className="bg-night-900 py-20 lg:py-28">
        <div className="mx-auto max-w-7xl px-5 sm:px-8">
          <SectionHeading
            eyebrow="Our machines"
            title="The equipment we run"
            intro="Industrial machinery, maintained and calibrated for repeatable accuracy at volume."
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

      <section className="mx-auto max-w-4xl px-5 py-20 sm:px-8 lg:py-28">
        <SectionHeading
          eyebrow="Process assurance"
          title="How every order moves through the shop"
        />
        <ol className="mt-14 space-y-8">
          {PROCESS.map((phase, i) => (
            <Reveal key={phase.step} delay={i * 0.06}>
              <li className="glass flex gap-6 rounded-3xl p-7">
                <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full border border-brass-500/50 font-display text-brass-400">
                  {phase.step}
                </span>
                <div>
                  <h3 className="font-display text-xl text-cream-50">{phase.title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-cream-400">{phase.description}</p>
                </div>
              </li>
            </Reveal>
          ))}
        </ol>
        <Reveal delay={0.2} className="mt-12 text-center">
          <Link
            href="/contact/"
            className="group inline-flex items-center justify-center gap-2 rounded-full bg-brass-500 px-8 py-4 font-medium text-night-950 transition-all duration-300 hover:bg-brass-400 hover:shadow-glow"
          >
            Start your order
            <ArrowRight size={18} className="transition-transform duration-300 group-hover:translate-x-1" />
          </Link>
        </Reveal>
      </section>
    </SiteShell>
  );
}

import type { Metadata } from "next";
import { GraduationCap, Wrench, Users } from "lucide-react";
import { CAREERS } from "@/lib/content";
import { SiteShell } from "@/components/site/SiteShell";
import { PageHero } from "@/components/site/PageHero";
import { Reveal } from "@/components/motion/Reveal";
import { InternshipForm } from "@/components/site/InternshipForm";

export const metadata: Metadata = {
  alternates: { canonical: "/careers/" },
  title: "Internships & Careers | Learn Precision Woodworking",
  description:
    "Join the Nightowl Woodworks internship programme for hands-on training in precision cutting, fabrication, finishing, and design on real client projects.",
};

const ICONS = [Wrench, GraduationCap, Users];

export default function CareersPage() {
  return (
    <SiteShell>
      <PageHero
        eyebrow="Internships & careers"
        title="Learn the craft on real machines and real projects"
        intro={CAREERS.intro}
        image="/images/team.jpg"
        imageAlt="The Nightowl Woodworks team at work in the factory"
      />

      <section className="mx-auto max-w-7xl px-5 py-16 sm:px-8 lg:py-20">
        <div className="grid gap-6 md:grid-cols-3">
          {CAREERS.points.map((point, i) => {
            const Icon = ICONS[i % ICONS.length];
            return (
              <Reveal key={point.title} delay={i * 0.1}>
                <div className="glass h-full rounded-3xl p-8 transition-all duration-300 hover:shadow-glow">
                  <Icon size={30} className="text-brass-400" aria-hidden />
                  <h2 className="mt-4 font-display text-xl text-cream-50">{point.title}</h2>
                  <p className="mt-2 text-sm leading-relaxed text-cream-400">{point.description}</p>
                </div>
              </Reveal>
            );
          })}
        </div>
      </section>

      <section className="bg-night-900 py-16 lg:py-24">
        <div className="mx-auto max-w-3xl px-5 sm:px-8">
          <Reveal className="text-center">
            <p className="text-eyebrow">Apply</p>
            <h2 className="text-title mt-4 text-cream-50">Tell us who you are</h2>
            <p className="mx-auto mt-4 max-w-xl text-cream-400">
              We review every application personally. Show us your interest, your work
              (if you have any), and what you want to learn.
            </p>
          </Reveal>
          <div className="mt-12">
            <InternshipForm />
          </div>
        </div>
      </section>
    </SiteShell>
  );
}

import type { Metadata } from "next";
import { Instagram, Mail, MessageCircle, Music2 } from "lucide-react";
import { SITE } from "@/lib/content";
import { SiteShell } from "@/components/site/SiteShell";
import { PageHero } from "@/components/site/PageHero";
import { ContactTabs } from "@/components/site/ContactTabs";
import { Reveal } from "@/components/motion/Reveal";

export const metadata: Metadata = {
  title: "Get a Quote — Start Your Project",
  description:
    "Request a quote from Nightowl Woodworks Ltd — precision cutting, edge banding, and custom fabrication. Reach us via the quote form or WhatsApp.",
};

export default function ContactPage() {
  return (
    <SiteShell>
      <PageHero
        eyebrow="Get a quote"
        title="Tell us about your project"
        intro="Send your cutting list, drawings, or a simple description. We respond with an honest quote and a realistic timeline — usually within one business day."
        image="/images/doors.jpg"
        imageAlt="Custom doors fabricated by Nightowl Woodworks"
      />

      <section className="mx-auto grid max-w-7xl gap-14 px-5 py-20 sm:px-8 lg:grid-cols-[1fr_380px] lg:py-28">
        <ContactTabs />

        <aside className="space-y-6">
          <Reveal delay={0.15}>
            <div className="rounded-2xl border border-night-700/70 bg-night-800/50 p-8">
              <h2 className="font-display text-xl text-cream-50">Prefer to chat?</h2>
              <p className="mt-3 text-sm leading-relaxed text-cream-400">
                Reach out for inquiries, collaborations, or project discussions —
                we&apos;re fastest on WhatsApp.
              </p>
              <a
                href={SITE.whatsappHref}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-6 inline-flex w-full items-center justify-center gap-2.5 rounded-full bg-[#25D366] px-6 py-3.5 font-medium text-night-950 transition-all duration-300 hover:brightness-110"
              >
                <MessageCircle size={18} /> Chat on WhatsApp
              </a>
              <p className="mt-3 text-center text-xs text-cream-500">{SITE.whatsappNumber}</p>
              <a
                href={`mailto:${SITE.email}`}
                className="mt-4 flex items-center justify-center gap-2.5 rounded-full border border-night-600 px-6 py-3 text-sm text-cream-200 transition-all duration-300 hover:border-brass-500/60 hover:text-brass-300"
              >
                <Mail size={16} className="text-brass-400" /> {SITE.email}
              </a>
            </div>
          </Reveal>

          <Reveal delay={0.25}>
            <div className="rounded-2xl border border-night-700/70 bg-night-800/50 p-8">
              <h2 className="font-display text-xl text-cream-50">Follow the shop</h2>
              <p className="mt-3 text-sm leading-relaxed text-cream-400">
                Live production videos, finished projects, and behind-the-scenes.
              </p>
              <div className="mt-6 space-y-3">
                <a
                  href={SITE.instagram}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-3 rounded-xl border border-night-600 px-5 py-3 text-sm text-cream-200 transition-all duration-300 hover:border-brass-500/60 hover:text-brass-300"
                >
                  <Instagram size={18} className="text-brass-400" /> {SITE.instagramHandle}
                </a>
                <a
                  href={SITE.tiktok}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-3 rounded-xl border border-night-600 px-5 py-3 text-sm text-cream-200 transition-all duration-300 hover:border-brass-500/60 hover:text-brass-300"
                >
                  <Music2 size={18} className="text-brass-400" /> {SITE.tiktokHandle}
                </a>
              </div>
            </div>
          </Reveal>
        </aside>
      </section>
    </SiteShell>
  );
}

import Link from "next/link";
import Image from "next/image";
import { Instagram, Lock, Mail, MapPin, MessageCircle, Music2, Youtube } from "lucide-react";
import { COMPLIANCE, FOOTER_LINKS, SITE } from "@/lib/content";
import { SubscribeForm } from "./SubscribeForm";
import { OwlMark } from "./OwlMark";
import { GrainDivider } from "./GrainDivider";

export function Footer() {
  return (
    <footer className="bg-woodplanks relative">
      <GrainDivider />
      <div className="mx-auto grid max-w-7xl gap-12 px-5 pb-10 pt-14 sm:px-8 md:grid-cols-3">
        <div>
          <div className="flex items-center gap-3 text-brass-400">
            <OwlMark size={92} animate={false} />
            <div className="leading-tight">
              <p className="text-wood3d-light font-display text-3xl font-semibold tracking-wide">
                Nightowl
              </p>
              <p className="text-[0.65rem] uppercase tracking-[0.34em] text-cream-400">
                Woodworks Ltd
              </p>
            </div>
          </div>
          <p className="mt-5 max-w-xs text-sm leading-relaxed text-cream-400">
            {SITE.slogan} Industrial-grade wood processing and fabrication for
            construction and interior projects across {SITE.location}.
          </p>
          <div className="mt-6 flex flex-wrap items-center gap-3 opacity-80">
            {COMPLIANCE.map((badge) => (
              <Image
                key={badge.name}
                src={badge.image}
                alt={badge.alt}
                width={40}
                height={40}
                className="h-9 w-9 rounded-full bg-cream-50 object-contain p-1 transition-transform duration-300 hover:scale-[1.7]"
              />
            ))}
          </div>
        </div>

        <nav className="text-sm" aria-label="Footer">
          <p className="text-eyebrow mb-5">Explore</p>
          <ul className="space-y-3">
            {FOOTER_LINKS.map((link) => (
              <li key={link.href}>
                <Link
                  href={link.href}
                  className="link-lined text-cream-200 transition-colors duration-300 hover:text-cream-50"
                >
                  {link.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>

        <div className="text-sm">
          <p className="text-eyebrow mb-5">Get in touch</p>
          <ul className="space-y-3 text-cream-200">
            <li>
              <a
                href={SITE.whatsappHref}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-3 transition-colors duration-300 hover:text-brass-300"
              >
                <MessageCircle size={16} className="text-brass-500" />
                WhatsApp {SITE.whatsappNumber}
              </a>
            </li>
            <li>
              <a
                href={`mailto:${SITE.email}`}
                className="flex items-center gap-3 transition-colors duration-300 hover:text-brass-300"
              >
                <Mail size={16} className="text-brass-500" /> {SITE.email}
              </a>
            </li>
            <li className="flex items-center gap-3">
              <MapPin size={16} className="text-brass-500" /> {SITE.location}
            </li>
          </ul>
          <SubscribeForm />
          <div className="mt-6 flex gap-3">
            <a
              href={SITE.instagram}
              target="_blank"
              rel="noopener noreferrer"
              aria-label="Nightowl Woodworks on Instagram"
              className="flex h-11 w-11 items-center justify-center rounded-full border border-night-600 text-cream-300 transition-all duration-300 hover:border-brass-500 hover:text-brass-400"
            >
              <Instagram size={18} />
            </a>
            <a
              href={SITE.tiktok}
              target="_blank"
              rel="noopener noreferrer"
              aria-label="Nightowl Woodworks on TikTok"
              className="flex h-11 w-11 items-center justify-center rounded-full border border-night-600 text-cream-300 transition-all duration-300 hover:border-brass-500 hover:text-brass-400"
            >
              <Music2 size={18} />
            </a>
            <a
              href={SITE.pitchVideo}
              target="_blank"
              rel="noopener noreferrer"
              aria-label="Watch the Nightowl Woodworks pitch video on YouTube"
              className="flex h-11 w-11 items-center justify-center rounded-full border border-night-600 text-cream-300 transition-all duration-300 hover:border-brass-500 hover:text-brass-400"
            >
              <Youtube size={18} />
            </a>
          </div>
        </div>
      </div>

      <div aria-hidden className="hairline-shimmer" />
      <div>
        <div className="mx-auto grid max-w-7xl items-center gap-2 px-5 py-5 text-center text-xs text-cream-500 sm:grid-cols-3 sm:px-8 sm:text-left">
          <p>
            © {new Date().getFullYear()} {SITE.name}. All rights reserved.
          </p>
          <p className="sm:text-center">
            Powered by{" "}
            <a
              href="https://thalamux-tech.web.app"
              target="_blank"
              rel="noopener noreferrer"
              className="text-cream-400 transition-colors duration-300 hover:text-brass-300"
            >
              Thalamuxtech
            </a>
          </p>
          <div className="flex items-center justify-center gap-4 sm:justify-end">
            <p className="font-display italic text-cream-500">{SITE.slogan}</p>
            <Link
              href="/admin/"
              aria-label="Staff sign-in"
              className="opacity-25 transition-opacity duration-300 hover:opacity-70"
            >
              <Lock size={14} />
            </Link>
          </div>
        </div>
      </div>
    </footer>
  );
}

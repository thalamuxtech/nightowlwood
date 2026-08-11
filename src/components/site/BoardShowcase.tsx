"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { getDb } from "@/lib/firebase";
import {
  defaultBoardCatalogue,
  loadBoardCatalogue,
  publishedBoards,
  type BoardCatalogueSettings,
} from "@/lib/erp/boardCatalogue";
import { SectionHeading } from "@/components/site/SectionHeading";
import { Reveal } from "@/components/motion/Reveal";

/**
 * The boards the workshop cuts, with a picture of each.
 *
 * A business whose product is a sheet of board described its materials only in prose: a
 * customer choosing between Egger and MFC had a dropdown of names and nothing to look at. This
 * is the answer to "what does Bangaji actually look like".
 *
 * Rendered from the defaults immediately and re-rendered from Firestore when the catalogue
 * arrives. That ordering matters for a static export: the page is prerendered, so the section
 * has to be complete and correct in the HTML before any client read happens — otherwise the
 * first paint is an empty band and the section pops in, which is worse than slightly stale
 * copy. The admin's edits then replace it a moment later.
 */
export function BoardShowcase() {
  const [catalogue, setCatalogue] = useState<BoardCatalogueSettings>(defaultBoardCatalogue());

  useEffect(() => {
    loadBoardCatalogue(getDb())
      .then(setCatalogue)
      // The prerendered defaults stay on screen. A failed settings read is not a reason to
      // show a customer an empty page.
      .catch(() => {});
  }, []);

  const boards = publishedBoards(catalogue);
  if (boards.length === 0) return null;

  return (
    <section className="mx-auto max-w-7xl px-5 py-20 sm:px-8 lg:py-28">
      <SectionHeading
        eyebrow="Materials"
        title="The boards we cut"
        intro="Everything below is cut, edged and finished on our own line. Bring a cutting list and we will work out the sheets — or ask us which board suits the job, which is a conversation we have every day."
      />

      <div className="mt-14 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {boards.map(({ type, entry }, i) => (
          <Reveal key={type} delay={(i % 3) * 0.08}>
            <article className="glass group flex h-full flex-col overflow-hidden rounded-3xl transition-all duration-400 hover:-translate-y-1 hover:shadow-glow">
              <div className="relative aspect-[5/3] overflow-hidden">
                {/* Unoptimised: the source may be an admin-supplied external URL, which the
                    Next image optimiser would require whitelisted per host — and a materials
                    photo that 404s because someone changed hosts is a worse outcome than an
                    unoptimised one. */}
                <Image
                  src={entry.imageUrl}
                  alt={`${entry.displayName} board`}
                  fill
                  sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"
                  className="object-cover transition-transform duration-700 group-hover:scale-105"
                  unoptimized
                />
              </div>

              <div className="flex flex-1 flex-col p-6">
                <h3 className="font-display text-xl text-cream-50">{entry.displayName}</h3>
                {entry.blurb && (
                  <p className="mt-2.5 flex-1 text-sm leading-relaxed text-cream-400">
                    {entry.blurb}
                  </p>
                )}
                {(entry.sheetSize || entry.thickness) && (
                  <p className="mt-4 flex flex-wrap gap-x-4 gap-y-1 text-xs text-brass-300/90">
                    {entry.sheetSize && <span>{entry.sheetSize}</span>}
                    {entry.thickness && <span>{entry.thickness}</span>}
                  </p>
                )}
              </div>
            </article>
          </Reveal>
        ))}
      </div>

      <Reveal className="mt-12 text-center">
        <Link
          href="/cutting-list/"
          className="inline-flex items-center gap-2 rounded-full bg-brass-500 px-7 py-3.5 font-medium text-night-950 transition-all duration-300 hover:bg-brass-400"
        >
          Build a cutting list <ArrowRight size={17} />
        </Link>
        <p className="mt-4 text-sm text-cream-500">
          Tell us the panels and we will work out the boards and the banding.
        </p>
      </Reveal>
    </section>
  );
}

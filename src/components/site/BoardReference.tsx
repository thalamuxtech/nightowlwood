"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import { ChevronDown } from "lucide-react";
import { getDb } from "@/lib/firebase";
import { BOARD_TYPE_LABELS, CE_RATED_BOARD_TYPES } from "@/lib/erp/enums";
import {
  defaultBoardCatalogue,
  loadBoardCatalogue,
  type BoardCatalogueSettings,
} from "@/lib/erp/boardCatalogue";

/**
 * A visual key for the board picker on the cutting-list form.
 *
 * Scoped to `CE_RATED_BOARD_TYPES` — the boards the form actually offers — rather than the whole
 * catalogue, because a reference strip showing materials that are not in the dropdown below
 * invites a customer to ask for one and then not find it.
 *
 * Collapsed by default. It is a reference, not the task: someone who already knows what Bangaji
 * looks like should not have to scroll past six pictures to reach the form. Opens in place, so
 * a customer mid-list can check one and carry on.
 */
export function BoardReference() {
  const [catalogue, setCatalogue] = useState<BoardCatalogueSettings>(defaultBoardCatalogue());
  const [open, setOpen] = useState(false);

  useEffect(() => {
    loadBoardCatalogue(getDb())
      .then(setCatalogue)
      // Falls back to the swatches and seed text that ship with the app.
      .catch(() => {});
  }, []);

  // Only the boards the picker offers, and only those the workshop is showing.
  const boards = CE_RATED_BOARD_TYPES.map((type) => ({
    type,
    entry: catalogue.entries[type],
  })).filter((b) => b.entry?.published);

  if (boards.length === 0) return null;

  return (
    <div className="mt-4 rounded-2xl border border-night-700/60 bg-night-900/30">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full cursor-pointer items-center justify-between gap-3 p-4 text-left"
      >
        <span>
          <span className="block text-sm text-cream-200">
            Not sure which board? Have a look
          </span>
          <span className="mt-0.5 block text-xs text-cream-500">
            {boards.length} boards we cut, with what each is usually used for
          </span>
        </span>
        <ChevronDown
          size={18}
          className={`shrink-0 text-cream-500 transition-transform duration-300 ${
            open ? "rotate-180" : ""
          }`}
        />
      </button>

      {open && (
        <div className="grid gap-3 border-t border-night-700/60 p-4 sm:grid-cols-2 lg:grid-cols-3">
          {boards.map(({ type, entry }) => (
            <figure
              key={type}
              className="overflow-hidden rounded-xl border border-night-700/60 bg-night-950/40"
            >
              <div className="relative aspect-[5/3]">
                {/* Unoptimised: the image may be an admin-supplied external URL, which the
                    optimiser would need whitelisted per host. */}
                <Image
                  src={entry!.imageUrl}
                  alt={`${entry!.displayName} board`}
                  fill
                  sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"
                  className="object-cover"
                  unoptimized
                />
              </div>
              <figcaption className="p-3">
                <p className="text-sm text-cream-100">{entry!.displayName}</p>
                {/* The workshop's own label too, when it differs — a customer told "Bangaji" on
                    site needs to recognise it in the dropdown, which uses this name. */}
                {entry!.displayName !== BOARD_TYPE_LABELS[type] && (
                  <p className="mt-0.5 text-xs text-brass-300/80">{BOARD_TYPE_LABELS[type]}</p>
                )}
                {entry!.blurb && (
                  <p className="mt-1.5 text-xs leading-relaxed text-cream-500">{entry!.blurb}</p>
                )}
                {entry!.sheetSize && (
                  <p className="mt-1.5 text-xs text-cream-600">{entry!.sheetSize}</p>
                )}
              </figcaption>
            </figure>
          ))}
        </div>
      )}
    </div>
  );
}

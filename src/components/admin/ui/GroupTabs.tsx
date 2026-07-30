"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { motion } from "framer-motion";
import type { LucideIcon } from "lucide-react";

/**
 * Tab strip for the screens within one nav group.
 *
 * The sidebar names the area, the tabs move between screens inside it. That
 * keeps a related set one click apart instead of sending the eye back to a
 * seventeen-item sidebar for every switch.
 *
 * The active tab is marked with a sliding underline driven by framer-motion's
 * shared layout, so the movement between tabs reads as one element rather than
 * two separate state changes. `layoutId` is scoped per group, otherwise two
 * groups mounted in the same tree would animate into each other.
 */

export interface GroupTab {
  href: string;
  label: string;
  icon: LucideIcon;
}

export function GroupTabs({
  groupKey,
  title,
  tabs,
}: {
  /** Distinct per group so the underline animation stays within it. */
  groupKey: string;
  title: string;
  tabs: GroupTab[];
}) {
  const pathname = usePathname();

  // A single-tab group is a heading with no choice in it, which is noise.
  if (tabs.length < 2) return null;

  return (
    <div className="mb-8 print:hidden">
      <p className="text-[0.65rem] font-medium uppercase tracking-[0.22em] text-cream-600">
        {title}
      </p>

      {/* Horizontal scroll rather than wrap: on a narrow screen a wrapped tab
          strip pushes the page content down unpredictably as the label lengths
          change, whereas a scrolling strip keeps a fixed height. */}
      <nav
        aria-label={`${title} sections`}
        className="mt-2.5 flex gap-1 overflow-x-auto border-b border-night-700/60 pb-0 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {tabs.map(({ href, label, icon: Icon }) => {
          const active = pathname === href;
          return (
            <Link
              key={href}
              href={href}
              aria-current={active ? "page" : undefined}
              className={`relative flex shrink-0 items-center gap-2 whitespace-nowrap px-4 py-2.5 text-sm font-medium transition-colors duration-200 ${
                active
                  ? "text-brass-300"
                  : "text-cream-400 hover:text-cream-100"
              }`}
            >
              <Icon size={15} className="shrink-0" />
              {label}
              {active && (
                <motion.span
                  layoutId={`tab-underline-${groupKey}`}
                  aria-hidden
                  className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-brass-500"
                  transition={{ type: "spring", stiffness: 380, damping: 30 }}
                />
              )}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}

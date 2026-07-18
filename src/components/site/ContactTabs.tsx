"use client";

import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { FileText, MessagesSquare } from "lucide-react";
import { QuoteForm } from "./QuoteForm";
import { GeneralContactForm } from "./GeneralContactForm";

const TABS = [
  { key: "quote", label: "Request a Quote", icon: FileText },
  { key: "message", label: "General Message", icon: MessagesSquare },
] as const;

type TabKey = (typeof TABS)[number]["key"];

/** Animated tab switcher between the quote form and general contact form. */
export function ContactTabs() {
  const [tab, setTab] = useState<TabKey>("quote");

  return (
    <div>
      <div
        role="tablist"
        aria-label="Contact form type"
        className="relative inline-flex rounded-full border border-night-600 bg-night-800/60 p-1.5"
      >
        {TABS.map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            role="tab"
            aria-selected={tab === key}
            onClick={() => setTab(key)}
            className={`relative z-10 flex cursor-pointer items-center gap-2 rounded-full px-5 py-2.5 text-sm font-medium transition-colors duration-300 ${
              tab === key ? "text-night-950" : "text-cream-300 hover:text-cream-100"
            }`}
          >
            {tab === key && (
              <motion.span
                layoutId="contact-tab-pill"
                transition={{ type: "spring", stiffness: 380, damping: 32 }}
                className="absolute inset-0 -z-10 rounded-full bg-brass-500"
              />
            )}
            <Icon size={16} /> {label}
          </button>
        ))}
      </div>

      <div className="mt-8">
        <AnimatePresence mode="wait">
          <motion.div
            key={tab}
            initial={{ opacity: 0, y: 18 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -12 }}
            transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
          >
            {tab === "quote" ? <QuoteForm /> : <GeneralContactForm />}
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}

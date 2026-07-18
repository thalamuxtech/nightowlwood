"use client";

import { motion } from "framer-motion";
import { MessageCircle } from "lucide-react";
import { SITE } from "@/lib/content";

/** Floating WhatsApp action button, present on all public pages. */
export function WhatsAppFloat() {
  return (
    <motion.a
      href={SITE.whatsappHref}
      target="_blank"
      rel="noopener noreferrer"
      aria-label="Chat with Nightowl Woodworks on WhatsApp"
      initial={{ scale: 0, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      transition={{ delay: 1.4, type: "spring", stiffness: 260, damping: 18 }}
      whileHover={{ scale: 1.08 }}
      whileTap={{ scale: 0.94 }}
      className="fixed bottom-6 right-6 z-40 flex h-14 w-14 items-center justify-center rounded-full bg-[#25D366] text-night-950 shadow-card"
    >
      <MessageCircle size={26} strokeWidth={2.2} />
      <span className="absolute inset-0 -z-10 animate-ping rounded-full bg-[#25D366]/40 [animation-duration:2.5s]" />
    </motion.a>
  );
}

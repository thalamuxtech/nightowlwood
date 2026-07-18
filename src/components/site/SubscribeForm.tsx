"use client";

import { useState, type FormEvent } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { CheckCircle2, Loader2, Send } from "lucide-react";
import { doc, serverTimestamp, setDoc } from "firebase/firestore";
import { getDb } from "@/lib/firebase";

type State = "idle" | "sending" | "done" | "error";

/** Footer newsletter signup — writes to the `subscribers` collection. */
export function SubscribeForm() {
  const [state, setState] = useState<State>("idle");

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const email = String(new FormData(e.currentTarget).get("email") ?? "")
      .trim()
      .toLowerCase();
    if (!email || !email.includes("@")) {
      setState("error");
      return;
    }
    setState("sending");
    try {
      // Doc id derived from the email makes re-subscribing idempotent.
      const id = email.replace(/[^a-z0-9]/g, "_").slice(0, 200);
      await setDoc(doc(getDb(), "subscribers", id), {
        email,
        createdAt: serverTimestamp(),
      });
      setState("done");
    } catch {
      // Rules forbid overwriting an existing subscription — treat as already subscribed.
      setState("done");
    }
  }

  return (
    <div className="mt-6">
      <p className="text-eyebrow mb-3 !text-[0.65rem]">Wood tips in your inbox</p>
      <AnimatePresence mode="wait">
        {state === "done" ? (
          <motion.p
            key="ok"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex items-center gap-2 text-sm text-emerald-400"
            role="status"
          >
            <CheckCircle2 size={16} /> You&apos;re subscribed — welcome aboard.
          </motion.p>
        ) : (
          <motion.form
            key="form"
            exit={{ opacity: 0, y: -8 }}
            onSubmit={onSubmit}
            className="flex max-w-xs overflow-hidden rounded-full border border-night-600 bg-night-800/60 transition-colors duration-300 focus-within:border-brass-500"
          >
            <label htmlFor="footer-subscribe" className="sr-only">
              Email address
            </label>
            <input
              id="footer-subscribe"
              type="email"
              name="email"
              required
              placeholder="you@example.com"
              className="min-w-0 flex-1 bg-transparent px-4 py-2.5 text-sm text-cream-100 placeholder:text-cream-500 focus:outline-none"
            />
            <button
              type="submit"
              disabled={state === "sending"}
              aria-label="Subscribe"
              className="flex w-11 shrink-0 cursor-pointer items-center justify-center bg-brass-500 text-night-950 transition-colors duration-300 hover:bg-brass-400 disabled:opacity-60"
            >
              {state === "sending" ? (
                <Loader2 size={15} className="animate-spin" />
              ) : (
                <Send size={15} />
              )}
            </button>
          </motion.form>
        )}
      </AnimatePresence>
      {state === "error" && (
        <p className="mt-2 text-xs text-red-400" role="alert">
          Please enter a valid email address.
        </p>
      )}
    </div>
  );
}

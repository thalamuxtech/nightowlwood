"use client";

import { useState, type FormEvent } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { CheckCircle2, Loader2, Send } from "lucide-react";
import { addDoc, collection, serverTimestamp } from "firebase/firestore";
import { getDb } from "@/lib/firebase";
import { BUDGET_RANGES, PROJECT_TYPES } from "@/lib/content";
import { Reveal } from "@/components/motion/Reveal";

type FormState = "idle" | "sending" | "sent" | "error";

const inputCls =
  "w-full rounded-xl border border-night-600 bg-night-800/60 px-5 py-3.5 text-cream-100 placeholder:text-cream-500 transition-colors duration-300 focus:border-brass-500 focus:outline-none";

export function QuoteForm() {
  const [state, setState] = useState<FormState>("idle");
  const [error, setError] = useState("");

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const data = new FormData(form);

    // Honeypot — bots fill hidden fields
    if (data.get("company")) return;

    const payload = {
      name: String(data.get("name") ?? "").trim(),
      email: String(data.get("email") ?? "").trim(),
      phone: String(data.get("phone") ?? "").trim(),
      projectType: String(data.get("projectType") ?? ""),
      budget: String(data.get("budget") ?? ""),
      message: String(data.get("message") ?? "").trim(),
      status: "new",
      createdAt: serverTimestamp(),
    };

    if (!payload.name || !payload.email || !payload.message) {
      setError("Please fill in your name, email, and project details.");
      setState("error");
      return;
    }

    setState("sending");
    setError("");
    try {
      await addDoc(collection(getDb(), "inquiries"), payload);
      setState("sent");
      form.reset();
    } catch {
      setError("Something went wrong sending your request. Please try again or reach us on WhatsApp.");
      setState("error");
    }
  }

  return (
    <Reveal>
      <AnimatePresence mode="wait">
        {state === "sent" ? (
          <motion.div
            key="success"
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="flex min-h-[420px] flex-col items-center justify-center rounded-2xl border border-brass-500/40 bg-night-800/50 p-10 text-center"
            role="status"
          >
            <motion.span
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              transition={{ type: "spring", stiffness: 220, damping: 14, delay: 0.15 }}
            >
              <CheckCircle2 size={64} className="text-brass-400" />
            </motion.span>
            <h2 className="mt-6 font-display text-3xl text-cream-50">Request received</h2>
            <p className="mt-3 max-w-md text-cream-300">
              Thank you — your project details are with our team. We&apos;ll get back to
              you shortly, usually within one business day.
            </p>
            <button
              onClick={() => setState("idle")}
              className="mt-8 cursor-pointer rounded-full border border-night-600 px-6 py-3 text-sm text-cream-200 transition-colors duration-300 hover:border-brass-500 hover:text-brass-300"
            >
              Send another request
            </button>
          </motion.div>
        ) : (
          <motion.form
            key="form"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            onSubmit={onSubmit}
            className="glass rounded-3xl p-7 sm:p-10"
            noValidate
          >
            <div className="grid gap-6 sm:grid-cols-2">
              <div>
                <label htmlFor="name" className="mb-2 block text-sm font-medium text-cream-200">
                  Full name <span className="text-brass-400">*</span>
                </label>
                <input id="name" name="name" type="text" required autoComplete="name" className={inputCls} placeholder="Your name" />
              </div>
              <div>
                <label htmlFor="email" className="mb-2 block text-sm font-medium text-cream-200">
                  Email <span className="text-brass-400">*</span>
                </label>
                <input id="email" name="email" type="email" required autoComplete="email" className={inputCls} placeholder="you@example.com" />
              </div>
              <div>
                <label htmlFor="phone" className="mb-2 block text-sm font-medium text-cream-200">
                  Phone / WhatsApp
                </label>
                <input id="phone" name="phone" type="tel" autoComplete="tel" className={inputCls} placeholder="+234 ..." />
              </div>
              <div>
                <label htmlFor="projectType" className="mb-2 block text-sm font-medium text-cream-200">
                  Project type
                </label>
                <select id="projectType" name="projectType" className={`${inputCls} cursor-pointer`} defaultValue={PROJECT_TYPES[0]}>
                  {PROJECT_TYPES.map((t) => (
                    <option key={t} value={t} className="bg-night-800">
                      {t}
                    </option>
                  ))}
                </select>
              </div>
              <div className="sm:col-span-2">
                <label htmlFor="budget" className="mb-2 block text-sm font-medium text-cream-200">
                  Budget range
                </label>
                <select id="budget" name="budget" className={`${inputCls} cursor-pointer`} defaultValue={BUDGET_RANGES[BUDGET_RANGES.length - 1]}>
                  {BUDGET_RANGES.map((b) => (
                    <option key={b} value={b} className="bg-night-800">
                      {b}
                    </option>
                  ))}
                </select>
              </div>
              <div className="sm:col-span-2">
                <label htmlFor="message" className="mb-2 block text-sm font-medium text-cream-200">
                  Project details <span className="text-brass-400">*</span>
                </label>
                <textarea
                  id="message"
                  name="message"
                  required
                  rows={6}
                  className={inputCls}
                  placeholder="Dimensions, materials, quantities, timeline — or paste your cutting list."
                />
              </div>
              {/* Honeypot */}
              <input type="text" name="company" tabIndex={-1} autoComplete="off" className="hidden" aria-hidden="true" />
            </div>

            {state === "error" && (
              <p role="alert" className="mt-5 rounded-xl border border-red-500/40 bg-red-950/40 px-5 py-3 text-sm text-red-300">
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={state === "sending"}
              className="mt-8 inline-flex w-full cursor-pointer items-center justify-center gap-2.5 rounded-full bg-brass-500 px-8 py-4 font-medium text-night-950 transition-all duration-300 hover:bg-brass-400 hover:shadow-glow disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
            >
              {state === "sending" ? (
                <>
                  <Loader2 size={18} className="animate-spin" /> Sending…
                </>
              ) : (
                <>
                  <Send size={18} /> Request a quote
                </>
              )}
            </button>
          </motion.form>
        )}
      </AnimatePresence>
    </Reveal>
  );
}

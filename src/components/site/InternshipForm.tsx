"use client";

import { useState, type FormEvent } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { CheckCircle2, Loader2, Send } from "lucide-react";
import { addDoc, collection, serverTimestamp } from "firebase/firestore";
import { getDb } from "@/lib/firebase";
import { INTERN_AREAS } from "@/lib/content";

type FormState = "idle" | "sending" | "sent" | "error";

const inputCls =
  "w-full rounded-xl border border-night-600 bg-night-800/60 px-5 py-3.5 text-cream-100 placeholder:text-cream-500 transition-colors duration-300 focus:border-brass-500 focus:outline-none";

/** Internship application — writes to the `internApplications` collection. */
export function InternshipForm() {
  const [state, setState] = useState<FormState>("idle");
  const [error, setError] = useState("");

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const data = new FormData(form);
    if (data.get("company")) return; // honeypot

    const payload = {
      name: String(data.get("name") ?? "").trim(),
      email: String(data.get("email") ?? "").trim(),
      phone: String(data.get("phone") ?? "").trim(),
      area: String(data.get("area") ?? INTERN_AREAS[0]),
      background: String(data.get("background") ?? "").trim(),
      portfolio: String(data.get("portfolio") ?? "").trim(),
      message: String(data.get("message") ?? "").trim(),
      status: "new",
      createdAt: serverTimestamp(),
    };
    if (!payload.name || !payload.email || !payload.message) {
      setError("Please fill in your name, email, and motivation.");
      setState("error");
      return;
    }
    setState("sending");
    setError("");
    try {
      await addDoc(collection(getDb(), "internApplications"), payload);
      setState("sent");
      form.reset();
    } catch {
      setError("Something went wrong sending your application. Please try again.");
      setState("error");
    }
  }

  if (state === "sent") {
    return (
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className="glass flex min-h-[420px] flex-col items-center justify-center rounded-3xl !border-brass-500/40 p-10 text-center"
        role="status"
      >
        <motion.span
          initial={{ scale: 0, rotate: -12 }}
          animate={{ scale: 1, rotate: 0 }}
          transition={{ type: "spring", stiffness: 220, damping: 14, delay: 0.15 }}
        >
          <CheckCircle2 size={64} className="text-brass-400" />
        </motion.span>
        <h2 className="mt-6 font-display text-3xl text-cream-50">Application received</h2>
        <p className="mt-3 max-w-md text-cream-300">
          Thank you for applying. We read every application personally and will reach
          out if there&apos;s a fit.
        </p>
      </motion.div>
    );
  }

  return (
    <motion.form
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      onSubmit={onSubmit}
      className="glass rounded-3xl p-7 sm:p-10"
      noValidate
    >
      <div className="grid gap-6 sm:grid-cols-2">
        <div>
          <label htmlFor="in-name" className="mb-2 block text-sm font-medium text-cream-200">
            Full name <span className="text-brass-400">*</span>
          </label>
          <input id="in-name" name="name" type="text" required autoComplete="name" className={inputCls} placeholder="Your name" />
        </div>
        <div>
          <label htmlFor="in-email" className="mb-2 block text-sm font-medium text-cream-200">
            Email <span className="text-brass-400">*</span>
          </label>
          <input id="in-email" name="email" type="email" required autoComplete="email" className={inputCls} placeholder="you@example.com" />
        </div>
        <div>
          <label htmlFor="in-phone" className="mb-2 block text-sm font-medium text-cream-200">
            Phone / WhatsApp
          </label>
          <input id="in-phone" name="phone" type="tel" autoComplete="tel" className={inputCls} placeholder="+234 ..." />
        </div>
        <div>
          <label htmlFor="in-area" className="mb-2 block text-sm font-medium text-cream-200">
            Area of interest
          </label>
          <select id="in-area" name="area" className={`${inputCls} cursor-pointer`} defaultValue={INTERN_AREAS[0]}>
            {INTERN_AREAS.map((a) => (
              <option key={a} value={a} className="bg-night-800">
                {a}
              </option>
            ))}
          </select>
        </div>
        <div className="sm:col-span-2">
          <label htmlFor="in-background" className="mb-2 block text-sm font-medium text-cream-200">
            Education / experience
          </label>
          <textarea id="in-background" name="background" rows={3} className={inputCls} placeholder="School, training, or any hands-on experience. None required." />
        </div>
        <div className="sm:col-span-2">
          <label htmlFor="in-portfolio" className="mb-2 block text-sm font-medium text-cream-200">
            Portfolio / CV link
          </label>
          <input id="in-portfolio" name="portfolio" type="url" className={inputCls} placeholder="Google Drive, LinkedIn, Instagram…" />
        </div>
        <div className="sm:col-span-2">
          <label htmlFor="in-message" className="mb-2 block text-sm font-medium text-cream-200">
            Why do you want to join? <span className="text-brass-400">*</span>
          </label>
          <textarea id="in-message" name="message" required rows={5} className={inputCls} placeholder="Tell us what you want to learn and why woodworking." />
        </div>
        <input type="text" name="company" tabIndex={-1} autoComplete="off" className="hidden" aria-hidden="true" />
      </div>

      <AnimatePresence>
        {state === "error" && (
          <motion.p
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            role="alert"
            className="mt-5 rounded-xl border border-red-500/40 bg-red-950/40 px-5 py-3 text-sm text-red-300"
          >
            {error}
          </motion.p>
        )}
      </AnimatePresence>

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
            <Send size={18} /> Submit application
          </>
        )}
      </button>
    </motion.form>
  );
}

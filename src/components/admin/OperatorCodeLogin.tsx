"use client";

import { useState } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import { getFunctions, httpsCallable } from "firebase/functions";
import { signInWithCustomToken } from "firebase/auth";
import { ArrowRight, ShieldAlert } from "lucide-react";
import { getFirebaseApp, getFirebaseAuth } from "@/lib/firebase";
import { OwlMark } from "@/components/site/OwlMark";

const REGION = "europe-west1";

/**
 * Work-log sign-in for a workshop operator.
 *
 * A code rather than an email and password. The people who use this are on the
 * factory floor, often on a shared phone, and an email login is a barrier that
 * stops the work being logged at all — which costs them their wages, since the log
 * is what the wage run is calculated from.
 *
 * The code buys an ordinary Firebase session by way of a custom token, so nothing
 * downstream is special-cased: the same rules apply, and the role is `operator`
 * exactly as it would be for an email login. See functions/src/operatorAccess.ts.
 */
export function OperatorCodeLogin({ onBack }: { onBack: () => void }) {
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit() {
    const entered = code.trim();
    if (entered.length < 6) {
      setError("Enter the code from the office.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const fn = httpsCallable<{ code: string }, { token: string; staffName: string }>(
        getFunctions(getFirebaseApp(), REGION),
        "redeemOperatorCode"
      );
      const res = await fn({ code: entered });
      // Signing in flips the auth state, and the shell swaps to the operator view
      // on its own. Nothing to navigate to.
      await signInWithCustomToken(getFirebaseAuth(), res.data.token);
    } catch (e: unknown) {
      const message =
        e && typeof e === "object" && "message" in e
          ? String((e as { message: unknown }).message)
          : "";
      setError(
        message && !message.toLowerCase().includes("internal")
          ? message
          : "That code did not work. Check it with the office."
      );
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-svh items-center justify-center bg-night-950 px-5">
      <motion.div
        initial={{ opacity: 0, y: 24 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
        className="w-full max-w-sm"
      >
        <div className="flex flex-col items-center text-brass-400">
          <Link href="/" aria-label="Back to the Nightowl Woodworks website">
            <OwlMark size={110} />
          </Link>
          <h1 className="mt-4 font-display text-2xl text-cream-100">Work log</h1>
          <p className="mt-1 text-center text-sm text-cream-500">
            Enter the code you were given to record your work
          </p>
        </div>

        <div className="mt-8">
          <label htmlFor="op-code" className="mb-1.5 block text-sm text-cream-300">
            Access code
          </label>
          <input
            id="op-code"
            // Not a password field: the point is to be able to check what was typed
            // against a slip of paper, and there is nobody to shoulder-surf a code
            // that only reaches one person's own work log.
            type="text"
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            onKeyDown={(e) => {
              if (e.key === "Enter") submit();
            }}
            autoFocus
            autoCapitalize="characters"
            autoCorrect="off"
            spellCheck={false}
            maxLength={12}
            placeholder="ABCD2345"
            className="w-full rounded-xl border border-night-600 bg-night-800/60 px-4 py-3.5 text-center font-display text-2xl tracking-[0.3em] text-cream-100 placeholder:text-cream-700 focus:border-brass-500 focus:outline-none"
          />

          {error && (
            <p
              role="alert"
              className="mt-4 flex items-start gap-2 text-sm text-red-400"
            >
              <ShieldAlert size={16} className="mt-0.5 shrink-0" /> {error}
            </p>
          )}

          <button
            type="button"
            onClick={submit}
            disabled={busy}
            className="mt-5 flex w-full cursor-pointer items-center justify-center gap-2 rounded-xl bg-brass-500 py-3.5 font-medium text-night-950 transition-all duration-300 hover:bg-brass-400 disabled:opacity-60"
          >
            {busy ? "Checking…" : "Open my work log"}
            {!busy && <ArrowRight size={16} />}
          </button>

          <p className="mt-6 text-center text-xs text-cream-600">
            Lost your code? Ask the office for a new one — the old one stops working
            as soon as a new one is issued.
          </p>

          <button
            type="button"
            onClick={onBack}
            className="mt-6 w-full cursor-pointer text-center text-xs text-cream-500 transition-colors hover:text-brass-300"
          >
            Staff sign-in with email instead
          </button>
        </div>
      </motion.div>
    </div>
  );
}

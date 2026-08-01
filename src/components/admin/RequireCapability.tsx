"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { Loader2, ShieldAlert } from "lucide-react";
import type { Capability } from "@/lib/erp/permissions";
import { useErpSession } from "@/components/admin/ErpAuthProvider";

/**
 * Route guard: renders a screen only for someone who holds the capability.
 *
 * The sidebar hides links a role cannot use, but hiding a link is not access
 * control — the URL is still there to be typed, bookmarked, or followed from an
 * old tab. Every admin route wraps its screen in this, so what a person can reach
 * matches what they were granted rather than what they can see.
 *
 * Placed in the route's `page.tsx` rather than inside each screen. One guard per
 * route, next to the path it protects, and a screen stays a screen: it does not
 * have to know who is allowed to open it.
 *
 * This is presentation, not enforcement. Firestore rules are what actually stop a
 * read; this stops the screen mounting, subscribing and showing a permission error
 * where a plain explanation belongs.
 */
export function RequireCapability({
  capability,
  children,
}: {
  /** Held by the role, or granted to it by an admin in Settings → Roles. */
  capability: Capability;
  children: ReactNode;
}) {
  const { can, ready } = useErpSession();

  // Nothing is rendered until the role resolves. Showing the screen first and
  // removing it a moment later would flash data at someone who cannot have it,
  // and the subscriptions inside would already have been issued.
  if (!ready) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center">
        <Loader2 className="animate-spin text-brass-400" size={28} aria-label="Loading" />
      </div>
    );
  }

  if (!can(capability)) return <NotAuthorised />;

  return <>{children}</>;
}

/**
 * Shown in place of a screen the person cannot open.
 *
 * Deliberately says nothing about what the screen contains, or that it exists at
 * all beyond the URL they already typed. It offers the way back rather than
 * leaving someone on a dead end.
 */
function NotAuthorised() {
  return (
    <div className="mx-auto max-w-lg rounded-3xl border border-night-700/60 bg-night-900/40 p-10 text-center">
      <ShieldAlert className="mx-auto text-cream-500" size={30} />
      <h1 className="mt-4 font-display text-xl text-cream-100">Not available</h1>
      <p className="mx-auto mt-2 max-w-sm text-sm leading-relaxed text-cream-400">
        This part of the system is not part of your access. If you need it, ask an
        administrator to grant it.
      </p>
      <Link href="/admin/" className="mt-6 inline-block text-sm text-brass-300 hover:text-brass-200">
        Back to the dashboard
      </Link>
    </div>
  );
}

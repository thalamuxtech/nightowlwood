"use client";

import { Eye, ShieldCheck } from "lucide-react";
import { ROLES, ROLE_LABELS, type Role } from "@/lib/erp/enums";
import { useErpSession } from "@/components/admin/ErpAuthProvider";

/**
 * Lets a super admin work inside another role's interface, and come back.
 *
 * The switch is real, not a mock-up: the sidebar, the screens and the buttons are the ones that
 * role gets, and anything done while switched genuinely happens. What does *not* change is who
 * the database thinks is asking — the login keeps its own grants throughout, so a super admin
 * who switches to operator to fix something can still fix it rather than discovering halfway
 * that the interface has taken away the authority they came in with.
 *
 * The audit trail is the deliberate exception. Every write records the super admin as the author
 * and notes which role they were acting as, because an entry claiming an operator deleted a wage
 * run when a super admin did would corrupt the one record that exists to answer who changed a
 * figure. Real work, honest attribution.
 */
export function RoleSwitcher() {
  const session = useErpSession();

  // Checked against the real role: switching must never be a route to switching onward.
  if (session.realRole !== "super_admin") return null;

  const switchable = ROLES.filter((r): r is Role => r !== "super_admin");

  return (
    <div className="border-t border-night-700/60 px-4 py-4">
      <p className="flex items-center gap-1.5 text-xs uppercase tracking-wide text-cream-600">
        <Eye size={12} /> Work as
      </p>
      <div className="mt-2.5 flex flex-wrap gap-1.5">
        <button
          type="button"
          onClick={() => session.actAs(null)}
          aria-pressed={session.actingAs === null}
          className={`cursor-pointer rounded-lg border px-2.5 py-1.5 text-xs transition-all duration-300 ${
            session.actingAs === null
              ? "border-brass-500/60 bg-brass-500/10 text-brass-200"
              : "border-night-600 text-cream-400 hover:border-brass-500/50 hover:text-brass-300"
          }`}
        >
          Myself
        </button>
        {switchable.map((r) => (
          <button
            key={r}
            type="button"
            onClick={() => session.actAs(r)}
            aria-pressed={session.actingAs === r}
            className={`cursor-pointer rounded-lg border px-2.5 py-1.5 text-xs transition-all duration-300 ${
              session.actingAs === r
                ? "border-brass-500/60 bg-brass-500/10 text-brass-200"
                : "border-night-600 text-cream-400 hover:border-brass-500/50 hover:text-brass-300"
            }`}
          >
            {ROLE_LABELS[r]}
          </button>
        ))}
      </div>
      <p className="mt-2 text-[11px] leading-relaxed text-cream-600">
        You keep your own access. Everything you do is recorded under your name.
      </p>
    </div>
  );
}

/**
 * The reminder that the interface is not the one this login normally sees.
 *
 * Deliberately hard to miss and always dismissible in one click. A super admin who forgets they
 * are switched would read a narrowed screen as the system having lost data — the banner exists
 * to stop that being a support call about a bug that is not there.
 */
export function ActingAsBanner() {
  const session = useErpSession();
  if (!session.actingAs) return null;

  return (
    <div
      role="status"
      className="flex flex-wrap items-center justify-between gap-3 border-b border-brass-500/40 bg-brass-500/10 px-5 py-2.5"
    >
      <p className="flex items-center gap-2 text-sm text-brass-100">
        <ShieldCheck size={15} className="shrink-0 text-brass-300" />
        <span>
          Working as <strong className="font-medium">{ROLE_LABELS[session.actingAs]}</strong>.
          <span className="ml-1.5 text-brass-200/80">
            Your access is unchanged and your actions are logged under your own name.
          </span>
        </span>
      </p>
      <button
        type="button"
        onClick={() => session.actAs(null)}
        className="cursor-pointer whitespace-nowrap rounded-lg border border-brass-500/50 px-3 py-1.5 text-xs text-brass-100 transition-all duration-300 hover:bg-brass-500/20"
      >
        Back to Super Admin
      </button>
    </div>
  );
}

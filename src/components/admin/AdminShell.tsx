"use client";

import { createContext, useContext, useEffect, useState, type ReactNode, type FormEvent } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import {
  ClipboardList,
  Eye,
  EyeOff,
  GalleryHorizontalEnd,
  HandCoins,
  Inbox,
  LayoutDashboard,
  Loader2,
  LogOut,
  Newspaper,
  PanelLeftClose,
  PanelLeftOpen,
  Settings,
  ShieldAlert,
  ShieldCheck,
  Users,
  Wallet,
} from "lucide-react";
import { onAuthStateChanged, signInWithEmailAndPassword, signOut, type User } from "firebase/auth";
import { getFirebaseAuth } from "@/lib/firebase";
import { OwlMark } from "@/components/site/OwlMark";
import { useErpSession } from "@/components/admin/ErpAuthProvider";
import type { Capability } from "@/lib/erp/permissions";
import { ROLE_LABELS } from "@/lib/erp/enums";

const AdminUserContext = createContext<User | null>(null);
export const useAdminUser = () => useContext(AdminUserContext);

/**
 * Nav entries. `capability` hides a link from roles that cannot use the screen;
 * entries without one are visible to any signed-in staff member. This is
 * presentation only, the screens and Firestore rules enforce access.
 */
interface NavItem {
  href: string;
  label: string;
  icon: typeof LayoutDashboard;
  capability?: Capability;
}

const NAV: NavItem[] = [
  { href: "/admin/", label: "Overview", icon: LayoutDashboard },
  { href: "/admin/jobs/", label: "Service Jobs", icon: ClipboardList, capability: "job.view" },
  { href: "/admin/submissions/", label: "Submissions", icon: Inbox, capability: "customer.view" },
  { href: "/admin/blog/", label: "Blog", icon: Newspaper, capability: "customer.edit" },
  {
    href: "/admin/work/",
    label: "Work Gallery",
    icon: GalleryHorizontalEnd,
    capability: "customer.edit",
  },
  { href: "/admin/worklog/", label: "Work Log", icon: ClipboardList, capability: "worklog.create" },
  { href: "/admin/payroll/", label: "Payroll", icon: Wallet, capability: "wage.run" },
  { href: "/admin/loans/", label: "Loans & Advances", icon: HandCoins, capability: "loan.request" },
  { href: "/admin/users/", label: "Users & Roles", icon: ShieldCheck, capability: "user.manage" },
  { href: "/admin/settings/", label: "Settings", icon: Settings, capability: "settings.change" },
];

export function AdminShell({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    return onAuthStateChanged(getFirebaseAuth(), (u) => {
      setUser(u);
      setReady(true);
    });
  }, []);

  if (!ready) {
    return (
      <div className="flex min-h-svh items-center justify-center bg-night-950">
        <Loader2 className="animate-spin text-brass-400" size={36} aria-label="Loading" />
      </div>
    );
  }

  if (!user) return <LoginScreen />;

  return (
    <AdminUserContext.Provider value={user}>
      <div className="flex min-h-svh bg-night-950">
        <Sidebar email={user.email ?? ""} />
        <main className="min-w-0 flex-1 px-5 pb-16 pt-24 sm:px-8 lg:pt-10">
          <NoRoleNotice email={user.email ?? ""} />
          {children}
        </main>
      </div>
    </AdminUserContext.Provider>
  );
}

/**
 * Explains a bare sidebar.
 *
 * Without this, a missing or misshapen `users/{uid}` document just looks like a
 * broken dashboard, the nav silently filters down to the one unrestricted link
 * and nothing says why.
 */
function NoRoleNotice({ email }: { email: string }) {
  const { ready, role, user } = useErpSession();
  if (!ready || role) return null;

  return (
    <div
      role="alert"
      className="mb-8 rounded-2xl border border-amber-500/40 bg-amber-500/5 p-5 text-sm"
    >
      <p className="flex items-center gap-2 font-medium text-amber-300">
        <ShieldAlert size={16} /> No staff role found for this account
      </p>
      <p className="mt-2 leading-relaxed text-cream-400">
        Signing in proves who you are; a <code className="text-brass-300">users</code>{" "}
        document is what grants access. Create one in Firestore with the document
        ID set to this account&rsquo;s UID:
      </p>
      <dl className="mt-3 space-y-1 text-xs text-cream-300">
        <div>
          <dt className="inline text-cream-500">Email: </dt>
          <dd className="inline">{email}</dd>
        </div>
        <div>
          <dt className="inline text-cream-500">UID: </dt>
          <dd className="inline break-all font-mono text-brass-300">{user?.uid}</dd>
        </div>
      </dl>
      <p className="mt-3 text-xs leading-relaxed text-cream-500">
        Fields: <code>role</code> = &ldquo;admin&rdquo; (lowercase),{" "}
        <code>active</code> = true (boolean, not the text &ldquo;true&rdquo;),{" "}
        <code>email</code>, <code>name</code>.
      </p>
    </div>
  );
}

function Sidebar({ email }: { email: string }) {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);
  const { role, can, ready } = useErpSession();

  // Until the role resolves, show only the unrestricted entries rather than
  // flashing the full nav and then removing links.
  const visibleNav = NAV.filter((item) => !item.capability || (ready && can(item.capability)));

  useEffect(() => {
    setCollapsed(localStorage.getItem("admin-sidebar-collapsed") === "1");
  }, []);

  function toggleCollapsed() {
    setCollapsed((v) => {
      localStorage.setItem("admin-sidebar-collapsed", v ? "0" : "1");
      return !v;
    });
  }

  return (
    <>
      {/* Mobile top bar */}
      <div className="fixed inset-x-0 top-0 z-40 flex items-center justify-between border-b border-night-700/60 bg-night-900/90 px-5 py-3 backdrop-blur-lg lg:hidden">
        <span className="flex items-center gap-2 text-brass-400">
          <OwlMark size={32} animate={false} />
          <span className="font-display text-cream-100">Admin</span>
        </span>
        <nav className="flex max-w-[70vw] gap-1 overflow-x-auto" aria-label="Admin">
          {visibleNav.map(({ href, label, icon: Icon }) => (
            <Link
              key={href}
              href={href}
              aria-label={label}
              className={`flex h-11 w-11 items-center justify-center rounded-xl transition-colors duration-200 ${
                pathname === href ? "bg-brass-500 text-night-950" : "text-cream-300 hover:bg-night-800"
              }`}
            >
              <Icon size={19} />
            </Link>
          ))}
          <button
            onClick={() => signOut(getFirebaseAuth())}
            aria-label="Sign out"
            className="flex h-11 w-11 cursor-pointer items-center justify-center rounded-xl text-cream-300 transition-colors duration-200 hover:bg-night-800"
          >
            <LogOut size={19} />
          </button>
        </nav>
      </div>

      {/* Desktop sidebar, collapsible */}
      <aside
        className={`sticky top-0 hidden h-svh shrink-0 flex-col border-r border-night-700/60 bg-night-900 transition-all duration-300 lg:flex ${
          collapsed ? "w-[76px] p-3" : "w-64 p-6"
        }`}
      >
        <div className={`flex items-center ${collapsed ? "justify-center" : "justify-between"}`}>
          <Link
            href="/"
            className="flex items-center gap-3 text-brass-400"
            aria-label="View public site"
          >
            <OwlMark size={collapsed ? 34 : 40} animate={false} />
            {!collapsed && (
              <span className="leading-tight">
                <span className="block font-display text-lg text-cream-100">Nightowl</span>
                <span className="block text-[0.6rem] uppercase tracking-[0.3em] text-cream-400">
                  Admin
                </span>
              </span>
            )}
          </Link>
        </div>

        <button
          onClick={toggleCollapsed}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          className={`mt-6 flex cursor-pointer items-center gap-3 rounded-xl px-3 py-2.5 text-sm text-cream-400 transition-colors duration-200 hover:bg-night-800 hover:text-cream-100 ${
            collapsed ? "justify-center" : ""
          }`}
        >
          {collapsed ? <PanelLeftOpen size={18} /> : <PanelLeftClose size={18} />}
          {!collapsed && <span>Collapse</span>}
        </button>

        <nav className="mt-4 flex flex-1 flex-col gap-1.5" aria-label="Admin">
          {visibleNav.map(({ href, label, icon: Icon }) => (
            <Link
              key={href}
              href={href}
              title={collapsed ? label : undefined}
              aria-current={pathname === href ? "page" : undefined}
              className={`flex items-center gap-3 rounded-xl py-3 text-sm font-medium transition-colors duration-200 ${
                collapsed ? "justify-center px-0" : "px-4"
              } ${
                pathname === href
                  ? "bg-brass-500 text-night-950"
                  : "text-cream-300 hover:bg-night-800 hover:text-cream-100"
              }`}
            >
              <Icon size={18} className="shrink-0" />
              {!collapsed && label}
            </Link>
          ))}
        </nav>
        <div className="border-t border-night-700/60 pt-4">
          {!collapsed && (
            <>
              <p className="truncate text-xs text-cream-500">{email}</p>
              {role && (
                <p className="mt-1 text-[0.65rem] uppercase tracking-[0.2em] text-brass-400">
                  {ROLE_LABELS[role]}
                </p>
              )}
            </>
          )}
          <button
            onClick={() => signOut(getFirebaseAuth())}
            title={collapsed ? "Sign out" : undefined}
            className={`mt-3 flex w-full cursor-pointer items-center gap-3 rounded-xl py-3 text-sm text-cream-300 transition-colors duration-200 hover:bg-night-800 hover:text-cream-100 ${
              collapsed ? "justify-center px-0" : "px-4"
            }`}
          >
            <LogOut size={18} className="shrink-0" />
            {!collapsed && "Sign out"}
          </button>
        </div>
      </aside>
    </>
  );
}

function LoginScreen() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [showPassword, setShowPassword] = useState(false);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    setBusy(true);
    setError("");
    try {
      await signInWithEmailAndPassword(
        getFirebaseAuth(),
        String(data.get("email") ?? ""),
        String(data.get("password") ?? "")
      );
    } catch {
      setError("Invalid credentials. Access is restricted to Nightowl staff.");
    } finally {
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
          <Link href="/" aria-label="Back to the Nightowl Woodworks website" className="transition-opacity hover:opacity-80">
            <OwlMark size={110} />
          </Link>
          <h1 className="mt-4 font-display text-2xl text-cream-100">Nightowl Admin</h1>
          <p className="mt-1 text-sm text-cream-500">Staff sign-in</p>
        </div>
        <form onSubmit={onSubmit} className="mt-8 space-y-4">
          <div>
            <label htmlFor="admin-email" className="mb-1.5 block text-sm text-cream-300">
              Email
            </label>
            <input
              id="admin-email"
              name="email"
              type="email"
              required
              autoComplete="username"
              className="w-full rounded-xl border border-night-600 bg-night-800/60 px-4 py-3 text-cream-100 focus:border-brass-500 focus:outline-none"
            />
          </div>
          <div>
            <label htmlFor="admin-password" className="mb-1.5 block text-sm text-cream-300">
              Password
            </label>
            <div className="relative">
              <input
                id="admin-password"
                name="password"
                type={showPassword ? "text" : "password"}
                required
                autoComplete="current-password"
                className="w-full rounded-xl border border-night-600 bg-night-800/60 px-4 py-3 pr-12 text-cream-100 focus:border-brass-500 focus:outline-none"
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                aria-label={showPassword ? "Hide password" : "Show password"}
                className="absolute right-2 top-1/2 flex h-9 w-9 -translate-y-1/2 cursor-pointer items-center justify-center rounded-lg text-cream-400 transition-colors hover:text-brass-300"
              >
                {showPassword ? <EyeOff size={17} /> : <Eye size={17} />}
              </button>
            </div>
          </div>
          <AnimatePresence>
            {error && (
              <motion.p
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
                role="alert"
                className="flex items-center gap-2 text-sm text-red-400"
              >
                <ShieldAlert size={16} /> {error}
              </motion.p>
            )}
          </AnimatePresence>
          <button
            type="submit"
            disabled={busy}
            className="w-full cursor-pointer rounded-xl bg-brass-500 py-3.5 font-medium text-night-950 transition-all duration-300 hover:bg-brass-400 disabled:opacity-60"
          >
            {busy ? "Signing in…" : "Sign in"}
          </button>
        </form>
      </motion.div>
    </div>
  );
}

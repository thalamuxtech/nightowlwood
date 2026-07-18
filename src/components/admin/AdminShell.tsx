"use client";

import { createContext, useContext, useEffect, useState, type ReactNode, type FormEvent } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import {
  Eye,
  EyeOff,
  GalleryHorizontalEnd,
  GraduationCap,
  Inbox,
  LayoutDashboard,
  Loader2,
  LogOut,
  MailOpen,
  Newspaper,
  PanelLeftClose,
  PanelLeftOpen,
  Settings,
  ShieldAlert,
  Users,
} from "lucide-react";
import { onAuthStateChanged, signInWithEmailAndPassword, signOut, type User } from "firebase/auth";
import { getFirebaseAuth } from "@/lib/firebase";
import { OwlMark } from "@/components/site/OwlMark";

const AdminUserContext = createContext<User | null>(null);
export const useAdminUser = () => useContext(AdminUserContext);

const NAV = [
  { href: "/admin/", label: "Overview", icon: LayoutDashboard },
  { href: "/admin/inquiries/", label: "Quotes", icon: Inbox },
  { href: "/admin/blog/", label: "Blog", icon: Newspaper },
  { href: "/admin/internships/", label: "Internships", icon: GraduationCap },
  { href: "/admin/contacts/", label: "Messages", icon: MailOpen },
  { href: "/admin/subscribers/", label: "Subscribers", icon: Users },
  { href: "/admin/work/", label: "Work Items", icon: GalleryHorizontalEnd },
  { href: "/admin/settings/", label: "Settings", icon: Settings },
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
          {children}
        </main>
      </div>
    </AdminUserContext.Provider>
  );
}

function Sidebar({ email }: { email: string }) {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);

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
          {NAV.map(({ href, label, icon: Icon }) => (
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

      {/* Desktop sidebar — collapsible */}
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
          {NAV.map(({ href, label, icon: Icon }) => (
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
          {!collapsed && <p className="truncate text-xs text-cream-500">{email}</p>}
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
          <OwlMark size={80} />
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

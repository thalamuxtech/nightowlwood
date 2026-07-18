"use client";

import { createContext, useContext, useEffect, useState, type ReactNode, type FormEvent } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import {
  GalleryHorizontalEnd,
  GraduationCap,
  Inbox,
  LayoutDashboard,
  Loader2,
  LogOut,
  MailOpen,
  Newspaper,
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

      {/* Desktop sidebar */}
      <aside className="sticky top-0 hidden h-svh w-64 shrink-0 flex-col border-r border-night-700/60 bg-night-900 p-6 lg:flex">
        <Link href="/" className="flex items-center gap-3 text-brass-400" aria-label="View public site">
          <OwlMark size={40} animate={false} />
          <span className="leading-tight">
            <span className="block font-display text-lg text-cream-100">Nightowl</span>
            <span className="block text-[0.6rem] uppercase tracking-[0.3em] text-cream-400">
              Admin
            </span>
          </span>
        </Link>
        <nav className="mt-10 flex flex-1 flex-col gap-1.5" aria-label="Admin">
          {NAV.map(({ href, label, icon: Icon }) => (
            <Link
              key={href}
              href={href}
              aria-current={pathname === href ? "page" : undefined}
              className={`flex items-center gap-3 rounded-xl px-4 py-3 text-sm font-medium transition-colors duration-200 ${
                pathname === href
                  ? "bg-brass-500 text-night-950"
                  : "text-cream-300 hover:bg-night-800 hover:text-cream-100"
              }`}
            >
              <Icon size={18} /> {label}
            </Link>
          ))}
        </nav>
        <div className="border-t border-night-700/60 pt-4">
          <p className="truncate text-xs text-cream-500">{email}</p>
          <button
            onClick={() => signOut(getFirebaseAuth())}
            className="mt-3 flex w-full cursor-pointer items-center gap-3 rounded-xl px-4 py-3 text-sm text-cream-300 transition-colors duration-200 hover:bg-night-800 hover:text-cream-100"
          >
            <LogOut size={18} /> Sign out
          </button>
        </div>
      </aside>
    </>
  );
}

function LoginScreen() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

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
            <input
              id="admin-password"
              name="password"
              type="password"
              required
              autoComplete="current-password"
              className="w-full rounded-xl border border-night-600 bg-night-800/60 px-4 py-3 text-cream-100 focus:border-brass-500 focus:outline-none"
            />
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

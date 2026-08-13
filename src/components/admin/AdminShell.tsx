"use client";

import { createContext, useContext, useEffect, useState, type ReactNode, type FormEvent } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import {
  BarChart3,
  CalendarCheck,
  CalendarClock,
  ChevronDown,
  ClipboardCheck,
  ClipboardList,
  Contact,
  IdCard,
  Eye,
  EyeOff,
  FileQuestion,
  FolderKanban,
  GalleryHorizontalEnd,
  Gauge,
  Coins,
  HandCoins,
  Inbox,
  LayoutDashboard,
  Loader2,
  LogIn,
  LogOut,
  MapPin,
  Newspaper,
  NotebookPen,
  Package,
  PanelLeftClose,
  PanelLeftOpen,
  Receipt,
  Ruler,
  ReceiptText,
  ScrollText,
  Settings,
  ShieldAlert,
  ShieldCheck,
  ShoppingCart,
  Target,
  TrendingUp,
  Truck,
  Users,
  Wallet,
  Wrench,
} from "lucide-react";
import { onAuthStateChanged, signInWithEmailAndPassword, signOut, type User } from "firebase/auth";
import { getFirebaseAuth } from "@/lib/firebase";
import { OwlMark } from "@/components/site/OwlMark";
import { useErpSession } from "@/components/admin/ErpAuthProvider";
import { OperatorCodeLogin } from "@/components/admin/OperatorCodeLogin";
import type { Capability } from "@/lib/erp/permissions";
import { ROLE_LABELS } from "@/lib/erp/enums";
import { AdminClock } from "@/components/admin/ui/AdminClock";
import { DemoDataButton } from "@/components/admin/DemoDataButton";
import { GroupTabs } from "@/components/admin/ui/GroupTabs";

const AdminUserContext = createContext<User | null>(null);
export const useAdminUser = () => useContext(AdminUserContext);

/**
 * Nav entries. `capability` hides a link from roles that cannot use the screen;
 * entries without one are visible to any signed-in staff member. This is
 * presentation only, the screens and Firestore rules enforce access.
 */
export interface NavItem {
  href: string;
  label: string;
  icon: typeof LayoutDashboard;
  capability?: Capability;
}

/**
 * Nav groups.
 *
 * Seventeen flat entries meant scanning the whole list to find anything. Grouping
 * by the kind of work puts a heading in the way first, which is faster to skim.
 *
 * Overview sits outside any group: it is the landing page, not a category. The
 * split is deliberately by *activity* rather than by data model, so Payroll,
 * Expenses and Loans sit together under Finance even though they are unrelated
 * collections, because whoever opens one is usually reaching for another.
 */
export interface NavGroup {
  title: string | null;
  items: NavItem[];
}

export const NAV_GROUPS: NavGroup[] = [
  {
    title: null,
    items: [{ href: "/admin/", label: "Dashboard", icon: LayoutDashboard }],
  },
  {
    title: "Operations",
    items: [
      { href: "/admin/jobs/", label: "Service Jobs", icon: ClipboardList, capability: "job.view" },
      { href: "/admin/projects/", label: "Projects", icon: FolderKanban, capability: "project.view" },
      { href: "/admin/worklog/", label: "Work Log", icon: NotebookPen, capability: "worklog.create" },
      // Sits with the jobs it describes: a cutting list is what a service job is cut from.
      { href: "/admin/cutting-lists/", label: "Cutting Lists", icon: Ruler, capability: "job.view" },
    ],
  },
  /*
   * Marketing, between Operations and Stock.
   *
   * Placed here because it is where work *comes from* — a marketer's site visit today is a
   * service job in three weeks. Grouping it under Website would have been wrong: the website
   * collects enquiries from people who already found us, this is the team going out to find
   * them, and the two have nothing in common but the word "leads".
   */
  {
    title: "Marketing",
    items: [
      // The group's landing page: today's counts and what is overdue, before the screens
      // that produce them.
      {
        href: "/admin/marketing/",
        label: "Overview",
        icon: LayoutDashboard,
        capability: "marketing.view",
      },
      {
        href: "/admin/marketing/visits/",
        label: "Site Visits",
        icon: MapPin,
        capability: "marketing.view",
      },
      {
        href: "/admin/marketing/leads/",
        label: "Lead Tracker",
        icon: Users,
        capability: "marketing.view",
      },
      {
        href: "/admin/marketing/quotations/",
        label: "Quotation Requests",
        icon: FileQuestion,
        capability: "marketing.view",
      },
      {
        href: "/admin/marketing/targets/",
        label: "Daily Targets",
        icon: Target,
        capability: "marketing.view",
      },
      {
        href: "/admin/marketing/summary/",
        label: "Weekly Summary",
        icon: BarChart3,
        capability: "marketing.view",
      },
    ],
  },
  {
    title: "Stock & tools",
    items: [
      { href: "/admin/inventory/", label: "Inventory", icon: Package, capability: "inventory.view" },
      { href: "/admin/tools/", label: "Tool Log", icon: Wrench, capability: "tool.request" },
      { href: "/admin/procurement/", label: "Suppliers", icon: Truck, capability: "supplier.view" },
    ],
  },
  /*
   * Invoices, on their own.
   *
   * Previously one entry inside Finance, alongside payroll and meters. Billing is not
   * an occasional finance errand — it is a daily activity with its own documents,
   * states and follow-up, and whoever is chasing an unpaid invoice is not thinking
   * about wage rates. Splitting it out also gives the sales counter somewhere to sit
   * that is about money coming in rather than going out.
   */
  {
    title: "Invoices & sales",
    items: [
      { href: "/admin/invoices/", label: "Invoices", icon: ReceiptText, capability: "invoice.view" },
      { href: "/admin/pos/", label: "Counter Sales", icon: ShoppingCart, capability: "sale.view" },
      { href: "/admin/profit/", label: "Profit & Loss", icon: TrendingUp, capability: "profit.view" },
    ],
  },
  {
    title: "Finance",
    items: [
      { href: "/admin/expenses/", label: "Expenses", icon: Receipt, capability: "expense.view" },
      { href: "/admin/meters/", label: "Power Meters", icon: Gauge, capability: "expense.view" },
      { href: "/admin/payroll/", label: "Payroll", icon: Wallet, capability: "wage.run" },
      // Sits next to Payroll because the two are the same monthly/weekly decision
      // split by how a person is paid, not two unrelated screens.
      { href: "/admin/salaries/", label: "Salaries", icon: CalendarClock, capability: "wage.run" },
      { href: "/admin/wage-rates/", label: "Piece Rates", icon: Coins, capability: "wage.editRates" },
      { href: "/admin/loans/", label: "Loans & Advances", icon: HandCoins, capability: "loan.request" },
    ],
  },
  {
    title: "Website",
    items: [
      // customer.edit, not customer.view: a manager needs to see customers to
      // raise a job against one, but the website's enquiry inbox is not their
      // work, and gating it on view put the whole Website group in their sidebar.
      { href: "/admin/submissions/", label: "Submissions", icon: Inbox, capability: "customer.edit" },
      { href: "/admin/blog/", label: "Blog", icon: Newspaper, capability: "customer.edit" },
      {
        href: "/admin/work/",
        label: "Work Gallery",
        icon: GalleryHorizontalEnd,
        capability: "customer.edit",
      },
    ],
  },
  {
    title: "Admin",
    items: [
      // Gated on customer.edit rather than staff.edit: managers keep the
      // customer and supplier lists, and the staff tab hides its own controls
      // from anyone without staff.edit.
      { href: "/admin/directory/", label: "Directory", icon: Contact, capability: "customer.edit" },
      { href: "/admin/staff/", label: "Staff & HR", icon: IdCard, capability: "staff.view" },
      // Sits with the staff records it is about: a register is only readable next to the people
      // on it, and an absence marked here is followed up on a profile one click away.
      { href: "/admin/attendance/", label: "Attendance", icon: CalendarCheck, capability: "staff.view" },
      // Gated on `request`, not `decide`: whoever asked has to be able to see the
      // outcome, and per-row controls handle who may actually decide.
      { href: "/admin/approvals/", label: "Approvals", icon: ClipboardCheck, capability: "approval.request" },
      { href: "/admin/users/", label: "Users & Roles", icon: ShieldCheck, capability: "user.manage" },
      // Every mutation to money, payroll, stock or status already wrote an audit
      // entry; until now there was no way to read them, which made the trail
      // useless for the disputes it exists to settle.
      { href: "/admin/audit/", label: "Activity Log", icon: ScrollText, capability: "audit.view" },
      { href: "/admin/settings/", label: "Settings", icon: Settings, capability: "settings.change" },
    ],
  },
];

/** Flat list, kept for the mobile bar where headings would not fit. */
const NAV: NavItem[] = NAV_GROUPS.flatMap((g) => g.items);

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
      <RoleShell email={user.email ?? ""}>{children}</RoleShell>
    </AdminUserContext.Provider>
  );
}

/**
 * The frame around a signed-in session, which differs by role.
 *
 * An operator gets no sidebar, no clock and no group tabs. Their entire use of the
 * system is the work log form, so navigation would be a menu with one item on it —
 * chrome around a single screen, on a phone, for someone standing at a machine.
 * Everyone else gets the full shell.
 *
 * Split out of AdminShell because the role is only knowable inside the session
 * provider, which AdminShell itself renders.
 */
function RoleShell({ email, children }: { email: string; children: ReactNode }) {
  const { role, ready } = useErpSession();

  if (ready && role === "operator") {
    return (
      <div className="min-h-svh bg-night-950">
        <OperatorBar />
        <main className="mx-auto min-w-0 max-w-5xl px-5 pb-16 pt-6 sm:px-8">
          {children}
        </main>
      </div>
    );
  }

  return (
    <div className="flex min-h-svh bg-night-950">
      <Sidebar email={email} />
      <main className="min-w-0 flex-1 px-5 pb-16 pt-24 sm:px-8 lg:pt-6">
        <div className="mb-6 flex items-center justify-end gap-2.5 print:hidden">
          <AdminClock />
          <DemoDataButton />
        </div>
        <NoRoleNotice email={email} />
        <ActiveGroupTabs />
        {children}
      </main>
    </div>
  );
}

/** Minimal header for an operator: who they are, and the way out. */
function OperatorBar() {
  const { displayName } = useErpSession();
  return (
    <header className="flex items-center justify-between border-b border-night-700/60 bg-night-900/70 px-5 py-3 print:hidden">
      <span className="flex items-center gap-2.5 text-brass-400">
        <OwlMark size={28} animate={false} />
        <span className="text-sm text-cream-200">{displayName || "Work log"}</span>
      </span>
      <button
        type="button"
        onClick={() => signOut(getFirebaseAuth())}
        className="flex cursor-pointer items-center gap-1.5 text-xs text-cream-400 transition-colors hover:text-brass-300"
      >
        <LogOut size={14} /> Sign out
      </button>
    </header>
  );
}

/**
 * Tabs for the group that owns the current route.
 *
 * Rendered in the shell rather than in each screen, so adding a screen to a group
 * gives it tabs without touching the screen itself. Nothing renders on the
 * dashboard, which sits outside any group.
 */
function ActiveGroupTabs() {
  const pathname = usePathname();
  const { can, ready } = useErpSession();

  const group = NAV_GROUPS.find(
    (g) => g.title && g.items.some((i) => i.href === pathname)
  );
  if (!group?.title) return null;

  const tabs = group.items.filter(
    (i) => !i.capability || (ready && can(i.capability))
  );

  return (
    <GroupTabs
      groupKey={group.title}
      title={group.title}
      tabs={tabs.map(({ href, label, icon }) => ({ href, label, icon }))}
    />
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

  // Groups with every item filtered out are dropped entirely: a heading over an
  // empty section reads as something failing to load.
  /**
   * Only one group is expanded at a time, and it starts as the one owning the
   * current route. The page's tab strip already lists the sibling screens, so the
   * sidebar is a shortcut rather than the only way in, and keeping it collapsed
   * stops it repeating what the tabs show.
   */
  const currentGroupTitle =
    NAV_GROUPS.find((g) => g.title && g.items.some((i) => i.href === pathname))?.title ?? null;
  const [openGroup, setOpenGroup] = useState<string | null>(currentGroupTitle);

  // Follow navigation: moving into another group opens it and closes the last.
  useEffect(() => {
    if (currentGroupTitle) setOpenGroup(currentGroupTitle);
  }, [currentGroupTitle]);

  const visibleGroups = NAV_GROUPS.map((g) => ({
    ...g,
    items: g.items.filter((item) => !item.capability || (ready && can(item.capability))),
  })).filter((g) => g.items.length > 0);

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

        {/* min-h-0 is required: a flex child will not shrink below its content
            height without it, so overflow-y-auto would never engage and the
            footer would stay pushed off screen. */}
        <nav
          className="mt-4 flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto overscroll-contain pr-1 [scrollbar-color:#3a332c_transparent] [scrollbar-width:thin]"
          aria-label="Admin"
        >
          {visibleGroups.map((group) => {
            // Ungrouped entries (the dashboard) are plain links with no header.
            if (!group.title) {
              return group.items.map(({ href, label, icon: Icon }) => (
                <Link
                  key={href}
                  href={href}
                  title={collapsed ? label : undefined}
                  aria-current={pathname === href ? "page" : undefined}
                  className={`flex items-center gap-3 rounded-xl py-2.5 text-sm font-medium transition-colors duration-200 ${
                    collapsed ? "justify-center px-0" : "px-4"
                  } ${
                    pathname === href
                      ? "bg-brass-500 text-night-950"
                      : "text-cream-300 hover:bg-night-800 hover:text-cream-100"
                  }`}
                >
                  <Icon size={18} className="shrink-0" />
                  {!collapsed && <span className="truncate">{label}</span>}
                </Link>
              ));
            }

            const isOpen = openGroup === group.title;
            const holdsCurrent = group.items.some((i) => i.href === pathname);
            // The group icon is its first screen's, which keeps the collapsed
            // rail meaningful without inventing a second icon set.
            const GroupIcon = group.items[0].icon;

            return (
              <div key={group.title}>
                <button
                  type="button"
                  onClick={() => setOpenGroup(isOpen ? null : group.title)}
                  aria-expanded={isOpen}
                  title={collapsed ? group.title : undefined}
                  className={`flex w-full cursor-pointer items-center gap-3 rounded-xl py-2.5 text-sm font-medium transition-colors duration-200 ${
                    collapsed ? "justify-center px-0" : "px-4"
                  } ${
                    holdsCurrent && !isOpen
                      ? "bg-night-800 text-brass-300"
                      : "text-cream-300 hover:bg-night-800 hover:text-cream-100"
                  }`}
                >
                  <GroupIcon size={18} className="shrink-0" />
                  {!collapsed && (
                    <>
                      <span className="flex-1 truncate text-left">{group.title}</span>
                      <ChevronDown
                        size={15}
                        aria-hidden
                        className={`shrink-0 transition-transform duration-200 ${
                          isOpen ? "rotate-180" : ""
                        }`}
                      />
                    </>
                  )}
                </button>

                {/* Children render only for the open group, so the rail stays
                    short. The tab strip on the page covers the same screens, so
                    this is a shortcut rather than the only route. */}
                <AnimatePresence initial={false}>
                  {isOpen && !collapsed && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: "auto", opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
                      className="overflow-hidden"
                    >
                      <div className="mt-1 flex flex-col gap-0.5 border-l border-night-700/60 pl-3">
                        {group.items.map(({ href, label }) => (
                          <Link
                            key={href}
                            href={href}
                            aria-current={pathname === href ? "page" : undefined}
                            className={`truncate rounded-lg px-3 py-2 text-[0.8rem] transition-colors duration-200 ${
                              pathname === href
                                ? "bg-brass-500/15 text-brass-300"
                                : "text-cream-400 hover:bg-night-800 hover:text-cream-100"
                            }`}
                          >
                            {label}
                          </Link>
                        ))}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            );
          })}
        </nav>
        <div className="shrink-0 border-t border-night-700/60 pt-4">
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

/**
 * Demo accounts offered as one-click fills.
 *
 * Purely a convenience for anyone reviewing the portal: the accounts are ordinary
 * staff accounts and every role, rule and capability applies to them exactly as it
 * would to a real member of staff. Nothing here grants access — it fills two boxes.
 *
 * `demo-admin@` rather than the real `admin@nightowl.com.ng`, whose password belongs
 * to the owner and is not published.
 */
const DEMO_LOGINS = [
  {
    role: "Admin",
    email: "demo-admin@nightowl.com.ng",
    hint: "Everything, including finance and approvals",
  },
  {
    role: "Manager",
    email: "manager@nightowl.com.ng",
    hint: "Jobs, projects, stock and purchasing",
  },
  {
    role: "Operator",
    email: "operator@nightowl.com.ng",
    hint: "Own work log and tool requests",
  },
] as const;

const DEMO_PASSWORD = "NightowlDemo!2026";

function LoginScreen() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  // Controlled so a demo button can fill them; typing still works normally.
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [filled, setFilled] = useState<string | null>(null);
  /** Operators sign in with a code instead; see OperatorCodeLogin. */
  const [codeMode, setCodeMode] = useState(false);

  async function signIn(withEmail: string, withPassword: string) {
    setBusy(true);
    setError("");
    try {
      await signInWithEmailAndPassword(getFirebaseAuth(), withEmail, withPassword);
    } catch {
      setError("Invalid credentials. Access is restricted to Nightowl staff.");
    } finally {
      setBusy(false);
    }
  }

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    await signIn(email, password);
  }

  /**
   * Fills the form and signs straight in.
   *
   * The fields are populated as well as submitted, rather than only submitted, so
   * the reviewer can see which account they are using — and so a failed sign-in
   * leaves something on screen to correct rather than an empty form.
   */
  async function useDemo(demoEmail: string) {
    setEmail(demoEmail);
    setPassword(DEMO_PASSWORD);
    setFilled(demoEmail);
    await signIn(demoEmail, DEMO_PASSWORD);
  }

  if (codeMode) return <OperatorCodeLogin onBack={() => setCodeMode(false)} />;

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
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
                setFilled(null);
              }}
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
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value);
                  setFilled(null);
                }}
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

        {/* Operators do not have an email login at all, so this is not an
            alternative path to the same place — it is the only way in for them. */}
        <button
          type="button"
          onClick={() => setCodeMode(true)}
          className="mt-5 w-full cursor-pointer rounded-xl border border-night-600 bg-night-800/40 py-3 text-sm text-cream-300 transition-colors hover:border-brass-500/60 hover:text-brass-300"
        >
          I have a work-log code
        </button>

        {/* Demo sign-ins. Each is an ordinary staff account, so what a reviewer
            sees is exactly what that role sees — the buttons only save typing. */}
        <div className="mt-8 rounded-2xl border border-night-700/60 bg-night-900/40 p-4">
          <p className="text-xs uppercase tracking-wider text-cream-500">
            Demo sign-in
          </p>
          <p className="mt-1.5 text-xs text-cream-600">
            Fills the form and signs in. Each role sees only what that role is
            allowed to.
          </p>
          <div className="mt-3 space-y-2">
            {DEMO_LOGINS.map((d) => (
              <button
                key={d.email}
                type="button"
                disabled={busy}
                onClick={() => useDemo(d.email)}
                className={`flex w-full cursor-pointer items-center justify-between gap-3 rounded-xl border px-3.5 py-2.5 text-left transition-all duration-300 disabled:cursor-not-allowed disabled:opacity-60 ${
                  filled === d.email
                    ? "border-brass-500/60 bg-brass-500/10"
                    : "border-night-600 bg-night-800/50 hover:border-brass-500/50"
                }`}
              >
                <span className="min-w-0">
                  <span className="block text-sm text-cream-100">{d.role}</span>
                  <span className="block truncate text-xs text-cream-500">
                    {d.hint}
                  </span>
                </span>
                <LogIn size={15} className="shrink-0 text-brass-400" />
              </button>
            ))}
          </div>
        </div>
      </motion.div>
    </div>
  );
}

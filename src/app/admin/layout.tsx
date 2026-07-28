import type { Metadata } from "next";
import { AdminShell } from "@/components/admin/AdminShell";
import { ErpAuthProvider } from "@/components/admin/ErpAuthProvider";

export const metadata: Metadata = {
  title: "Admin",
  robots: { index: false, follow: false },
};

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  // ErpAuthProvider wraps the shell so nav can filter itself by role.
  return (
    <ErpAuthProvider>
      <AdminShell>{children}</AdminShell>
    </ErpAuthProvider>
  );
}

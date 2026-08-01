import type { Metadata } from "next";
import { UsersManager } from "@/components/admin/UsersManager";
import { RequireCapability } from "@/components/admin/RequireCapability";

export const metadata: Metadata = {
  title: "Users & Roles",
  robots: { index: false, follow: false },
};

export default function AdminUsersPage() {
  return (
    <RequireCapability capability="user.manage">
      <UsersManager />
    </RequireCapability>
  );
}

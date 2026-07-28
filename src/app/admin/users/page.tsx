import type { Metadata } from "next";
import { UsersManager } from "@/components/admin/UsersManager";

export const metadata: Metadata = {
  title: "Users & Roles",
  robots: { index: false, follow: false },
};

export default function AdminUsersPage() {
  return <UsersManager />;
}

import { redirect } from "next/navigation";

/**
 * Legacy route. These four screens were merged into /admin/submissions/ as
 * tabs; the redirect keeps existing bookmarks working.
 */
export default function LegacyRedirect() {
  redirect("/admin/submissions/");
}

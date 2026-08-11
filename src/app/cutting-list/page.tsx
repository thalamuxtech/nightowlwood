import type { Metadata } from "next";
import { SiteShell } from "@/components/site/SiteShell";
import { CuttingListBuilder } from "@/components/site/CuttingListBuilder";

export const metadata: Metadata = {
  alternates: { canonical: "/cutting-list/" },
  title: "Cutting List Builder | Send Us Your Panel Sizes",
  description:
    "Build your cutting list online: panel sizes, quantities and edge banding. We work out the boards and banding you need, and keep the list on file so it cannot get lost.",
};

/**
 * The public cutting list builder.
 *
 * Deliberately reachable without a login. The customer is the one who knows what they want
 * cut, and the paper list they bring in is the document that goes missing — so they fill it in
 * here and the workshop holds it against their record. Linked from the site footer.
 */
export default function CuttingListPage() {
  return (
    <SiteShell>
      <CuttingListBuilder />
    </SiteShell>
  );
}

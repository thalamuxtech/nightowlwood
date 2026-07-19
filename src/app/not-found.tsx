import Link from "next/link";
import { SiteShell } from "@/components/site/SiteShell";
import { OwlMark } from "@/components/site/OwlMark";

export default function NotFound() {
  return (
    <SiteShell>
      <section className="flex min-h-svh flex-col items-center justify-center px-5 text-center">
        <span className="text-brass-400">
          <OwlMark size={160} />
        </span>
        <h1 className="text-title mt-8 text-cream-50">This page flew off</h1>
        <p className="mt-4 max-w-md text-cream-400">
          The page you&apos;re looking for doesn&apos;t exist, but the workshop is
          still open.
        </p>
        <Link
          href="/"
          className="mt-9 rounded-full bg-brass-500 px-8 py-4 font-medium text-night-950 transition-all duration-300 hover:bg-brass-400 hover:shadow-glow"
        >
          Back to home
        </Link>
      </section>
    </SiteShell>
  );
}

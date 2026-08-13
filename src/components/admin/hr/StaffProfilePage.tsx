"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { doc, getDoc } from "firebase/firestore";
import { ArrowLeft, Loader2, ShieldAlert } from "lucide-react";
import { getDb } from "@/lib/firebase";
import { COL } from "@/lib/erp/collections";
import type { Staff } from "@/lib/erp/types";
import { StaffProfileScreen } from "@/components/admin/hr/StaffProfileScreen";
import { EmptyState } from "@/components/admin/ui/Fields";

/**
 * Loads the person named by `?id=` and hands them to the profile.
 *
 * Split from `StaffProfileScreen` so that screen takes a `Staff` and nothing else — which keeps it
 * usable inline from the staff list as well as on its own route, and keeps the query-parameter
 * plumbing in one place.
 */
export function StaffProfilePage() {
  const params = useSearchParams();
  const id = params.get("id");

  const [staff, setStaff] = useState<Staff | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!id) {
      setLoading(false);
      return;
    }
    let live = true;
    /*
     * Reset first.
     *
     * Without this, moving from a bad `?id=` to a good one leaves `error` set — and the error
     * branch is checked before the staff branch, so the correct profile never renders. Clearing
     * `staff` too stops the previous person's figures showing for a frame under the new name.
     */
    setLoading(true);
    setError("");
    setStaff(null);

    getDoc(doc(getDb(), COL.staff, id))
      .then((snap) => {
        if (!live) return;
        if (!snap.exists()) {
          setError("There is no staff record with that reference.");
          return;
        }
        setStaff({ id: snap.id, ...snap.data() } as Staff);
      })
      .catch((e) =>
        setError(e instanceof Error ? e.message : "Could not read that staff record.")
      )
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
    };
  }, [id]);

  return (
    <div>
      <Link
        href="/admin/staff/"
        className="inline-flex items-center gap-1.5 text-sm text-cream-400 transition-colors hover:text-brass-300"
      >
        <ArrowLeft size={15} /> Back to staff
      </Link>

      <div className="mt-5">
        {!id ? (
          <EmptyState
            title="No one chosen"
            hint="Open a profile from the staff list."
          />
        ) : loading ? (
          <p className="flex items-center gap-2 text-sm text-cream-500">
            <Loader2 size={15} className="animate-spin" /> Loading…
          </p>
        ) : error ? (
          <p
            role="alert"
            className="flex items-start gap-2 rounded-xl border border-red-500/40 bg-red-500/5 px-4 py-3 text-sm text-red-300"
          >
            <ShieldAlert size={16} className="mt-0.5 shrink-0" /> {error}
          </p>
        ) : staff ? (
          <StaffProfileScreen staff={staff} />
        ) : null}
      </div>
    </div>
  );
}

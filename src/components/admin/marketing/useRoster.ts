"use client";

import { useEffect, useState } from "react";
import { collection, getDocs, orderBy, query } from "firebase/firestore";
import { getDb } from "@/lib/firebase";
import { COL } from "@/lib/erp/collections";

/**
 * The active staff roster, as plain names.
 *
 * Shared by every marketing screen for one reason: **the weekly summary groups by name**, so
 * every record has to attribute itself using the same spelling of the same person or one marketer
 * becomes three rows in the performance table.
 *
 * Before this existed, the three screens each named people differently — the visit form offered
 * the roster, the lead form took `session.displayName`, and the follow-up log fell back to the
 * signed-in email address. A marketer whose roster entry reads "Ibrahim Musa" and whose login
 * says "Ibrahim M." appeared twice, each row showing half their work against a full target.
 *
 * Ordered by name with the status filtered in memory rather than `where("status","==") +
 * orderBy("name")`, which would need a composite index that does not exist. The roster is a few
 * dozen documents.
 *
 * `error` is returned rather than swallowed: a screen that silently falls back to a free-text
 * name box is exactly how the name-integrity problem above comes back, so the caller is expected
 * to say something.
 */
export function useRoster(): { names: string[]; loading: boolean; error: string } {
  const [names, setNames] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let live = true;
    getDocs(query(collection(getDb(), COL.staff), orderBy("name", "asc")))
      .then((snap) => {
        if (!live) return;
        setNames(
          snap.docs
            // Absent status counts as active: a staff record written before the field existed
            // is a working person, not a hidden one.
            .filter((d) => (d.data().status ?? "active") === "active")
            .map((d) => String(d.data().name ?? "").trim())
            .filter(Boolean)
        );
      })
      .catch((e) => {
        if (live) {
          setError(
            e instanceof Error
              ? `Could not load the staff list: ${e.message}`
              : "Could not load the staff list."
          );
        }
      })
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
    };
  }, []);

  return { names, loading, error };
}

/**
 * The name to attribute a record to.
 *
 * Prefers the roster entry that matches the signed-in user's display name, so a person who is
 * both a user and a staff member is recorded under one spelling. Falls back to the display name
 * itself when there is no match — better an attributed record than an unattributed one.
 */
export function rosterNameFor(displayName: string, names: string[]): string {
  const wanted = displayName.trim().toLowerCase();
  if (!wanted) return "";
  const exact = names.find((n) => n.toLowerCase() === wanted);
  if (exact) return exact;
  /*
   * A loose match, for the "Ibrahim M." against "Ibrahim Musa" case.
   *
   * Only when exactly one roster name starts with the display name or vice versa — two candidates
   * means a guess, and a guess that attributes work to the wrong person is worse than leaving it
   * to be chosen by hand.
   */
  const loose = names.filter((n) => {
    const l = n.toLowerCase();
    return l.startsWith(wanted) || wanted.startsWith(l);
  });
  return loose.length === 1 ? loose[0] : displayName.trim();
}

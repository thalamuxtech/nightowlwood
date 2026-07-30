"use client";

import { useEffect } from "react";

/**
 * Recovers from a stale-deployment chunk failure.
 *
 * Next.js content-hashes its chunk filenames, so a page held in the browser cache
 * keeps asking for chunks that stopped existing at the next deploy. Those requests
 * 404 and React dies with a ChunkLoadError, which the user sees as "Application
 * error: a client-side exception has occurred".
 *
 * Cache headers prevent this for new visits, but they cannot help a tab that is
 * already open with the old HTML, or a browser that served it from disk before the
 * new policy applied. This listens for that specific failure and reloads once,
 * which fetches the current HTML and its matching chunks.
 *
 * Two safeguards keep the reload honest:
 *
 *  - It only fires for chunk-loading failures. Reloading on any error would mask
 *    genuine bugs and could loop.
 *  - It reloads at most once per session, tracked in sessionStorage. A reload that
 *    does not fix the problem must not become a refresh loop, which is worse than
 *    the error message it replaces.
 */

const FLAG = "nightowl:chunk-reloaded";

/** Matches the several shapes this failure takes across browsers. */
function isChunkError(message: string): boolean {
  return (
    /ChunkLoadError/i.test(message) ||
    /Loading chunk \S+ failed/i.test(message) ||
    /Loading CSS chunk/i.test(message) ||
    // Safari's wording when a script 404s mid-import.
    /Importing a module script failed/i.test(message)
  );
}

export function ChunkErrorRecovery() {
  useEffect(() => {
    function recover(source: string) {
      if (sessionStorage.getItem(FLAG)) {
        // Already tried. Leaving the error visible is correct here: a loop would
        // be worse, and the console still shows the real cause.
        console.error(
          `[chunk-recovery] still failing after a reload (${source}). ` +
            "The deployment may be mid-rollout."
        );
        return;
      }
      sessionStorage.setItem(FLAG, "1");
      console.warn(`[chunk-recovery] stale build detected (${source}), reloading once.`);
      // `reload()` revalidates against the server because the HTML is now
      // no-cache, so this picks up the current chunk names.
      window.location.reload();
    }

    function onError(event: ErrorEvent) {
      if (isChunkError(event.message ?? "")) recover("error");
    }

    function onRejection(event: PromiseRejectionEvent) {
      const reason = event.reason;
      const message =
        typeof reason === "string" ? reason : String(reason?.message ?? reason ?? "");
      if (isChunkError(message)) recover("unhandledrejection");
    }

    // Dynamic imports fail as a rejected promise rather than an error event, so
    // both paths are needed.
    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);

    // A successful load means whatever went wrong is resolved, so the guard is
    // cleared and a future stale deploy can recover again.
    const clear = setTimeout(() => sessionStorage.removeItem(FLAG), 5000);

    return () => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
      clearTimeout(clear);
    };
  }, []);

  return null;
}

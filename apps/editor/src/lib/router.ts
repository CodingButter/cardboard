import { useEffect, useState } from "react";

/**
 * Tiny URL-hash-backed router. We deliberately avoid `react-router`
 * (too much surface for what is essentially a 2-route app) and
 * instead drive view state from `window.location.hash`.
 *
 * Hash shapes:
 *   `#/`            → home screen
 *   `#/p/<id>`      → project view
 *
 * Components call `navigate("#/")` / `navigate(`#/p/${id}`)` to
 * change view; this hook re-reads + parses on `hashchange`.
 */

export type Route =
  | { view: "home" }
  | { view: "project"; projectId: string };

function parseHash(hash: string): Route {
  // Strip the leading `#`. Accept both `#/` and `#` for the home
  // screen so a bare `#` doesn't break the home view.
  const cleaned = hash.replace(/^#\/?/, "");
  if (cleaned === "" || cleaned === "/") return { view: "home" };
  const segments = cleaned.split("/").filter(Boolean);
  if (segments[0] === "p" && segments[1]) {
    return { view: "project", projectId: segments[1] };
  }
  return { view: "home" };
}

export function useRoute(): [Route, (next: string) => void] {
  const [route, setRoute] = useState<Route>(() =>
    parseHash(typeof window !== "undefined" ? window.location.hash : ""),
  );

  useEffect(() => {
    const onHash = () => setRoute(parseHash(window.location.hash));
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  const navigate = (next: string) => {
    // Setting the hash dispatches a `hashchange` event, which the
    // effect above picks up. We rely on the event rather than
    // calling `setRoute` synchronously so that anything else
    // listening for hash changes (devtools, integration tests)
    // sees a consistent stream.
    if (window.location.hash === next) {
      // Forces a re-parse if the user clicks the same link twice.
      setRoute(parseHash(next));
      return;
    }
    window.location.hash = next;
  };

  return [route, navigate];
}

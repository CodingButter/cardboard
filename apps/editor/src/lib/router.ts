import { useEffect, useState } from "react";

/**
 * Tiny URL-hash-backed router. We deliberately avoid `react-router`
 * (too much surface for what is essentially a 2-route app) and
 * instead drive view state from `window.location.hash`.
 *
 * Hash shapes:
 *   `#/`                  → home, no current project
 *   `#/p/<id>`            → home, with `<id>` as the current project
 *   `#/p/<id>/<tabId>`    → project view, current project `<id>`,
 *                           active workflow tab `<tabId>`
 *
 * The two-segment shape (`#/p/<id>` with NO tab) is the "back to Home"
 * state: it preserves the active project across navigation away from
 * a project tab so Home can highlight it and so subsequent tab clicks
 * re-enter the same project without re-picking it from the list.
 *
 * Components call `navigate("#/")` / `navigate(`#/p/${id}`)` /
 * `navigate(`#/p/${id}/${tab}`)` to change view; this hook re-reads +
 * parses on `hashchange`.
 *
 * Note: this layer is intentionally string-based. The `tab` segment is
 * not validated here against `PrimaryTabId` — keeping the router free
 * of `shell/` imports preserves the dependency direction (shell depends
 * on lib, never the reverse). EditorShell narrows the string to the
 * `PrimaryTabId` union on read.
 */

export interface Route {
  /** Active project, or `null` when on the project-less Home (`#/`). */
  projectId: string | null;
  /**
   * Tab segment from the URL, or `null` when the URL is on the
   * project-less Home (`#/`) or on the project-scoped Home
   * (`#/p/<id>` with no third segment). The shell treats `null` as
   * "home tab".
   */
  tab: string | null;
}

function parseHash(hash: string): Route {
  // Strip the leading `#`. Accept both `#/` and `#` for the home
  // screen so a bare `#` doesn't break the home view.
  const cleaned = hash.replace(/^#\/?/, "");
  if (cleaned === "" || cleaned === "/") {
    return { projectId: null, tab: null };
  }
  const segments = cleaned.split("/").filter(Boolean);
  if (segments[0] === "p" && segments[1]) {
    const projectId = segments[1];
    const tab = segments[2] ?? null;
    return { projectId, tab };
  }
  return { projectId: null, tab: null };
}

/**
 * Build the canonical hash for a `(projectId, tab)` pair. `tab` of
 * `"home"` or `null` collapses to the two-segment `#/p/<id>` shape so
 * the Home view still carries the current project across reloads.
 * When `projectId` is null we always land on `#/`.
 */
export function buildHash(
  projectId: string | null,
  tab: string | null,
): string {
  if (!projectId) return "#/";
  if (!tab || tab === "home") return `#/p/${projectId}`;
  return `#/p/${projectId}/${tab}`;
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

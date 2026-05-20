import React from "react";
import { createRoot } from "react-dom/client";
import "../index.css";
import {
  hasPairingTarget,
  readSidecarParams,
  type SidecarParams,
} from "./lib/urlParams";
import {
  loadIdentity,
  type SidecarIdentity,
} from "./lib/identityStore";
import { ColdLaunchScreen } from "./components/ColdLaunchScreen";
import { ConnectingScreen } from "./components/ConnectingScreen";
import { IdentityWizard } from "./components/IdentityWizard";

/**
 * SideCar PWA entry — D9 UI shell.
 *
 * Routing model: URL-param driven. We listen to `popstate` so the
 * browser back-button + scanner-driven navigation both rerender.
 *
 *   - `?peer=…` present → ConnectingScreen (loading state, no PeerJS yet).
 *   - No `peer` param  → ColdLaunchScreen (camera + recents + paste).
 *   - User taps "Configure device" → IdentityWizard (overlay route).
 *
 * No router library — react-router would be 30KB for two views. A
 * single `useSyncExternalStore` over `location` is sufficient.
 *
 * D10 will introduce PeerJS within `ConnectingScreen`; the routing
 * shell itself stays identical.
 */

type Route = "cold" | "connecting" | "wizard";

function useLocationSearch(): string {
  const subscribe = React.useCallback((cb: () => void) => {
    window.addEventListener("popstate", cb);
    return () => window.removeEventListener("popstate", cb);
  }, []);
  const get = React.useCallback(() => window.location.search, []);
  return React.useSyncExternalStore(subscribe, get, () => "");
}

function SidecarApp() {
  const search = useLocationSearch();
  const params: SidecarParams = React.useMemo(
    () => readSidecarParams(search),
    [search],
  );

  const [identity, setIdentity] = React.useState<SidecarIdentity | null>(null);
  const [identityLoaded, setIdentityLoaded] = React.useState(false);
  const [overlayRoute, setOverlayRoute] = React.useState<"wizard" | null>(null);

  // Load identity on boot.
  React.useEffect(() => {
    let cancelled = false;
    loadIdentity().then((id) => {
      if (cancelled) return;
      setIdentity(id);
      setIdentityLoaded(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Navigation helpers — push state + dispatch popstate so the
  // useSyncExternalStore subscription rerenders.
  const navigate = React.useCallback((newSearch: string) => {
    const url = new URL(window.location.href);
    url.search = newSearch.startsWith("?") ? newSearch : `?${newSearch}`;
    window.history.pushState({}, "", url.toString());
    window.dispatchEvent(new PopStateEvent("popstate"));
  }, []);

  const clearSearch = React.useCallback(() => {
    const url = new URL(window.location.href);
    url.search = "";
    window.history.pushState({}, "", url.toString());
    window.dispatchEvent(new PopStateEvent("popstate"));
  }, []);

  const handleJoinUrl = React.useCallback(
    (raw: string) => {
      try {
        const u = new URL(raw, window.location.href);
        // Replace our location with the join URL so reload re-pairs.
        // Keep the path on /sidecar/ — the user's URL might be absolute.
        navigate(u.search);
      } catch {
        /* ignore — caller validated */
      }
    },
    [navigate],
  );

  // Decide route. Identity-wizard overlay wins.
  let route: Route;
  if (overlayRoute === "wizard") route = "wizard";
  else if (hasPairingTarget(params)) route = "connecting";
  else route = "cold";

  // Boot: if no identity AND no pairing target AND not yet shown the
  // wizard, drop the user into the wizard first time. This mirrors
  // the "first-launch setup wizard" behaviour in REMOTE_DOCK_QR.md §5b.
  React.useEffect(() => {
    if (!identityLoaded) return;
    if (identity) return;
    if (hasPairingTarget(params)) return; // mid-pairing — defer wizard
    if (overlayRoute === "wizard") return;
    setOverlayRoute("wizard");
  }, [identityLoaded, identity, params, overlayRoute]);

  if (!identityLoaded) {
    return (
      <div className="min-h-screen w-full bg-[#0a0a0c] text-zinc-500 flex items-center justify-center">
        <p className="text-sm">Loading…</p>
      </div>
    );
  }

  if (route === "wizard") {
    return (
      <IdentityWizard
        existing={identity ?? null}
        onComplete={(id) => {
          setIdentity(id);
          setOverlayRoute(null);
        }}
        onCancel={identity ? () => setOverlayRoute(null) : undefined}
      />
    );
  }

  if (route === "connecting") {
    return (
      <ConnectingScreen
        params={params}
        identity={identity}
        onCancel={clearSearch}
      />
    );
  }

  return (
    <ColdLaunchScreen
      identity={identity}
      onOpenIdentityWizard={() => setOverlayRoute("wizard")}
      onJoinUrl={handleJoinUrl}
    />
  );
}

// Register the sidecar service worker. Scope is explicitly `./` so it
// only controls `/sidecar/*` — won't conflict with the editor app's
// SW which is scoped to the deploy root.
if (typeof navigator !== "undefined" && "serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    // Register as a module SW so the transpiled `export {}` marker
    // from the TS source doesn't trip a classic-script parse error.
    navigator.serviceWorker
      .register("./sw.js", { scope: "./", type: "module" })
      .catch((err) => {
        console.warn("[sidecar] Service worker registration failed:", err);
      });
  });
}

// Inject manifest link at runtime — same pattern as the editor's
// index.html so Bun's HTML bundler doesn't try to resolve the
// manifest path at build time.
(function injectManifestLink() {
  if (typeof document === "undefined") return;
  const head = document.head;
  const l = document.createElement("link");
  l.rel = "manifest";
  l.href = "./manifest.webmanifest";
  head.appendChild(l);
})();

const root = createRoot(document.getElementById("root")!);
root.render(<SidecarApp />);

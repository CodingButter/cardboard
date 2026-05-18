import React from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import { App } from "./src/App";
import { assetUrl } from "./src/lib/assetUrl";

/**
 * Register the PWA service worker.
 *
 * Behaviour:
 *   - Dev (`bun --hot`):  SW registers; cache-first for known build
 *     artifacts (entry HTML, hashed JS/CSS chunks, manifest, icons).
 *     The SW explicitly carves out `/_bun`, `/__bun`, and any path
 *     containing `"hmr"` so live-reload traffic falls through to the
 *     network and HMR keeps working.
 *   - Prod (Pages build): same SW, no HMR paths to encounter.
 *
 * `assetUrl` prefixes the deploy base (`/cardboard/` on Pages), and
 * the SW scope is constrained to that same base so the SW can't reach
 * outside the editor's subpath. The SW file itself ships from
 * `public/sw.js`.
 */
if (typeof navigator !== "undefined" && "serviceWorker" in navigator) {
  // Defer until after first paint so it doesn't compete with the
  // initial bundle fetches.
  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register(assetUrl("/sw.js"), { scope: assetUrl("/") })
      .catch((err) => {
        console.warn("Service worker registration failed:", err);
      });
  });
}

const root = createRoot(document.getElementById("root")!);
root.render(<App />);

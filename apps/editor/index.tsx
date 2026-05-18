import React from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import { App } from "./src/App";
import { assetUrl } from "./src/lib/assetUrl";

/**
 * Register the PWA service worker. We only register in production
 * builds — in HMR dev (`bun --hot`) the SW would intercept the bundle
 * fetches and break live reload. Bun's bundler exposes `import.meta.hot`
 * only in dev, so its absence is a reliable production signal. Mirrors
 * the gating used in `packages/engine/src/main.ts`.
 *
 * `assetUrl` prefixes the deploy base (`/cardboard/` on Pages), and
 * the SW scope is constrained to that same base so the SW can't
 * reach outside the editor's subpath. There is no `sw.js` shipping
 * with the editor today — registration failing silently is the
 * intended behaviour until one is added.
 */
if (typeof navigator !== "undefined" && "serviceWorker" in navigator && !import.meta.hot) {
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

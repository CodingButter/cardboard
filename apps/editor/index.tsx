import React from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import { App } from "./src/App";

/**
 * Register the PWA service worker. We only register in production
 * builds — in HMR dev (`bun --hot`) the SW would intercept the bundle
 * fetches and break live reload. Bun's bundler exposes `import.meta.hot`
 * only in dev, so its absence is a reliable production signal. Mirrors
 * the gating used in `packages/engine/src/main.ts`.
 */
if (typeof navigator !== "undefined" && "serviceWorker" in navigator && !import.meta.hot) {
  // Defer until after first paint so it doesn't compete with the
  // initial bundle fetches.
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch((err) => {
      console.warn("Service worker registration failed:", err);
    });
  });
}

const root = createRoot(document.getElementById("root")!);
root.render(<App />);

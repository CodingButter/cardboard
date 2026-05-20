/* eslint-disable no-restricted-globals */
/// <reference lib="webworker" />
/**
 * Service worker for the Cardboard SideCar PWA.
 *
 * Minimal D9 scope:
 *   - `install` event: precache the app shell (entry HTML + manifest).
 *   - `activate` event: drop any stale caches from older versions.
 *   - `fetch` event: cache-first for known shell artifacts.
 *
 * Per REMOTE_DOCK_QR.md §9.7: the sidecar SW caches the APP SHELL,
 * NOT user data. Each session reads fresh from the desktop over
 * WebRTC. No IDB shadowing here.
 *
 * Scope: explicitly `./` (i.e. `/sidecar/`) — the SW must NOT control
 * the editor app at the deploy root. The registration in
 * `index.tsx` passes `{ scope: "./" }` and the file is served from
 * `/sidecar/sw.js` so the default scope already lines up; the
 * explicit option is belt-and-braces.
 *
 * Written as a `.ts` source for editor consistency; runtime is
 * served as JS by Bun (transpile-on-the-fly in `apps/editor/server.ts`,
 * or copied verbatim by the build pipeline). The body of this file
 * is intentionally plain ES2020+ that requires zero type-stripping.
 */

// Narrow `self` to a service-worker scope so TS sees `skipWaiting`,
// `clients`, etc. without polluting the runtime.
declare const self: ServiceWorkerGlobalScope;

const CACHE_VERSION = "cardboard-sidecar-v1";

/**
 * App-shell URLs precached on install. All paths are relative to the
 * SW location (`/sidecar/sw.js`), so the same SW works under both `/`
 * (dev) and `/cardboard/` (Pages) deploys.
 */
const PRECACHE_URLS: string[] = [
  "./",
  "./index.html",
  "./manifest.webmanifest",
];

/**
 * Decide whether a URL is part of the sidecar app shell. Only requests
 * we recognise are served from cache — anything else falls through to
 * the network so dev HMR + future asset endpoints keep working.
 */
function isShell(url: string): boolean {
  const u = new URL(url);
  if (u.origin !== self.location.origin) return false;
  const p = u.pathname;

  // Carve-out: never intercept HMR / dev-only paths. Mirrors the
  // editor's main SW.
  if (p.startsWith("/_bun")) return false;
  if (p.startsWith("/__bun")) return false;
  if (p.includes("hmr")) return false;

  // Sidecar path prefix can be `/sidecar/` (dev) or
  // `/cardboard/sidecar/` (Pages); strip the deploy prefix if present.
  let rel = p;
  if (rel.startsWith("/cardboard/")) rel = rel.slice("/cardboard".length);
  if (!rel.startsWith("/sidecar")) return false;

  // Never cache the SW itself.
  if (rel === "/sidecar/sw.js") return false;

  // Manifest + entry HTML + bundled assets are shell.
  if (rel === "/sidecar/" || rel === "/sidecar/index.html") return true;
  if (rel === "/sidecar/manifest.webmanifest") return true;

  // Hashed JS / CSS chunks emitted by Bun under the sidecar entry.
  if (/^\/sidecar\/[^/]+\.(?:js|css|woff2?|ttf|otf)$/.test(rel)) return true;

  return false;
}

self.addEventListener("install", (event: ExtendableEvent) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_VERSION);
      await Promise.allSettled(PRECACHE_URLS.map((u) => cache.add(u)));
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener("activate", (event: ExtendableEvent) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(
        names
          .filter((n) => n.startsWith("cardboard-sidecar-") && n !== CACHE_VERSION)
          .map((n) => caches.delete(n)),
      );
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("fetch", (event: FetchEvent) => {
  const req = event.request;
  if (req.method !== "GET") return;
  if (!isShell(req.url)) return;

  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE_VERSION);
      const cached = await cache.match(req);
      if (cached) {
        // Refresh in background — non-blocking.
        event.waitUntil(
          fetch(req)
            .then((res) => {
              if (res.ok) return cache.put(req, res.clone()).catch(() => {});
            })
            .catch(() => {}),
        );
        return cached;
      }
      try {
        const res = await fetch(req);
        if (res.ok) cache.put(req, res.clone()).catch(() => {});
        return res;
      } catch {
        return new Response("Offline.", { status: 504, statusText: "Gateway Timeout" });
      }
    })(),
  );
});

export {};

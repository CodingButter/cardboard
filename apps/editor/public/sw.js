/* eslint-disable no-restricted-globals */
// Service worker for the Cardboard editor PWA.
//
// Strategy: cache-first for known build artifacts (the bundled JS/CSS
// emitted by Bun, the entry HTML, the manifest, icons). Everything
// else falls through to the network.
//
// IMPORTANT — dev HMR carve-out: this SW is registered in both `bun
// --hot` dev and the static GitHub Pages deploy. In dev, Bun serves
// hot-reload chunks under `/_bun/...` and the HMR runtime polls a
// websocket-ish endpoint; if the SW intercepted those, live-reload
// would silently break. `isCacheable()` explicitly excludes `/_bun`,
// `/__bun`, and any path containing `"hmr"` so HMR traffic always
// reaches the network. Mirrors the carve-out in apps/game/public/sw.js.
//
// The SW's scope is the deploy base (`/` in dev, `/cardboard/` on
// Pages) — registration in index.tsx passes that explicitly via
// `assetUrl("/")`. Bump CACHE_VERSION on any release that ships new
// build artifacts; on `activate` we delete every cache that isn't
// the current version.

const CACHE_VERSION = "cardboard-editor-v1";

// Static assets to seed into the cache on install. Relative paths so
// the same SW works under both `/` (dev) and `/cardboard/` (Pages) —
// the SW's `registration.scope` provides the base.
const PRECACHE_URLS = [
  "./",
  "./manifest.webmanifest",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/icon-512-maskable.png",
];

/** Patterns considered cacheable build artifacts. */
function isCacheable(url) {
  const u = new URL(url);
  if (u.origin !== self.location.origin) return false;
  const p = u.pathname;

  // Never cache HMR / dev-only endpoints. Without these carve-outs the
  // SW would serve a stale chunk back to Bun's HMR runtime and dev
  // live-reload would stop working.
  if (p.startsWith("/_bun")) return false;
  if (p.startsWith("/__bun")) return false;
  if (p.includes("hmr")) return false;

  // The SW is scoped to the deploy base, but registrations pass full
  // URLs through here — strip any deploy prefix before matching so the
  // same rules apply at `/` and `/cardboard/`.
  let rel = p;
  if (rel.startsWith("/cardboard/")) rel = rel.slice("/cardboard".length);

  if (rel === "/") return true;
  if (rel === "/index.html") return true;
  if (rel === "/manifest.webmanifest") return true;
  if (rel === "/sw.js") return false; // never cache the SW itself
  if (rel.startsWith("/icons/")) return true;

  // Bundler emits hashed chunks at the root: /chunk-XXXX.js, /index-XXXX.css, etc.
  if (/^\/[^/]+\.(?:js|css|woff2?|ttf|otf)$/.test(rel)) return true;

  return false;
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_VERSION);
      // Pre-cache best-effort: a single failure shouldn't kill install.
      await Promise.allSettled(PRECACHE_URLS.map((u) => cache.add(u)));
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(
        names.filter((n) => n !== CACHE_VERSION).map((n) => caches.delete(n)),
      );
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  if (!isCacheable(req.url)) return; // let the network handle it

  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE_VERSION);
      const cached = await cache.match(req);
      if (cached) {
        // Refresh in the background so the next load gets newer bytes
        // without blocking this response. Failures are ignored — we're
        // already serving from cache.
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
      } catch (err) {
        // Offline + nothing cached: return a 504 so the page can show
        // its own fallback rather than a misleading network error.
        return new Response("Offline and no cached copy available.", {
          status: 504,
          statusText: "Gateway Timeout",
        });
      }
    })(),
  );
});

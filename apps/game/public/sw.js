/* eslint-disable no-restricted-globals */
// Service worker for Browser Doom PWA.
//
// Strategy: cache-first for known build artifacts (the bundled JS/CSS
// emitted by Bun, the entry HTML, the manifest, icons, and the asset
// pack). Everything else falls through to the network — including
// Bun's HMR endpoints (`/_bun/...`) and any unrecognised path, so the
// SW never interferes with dev-only traffic.
//
// Bump CACHE_VERSION on any release that ships new build artifacts; on
// `activate` we delete every cache that isn't the current version.

const CACHE_VERSION = "two_5_d-v1";

// Static assets to seed into the cache on install. The bundle filename
// is hashed by Bun's bundler so we can't precache that; it'll be cached
// lazily by the fetch handler on first load.
const PRECACHE_URLS = [
  "/",
  "/manifest.webmanifest",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/icons/icon-512-maskable.png",
  "/packs/default.apg",
];

/** Patterns considered cacheable build artifacts. */
function isCacheable(url) {
  const u = new URL(url);
  if (u.origin !== self.location.origin) return false;
  const p = u.pathname;

  // Never cache HMR / dev-only endpoints.
  if (p.startsWith("/_bun")) return false;
  if (p.startsWith("/__bun")) return false;
  if (p.includes("hmr")) return false;

  if (p === "/") return true;
  if (p === "/index.html") return true;
  if (p === "/manifest.webmanifest") return true;
  if (p === "/sw.js") return false; // never cache the SW itself
  if (p.startsWith("/icons/")) return true;
  if (p.startsWith("/packs/") && p.endsWith(".apg")) return true;

  // Bundler emits hashed chunks at the root: /chunk-XXXX.js, /index-XXXX.css, etc.
  if (/^\/[^/]+\.(?:js|css|woff2?|ttf|otf)$/.test(p)) return true;
  // Images shipped under /images.
  if (p.startsWith("/images/")) return true;

  return false;
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_VERSION);
      // Pre-cache best-effort: a single failure shouldn't kill install
      // (the pack might not exist yet on a fresh clone, for instance).
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

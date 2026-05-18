/// <reference types="bun" />
import index from "./index.html";

const PUBLIC_DIR = `${import.meta.dir}/public`;
// EDITOR_IFRAME.md §11 — proxy `/play/*` to the live `apps/game/dist/`
// directory so the iframe always loads the freshest game build (kept
// up to date by the root `bun dev` watcher running `bun build --watch`
// in apps/game). The previous staged-copy at `public/play/` rotted
// every time the engine changed.
const GAME_DIST_DIR = `${import.meta.dir}/../game/dist`;

/**
 * Resolve content-type / cache headers for files Bun.file might not
 * infer correctly. Most things are fine (it sniffs from the extension),
 * but the PWA manifest needs to be served as JSON and the service
 * worker as JS — both with no-cache so future deploys actually update
 * on the client. Mirrors apps/game/server.ts.
 */
function pwaHeaders(pathname: string): HeadersInit | undefined {
  if (pathname === "/manifest.webmanifest") {
    return {
      "content-type": "application/manifest+json; charset=utf-8",
      "cache-control": "no-cache",
    };
  }
  if (pathname === "/sw.js") {
    return {
      "content-type": "application/javascript; charset=utf-8",
      "cache-control": "no-cache",
      // Allow the SW to control the whole origin even if the file moves.
      "service-worker-allowed": "/",
    };
  }
  return undefined;
}

const server = Bun.serve({
  port: 3001,
  routes: {
    "/": index,
    "/*": async (req) => {
      const { pathname } = new URL(req.url);

      // Proxy /play/* to apps/game/dist/ (live build, kept fresh by
      // the root `bun dev` watcher). Same origin = shared IndexedDB.
      if (pathname.startsWith("/play/") || pathname === "/play") {
        const rel = pathname === "/play" || pathname === "/play/"
          ? "/index.html"
          : pathname.slice("/play".length);
        let file = Bun.file(`${GAME_DIST_DIR}${rel}`);
        if (await file.exists()) return new Response(file);
        // Game's hashed bundles live at the dist root, but the
        // <script src="./index-XXXX.js"> resolves to /play/index-XXXX.js
        // — already handled above. Anything else 404s.
        return new Response("Not Found", { status: 404 });
      }

      // Try the path as an exact file first.
      let file = Bun.file(`${PUBLIC_DIR}${pathname}`);
      if (await file.exists()) {
        const extra = pwaHeaders(pathname);
        if (extra) return new Response(file, { headers: extra });
        return new Response(file);
      }
      // Fall back to directory-index lookup.
      const indexPath = pathname.endsWith("/")
        ? `${pathname}index.html`
        : `${pathname}/index.html`;
      file = Bun.file(`${PUBLIC_DIR}${indexPath}`);
      if (await file.exists()) {
        return new Response(file);
      }
      return new Response("Not Found", { status: 404 });
    },
  },
  development: {
    hmr: true,
    console: true,
  },
});

console.log(`Listening on ${server.url}`);

/// <reference types="bun" />
import index from "./index.html";
import sidecarIndex from "./sidecar/index.html";

const PUBLIC_DIR = `${import.meta.dir}/public`;
const SIDECAR_DIR = `${import.meta.dir}/sidecar`;
// EDITOR_IFRAME.md §11 — proxy `/play/*` to the live `apps/game/dist/`
// directory so the iframe always loads the freshest game build (kept
// up to date by the root `bun dev` watcher running `bun build --watch`
// in apps/game). The previous staged-copy at `public/play/` rotted
// every time the engine changed.
const GAME_DIST_DIR = `${import.meta.dir}/../game/dist`;
// Proxy `/packs/*` to apps/game/public/packs/ so HomeScreen's
// "Create Project" templates (e.g. Cardboard.apg) resolve from the
// editor origin without needing a duplicate copy in apps/editor/public/.
const GAME_PACKS_DIR = `${import.meta.dir}/../game/public/packs`;

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

/**
 * Sidecar PWA assets — same content-type/cache rules as the editor's
 * own PWA, but the SW's allowed scope is constrained to `/sidecar/`
 * so it can't reach outside the sidecar route.
 */
function sidecarPwaHeaders(pathname: string): HeadersInit | undefined {
  if (pathname === "/sidecar/manifest.webmanifest") {
    return {
      "content-type": "application/manifest+json; charset=utf-8",
      "cache-control": "no-cache",
    };
  }
  if (pathname === "/sidecar/sw.js") {
    return {
      "content-type": "application/javascript; charset=utf-8",
      "cache-control": "no-cache",
      "service-worker-allowed": "/sidecar/",
    };
  }
  return undefined;
}

/**
 * Transpile the sidecar's `sw.ts` to JS on demand so the service
 * worker can be authored alongside the rest of the sidecar (`.ts`,
 * editor-consistent) without a separate build step. Result is
 * cached in-process — the file is small and changes rarely.
 */
let _sidecarSwJsCache: string | null = null;
async function getSidecarSwJs(): Promise<string> {
  if (_sidecarSwJsCache !== null) return _sidecarSwJsCache;
  const swSource = await Bun.file(`${SIDECAR_DIR}/sw.ts`).text();
  const transpiler = new Bun.Transpiler({ loader: "ts", target: "browser" });
  _sidecarSwJsCache = transpiler.transformSync(swSource);
  return _sidecarSwJsCache;
}

const server = Bun.serve({
  port: Number(process.env.PORT) || 3001,
  routes: {
    "/": index,
    // SideCar PWA shell — REMOTE_DOCK_QR.md §5 / D9. Same Bun HTML
    // import as the editor itself; URL params route inside the React
    // app (cold-launch vs connecting). Match `/sidecar` (no slash) so
    // bare visits redirect cleanly.
    "/sidecar": sidecarIndex,
    "/sidecar/": sidecarIndex,
    "/sidecar/index.html": sidecarIndex,
    "/sidecar/manifest.webmanifest": async () => {
      const file = Bun.file(`${SIDECAR_DIR}/manifest.webmanifest`);
      return new Response(file, {
        headers: sidecarPwaHeaders("/sidecar/manifest.webmanifest"),
      });
    },
    "/sidecar/sw.js": async () => {
      const js = await getSidecarSwJs();
      return new Response(js, {
        headers: sidecarPwaHeaders("/sidecar/sw.js"),
      });
    },
    "/*": async (req) => {
      const { pathname } = new URL(req.url);

      // Proxy /packs/* to apps/game/public/packs/ so authored pack
      // templates referenced by HomeScreen (e.g. /packs/Cardboard.apg)
      // resolve from the editor origin.
      if (pathname.startsWith("/packs/")) {
        const rel = pathname.slice("/packs".length);
        const file = Bun.file(`${GAME_PACKS_DIR}${rel}`);
        if (await file.exists()) return new Response(file);
        return new Response("Not Found", { status: 404 });
      }

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

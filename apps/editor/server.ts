/// <reference types="bun" />
import index from "./index.html";
import sidecarIndex from "./sidecar/index.html";
import {
  handleDevHmrSseRequest,
  isDevHmrSseUrl,
  tryServeDevPackApg,
} from "./dev/dev-pack-server";

// Dev-mode pack HMR (task #36 / CORE_EDITOR_PACK.md §11 risk #2 mitigation (c)).
// Enabled when `bun --hot server.ts` is running (the editor's `dev`
// script). In a production build (`bun build`), this file is never
// executed — `server.ts` is dev-only. The dev module hooks
// `/packs/<id>.apg` for workspace-resident packs (rebuilds the .apg
// bytes in-memory from `packages/<pack>/`) and exposes an SSE channel
// at `/__dev/pack-hmr` that pushes change events so the editor can
// hot-swap the pack without a browser reload.
const DEV_PACK_HMR_ENABLED = process.env.NODE_ENV !== "production";

const PUBLIC_DIR = `${import.meta.dir}/public`;
const SIDECAR_DIR = `${import.meta.dir}/sidecar`;
// EDITOR_IFRAME.md §11 — proxy `/play/*` to the live `apps/game/dist/`
// directory so the iframe always loads the freshest game build (kept
// up to date by the root `bun dev` watcher running `bun build --watch`
// in apps/game). The previous staged-copy at `public/play/` rotted
// every time the engine changed.
const GAME_DIST_DIR = `${import.meta.dir}/../game/dist`;
// `/packs/*` resolves from TWO locations, checked in order:
//   1. apps/editor/public/packs/ — editor-scope packs (e.g.
//      cardboard-editor-pack-demo.apg). Loaded by the editor's
//      runtime pack loader (`src/packs/editorPackLoader.ts`) — single
//      `.apg` fetch, decoded via `ZipAssetPack.loadFromBytes`.
//   2. apps/game/public/packs/ — authored game packs (e.g.
//      Cardboard.apg). Referenced by HomeScreen's "Create Project"
//      templates; shared via the editor origin so the iframe inherits
//      the bytes without a duplicate copy.
const EDITOR_PACKS_DIR = `${import.meta.dir}/public/packs`;
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

      // Dev-mode pack HMR — `/__dev/pack-hmr` is an SSE stream pushing
      // `{ type: "pack-changed", packId }` events whenever a workspace
      // pack source file changes. The editor's `devHmrClient` subscribes
      // and hot-swaps the pack without a browser reload.
      if (DEV_PACK_HMR_ENABLED && isDevHmrSseUrl(pathname)) {
        return handleDevHmrSseRequest();
      }

      // Resolve `/packs/*` against the editor's own public/packs/
      // first (editor-scope `.apg` files emitted by `bun run
      // build-packs`), then fall back to apps/game/public/packs/ so
      // HomeScreen's "Create Project" templates (e.g. Cardboard.apg)
      // still resolve from the editor origin.
      if (pathname.startsWith("/packs/")) {
        // Dev-mode: if the pack id maps to a workspace source dir,
        // serve a freshly-compiled in-memory .apg instead of the
        // on-disk artifact. This is the optimization that gives panel
        // edits a ~1-2s feedback loop — see `dev/dev-pack-server.ts`.
        if (DEV_PACK_HMR_ENABLED) {
          const devResponse = await tryServeDevPackApg(pathname);
          if (devResponse) return devResponse;
        }
        const rel = pathname.slice("/packs".length);
        const editorFile = Bun.file(`${EDITOR_PACKS_DIR}${rel}`);
        if (await editorFile.exists()) return new Response(editorFile);
        const gameFile = Bun.file(`${GAME_PACKS_DIR}${rel}`);
        if (await gameFile.exists()) return new Response(gameFile);
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
  // Default Bun.serve idleTimeout is 10s; the dev pack-HMR SSE channel
  // pushes a heartbeat every 5s, but a brief stall (file watcher
  // re-scan after a save burst) shouldn't reset the SSE — bump to 60s
  // so reconnect chatter doesn't fill the console. Non-SSE routes are
  // unaffected; this is purely a connection-idle ceiling.
  idleTimeout: 60,
});

console.log(`Listening on ${server.url}`);

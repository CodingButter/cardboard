/// <reference types="bun" />
/**
 * Dev-mode pack HMR — task #36 / `docs/plans/CORE_EDITOR_PACK.md` §11
 * risk #2 mitigation (c) "in-process pack-source resolution".
 *
 * Goal: editing a TSX file under `packages/core-editor-pack/panels/`
 * (or any other workspace pack under `packages/*-pack/`) updates the
 * running editor within ~1-2 seconds WITHOUT a full browser reload
 * AND WITHOUT touching the production loader path.
 *
 * Mechanism:
 *   1. The editor's existing pack loader fetches `/packs/<id>.apg`.
 *      In dev, this server module intercepts that route — if the
 *      requested pack id maps to a workspace source dir under
 *      `packages/`, we build an in-memory `.apg` zip on demand using
 *      the SAME pack-script-compile path the production `build-packs`
 *      uses (apps/pack-builder/src/build-pack-script.ts). React + the
 *      shell SDK are externalised identically so the dev-built bytes
 *      are byte-equivalent in behaviour to the production-built bytes.
 *
 *   2. A second route serves an EventSource stream that watches the
 *      pack source dirs. On each save under
 *      `packages/<pack>/{panels,views,layouts,scripts,types}/*.{ts,tsx,json}`
 *      OR `packages/<pack>/manifest.json`, an event of shape
 *      `{ "packId": "<id>" }` is pushed. The client-side `devHmrClient`
 *      reacts to each event by calling the existing
 *      `unloadEditorPack(id)` + `loadEditorPack(id)` pair — the same
 *      mechanism the Extensions-tab live-toggle uses. The new bytes
 *      come from this server (no .apg file written), and the live
 *      unregister + re-register path is exercised on every save.
 *
 * Production behaviour is unchanged:
 *   - In `bun build` / `bun run build-packs` flows, this module is
 *     never imported. The editor's `server.ts` only attaches the dev
 *     routes when running under `bun --hot` (i.e. `bun run dev`).
 *   - The browser-side fetch path (`/packs/<id>.apg`) is identical;
 *     the dev server simply substitutes the bytes when running.
 *   - Production builds continue to fetch the static `.apg` on disk
 *     emitted by `bun run build-packs`.
 *
 * Constraints / known limits:
 *   - Only `manifest.scripts[]` + `manifest.editorPanels[]` files are
 *     bundled into the in-memory zip. Packs that declare
 *     `manifest.libraries[]` (e.g. `demo-scene-stats` shipping chart.js)
 *     fall back to the on-disk `.apg`. The library-bundling step is
 *     expensive and rarely changes; the optimization targets the
 *     panel-edit loop, not the chart.js-dep-bump loop.
 *   - Packs declaring `manifest.scenes[]` / shaders / images also fall
 *     back. Those are game-scope content surfaces — the four
 *     editor-scope packs in this repo never use them.
 *
 * See CORE_EDITOR_PACK.md §11 for the design rationale + the (a)/(b)/(c)
 * trade-off discussion.
 */

import { readdir, stat, watch } from "node:fs/promises";
import { join, relative } from "node:path";
import JSZip from "jszip";
import {
  buildPackScript,
  compiledPackScriptPath,
  isCompilablePackScript,
} from "../../pack-builder/src/build-pack-script";

const REPO_ROOT = new URL("../../../", import.meta.url).pathname;
const PACKAGES_ROOT = join(REPO_ROOT, "packages");

/**
 * Pack ids → workspace source dir. Built lazily on first request by
 * scanning every `packages/*` dir for a `manifest.json` whose `id`
 * matches. Cached for the lifetime of the process; new packs added
 * during a session require a server restart (rare during normal panel
 * editing).
 */
let packDirByIdCache: Map<string, string> | null = null;

async function scanPackDirs(): Promise<Map<string, string>> {
  if (packDirByIdCache) return packDirByIdCache;
  const map = new Map<string, string>();
  let entries: string[];
  try {
    entries = await readdir(PACKAGES_ROOT);
  } catch {
    packDirByIdCache = map;
    return map;
  }
  for (const entry of entries) {
    const dir = join(PACKAGES_ROOT, entry);
    let info;
    try {
      info = await stat(dir);
    } catch {
      continue;
    }
    if (!info.isDirectory()) continue;
    const manifestFile = Bun.file(join(dir, "manifest.json"));
    if (!(await manifestFile.exists())) continue;
    try {
      const manifest = JSON.parse(await manifestFile.text()) as {
        id?: string;
        scope?: string[];
      };
      // Only editor-scope packs are HMR-able — game packs go through
      // the engine's loader, not this dev server's route.
      const scope = manifest.scope ?? [];
      if (!Array.isArray(scope) || !scope.includes("editor")) continue;
      if (typeof manifest.id === "string" && manifest.id.length > 0) {
        map.set(manifest.id, dir);
      }
    } catch {
      // Malformed manifest — skip.
    }
  }
  packDirByIdCache = map;
  return map;
}

/**
 * `true` when the pack's manifest only uses surfaces this dev builder
 * handles (manifest + editorPanels + scripts). Anything that requires
 * the full pack-builder pipeline (libraries, scenes, shaders, images,
 * audio) returns `false` and the loader falls back to the on-disk
 * `.apg`.
 */
function isDevBuildable(manifest: Record<string, unknown>): boolean {
  // The four offenders that need the heavy pipeline.
  if (Array.isArray(manifest.libraries) && manifest.libraries.length > 0) {
    return false;
  }
  if (Array.isArray((manifest as { scenes?: unknown[] }).scenes)) return false;
  if ((manifest as { shaders?: unknown }).shaders) return false;
  if ((manifest as { tileSheets?: unknown }).tileSheets) return false;
  if ((manifest as { audio?: unknown }).audio) return false;
  return true;
}

/**
 * Build an in-memory `.apg` byte-stream for the named pack id.
 * Returns `null` when the pack id isn't a workspace pack OR when the
 * pack uses surfaces this builder can't handle.
 */
export async function buildDevPackBytes(packId: string): Promise<Uint8Array | null> {
  const map = await scanPackDirs();
  const packRoot = map.get(packId);
  if (!packRoot) return null;

  const manifestFile = Bun.file(join(packRoot, "manifest.json"));
  if (!(await manifestFile.exists())) return null;
  let manifest: Record<string, unknown>;
  try {
    manifest = JSON.parse(await manifestFile.text()) as Record<string, unknown>;
  } catch (err) {
    console.warn(`[dev-pack] ${packId}: manifest.json parse failed:`, err);
    return null;
  }
  if (!isDevBuildable(manifest)) {
    // Caller should fall back to the on-disk .apg.
    return null;
  }

  const zip = new JSZip();

  // Compile every `manifest.scripts[]` entry via the existing
  // `buildPackScript` (the SAME helper `bun run build-packs` uses).
  // The compiled output rewires React + the shell SDK to the host's
  // global slots, exactly like the production pipeline does.
  const scriptPaths = Array.isArray(manifest.scripts)
    ? (manifest.scripts as unknown[]).filter((x): x is string => typeof x === "string")
    : [];
  const rewrittenScripts: string[] = [];
  for (const scriptPath of scriptPaths) {
    if (!isCompilablePackScript(scriptPath)) {
      rewrittenScripts.push(scriptPath);
      // Byte-copy the .js into the zip.
      try {
        const bytes = await Bun.file(join(packRoot, scriptPath)).bytes();
        zip.file(scriptPath, bytes);
      } catch (err) {
        console.warn(`[dev-pack] ${packId}: failed to read ${scriptPath}:`, err);
      }
      continue;
    }
    const absSource = join(packRoot, scriptPath);
    try {
      const compiled = await buildPackScript(absSource);
      const compiledPath = compiledPackScriptPath(scriptPath);
      zip.file(compiledPath, compiled);
      rewrittenScripts.push(compiledPath);
    } catch (err) {
      console.warn(
        `[dev-pack] ${packId}: failed to compile ${scriptPath}:`,
        err,
      );
      // Don't emit an empty zip — surface the failure to the caller.
      return null;
    }
  }

  // Copy every `manifest.editorPanels[]` JSON spec verbatim.
  const panelPaths = Array.isArray(manifest.editorPanels)
    ? (manifest.editorPanels as unknown[]).filter(
        (x): x is string => typeof x === "string",
      )
    : [];
  for (const panelPath of panelPaths) {
    try {
      const bytes = await Bun.file(join(packRoot, panelPath)).bytes();
      zip.file(panelPath, bytes);
    } catch (err) {
      console.warn(`[dev-pack] ${packId}: failed to read ${panelPath}:`, err);
    }
  }

  // Copy every `manifest.tutorials[]` JSON file verbatim (T2). Mirrors
  // editorPanels[] — the runtime loader reads each path via
  // `pack.textBody(path)` and registers the parsed TutorialDef with the
  // tutorial registry.
  const tutorialPaths = Array.isArray(manifest.tutorials)
    ? (manifest.tutorials as unknown[]).filter(
        (x): x is string => typeof x === "string",
      )
    : [];
  for (const tutorialPath of tutorialPaths) {
    try {
      const bytes = await Bun.file(join(packRoot, tutorialPath)).bytes();
      zip.file(tutorialPath, bytes);
    } catch (err) {
      console.warn(
        `[dev-pack] ${packId}: failed to read ${tutorialPath}:`,
        err,
      );
    }
  }

  // Emit the manifest with rewritten script paths (.tsx → .js) so the
  // runtime loader's `manifest.scripts[]` lines up with what's in the zip.
  const manifestOut = { ...manifest, scripts: rewrittenScripts };
  zip.file("manifest.json", JSON.stringify(manifestOut, null, 2));

  return await zip.generateAsync({
    type: "uint8array",
    compression: "DEFLATE",
  });
}

/**
 * Return the workspace pack id (manifest.id) for a given workspace
 * source path (e.g. `packages/core-editor-pack/panels/NotesPanel.tsx`).
 * Returns `null` if the path is outside any tracked pack dir.
 */
async function packIdForPath(absPath: string): Promise<string | null> {
  const map = await scanPackDirs();
  for (const [id, dir] of map) {
    if (absPath === dir || absPath.startsWith(dir + "/")) return id;
  }
  return null;
}

/**
 * Watch every workspace pack dir for source changes. Each save under a
 * pack's `panels/`, `views/`, `layouts/`, `scripts/`, `types/`, or the
 * `manifest.json` triggers a callback with the matching pack id.
 *
 * Returns a stop fn that aborts the watcher.
 */
function watchPackDirs(onChange: (packId: string, relPath: string) => void): () => void {
  let stopped = false;
  const ac = new AbortController();
  (async () => {
    const map = await scanPackDirs();
    for (const [packId, dir] of map) {
      // Per-pack watcher. `recursive: true` is required so nested
      // panel files (e.g. `panels/prefabs/EntityListPanel.tsx`) fire.
      (async () => {
        try {
          const watcher = watch(dir, { recursive: true, signal: ac.signal });
          for await (const event of watcher) {
            if (stopped) return;
            const fname = event.filename ?? "";
            // Filter to source files we care about. Skip node_modules
            // / types/pack.d.ts / generated artefacts.
            if (fname.startsWith("node_modules/")) continue;
            if (fname.startsWith("types/")) continue;
            if (fname.endsWith(".d.ts")) continue;
            if (!/\.(tsx?|jsx?|json)$/.test(fname)) continue;
            onChange(packId, fname);
          }
        } catch (err) {
          if ((err as Error).name !== "AbortError") {
            console.warn(`[dev-pack] watcher for ${packId} failed:`, err);
          }
        }
      })();
      void dir;
    }
  })();
  return () => {
    stopped = true;
    ac.abort();
  };
}

/**
 * Currently-connected SSE subscribers. Each entry is the controller
 * for an open ReadableStream so we can push events to every client.
 */
const sseSubscribers = new Set<ReadableStreamDefaultController<Uint8Array>>();
let watcherStarted = false;
let lastEventByPack: Map<string, number> = new Map();

/**
 * Ensure the file watcher is running (lazy — only starts when the first
 * SSE client connects). De-bounce changes per pack at 200ms so a multi-
 * file save (e.g. a refactor) collapses to a single rebuild trigger.
 */
function ensureWatcher(): void {
  if (watcherStarted) return;
  watcherStarted = true;
  watchPackDirs((packId) => {
    // Per-pack debounce.
    const now = Date.now();
    const last = lastEventByPack.get(packId) ?? 0;
    if (now - last < 200) return;
    lastEventByPack.set(packId, now);
    // Invalidate any cached compiled output — buildDevPackBytes
    // recompiles on each request, but a future cache layer hooks here.
    pushSseEvent({ type: "pack-changed", packId });
    console.log(`[dev-pack] change → ${packId}`);
  });
}

function pushSseEvent(payload: unknown): void {
  const line = `data: ${JSON.stringify(payload)}\n\n`;
  const bytes = new TextEncoder().encode(line);
  for (const ctrl of sseSubscribers) {
    try {
      ctrl.enqueue(bytes);
    } catch {
      // Stream closed — clean up on next pass.
      sseSubscribers.delete(ctrl);
    }
  }
}

/**
 * SSE handler — returns a Response carrying a streaming event stream
 * the dev client subscribes to. Each event is JSON of shape
 * `{ "type": "pack-changed", "packId": "..." }`.
 *
 * Heartbeats: Bun.serve's default `idleTimeout` is 10s, so an SSE
 * connection with no events gets torn down with
 * `ERR_INCOMPLETE_CHUNKED_ENCODING`. We push a comment line every 5s
 * to keep the channel warm; the client ignores `:`-prefixed comment
 * frames per the SSE spec.
 */
const SSE_HEARTBEAT_INTERVAL_MS = 5000;
const HEARTBEAT_BYTES = new TextEncoder().encode(": heartbeat\n\n");

export function handleDevHmrSseRequest(): Response {
  ensureWatcher();
  let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  const stream = new ReadableStream<Uint8Array>({
    start(ctrl) {
      sseSubscribers.add(ctrl);
      // Initial comment line keeps the connection warm + tells the
      // client the channel is alive.
      ctrl.enqueue(new TextEncoder().encode(": connected\n\n"));
      heartbeatTimer = setInterval(() => {
        try {
          ctrl.enqueue(HEARTBEAT_BYTES);
        } catch {
          if (heartbeatTimer) clearInterval(heartbeatTimer);
          heartbeatTimer = null;
          sseSubscribers.delete(ctrl);
        }
      }, SSE_HEARTBEAT_INTERVAL_MS);
    },
    cancel(ctrl) {
      if (heartbeatTimer) {
        clearInterval(heartbeatTimer);
        heartbeatTimer = null;
      }
      sseSubscribers.delete(ctrl as ReadableStreamDefaultController<Uint8Array>);
    },
  });
  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream",
      "cache-control": "no-cache, no-transform",
      "x-accel-buffering": "no",
      // SSE doesn't need keepalive but explicit connection close on
      // shutdown is friendly.
      "connection": "keep-alive",
    },
  });
}

/**
 * `true` when the request URL matches the dev HMR SSE route.
 */
export function isDevHmrSseUrl(pathname: string): boolean {
  return pathname === "/__dev/pack-hmr";
}

/**
 * `true` when the request is for an editor pack `.apg` that has a
 * matching workspace source dir we can build in-process.
 */
export async function tryServeDevPackApg(
  pathname: string,
): Promise<Response | null> {
  // Match `/packs/<id>.apg`. Skip non-editor packs (game-side .apg
  // files have their own server route).
  const m = pathname.match(/^\/packs\/([^/]+)\.apg$/);
  if (!m) return null;
  const packId = m[1]!;
  const bytes = await buildDevPackBytes(packId);
  if (!bytes) return null;
  // Cast to ArrayBufferView — TS's Response BodyInit shape is narrow
  // about typed-array subtype, but Bun.serve accepts Uint8Array bytes
  // directly. The cast preserves the typing without copying the buffer.
  return new Response(bytes as unknown as BodyInit, {
    headers: {
      "content-type": "application/zip",
      "cache-control": "no-store",
      // Allow CORS for any local origin (sidecar window etc.).
      "access-control-allow-origin": "*",
    },
  });
}

// Suppress unused-import warning for the `relative` helper — reserved
// for future per-file change-event payloads.
void relative;
void packIdForPath;

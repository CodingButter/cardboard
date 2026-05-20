/**
 * Dev-mode pack HMR client — task #36 / `docs/plans/CORE_EDITOR_PACK.md`
 * §11 risk #2 mitigation (c).
 *
 * Subscribes to the editor server's `/__dev/pack-hmr` SSE channel. On
 * each `pack-changed` event:
 *
 *   1. Call `unloadEditorPack(packId)` — runs every cleanup the pack
 *      registered (panel registrations, view + layout + tab + command
 *      registrations, dynamic stores). Same path the Extensions-tab
 *      live-disable uses, so this exercise validates the dogfooded
 *      unregister flow on every save.
 *   2. Call `loadEditorPack(packId)` — fetches `/packs/<id>.apg` which
 *      the dev server now answers with freshly-compiled bytes (see
 *      `apps/editor/dev/dev-pack-server.ts`). The loader's existing
 *      `inFlightPackLoads` cache was already cleared by `unloadEditorPack`,
 *      so the fetch always goes to the wire.
 *
 * Production behaviour is unchanged: the client only attaches when
 * `import.meta.env.DEV` is true (Bun sets this for `bun --hot`) AND
 * `window.EventSource` exists. A `bun build` production bundle keeps
 * the dev path tree-shake-eligible behind the env-guarded
 * `attachDevHmrClient` call site in `apps/editor/index.tsx`.
 *
 * Why SSE instead of a websocket: SSE is one-way (server → client),
 * matches Bun.serve's existing route shape, and reconnects automatically
 * on transient drops. The editor never needs to push to the watcher.
 */

import { loadEditorPack, unloadEditorPack } from "./editorPackLoader";

/** Shape of a `data: ...` event the SSE channel emits. */
interface PackHmrEvent {
  type: "pack-changed";
  packId: string;
}

let activeSource: EventSource | null = null;

/**
 * Connect to the dev HMR SSE channel. Idempotent — calling twice
 * reuses the existing EventSource. Returns a teardown.
 */
export function attachDevHmrClient(): () => void {
  if (typeof window === "undefined") return () => undefined;
  if (typeof EventSource === "undefined") return () => undefined;
  if (activeSource) return () => undefined;

  const source = new EventSource("/__dev/pack-hmr");
  activeSource = source;

  source.addEventListener("message", (evt) => {
    let payload: PackHmrEvent;
    try {
      payload = JSON.parse(evt.data) as PackHmrEvent;
    } catch {
      return;
    }
    if (payload?.type !== "pack-changed") return;
    void reloadPack(payload.packId);
  });

  source.addEventListener("error", (err) => {
    // SSE auto-reconnects on its own — log but don't tear down.
    console.debug("[dev-pack-hmr] SSE error (auto-reconnect):", err);
  });

  console.log("[dev-pack-hmr] subscribed to /__dev/pack-hmr");

  return () => {
    source.close();
    activeSource = null;
  };
}

async function reloadPack(packId: string): Promise<void> {
  const t0 = performance.now();
  try {
    // Step 1 — tear down every contribution the pack made. This drops
    // panels out of dock instances, unregisters commands, deletes
    // dynamic stores, etc. Same path Extensions-tab live-disable uses.
    unloadEditorPack(packId);
    // Step 2 — fetch a fresh build of the pack (dev server intercepts
    // the .apg URL and returns in-memory compiled bytes) and re-run
    // its setup script. Panels + views + layouts + commands re-attach
    // to the running editor.
    await loadEditorPack(packId);
    const t1 = performance.now();
    console.log(
      `[dev-pack-hmr] reloaded ${packId} in ${(t1 - t0).toFixed(0)}ms`,
    );
  } catch (err) {
    console.error(`[dev-pack-hmr] reload of ${packId} failed:`, err);
  }
}

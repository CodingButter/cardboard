/**
 * Editor → game-runner bridge.
 *
 * When the game runner boots with `?source=editor&projectId=…`,
 * it expects to be in an iframe whose parent is the editor. This
 * module wires the message protocol described in
 * `docs/plans/EDITOR_IFRAME.md` §6:
 *
 *  Editor → iframe:
 *    - switch-scene { path }   → Game.loadScene
 *    - scene-changed { path }  → Game.reloadScene
 *    - pause                   → Game.stop
 *    - resume                  → Game.start
 *    - reset                   → location.reload (iframe rebuilds)
 *    - set-controls { fly, god } → toggle preview-controls flags
 *      (task #17 — PreviewPanel engine toggle). Both flags
 *      default to false; setting `fly: true` lets WASD push the
 *      camera through the world without ground-plane gravity;
 *      `god: true` skips wall collision so the player clips
 *      through geometry. Flags live on a global window slot the
 *      pack-side input system reads at the top of each frame —
 *      see `packages/default-pack/scripts/systems/player-input.js`.
 *
 *  Iframe → editor:
 *    - ready { projectId, scene }
 *    - scene-loaded { path }
 *    - error { message }
 *    - engine-stats { data: EngineStats }  // I2 telemetry (Q5 of
 *      EDITOR_REDESIGN.md §12). Pushed at 10 Hz; consumer is the
 *      editor's Playtest stats panel.
 *
 * Only one bridge is installed per page. Re-installing (HMR) is a
 * no-op — the global listener is keyed on a window symbol so the
 * second registration aborts.
 */

import type { Game, IdbAssetPack } from "@two_5_d/engine";

/**
 * Optional `Game` methods invoked by the bridge. Typed loosely
 * here so this module doesn't have to import every API the engine
 * surfaces — TypeScript checks at the call site that the engine
 * implements the called shape.
 */
interface GameWithSceneOps extends Game {
  loadScene(path: string): Promise<void>;
  reloadScene(path: string): Promise<void>;
}

const INSTALLED = Symbol.for("two_5_d.editorBridgeInstalled");

/**
 * Window slot the pack-side player-input system reads each frame.
 * Task #17 — PreviewPanel preview controls. Set by `set-controls`
 * messages from the editor (and also seeded at boot from URL params
 * `?flyMode=true` / `?godMode=true` so screenshots / share links can
 * pre-arm the modes). The pack reads via `window.__cardboardEditorPreviewControls`
 * — see player-input.js. The slot is intentionally untyped at the
 * `Window` level so pack code (vanilla JS) doesn't need a type
 * augmentation just to consume it.
 */
interface PreviewControlsSlot {
  fly: boolean;
  god: boolean;
}

const PREVIEW_CONTROLS_GLOBAL = "__cardboardEditorPreviewControls";

interface InstalledWindow extends Window {
  [INSTALLED]?: true;
  [PREVIEW_CONTROLS_GLOBAL]?: PreviewControlsSlot;
}

/**
 * Wire up the message listener + post the `ready` handshake.
 *
 * Validates each inbound message's `event.source` against
 * `window.parent` — same-origin guarantees the parent is the
 * editor, but a defensive equality check stops stray postMessages
 * from arbitrary iframes inside the editor (none today, future-
 * proof).
 */
export function installEditorBridge(
  game: GameWithSceneOps,
  projectId: string,
  pack: IdbAssetPack,
  startScenePath: string,
): void {
  const w = window as InstalledWindow;
  if (w[INSTALLED]) return;
  w[INSTALLED] = true;

  // Seed preview-controls slot from URL params so the engine respects
  // `?flyMode=true` / `?godMode=true` even before any postMessage
  // arrives. The PreviewPanel embeds the iframe with these params on
  // every src rebuild; the postMessage handler below mutates the same
  // slot in place when the user toggles a control mid-session.
  if (!w[PREVIEW_CONTROLS_GLOBAL]) {
    const params = new URLSearchParams(window.location.search);
    w[PREVIEW_CONTROLS_GLOBAL] = {
      fly: params.get("flyMode") === "true",
      god: params.get("godMode") === "true",
    };
  }

  function post(msg: Record<string, unknown>): void {
    // `*` is safe because we are same-origin with the editor
    // (the editor verifies `event.source === iframe.contentWindow`).
    window.parent.postMessage(msg, "*");
  }

  window.addEventListener("message", async (ev) => {
    if (ev.source !== window.parent) return;
    const data = ev.data;
    if (!data || typeof data !== "object" || typeof data.type !== "string") return;
    try {
      switch (data.type) {
        case "switch-scene": {
          if (typeof data.path !== "string") return;
          // Asset paths can shift between message round-trips — the
          // editor may have added scenes since we built the pack.
          // Refresh the path index so `pack.has(path)` is accurate.
          await pack.refreshPathIndex();
          await game.loadScene(data.path);
          post({ type: "scene-loaded", path: data.path });
          break;
        }
        case "scene-changed": {
          if (typeof data.path !== "string") return;
          await pack.refreshPathIndex();
          await game.reloadScene(data.path);
          post({ type: "scene-loaded", path: data.path });
          break;
        }
        case "pause": {
          game.stop();
          break;
        }
        case "resume": {
          game.start();
          break;
        }
        case "reset": {
          // Iframe-level reload is the simplest correct reset — every
          // engine subsystem rebuilds from IDB + manifest in the
          // process. Editor sends this when the user hits a "Reset"
          // button or manifest changes in I3.
          window.location.reload();
          break;
        }
        case "set-controls": {
          // Task #17 — toggle preview controls (fly / god) without
          // reloading. The pack-side input system reads the slot at
          // the top of each frame so the change applies on the next
          // tick. Missing keys leave the previous value intact —
          // editor only toggles one at a time but partial updates
          // are valid.
          const slot = w[PREVIEW_CONTROLS_GLOBAL] ?? { fly: false, god: false };
          if (typeof data.fly === "boolean") slot.fly = data.fly;
          if (typeof data.god === "boolean") slot.god = data.god;
          w[PREVIEW_CONTROLS_GLOBAL] = slot;
          break;
        }
        // load-project, script-changed, manifest-changed, set-mode
        // are I2/I3 (EDITOR_IFRAME.md §6); accept silently for now.
      }
    } catch (err) {
      const message = (err as Error)?.message ?? String(err);
      console.error("editor-bridge: handler threw —", err);
      post({ type: "error", message });
    }
  });

  // Tell the editor the engine is up so the "Booting…" overlay
  // can clear. The startScenePath is whatever the boot path
  // resolved (either explicit `?scene=` or `manifest.startScene`).
  post({ type: "ready", projectId, scene: startScenePath });
  // Mirror the ready as a scene-loaded so the editor can highlight
  // the active scene row in its sidebar.
  post({ type: "scene-loaded", path: startScenePath });

  // I2 telemetry channel — Q5 of EDITOR_REDESIGN.md §12. Push the
  // engine's stats snapshot (`api.debug.stats()`) to the parent at
  // 10 Hz. The collector smooths fps / frameMs internally over a
  // 1s window so the editor's Playtest panel can render a stable
  // number without its own debouncing. The interval lives for the
  // page's lifetime (no detach needed — iframe disposal stops it).
  const STATS_INTERVAL_MS = 100; // 10 Hz
  setInterval(() => {
    const data = game.api.debug.stats();
    post({ type: "engine-stats", data });
  }, STATS_INTERVAL_MS);
}

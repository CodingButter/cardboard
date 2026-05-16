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
 *
 *  Iframe → editor:
 *    - ready { projectId, scene }
 *    - scene-loaded { path }
 *    - error { message }
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

interface InstalledWindow extends Window {
  [INSTALLED]?: true;
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
}

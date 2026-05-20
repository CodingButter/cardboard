/**
 * activeDockApis — global registry of mounted `DockviewApi` instances.
 *
 * Lets the editor-pack loader's LIVE UNREGISTER path (see
 * `editorPackLoader.unloadEditorPack`) walk every currently-mounted
 * DockShell and call `api.removePanel(panelId)` for each panel the
 * disabled pack contributed. Without this, a pack-disable would drop
 * the panel from the registry but leave any already-mounted instance
 * stranded — the user would see a panel whose React component is no
 * longer in the registry's map until the next reload.
 *
 * Lifecycle: `<DockShell/>`'s `handleReady` callback calls
 * `registerActiveDockApi(api)` and the matching cleanup calls
 * `unregisterActiveDockApi(api)`. The registry is module-scoped per
 * window — popouts that mount their own DockShell get their own api
 * tracked here too.
 *
 * Why a plain `Set` and not a Zustand store: nothing subscribes to
 * the set reactively. The loader walks it imperatively when a pack
 * disables, and DockShell mutates it on mount/unmount. A store would
 * be over-engineering for a registry that's read once per disable.
 */

import type { DockviewApi } from "dockview";

const activeApis = new Set<DockviewApi>();

/** Register a live DockviewApi. Call from `DockShell.handleReady`. */
export function registerActiveDockApi(api: DockviewApi): void {
  activeApis.add(api);
}

/** Unregister a live DockviewApi. Call from `DockShell`'s ready-cleanup. */
export function unregisterActiveDockApi(api: DockviewApi): void {
  activeApis.delete(api);
}

/**
 * Remove a panel with the given id from EVERY currently-mounted
 * DockShell. Safe to call when the panel isn't mounted anywhere
 * (dockview's `removePanel` on a missing id is silently dropped via
 * the surrounding try/catch).
 *
 * Returns the number of panels actually removed — useful for the
 * caller to log "n mounted panels of disabled pack X were removed".
 */
export function removePanelFromAllDockApis(panelId: string): number {
  let removed = 0;
  for (const api of activeApis) {
    const panel = api.getPanel(panelId);
    if (!panel) continue;
    try {
      api.removePanel(panel);
      removed += 1;
    } catch (err) {
      console.warn(
        `[activeDockApis] removePanel("${panelId}") threw —`,
        err,
      );
    }
  }
  return removed;
}

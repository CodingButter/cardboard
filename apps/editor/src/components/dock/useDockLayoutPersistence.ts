import { useCallback, useEffect, useRef, useState } from "react";
import type { DockviewApi, SerializedDockview } from "dockview";
import { useWorkspaceStore } from "../../state/useWorkspaceStore";

/**
 * useDockLayoutPersistence — per-page round-trip for a dockview layout
 * JSON snapshot. Used by `<DockShell/>`.
 *
 * Previously this hook owned its own `localStorage.getItem` /
 * `setItem` calls keyed by `cardboard_editor_dock_layout_<storageKey>`.
 * It now reads + writes through the workspace store
 * (`useWorkspaceStore`) so dock layouts ride the same persistence
 * boundary as user-saved layout presets. The store's
 * `onRehydrateStorage` hook migrates the old `localStorage` entries
 * into the store on first load so saved layouts survive the change.
 *
 * Contract (unchanged from the previous implementation):
 *   - `initial` is the snapshot read at mount time, or `null` if no
 *     saved state.
 *   - `save(api)` persists the current `api.toJSON()` snapshot. Wired
 *     to dockview's `onDidLayoutChange` by `<DockShell/>`.
 *
 * The hook reads the store's value exactly once at mount and stashes
 * it as `initial` — DockShell uses this in `fromJSON` and we don't
 * want subscriptions thrashing the dockview component after that.
 * Writes go through `setDockLayout(...)` on every layout change.
 */

export interface DockLayoutPersistence {
  /** The snapshot read at mount time, or `null` if no saved state. */
  readonly initial: SerializedDockview | null;
  /** Persist the api's current layout. Cheap — debouncing not needed
   *  at this volume; the store write is synchronous + the persist
   *  middleware writes localStorage once per change. */
  readonly save: (api: DockviewApi) => void;
}

export function useDockLayoutPersistence(
  storageKey: string,
): DockLayoutPersistence {
  const setDockLayout = useWorkspaceStore((s) => s.setDockLayout);

  // Read the saved layout once at mount. We pull straight from the
  // store via `getState()` so we don't subscribe (which would force
  // a re-render whenever any other consumer touches the same slice).
  // The value is captured as state so a remount with a different
  // `storageKey` re-reads cleanly.
  const [initial] = useState<SerializedDockview | null>(() => {
    if (typeof window === "undefined") return null;
    try {
      const slice = useWorkspaceStore.getState().dockLayouts;
      return slice[storageKey] ?? null;
    } catch {
      return null;
    }
  });

  // Keep the key in a ref so `save` doesn't need to re-bind on every
  // render of the consumer.
  const keyRef = useRef(storageKey);
  useEffect(() => {
    keyRef.current = storageKey;
  }, [storageKey]);

  const save = useCallback(
    (api: DockviewApi) => {
      try {
        const snapshot = api.toJSON();
        setDockLayout(keyRef.current, snapshot);
      } catch {
        // Serialization errors are non-fatal — the user simply won't
        // get layout persistence this session.
      }
    },
    [setDockLayout],
  );

  return { initial, save };
}

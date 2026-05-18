import { useCallback, useEffect, useRef, useState } from "react";
import type { DockviewApi, SerializedDockview } from "dockview";

/**
 * useDockLayoutPersistence — per-page `localStorage` round-trip for a
 * dockview layout JSON snapshot. Used by `<DockShell/>`.
 *
 * Storage key shape: `cardboard_editor_dock_layout_<storageKey>`.
 *
 * Why localStorage and not IndexedDB: dockview's layout JSON is a few
 * hundred bytes per page even with popout groups; the synchronous read
 * on first paint avoids a flash of empty layout before
 * `fromJSON` fires. We can promote to IDB later if multi-tab sync or
 * cross-device sync is needed — the hook's surface is small enough to
 * swap the backing store without touching call sites.
 *
 * Contract:
 *   - `read()` reads the saved JSON once at mount time. Returns `null`
 *     when no key exists or the JSON fails to parse (corruption guard
 *     so a stale entry can't permawedge the page).
 *   - `save(api)` persists the current `api.toJSON()` snapshot. Wired
 *     to dockview's `onDidLayoutChange` by `<DockShell/>`.
 */

const PREFIX = "cardboard_editor_dock_layout_";

function buildKey(storageKey: string): string {
  return `${PREFIX}${storageKey}`;
}

export interface DockLayoutPersistence {
  /** The snapshot read at mount time, or `null` if no saved state. */
  readonly initial: SerializedDockview | null;
  /** Persist the api's current layout. Cheap — debouncing not needed
   *  at this volume; localStorage writes are synchronous and fast on
   *  the editor-sized JSON we emit. */
  readonly save: (api: DockviewApi) => void;
}

export function useDockLayoutPersistence(
  storageKey: string,
): DockLayoutPersistence {
  // Read the saved layout once at mount. We use a ref + useState so the
  // initial value is stable across renders (the JSON read happens
  // exactly once), and so a remount with a different `storageKey`
  // re-reads cleanly.
  const [initial] = useState<SerializedDockview | null>(() => {
    if (typeof window === "undefined") return null;
    try {
      const raw = localStorage.getItem(buildKey(storageKey));
      if (!raw) return null;
      const parsed = JSON.parse(raw) as SerializedDockview;
      return parsed;
    } catch {
      // Corrupted entry — drop it so subsequent saves land clean.
      try {
        localStorage.removeItem(buildKey(storageKey));
      } catch {
        // ignore
      }
      return null;
    }
  });

  // Keep the key in a ref so `save` doesn't need to re-bind on every
  // render of the consumer.
  const keyRef = useRef(buildKey(storageKey));
  useEffect(() => {
    keyRef.current = buildKey(storageKey);
  }, [storageKey]);

  const save = useCallback((api: DockviewApi) => {
    try {
      const snapshot = api.toJSON();
      localStorage.setItem(keyRef.current, JSON.stringify(snapshot));
    } catch {
      // Quota errors / serialization errors are non-fatal — the user
      // simply won't get layout persistence this session.
    }
  }, []);

  return { initial, save };
}

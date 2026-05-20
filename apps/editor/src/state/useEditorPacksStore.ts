import { createSyncedStore } from "./sync";

/**
 * useEditorPacksStore — installed-editor-pack registry.
 *
 * Phase 2 of the EDITOR_ENGINE plan (`docs/plans/EDITOR_ENGINE.md` §8).
 * Replaces the hardcoded `EDITOR_PACK_IDS` list in `editorPackLoader.ts`
 * with a user-configurable set persisted to localStorage. Surfaced
 * through the Editor Settings → Extensions tab, where users toggle
 * individual packs on/off; on next reload the loader reads
 * `useEditorPacksStore.getState().packs` filtered by `enabled === true`.
 *
 * Storage key: `cardboard.sync.editor-packs`. Goes through
 * `createSyncedStore` so popouts and the orchestrator see the same
 * enabled set (the storage event fires across same-origin windows).
 *
 * INITIAL STATE
 * -------------
 * Ships with `cardboard-editor-pack-demo` already installed + enabled.
 * That matches the hardcoded loader behaviour the store is replacing —
 * users opening the editor for the first time still get the demo pack
 * without any setup.
 *
 * METADATA CACHING
 * ----------------
 * The loader populates each entry's `meta` (name / version / panel
 * count) after a successful load. The Extensions tab reads this cache
 * so it can display real metadata BEFORE the next async load completes
 * (e.g. on the first render after a page reload, the previous run's
 * meta is still visible).
 *
 * `meta` is `null` for packs that have never loaded yet. UI should fall
 * back to the pack id in that case.
 */

export interface EditorPackMeta {
  /** Author-declared display name (manifest.name). */
  name: string;
  /** Author-declared version (manifest.version). */
  version: string;
  /** Count of contributed editor panels (manifest.editorPanels.length). */
  panelCount: number;
}

export interface EditorPackEntry {
  id: string;
  enabled: boolean;
  /**
   * Pack-author metadata cached from the last successful load.
   * `null` for packs that have never loaded yet (e.g. a freshly-toggled
   * pack on first run). Populated by `editorPackLoader.ts`, NOT by the
   * UI; the Extensions tab treats `meta` as read-only display state.
   */
  meta: EditorPackMeta | null;
}

export interface EditorPacksStateData {
  /**
   * Keyed by pack id. Iteration order is insertion order
   * (Object.keys → modern-JS insertion-order guarantee), so newest
   * installs appear last in the Extensions list.
   */
  packs: Record<string, EditorPackEntry>;
}

export interface EditorPacksStateActions {
  /** Flip the `enabled` flag for one pack. No-op if the id is unknown. */
  setEnabled: (id: string, enabled: boolean) => void;
  /**
   * Cache pack-author metadata after a successful load. Called by the
   * loader; UI components should not invoke this directly. No-op if
   * the id is unknown.
   */
  setMeta: (id: string, meta: EditorPackEntry["meta"]) => void;
}

export type EditorPacksState = EditorPacksStateData & EditorPacksStateActions;

/** Initial state — ships with the demo pack installed + enabled. */
const INITIAL_STATE: EditorPacksStateData = {
  packs: {
    "cardboard-editor-pack-demo": {
      id: "cardboard-editor-pack-demo",
      enabled: true,
      meta: null,
    },
  },
};

export const useEditorPacksStore = createSyncedStore<
  EditorPacksStateData,
  EditorPacksStateActions
>(
  "editor-packs",
  INITIAL_STATE,
  (set) => ({
    setEnabled: (id, enabled) => {
      set((s) => {
        const entry = s.packs[id];
        if (!entry) return s;
        return {
          packs: { ...s.packs, [id]: { ...entry, enabled } },
        };
      });
    },
    setMeta: (id, meta) => {
      set((s) => {
        const entry = s.packs[id];
        if (!entry) return s;
        return {
          packs: { ...s.packs, [id]: { ...entry, meta } },
        };
      });
    },
  }),
  {
    // Editor packs are user-scoped editor preferences — durable
    // localStorage is the right transport. No BroadcastChannel needed;
    // the storage event already replicates across same-origin popouts.
    enableBroadcast: false,
  },
);

/**
 * Snapshot of the enabled set as an ordered list of pack ids. Used by
 * the loader at startup to decide which `.apg` files to fetch.
 *
 * Returns a NEW array each call (callers expecting referential equality
 * across renders should `useMemo` or pull from a selector). Order is
 * the insertion order of `packs` — newest installs last.
 */
export function getEnabledEditorPackIds(): string[] {
  const { packs } = useEditorPacksStore.getState();
  return Object.values(packs)
    .filter((entry) => entry.enabled)
    .map((entry) => entry.id);
}

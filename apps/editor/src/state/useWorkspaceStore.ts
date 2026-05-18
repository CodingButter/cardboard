import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import type { SerializedDockview } from "dockview";

/**
 * useWorkspaceStore — the editor's workspace persistence layer.
 *
 * Two slices share this store so they survive in a single source of
 * truth and live behind a single zustand persist boundary:
 *
 *   1. `presets`     — per-page named layout snapshots the user
 *                      captured via "Save Layout" in the Workspace
 *                      rail. Keyed by `pageId` (e.g. `"scene"`,
 *                      `"image-lab"`); each page has its own preset
 *                      list because layouts aren't portable across
 *                      page chrome (different panels exist on
 *                      different pages).
 *
 *   2. `dockLayouts` — the live dockview layout JSON per `storageKey`
 *                      (e.g. `"scene::<projectId>"`). Replaces the
 *                      ad-hoc `localStorage.setItem` writes the
 *                      `useDockLayoutPersistence` hook used to do
 *                      directly; the hook now reads/writes through
 *                      this store so dock layouts ride the same
 *                      persistence boundary as presets.
 *
 * Persistence: `zustand/middleware`'s `persist` middleware backed by
 * localStorage under the key `cardboard_workspace`. The whole store
 * round-trips as a single JSON blob, so future migration to a hybrid
 * local-plus-remote (Supabase) adapter is a one-line swap of
 * `createJSONStorage(() => localStorage)` for a custom `StateStorage`
 * — call sites (the hook, the workspace panel) keep their existing
 * API and don't need to change.
 *
 * Migration: on first load we hoist any pre-existing
 * `cardboard_editor_dock_layout_*` localStorage entries into
 * `dockLayouts` (one-time, then the old keys are removed). See
 * `migrateLegacyDockLayouts` below.
 */

export type DockLayoutJSON = SerializedDockview;

export interface WorkspacePreset {
  readonly id: string;
  readonly name: string;
  readonly createdAt: number;
  readonly layout: DockLayoutJSON;
}

export interface WorkspaceState {
  presets: Record<string, WorkspacePreset[]>;
  dockLayouts: Record<string, DockLayoutJSON | null>;
  savePreset: (
    pageId: string,
    name: string,
    layout: DockLayoutJSON,
  ) => WorkspacePreset;
  renamePreset: (pageId: string, id: string, name: string) => void;
  deletePreset: (pageId: string, id: string) => void;
  setDockLayout: (
    storageKey: string,
    layout: DockLayoutJSON | null,
  ) => void;
}

const STORAGE_NAME = "cardboard_workspace";
const STORAGE_VERSION = 1;
const LEGACY_PREFIX = "cardboard_editor_dock_layout_";

/**
 * Generate a unique id for a preset. Prefers `crypto.randomUUID` and
 * falls back to a timestamp+random hex string for very old browsers
 * or non-secure contexts where `crypto.randomUUID` is unavailable.
 */
function genId(): string {
  try {
    if (
      typeof crypto !== "undefined" &&
      typeof crypto.randomUUID === "function"
    ) {
      return crypto.randomUUID();
    }
  } catch {
    // ignore — fall through to the fallback
  }
  return `p_${Date.now().toString(36)}_${Math.random()
    .toString(36)
    .slice(2, 10)}`;
}

/**
 * One-time migration — sweep up any pre-existing
 * `cardboard_editor_dock_layout_*` entries from `localStorage`,
 * promote them into the store's `dockLayouts` slice, and remove the
 * old keys. Returns the map of imported entries so the caller can
 * merge them into the in-memory store state on first load.
 */
function migrateLegacyDockLayouts(): Record<string, DockLayoutJSON> {
  const out: Record<string, DockLayoutJSON> = {};
  if (typeof window === "undefined" || typeof localStorage === "undefined")
    return out;
  try {
    const toRemove: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key) continue;
      if (!key.startsWith(LEGACY_PREFIX)) continue;
      const storageKey = key.slice(LEGACY_PREFIX.length);
      const raw = localStorage.getItem(key);
      if (!raw) {
        toRemove.push(key);
        continue;
      }
      try {
        const parsed = JSON.parse(raw) as DockLayoutJSON;
        out[storageKey] = parsed;
      } catch {
        // corrupt — drop it
      }
      toRemove.push(key);
    }
    for (const k of toRemove) {
      try {
        localStorage.removeItem(k);
      } catch {
        // ignore
      }
    }
  } catch {
    // localStorage access denied — nothing to migrate.
  }
  return out;
}

export const useWorkspaceStore = create<WorkspaceState>()(
  persist(
    (set, get) => ({
      presets: {},
      dockLayouts: {},
      savePreset: (pageId, name, layout) => {
        const preset: WorkspacePreset = {
          id: genId(),
          name: name.trim() || "Untitled layout",
          createdAt: Date.now(),
          layout,
        };
        const current = get().presets[pageId] ?? [];
        set((s) => ({
          presets: { ...s.presets, [pageId]: [...current, preset] },
        }));
        return preset;
      },
      renamePreset: (pageId, id, name) => {
        const current = get().presets[pageId] ?? [];
        const trimmed = name.trim();
        if (!trimmed) return;
        const next = current.map((p) =>
          p.id === id ? { ...p, name: trimmed } : p,
        );
        set((s) => ({ presets: { ...s.presets, [pageId]: next } }));
      },
      deletePreset: (pageId, id) => {
        const current = get().presets[pageId] ?? [];
        const next = current.filter((p) => p.id !== id);
        set((s) => ({ presets: { ...s.presets, [pageId]: next } }));
      },
      setDockLayout: (storageKey, layout) => {
        set((s) => ({
          dockLayouts: { ...s.dockLayouts, [storageKey]: layout },
        }));
      },
    }),
    {
      name: STORAGE_NAME,
      version: STORAGE_VERSION,
      storage: createJSONStorage(() => localStorage),
      // Persist only the data — don't try to round-trip the action
      // functions. zustand strips functions automatically but being
      // explicit avoids surprises with hydration.
      partialize: (state) => ({
        presets: state.presets,
        dockLayouts: state.dockLayouts,
      }),
      // Merge any legacy `cardboard_editor_dock_layout_*` entries
      // into the hydrated state. Runs once per page load — after
      // the migration the old keys are gone, so subsequent loads
      // are no-ops.
      onRehydrateStorage: () => (state) => {
        if (!state) return;
        const legacy = migrateLegacyDockLayouts();
        if (Object.keys(legacy).length === 0) return;
        state.dockLayouts = { ...legacy, ...state.dockLayouts };
      },
    },
  ),
);

/** Selector helper — read the preset list for a page. Stable
 *  reference when the underlying array doesn't change (zustand's
 *  default Object.is comparison). */
export function selectPresetsForPage(
  pageId: string,
): (state: WorkspaceState) => WorkspacePreset[] {
  return (state) => state.presets[pageId] ?? [];
}

/** Selector helper — read the persisted layout for a storage key. */
export function selectDockLayout(
  storageKey: string,
): (state: WorkspaceState) => DockLayoutJSON | null {
  return (state) => state.dockLayouts[storageKey] ?? null;
}

import { createSyncedStore } from "./sync";

/**
 * useSceneStore — the editor's scene data store.
 *
 * Owns the painted cells of the current scene + scene-level settings
 * (name, fog, ambient). Cells are stored SPARSELY as `Record<string,
 * SceneCell>` keyed by `"x,y"` — empty cells are simply absent from the
 * map. This keeps the persisted payload small for sparse levels and
 * makes Object.keys()-style iteration cheap.
 *
 * Each cell carries per-layer tile preset assignments (a cell can have
 * a floor + wall + ceiling preset simultaneously), plus optional
 * cell-level metadata (height, tags, properties).
 *
 * Performance note: high-frequency paint operations (e.g. drag-paint
 * across many cells) MUST be batched at the panel layer. The store's
 * setters are designed for single-cell granularity; calling `paintCell`
 * once per mousemove on a 100-cell drag will replay 100 LS writes +
 * 100 storage events. Recommended pattern: accumulate dragged cells in
 * a local ref, commit them in one `set` on mouseup. (A future
 * `paintCells` bulk action can be added if drag-paint becomes
 * common, but Wave 3 leaves that to the panel.)
 *
 * Persistence: localStorage under `cardboard.sync.scene`. The
 * `partialize` hook persists `cells` + `settings` only. `dims` is
 * effectively a const today (no resize UI yet); persist when resize
 * becomes a feature.
 */

export interface SceneCell {
  /** Per-layer tile preset id. E.g. `{ floors: "floor-stone",
   *  walls: "wall-brick" }`. Missing layer keys = unset on that layer. */
  layers: Record<string, string>;
  height: number;
  tags: string[];
  properties: Record<string, unknown>;
}

export interface SceneSettings {
  name: string;
  /** 0..1 fog density. */
  fog: number;
  /** 0..1 ambient light level. */
  ambient: number;
}

export interface SceneStateData {
  dims: { w: number; h: number };
  cells: Record<string, SceneCell>;
  settings: SceneSettings;
}

export interface SceneStateActions {
  paintCell: (x: number, y: number, layerId: string, presetId: string) => void;
  eraseCell: (x: number, y: number, layerId: string) => void;
  setCellHeight: (x: number, y: number, h: number) => void;
  toggleCellTag: (x: number, y: number, tag: string) => void;
  setProperty: (x: number, y: number, key: string, value: unknown) => void;
  setSettings: (partial: Partial<SceneSettings>) => void;
}

export type SceneState = SceneStateData & SceneStateActions;

const INITIAL: SceneStateData = {
  dims: { w: 64, h: 64 },
  cells: {},
  settings: {
    name: "level-01",
    fog: 0.25,
    ambient: 0.35,
  },
};

export function cellKey(x: number, y: number): string {
  return `${x},${y}`;
}

function emptyCell(): SceneCell {
  return { layers: {}, height: 0, tags: [], properties: {} };
}

export const useSceneStore = createSyncedStore<
  SceneStateData,
  SceneStateActions
>(
  "scene",
  INITIAL,
  (set) => ({
    paintCell: (x, y, layerId, presetId) => {
      const key = cellKey(x, y);
      set((s) => {
        const existing = s.cells[key] ?? emptyCell();
        const nextCell: SceneCell = {
          ...existing,
          layers: { ...existing.layers, [layerId]: presetId },
        };
        return { cells: { ...s.cells, [key]: nextCell } };
      });
    },
    eraseCell: (x, y, layerId) => {
      const key = cellKey(x, y);
      set((s) => {
        const existing = s.cells[key];
        if (!existing) return s;
        const nextLayers = { ...existing.layers };
        delete nextLayers[layerId];
        const nextCells = { ...s.cells };
        // If the cell has nothing left on any layer AND no metadata,
        // drop it entirely so the sparse map stays sparse.
        const hasLayers = Object.keys(nextLayers).length > 0;
        const hasMeta =
          existing.height !== 0 ||
          existing.tags.length > 0 ||
          Object.keys(existing.properties).length > 0;
        if (!hasLayers && !hasMeta) {
          delete nextCells[key];
        } else {
          nextCells[key] = { ...existing, layers: nextLayers };
        }
        return { cells: nextCells };
      });
    },
    setCellHeight: (x, y, h) => {
      const key = cellKey(x, y);
      set((s) => {
        const existing = s.cells[key] ?? emptyCell();
        return {
          cells: { ...s.cells, [key]: { ...existing, height: h } },
        };
      });
    },
    toggleCellTag: (x, y, tag) => {
      const key = cellKey(x, y);
      set((s) => {
        const existing = s.cells[key] ?? emptyCell();
        const hasTag = existing.tags.includes(tag);
        const nextTags = hasTag
          ? existing.tags.filter((t) => t !== tag)
          : [...existing.tags, tag];
        return {
          cells: { ...s.cells, [key]: { ...existing, tags: nextTags } },
        };
      });
    },
    setProperty: (x, y, key, value) => {
      const k = cellKey(x, y);
      set((s) => {
        const existing = s.cells[k] ?? emptyCell();
        const nextProps = { ...existing.properties };
        if (value === undefined) {
          delete nextProps[key];
        } else {
          nextProps[key] = value;
        }
        return {
          cells: { ...s.cells, [k]: { ...existing, properties: nextProps } },
        };
      });
    },
    setSettings: (partial) =>
      set((s) => ({ settings: { ...s.settings, ...partial } })),
  }),
  {
    enableBroadcast: false,
    // Persist cells + settings only. `dims` is an effective const today;
    // when scene-resize lands, include it in the persisted slice.
    partialize: (state) => ({
      cells: state.cells,
      settings: state.settings,
    }),
  },
);

/** Non-React getter for imperative call sites. */
export function getSceneState(): SceneState {
  return useSceneStore.getState();
}

/** Helper: read a cell by coord. Returns `undefined` for empty cells. */
export function getCellAt(x: number, y: number): SceneCell | undefined {
  return useSceneStore.getState().cells[cellKey(x, y)];
}

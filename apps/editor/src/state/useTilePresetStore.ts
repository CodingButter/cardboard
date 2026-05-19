import { createSyncedStore } from "./sync";
import type { TilePresetCategory } from "../views/scene/scene-fixtures";

/**
 * useTilePresetStore — the editor's active tile preset selection.
 *
 * Owns:
 *   - `activeId` — preset id to paint with when the active tool is paint
 *     (or anything else that consumes a tile preset).
 *   - `activeCategory` — the category filter the TilePresets panel is
 *     showing. `"all"` means no filter.
 *
 * Wave 3 panel wiring: TilePresetsPanel reads + writes both fields;
 * MapCanvas reads `activeId` to know what to paint.
 *
 * Persistence: localStorage under `cardboard.sync.tile-preset`.
 */

export type TilePresetCategoryFilter = TilePresetCategory | "all";
export type { TilePresetCategory };

export interface TilePresetStateData {
  activeId: string;
  activeCategory: TilePresetCategoryFilter;
}

export interface TilePresetStateActions {
  setActiveId: (id: string) => void;
  setActiveCategory: (cat: TilePresetCategoryFilter) => void;
}

export type TilePresetState = TilePresetStateData & TilePresetStateActions;

const INITIAL: TilePresetStateData = {
  activeId: "wall-brick",
  activeCategory: "all",
};

export const useTilePresetStore = createSyncedStore<
  TilePresetStateData,
  TilePresetStateActions
>(
  "tile-preset",
  INITIAL,
  (set) => ({
    setActiveId: (id) => set({ activeId: id }),
    setActiveCategory: (cat) => set({ activeCategory: cat }),
  }),
  {
    enableBroadcast: false,
  },
);

/** Non-React getter for imperative call sites. */
export function getTilePresetState(): TilePresetState {
  return useTilePresetStore.getState();
}

import { createSyncedStore } from "./sync";
import type { TilePresetCategory } from "../views/scene/scene-fixtures";

/**
 * useTilePresetRegistryStore — read-only registry of every tile preset
 * the active pack ships, keyed by preset id.
 *
 * This is the CONTENT side of the tile-preset story. UI selection state
 * (`activeId`, `activeCategory`) still lives in `useTilePresetStore`;
 * keeping them apart means panels that only need "what's the active
 * id" don't re-render when the registry repopulates on hydration, and
 * panels that only need to look up a preset's color don't re-render
 * when the active id flips.
 *
 * Population — `hydrateStoresFromIdb` reads `manifest.tilePresets[]`,
 * parses every JSONC file, walks `manifest.tileTextures` for the
 * legacy compat shim, and writes the resulting registry here in one
 * `setState`. The registry is REPLACED on each hydrate, never merged —
 * switching projects must not leak presets from the previous pack.
 *
 * Color — the registry persists a derived color per preset so MapCanvas
 * / Minimap / Preview can render distinct visuals per preset (not per
 * layer). Color is derived from the texture path + category: walls
 * trend blue-gray, floors brown, ceilings gray, with per-preset hue
 * shifts driven by a stable hash of the texture path. Future passes
 * will replace this with actual texture-atlas sampling.
 *
 * Persistence — NONE. The registry is rebuilt from IDB on every
 * hydrate, so persisting it would just waste localStorage quota and
 * complicate the cross-window contract. `partialize: () => ({})` lets
 * the synced store machinery still work without persisting anything.
 */

export interface TilePresetRegistryEntry {
  /** Preset id (e.g. `"brick.wall"`, `"floor.stone"`, `"__legacy.1"`). */
  id: string;
  /** Display label. Defaults to the id when no `displayName` is present. */
  name: string;
  /** Bucket derived from the source JSONC filename. */
  category: TilePresetCategory;
  /** Pack-relative texture path. Used both as a content hint and as the
   *  hash input for color derivation. */
  texture: string;
  /** Derived `#RRGGBB` color used by MapCanvas / Minimap / Preview when
   *  rendering cells that reference this preset. Distinct per preset so
   *  two presets on the same layer can be told apart visually. */
  color: string;
}

export interface TilePresetRegistryStateData {
  /** Registry by preset id. Replaced wholesale on hydrate. */
  presets: Record<string, TilePresetRegistryEntry>;
}

export interface TilePresetRegistryStateActions {
  /** Replace the entire registry. Called by hydration only — panel
   *  code is read-only against this store. */
  replaceAll: (presets: Record<string, TilePresetRegistryEntry>) => void;
}

export type TilePresetRegistryState =
  TilePresetRegistryStateData & TilePresetRegistryStateActions;

const INITIAL: TilePresetRegistryStateData = {
  presets: {},
};

export const useTilePresetRegistryStore = createSyncedStore<
  TilePresetRegistryStateData,
  TilePresetRegistryStateActions
>(
  "tile-preset-registry",
  INITIAL,
  (set) => ({
    replaceAll: (presets) => set({ presets }),
  }),
  {
    enableBroadcast: false,
    // Registry is rebuilt on every hydrate — persisting it adds zero
    // value and complicates the cross-window contract.
    partialize: () => ({}),
  },
);

/** Non-React getter for imperative call sites. */
export function getTilePresetRegistryState(): TilePresetRegistryState {
  return useTilePresetRegistryStore.getState();
}

/**
 * Convenience lookup — returns the registry entry for `id`, or
 * `undefined` if no preset is registered under that id. Falls back
 * gracefully (no throw) so callers that race against hydration just
 * see "no color yet" rather than crashing.
 */
export function getPresetEntry(
  id: string | undefined | null,
): TilePresetRegistryEntry | undefined {
  if (!id) return undefined;
  return useTilePresetRegistryStore.getState().presets[id];
}

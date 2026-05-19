import { createSyncedStore } from "./sync";

/**
 * useLayerStore — the editor's layer manager.
 *
 * Owns:
 *   - `activeId` — the currently active layer; paint / erase ops target
 *     this layer in MapCanvas + the scene store.
 *   - `visibility` — per-layer visibility flag, keyed by layer id.
 *   - `order` — display order (top-to-bottom in the LayersPanel,
 *     bottom-to-top in render order). Layer ids appear here exactly
 *     once.
 *   - `customLayers` — layers added at runtime (beyond `MOCK_LAYERS`).
 *     Persisted so user-added layers survive reloads.
 *
 * Wave 3 panel wiring: LayersPanel reads + writes everything;
 * MapCanvas reads `activeId` for paint targeting and `visibility` for
 * filtering rendered cells.
 *
 * Persistence: localStorage under `cardboard.sync.layer`.
 */

export interface CustomLayer {
  id: string;
  name: string;
  color: string;
}

export interface LayerStateData {
  activeId: string;
  visibility: Record<string, boolean>;
  order: string[];
  customLayers: CustomLayer[];
}

export interface LayerStateActions {
  activate: (id: string) => void;
  toggleVisibility: (id: string) => void;
  moveUp: (id: string) => void;
  moveDown: (id: string) => void;
  add: (layer: CustomLayer) => void;
  delete: (id: string) => void;
}

export type LayerState = LayerStateData & LayerStateActions;

const INITIAL: LayerStateData = {
  activeId: "floors",
  visibility: {
    floors: true,
    walls: true,
    doors: true,
    sprites: true,
    lights: false,
  },
  order: ["floors", "walls", "doors", "sprites", "lights"],
  customLayers: [],
};

function moveInArray(arr: string[], id: string, delta: number): string[] {
  const idx = arr.indexOf(id);
  if (idx < 0) return arr;
  const targetIdx = idx + delta;
  if (targetIdx < 0 || targetIdx >= arr.length) return arr;
  const next = arr.slice();
  next.splice(idx, 1);
  next.splice(targetIdx, 0, id);
  return next;
}

export const useLayerStore = createSyncedStore<
  LayerStateData,
  LayerStateActions
>(
  "layer",
  INITIAL,
  (set) => ({
    activate: (id) => set({ activeId: id }),
    toggleVisibility: (id) =>
      set((s) => ({
        visibility: { ...s.visibility, [id]: !(s.visibility[id] ?? true) },
      })),
    moveUp: (id) => set((s) => ({ order: moveInArray(s.order, id, -1) })),
    moveDown: (id) => set((s) => ({ order: moveInArray(s.order, id, 1) })),
    add: (layer) => {
      set((s) => {
        // Idempotent — adding an id already in `order` is a no-op so
        // panels can call `add` from a button without checking.
        if (s.order.includes(layer.id)) return s;
        return {
          customLayers: [...s.customLayers, layer],
          order: [...s.order, layer.id],
          visibility: { ...s.visibility, [layer.id]: true },
        };
      });
    },
    delete: (id) => {
      set((s) => {
        // Only custom layers are deletable — bail if `id` isn't one.
        if (!s.customLayers.some((l) => l.id === id)) return s;
        const nextVisibility = { ...s.visibility };
        delete nextVisibility[id];
        const nextOrder = s.order.filter((x) => x !== id);
        const nextActive =
          s.activeId === id ? (nextOrder[0] ?? "") : s.activeId;
        return {
          customLayers: s.customLayers.filter((l) => l.id !== id),
          order: nextOrder,
          visibility: nextVisibility,
          activeId: nextActive,
        };
      });
    },
  }),
  {
    enableBroadcast: false,
  },
);

/** Non-React getter for imperative call sites. */
export function getLayerState(): LayerState {
  return useLayerStore.getState();
}

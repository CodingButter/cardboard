import { createSyncedStore } from "./sync";

/**
 * useBrushStore — the editor's active brush configuration.
 *
 * Owns the brush KIND (point / square / circle / line / rect — see
 * `MOCK_BRUSHES` in `scene-fixtures.ts`) and a discrete SIZE 1..20. Size
 * is clamped on every write so callers don't have to validate.
 *
 * Wave 3 panel wiring: BrushPanel reads + writes here; MapCanvas reads
 * it to decide the footprint of paint / erase ops.
 *
 * Persistence: localStorage under `cardboard.sync.brush`. No
 * BroadcastChannel — brush changes are infrequent.
 */

const MIN_SIZE = 1;
const MAX_SIZE = 20;

export interface BrushStateData {
  kind: string;
  size: number;
}

export interface BrushStateActions {
  setKind: (id: string) => void;
  setSize: (n: number) => void;
  sizeUp: () => void;
  sizeDown: () => void;
}

export type BrushState = BrushStateData & BrushStateActions;

const INITIAL: BrushStateData = {
  kind: "brush-single",
  size: 1,
};

function clamp(n: number): number {
  if (!Number.isFinite(n)) return MIN_SIZE;
  return Math.max(MIN_SIZE, Math.min(MAX_SIZE, Math.round(n)));
}

export const useBrushStore = createSyncedStore<
  BrushStateData,
  BrushStateActions
>(
  "brush",
  INITIAL,
  (set, get) => ({
    setKind: (id) => set({ kind: id }),
    setSize: (n) => set({ size: clamp(n) }),
    sizeUp: () => set({ size: clamp(get().size + 1) }),
    sizeDown: () => set({ size: clamp(get().size - 1) }),
  }),
  {
    enableBroadcast: false,
  },
);

/** Non-React getter for imperative call sites. */
export function getBrushState(): BrushState {
  return useBrushStore.getState();
}

import { createSyncedStore, throttle } from "./sync";

/**
 * useSelectionStore — the editor's selection + hover + cursor state.
 *
 * Three slices live here, with very different persistence characteristics:
 *
 *   1. `selected` — the currently-selected cell (or null). DURABLE: it
 *      drives the CellInspector / SelectionInfo / QuickTools panels;
 *      losing it on reload would be annoying. PERSISTED.
 *
 *   2. `hover` — the cell under the mouse cursor RIGHT NOW. EPHEMERAL:
 *      gets re-derived every mousemove, has no business surviving a
 *      reload, but DOES need to cross to popouts so they can highlight
 *      the same cell. BROADCAST via BroadcastChannel + throttled to
 *      ~30Hz.
 *
 *   3. `cursor` — continuous mouse position in scene-space (sub-cell).
 *      Same ephemeral / broadcast story as `hover` but at higher
 *      precision; used by the SelectionInfo panel's coordinate readout.
 *
 * Cross-window propagation:
 *   - `selected` rides the storage event (durable + free).
 *   - `hover` + `cursor` ride BroadcastChannel `cardboard:selection`.
 *     The throttle caps broadcasts at ~33ms (~30Hz) so dragging the
 *     mouse doesn't saturate the channel.
 *
 * Persistence: localStorage under `cardboard.sync.selection`. The
 * `partialize` hook keeps `hover` + `cursor` out of LS — they're pure
 * broadcast state.
 */

export interface CellCoord {
  x: number;
  y: number;
}

export interface CursorCoord {
  x: number;
  y: number;
}

export interface SelectionStateData {
  selected: CellCoord | null;
  hover: CellCoord | null;
  cursor: CursorCoord | null;
}

export interface SelectionStateActions {
  select: (cell: CellCoord | null) => void;
  setHover: (cell: CellCoord | null) => void;
  setCursor: (pos: CursorCoord | null) => void;
}

export type SelectionState = SelectionStateData & SelectionStateActions;

const INITIAL: SelectionStateData = {
  selected: null,
  hover: null,
  cursor: null,
};

/** Discriminated broadcast envelope so listeners can ignore unrelated
 *  fields. We don't broadcast `selected` — it rides the storage event. */
type SelectionBroadcast =
  | { kind: "hover"; cell: CellCoord | null }
  | { kind: "cursor"; pos: CursorCoord | null };

export const useSelectionStore = createSyncedStore<
  SelectionStateData,
  SelectionStateActions
>(
  "selection",
  INITIAL,
  (set, _get, broadcast) => {
    // Throttle the broadcast side of hover + cursor updates. Local
    // `set()` still runs immediately on every call so the writer's own
    // UI stays responsive — only the cross-window gossip is rate-limited.
    const throttledBroadcast = throttle((msg: SelectionBroadcast) => {
      broadcast(msg);
    }, 33);
    return {
      select: (cell) => set({ selected: cell }),
      setHover: (cell) => {
        set({ hover: cell });
        throttledBroadcast({ kind: "hover", cell });
      },
      setCursor: (pos) => {
        set({ cursor: pos });
        throttledBroadcast({ kind: "cursor", pos });
      },
    };
  },
  {
    enableBroadcast: true,
    // Persist ONLY the durable `selected` cell. `hover` + `cursor` are
    // ephemeral — broadcasting them is enough; persisting would clutter
    // LS and cause stale "old hover" cells to flash on reload.
    partialize: (state) => ({ selected: state.selected }),
  },
);

// Subscribe to incoming broadcasts in this same window. We capture
// `channel` once at module-eval time; if BroadcastChannel isn't
// available (SSR / no-jsdom test env) `channel` is null and we skip.
if (useSelectionStore.channel) {
  useSelectionStore.channel.addEventListener("message", (ev) => {
    const data = ev.data as SelectionBroadcast | undefined;
    if (!data || typeof data !== "object" || !("kind" in data)) return;
    if (data.kind === "hover") {
      useSelectionStore.setState({ hover: data.cell });
    } else if (data.kind === "cursor") {
      useSelectionStore.setState({ cursor: data.pos });
    }
  });
}

/** Non-React getter for imperative call sites. */
export function getSelectionState(): SelectionState {
  return useSelectionStore.getState();
}

import { createSyncedStore, throttle } from "./sync";
import type { DndPayload } from "./dnd/payload";

/**
 * useDragStore — cross-window descriptor of the in-flight drag.
 *
 * Tracks the live `DndPayload` for the currently-dragging gesture plus
 * a throttled cursor-window correlator. `createSyncedStore` gives us
 * the LocalStorage + storage-event spine for free, so a window popped
 * out DURING a drag rehydrates the live payload and can render
 * compatible-target affordances immediately.
 *
 * Why two lanes?
 *   - `currentDrag` is durable enough to survive a popout opening
 *     mid-drag (LS round-trips via the storage event).
 *   - `cursorWindowId` is high-frequency gossip ("which window owns
 *     the mouse right now") so receiving windows can dim or highlight.
 *     It rides the BroadcastChannel lane via the same `throttle()`
 *     pattern used by `useSelectionStore`'s hover/cursor.
 *
 * Important invariants — see `docs/plans/CROSS_WINDOW_DND.md` §3.2:
 *   - `currentDrag` is `null` between drags. Every drag-source MUST
 *     call `endDrag` from `onDragEnd` (fires regardless of drop
 *     success).
 *   - App bootstrap clears stale `currentDrag` once per session to
 *     mitigate crashed-mid-drag values rehydrating from LS.
 *   - The payload itself carries IDs only — never asset bytes — so
 *     even at peak LS size this store is a few hundred bytes.
 */

/**
 * Persisted + broadcast slice of the drag store.
 *
 * See `docs/plans/CROSS_WINDOW_DND.md` §3.2.
 */
export interface DragState {
  /** The live drag descriptor, or `null` between drags. */
  currentDrag: DndPayload | null;
  /**
   * Identifier of the window the cursor is currently over. Broadcast
   * at most ~30 Hz (33ms throttle) so receiving windows can paint
   * "drop active here" affordances without saturating the channel.
   */
  cursorWindowId: string | null;
}

/**
 * Imperative actions on the drag store.
 *
 * See `docs/plans/CROSS_WINDOW_DND.md` §3.2.
 */
export interface DragActions {
  /** Mark a drag as in-flight. Called from `onDragStart`. */
  startDrag: (p: DndPayload) => void;
  /** Clear the current drag. Called from `onDragEnd` (fires on success or cancel). */
  endDrag: () => void;
  /** Update the throttled cursor-window correlator. */
  setCursorWindow: (id: string | null) => void;
}

const INITIAL: DragState = {
  currentDrag: null,
  cursorWindowId: null,
};

/**
 * Discriminated broadcast envelope for the ephemeral lane. Today only
 * cursor-window updates ride it — `currentDrag` propagates via the
 * persisted storage event in `createSyncedStore`.
 */
type DragBroadcast = { kind: "cursor"; windowId: string | null };

/**
 * Cross-window-synced drag store. See
 * `docs/plans/CROSS_WINDOW_DND.md` §3.2 for the wire contract.
 */
export const useDragStore = createSyncedStore<DragState, DragActions>(
  "drag",
  INITIAL,
  (set, _get, broadcast) => {
    // 30 Hz cap matches `useSelectionStore`'s hover/cursor lane — fast
    // enough for smooth target highlighting, slow enough to leave
    // network/UI headroom on the receiving side.
    const throttledCursor = throttle((id: string | null) => {
      broadcast({ kind: "cursor", windowId: id } satisfies DragBroadcast);
    }, 33);
    return {
      startDrag: (p) => set({ currentDrag: p }),
      endDrag: () => set({ currentDrag: null }),
      setCursorWindow: (id) => {
        set({ cursorWindowId: id });
        throttledCursor(id);
      },
    };
  },
  { enableBroadcast: true },
);

// Subscribe to incoming broadcasts in this window. The BroadcastChannel
// does NOT echo to its own writer, so this only fires for messages
// originating in OTHER windows. Mirrors the pattern in
// `useSelectionStore` so cursor-window tracking stays consistent in
// popouts without a round-trip through LS.
if (useDragStore.channel) {
  useDragStore.channel.addEventListener("message", (ev) => {
    const data = ev.data as DragBroadcast | undefined;
    if (!data || typeof data !== "object" || !("kind" in data)) return;
    if (data.kind === "cursor") {
      useDragStore.setState({ cursorWindowId: data.windowId });
    }
  });
}

/** Non-React getter for imperative call sites. */
export function getDragState(): DragState & DragActions {
  return useDragStore.getState();
}

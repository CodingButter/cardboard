import { createSyncedStore } from "./sync";

/**
 * useHistoryStore — the editor's undo / redo history.
 *
 * Stores an append-only log of entries with a `cursor` indicating how
 * many entries are currently "applied" (i.e. live in scene state).
 *
 *   - `cursor === 0` → nothing applied (full undo state).
 *   - `cursor === entries.length` → everything applied (most recent state).
 *   - In-between → some applied, the rest are "redo-able".
 *
 * When a NEW entry is pushed while there are pending redo entries
 * (cursor < entries.length), those redo entries are discarded — this is
 * the standard "redo branch is destroyed on new edit" semantics.
 *
 * IMPORTANT — the inverse / forward application is NOT done here.
 *
 * Each entry's `undoPayload` / `redoPayload` is shaped specifically for
 * the action type (paint, erase, edit, etc.). Applying them touches
 * other stores (`useSceneStore`, `useSelectionStore`). If this store
 * imported those stores directly, we'd create a cycle:
 *
 *   useHistoryStore → useSceneStore → (panels) → useHistoryStore
 *
 * To keep this layer pure, the history store only manages the LOG +
 * the cursor. The PANEL LAYER (or a dedicated `historyDispatcher`
 * module) is responsible for:
 *
 *   1. Reading `undoPayload` / `redoPayload`.
 *   2. Replaying the appropriate scene-store mutations.
 *
 * The store exposes `undo()` and `redo()` as cursor-movers that RETURN
 * the entry that should be applied. Callers consume the returned entry
 * and dispatch it. If you want a side-effect-free cursor move (e.g.
 * `jumpTo`), the store still does that work; the caller computes the
 * diff between old + new cursor and replays.
 *
 * Persistence: localStorage under `cardboard.sync.history`. Capped to
 * the last `MAX_ENTRIES` via partialize so a long session doesn't
 * unbounded-grow LS.
 */

export type HistoryEntryType =
  | "paint"
  | "erase"
  | "place"
  | "delete"
  | "edit"
  | "select"
  | "settings";

export interface HistoryEntry {
  id: string;
  type: HistoryEntryType;
  label: string;
  ts: number;
  /** Inverse op payload for undo. Shape is op-specific; the panel layer
   *  knows how to apply it. */
  undoPayload: unknown;
  /** Forward op payload for redo. Shape is op-specific. */
  redoPayload: unknown;
}

export interface HistoryStateData {
  entries: HistoryEntry[];
  /** Number of applied entries. 0 ≤ cursor ≤ entries.length. */
  cursor: number;
}

export interface HistoryStateActions {
  push: (entry: HistoryEntry) => void;
  /** Decrement cursor + return the entry that should be undone. Null if
   *  there's nothing left to undo. */
  undo: () => HistoryEntry | null;
  /** Increment cursor + return the entry that should be re-applied.
   *  Null if there's nothing left to redo. */
  redo: () => HistoryEntry | null;
  /** Set the cursor directly. Returns the cursor-delta sign so callers
   *  can decide whether to dispatch undo or redo payloads on the entries
   *  between the old + new cursor. */
  jumpTo: (index: number) => void;
  clear: () => void;
  /** Marks all entries as applied (cursor = entries.length). Use when
   *  loading a project that already has the latest state applied. */
  markAllApplied: () => void;
}

export type HistoryState = HistoryStateData & HistoryStateActions;

const MAX_ENTRIES = 100;

const INITIAL: HistoryStateData = {
  entries: [],
  cursor: 0,
};

export const useHistoryStore = createSyncedStore<
  HistoryStateData,
  HistoryStateActions
>(
  "history",
  INITIAL,
  (set, get) => ({
    push: (entry) => {
      set((s) => {
        // Truncate any redo-branch entries past the current cursor.
        // (Standard "new edit destroys redo" semantics.)
        const trimmed = s.entries.slice(0, s.cursor);
        const next = [...trimmed, entry];
        // Cap to MAX_ENTRIES — drop the OLDEST so recent history is
        // preserved. Cursor moves with the truncation so the relative
        // position is maintained.
        if (next.length > MAX_ENTRIES) {
          const overflow = next.length - MAX_ENTRIES;
          return {
            entries: next.slice(overflow),
            cursor: next.length - overflow,
          };
        }
        return { entries: next, cursor: next.length };
      });
    },
    undo: () => {
      const { entries, cursor } = get();
      if (cursor <= 0) return null;
      const entry = entries[cursor - 1] ?? null;
      set({ cursor: cursor - 1 });
      return entry;
    },
    redo: () => {
      const { entries, cursor } = get();
      if (cursor >= entries.length) return null;
      const entry = entries[cursor] ?? null;
      set({ cursor: cursor + 1 });
      return entry;
    },
    jumpTo: (index) => {
      set((s) => {
        const clamped = Math.max(0, Math.min(s.entries.length, index));
        return { cursor: clamped };
      });
    },
    clear: () => set({ entries: [], cursor: 0 }),
    markAllApplied: () =>
      set((s) => ({ cursor: s.entries.length })),
  }),
  {
    enableBroadcast: false,
    // Cap the persisted slice to the last MAX_ENTRIES so localStorage
    // can't unbounded-grow over a long session. The in-memory store
    // already enforces the cap on push, but persisting via partialize
    // means even a manual setState bypass stays bounded on reload.
    partialize: (state) => {
      const entries = state.entries.slice(-MAX_ENTRIES);
      const trimmedCount = state.entries.length - entries.length;
      return {
        entries,
        cursor: Math.max(0, state.cursor - trimmedCount),
      };
    },
  },
);

/** Non-React getter for imperative call sites. */
export function getHistoryState(): HistoryState {
  return useHistoryStore.getState();
}

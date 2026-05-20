import { useHistoryStore, type HistoryEntry } from "./useHistoryStore";
import { useSceneStore } from "./useSceneStore";
import { useDiagnosticsStore } from "./useDiagnosticsStore";

/**
 * historyDispatcher — replays HistoryEntry payloads into the scene store.
 *
 * `useHistoryStore` deliberately does NOT import `useSceneStore` (to
 * avoid an import cycle through the panel layer). The history store's
 * `undo()` and `redo()` only move the cursor + RETURN the entry that
 * should be applied; this module owns the actual replay step.
 *
 * Wave 3.4 ships paint + erase replay. Other entry types (`place`,
 * `delete`, `edit`, `select`, `settings`) are scaffolded by the store
 * but their producers don't exist yet — those land alongside the
 * features that emit them. For now, an unknown entry type logs a
 * diagnostic and is otherwise a no-op (so the cursor still moves and
 * the entry sits in the log; producers can add their reverse-dispatch
 * in this module as they land).
 */

/**
 * One paint-stroke op. `prev`/`nextPresetId === null` means "no preset
 * on this layer at this cell" (i.e. erased). The same op shape carries
 * both the undo and redo information so a single ops array works for
 * both directions — `undo` reverts to `prev`, `redo` re-applies `next`.
 */
export type PaintOp = {
  x: number;
  y: number;
  layerId: string;
  prevPresetId: string | null;
  nextPresetId: string | null;
};

export type PaintPayload = { ops: PaintOp[] };

/**
 * Apply the `undoPayload` of an entry — revert to `prevPresetId` for
 * each op. Ops with `prevPresetId === null` are erases; others are
 * paints. Batched into one `paintCells` + one `eraseCells` call so a
 * single undo emits at most two storage events instead of N.
 */
export function applyEntryUndo(entry: HistoryEntry): void {
  if (entry.type !== "paint" && entry.type !== "erase") {
    useDiagnosticsStore
      .getState()
      .log("info", `Undo: skipped ${entry.type} entry "${entry.label}" (no replay handler yet)`);
    return;
  }
  const payload = entry.undoPayload as PaintPayload | undefined;
  if (!payload || !Array.isArray(payload.ops)) {
    useDiagnosticsStore
      .getState()
      .log("warn", `Undo: malformed payload on "${entry.label}"`);
    return;
  }
  const paints: Array<{ x: number; y: number; layerId: string; presetId: string }> = [];
  const erases: Array<{ x: number; y: number; layerId: string }> = [];
  for (const op of payload.ops) {
    if (op.prevPresetId === null) {
      erases.push({ x: op.x, y: op.y, layerId: op.layerId });
    } else {
      paints.push({ x: op.x, y: op.y, layerId: op.layerId, presetId: op.prevPresetId });
    }
  }
  const scene = useSceneStore.getState();
  if (erases.length > 0) scene.eraseCells(erases);
  if (paints.length > 0) scene.paintCells(paints);
  useDiagnosticsStore
    .getState()
    .log("info", `Undo: ${entry.label} (${payload.ops.length} cells)`);
}

/**
 * Apply the `redoPayload` of an entry — re-apply `nextPresetId` for
 * each op. Mirror of `applyEntryUndo`.
 */
export function applyEntryRedo(entry: HistoryEntry): void {
  if (entry.type !== "paint" && entry.type !== "erase") {
    useDiagnosticsStore
      .getState()
      .log("info", `Redo: skipped ${entry.type} entry "${entry.label}" (no replay handler yet)`);
    return;
  }
  const payload = entry.redoPayload as PaintPayload | undefined;
  if (!payload || !Array.isArray(payload.ops)) {
    useDiagnosticsStore
      .getState()
      .log("warn", `Redo: malformed payload on "${entry.label}"`);
    return;
  }
  const paints: Array<{ x: number; y: number; layerId: string; presetId: string }> = [];
  const erases: Array<{ x: number; y: number; layerId: string }> = [];
  for (const op of payload.ops) {
    if (op.nextPresetId === null) {
      erases.push({ x: op.x, y: op.y, layerId: op.layerId });
    } else {
      paints.push({ x: op.x, y: op.y, layerId: op.layerId, presetId: op.nextPresetId });
    }
  }
  const scene = useSceneStore.getState();
  if (erases.length > 0) scene.eraseCells(erases);
  if (paints.length > 0) scene.paintCells(paints);
  useDiagnosticsStore
    .getState()
    .log("info", `Redo: ${entry.label} (${payload.ops.length} cells)`);
}

/**
 * Move the history cursor back one + replay the inverse. No-op if
 * there's nothing left to undo.
 */
export function undoOnce(): void {
  const entry = useHistoryStore.getState().undo();
  if (entry) applyEntryUndo(entry);
}

/**
 * Move the history cursor forward one + replay the forward payload.
 * No-op if there's nothing left to redo.
 */
export function redoOnce(): void {
  const entry = useHistoryStore.getState().redo();
  if (entry) applyEntryRedo(entry);
}

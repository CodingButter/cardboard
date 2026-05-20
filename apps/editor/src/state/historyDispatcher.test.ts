/**
 * historyDispatcher + paintCells/eraseCells smoke tests.
 *
 * Wave 3.4 — the in-browser playwright smoke is gated by a pre-existing
 * dockview ResizeObserver feedback loop that grows the panel unbounded,
 * which makes synthetic-event tests against the canvas non-deterministic.
 * These tests exercise the same code paths (bulk store actions + history
 * replay) outside the React tree so the dispatcher contract is asserted
 * cleanly.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { useSceneStore, cellKey } from "./useSceneStore";
import { useHistoryStore, type HistoryEntry } from "./useHistoryStore";
import {
  applyEntryRedo,
  applyEntryUndo,
  redoOnce,
  undoOnce,
  type PaintOp,
} from "./historyDispatcher";

function resetStores() {
  useSceneStore.setState({
    dims: { w: 64, h: 64 },
    cells: {},
    settings: { name: "test", fog: 0, ambient: 0 },
  });
  useHistoryStore.setState({ entries: [], cursor: 0 });
}

beforeEach(resetStores);
afterEach(resetStores);

describe("useSceneStore.paintCells / eraseCells", () => {
  test("paintCells writes all ops in a single set callback", () => {
    const ops = [
      { x: 1, y: 2, layerId: "floors", presetId: "stone" },
      { x: 3, y: 4, layerId: "floors", presetId: "stone" },
      { x: 5, y: 6, layerId: "walls", presetId: "brick" },
    ];
    useSceneStore.getState().paintCells(ops);
    const cells = useSceneStore.getState().cells;
    expect(cells[cellKey(1, 2)]?.layers.floors).toBe("stone");
    expect(cells[cellKey(3, 4)]?.layers.floors).toBe("stone");
    expect(cells[cellKey(5, 6)]?.layers.walls).toBe("brick");
    // Sparse — no other keys
    expect(Object.keys(cells).length).toBe(3);
  });

  test("paintCells preserves existing layers on the same cell", () => {
    useSceneStore.getState().paintCell(1, 2, "walls", "brick");
    useSceneStore.getState().paintCells([
      { x: 1, y: 2, layerId: "floors", presetId: "stone" },
    ]);
    const cell = useSceneStore.getState().cells[cellKey(1, 2)];
    expect(cell?.layers).toEqual({ walls: "brick", floors: "stone" });
  });

  test("eraseCells removes the targeted layer and drops fully-empty cells", () => {
    useSceneStore.getState().paintCells([
      { x: 1, y: 2, layerId: "floors", presetId: "stone" },
      { x: 1, y: 2, layerId: "walls", presetId: "brick" },
      { x: 3, y: 4, layerId: "floors", presetId: "stone" },
    ]);
    useSceneStore.getState().eraseCells([
      { x: 1, y: 2, layerId: "floors" },
      { x: 3, y: 4, layerId: "floors" },
    ]);
    const cells = useSceneStore.getState().cells;
    // (1,2) still has walls
    expect(cells[cellKey(1, 2)]?.layers).toEqual({ walls: "brick" });
    // (3,4) had only floors → cell dropped entirely
    expect(cells[cellKey(3, 4)]).toBeUndefined();
  });

  test("paintCells with empty ops is a no-op", () => {
    useSceneStore.getState().paintCells([]);
    expect(Object.keys(useSceneStore.getState().cells).length).toBe(0);
  });
});

describe("historyDispatcher — paint stroke replay", () => {
  function strokeEntry(ops: PaintOp[]): HistoryEntry {
    return {
      id: "test-1",
      type: "paint",
      label: `Paint ${ops.length} cells`,
      ts: Date.now(),
      undoPayload: { ops },
      redoPayload: { ops },
    };
  }

  test("applyEntryRedo paints next, applyEntryUndo reverts to prev", () => {
    const ops: PaintOp[] = [
      { x: 1, y: 1, layerId: "floors", prevPresetId: null, nextPresetId: "stone" },
      { x: 2, y: 1, layerId: "floors", prevPresetId: null, nextPresetId: "stone" },
    ];
    const entry = strokeEntry(ops);
    // Forward — paint stone at (1,1), (2,1)
    applyEntryRedo(entry);
    let cells = useSceneStore.getState().cells;
    expect(cells[cellKey(1, 1)]?.layers.floors).toBe("stone");
    expect(cells[cellKey(2, 1)]?.layers.floors).toBe("stone");
    // Undo — both prevPresetId are null → erases back to empty
    applyEntryUndo(entry);
    cells = useSceneStore.getState().cells;
    expect(cells[cellKey(1, 1)]).toBeUndefined();
    expect(cells[cellKey(2, 1)]).toBeUndefined();
  });

  test("undoOnce / redoOnce drive the history cursor + scene together", () => {
    const ops: PaintOp[] = [
      { x: 5, y: 5, layerId: "floors", prevPresetId: null, nextPresetId: "stone" },
    ];
    const entry = strokeEntry(ops);
    useHistoryStore.getState().push(entry);
    // Mutating scene to match the "applied" state (matches MapCanvas's flow).
    useSceneStore.getState().paintCells([
      { x: 5, y: 5, layerId: "floors", presetId: "stone" },
    ]);
    expect(useSceneStore.getState().cells[cellKey(5, 5)]?.layers.floors).toBe("stone");
    expect(useHistoryStore.getState().cursor).toBe(1);

    undoOnce();
    expect(useHistoryStore.getState().cursor).toBe(0);
    expect(useSceneStore.getState().cells[cellKey(5, 5)]).toBeUndefined();

    redoOnce();
    expect(useHistoryStore.getState().cursor).toBe(1);
    expect(useSceneStore.getState().cells[cellKey(5, 5)]?.layers.floors).toBe("stone");
  });

  test("undoOnce at cursor=0 is a no-op", () => {
    expect(() => undoOnce()).not.toThrow();
    expect(useHistoryStore.getState().cursor).toBe(0);
  });

  test("redoOnce at cursor=entries.length is a no-op", () => {
    expect(() => redoOnce()).not.toThrow();
    expect(useHistoryStore.getState().cursor).toBe(0);
  });

  test("erase entry undo restores the prev preset", () => {
    // Start with a cell painted on floors:stone
    useSceneStore.getState().paintCell(7, 7, "floors", "stone");
    // Erase via history flow
    const ops: PaintOp[] = [
      { x: 7, y: 7, layerId: "floors", prevPresetId: "stone", nextPresetId: null },
    ];
    const entry: HistoryEntry = {
      id: "test-2",
      type: "erase",
      label: "Erase 1 cell",
      ts: Date.now(),
      undoPayload: { ops },
      redoPayload: { ops },
    };
    applyEntryRedo(entry);
    expect(useSceneStore.getState().cells[cellKey(7, 7)]).toBeUndefined();
    applyEntryUndo(entry);
    expect(useSceneStore.getState().cells[cellKey(7, 7)]?.layers.floors).toBe("stone");
  });
});

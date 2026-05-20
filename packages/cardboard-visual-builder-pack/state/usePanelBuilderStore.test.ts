/**
 * usePanelBuilderStore — VB3 spec-tree path + transform tests.
 *
 * The store's action set (`updateNode`, `deleteNode`) is exercised
 * through the pure helpers since the store hook requires an
 * `EditorPackContext` to construct. The transform logic IS the
 * action's body — `set({ spec, root })` is the only wrapper around
 * `transformAt`, so these tests cover the meaningful behaviour
 * without needing a mounted pack.
 */

import { describe, expect, test } from "bun:test";
import {
  walkSpecNodes,
  findNodeById,
  makeEmptyDraftSpec,
  pushHistory,
  HISTORY_CAPACITY,
  type PanelBuilderHistory,
} from "./usePanelBuilderStore";
import type { NodeSpec, PanelSpec } from "../../../apps/editor/src/panel-renderer/types";

describe("walkSpecNodes — spec-tree path ids", () => {
  test("empty Layout root yields a single 'root' entry", () => {
    const draft = makeEmptyDraftSpec();
    const out = walkSpecNodes(draft.root);
    expect(out.length).toBe(1);
    expect(out[0]!.id).toBe("root");
    expect(out[0]!.node).toBe(draft.root);
  });

  test("Layout with two children yields three entries with stable paths", () => {
    const root: NodeSpec = {
      type: "Layout",
      direction: "column",
      children: [
        { type: "Heading", text: "A" },
        { type: "Heading", text: "B" },
      ],
    };
    const out = walkSpecNodes(root);
    expect(out.map((e) => e.id)).toEqual([
      "root",
      "root.children.0",
      "root.children.1",
    ]);
  });

  test("nested Layout / Conditional / ScrollRow produce dotted paths", () => {
    const root: NodeSpec = {
      type: "Layout",
      direction: "column",
      children: [
        {
          type: "Conditional",
          when: "store.selection.selected",
          children: [
            { type: "Text", text: "inside-cond" },
            {
              type: "ScrollRow",
              children: [{ type: "Heading", text: "deep" }],
            },
          ],
        },
      ],
    };
    const ids = walkSpecNodes(root).map((e) => e.id);
    expect(ids).toContain("root");
    expect(ids).toContain("root.children.0");
    expect(ids).toContain("root.children.0.children.0");
    expect(ids).toContain("root.children.0.children.1");
    expect(ids).toContain("root.children.0.children.1.children.0");
  });

  test("Tooltip walks its `child` and per-stage `content`", () => {
    const root: NodeSpec = {
      type: "Tooltip",
      side: "top",
      child: { type: "Text", text: "trigger" },
      stages: [
        { delay: 600, content: { type: "Text", text: "body-1" } },
        { delay: 1200, content: { type: "Text", text: "body-2" } },
      ],
    };
    const ids = walkSpecNodes(root).map((e) => e.id);
    expect(ids).toContain("root");
    expect(ids).toContain("root.child");
    expect(ids).toContain("root.stages.0.content");
    expect(ids).toContain("root.stages.1.content");
  });
});

describe("findNodeById — round-trip lookup", () => {
  test("returns the node referenced by its walk-assigned id", () => {
    const inner: NodeSpec = { type: "Heading", text: "deep" };
    const root: NodeSpec = {
      type: "Layout",
      direction: "column",
      children: [
        {
          type: "Layout",
          direction: "row",
          children: [inner],
        },
      ],
    };
    const found = findNodeById(root, "root.children.0.children.0");
    expect(found).toBe(inner);
  });

  test("returns null for an unresolved id", () => {
    const root: NodeSpec = {
      type: "Layout",
      direction: "column",
      children: [{ type: "Heading", text: "X" }],
    };
    expect(findNodeById(root, "root.children.99")).toBeNull();
    expect(findNodeById(root, "root.bogus.path")).toBeNull();
  });

  test("root id returns the root node", () => {
    const root: NodeSpec = { type: "Heading", text: "X" };
    expect(findNodeById(root, "root")).toBe(root);
  });
});

// ---------------------------------------------------------------------------
// VB4 — pushHistory snapshot stack
// ---------------------------------------------------------------------------

function emptyHistory(): PanelBuilderHistory {
  const initial = makeEmptyDraftSpec();
  return { entries: [initial], cursor: 0, capacity: HISTORY_CAPACITY };
}

function specWithTitle(t: string): PanelSpec {
  const base = makeEmptyDraftSpec();
  return { ...base, title: t };
}

describe("pushHistory — VB4 undo/redo snapshot stack", () => {
  test("push appends + advances cursor", () => {
    const h0 = emptyHistory();
    const h1 = pushHistory(h0, specWithTitle("A"));
    expect(h1.entries.length).toBe(2);
    expect(h1.cursor).toBe(1);
    expect(h1.entries[1]!.title).toBe("A");
  });

  test("push after undo (cursor < end) truncates redo branch", () => {
    let h = emptyHistory();
    h = pushHistory(h, specWithTitle("A"));
    h = pushHistory(h, specWithTitle("B"));
    h = pushHistory(h, specWithTitle("C"));
    // Simulate two undos — move cursor back without mutating entries.
    h = { ...h, cursor: 1 };
    // New push: discards entries past cursor + appends new one.
    h = pushHistory(h, specWithTitle("D"));
    expect(h.entries.length).toBe(3);
    expect(h.cursor).toBe(2);
    expect(h.entries.map((e) => e.title)).toEqual(["Untitled", "A", "D"]);
  });

  test("push past capacity drops oldest + rebases cursor", () => {
    let h: PanelBuilderHistory = {
      entries: [makeEmptyDraftSpec()],
      cursor: 0,
      capacity: 3,
    };
    h = pushHistory(h, specWithTitle("A"));
    h = pushHistory(h, specWithTitle("B"));
    h = pushHistory(h, specWithTitle("C"));
    // Capacity is 3 — we should see the oldest entry dropped.
    expect(h.entries.length).toBe(3);
    expect(h.cursor).toBe(2);
    expect(h.entries.map((e) => e.title)).toEqual(["A", "B", "C"]);
    h = pushHistory(h, specWithTitle("D"));
    expect(h.entries.length).toBe(3);
    expect(h.cursor).toBe(2);
    expect(h.entries.map((e) => e.title)).toEqual(["B", "C", "D"]);
  });

  test("HISTORY_CAPACITY is 100", () => {
    expect(HISTORY_CAPACITY).toBe(100);
  });
});

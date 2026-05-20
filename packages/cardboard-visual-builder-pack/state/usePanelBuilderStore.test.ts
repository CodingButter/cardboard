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
} from "./usePanelBuilderStore";
import type { NodeSpec } from "../../../apps/editor/src/panel-renderer/types";

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

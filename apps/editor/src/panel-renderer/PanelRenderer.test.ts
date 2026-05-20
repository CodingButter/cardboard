/**
 * PanelRenderer test suite — Phase 0.
 *
 * This file covers the renderer's PURE LOGIC:
 *   • Path tokenisation
 *   • Binding read (static path + dynamic [selected])
 *   • Binding write (round-trip through store action)
 *   • Conditional truthy / falsy behaviour
 *   • Script-ref dispatch into the command registry
 *   • Script-ref arg resolution ($value placeholder)
 *   • Demo JSON spec validates against the type spec
 *
 * What's NOT covered: rendering the React tree itself. The renderer is
 * a thin switch over the resolved bindings — exercising the bindings
 * via `getState()` is the load-bearing test surface. React tree
 * rendering needs a DOM (happy-dom / jsdom) which isn't wired into
 * `bun test` here; punted to a Playwright smoke test against the
 * editor-pack-loaded "Editor Pack: Selection Info" panel.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  resolveBinding,
  tokenisePath,
} from "./resolveBinding";
import { invokeScript, getInvokeContext } from "./invokeScript";
import { useSceneStore } from "../state/useSceneStore";
import { useSelectionStore } from "../state/useSelectionStore";
import { useLayerStore } from "../state/useLayerStore";
import { useToolStore } from "../state/useToolStore";
import { useBrushStore } from "../state/useBrushStore";
import { useCommandStore } from "../state/useCommandStore";
import demoSpec from "./test-fixtures/demo-selection-info.json";
import selectionInfoSpec from "./specs/selection-info.json";
import toolPaletteSpec from "./specs/tool-palette.json";
import brushSpec from "./specs/brush.json";
import quickToolsSpec from "./specs/quick-tools.json";
import { MOCK_QUICK_TOOLS } from "../views/scene/scene-fixtures";
import type { NodeSpec, PanelSpec } from "./types";

// ---------------------------------------------------------------------------
// Test fixtures + reset
// ---------------------------------------------------------------------------

function resetStores() {
  useSceneStore.setState({
    dims: { w: 64, h: 64 },
    cells: {},
    settings: { name: "level-01", fog: 0.25, ambient: 0.35 },
  });
  useSelectionStore.setState({
    selected: null,
    hover: null,
    cursor: null,
  });
  useLayerStore.setState({
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
  });
  useCommandStore.setState({ commands: {}, recent: [] });
  useToolStore.setState({
    activeTool: "select",
    activeSubTool: {},
    activeMode: "map",
  });
  useBrushStore.setState({
    kind: "brush-single",
    size: 1,
  });
}

beforeEach(() => {
  resetStores();
});

afterEach(() => {
  resetStores();
});

// ---------------------------------------------------------------------------
// tokenisePath
// ---------------------------------------------------------------------------

describe("tokenisePath", () => {
  test("parses a simple dotted path", () => {
    expect(tokenisePath("store.scene.settings.name")).toEqual([
      { kind: "key", name: "scene" },
      { kind: "key", name: "settings" },
      { kind: "key", name: "name" },
    ]);
  });

  test("accepts the $store. prefix variant", () => {
    expect(tokenisePath("$store.selection.selected")).toEqual([
      { kind: "key", name: "selection" },
      { kind: "key", name: "selected" },
    ]);
  });

  test("parses a dynamic indexer segment", () => {
    expect(tokenisePath("store.scene.cells[selected].name")).toEqual([
      { kind: "key", name: "scene" },
      { kind: "key", name: "cells" },
      { kind: "index", indexer: "selected" },
      { kind: "key", name: "name" },
    ]);
  });

  test("throws on an unterminated [", () => {
    expect(() => tokenisePath("store.scene.cells[selected")).toThrow(
      /unterminated/,
    );
  });
});

// ---------------------------------------------------------------------------
// resolveBinding — read path
// ---------------------------------------------------------------------------

describe("resolveBinding read", () => {
  test("reads a static nested path from useSceneStore", () => {
    const b = resolveBinding("store.scene.settings.name");
    expect(b.get()).toBe("level-01");
    expect(b.storeName).toBe("scene");
  });

  test("reads through a dynamic [selected] indexer", () => {
    // No selection → cell doesn't exist → undefined
    let b = resolveBinding("store.scene.cells[selected].height");
    expect(b.get()).toBeUndefined();

    // Plant a cell at (3, 7) + select it. The binding should now
    // resolve through the dynamic indexer to that cell's height.
    useSceneStore.setState((s) => ({
      cells: {
        ...s.cells,
        "3,7": { layers: {}, height: 42, tags: [], properties: {} },
      },
    }));
    useSelectionStore.getState().select({ x: 3, y: 7 });

    b = resolveBinding("store.scene.cells[selected].height");
    expect(b.get()).toBe(42);
  });

  test("throws on an unknown store name", () => {
    expect(() => resolveBinding("store.unicorn.foo")).toThrow(
      /unknown store/,
    );
  });
});

// ---------------------------------------------------------------------------
// resolveBinding — write path (round-trip through store action)
// ---------------------------------------------------------------------------

describe("resolveBinding write", () => {
  test("writes scene.settings.name through the store action", () => {
    const b = resolveBinding("store.scene.settings.name");
    expect(b.set("dungeon-1")).toBe(true);
    // Read back via the store directly to confirm the action ran (not
    // a setState shortcut).
    expect(useSceneStore.getState().settings.name).toBe("dungeon-1");
    // And via the binding's own getter (round-trip).
    expect(b.get()).toBe("dungeon-1");
  });

  test("coerces numeric strings on numeric setting writes", () => {
    const b = resolveBinding("store.scene.settings.fog");
    expect(b.set("0.75")).toBe(true);
    expect(useSceneStore.getState().settings.fog).toBe(0.75);
  });

  test("returns false + logs when no writer registered (read-only path)", () => {
    const b = resolveBinding("store.selection.selected");
    // No WRITERS entry → set returns false. (We can't easily assert
    // the console.warn without a mocking layer; the boolean return is
    // the contract.)
    expect(b.set({ x: 1, y: 1 })).toBe(false);
    // And the underlying store state is untouched.
    expect(useSelectionStore.getState().selected).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Conditional binding behaviour
// ---------------------------------------------------------------------------

describe("Conditional binding behaviour", () => {
  test("a falsy binding signals hide; a truthy binding signals show", () => {
    // The Conditional node renders children iff `when` resolves to a
    // truthy value. We exercise the underlying resolution here — the
    // React-side gating is a one-liner over this same value.
    const b = resolveBinding("store.selection.selected");
    expect(Boolean(b.get())).toBe(false); // no selection → hide

    useSelectionStore.getState().select({ x: 0, y: 0 });
    expect(Boolean(b.get())).toBe(true); // selection → show
  });
});

// ---------------------------------------------------------------------------
// invokeScript → command registry dispatch
// ---------------------------------------------------------------------------

describe("invokeScript", () => {
  test("dispatches to the registered command", async () => {
    let ran = 0;
    useCommandStore.getState().register({
      id: "test.ran",
      title: "Test Ran",
      run: () => {
        ran++;
      },
    });
    await invokeScript({ script: "test.ran" });
    expect(ran).toBe(1);
  });

  test("logs + bails when the command isn't registered", async () => {
    // Should not throw — bails silently with a console.warn.
    await invokeScript({ script: "doesnt.exist" });
    // No assertion needed beyond not-throwing; this is the contract.
    expect(true).toBe(true);
  });

  test("resolves $value placeholder into args", async () => {
    let received: ReadonlyArray<string | number | boolean> = [];
    useCommandStore.getState().register({
      id: "test.echo-args",
      title: "Test Echo Args",
      run: () => {
        received = getInvokeContext().args;
      },
    });
    await invokeScript(
      { script: "test.echo-args", args: [{ $value: true }, 42, "literal"] },
      "from-input",
    );
    expect(received).toEqual(["from-input", 42, "literal"]);
  });

  test("integration: button-onClick-style invoke clears selection", async () => {
    // Simulate the demo's "Clear selection" button — register the
    // command, set a selection, invoke, expect cleared.
    useCommandStore.getState().register({
      id: "demo.selection.clear",
      title: "Clear Selection",
      run: () => {
        useSelectionStore.getState().select(null);
      },
    });
    useSelectionStore.getState().select({ x: 5, y: 5 });
    expect(useSelectionStore.getState().selected).not.toBeNull();

    await invokeScript({ script: "demo.selection.clear" });
    expect(useSelectionStore.getState().selected).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Demo JSON spec validates
// ---------------------------------------------------------------------------

describe("demo JSON spec", () => {
  test("loads as a PanelSpec with expected top-level fields", () => {
    const spec = demoSpec as PanelSpec;
    expect(spec.id).toBe("demo-selection-info");
    expect(spec.dockKind).toBe("dockable-window");
    expect(spec.root.type).toBe("Layout");
  });

  test("every binding path in the spec resolves without throwing", () => {
    const spec = demoSpec as PanelSpec;
    // Walk the tree collecting every binding-like string.
    const paths: string[] = [];
    const visit = (n: unknown): void => {
      if (!n || typeof n !== "object") return;
      const obj = n as Record<string, unknown>;
      for (const [k, v] of Object.entries(obj)) {
        if (
          (k === "bind" || k === "when") &&
          typeof v === "string"
        ) {
          paths.push(v);
        }
        if (k === "text" && typeof v === "string" &&
            (v.startsWith("store.") || v.startsWith("$store."))) {
          paths.push(v);
        }
        if (Array.isArray(v)) v.forEach(visit);
        else if (typeof v === "object") visit(v);
      }
    };
    visit(spec);
    expect(paths.length).toBeGreaterThan(0);
    for (const p of paths) {
      // resolveBinding should not throw for any binding present in the
      // demo. (Read may return undefined — that's fine.)
      expect(() => resolveBinding(p).get()).not.toThrow();
    }
  });
});

// ---------------------------------------------------------------------------
// useLayerStore binding — Phase 1 store extension
// ---------------------------------------------------------------------------

describe("resolveBinding — layer store", () => {
  test("reads activeId from the layer store", () => {
    const b = resolveBinding("store.layer.activeId");
    expect(b.storeName).toBe("layer");
    expect(b.get()).toBe("floors");
    useLayerStore.getState().activate("walls");
    expect(b.get()).toBe("walls");
  });

  test("layer store has no writers registered (read-only)", () => {
    const b = resolveBinding("store.layer.activeId");
    expect(b.set("walls")).toBe(false);
    // Activate via the store action stayed available — the binding's
    // write is just disallowed.
    expect(useLayerStore.getState().activeId).toBe("floors");
  });
});

// ---------------------------------------------------------------------------
// SelectionInfo JSON spec — Phase 1 migration target
// ---------------------------------------------------------------------------

describe("SelectionInfo JSON spec", () => {
  test("loads as a PanelSpec with id 'selection-info'", () => {
    const spec = selectionInfoSpec as PanelSpec;
    expect(spec.id).toBe("selection-info");
    expect(spec.title).toBe("Selection Info");
    expect(spec.dockKind).toBe("dockable-window");
    expect(spec.root.type).toBe("Layout");
  });

  test("includes a Tooltip node for each of the four sections", () => {
    // Walk the tree counting Tooltip nodes.
    const spec = selectionInfoSpec as PanelSpec;
    let tooltipCount = 0;
    const visit = (n: unknown): void => {
      if (!n || typeof n !== "object") return;
      const obj = n as Record<string, unknown>;
      if (obj.type === "Tooltip") tooltipCount++;
      for (const v of Object.values(obj)) {
        if (Array.isArray(v)) v.forEach(visit);
        else if (typeof v === "object") visit(v);
      }
    };
    visit(spec);
    expect(tooltipCount).toBe(4);
  });

  test("uses every text formatter type the renderer supports", () => {
    const spec = selectionInfoSpec as PanelSpec;
    const formats = new Set<string>();
    const visit = (n: unknown): void => {
      if (!n || typeof n !== "object") return;
      const obj = n as Record<string, unknown>;
      if (
        obj.type === "Text" &&
        typeof obj.format === "string"
      ) {
        formats.add(obj.format);
      }
      for (const v of Object.values(obj)) {
        if (Array.isArray(v)) v.forEach(visit);
        else if (typeof v === "object") visit(v);
      }
    };
    visit(spec);
    // The four formatters that drive the four sections — proves the
    // migrated spec doesn't fall back to ad-hoc string concatenation
    // and instead uses the formatter pipeline added in this phase.
    expect(formats).toEqual(
      new Set(["position", "cell", "selectionCount", "layerName"]),
    );
  });

  test("every binding path resolves without throwing", () => {
    const spec = selectionInfoSpec as PanelSpec;
    const paths: string[] = [];
    const visit = (n: unknown): void => {
      if (!n || typeof n !== "object") return;
      const obj = n as Record<string, unknown>;
      for (const [k, v] of Object.entries(obj)) {
        if ((k === "bind" || k === "when") && typeof v === "string") {
          paths.push(v);
        }
        if (
          k === "text" &&
          typeof v === "string" &&
          (v.startsWith("store.") || v.startsWith("$store."))
        ) {
          paths.push(v);
        }
        if (Array.isArray(v)) v.forEach(visit);
        else if (typeof v === "object") visit(v);
      }
    };
    visit(spec);
    expect(paths.length).toBeGreaterThan(0);
    for (const p of paths) {
      expect(() => resolveBinding(p).get()).not.toThrow();
    }
  });

  test("clear-selection works via the scene.selection.clear command", async () => {
    // Mirrors the JSON spec's wiring intent — the button in the
    // tooltip (and the keybinding) call scene.selection.clear; here
    // we register the command + invoke it the way invokeScript would.
    useCommandStore.getState().register({
      id: "scene.selection.clear",
      title: "Clear Selection",
      run: () => {
        useSelectionStore.getState().select(null);
      },
    });
    useSelectionStore.getState().select({ x: 4, y: 4 });
    expect(useSelectionStore.getState().selected).not.toBeNull();
    await invokeScript({ script: "scene.selection.clear" });
    expect(useSelectionStore.getState().selected).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// New node-type structural validation
// ---------------------------------------------------------------------------

describe("New node-types — structural validation", () => {
  test("Tooltip node accepts stages + child NodeSpec", () => {
    // Pure type-shape exercise — no React render, but proves the type
    // surface holds together at runtime in a way TS can't see (e.g.
    // accidental field renames at the JSON level).
    const node: NodeSpec = {
      type: "Tooltip",
      side: "top",
      stages: [
        { delay: 1000, content: { type: "Text", text: "Quick label" } },
        {
          delay: 3000,
          content: {
            type: "Layout",
            direction: "column",
            children: [
              { type: "Heading", text: "Detailed label", level: 4 },
              { type: "Text", text: "Body copy", variant: "muted" },
            ],
          },
        },
      ],
      child: { type: "Text", text: "Trigger", variant: "label" },
    };
    expect(node.type).toBe("Tooltip");
  });

  test("Icon node accepts a lucide-name + size", () => {
    const node: NodeSpec = { type: "Icon", name: "Crosshair", size: 12 };
    expect(node.type).toBe("Icon");
    expect(node.name).toBe("Crosshair");
  });

  test("Layout accepts new align/justify/childFlex extensions", () => {
    const node: NodeSpec = {
      type: "Layout",
      direction: "row",
      align: "stretch",
      justify: "between",
      childFlex: "1",
      childMinWidthPx: 100,
      textAlign: "center",
      paddingX: 2,
      paddingY: 1,
      children: [
        { type: "Text", text: "A", variant: "label" },
        { type: "Text", text: "B", variant: "value" },
      ],
    };
    expect(node.childFlex).toBe("1");
    expect(node.align).toBe("stretch");
  });

  test("Text accepts new variant + format + truncate fields", () => {
    const node: NodeSpec = {
      type: "Text",
      text: "store.selection.cursor",
      variant: "value",
      format: "position",
      truncate: true,
    };
    expect(node.format).toBe("position");
    expect(node.variant).toBe("value");
    expect(node.truncate).toBe(true);
  });

  test("ToggleButton accepts bind + activeValue + script onClick", () => {
    const node: NodeSpec = {
      type: "ToggleButton",
      bind: "store.tool.activeTool",
      activeValue: "select",
      text: "Select",
      icon: "MousePointer2",
      iconSize: 18,
      shape: "tile",
      onClick: { script: "scene.tool.select.select" },
    };
    expect(node.type).toBe("ToggleButton");
    expect(node.shape).toBe("tile");
    expect(node.activeValue).toBe("select");
  });

  test("ScrollRow accepts contentClassName + child NodeSpecs", () => {
    const node: NodeSpec = {
      type: "ScrollRow",
      contentClassName: "flex items-center gap-1",
      children: [
        { type: "Text", text: "Chip A" },
        { type: "Text", text: "Chip B" },
      ],
    };
    expect(node.type).toBe("ScrollRow");
    expect(node.children.length).toBe(2);
  });

  test("Layout accepts direction grid + column min/max + childHeightPx", () => {
    const node: NodeSpec = {
      type: "Layout",
      direction: "grid",
      gap: 1,
      columnsMinPx: 54,
      columnsMaxPx: 64,
      childHeightPx: 60,
      childFlex: "1",
      children: [{ type: "Text", text: "A" }],
    };
    expect(node.direction).toBe("grid");
    expect(node.columnsMinPx).toBe(54);
    expect(node.childHeightPx).toBe(60);
  });

  test("Conditional accepts equals comparand for strict-equality gating", () => {
    const node: NodeSpec = {
      type: "Conditional",
      when: "store.tool.activeTool",
      equals: "select",
      children: [{ type: "Text", text: "shown only when select" }],
    };
    expect(node.equals).toBe("select");
  });
});

// ---------------------------------------------------------------------------
// useToolStore binding — Phase 1b store extension (ToolPalette migration)
// ---------------------------------------------------------------------------

describe("resolveBinding — tool store", () => {
  test("reads activeTool from the tool store", () => {
    const b = resolveBinding("store.tool.activeTool");
    expect(b.storeName).toBe("tool");
    expect(b.get()).toBe("select");
    useToolStore.getState().setActiveTool("paint");
    expect(b.get()).toBe("paint");
  });

  test("reads activeSubTool record through a static dotted path", () => {
    // The TS-side resolver doesn't need a dynamic indexer for this —
    // `activeSubTool` is a Record<string,string>, so `select` is a
    // plain key. This exercises the static-traversal happy path
    // through a nested record.
    const b = resolveBinding("store.tool.activeSubTool.select");
    expect(b.get()).toBeUndefined();
    useToolStore.getState().setActiveSubTool("select", "select-polygon");
    expect(b.get()).toBe("select-polygon");
  });

  test("tool store has no writers (read-only — writes go through commands)", () => {
    const b = resolveBinding("store.tool.activeTool");
    expect(b.set("paint")).toBe(false);
    // The store action is the canonical write path — invoke it directly
    // and confirm the binding reflects the change.
    useToolStore.getState().setActiveTool("paint");
    expect(b.get()).toBe("paint");
  });
});

// ---------------------------------------------------------------------------
// ToolPalette JSON spec — Phase 1b migration target
// ---------------------------------------------------------------------------

describe("ToolPalette JSON spec", () => {
  test("loads as a PanelSpec with id 'tool-palette'", () => {
    const spec = toolPaletteSpec as PanelSpec;
    expect(spec.id).toBe("tool-palette");
    expect(spec.title).toBe("Tools");
    expect(spec.dockKind).toBe("dockable-window");
    expect(spec.root.type).toBe("Layout");
  });

  test("includes one ToggleButton tile per MOCK_TOOLS entry (6)", () => {
    const spec = toolPaletteSpec as PanelSpec;
    let tileCount = 0;
    const visit = (n: unknown): void => {
      if (!n || typeof n !== "object") return;
      const obj = n as Record<string, unknown>;
      if (obj.type === "ToggleButton" && obj.shape === "tile") tileCount++;
      for (const v of Object.values(obj)) {
        if (Array.isArray(v)) v.forEach(visit);
        else if (typeof v === "object") visit(v);
      }
    };
    visit(spec);
    expect(tileCount).toBe(6);
  });

  test("sub-tool strip is gated on tool.activeTool === 'select'", () => {
    const spec = toolPaletteSpec as PanelSpec;
    // Find a Conditional node with equals: "select".
    let found = false;
    const visit = (n: unknown): void => {
      if (!n || typeof n !== "object") return;
      const obj = n as Record<string, unknown>;
      if (
        obj.type === "Conditional" &&
        obj.when === "store.tool.activeTool" &&
        obj.equals === "select"
      ) {
        found = true;
      }
      for (const v of Object.values(obj)) {
        if (Array.isArray(v)) v.forEach(visit);
        else if (typeof v === "object") visit(v);
      }
    };
    visit(spec);
    expect(found).toBe(true);
  });

  test("every script-ref onClick points at a known scene.tool.* command id", () => {
    const spec = toolPaletteSpec as PanelSpec;
    const scripts: string[] = [];
    const visit = (n: unknown): void => {
      if (!n || typeof n !== "object") return;
      const obj = n as Record<string, unknown>;
      if (obj.type === "ToggleButton") {
        const oc = obj.onClick as { script?: unknown } | undefined;
        if (oc && typeof oc.script === "string") scripts.push(oc.script);
      }
      for (const v of Object.values(obj)) {
        if (Array.isArray(v)) v.forEach(visit);
        else if (typeof v === "object") visit(v);
      }
    };
    visit(spec);
    expect(scripts.length).toBeGreaterThan(0);
    for (const s of scripts) {
      // Either a top-level tool selector OR a sub-tool selector.
      expect(
        s.startsWith("scene.tool.select.") ||
          s.startsWith("scene.tool.subTool.select."),
      ).toBe(true);
    }
  });

  test("every binding path in the spec resolves without throwing", () => {
    const spec = toolPaletteSpec as PanelSpec;
    const paths: string[] = [];
    const visit = (n: unknown): void => {
      if (!n || typeof n !== "object") return;
      const obj = n as Record<string, unknown>;
      for (const [k, v] of Object.entries(obj)) {
        if ((k === "bind" || k === "when") && typeof v === "string") {
          paths.push(v);
        }
        if (Array.isArray(v)) v.forEach(visit);
        else if (typeof v === "object") visit(v);
      }
    };
    visit(spec);
    expect(paths.length).toBeGreaterThan(0);
    for (const p of paths) {
      expect(() => resolveBinding(p).get()).not.toThrow();
    }
  });

  test("clicking the Paint tile via the command registry changes activeTool", async () => {
    // Mirrors the TSX shell — register the per-tool selector command.
    useCommandStore.getState().register({
      id: "scene.tool.select.paint",
      title: "Select Tool: Paint",
      run: () => {
        useToolStore.getState().setActiveTool("paint");
      },
    });
    expect(useToolStore.getState().activeTool).toBe("select");
    await invokeScript({ script: "scene.tool.select.paint" });
    expect(useToolStore.getState().activeTool).toBe("paint");
  });

  test("clicking a sub-tool chip activates parent tool + sub-tool", async () => {
    useCommandStore.getState().register({
      id: "scene.tool.subTool.select.select.select-polygon",
      title: "Sub-Tool: Select Polygon",
      run: () => {
        const store = useToolStore.getState();
        store.setActiveTool("select");
        store.setActiveSubTool("select", "select-polygon");
      },
    });
    useToolStore.setState({ activeTool: "paint", activeSubTool: {} });
    await invokeScript({
      script: "scene.tool.subTool.select.select.select-polygon",
    });
    const s = useToolStore.getState();
    expect(s.activeTool).toBe("select");
    expect(s.activeSubTool.select).toBe("select-polygon");
  });
});

// ---------------------------------------------------------------------------
// useBrushStore binding — Phase 1b store extension (BrushPanel migration)
// ---------------------------------------------------------------------------

describe("resolveBinding — brush store", () => {
  test("reads kind + size from the brush store", () => {
    const k = resolveBinding("store.brush.kind");
    expect(k.storeName).toBe("brush");
    expect(k.get()).toBe("brush-single");

    const s = resolveBinding("store.brush.size");
    expect(s.get()).toBe(1);

    useBrushStore.getState().setKind("brush-line");
    useBrushStore.getState().setSize(7);
    expect(k.get()).toBe("brush-line");
    expect(s.get()).toBe(7);
  });

  test("writes brush.size through the store action (clamped)", () => {
    const b = resolveBinding("store.brush.size");
    expect(b.set(5)).toBe(true);
    expect(useBrushStore.getState().size).toBe(5);
    // Out-of-range writes clamp via the store action.
    expect(b.set(999)).toBe(true);
    expect(useBrushStore.getState().size).toBe(20);
    expect(b.set(-3)).toBe(true);
    expect(useBrushStore.getState().size).toBe(1);
  });

  test("coerces numeric strings on size writes", () => {
    const b = resolveBinding("store.brush.size");
    expect(b.set("8")).toBe(true);
    expect(useBrushStore.getState().size).toBe(8);
  });

  test("writes brush.kind through the store action", () => {
    const b = resolveBinding("store.brush.kind");
    expect(b.set("brush-rect")).toBe(true);
    expect(useBrushStore.getState().kind).toBe("brush-rect");
  });
});

// ---------------------------------------------------------------------------
// New node-types (Phase 1b — BrushPanel)
// ---------------------------------------------------------------------------

describe("New node-types (Phase 1b — BrushPanel)", () => {
  test("NumberInput node accepts bind + min/max/step + widthPx", () => {
    const node: NodeSpec = {
      type: "NumberInput",
      bind: "store.brush.size",
      min: 1,
      max: 20,
      step: 1,
      widthPx: 48,
      ariaLabel: "Brush size value",
    };
    expect(node.type).toBe("NumberInput");
    expect(node.min).toBe(1);
    expect(node.max).toBe(20);
    expect(node.widthPx).toBe(48);
  });

  test("Slider node accepts bind + min/max + step + fill", () => {
    const node: NodeSpec = {
      type: "Slider",
      bind: "store.brush.size",
      min: 1,
      max: 20,
      step: 1,
      ariaLabel: "Brush size",
      fill: true,
    };
    expect(node.type).toBe("Slider");
    expect(node.fill).toBe(true);
  });

  test("Button node accepts shape: 'icon' + icon + disabledWhen", () => {
    const node: NodeSpec = {
      type: "Button",
      shape: "icon",
      icon: "Minus",
      iconSize: 14,
      ariaLabel: "Decrease brush size",
      disabledWhen: { bind: "store.brush.size", atMost: 1 },
      onClick: { script: "scene.brush.sizeDown" },
    };
    expect(node.type).toBe("Button");
    expect(node.shape).toBe("icon");
    expect(node.disabledWhen?.atMost).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Brush JSON spec — Phase 1b migration target
// ---------------------------------------------------------------------------

describe("Brush JSON spec", () => {
  test("loads as a PanelSpec with id 'brush'", () => {
    const spec = brushSpec as PanelSpec;
    expect(spec.id).toBe("brush");
    expect(spec.title).toBe("Brush");
    expect(spec.dockKind).toBe("dockable-window");
    expect(spec.root.type).toBe("Layout");
  });

  test("includes one ToggleButton tile per MOCK_BRUSHES entry (5)", () => {
    const spec = brushSpec as PanelSpec;
    let tileCount = 0;
    const visit = (n: unknown): void => {
      if (!n || typeof n !== "object") return;
      const obj = n as Record<string, unknown>;
      if (obj.type === "ToggleButton" && obj.shape === "tile") tileCount++;
      for (const v of Object.values(obj)) {
        if (Array.isArray(v)) v.forEach(visit);
        else if (typeof v === "object") visit(v);
      }
    };
    visit(spec);
    expect(tileCount).toBe(5);
  });

  test("contains exactly one Slider node bound to brush.size", () => {
    const spec = brushSpec as PanelSpec;
    let sliderCount = 0;
    const visit = (n: unknown): void => {
      if (!n || typeof n !== "object") return;
      const obj = n as Record<string, unknown>;
      if (obj.type === "Slider" && obj.bind === "store.brush.size") {
        sliderCount++;
      }
      for (const v of Object.values(obj)) {
        if (Array.isArray(v)) v.forEach(visit);
        else if (typeof v === "object") visit(v);
      }
    };
    visit(spec);
    expect(sliderCount).toBe(1);
  });

  test("contains exactly one NumberInput node bound to brush.size", () => {
    const spec = brushSpec as PanelSpec;
    let count = 0;
    const visit = (n: unknown): void => {
      if (!n || typeof n !== "object") return;
      const obj = n as Record<string, unknown>;
      if (obj.type === "NumberInput" && obj.bind === "store.brush.size") {
        count++;
      }
      for (const v of Object.values(obj)) {
        if (Array.isArray(v)) v.forEach(visit);
        else if (typeof v === "object") visit(v);
      }
    };
    visit(spec);
    expect(count).toBe(1);
  });

  test("contains +/- icon Buttons gated by atMost/atLeast disabledWhen", () => {
    const spec = brushSpec as PanelSpec;
    let minusGate = false;
    let plusGate = false;
    const visit = (n: unknown): void => {
      if (!n || typeof n !== "object") return;
      const obj = n as Record<string, unknown>;
      if (obj.type === "Button" && obj.shape === "icon") {
        const dw = obj.disabledWhen as
          | { bind?: string; atMost?: number; atLeast?: number }
          | undefined;
        if (dw?.bind === "store.brush.size" && dw.atMost === 1) {
          minusGate = true;
        }
        if (dw?.bind === "store.brush.size" && dw.atLeast === 20) {
          plusGate = true;
        }
      }
      for (const v of Object.values(obj)) {
        if (Array.isArray(v)) v.forEach(visit);
        else if (typeof v === "object") visit(v);
      }
    };
    visit(spec);
    expect(minusGate).toBe(true);
    expect(plusGate).toBe(true);
  });

  test("every script-ref onClick points at a known scene.brush.* command id", () => {
    const spec = brushSpec as PanelSpec;
    const scripts: string[] = [];
    const visit = (n: unknown): void => {
      if (!n || typeof n !== "object") return;
      const obj = n as Record<string, unknown>;
      if (obj.type === "Button" || obj.type === "ToggleButton") {
        const oc = obj.onClick as { script?: unknown } | undefined;
        if (oc && typeof oc.script === "string") scripts.push(oc.script);
      }
      for (const v of Object.values(obj)) {
        if (Array.isArray(v)) v.forEach(visit);
        else if (typeof v === "object") visit(v);
      }
    };
    visit(spec);
    expect(scripts.length).toBeGreaterThan(0);
    for (const s of scripts) {
      expect(s.startsWith("scene.brush.")).toBe(true);
    }
  });

  test("every binding path in the spec resolves without throwing", () => {
    const spec = brushSpec as PanelSpec;
    const paths: string[] = [];
    const visit = (n: unknown): void => {
      if (!n || typeof n !== "object") return;
      const obj = n as Record<string, unknown>;
      for (const [k, v] of Object.entries(obj)) {
        if ((k === "bind" || k === "when") && typeof v === "string") {
          paths.push(v);
        }
        if (Array.isArray(v)) v.forEach(visit);
        else if (typeof v === "object") visit(v);
      }
    };
    visit(spec);
    expect(paths.length).toBeGreaterThan(0);
    for (const p of paths) {
      expect(() => resolveBinding(p).get()).not.toThrow();
    }
  });

  test("invoking scene.brush.set.brush-line via the registry changes kind", async () => {
    useCommandStore.getState().register({
      id: "scene.brush.set.brush-line",
      title: "Set Brush: Line",
      run: () => {
        useBrushStore.getState().setKind("brush-line");
      },
    });
    expect(useBrushStore.getState().kind).toBe("brush-single");
    await invokeScript({ script: "scene.brush.set.brush-line" });
    expect(useBrushStore.getState().kind).toBe("brush-line");
  });

  test("invoking scene.brush.sizeUp steps size", async () => {
    useCommandStore.getState().register({
      id: "scene.brush.sizeUp",
      title: "Increase Brush Size",
      run: () => {
        useBrushStore.getState().sizeUp();
      },
    });
    expect(useBrushStore.getState().size).toBe(1);
    await invokeScript({ script: "scene.brush.sizeUp" });
    expect(useBrushStore.getState().size).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// QuickTools JSON spec — Phase 1b migration target
// ---------------------------------------------------------------------------

describe("QuickTools JSON spec", () => {
  test("loads as a PanelSpec with id 'quick-tools'", () => {
    const spec = quickToolsSpec as PanelSpec;
    expect(spec.id).toBe("quick-tools");
    expect(spec.title).toBe("Quick Tools");
    expect(spec.category).toBe("Tools");
    expect(spec.dockKind).toBe("dockable-window");
    expect(spec.root.type).toBe("Layout");
  });

  test("includes one ToggleButton tag per MOCK_QUICK_TOOLS entry (10)", () => {
    const spec = quickToolsSpec as PanelSpec;
    let tagCount = 0;
    const visit = (n: unknown): void => {
      if (!n || typeof n !== "object") return;
      const obj = n as Record<string, unknown>;
      if (obj.type === "ToggleButton" && obj.shape === "tag") tagCount++;
      for (const v of Object.values(obj)) {
        if (Array.isArray(v)) v.forEach(visit);
        else if (typeof v === "object") visit(v);
      }
    };
    visit(spec);
    expect(tagCount).toBe(MOCK_QUICK_TOOLS.length);
    expect(tagCount).toBe(10);
  });

  test("each tag ToggleButton binds to cells[selected].tags + activeWhenContains its id", () => {
    const spec = quickToolsSpec as PanelSpec;
    const ids = new Set<string>();
    const visit = (n: unknown): void => {
      if (!n || typeof n !== "object") return;
      const obj = n as Record<string, unknown>;
      if (obj.type === "ToggleButton" && obj.shape === "tag") {
        expect(obj.bind).toBe("store.scene.cells[selected].tags");
        if (typeof obj.activeWhenContains === "string") {
          ids.add(obj.activeWhenContains);
        }
      }
      for (const v of Object.values(obj)) {
        if (Array.isArray(v)) v.forEach(visit);
        else if (typeof v === "object") visit(v);
      }
    };
    visit(spec);
    // Every MOCK_QUICK_TOOLS id should appear as an activeWhenContains
    // discriminant — otherwise a chip's pressed state would never flip.
    for (const t of MOCK_QUICK_TOOLS) {
      expect(ids.has(t.id)).toBe(true);
    }
  });

  test("each tag chip is gated disabled when selection is nullish", () => {
    const spec = quickToolsSpec as PanelSpec;
    let gatedCount = 0;
    const visit = (n: unknown): void => {
      if (!n || typeof n !== "object") return;
      const obj = n as Record<string, unknown>;
      if (obj.type === "ToggleButton" && obj.shape === "tag") {
        const dw = obj.disabledWhen as
          | { bind?: string; isNullish?: boolean }
          | undefined;
        if (
          dw?.bind === "store.selection.selected" &&
          dw.isNullish === true
        ) {
          gatedCount++;
        }
      }
      for (const v of Object.values(obj)) {
        if (Array.isArray(v)) v.forEach(visit);
        else if (typeof v === "object") visit(v);
      }
    };
    visit(spec);
    expect(gatedCount).toBe(MOCK_QUICK_TOOLS.length);
  });

  test("Clear-all button is gated by notEmpty on cells[selected].tags", () => {
    const spec = quickToolsSpec as PanelSpec;
    let found = false;
    const visit = (n: unknown): void => {
      if (!n || typeof n !== "object") return;
      const obj = n as Record<string, unknown>;
      if (
        obj.type === "Conditional" &&
        obj.when === "store.scene.cells[selected].tags" &&
        obj.notEmpty === true
      ) {
        found = true;
      }
      for (const v of Object.values(obj)) {
        if (Array.isArray(v)) v.forEach(visit);
        else if (typeof v === "object") visit(v);
      }
    };
    visit(spec);
    expect(found).toBe(true);
  });

  test("header has a Conditional gated by selection === null for the empty-state label", () => {
    const spec = quickToolsSpec as PanelSpec;
    let found = false;
    const visit = (n: unknown): void => {
      if (!n || typeof n !== "object") return;
      const obj = n as Record<string, unknown>;
      if (
        obj.type === "Conditional" &&
        obj.when === "store.selection.selected" &&
        obj.equals === null
      ) {
        found = true;
      }
      for (const v of Object.values(obj)) {
        if (Array.isArray(v)) v.forEach(visit);
        else if (typeof v === "object") visit(v);
      }
    };
    visit(spec);
    expect(found).toBe(true);
  });

  test("uses the applyCount text formatter for the header badge", () => {
    const spec = quickToolsSpec as PanelSpec;
    let found = false;
    const visit = (n: unknown): void => {
      if (!n || typeof n !== "object") return;
      const obj = n as Record<string, unknown>;
      if (
        obj.type === "Text" &&
        obj.format === "applyCount" &&
        obj.text === "store.scene.cells[selected].tags"
      ) {
        found = true;
      }
      for (const v of Object.values(obj)) {
        if (Array.isArray(v)) v.forEach(visit);
        else if (typeof v === "object") visit(v);
      }
    };
    visit(spec);
    expect(found).toBe(true);
  });

  test("every script-ref onClick points at a known scene.quickTools.* command id", () => {
    const spec = quickToolsSpec as PanelSpec;
    const scripts: string[] = [];
    const visit = (n: unknown): void => {
      if (!n || typeof n !== "object") return;
      const obj = n as Record<string, unknown>;
      if (obj.type === "Button" || obj.type === "ToggleButton") {
        const oc = obj.onClick as { script?: unknown } | undefined;
        if (oc && typeof oc.script === "string") scripts.push(oc.script);
      }
      for (const v of Object.values(obj)) {
        if (Array.isArray(v)) v.forEach(visit);
        else if (typeof v === "object") visit(v);
      }
    };
    visit(spec);
    expect(scripts.length).toBeGreaterThan(0);
    for (const s of scripts) {
      expect(s.startsWith("scene.quickTools.")).toBe(true);
    }
  });

  test("every binding path in the spec resolves without throwing", () => {
    const spec = quickToolsSpec as PanelSpec;
    const paths: string[] = [];
    const visit = (n: unknown): void => {
      if (!n || typeof n !== "object") return;
      const obj = n as Record<string, unknown>;
      for (const [k, v] of Object.entries(obj)) {
        if ((k === "bind" || k === "when") && typeof v === "string") {
          paths.push(v);
        }
        if (Array.isArray(v)) v.forEach(visit);
        else if (typeof v === "object") visit(v);
      }
    };
    visit(spec);
    expect(paths.length).toBeGreaterThan(0);
    for (const p of paths) {
      expect(() => resolveBinding(p).get()).not.toThrow();
    }
  });

  test("invoking scene.quickTools.tag.toggle.solid toggles the tag on the selected cell", async () => {
    useCommandStore.getState().register({
      id: "scene.quickTools.tag.toggle.solid",
      title: "Toggle Quick-Tool: Solid",
      run: () => {
        const sel = useSelectionStore.getState().selected;
        if (!sel) return;
        useSceneStore.getState().toggleCellTag(sel.x, sel.y, "solid");
      },
    });
    useSelectionStore.getState().select({ x: 2, y: 3 });
    expect(
      useSceneStore.getState().cells["2,3"]?.tags ?? [],
    ).not.toContain("solid");
    await invokeScript({ script: "scene.quickTools.tag.toggle.solid" });
    expect(useSceneStore.getState().cells["2,3"]?.tags).toContain("solid");
    // Toggling again removes it.
    await invokeScript({ script: "scene.quickTools.tag.toggle.solid" });
    expect(
      useSceneStore.getState().cells["2,3"]?.tags ?? [],
    ).not.toContain("solid");
  });

  test("invoking scene.quickTools.tag.toggle is a no-op when nothing is selected", async () => {
    useCommandStore.getState().register({
      id: "scene.quickTools.tag.toggle.solid",
      title: "Toggle Quick-Tool: Solid",
      run: () => {
        const sel = useSelectionStore.getState().selected;
        if (!sel) return;
        useSceneStore.getState().toggleCellTag(sel.x, sel.y, "solid");
      },
    });
    expect(useSelectionStore.getState().selected).toBeNull();
    await invokeScript({ script: "scene.quickTools.tag.toggle.solid" });
    // No cells should have been touched.
    expect(Object.keys(useSceneStore.getState().cells).length).toBe(0);
  });

  test("invoking scene.quickTools.clear clears only quick-tool tags, not user tags", async () => {
    useCommandStore.getState().register({
      id: "scene.quickTools.clear",
      title: "Clear All Quick-Tools",
      run: () => {
        const sel = useSelectionStore.getState().selected;
        if (!sel) return;
        const k = `${sel.x},${sel.y}`;
        const cur = useSceneStore.getState().cells[k]?.tags ?? [];
        const quickIds = new Set<string>(MOCK_QUICK_TOOLS.map((t) => t.id));
        const toggle = useSceneStore.getState().toggleCellTag;
        for (const tag of cur) {
          if (quickIds.has(tag)) toggle(sel.x, sel.y, tag);
        }
      },
    });
    // Plant a cell with mixed quick-tool + user-added tags.
    useSceneStore.setState((s) => ({
      cells: {
        ...s.cells,
        "5,5": {
          layers: {},
          height: 0,
          tags: ["solid", "door", "user-custom"],
          properties: {},
        },
      },
    }));
    useSelectionStore.getState().select({ x: 5, y: 5 });
    await invokeScript({ script: "scene.quickTools.clear" });
    const remaining = useSceneStore.getState().cells["5,5"]?.tags ?? [];
    expect(remaining).not.toContain("solid");
    expect(remaining).not.toContain("door");
    // User-added tag survives — that's the contract.
    expect(remaining).toContain("user-custom");
  });
});

// ---------------------------------------------------------------------------
// New node-type extensions (Phase 1b — QuickToolsPanel)
// ---------------------------------------------------------------------------

describe("New node-types (Phase 1b — QuickToolsPanel)", () => {
  test("ToggleButton accepts activeWhenContains + disabledWhen.isNullish + shape 'tag'", () => {
    const node: NodeSpec = {
      type: "ToggleButton",
      shape: "tag",
      bind: "store.scene.cells[selected].tags",
      activeWhenContains: "solid",
      text: "Solid",
      disabledWhen: {
        bind: "store.selection.selected",
        isNullish: true,
      },
      onClick: { script: "scene.quickTools.tag.toggle.solid" },
    };
    expect(node.type).toBe("ToggleButton");
    expect(node.shape).toBe("tag");
    expect(node.activeWhenContains).toBe("solid");
    expect(node.disabledWhen?.isNullish).toBe(true);
  });

  test("Conditional accepts equals: null for nullish gating", () => {
    const node: NodeSpec = {
      type: "Conditional",
      when: "store.selection.selected",
      equals: null,
      children: [{ type: "Text", text: "Quick Tools — select a cell" }],
    };
    expect(node.equals).toBeNull();
  });

  test("Conditional accepts notEmpty for length-aware gating", () => {
    const node: NodeSpec = {
      type: "Conditional",
      when: "store.scene.cells[selected].tags",
      notEmpty: true,
      children: [{ type: "Text", text: "Clear all" }],
    };
    expect(node.notEmpty).toBe(true);
  });

  test("Text accepts the applyCount format", () => {
    const node: NodeSpec = {
      type: "Text",
      variant: "label",
      text: "store.scene.cells[selected].tags",
      format: "applyCount",
    };
    expect(node.format).toBe("applyCount");
  });
});

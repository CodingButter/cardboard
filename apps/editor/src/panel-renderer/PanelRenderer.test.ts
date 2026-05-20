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
import { useCommandStore } from "../state/useCommandStore";
import demoSpec from "./test-fixtures/demo-selection-info.json";
import type { PanelSpec } from "./types";

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
  useCommandStore.setState({ commands: {}, recent: [] });
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

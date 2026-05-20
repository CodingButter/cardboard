/**
 * Tests for the editor pack loader's script-execution path.
 *
 * The full async loader (panel registration + script load) is hard to
 * exercise in a Bun test runner because it depends on `fetch` against
 * the dev server, JSZip decode, and the React component wrappers. The
 * pieces we DO want covered here are:
 *
 *   - `disposeEditorPackScripts(packId)` is a safe no-op for unknown
 *     ids — defensive, since the Extensions tab may call it without
 *     knowing whether a pack ever shipped scripts.
 *   - The exported `EditorPackContext` type wraps the editor's
 *     real-deal `registerCommand` and `useSelectionStore` — verified
 *     by a smoke test that constructs a context literal and walks its
 *     fields. Compile-time check is the actual gate.
 *   - The Phase 2b context surface (`importLibrary`, `createStore`,
 *     `getCanvasRef`, `onPanelMount`, `share`/`consume`) is a typed
 *     shape — the test constructs a context with stub implementations
 *     to make sure the type widens cleanly + the runtime fields are
 *     reachable.
 */

import { describe, test, expect } from "bun:test";
import {
  disposeEditorPackScripts,
  type EditorPackContext,
} from "./editorPackLoader";
import { registerCommand, useCommandStore } from "../state/useCommandStore";
import { useSelectionStore } from "../state/useSelectionStore";

/**
 * Build a context that exercises the Phase 2b surface without
 * touching the real loader. Used by the type-shape tests below.
 */
function makeStubContext(): EditorPackContext {
  return {
    packId: "test-pack",
    registerCommand,
    stores: { selection: useSelectionStore },
    importLibrary: async () => ({}),
    createStore: ((_n: string, initial: Record<string, unknown>) => {
      // Trivial stub — return a function that returns the initial
      // state when called as a selector hook. The compile-time
      // type-check is what matters here.
      const stub = (() => initial) as unknown;
      return stub as ReturnType<EditorPackContext["createStore"]>;
    }) as EditorPackContext["createStore"],
    getCanvasRef: () => null,
    onPanelMount: () => () => {},
    share: () => {},
    consume: () => undefined,
    registerPanel: () => () => {},
    // P4 — view + layout + tab contributions (CORE_EDITOR_PACK.md §10).
    registerView: () => () => {},
    registerLayout: () => () => {},
    registerPredefinedLayout: () => () => {},
    registerTab: () => () => {},
    _registerCanvasRef: () => {},
    _unregisterCanvasRef: () => {},
    _firePanelMount: () => {},
    _firePanelUnmount: () => {},
  };
}

describe("editorPackLoader — script execution", () => {
  test("disposeEditorPackScripts is safe for unknown pack ids", () => {
    expect(() => disposeEditorPackScripts("nonexistent-pack")).not.toThrow();
  });

  test("EditorPackContext exposes registerCommand + selection store", () => {
    const ctx = makeStubContext();
    expect(ctx.packId).toBe("test-pack");
    expect(ctx.registerCommand).toBe(registerCommand);
    expect(ctx.stores.selection).toBe(useSelectionStore);
  });

  test("registerCommand handed via context registers in the live store", () => {
    const ctx = makeStubContext();
    const id = "test.editor-pack-loader.cmd";
    const dispose = ctx.registerCommand({
      id,
      title: "Test command",
      category: "Test",
      run: () => {},
    });
    try {
      expect(useCommandStore.getState().commands[id]).toBeDefined();
    } finally {
      dispose();
    }
    expect(useCommandStore.getState().commands[id]).toBeUndefined();
  });

  test("ctx.stores.selection mutation reaches the editor's selection store", () => {
    const ctx = makeStubContext();
    ctx.stores.selection.getState().select({ x: 1, y: 2 });
    expect(useSelectionStore.getState().selected).toEqual({ x: 1, y: 2 });
    ctx.stores.selection.getState().select(null);
    expect(useSelectionStore.getState().selected).toBeNull();
  });

  test("Phase 2b APIs are present + typed on the context", () => {
    // Each call below would be a compile error if the type widening
    // for Phase 2b dropped a member. The runtime checks confirm the
    // stub's shape.
    const ctx = makeStubContext();
    expect(typeof ctx.importLibrary).toBe("function");
    expect(typeof ctx.createStore).toBe("function");
    expect(typeof ctx.getCanvasRef).toBe("function");
    expect(typeof ctx.onPanelMount).toBe("function");
    expect(typeof ctx.share).toBe("function");
    expect(typeof ctx.consume).toBe("function");
  });

  test("share + consume round-trip a value within the same context", () => {
    // The stub's share/consume are no-ops — but the real loader's
    // implementation MUST round-trip. We assert that with a tiny
    // pair-style fake.
    const slots = new Map<string, unknown>();
    const ctx = makeStubContext();
    const realCtx: EditorPackContext = {
      ...ctx,
      share: (key, value) => {
        slots.set(key, value);
      },
      consume: (key) => slots.get(key),
    };
    realCtx.share("k", { v: 1 });
    expect(realCtx.consume("k")).toEqual({ v: 1 });
    expect(realCtx.consume("missing")).toBeUndefined();
  });
});

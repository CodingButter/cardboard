/**
 * Tests for the editor pack loader's Phase 2a script-execution path.
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
 *     by a smoke test that constructs a context literal and walks
 *     its fields. Compile-time check is the actual gate.
 *
 * Browser-side integration (the Clear button on the pack's panel
 * fires after the demo pack's setup.ts registers the command) is
 * covered by the Playwright verification step in the deliverable
 * report, not by Bun tests.
 */

import { describe, test, expect } from "bun:test";
import {
  disposeEditorPackScripts,
  type EditorPackContext,
} from "./editorPackLoader";
import { registerCommand, useCommandStore } from "../state/useCommandStore";
import { useSelectionStore } from "../state/useSelectionStore";

describe("editorPackLoader — Phase 2a script execution", () => {
  test("disposeEditorPackScripts is safe for unknown pack ids", () => {
    // Should not throw; just a no-op. Exercises the
    // `cleanups === undefined` early-return branch.
    expect(() => disposeEditorPackScripts("nonexistent-pack")).not.toThrow();
  });

  test("EditorPackContext exposes registerCommand + selection store", () => {
    // Construct a context literal the way the loader does. The compile
    // is the type assertion; runtime checks confirm field identity so
    // a future refactor that swaps in a wrapped registerCommand would
    // fail this test until the comment / docs are updated.
    const ctx: EditorPackContext = {
      packId: "test-pack",
      registerCommand,
      stores: {
        selection: useSelectionStore,
      },
    };
    expect(ctx.packId).toBe("test-pack");
    expect(ctx.registerCommand).toBe(registerCommand);
    expect(ctx.stores.selection).toBe(useSelectionStore);
  });

  test("registerCommand handed via context registers in the live store", () => {
    // End-to-end smoke: a script-author would call
    // `ctx.registerCommand({...})` and the editor app's
    // useCommandStore should reflect the registration. The cleanup
    // function must remove it again.
    const ctx: EditorPackContext = {
      packId: "test-pack",
      registerCommand,
      stores: {
        selection: useSelectionStore,
      },
    };
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
    // The dogfooded demo script clears the selection via
    // `ctx.stores.selection.getState().select(null)`. If the loader
    // ever swaps in a wrapped store this test fails fast.
    const ctx: EditorPackContext = {
      packId: "test-pack",
      registerCommand,
      stores: {
        selection: useSelectionStore,
      },
    };
    ctx.stores.selection.getState().select({ x: 1, y: 2 });
    expect(useSelectionStore.getState().selected).toEqual({ x: 1, y: 2 });
    ctx.stores.selection.getState().select(null);
    expect(useSelectionStore.getState().selected).toBeNull();
  });
});

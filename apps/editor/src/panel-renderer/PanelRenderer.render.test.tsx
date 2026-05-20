/**
 * PanelRenderer render tests — Fix 2 of pack-loader edge-case audit.
 *
 * The PanelRenderer's `useStoreBinding` hook used to call a zustand
 * hook as a sentinel when the binding's dynamic store wasn't
 * registered:
 *
 *     const storeHook = getStoreHook(binding.storeName) ?? useLayerStore;
 *     storeHook((s) => s);
 *
 * That works ONLY because every zustand hook happens to call the same
 * number of internal React hooks today. A future zustand internals
 * change (or a swap of the fallback to a non-zustand hook) would break
 * the hook order silently. The fix replaces that branch with a single
 * unconditional `React.useSyncExternalStore` whose subscribe +
 * getSnapshot close over the binding's store name — one React hook
 * called regardless of whether the dynamic store is registered.
 *
 * These tests use `react-dom/server`'s `renderToString` to walk a real
 * PanelRenderer tree through React's hook machinery, exercising the
 * `useStoreBinding` hook end-to-end. A DOM-backed `act()`-style
 * re-render harness isn't wired into `bun test` (no jsdom / happy-dom),
 * so the "swap DYNAMIC_STORES under a mounted panel" property is
 * exercised across consecutive fresh-mount renders that cross the
 * registration boundary in the middle — same hook ordering contract,
 * same panel spec, different store registration state.
 *
 * Audit reference: `PanelRenderer.tsx:264` (pre-fix line) — the
 * `?? useLayerStore` sentinel hook fallback that this commit removes.
 */

import { describe, expect, test } from "bun:test";
import React from "react";
import { renderToString } from "react-dom/server";
import { create } from "zustand";
import type { StoreApi, UseBoundStore } from "zustand";
import { PanelRenderer } from "./PanelRenderer";
import { registerDynamicStore } from "./resolveBinding";
import type { NodeSpec, PanelSpec } from "./types";

/**
 * A minimal PanelSpec that binds a `Text` node to a dynamic store
 * path. The renderer reaches into the binding via `useStoreBinding`,
 * which is the hook the fix rewrites.
 */
function makeSpec(storeName: string): PanelSpec {
  return {
    id: `t-${storeName}`,
    title: "swap-test",
    category: "main",
    dockKind: "dockable-window",
    root: {
      type: "Text",
      text: `$store.${storeName}.value` as `$store.${string}`,
    },
  };
}

describe("PanelRenderer — DYNAMIC_STORES swap (Fix 2)", () => {
  test("renders without React error when the dynamic store is present", () => {
    // Baseline: register the dynamic store, render a panel that
    // binds to it. This exercises the new `useSyncExternalStore`
    // single-hook subscription path end-to-end through a real React
    // render — the hook is called unconditionally regardless of the
    // store's presence.
    const hook = create<{ value: string }>(() => ({ value: "from-store-A" }));
    const unregister = registerDynamicStore(
      "swap-test-A",
      hook as unknown as UseBoundStore<StoreApi<unknown>>,
    );
    try {
      const spec = makeSpec("swap-test-A");
      let error: unknown = null;
      let html = "";
      try {
        html = renderToString(React.createElement(PanelRenderer, { spec }));
      } catch (e) {
        error = e;
      }
      expect(error).toBeNull();
      expect(html).toContain("from-store-A");
    } finally {
      unregister();
    }
  });

  test(
    "swap DYNAMIC_STORES across consecutive mounts: no React error, picks up new value",
    () => {
      // The audit's stated case: a dynamic store changes identity
      // between renders. Pre-fix, the renderer's hook-call IDENTITY
      // could diverge — `getStoreHook(...) ?? useLayerStore` resolves
      // to the dynamic store's hook on render 1 and a DIFFERENT hook
      // on render 2 if the store was unregistered (the
      // `useLayerStore` sentinel) — coincidentally same hook count
      // today, but flagged as fragile. Post-fix, the same single
      // `useSyncExternalStore` call carries the subscription across
      // both mounts.
      //
      // We swap the dynamic store's BACKING under the same name
      // between renders so the rendered TEXT changes — proving the
      // subscription tracks the live store, not a captured reference.
      const spec = makeSpec("swap-test-B");

      // Mount 1: store A under the name.
      const hookA = create<{ value: string }>(() => ({ value: "mount-1" }));
      const uA = registerDynamicStore(
        "swap-test-B",
        hookA as unknown as UseBoundStore<StoreApi<unknown>>,
      );
      let h1 = "";
      let e1: unknown = null;
      try {
        h1 = renderToString(React.createElement(PanelRenderer, { spec }));
      } catch (e) {
        e1 = e;
      }
      expect(e1).toBeNull();
      expect(h1).toContain("mount-1");
      uA();

      // Mount 2: re-register the same name to a different store.
      const hookB = create<{ value: string }>(() => ({ value: "mount-2" }));
      const uB = registerDynamicStore(
        "swap-test-B",
        hookB as unknown as UseBoundStore<StoreApi<unknown>>,
      );
      try {
        let h2 = "";
        let e2: unknown = null;
        try {
          h2 = renderToString(React.createElement(PanelRenderer, { spec }));
        } catch (e) {
          e2 = e;
        }
        expect(e2).toBeNull();
        expect(h2).toContain("mount-2");
        // Sanity: this is a SEPARATELY-rendered tree, not a stale
        // re-render of the first. The first mount's "mount-1" text
        // must not appear in the second mount's output.
        expect(h2).not.toContain("mount-1");
      } finally {
        uB();
      }
    },
  );

  test(
    "rapid register/unregister cycle does not produce a hook-order error",
    () => {
      // Three successive mounts: registered → unregistered + new
      // registration under same name → unregistered + another new
      // registration. Pre-fix, each transition risked a divergent
      // hook identity at the `?? useLayerStore` fallback site. The
      // new `useSyncExternalStore` is a SINGLE React hook called
      // unconditionally, so identity is invariant across cycles.
      const spec = makeSpec("swap-test-C");
      const seen: string[] = [];

      for (let i = 0; i < 3; i++) {
        const hook = create<{ value: string }>(() => ({
          value: `cycle-${i}`,
        }));
        const u = registerDynamicStore(
          "swap-test-C",
          hook as unknown as UseBoundStore<StoreApi<unknown>>,
        );
        let html = "";
        let err: unknown = null;
        try {
          html = renderToString(React.createElement(PanelRenderer, { spec }));
        } catch (e) {
          err = e;
        }
        expect(err).toBeNull();
        seen.push(html);
        u();
      }
      expect(seen).toHaveLength(3);
      expect(seen[0]).toContain("cycle-0");
      expect(seen[1]).toContain("cycle-1");
      expect(seen[2]).toContain("cycle-2");
    },
  );
});

// ---------------------------------------------------------------------------
// RenderSpec — recursive PanelRenderer (JSON Visual Builder VB2).
//
// The risk flagged by docs/plans/JSON_VISUAL_BUILDER.md §10 is that
// `<PanelRenderer>` was not written with a "render a spec resolved from
// a binding" use case in mind — every existing call mounts it once at
// the top of a panel. The `RenderSpec` node mounts a `<NodeRenderer>`
// (the renderer's recursive dispatcher) on a binding-resolved value
// from INSIDE another `<PanelRenderer>` tree. These tests prove the
// reentrancy works without a React error.
// ---------------------------------------------------------------------------

describe("PanelRenderer — RenderSpec recursive render (VB2)", () => {
  test("renders a NodeSpec value resolved from a dynamic store binding", () => {
    // Outer spec: a panel with a single RenderSpec node that points at
    // the dynamic-store's root. The store holds a Heading NodeSpec —
    // the recursive walker should land on that Heading and render its
    // text into the outer panel's tree.
    interface BuilderState {
      root: NodeSpec;
    }
    const hook = create<BuilderState>(() => ({
      root: {
        type: "Heading",
        text: "Recursive heading rendered through RenderSpec",
        level: 2,
      },
    }));
    const unregister = registerDynamicStore(
      "vb2-recursive-1",
      hook as unknown as UseBoundStore<StoreApi<unknown>>,
    );
    try {
      const spec: PanelSpec = {
        id: "vb2-outer",
        title: "Outer",
        category: "Custom",
        dockKind: "dockable-window",
        root: {
          type: "RenderSpec",
          from: "$store.vb2-recursive-1.root",
        },
      };
      let err: unknown = null;
      let html = "";
      try {
        html = renderToString(React.createElement(PanelRenderer, { spec }));
      } catch (e) {
        err = e;
      }
      expect(err).toBeNull();
      expect(html).toContain("Recursive heading rendered through RenderSpec");
    } finally {
      unregister();
    }
  });

  test("renders a NodeSpec tree (Layout with children) through RenderSpec", () => {
    // The realistic case for the panel builder: the store's root is a
    // Layout containing the user's dropped nodes. The recursive walker
    // should descend through the Layout into each Heading.
    interface BuilderState {
      root: NodeSpec;
    }
    const hook = create<BuilderState>(() => ({
      root: {
        type: "Layout",
        direction: "column",
        children: [
          { type: "Heading", text: "Child one" },
          { type: "Heading", text: "Child two" },
          { type: "Heading", text: "Child three" },
        ],
      },
    }));
    const unregister = registerDynamicStore(
      "vb2-recursive-2",
      hook as unknown as UseBoundStore<StoreApi<unknown>>,
    );
    try {
      const spec: PanelSpec = {
        id: "vb2-outer-tree",
        title: "Outer",
        category: "Custom",
        dockKind: "dockable-window",
        root: {
          type: "RenderSpec",
          from: "$store.vb2-recursive-2.root",
        },
      };
      let err: unknown = null;
      let html = "";
      try {
        html = renderToString(React.createElement(PanelRenderer, { spec }));
      } catch (e) {
        err = e;
      }
      expect(err).toBeNull();
      expect(html).toContain("Child one");
      expect(html).toContain("Child two");
      expect(html).toContain("Child three");
    } finally {
      unregister();
    }
  });

  test("renders a PanelSpec value resolved from a binding (unwraps to .root)", () => {
    // The renderer accepts either a NodeSpec OR a full PanelSpec — the
    // builder's preview-store mode (VB6) may eventually hand back a
    // full PanelSpec, and we want today's RenderSpec to handle it.
    interface BuilderState {
      spec: PanelSpec;
    }
    const hook = create<BuilderState>(() => ({
      spec: {
        id: "wrapped",
        title: "Wrapped",
        category: "Custom",
        dockKind: "dockable-window",
        root: {
          type: "Heading",
          text: "Wrapped PanelSpec text",
        },
      },
    }));
    const unregister = registerDynamicStore(
      "vb2-recursive-3",
      hook as unknown as UseBoundStore<StoreApi<unknown>>,
    );
    try {
      const spec: PanelSpec = {
        id: "vb2-outer-spec",
        title: "Outer",
        category: "Custom",
        dockKind: "dockable-window",
        root: {
          type: "RenderSpec",
          from: "$store.vb2-recursive-3.spec",
        },
      };
      let err: unknown = null;
      let html = "";
      try {
        html = renderToString(React.createElement(PanelRenderer, { spec }));
      } catch (e) {
        err = e;
      }
      expect(err).toBeNull();
      expect(html).toContain("Wrapped PanelSpec text");
    } finally {
      unregister();
    }
  });

  test("RenderSpec with a missing / undefined binding renders nothing without error", () => {
    // The store key exists but resolves to undefined — the renderer
    // should fall through coerceSpecValue → return null without
    // throwing. This is the "fresh draft, no root assigned" case.
    interface BuilderState {
      root: NodeSpec | undefined;
    }
    const hook = create<BuilderState>(() => ({ root: undefined }));
    const unregister = registerDynamicStore(
      "vb2-recursive-4",
      hook as unknown as UseBoundStore<StoreApi<unknown>>,
    );
    try {
      const spec: PanelSpec = {
        id: "vb2-outer-missing",
        title: "Outer",
        category: "Custom",
        dockKind: "dockable-window",
        root: {
          type: "RenderSpec",
          from: "$store.vb2-recursive-4.root",
        },
      };
      let err: unknown = null;
      let html = "";
      try {
        html = renderToString(React.createElement(PanelRenderer, { spec }));
      } catch (e) {
        err = e;
      }
      expect(err).toBeNull();
      // Outer panel wrapper still renders — but the recursive subtree
      // is empty.
      expect(html).toContain("data-panel-id=\"vb2-outer-missing\"");
    } finally {
      unregister();
    }
  });

  test("RenderSpec with a malformed (non-spec-shaped) binding renders nothing", () => {
    // A binding that points at a scalar / random object that isn't a
    // NodeSpec or PanelSpec. The renderer's coerceSpecValue returns
    // null and the recursive case renders nothing — no React error,
    // no console crash.
    interface BadState {
      garbage: unknown;
    }
    const hook = create<BadState>(() => ({ garbage: 42 }));
    const unregister = registerDynamicStore(
      "vb2-recursive-5",
      hook as unknown as UseBoundStore<StoreApi<unknown>>,
    );
    try {
      const spec: PanelSpec = {
        id: "vb2-outer-malformed",
        title: "Outer",
        category: "Custom",
        dockKind: "dockable-window",
        root: {
          type: "RenderSpec",
          from: "$store.vb2-recursive-5.garbage",
        },
      };
      let err: unknown = null;
      let html = "";
      try {
        html = renderToString(React.createElement(PanelRenderer, { spec }));
      } catch (e) {
        err = e;
      }
      expect(err).toBeNull();
      expect(html).toContain("data-panel-id=\"vb2-outer-malformed\"");
    } finally {
      unregister();
    }
  });

  test("doubly-recursive RenderSpec (RenderSpec inside a RenderSpec) renders without error", () => {
    // Two levels of recursion: the store's root is itself a RenderSpec
    // pointing at a SECOND store path. This exercises the "renderer
    // calls itself which calls itself" stack to make sure the
    // PackContext / hook order survives two levels deep.
    interface OuterState {
      root: NodeSpec;
    }
    interface InnerState {
      leaf: NodeSpec;
    }
    const innerHook = create<InnerState>(() => ({
      leaf: { type: "Heading", text: "Inner-most leaf" },
    }));
    const outerHook = create<OuterState>(() => ({
      root: { type: "RenderSpec", from: "$store.vb2-recursive-7.leaf" },
    }));
    const u1 = registerDynamicStore(
      "vb2-recursive-6",
      outerHook as unknown as UseBoundStore<StoreApi<unknown>>,
    );
    const u2 = registerDynamicStore(
      "vb2-recursive-7",
      innerHook as unknown as UseBoundStore<StoreApi<unknown>>,
    );
    try {
      const spec: PanelSpec = {
        id: "vb2-outer-double",
        title: "Outer",
        category: "Custom",
        dockKind: "dockable-window",
        root: {
          type: "RenderSpec",
          from: "$store.vb2-recursive-6.root",
        },
      };
      let err: unknown = null;
      let html = "";
      try {
        html = renderToString(React.createElement(PanelRenderer, { spec }));
      } catch (e) {
        err = e;
      }
      expect(err).toBeNull();
      expect(html).toContain("Inner-most leaf");
    } finally {
      u1();
      u2();
    }
  });
});

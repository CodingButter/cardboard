/**
 * Store-path resolver — Phase 0.
 *
 * Parses a string like `"store.scene.settings.name"` into a get/set pair
 * that reads from the matching Wave-3 Zustand store and writes back via
 * a registered store action when one exists.
 *
 * Phase 0 scope (deliberately tight — Phase 1 expands):
 *   • Supported stores: scene, selection.
 *     Adding a store = one line in `STORE_REGISTRY` below.
 *   • Static property access (`a.b.c.d`) — unlimited depth.
 *   • Dynamic index `[selected]` — resolves against
 *     `useSelectionStore.getState().selected`, formatted as the scene's
 *     `cellKey(x, y)`. Only this one dynamic indexer is special-cased.
 *   • Writes go through a small writer table that maps the canonical
 *     write paths to the store's existing action. Paths NOT in the
 *     writer table become read-only (set is a no-op + console.warn).
 *
 * Out of scope for Phase 0 (deferred to Phase 1):
 *   • Arbitrary computed indexers like `[hover.x]`.
 *   • Cross-store joins (`store.layers[selected.layerId]`).
 *   • Array-index numeric literals (`store.foo[3]`).
 *   • Method calls on the resolved value.
 *
 * The resolver is intentionally store-aware (not generic over arbitrary
 * Zustand stores) because the shell ships a known catalog of Wave-3
 * stores and pack authors bind against THAT catalog. Generic
 * resolution would require store reflection metadata that doesn't
 * exist today.
 */

import type { StoreApi, UseBoundStore } from "zustand";
import { useSceneStore, cellKey, type SceneState } from "../state/useSceneStore";
import {
  useSelectionStore,
  type SelectionState,
} from "../state/useSelectionStore";
import { useLayerStore, type LayerState } from "../state/useLayerStore";
import { useToolStore, type ToolState } from "../state/useToolStore";
import { useBrushStore, type BrushState } from "../state/useBrushStore";

/**
 * Tagged union of every store the resolver can read from. Adding a
 * store requires:
 *   1. Adding it to this union (so write paths can be typed).
 *   2. Adding an entry to STORE_REGISTRY below.
 *   3. Optionally adding write paths to WRITERS.
 */
export type KnownStoreName =
  | "scene"
  | "selection"
  | "layer"
  | "tool"
  | "brush";

/** Strip the optional `$store.` / `store.` prefix. */
function stripStorePrefix(raw: string): string {
  if (raw.startsWith("$store.")) return raw.slice("$store.".length);
  if (raw.startsWith("store.")) return raw.slice("store.".length);
  return raw;
}

/**
 * Tokenise a store path into ordered segments.
 *
 *   "scene.cells[selected].name"  →
 *   [
 *     { kind: "key", name: "scene" },
 *     { kind: "key", name: "cells" },
 *     { kind: "index", indexer: "selected" },
 *     { kind: "key", name: "name" },
 *   ]
 *
 * Hand-rolled because the path grammar is small enough to not warrant
 * a regex with backtracking surprises, and the explicit tokeniser
 * gives us better error messages.
 */
export type PathSegment =
  | { kind: "key"; name: string }
  | { kind: "index"; indexer: string };

export function tokenisePath(path: string): PathSegment[] {
  const body = stripStorePrefix(path);
  const out: PathSegment[] = [];
  let i = 0;
  let buf = "";
  const flushKey = (): void => {
    if (buf.length > 0) {
      out.push({ kind: "key", name: buf });
      buf = "";
    }
  };
  while (i < body.length) {
    const ch = body[i];
    if (ch === ".") {
      flushKey();
      i++;
    } else if (ch === "[") {
      flushKey();
      const close = body.indexOf("]", i);
      if (close === -1) {
        throw new Error(`resolveBinding: unterminated [ in "${path}"`);
      }
      const indexer = body.slice(i + 1, close).trim();
      if (indexer.length === 0) {
        throw new Error(`resolveBinding: empty index in "${path}"`);
      }
      out.push({ kind: "index", indexer });
      i = close + 1;
    } else {
      buf += ch;
      i++;
    }
  }
  flushKey();
  return out;
}

/**
 * Resolve a dynamic indexer to a concrete object key. Phase 0 supports
 * exactly one: `[selected]` → the scene-style cell key of the currently
 * selected cell, e.g. "3,7". Returns `null` when there's no selection,
 * which the read traversal treats as "cell doesn't exist".
 */
function resolveIndexer(indexer: string): string | null {
  if (indexer === "selected") {
    const sel = useSelectionStore.getState().selected;
    return sel ? cellKey(sel.x, sel.y) : null;
  }
  // Future: hover, cursor, layer-active, etc. Document the gap loudly.
  // eslint-disable-next-line no-console
  console.warn(
    `[resolveBinding] unsupported dynamic indexer "${indexer}" (Phase 0 supports only [selected])`,
  );
  return null;
}

// ---------------------------------------------------------------------------
// Store registry — name → zustand hook.
// ---------------------------------------------------------------------------

/**
 * Map of store-name → the bound zustand hook. The renderer's
 * `useStoreBinding` hook calls the hook inline so React resubscribes
 * automatically when the slice changes; the imperative `read` helper
 * uses `.getState()`.
 *
 * The cast through `unknown` is necessary because the hooks have
 * heterogeneous state shapes — the read-traversal narrows back to the
 * concrete shape on access.
 */
export const STORE_REGISTRY: Record<
  KnownStoreName,
  UseBoundStore<StoreApi<unknown>>
> = {
  scene: useSceneStore as unknown as UseBoundStore<StoreApi<unknown>>,
  selection: useSelectionStore as unknown as UseBoundStore<StoreApi<unknown>>,
  // Read-only for now — no writer entries below. The status-bar
  // SelectionInfo panel needs `store.layer.activeId` for the active-
  // layer name readout.
  layer: useLayerStore as unknown as UseBoundStore<StoreApi<unknown>>,
  // Read-only: ToolPalette panel binds against `store.tool.activeTool`
  // + `store.tool.activeSubTool[parent]` for tile/chip pressed state.
  // Writes route through the existing `scene.tool.select.<id>` /
  // `scene.tool.subTool.select.<parent>.<id>` commands registered by
  // the ToolPalette panel host, NOT through the resolver.
  tool: useToolStore as unknown as UseBoundStore<StoreApi<unknown>>,
  // BrushPanel binds against `store.brush.kind` (tile pressed state)
  // and `store.brush.size` (slider + number input value). The kind
  // selectors route through `scene.brush.set.<id>` commands the
  // BrushPanel host registers — read-only here. The size, however,
  // has a writer registered below so the slider/number-input can
  // round-trip through the panel-renderer's two-way binding.
  brush: useBrushStore as unknown as UseBoundStore<StoreApi<unknown>>,
};

/**
 * Pack-contributed Zustand stores. Editor packs that call
 * `ctx.createStore(name, ...)` register their bound hook here so JSON
 * panels can read `$store.<name>.<field>` exactly the way they read
 * built-in stores like `$store.scene.settings.name`.
 *
 * The dynamic table sits alongside `STORE_REGISTRY` so the resolver's
 * lookup widens to: "name in STORE_REGISTRY || DYNAMIC_STORES.has(name)".
 * Writes are NOT supported through this path — pack stores expose
 * their own setState through closures the script holds; the JSON
 * panel side is read-only. See `docs/plans/PERFORMANCE_PROFILER.md`
 * §3.2 (write-semantics rationale).
 *
 * Lifecycle: `registerDynamicStore` returns an unregister fn that the
 * editor pack loader stashes alongside its other per-pack cleanups,
 * so disabling a pack tears its store down.
 */
const DYNAMIC_STORES: Map<string, UseBoundStore<StoreApi<unknown>>> = new Map();

/**
 * Register a pack-contributed Zustand store under `name`. Returns an
 * unregister fn the caller MUST hold onto — calling it removes the
 * entry from the registry so subsequent `resolveBinding` calls treat
 * the name as unknown.
 *
 * Throws when `name` collides with a built-in store (`scene`,
 * `selection`, `layer`, `tool`, `brush`) — pack stores must not shadow
 * the editor's own shell stores. Duplicate dynamic-store names
 * (re-registering the same name) overwrite the previous entry and log
 * a warning; the previous unregister fn is now a no-op, the new one
 * is authoritative.
 */
export function registerDynamicStore(
  name: string,
  hook: UseBoundStore<StoreApi<unknown>>,
): () => void {
  if (name in STORE_REGISTRY) {
    throw new Error(
      `[resolveBinding] cannot register dynamic store "${name}" — it ` +
        `collides with a built-in shell store`,
    );
  }
  if (DYNAMIC_STORES.has(name)) {
    // eslint-disable-next-line no-console
    console.warn(
      `[resolveBinding] dynamic store "${name}" was already registered; ` +
        `the previous registration's unregister fn is now a no-op`,
    );
  }
  DYNAMIC_STORES.set(name, hook);
  let active = true;
  return () => {
    if (!active) return;
    // Only delete if we still own the slot — avoid clobbering a
    // subsequent registration that took our name.
    if (DYNAMIC_STORES.get(name) === hook) {
      DYNAMIC_STORES.delete(name);
    }
    active = false;
  };
}

function isKnownStore(name: string): name is KnownStoreName {
  return name in STORE_REGISTRY;
}

/**
 * VB5 — snapshot the current dynamic-store names + their bound hooks.
 *
 * The store-path picker (shipped as a `Custom` component by the visual
 * builder pack) walks both `STORE_REGISTRY` AND this list to surface
 * pack-contributed stores like `$store.panelBuilder.*` /
 * `$store.profiler.*` in autocomplete. Returning a defensive copy keeps
 * callers from mutating the live map; the map identity is module-local
 * so an exported reference would leak the mutable state.
 */
export function listDynamicStores(): Array<{
  name: string;
  hook: UseBoundStore<StoreApi<unknown>>;
}> {
  return Array.from(DYNAMIC_STORES.entries()).map(([name, hook]) => ({
    name,
    hook,
  }));
}

/**
 * Look up either a built-in or dynamic store by name. Used by the
 * resolver's `get` traversal so a `$store.profiler.fps` path works
 * the same way as `$store.scene.settings.name`.
 */
function lookupStore(
  name: string,
): UseBoundStore<StoreApi<unknown>> | undefined {
  if (isKnownStore(name)) return STORE_REGISTRY[name];
  return DYNAMIC_STORES.get(name);
}

// ---------------------------------------------------------------------------
// Write table — canonical paths that the resolver knows how to write to.
// ---------------------------------------------------------------------------

/**
 * Writer functions for the small set of paths Phase 0 supports writing
 * to. Each writer receives the new value and routes through the store's
 * existing action — we do NOT bypass actions to call setState directly,
 * so undo/redo + broadcast semantics stay consistent with TSX-authored
 * panels.
 *
 * Path-matching is exact-match on the canonical string (after stripping
 * the `store.` prefix). If a write is attempted on a path NOT in this
 * table, the resolver's `set` returns false and logs once — the JSON
 * author then either picks a different binding or files an issue to
 * extend the writer table.
 *
 * Phase 1: this static map should become data-driven (each store
 * declares its own writable paths). For Phase 0 we keep it inline so
 * the demo can prove end-to-end round-trip without per-store
 * scaffolding.
 */
type Writer = (value: unknown) => void;
const WRITERS: Record<string, Writer> = {
  // Scene-level settings — exercised by the demo panel.
  "scene.settings.name": (value) => {
    if (typeof value !== "string") return;
    useSceneStore.getState().setSettings({ name: value });
  },
  "scene.settings.fog": (value) => {
    const n = Number(value);
    if (Number.isFinite(n)) useSceneStore.getState().setSettings({ fog: n });
  },
  "scene.settings.ambient": (value) => {
    const n = Number(value);
    if (Number.isFinite(n))
      useSceneStore.getState().setSettings({ ambient: n });
  },
  // Brush size — Slider + NumberInput nodes round-trip through here.
  // Coerce numeric strings + delegate to the store action so the
  // existing 1..20 clamp + sync persistence stay authoritative.
  "brush.size": (value) => {
    const n = Number(value);
    if (Number.isFinite(n)) useBrushStore.getState().setSize(n);
  },
  // Brush kind — accept any string. Validation against MOCK_BRUSHES
  // lives in the BrushPanel host (it gates the per-brush command
  // registration on findBrush). Writing an unknown kind here is a
  // no-op as far as the panel UI is concerned, since the tile grid
  // only has buttons for known ids.
  "brush.kind": (value) => {
    if (typeof value === "string") useBrushStore.getState().setKind(value);
  },
  // Active layer — written by the CellInspector layer dropdown via the
  // Select node. Read-only `store.layer.activeId` had no writer
  // because Phase 1 panels only READ it for the layer-name readout;
  // the CellInspector migration adds the write path so the dropdown
  // round-trips through the same `activate()` action LayersPanel uses.
  "layer.activeId": (value) => {
    if (typeof value === "string") useLayerStore.getState().activate(value);
  },
  // Per-cell height — the CellInspector NumberInput binds to
  // `scene.cells[selected].height`. The lookup key is the FULL
  // canonical path including the `[selected]` indexer — the resolver
  // matches it verbatim against the WRITERS map. The writer reads
  // the current selection at write-time via getState() so the
  // resolved coord is fresh on every commit (the dropdown / number
  // input fires after the selection has been mutated, never during).
  "scene.cells[selected].height": (value) => {
    const sel = useSelectionStore.getState().selected;
    if (!sel) return;
    const n = Number(value);
    if (!Number.isFinite(n)) return;
    useSceneStore.getState().setCellHeight(sel.x, sel.y, n);
  },
};

// ---------------------------------------------------------------------------
// Public API: resolve(path) → { get, set, storeName }
// ---------------------------------------------------------------------------

/**
 * Result of resolving a store-path. The renderer uses `storeName` to
 * pick which zustand hook to subscribe to (so re-renders are scoped to
 * the right store), and the `get` / `set` functions are how data flows.
 *
 * `storeName` is widened from `KnownStoreName` to `string` so that
 * dynamic stores (registered by editor packs via
 * `registerDynamicStore`) can flow through the same binding shape.
 * Callers that need to switch on built-in stores should use the
 * `isKnownStore` predicate exported below.
 */
export interface ResolvedBinding {
  /** Which store this path roots into. Used for hook subscription. */
  storeName: string;
  /** Read the current value. Returns `undefined` when the path doesn't resolve. */
  get: () => unknown;
  /**
   * Write a new value. Returns true on success, false when the path is
   * read-only (no writer registered). Read-only writes are a no-op
   * with a console.warn so the JSON author can fix the binding.
   */
  set: (value: unknown) => boolean;
}

/**
 * Parse a store-path and return a get/set pair. Throws on malformed
 * paths (e.g. unterminated brackets) — JSON spec validation should
 * catch these at load time in Phase 1.
 */
export function resolveBinding(path: string): ResolvedBinding {
  const segments = tokenisePath(path);
  if (segments.length === 0) {
    throw new Error(`resolveBinding: empty path "${path}"`);
  }
  const head = segments[0];
  if (head?.kind !== "key") {
    throw new Error(`resolveBinding: malformed root segment in "${path}"`);
  }
  const storeHook = lookupStore(head.name);
  if (!storeHook) {
    const dynamicNames = Array.from(DYNAMIC_STORES.keys());
    const allKnown = [...Object.keys(STORE_REGISTRY), ...dynamicNames].join(", ");
    throw new Error(
      `resolveBinding: unknown store "${head.name}" in "${path}". ` +
        `Known: ${allKnown}`,
    );
  }
  const storeName: string = head.name;
  const tail = segments.slice(1);

  const canonical = stripStorePrefix(path);

  const get = (): unknown => {
    // Re-lookup at read time so a store registered AFTER
    // `resolveBinding` was called still resolves — important for the
    // panel-mount lifecycle where the resolver may run before a pack
    // script's `createStore` has fired (Phase 3 scope: the editor
    // loads scripts before mounting panels, so this is defensive).
    const store = lookupStore(storeName);
    if (!store) return undefined;
    let cursor: unknown = store.getState();
    for (const seg of tail) {
      if (cursor == null) return undefined;
      if (seg.kind === "key") {
        cursor = (cursor as Record<string, unknown>)[seg.name];
      } else {
        const key = resolveIndexer(seg.indexer);
        if (key === null) return undefined;
        cursor = (cursor as Record<string, unknown>)[key];
      }
    }
    return cursor;
  };

  const set = (value: unknown): boolean => {
    // Look up by canonical path. For paths containing a dynamic
    // indexer (like `scene.cells[selected].name`) we'd need a more
    // sophisticated lookup — Phase 0 only supports writes to static
    // paths, which covers the demo and gets us shipping.
    const writer = WRITERS[canonical];
    if (!writer) {
      // eslint-disable-next-line no-console
      console.warn(
        `[resolveBinding] no writer registered for "${canonical}" — binding is read-only`,
      );
      return false;
    }
    writer(value);
    return true;
  };

  return { storeName, get, set };
}

/**
 * Strict variant of resolveBinding that ALSO returns the typed store
 * hook — used by the renderer to subscribe a React component to the
 * right store. Splitting this out keeps `resolveBinding` itself
 * imperative + test-friendly.
 *
 * Widened to accept any string `storeName` so dynamic pack stores
 * (registered via `registerDynamicStore`) work through the same path.
 * Returns `undefined` when the name doesn't resolve to a built-in or
 * dynamic store — the renderer's subscription site degrades to a
 * no-op subscription in that case.
 */
export function getStoreHook(
  storeName: string,
):
  | UseBoundStore<
      StoreApi<
        | SceneState
        | SelectionState
        | LayerState
        | ToolState
        | BrushState
        | unknown
      >
    >
  | undefined {
  if (isKnownStore(storeName)) {
    return STORE_REGISTRY[storeName] as UseBoundStore<
      StoreApi<
        SceneState | SelectionState | LayerState | ToolState | BrushState
      >
    >;
  }
  return DYNAMIC_STORES.get(storeName);
}

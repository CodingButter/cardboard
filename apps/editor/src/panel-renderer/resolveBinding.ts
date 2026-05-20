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

/**
 * Tagged union of every store the resolver can read from. Adding a
 * store requires:
 *   1. Adding it to this union (so write paths can be typed).
 *   2. Adding an entry to STORE_REGISTRY below.
 *   3. Optionally adding write paths to WRITERS.
 */
export type KnownStoreName = "scene" | "selection" | "layer";

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
};

function isKnownStore(name: string): name is KnownStoreName {
  return name in STORE_REGISTRY;
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
};

// ---------------------------------------------------------------------------
// Public API: resolve(path) → { get, set, storeName }
// ---------------------------------------------------------------------------

/**
 * Result of resolving a store-path. The renderer uses `storeName` to
 * pick which zustand hook to subscribe to (so re-renders are scoped to
 * the right store), and the `get` / `set` functions are how data flows.
 */
export interface ResolvedBinding {
  /** Which store this path roots into. Used for hook subscription. */
  storeName: KnownStoreName;
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
  if (head?.kind !== "key" || !isKnownStore(head.name)) {
    throw new Error(
      `resolveBinding: unknown store "${head?.kind === "key" ? head.name : "?"}" in "${path}". Known: ${Object.keys(STORE_REGISTRY).join(", ")}`,
    );
  }
  const storeName: KnownStoreName = head.name;
  const tail = segments.slice(1);

  const canonical = stripStorePrefix(path);

  const get = (): unknown => {
    const store = STORE_REGISTRY[storeName];
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
 */
export function getStoreHook(
  storeName: KnownStoreName,
): UseBoundStore<StoreApi<SceneState | SelectionState | LayerState>> {
  return STORE_REGISTRY[storeName] as UseBoundStore<
    StoreApi<SceneState | SelectionState | LayerState>
  >;
}

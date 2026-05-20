/**
 * React-level wiring for pack-contributed panels: when a panel
 * `<PanelRenderer>` is mounted via a pack-supplied `DockPanelDef`, we
 * wrap it in `<PackContextProvider>` so the renderer's `Canvas` node
 * (and any future renderer feature that needs to reach the owning
 * pack's `EditorPackContext`) can `useContext(PackContext)` to find it.
 *
 * The context value is intentionally narrow — only the shell-side
 * surface the renderer needs (canvas ref registration + panel-mount
 * lifecycle dispatch). The pack-author-facing surface (importLibrary,
 * createStore, etc.) is wider and constructed independently by the
 * editor pack loader. They share the same underlying ref / lifecycle
 * registries, but the renderer-facing slice doesn't carry the
 * script-author conveniences.
 *
 * See `docs/plans/PERFORMANCE_PROFILER.md` §3.3 (renderer pack-context
 * wiring rationale).
 */

import React from "react";

/**
 * The slice of pack-context the renderer reaches for. The full
 * `EditorPackContext` (loader-side) extends this — the loader passes
 * its private ref registry + lifecycle dispatcher through the same
 * object literal.
 */
export interface RendererPackContextSlice {
  /** Stable pack id (for logging / debugging). */
  packId: string;
  /**
   * Register a `<canvas>` DOM node under a ref name. Called from the
   * Canvas node's `useEffect(mount)`. Last-write-wins on collision —
   * the loader logs a warning when an existing slot is overwritten.
   */
  _registerCanvasRef: (refName: string, el: HTMLCanvasElement) => void;
  /**
   * Unregister a canvas ref. Called from the Canvas node's effect
   * cleanup. No-op when the ref was never registered (e.g. mount
   * threw before registration completed).
   */
  _unregisterCanvasRef: (refName: string) => void;
  /**
   * Fire the panel-mount hooks the pack's scripts registered via
   * `ctx.onPanelMount(panelId, …)`. The Canvas node calls this after
   * its ref is registered so chart-init scripts can synchronously
   * read the canvas via `ctx.getCanvasRef(...)`. Idempotent per
   * panel-mount — the renderer drives one call per `<canvas>` mount.
   */
  _firePanelMount: (panelId: string) => void;
  /** Notify pack scripts that a panel-mount is tearing down. */
  _firePanelUnmount: (panelId: string) => void;
}

export const PackContext = React.createContext<RendererPackContextSlice | null>(
  null,
);

export interface PackContextProviderProps {
  value: RendererPackContextSlice;
  children?: React.ReactNode;
}

/**
 * Wraps a subtree with a pack-context. The pack loader wraps every
 * pack-contributed panel's `<PanelRenderer>` in one of these so the
 * Canvas node (or any future pack-aware node) can reach its owner.
 *
 * Non-pack panels (TSX-authored shell panels) DON'T get a provider —
 * `useContext(PackContext)` returns `null` for them, and any pack-
 * aware node degrades gracefully (Canvas logs a debug-level "no pack
 * context" message; chart-init.ts callbacks never fire).
 */
export function PackContextProvider({
  value,
  children,
}: PackContextProviderProps): React.JSX.Element {
  return (
    <PackContext.Provider value={value}>{children}</PackContext.Provider>
  );
}

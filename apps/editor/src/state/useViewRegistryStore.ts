import React from "react";
import { create } from "zustand";

/**
 * useViewRegistryStore — runtime registry of TOP-LEVEL VIEW
 * contributions from editor packs (CORE_EDITOR_PACK.md §10 P4).
 *
 * A "view" is what mounts in the editor shell's main body region when
 * the user is on the corresponding primary tab. Examples (post-P4):
 *   - "scene"   → `MapView`     (contributed by the core editor pack)
 *   - "prefabs" → `PrefabsView` (contributed by the core editor pack)
 *
 * The shell maps the active `PrimaryTabId` to a view id 1:1 by
 * convention — the pack registers `registerView("scene", MapView)` and
 * the shell renders `viewRegistry.get("scene")` when the active tab is
 * "scene". A tab with no registered view falls through to the shell's
 * built-in routing (HomeScreen for "home", placeholder EmptyState for
 * coming-soon tabs, ProjectView for tabs still owned by the shell).
 *
 * Lifecycle: `register(viewId, component)` adds an entry keyed by
 * `viewId` and returns an unregister function. Pack setup scripts
 * aggregate every unregister into their teardown so a future
 * Extensions-tab live-disable can drop all view contributions without
 * a reload. Re-registering the same id is last-write-wins, mirroring
 * the pack-chain contribution semantics.
 *
 * Why a plain `create` (not synced): the registry is per-window. Each
 * window's editor mount loads packs independently and populates its
 * OWN view registry. The popout windows that dockview opens are NOT
 * full editor mounts — they only render a single dockview panel
 * subtree, so they never reach a view-level routing decision.
 *
 * See `docs/plans/CORE_EDITOR_PACK.md` §10 P4 for the design intent.
 */

/** A pack-contributed view component. Receives no props from the
 *  shell — the view should read its needed state from shell-SDK
 *  hooks (`useRoute`, `useActiveScene`, etc). Wide signature kept so
 *  individual views can ship their own props for testing without
 *  forcing the shell to thread them. */
export type ViewComponent = React.ComponentType<Record<string, unknown>>;

interface ViewRegistryState {
  /** Keyed by view id (matches the `PrimaryTabId` it serves). */
  views: Readonly<Record<string, ViewComponent>>;
  /** Register a view. Returns an unregister fn — callers wire it
   *  into their pack-script teardown so disabling the pack flushes
   *  the contribution. Re-registering an id overwrites
   *  (last-write-wins). */
  register: (viewId: string, component: ViewComponent) => () => void;
  /** Force-unregister by id. Idempotent — no-op when the id is
   *  unknown. */
  unregister: (viewId: string) => void;
}

export const useViewRegistryStore = create<ViewRegistryState>((set, get) => ({
  views: {},
  register: (viewId, component) => {
    set((s) => ({ views: { ...s.views, [viewId]: component } }));
    return () => get().unregister(viewId);
  },
  unregister: (viewId) => {
    set((s) => {
      if (!(viewId in s.views)) return s;
      const next = { ...s.views };
      delete next[viewId];
      return { views: next };
    });
  },
}));

/**
 * React hook: return the registered view component for the given id,
 * or `null` if no pack has contributed one.
 */
export function useRegisteredView(viewId: string | null): ViewComponent | null {
  const views = useViewRegistryStore((s) => s.views);
  return React.useMemo(() => {
    if (!viewId) return null;
    return views[viewId] ?? null;
  }, [views, viewId]);
}

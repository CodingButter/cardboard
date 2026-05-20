import React from "react";
import { create } from "zustand";
import type { SerializedDockview } from "dockview";

/**
 * useLayoutRegistryStore — runtime registry for DEFAULT + PREDEFINED
 * dock layouts contributed by editor packs (CORE_EDITOR_PACK.md §10 P4).
 *
 * Two registration shapes:
 *
 *   1. `registerLayout(viewId, layout)` — installs the DEFAULT layout
 *      for a view. The view shell reads this via
 *      `useDefaultLayout(viewId)` and feeds it to DockShell's
 *      `defaultLayout` prop. Replaces the previous hardcoded
 *      `buildDefaultLayout()` JSON literals in MapView / PrefabsView.
 *
 *   2. `registerPredefinedLayout(viewId, name, layout)` — appends a
 *      named preset to the view's predefined-layout catalogue surfaced
 *      in the Workspace Layouts modal. Replaces the previous static
 *      `PREDEFINED_LAYOUTS` map that used to live at
 *      `apps/editor/src/state/predefinedLayouts.ts` (retired in P5).
 *
 * Both registration paths return unregister functions so a future
 * Extensions-tab live-disable can flush the contributions without a
 * reload. Re-registering an id is last-write-wins.
 *
 * The shell's WorkspacePanel + LayoutsModal read pack-contributed
 * presets through `useRegisteredPredefinedLayouts(pageId)` — there is
 * no longer a shell-side fallback list.
 *
 * Why a plain `create` (not synced): same per-window reasoning as
 * `useViewRegistryStore` — popouts re-load packs and re-populate the
 * registry; cross-window sync would actively confuse the lifecycle.
 *
 * See `docs/plans/CORE_EDITOR_PACK.md` §10 P4 for the design intent.
 */

/** A pack-contributed predefined layout entry. Mirrors the shape
 *  WorkspacePanel + LayoutsModal expect (id / name / description /
 *  layout) so a pack-shipped preset renders identically to whatever
 *  the shell used to surface from its retired predefinedLayouts list. */
export interface RegisteredPredefinedLayout {
  /** Stable id; used as the `lastAppliedPresetId` marker + React key. */
  readonly id: string;
  /** Human-facing label rendered under the thumbnail. */
  readonly name: string;
  /** Optional short description. */
  readonly description?: string;
  /** dockview JSON applied via `api.fromJSON(layout)`. */
  readonly layout: SerializedDockview;
}

interface LayoutRegistryState {
  /** Default layout keyed by view id. */
  defaults: Readonly<Record<string, SerializedDockview>>;
  /** Predefined layouts keyed by view id, then by preset id. */
  predefined: Readonly<
    Record<string, Readonly<Record<string, RegisteredPredefinedLayout>>>
  >;
  /** Install the default layout for a view. Returns an unregister
   *  fn. Re-registering the same view id is last-write-wins. */
  registerLayout: (viewId: string, layout: SerializedDockview) => () => void;
  /** Append a predefined layout to a view's catalogue. The `id`
   *  field on the entry must be unique within the view's catalogue.
   *  Returns an unregister fn. */
  registerPredefinedLayout: (
    viewId: string,
    entry: RegisteredPredefinedLayout,
  ) => () => void;
}

export const useLayoutRegistryStore = create<LayoutRegistryState>(
  (set, _get) => ({
    defaults: {},
    predefined: {},
    registerLayout: (viewId, layout) => {
      set((s) => ({ defaults: { ...s.defaults, [viewId]: layout } }));
      return () => {
        set((s) => {
          if (!(viewId in s.defaults)) return s;
          const next = { ...s.defaults };
          delete next[viewId];
          return { defaults: next };
        });
      };
    },
    registerPredefinedLayout: (viewId, entry) => {
      set((s) => {
        const forView = s.predefined[viewId] ?? {};
        return {
          predefined: {
            ...s.predefined,
            [viewId]: { ...forView, [entry.id]: entry },
          },
        };
      });
      return () => {
        set((s) => {
          const forView = s.predefined[viewId];
          if (!forView || !(entry.id in forView)) return s;
          const nextForView = { ...forView };
          delete nextForView[entry.id];
          // If the view now has zero presets, drop the empty bucket.
          const nextPredefined = { ...s.predefined };
          if (Object.keys(nextForView).length === 0) {
            delete nextPredefined[viewId];
          } else {
            nextPredefined[viewId] = nextForView;
          }
          return { predefined: nextPredefined };
        });
      };
    },
  }),
);

/**
 * React hook: read the registered default layout for a view, or
 * `null` if no pack has contributed one.
 */
export function useDefaultLayout(
  viewId: string,
): SerializedDockview | null {
  const defaults = useLayoutRegistryStore((s) => s.defaults);
  return React.useMemo(() => defaults[viewId] ?? null, [defaults, viewId]);
}

/**
 * React hook: read the registered predefined layouts for a view as
 * a stable array (re-derived only when the registry changes).
 */
export function useRegisteredPredefinedLayouts(
  viewId: string,
): RegisteredPredefinedLayout[] {
  const forView = useLayoutRegistryStore(
    (s) => s.predefined[viewId] ?? null,
  );
  return React.useMemo(() => {
    if (!forView) return [];
    return Object.values(forView);
  }, [forView]);
}

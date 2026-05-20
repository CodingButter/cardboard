/**
 * usePanelBuilderHooks — React hooks layered over the panel-builder
 * store + sidecar IDB. Split from `usePanelBuilderStore.ts` so the
 * store module stays React-free (the pack's bun test imports the
 * store's pure helpers; React isn't in the pack's dependency closure).
 *
 * Add new hooks here when they need React imports + closure over the
 * store.
 */

import React from "react";
import {
  getPanelBuilderStore,
  type PanelBuilderState,
} from "./usePanelBuilderStore";

/**
 * Subscribe to the drafts-refresh tick on the panel-builder store.
 * Re-renders whenever `bumpDraftsRefresh()` is called. Library /
 * Inspector / Toolbar UIs use this to trigger a re-fetch of the
 * sidecar IDB after Save / Delete / Import.
 *
 * Returns 0 when the store hasn't been initialised yet.
 */
export function useDraftsRefreshTick(): number {
  const store = getPanelBuilderStore();
  const subscribe = React.useCallback(
    (cb: () => void): (() => void) => {
      if (!store) return () => {};
      return store.subscribe(cb);
    },
    [store],
  );
  const getSnapshot = React.useCallback(
    (): number =>
      store ? (store.getState() as PanelBuilderState).draftsRefreshTick : 0,
    [store],
  );
  return React.useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/**
 * Subscribe to the panel-builder store's `currentDraftName` field.
 * Re-renders whenever a Save / Load updates the name.
 */
export function useCurrentDraftName(): string | null {
  const store = getPanelBuilderStore();
  const subscribe = React.useCallback(
    (cb: () => void): (() => void) => {
      if (!store) return () => {};
      return store.subscribe(cb);
    },
    [store],
  );
  const getSnapshot = React.useCallback(
    (): string | null =>
      store ? (store.getState() as PanelBuilderState).currentDraftName : null,
    [store],
  );
  return React.useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

import React from "react";
import { create } from "zustand";
import type { DockPanelDef } from "../components/dock/DockShell";

/**
 * useDockPanelRegistryStore — runtime registry of dock-panel
 * contributions from editor packs.
 *
 * Today only the core-editor pack's `registerPanel(def)` API writes
 * here (see `apps/editor/src/packs/editorPackLoader.ts`). The
 * `useEditorPackPanels` hook merges this registry's entries with the
 * JSON-spec-derived defs the loader builds at startup, so the Scene /
 * Prefabs workspaces see ONE flat list of contributions regardless of
 * authoring style.
 *
 * Lifecycle: `register(def)` adds an entry keyed by `def.id` and
 * returns an unregister function. A pack's `setup.tsx` returns a
 * cleanup that calls every unregister; `disposeEditorPackScripts`
 * fires those cleanups on Extensions-tab disable so the panel
 * disappears from the DocksModal without a reload.
 *
 * Why a plain `create` instead of `createSyncedStore`: the registry
 * is per-window. Pack components are constructed inside one React
 * tree — the popout/orchestrator each load packs independently and
 * each populates its OWN registry. No persistence either (panels are
 * re-registered every load).
 *
 * See `docs/plans/CORE_EDITOR_PACK.md` §9.1 and §10 P2 for the
 * design intent.
 */

interface DockPanelRegistryState {
  /** Keyed by `DockPanelDef.id`. */
  panels: Readonly<Record<string, DockPanelDef>>;
  /** Register a panel. Returns an unregister fn — callers wire it
   *  into their pack-script teardown so disabling the pack flushes
   *  the contribution. Re-registering an id overwrites
   *  (last-write-wins, mirrors the pack-chain contribution semantics
   *  documented in PACK_CHAIN.md). */
  register: (def: DockPanelDef) => () => void;
  /** Force-unregister by id. Idempotent — no-op when the id is
   *  unknown. */
  unregister: (id: string) => void;
}

export const useDockPanelRegistryStore = create<DockPanelRegistryState>(
  (set, get) => ({
    panels: {},
    register: (def) => {
      set((s) => ({ panels: { ...s.panels, [def.id]: def } }));
      return () => get().unregister(def.id);
    },
    unregister: (id) => {
      set((s) => {
        if (!(id in s.panels)) return s;
        const next = { ...s.panels };
        delete next[id];
        return { panels: next };
      });
    },
  }),
);

/**
 * Reactive snapshot of every panel def the registry currently holds,
 * returned as a stable array (re-derived only when `panels` changes).
 */
export function useRegisteredPackPanels(): DockPanelDef[] {
  const panels = useDockPanelRegistryStore((s) => s.panels);
  return React.useMemo(() => Object.values(panels), [panels]);
}

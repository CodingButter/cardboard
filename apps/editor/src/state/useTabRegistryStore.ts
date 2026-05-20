import React from "react";
import { create } from "zustand";

/**
 * useTabRegistryStore — runtime registry of TOP-LEVEL TAB
 * contributions from editor packs (CORE_EDITOR_PACK.md §10 P4).
 *
 * The shell's `PrimaryTabs` strip used to declare a hardcoded
 * `PRIMARY_TABS` array. Post-P4 the array is built by reading this
 * registry — each pack contributes its tabs at load time via
 * `ctx.registerTab(...)` and the strip renders whatever ends up in
 * the store, in registration order.
 *
 * Tab `id` strings remain free-form so a third-party pack can ship
 * its own top-level surface without modifying the shell's
 * `PrimaryTabId` union. The shell's routing logic narrows ids it
 * recognises explicitly (e.g. "home" still routes to HomeScreen) and
 * falls through to `useRegisteredView(tab)` for everything else.
 *
 * Lifecycle: `register(tab)` returns an unregister fn. Re-registering
 * an id is last-write-wins. The pack's setup-script teardown calls
 * every unregister so a future Extensions-tab live-disable removes
 * the tab without a reload.
 *
 * Why a plain `create` (not synced): same per-window reasoning as
 * `useViewRegistryStore` — each window's editor mount loads packs
 * independently.
 *
 * See `docs/plans/CORE_EDITOR_PACK.md` §10 P4 for the design intent.
 */

/** A pack-contributed primary-tab descriptor. Mirrors the
 *  shell-internal shape that lived in PrimaryTabs.tsx before P4. */
export interface RegisteredTab {
  /** Stable id — used as the URL hash segment + `useRoute().tab`. */
  readonly id: string;
  /** Human-facing tab label. */
  readonly label: string;
  /** Lucide icon node. Bundled into the pack's TSX — the host
   *  receives a ready-to-render React element. */
  readonly icon: React.ReactNode;
  /** Whether this tab requires an open project to be useful. The
   *  shell greys it out when no project is open. */
  readonly requiresProject: boolean;
  /** 1-sentence description shown as the stage-2 progressive
   *  tooltip body (after ~5s hover). */
  readonly description: string;
  /** Optional visual divider after this tab in the strip. Mirrors
   *  the dividerAfter affordance used by PrimaryTabs today. */
  readonly dividerAfter?: boolean;
  /** Registration order — used by selectors to sort. Set by the
   *  store on register; pack authors don't supply this. */
  readonly order?: number;
}

interface TabRegistryState {
  /** Keyed by tab id. Insertion order is preserved by the registry
   *  itself via the `order` field; selectors sort on it. */
  tabs: Readonly<Record<string, RegisteredTab>>;
  /** Monotonically increasing counter used to preserve registration
   *  order across the registry (Object.values has no guarantee for
   *  mutated objects). */
  nextOrder: number;
  /** Register a tab. Returns an unregister fn. */
  register: (tab: RegisteredTab) => () => void;
  /** Force-unregister by id. Idempotent. */
  unregister: (id: string) => void;
}

export const useTabRegistryStore = create<TabRegistryState>((set, get) => ({
  tabs: {},
  nextOrder: 0,
  register: (tab) => {
    set((s) => ({
      tabs: { ...s.tabs, [tab.id]: { ...tab, order: s.nextOrder } },
      nextOrder: s.nextOrder + 1,
    }));
    return () => get().unregister(tab.id);
  },
  unregister: (id) => {
    set((s) => {
      if (!(id in s.tabs)) return s;
      const next = { ...s.tabs };
      delete next[id];
      return { tabs: next };
    });
  },
}));

/**
 * Reactive snapshot of every registered tab, sorted by registration
 * order. Re-derived only when the underlying map changes.
 */
export function useRegisteredTabs(): RegisteredTab[] {
  const tabs = useTabRegistryStore((s) => s.tabs);
  return React.useMemo(() => {
    const arr = Object.values(tabs).slice();
    arr.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    return arr;
  }, [tabs]);
}

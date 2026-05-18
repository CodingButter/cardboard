import React from "react";
import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";

/**
 * useSettingsStore — the editor's settings registry + value store.
 *
 * Two slices share this store:
 *
 *   1. `settings` — the REGISTRY: a record of `EditorSetting`
 *      definitions (id, title, default, type, scope, etc.). NOT
 *      persisted — components register their settings on mount with
 *      `useEffect(() => registerSetting({...}), [...])`, just like the
 *      command registry. Definitions are wired to live React lifetimes,
 *      so persisting them is a footgun for the same reason as commands.
 *
 *   2. `values` — current values keyed by setting id. Persisted via
 *      `zustand/middleware` `persist` so global preferences survive
 *      reloads. Project- and page-scoped settings are owned by their
 *      respective stores (workspace, project) — only global scope
 *      flows through here. Project/page values are still readable via
 *      `get`/`set` but won't round-trip across sessions through this
 *      slice.
 *
 * Storage key + version mirror `useWorkspaceStore` so the editor's
 * persistence boundary stays consistent and future migrations (e.g.
 * Supabase) can be a single `createJSONStorage` swap.
 */

export type SettingType = "boolean" | "string" | "number" | "select";
export type SettingScope = "global" | "project" | "page";

export interface EditorSetting<T = unknown> {
  id: string;
  title: string;
  category?: string;
  description?: string;
  type: SettingType;
  default: T;
  options?: Array<{ label: string; value: T }>;
  scope?: SettingScope;
}

export interface SettingsStoreState {
  settings: Record<string, EditorSetting>;
  values: Record<string, unknown>;
  register: <T = unknown>(setting: EditorSetting<T>) => () => void;
  unregister: (id: string) => void;
  get: <T = unknown>(id: string) => T | undefined;
  set: <T = unknown>(id: string, value: T) => void;
}

const STORAGE_NAME = "cardboard_settings";
const STORAGE_VERSION = 1;

export const useSettingsStore = create<SettingsStoreState>()(
  persist(
    (set, get) => ({
      settings: {},
      values: {},
      register: <T,>(setting: EditorSetting<T>) => {
        set((s) => ({
          settings: {
            ...s.settings,
            [setting.id]: setting as EditorSetting<unknown>,
          },
        }));
        return () => get().unregister(setting.id);
      },
      unregister: (id) => {
        set((s) => {
          if (!(id in s.settings)) return s;
          const next = { ...s.settings };
          delete next[id];
          return { settings: next };
        });
      },
      get: <T,>(id: string): T | undefined => {
        const stored = get().values[id];
        if (stored !== undefined) return stored as T;
        const def = get().settings[id]?.default;
        return def as T | undefined;
      },
      set: <T,>(id: string, value: T) => {
        set((s) => ({ values: { ...s.values, [id]: value } }));
      },
    }),
    {
      name: STORAGE_NAME,
      version: STORAGE_VERSION,
      storage: createJSONStorage(() => localStorage),
      // Persist ONLY the values map — the registry re-builds on mount
      // from each registering component, and we never want to
      // round-trip the action functions.
      // We also filter values down to global-scope settings: project
      // and page scopes have their own persistence stores (workspace,
      // project) so writing them here would create two stale mirrors.
      partialize: (state) => {
        const globalValues: Record<string, unknown> = {};
        for (const [id, value] of Object.entries(state.values)) {
          const def = state.settings[id];
          // When the setting isn't registered yet (load before register)
          // we persist the value defensively so it can be picked up
          // when the registration arrives.
          if (!def || (def.scope ?? "global") === "global") {
            globalValues[id] = value;
          }
        }
        return { values: globalValues };
      },
    },
  ),
);

/** Convenience for callsites — registers in the store and returns the
 *  unregister fn. Use from React effects:
 *    useEffect(() => registerSetting({...}), []); */
export function registerSetting<T = unknown>(
  setting: EditorSetting<T>,
): () => void {
  return useSettingsStore.getState().register(setting);
}

/** Reactive read of a single setting's value (falls back to default). */
export function useSettingValue<T = unknown>(id: string): T | undefined {
  const value = useSettingsStore((s) => s.values[id]);
  const def = useSettingsStore((s) => s.settings[id]?.default);
  return (value !== undefined ? value : def) as T | undefined;
}

/** Reactive list of registered settings, optionally filtered by scope. */
export function useSettingsList(scope?: SettingScope): EditorSetting[] {
  const settings = useSettingsStore((s) => s.settings);
  return React.useMemo(() => {
    const list = Object.values(settings);
    if (!scope) return list;
    return list.filter((s) => (s.scope ?? "global") === scope);
  }, [settings, scope]);
}

import React from "react";
import { create } from "zustand";

/**
 * useCommandStore — the editor's command registry.
 *
 * Commands are runtime-registered (not persisted) — every mount-time
 * callsite registers via `useEffect(() => registerCommand({...}), [...])`
 * with a returned cleanup that unregisters. This mirrors VSCode's
 * `commands.registerCommand` API: the registry is the single
 * source-of-truth the command palette + keybinding handler both read
 * from.
 *
 * Why no `persist`: command IDs, titles, and `run` functions are tied
 * to live React component lifetimes. Persisting them would let a stale
 * `run` closure outlive its component, which is a footgun. The cost of
 * re-registering on mount is negligible (small object inserts into a
 * record).
 *
 * Recently-used boost: the palette's fuzzy ranking nudges items in
 * `recent` up the list when scores tie. Stored in-memory as a ring of
 * up to 10 ids — also non-persistent on purpose (recents reset per
 * session, like VSCode's MRU within a window).
 */

export interface EditorCommand {
  id: string;
  title: string;
  category?: string;
  keywords?: string[];
  /** Display + auto-binding hint (e.g. "Ctrl+S", "Ctrl+Shift+P"). */
  keybinding?: string;
  icon?: React.ReactNode;
  description?: string;
  /**
   * Command ids to await BEFORE this command's `run()` executes. Each
   * pre-macro id is dispatched through `runById` recursively, so a
   * pre-macro picks up its own pre/post chain. Cycles are short-circuited
   * via a per-invocation visited set (with a console.warn).
   */
  preMacro?: string[];
  /**
   * Command ids to await AFTER this command's `run()` resolves. Same
   * recursion + cycle semantics as `preMacro`.
   */
  postMacro?: string[];
  run: () => void | Promise<void>;
}

export interface CommandStoreState {
  commands: Record<string, EditorCommand>;
  /** MRU ring buffer of up to 10 command ids. */
  recent: string[];
  register: (cmd: EditorCommand) => () => void;
  unregister: (id: string) => void;
  runById: (id: string, visited?: Set<string>) => Promise<void>;
  noteRecent: (id: string) => void;
}

const RECENT_LIMIT = 10;

export const useCommandStore = create<CommandStoreState>()((set, get) => ({
  commands: {},
  recent: [],
  register: (cmd) => {
    set((s) => ({ commands: { ...s.commands, [cmd.id]: cmd } }));
    return () => get().unregister(cmd.id);
  },
  unregister: (id) => {
    set((s) => {
      if (!(id in s.commands)) return s;
      const next = { ...s.commands };
      delete next[id];
      return { commands: next };
    });
  },
  runById: async (id, visited = new Set<string>()) => {
    if (visited.has(id)) {
      // eslint-disable-next-line no-console
      console.warn(`[command-registry] cycle broken at "${id}"`);
      return;
    }
    visited.add(id);
    const cmd = get().commands[id];
    if (!cmd) return;
    // Only note MRU for the outermost (user-invoked) command — macros
    // are implementation detail; recents would otherwise be polluted by
    // every pre/post step.
    if (visited.size === 1) get().noteRecent(id);
    for (const pre of cmd.preMacro ?? []) {
      await get().runById(pre, visited);
    }
    try {
      await cmd.run();
    } catch (err) {
      // Surface the error so debugging is easy, but don't crash the
      // palette over a failing command.
      // eslint-disable-next-line no-console
      console.error(`[command-registry] run("${id}") threw`, err);
    }
    for (const post of cmd.postMacro ?? []) {
      await get().runById(post, visited);
    }
  },
  noteRecent: (id) => {
    set((s) => {
      const filtered = s.recent.filter((x) => x !== id);
      const next = [id, ...filtered].slice(0, RECENT_LIMIT);
      return { recent: next };
    });
  },
}));

/**
 * Convenience for callsites — registers in the store and returns the
 * unregister function. Used from React effects:
 *
 *   useEffect(() => registerCommand({ id, title, run }), []);
 */
export function registerCommand(cmd: EditorCommand): () => void {
  return useCommandStore.getState().register(cmd);
}

/**
 * Reactive snapshot of the registered command list. Returned array is
 * stable across renders unless `commands` actually changes (zustand's
 * default Object.is comparison on `useStore` selector results).
 */
export function useCommandList(): EditorCommand[] {
  const commands = useCommandStore((s) => s.commands);
  return React.useMemo(() => Object.values(commands), [commands]);
}

/** Grouped by `category` (with `"Other"` as the fallback bucket). */
export function useCommandsByCategory(): Record<string, EditorCommand[]> {
  const list = useCommandList();
  return React.useMemo(() => {
    const out: Record<string, EditorCommand[]> = {};
    for (const cmd of list) {
      const key = cmd.category ?? "Other";
      const bucket = out[key] ?? (out[key] = []);
      bucket.push(cmd);
    }
    for (const k of Object.keys(out)) {
      out[k]!.sort((a, b) => a.title.localeCompare(b.title));
    }
    return out;
  }, [list]);
}

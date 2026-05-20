import React from "react";
import { createSyncedStore } from "./sync";

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
 * Why no `persist` for commands: command IDs, titles, and `run`
 * functions are tied to live React component lifetimes. Persisting them
 * would let a stale `run` closure outlive its component, which is a
 * footgun. The cost of re-registering on mount is negligible (small
 * object inserts into a record). It also keeps the registry PER-WINDOW:
 * popouts and the orchestrator each maintain their own command surface
 * (they have their own React trees with their own mounted components).
 *
 * Recently-used boost: the palette's fuzzy ranking nudges items in
 * `recent` up the list when scores tie. PERSISTED via the synced-store
 * partialize hook so MRU ordering survives reloads and is shared across
 * windows (a command run in a popout boosts that command's rank in the
 * orchestrator's palette too).
 *
 * Storage: `cardboard.sync.command` via `createSyncedStore`. The
 * partialize hook keeps the `commands` record OUT of localStorage (it's
 * per-window) while round-tripping the `recent` array (shared).
 *
 * Cross-window dispatch (task #9): when a user invokes a command in
 * window A (palette / keybinding / button), the SAME command id fires
 * in every sibling window viewing the same project. Each window runs
 * its own `.run()` independently; the Wave-3 stores those `run()`s
 * mutate are already cross-window-synced via the storage event +
 * BroadcastChannel transports, so per-window mutations converge.
 *
 * The mechanism is a sibling `BroadcastChannel("cardboard.commands")`.
 * When `runById` is called locally (outermost — `visited` empty), the
 * command's `scope` is consulted:
 *
 *   - `"broadcast"` (DEFAULT) — the local window runs `.run()`, then
 *     posts `{ kind: "run", commandId, originId, broadcastId,
 *     timestamp }` on the channel. Sibling windows look up
 *     `commandId` in their own registry; if present (and still
 *     `"broadcast"`), they invoke `.run(...)` locally WITHOUT
 *     re-broadcasting. The receiver passes a synthetic `visited` set
 *     containing `__REMOTE__` so the broadcast skip inside `runById`
 *     fires unconditionally.
 *
 *   - `"origin-only"` — for commands with side effects that should NOT
 *     fan out (HTTP fetches, file pickers, `prompt()`, anything that
 *     opens window-local UI). Only the originating window runs `.run()`.
 *
 * Loop prevention: each broadcast carries a UUID `broadcastId`. The
 * receiver maintains a `Set<string>` of recently-seen IDs and drops
 * any message whose id is already in the set. Entries time out after
 * `BROADCAST_DEDUPE_MS` (5s) so the set stays bounded.
 *
 * Echo guard: a window mints `ORIGIN_ID` at module load and ignores
 * any broadcast where `originId === ORIGIN_ID` (BroadcastChannel does
 * not echo to the sender, but tests and shim runtimes may).
 */

export type CommandScope = "origin-only" | "broadcast";

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
  /**
   * Cross-window dispatch behaviour. Defaults to `"broadcast"`:
   *
   *   - `"broadcast"` — `run()` fires in EVERY same-project window.
   *     Best for stateful mutators (undo, redo, set-tool, paint-cell,
   *     toggle-visibility) — broadcasting guarantees side effects like
   *     history-entry creation happen consistently in every window.
   *
   *   - `"origin-only"` — `run()` fires ONLY in the originating window.
   *     Best for side-effectful actions that would N-fire if broadcast:
   *     HTTP fetches, file pickers, `prompt()`, opening window-local
   *     modals.
   *
   * Defaults to `"broadcast"`. Pack-authors opt out per-command by
   * passing `scope: "origin-only"` to `registerCommand`.
   */
  scope?: CommandScope;
  run: () => void | Promise<void>;
}

export interface CommandStoreData {
  commands: Record<string, EditorCommand>;
  /** MRU ring buffer of up to 10 command ids. */
  recent: string[];
}

export interface CommandStoreActions {
  register: (cmd: EditorCommand) => () => void;
  unregister: (id: string) => void;
  runById: (id: string, visited?: Set<string>) => Promise<void>;
  noteRecent: (id: string) => void;
}

/** Combined shape for type compatibility with the previous public API. */
export type CommandStoreState = CommandStoreData & CommandStoreActions;

const RECENT_LIMIT = 10;

// ─── Cross-window dispatch ────────────────────────────────────────────

/**
 * Per-window UUID minted once at module load. Stamped on every outgoing
 * broadcast so siblings can ignore a (defensive) echo of their own
 * messages. The native `BroadcastChannel` does not echo to the sender,
 * but tests and shim runtimes occasionally do.
 */
const ORIGIN_ID: string = (() => {
  try {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
      return crypto.randomUUID();
    }
  } catch {
    // fall through to random-fallback
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
})();

/**
 * Sentinel string injected into a `runById` invocation's `visited` set
 * by the receiver side of a broadcast. When the dispatcher sees this
 * marker it skips the outbound `postMessage`, breaking the otherwise-
 * trivial fan-out loop where every window would re-broadcast every
 * received command.
 */
const REMOTE_VISITED_MARK = "__cardboard_remote_dispatch__";

/**
 * The broadcast wire message. Structured-clone-safe: every field is a
 * primitive. Command arguments are intentionally NOT part of the
 * payload — `runById(id)` is the only invocation path today, so no
 * non-cloneable refs (DOM nodes, functions) ride the channel.
 */
interface CommandBroadcastMessage {
  kind: "run";
  commandId: string;
  originId: string;
  broadcastId: string;
  timestamp: number;
}

/** Recently-received broadcast IDs (loop prevention). */
const seenBroadcasts: Map<string, number> = new Map();
const BROADCAST_DEDUPE_MS = 5000;

function rememberBroadcastId(id: string): boolean {
  const now = Date.now();
  // Garbage-collect expired entries on every check — the set stays
  // bounded by the rate at which commands fire (negligible).
  for (const [k, t] of seenBroadcasts) {
    if (now - t > BROADCAST_DEDUPE_MS) seenBroadcasts.delete(k);
  }
  if (seenBroadcasts.has(id)) return false;
  seenBroadcasts.set(id, now);
  return true;
}

function mintBroadcastId(): string {
  try {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
      return crypto.randomUUID();
    }
  } catch {
    // fall through
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

/**
 * Module-level command channel. Lives for the lifetime of the window.
 * Initialised lazily once `BroadcastChannel` is confirmed available
 * (SSR, no-jsdom tests, etc. fall back to a `null` channel and a
 * no-op transport — the store still works single-window).
 */
const commandChannel: BroadcastChannel | null =
  typeof BroadcastChannel !== "undefined"
    ? new BroadcastChannel("cardboard.commands")
    : null;

function postCommandBroadcast(commandId: string): void {
  if (!commandChannel) return;
  const msg: CommandBroadcastMessage = {
    kind: "run",
    commandId,
    originId: ORIGIN_ID,
    broadcastId: mintBroadcastId(),
    timestamp: Date.now(),
  };
  // Stamp our own outgoing ids in the seen set so a (defensive) echo
  // is dropped at the receive guard.
  rememberBroadcastId(msg.broadcastId);
  try {
    commandChannel.postMessage(msg);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[command-broadcast] postMessage failed", err);
  }
}

export const useCommandStore = createSyncedStore<
  CommandStoreData,
  CommandStoreActions
>(
  "command",
  { commands: {}, recent: [] },
  (set, get) => ({
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
      // ─── Cross-window broadcast gate ─────────────────────────────
      // Outermost LOCAL invocation only. `visited.size === 0` rules
      // out two paths in one check:
      //   - pre/post-macro recursion (the parent has already added
      //     itself to `visited` before recursing)
      //   - receiver-side replay (the broadcast listener seeds the
      //     visited set with `REMOTE_VISITED_MARK`, making it size 1
      //     before the recursive call lands here)
      // When the gate holds AND the command is not opt-out, post a
      // broadcast for siblings.
      const isOutermostLocal = visited.size === 0;
      visited.add(id);
      const cmd = get().commands[id];
      if (!cmd) return;
      if (isOutermostLocal && (cmd.scope ?? "broadcast") === "broadcast") {
        postCommandBroadcast(id);
      }
      // Only note MRU for the outermost (user-invoked) command — macros
      // are implementation detail; recents would otherwise be polluted by
      // every pre/post step. The MRU set is per-window-then-synced, so
      // marking on the originating window is correct — the storage
      // event fans the change out.
      if (isOutermostLocal) get().noteRecent(id);
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
  }),
  {
    // Per-window command registry; no broadcast channel. The `commands`
    // record is intentionally NOT persisted (see partialize below), so
    // there's nothing to gossip ephemerally either.
    enableBroadcast: false,
    // Persist ONLY `recent` so MRU ordering survives reloads and is
    // shared across windows via the storage event. Excluding `commands`
    // keeps stale closure refs out of localStorage and keeps the
    // registry per-window where it belongs.
    partialize: (state) => ({ recent: state.recent }),
  },
);

// ─── Cross-window receiver ──────────────────────────────────────────
//
// Subscribe ONCE per module load. Each inbound broadcast looks up its
// `commandId` in this window's local registry. If present (and still
// `scope: "broadcast"`), `runById` fires with a pre-seeded `visited`
// set whose lone entry — `REMOTE_VISITED_MARK` — is enough to make
// `visited.size > 0` at entry, which suppresses re-broadcasting at
// the dispatch gate inside `runById`.
//
// Why the receiver consults the LOCAL command's `scope` (rather than
// shipping `scope` on the wire and trusting the sender's tag): packs
// can register different shapes of the same command id in different
// windows (e.g. the orchestrator wraps a pack-side command with a
// preMacro). The receiver-side `scope` is the source of truth for
// "should I run this here" — and dropping the scope check entirely
// would let an origin-only command fan out to siblings that have a
// looser scope tag.
if (commandChannel) {
  commandChannel.addEventListener("message", (ev: MessageEvent) => {
    const msg = ev.data as CommandBroadcastMessage | undefined;
    if (!msg || msg.kind !== "run") return;
    // Defensive echo guard — native BroadcastChannel does not deliver
    // to the sender, but tests / shim runtimes occasionally do.
    if (msg.originId === ORIGIN_ID) return;
    // Loop prevention. If we've already seen this broadcastId in the
    // last BROADCAST_DEDUPE_MS window, drop the message.
    if (!rememberBroadcastId(msg.broadcastId)) return;
    const cmd = useCommandStore.getState().commands[msg.commandId];
    // No-op if (a) the command is unknown to this window or (b) the
    // local registration is `scope: "origin-only"` — meaning this
    // window's pack-author opted that command out of cross-window
    // dispatch.
    if (!cmd) return;
    if ((cmd.scope ?? "broadcast") === "origin-only") return;
    const visited = new Set<string>([REMOTE_VISITED_MARK]);
    void useCommandStore.getState().runById(msg.commandId, visited);
  });
}

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
 * Test-only export for asserting the dispatch wiring. Not part of the
 * public SDK; pack authors should never reach for these.
 *
 * `__originId` is the per-window UUID stamped on every outbound
 * broadcast. `__commandChannel` is the live `BroadcastChannel` (or
 * `null` in non-browser test contexts).
 */
export const __commandBroadcastInternals = {
  originId: ORIGIN_ID,
  channel: commandChannel,
  remoteVisitedMark: REMOTE_VISITED_MARK,
} as const;

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

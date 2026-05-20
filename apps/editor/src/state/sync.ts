import { create, type StateCreator, type StoreApi, type UseBoundStore } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";

/**
 * Cross-window sync utility — the FOUNDATION for Scene Wave 3's
 * cross-panel store layer. See `docs/plans/SCENE_WAVE_3_WIRING.md`.
 *
 * The editor's dockview UI can pop panels into their own browser
 * windows. A popout is a SEPARATE React tree with its own JavaScript
 * context, which means its `create()` zustand store is a SEPARATE
 * instance from the orchestrator's. Without sync, state changes in one
 * window are invisible to the other.
 *
 * This module exports two primitives:
 *
 *   1. `createSyncedStore`  — a thin wrapper around zustand's `create +
 *      persist` that ALSO listens for `window.addEventListener("storage")`
 *      events. When ANOTHER same-origin window writes the same
 *      localStorage key, the store rehydrates from the new value. An
 *      optional `BroadcastChannel` adds an ephemeral lane for messages
 *      the caller wants to gossip but not persist.
 *
 *   2. `throttle`           — a tiny trailing-edge throttle. Hot paths
 *      like cursor tracking want at-most-N-Hz broadcasts; this drops
 *      intermediate calls and runs the last queued one after `intervalMs`.
 *
 * (`useEphemeralSync` previously lived here too as a React hook over
 * `BroadcastChannel`; the post-extraction audit confirmed zero callers and
 * it was removed.)
 *
 * Why both `storage` events AND `BroadcastChannel`?
 *   - `storage` events fire in OTHER same-origin windows when
 *     localStorage is written. They're the durable backbone — anything
 *     persisted naturally crosses windows for free.
 *   - `BroadcastChannel` is for messages you DON'T want in
 *     localStorage. Persistent storage gets cluttered if every cursor
 *     move writes to it, and `storage` events synchronously block the
 *     writer if listeners are slow. `BroadcastChannel.postMessage` is
 *     fire-and-forget.
 *
 * A `storage` event does NOT fire in the window that wrote the key —
 * only in sibling windows. That's the correct semantics for us:
 * zustand's own `persist` middleware already updates the writer's
 * in-memory state, and the listener only needs to catch the OTHER side
 * of the swap.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Options for `createSyncedStore`. All optional — the only required
 * argument to the factory is the store name itself.
 */
export interface SyncedStoreOpts<T> {
  /**
   * The localStorage key to persist under. Defaults to
   * `cardboard.sync.<name>`. Override when you want a key that doesn't
   * follow the convention (e.g. you're retrofitting an existing store
   * that already had a different key).
   */
  storageKey?: string;
  /**
   * When `true`, the store opens a `BroadcastChannel` you can post to
   * via the `broadcast` argument passed into your setters factory. The
   * channel is also surfaced as `useStore.channel` for advanced
   * callsites. Defaults to `false`.
   */
  enableBroadcast?: boolean;
  /**
   * The BroadcastChannel name. Defaults to `cardboard:<name>`. Has no
   * effect unless `enableBroadcast` is `true`.
   */
  channelName?: string;
  /**
   * Subset of the state to persist. Anything outside this subset stays
   * in-memory only (and won't propagate across windows via the storage
   * event). Defaults to "persist everything except actions" — i.e.
   * functions are filtered out automatically.
   */
  partialize?: (state: T) => Partial<T>;
  /**
   * Persist storage version. Bump when you add a breaking change to
   * the persisted shape so old payloads are dropped instead of
   * partially deserialized into the new shape. Defaults to `1`.
   */
  version?: number;
}

/**
 * A `SyncedStore` is a regular zustand `UseBoundStore` augmented with a
 * `channel` handle (when `enableBroadcast` is true). The channel is
 * exposed for callsites that want to post out-of-band messages without
 * going through a setter (e.g. one-shot acknowledgements). When
 * broadcast is disabled, `channel` is `null`.
 */
export type SyncedStore<T> = UseBoundStore<StoreApi<T>> & {
  channel: BroadcastChannel | null;
};

/**
 * Type of the setters-factory passed to `createSyncedStore`. The
 * `broadcast` argument is a no-op when `enableBroadcast` is false, so
 * setters that want to publish ephemeral updates can always call it
 * without checking.
 *
 * `get()` returns the full state (data + actions) so setters can call
 * sibling actions on `this` — matches what zustand's own `create`
 * provides.
 */
export type SyncedSetters<T, A> = (
  set: (partial: Partial<T> | ((state: T) => Partial<T>)) => void,
  get: () => T & A,
  broadcast: (msg: unknown) => void,
) => A;

// ---------------------------------------------------------------------------
// createSyncedStore
// ---------------------------------------------------------------------------

/**
 * createSyncedStore wraps a Zustand store with a TRANSPORT LAYER that
 * keeps replicas in sync across browser contexts.
 *
 * Today's transports are local-only:
 *   - localStorage + `storage` event listener — durable cross-window
 *     sync, same machine.
 *   - Optional BroadcastChannel — low-latency ephemeral fanout.
 *
 * The transport layer is an INTERFACE, not a single implementation.
 * Future PeerJS / WebRTC transports satisfy the same shape (see
 * docs/plans/REMOTE_DOCK_QR.md §6.1):
 *   - Read writes from the store (subscribe via zustand's
 *     `useStore.subscribe` or the persist middleware).
 *   - Apply remote writes back via `useStore.setState(partial)`. Any
 *     incoming-write path MUST disambiguate itself from a locally
 *     originated write to avoid echo loops. The cross-window
 *     `storage` event already gives this for free (it doesn't fire in
 *     the writer's own window). PeerJS/WebRTC handlers will mark
 *     applied writes with `applyRemote()` below.
 *
 * Multi-transport-per-store is the architecture: local + network
 * transports subscribe simultaneously, each broadcasting on its own
 * channel. Stores stay agnostic to who's connected.
 *
 * D8+ guidance: don't poke localStorage directly anywhere in D4-D13
 * code. Go through this module. If something is missing, extend the
 * API rather than bypassing it.
 *
 * Build a zustand store that synchronizes across same-origin windows.
 *
 * @param name           Logical store name. Used for the default
 *                       localStorage key and BroadcastChannel name.
 * @param initialState   The non-action slice of the store's state.
 * @param setters        Factory returning the store's action functions.
 *                       Receives `(set, get, broadcast)` so setters can
 *                       optionally publish ephemeral messages alongside
 *                       persisted state changes.
 * @param opts           Optional configuration; see `SyncedStoreOpts`.
 *
 * @example
 *   const useToolStore = createSyncedStore(
 *     "tool",
 *     { activeTool: "paint" },
 *     (set) => ({
 *       setTool: (tool) => set({ activeTool: tool }),
 *     }),
 *   );
 */
export function createSyncedStore<T extends object, A extends object>(
  name: string,
  initialState: T,
  setters: SyncedSetters<T, A>,
  opts: SyncedStoreOpts<T> = {},
): SyncedStore<T & A> {
  const storageKey = opts.storageKey ?? `cardboard.sync.${name}`;
  const channelName = opts.channelName ?? `cardboard:${name}`;
  const version = opts.version ?? 1;

  // Open the BroadcastChannel up front (when enabled) so setters can
  // capture it in their closure. If we're in a non-browser context (SSR,
  // tests without jsdom, etc.) `BroadcastChannel` may not exist — we
  // tolerate that and fall back to a no-op.
  const channel: BroadcastChannel | null =
    opts.enableBroadcast && typeof BroadcastChannel !== "undefined"
      ? new BroadcastChannel(channelName)
      : null;

  const broadcast = (msg: unknown): void => {
    if (!channel) return;
    try {
      channel.postMessage(msg);
    } catch (err) {
      // postMessage can throw if the message isn't structured-cloneable
      // (functions, DOM nodes, etc.). Log so the caller can fix the
      // payload, but don't crash the store.
      // eslint-disable-next-line no-console
      console.error(`[sync:${name}] broadcast failed`, err);
    }
  };

  type FullState = T & A;

  const creator: StateCreator<FullState> = (set, get) => {
    const wrappedSet = (partial: Partial<T> | ((state: T) => Partial<T>)): void => {
      // The persist middleware passes a typed `set` that already
      // accepts `Partial<FullState>`. We're narrowing for ergonomics so
      // setters can write `set({ foo: 1 })` without TypeScript
      // complaining about missing action functions.
      if (typeof partial === "function") {
        set((s) => (partial as (state: T) => Partial<T>)(s as T) as Partial<FullState>);
      } else {
        set(partial as Partial<FullState>);
      }
    };
    const actions = setters(wrappedSet, get, broadcast);
    return {
      ...initialState,
      ...actions,
    } as FullState;
  };

  const useStore = create<FullState>()(
    persist(creator, {
      name: storageKey,
      version,
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => {
        if (opts.partialize) {
          // Caller-controlled subset.
          return opts.partialize(state as unknown as T) as Partial<FullState>;
        }
        // Default: strip action functions, keep data. Mirrors the
        // pattern in `useSettingsStore` and `useWorkspaceStore`.
        const out: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(state)) {
          if (typeof v === "function") continue;
          out[k] = v;
        }
        return out as Partial<FullState>;
      },
    }),
  ) as unknown as SyncedStore<FullState>;

  // Cross-window storage-event listener. zustand's `persist` middleware
  // doesn't re-read localStorage on its own when ANOTHER window writes
  // to the same key — the `storage` event is the platform's mechanism
  // for cross-window notification, and the middleware leaves it to us.
  //
  // Guard: ignore events whose `newValue` already matches what we just
  // wrote, so we don't loop. The event doesn't fire in the writer's own
  // window so this guard is belt-and-braces, but if a future runtime
  // (e.g. a test shim) does echo events back at the writer, we stay
  // safe.
  if (typeof window !== "undefined") {
    window.addEventListener("storage", (ev: StorageEvent) => {
      if (ev.key !== storageKey) return;
      if (ev.newValue == null) return;
      try {
        const parsed = JSON.parse(ev.newValue) as {
          state?: Partial<T>;
          version?: number;
        };
        if (!parsed || typeof parsed !== "object" || !parsed.state) return;
        // Echo guard — skip if the incoming state is identical to what
        // we already have. Compare the persisted subset (we don't have
        // function refs to worry about in `parsed.state`).
        const current = useStore.getState();
        const currentSubset: Record<string, unknown> = {};
        for (const k of Object.keys(parsed.state)) {
          currentSubset[k] = (current as Record<string, unknown>)[k];
        }
        if (JSON.stringify(currentSubset) === JSON.stringify(parsed.state)) {
          return;
        }
        // Apply the incoming subset. We deliberately use `setState`
        // with `replace: false` so action functions in the store stay
        // intact — we're only rehydrating data fields.
        useStore.setState(parsed.state as Partial<FullState>);
      } catch (err) {
        // Malformed payload — log and ignore so a single bad write
        // doesn't poison the listener.
        // eslint-disable-next-line no-console
        console.error(`[sync:${name}] storage event parse failed`, err);
      }
    });
  }

  useStore.channel = channel;
  return useStore;
}

// ---------------------------------------------------------------------------
// throttle
// ---------------------------------------------------------------------------

/**
 * Trailing-edge throttle. Calls within `intervalMs` of the previous call
 * are coalesced; the LAST queued call runs `intervalMs` after the
 * leading edge. The leading call itself fires immediately.
 *
 * Designed for hot broadcast paths (cursor tracking, hover coords) where
 * we want a steady N-Hz cadence regardless of input frequency. NOT a
 * debounce — a slow stream of inputs (slower than `intervalMs`) passes
 * through unchanged.
 *
 * @param fn         The function to throttle.
 * @param intervalMs Minimum interval between invocations.
 *
 * @example
 *   const sendCursor = throttle((x: number, y: number) => {
 *     broadcast({ x, y });
 *   }, 33); // ~30 Hz
 */
export function throttle<F extends (...args: any[]) => void>(
  fn: F,
  intervalMs: number,
): (...args: Parameters<F>) => void {
  let lastRun = 0;
  let pendingArgs: Parameters<F> | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const runPending = (): void => {
    timer = null;
    if (pendingArgs == null) return;
    const args = pendingArgs;
    pendingArgs = null;
    lastRun = Date.now();
    fn(...args);
  };

  return (...args: Parameters<F>): void => {
    const now = Date.now();
    const elapsed = now - lastRun;
    if (elapsed >= intervalMs) {
      // Leading edge — run immediately.
      lastRun = now;
      // Clear any queued trailing call; we just superseded it.
      if (timer != null) {
        clearTimeout(timer);
        timer = null;
        pendingArgs = null;
      }
      fn(...args);
    } else {
      // Inside the throttle window — queue (or replace) the trailing
      // call. The latest args win; older queued args are dropped.
      pendingArgs = args;
      if (timer == null) {
        timer = setTimeout(runPending, intervalMs - elapsed);
      }
    }
  };
}

// ---------------------------------------------------------------------------
// Origin convention (local vs remote writes)
// ---------------------------------------------------------------------------

/**
 * ORIGIN CONVENTION — how this module distinguishes local writes from
 * writes applied by a transport (storage event, BroadcastChannel,
 * future PeerJS / WebRTC channel).
 *
 * Today the disambiguation is implicit and free:
 *   - A local setter calls `set(...)` directly on the zustand store.
 *     The persist middleware writes to localStorage, which fires a
 *     `storage` event in OTHER same-origin windows (NOT the writer).
 *     This is the platform's "remote" path.
 *   - The storage-event listener in `createSyncedStore` calls
 *     `useStore.setState(parsed.state)` — a write that ALSO happens
 *     to flow through the persist middleware, but the echo guard
 *     above (subset deep-equal vs `parsed.state`) short-circuits
 *     before any actual change, preventing a re-broadcast loop.
 *
 * For D9-D13, transports that DON'T have free origin disambiguation
 * (PeerJS data channels echo your own posts back; WebRTC mesh fanout
 * may bounce a write through multiple peers) need to mark inbound
 * writes explicitly. Use `applyRemote()` below from any inbound
 * message handler. Subscribers (`useStore.subscribe`) that want to
 * suppress re-broadcast on remote-applied writes can consult
 * `isApplyingRemote()` from inside the subscribe callback.
 *
 * Rule of thumb for D10+ inbound handlers:
 *
 *   peer.on("data", (msg) => {
 *     applyRemote(() => {
 *       useFooStore.setState(msg.state);
 *     });
 *   });
 *
 * And on the broadcast side (the part that pushes local writes onto
 * the wire):
 *
 *   useFooStore.subscribe((state, prev) => {
 *     if (isApplyingRemote()) return;   // skip echo
 *     peer.send({ state });
 *   });
 */

/**
 * Tracks whether the current synchronous code path is inside an
 * `applyRemote` scope. A module-level counter supports nested calls
 * (e.g. one remote write triggers a derived setter) without flipping
 * the flag back to "local" too early.
 *
 * Synchronous-only by design: zustand's subscribers fire synchronously
 * inside `setState`, so the flag is valid for the duration of the
 * write. If a future transport needs to span an async boundary it
 * should wrap each synchronous setState batch in its own
 * `applyRemote()` rather than holding the flag across an `await`.
 */
let remoteApplyDepth = 0;

/**
 * Mark a synchronous block as applying a write that originated on a
 * remote transport (storage event, BroadcastChannel, PeerJS data
 * channel, WebRTC, etc.). Subscribers consulting `isApplyingRemote()`
 * will see `true` for the duration of `fn`.
 *
 * Always synchronous. The returned value matches `fn`'s return value
 * for ergonomics.
 *
 * @example
 *   peer.on("data", (msg) => {
 *     applyRemote(() => {
 *       useFooStore.setState(msg.state);
 *     });
 *   });
 */
export function applyRemote<R>(fn: () => R): R {
  remoteApplyDepth++;
  try {
    return fn();
  } finally {
    remoteApplyDepth--;
  }
}

/**
 * Returns `true` when the current synchronous code path is inside an
 * `applyRemote` scope — i.e. the write being processed came from a
 * transport, not a local user action. Use this from `useStore.subscribe`
 * callbacks to skip re-broadcasting an inbound write and avoid echo
 * loops in multi-transport configurations.
 *
 * @example
 *   useFooStore.subscribe(() => {
 *     if (isApplyingRemote()) return;
 *     peer.send({ state: useFooStore.getState() });
 *   });
 */
export function isApplyingRemote(): boolean {
  return remoteApplyDepth > 0;
}

/**
 * Inverse of `isApplyingRemote()`. Reads as "this write came from the
 * local user / local setter, broadcast it." Aliased for readability at
 * the broadcast callsite — both names point at the same predicate.
 */
export function originatesLocal(): boolean {
  return remoteApplyDepth === 0;
}

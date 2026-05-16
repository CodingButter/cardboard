import type { EventsAPI, EventSubscription } from "./types";

/**
 * Tagged subscription record. `scriptPath` is the path of the pack
 * script that registered the subscription (set by `ModAPIImpl` via
 * `setActiveScript` while `runPackScripts` iterates), or `null` for
 * engine-internal subscriptions / late subscriptions registered
 * outside any pack-script run.
 *
 * The tag drives auto-cleanup: when a pack swaps or a single pack-
 * script reloads via HMR, `disposeScript(path)` drops every
 * subscription whose `scriptPath` matches. `disposeAll()` nukes the
 * registry (called from `Game.destroy()` when the entire game tears
 * down).
 */
interface TaggedHandler {
  name: string;
  handler: (payload: unknown) => void;
  scriptPath: string | null;
  /** `true` once `.off()` has run — guards against double-removal. */
  removed: boolean;
}

/**
 * Pub/sub event registry — Ev1 of `docs/plans/EVENTS.md`.
 *
 * Synchronous, fire-and-forget dispatch. `emit` runs every subscribed
 * handler for the topic in registration order before returning;
 * handlers that throw are logged + skipped (the next handler still
 * runs). Handler return values are ignored.
 *
 * ## Storage
 *
 * `byTopic: Map<string, Set<TaggedHandler>>` — `Set` preserves
 * insertion order, so registration-order dispatch comes free. The
 * map's `O(1)` `get` + size-check is the no-subscriber fast path
 * (~5 ns), which matters because `frame:before` / `frame:after` fire
 * 60×/sec and most packs don't subscribe to them.
 *
 * `byScript: Map<string, Set<TaggedHandler>>` — secondary index from
 * pack-script path → that script's owned subscriptions. Walked by
 * `disposeScript(path)` on pack-script HMR.
 *
 * ## Auto-cleanup
 *
 * `ModAPIImpl.runPackScripts` wraps each script with
 * `setActiveScript(path)` → ... → `setActiveScript(null)`. Every
 * subscription registered during that window gets tagged with `path`.
 * On HMR reload of that single script, `disposeScript(path)` drops
 * its old subscriptions before re-running the new source.
 *
 * Pack-swap / page-reload: a brand-new `Game` builds a new
 * `EventsRegistry`; the old one is GC'd along with the old `Game`.
 * `disposeAll()` is the explicit teardown call.
 *
 * Ev1 implements `on / once / off / emit` only — wildcards (`name:*`,
 * `*`) and pack-id introspection in the dispatch snapshot are Ev2 work.
 */
export class EventsRegistry implements EventsAPI {
  private readonly byTopic: Map<string, Set<TaggedHandler>> = new Map();
  private readonly byScript: Map<string, Set<TaggedHandler>> = new Map();
  /**
   * The pack-script path currently executing (set by
   * `ModAPIImpl.setActiveScript`). Subscriptions registered while this
   * is non-null are tagged for `disposeScript` cleanup.
   */
  private activeScript: string | null = null;

  /** Called by `ModAPIImpl` around each pack-script's setup() run. */
  setActiveScript(path: string | null): void {
    this.activeScript = path;
  }

  on<T = unknown>(
    name: string,
    handler: (payload: T) => void,
  ): EventSubscription {
    const tagged: TaggedHandler = {
      name,
      handler: handler as (payload: unknown) => void,
      scriptPath: this.activeScript,
      removed: false,
    };
    this.add(tagged);
    return {
      name,
      off: () => this.removeTagged(tagged),
    };
  }

  once<T = unknown>(
    name: string,
    handler: (payload: T) => void,
  ): EventSubscription {
    // Wrap so the wrapper removes itself BEFORE invoking the user
    // handler. That way a `once` handler re-emitting the same topic
    // doesn't re-trigger itself (§7.4 of EVENTS.md).
    const wrapper = (payload: T): void => {
      this.removeTagged(tagged);
      handler(payload);
    };
    const tagged: TaggedHandler = {
      name,
      handler: wrapper as (payload: unknown) => void,
      scriptPath: this.activeScript,
      removed: false,
    };
    this.add(tagged);
    return {
      name,
      off: () => this.removeTagged(tagged),
    };
  }

  /**
   * Overloaded off — accepts either a subscription handle (the
   * canonical, `O(1)` path) or a (name, handler) pair for DOM-ish
   * ergonomic parity. Subscription path is preferred; the pair form
   * is `O(handlers on topic)` and requires the EXACT same function
   * reference passed to `on`.
   */
  off(name: string, handler: (payload: unknown) => void): void;
  off(subscription: EventSubscription): void;
  off(
    nameOrSub: string | EventSubscription,
    handler?: (payload: unknown) => void,
  ): void {
    if (typeof nameOrSub === "string") {
      const bucket = this.byTopic.get(nameOrSub);
      if (!bucket) return;
      for (const t of bucket) {
        if (t.handler === handler) {
          this.removeTagged(t);
          return;
        }
      }
      return;
    }
    // Subscription handle — name + ref-equality scan.
    const bucket = this.byTopic.get(nameOrSub.name);
    if (!bucket) return;
    // The subscription's `off` closure already knows the exact
    // TaggedHandler; this path is for callers who stashed the
    // subscription elsewhere and lost the closure. Identify by name +
    // call `off()` on the subscription, which is the canonical path.
    nameOrSub.off();
  }

  emit<T = unknown>(name: string, payload?: T): void {
    const bucket = this.byTopic.get(name);
    // Fast path — `Map.get` + size check. `frame:before` / `frame:after`
    // pay only this when nothing's subscribed.
    if (bucket === undefined || bucket.size === 0) return;
    // Snapshot so handlers can add/remove subscriptions mid-dispatch
    // without breaking iteration (§7.2 of EVENTS.md). Snapshot cost is
    // typically <10 entries.
    const snapshot = Array.from(bucket);
    for (const t of snapshot) {
      // `removed` guards against handlers that called `.off()` on a
      // sibling subscription mid-iteration; the sibling's TaggedHandler
      // is still in our snapshot array but its `removed` flag is set.
      if (t.removed) continue;
      try {
        t.handler(payload as unknown);
      } catch (err) {
        console.error(
          `[two_5_d] events: handler for "${name}" threw:`,
          err,
        );
      }
    }
  }

  /**
   * Drop every subscription tagged with `scriptPath`. Called by
   * `ModAPIImpl` when a single pack script reloads via HMR — before
   * the new source is re-run, the old script's subscriptions are
   * cleared so reloads don't double-fire.
   */
  disposeScript(scriptPath: string): void {
    const owned = this.byScript.get(scriptPath);
    if (!owned) return;
    for (const t of owned) this.removeTagged(t);
    this.byScript.delete(scriptPath);
  }

  /**
   * Drop EVERY subscription. Used at full-game teardown
   * (`Game.destroy`); equivalent to building a fresh registry. Cheap
   * enough that `Game.destroy` doesn't need an early-exit if no
   * subscriptions exist.
   */
  disposeAll(): void {
    this.byTopic.clear();
    this.byScript.clear();
  }

  /**
   * Test helper — total subscription count across all topics. Not
   * part of the public ModAPI surface; the smoke test consumes it
   * directly via the registry instance.
   */
  size(): number {
    let n = 0;
    for (const bucket of this.byTopic.values()) n += bucket.size;
    return n;
  }

  private add(tagged: TaggedHandler): void {
    let bucket = this.byTopic.get(tagged.name);
    if (!bucket) {
      bucket = new Set();
      this.byTopic.set(tagged.name, bucket);
    }
    bucket.add(tagged);
    if (tagged.scriptPath !== null) {
      let owned = this.byScript.get(tagged.scriptPath);
      if (!owned) {
        owned = new Set();
        this.byScript.set(tagged.scriptPath, owned);
      }
      owned.add(tagged);
    }
  }

  private removeTagged(tagged: TaggedHandler): void {
    if (tagged.removed) return;
    tagged.removed = true;
    const bucket = this.byTopic.get(tagged.name);
    if (bucket) {
      bucket.delete(tagged);
      if (bucket.size === 0) this.byTopic.delete(tagged.name);
    }
    if (tagged.scriptPath !== null) {
      const owned = this.byScript.get(tagged.scriptPath);
      if (owned) {
        owned.delete(tagged);
        if (owned.size === 0) this.byScript.delete(tagged.scriptPath);
      }
    }
  }
}

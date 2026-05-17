/**
 * ConsoleAPI — minimal recording surface for the in-engine developer
 * console (docs/plans/CONSOLE.md). This file ships *only* the message
 * buffer + subscription plumbing. The full parser / policy / built-in
 * command catalog land in later phases (C1–C4); this MVP exists so
 * pack scripts and the editor live-log panel can already consume the
 * pipeline.
 *
 * Surface placement: `api.console: ConsoleAPI`. One field on `ModAPI`,
 * matching the §3 architecture diagram.
 *
 * Author-facing contract:
 *   api.console.log("hello")                  // info-level entry
 *   api.console.info("…")                     // explicit info
 *   api.console.warn("…")                     // warning
 *   api.console.error("…")                    // error
 *   api.console.clear()                       // wipe buffer
 *   api.console.getEntries({ limit, level }?) // recent entries
 *   const off = api.console.subscribe(fn)     // listen for new entries
 *
 * The buffer is bounded (`MAX_ENTRIES`) so a runaway logger can't OOM
 * the engine. When the cap is exceeded the oldest entries drop first.
 */

/**
 * Severity tag for a single recorded entry. Mirrors the four levels
 * `ExecuteResult["level"]` covers in CONSOLE.md §4 (the `system` tag
 * is reserved for engine-emitted lines — used once the executor lands
 * in C1 — and is accepted here so future code paths don't need to
 * widen the type).
 */
export type ConsoleLevel = "log" | "info" | "warn" | "error" | "system";

/**
 * One recorded entry. `timestamp` is `performance.now()` at record
 * time so the editor's live panel can sort / age entries without
 * relying on wall-clock skew.
 */
export interface ConsoleEntry {
  readonly level: ConsoleLevel;
  readonly args: ReadonlyArray<unknown>;
  readonly timestamp: number;
}

/**
 * Options for `getEntries`. Both fields are optional — omitting them
 * returns the full buffer in insertion order.
 */
export interface ConsoleGetEntriesOptions {
  /** Cap the returned slice to the N most-recent entries. */
  readonly limit?: number;
  /** Filter to a single severity. */
  readonly level?: ConsoleLevel;
}

/**
 * Listener signature. The registry passes each newly-recorded entry
 * to every active subscriber in registration order. Subscribers must
 * not throw — the registry catches + logs to the native `console` to
 * keep one bad listener from wedging the buffer.
 */
export type ConsoleSubscriber = (entry: ConsoleEntry) => void;

/**
 * Public ConsoleAPI surface. Stable shape; future phases (C1–C4) will
 * widen the interface with `register`, `execute`, `bindKey`,
 * `setRole`, etc., per CONSOLE.md §4 — but never narrow the methods
 * declared here.
 */
export interface ConsoleAPI {
  log(...args: unknown[]): void;
  info(...args: unknown[]): void;
  warn(...args: unknown[]): void;
  error(...args: unknown[]): void;
  clear(): void;
  getEntries(opts?: ConsoleGetEntriesOptions): ReadonlyArray<ConsoleEntry>;
  subscribe(callback: ConsoleSubscriber): () => void;
}

/**
 * Default ring-buffer cap. ~10k lines covers a long debugging session
 * without ballooning memory; tune later if real usage demands more.
 */
const MAX_ENTRIES = 10_000;

/**
 * Concrete recording registry. Owns the bounded buffer plus the
 * subscriber set. Future phases extend (or replace) this class with
 * `ConsoleRegistry` per CONSOLE.md §3.1 layer 1; the recording surface
 * stays as-is so editor consumers don't churn.
 */
export class ConsoleRegistry implements ConsoleAPI {
  private readonly entries: ConsoleEntry[] = [];
  private readonly subscribers = new Set<ConsoleSubscriber>();
  private readonly maxEntries: number;

  constructor(maxEntries: number = MAX_ENTRIES) {
    this.maxEntries = Math.max(1, maxEntries);
  }

  log(...args: unknown[]): void {
    this.record("log", args);
  }

  info(...args: unknown[]): void {
    this.record("info", args);
  }

  warn(...args: unknown[]): void {
    this.record("warn", args);
  }

  error(...args: unknown[]): void {
    this.record("error", args);
  }

  clear(): void {
    this.entries.length = 0;
  }

  getEntries(opts?: ConsoleGetEntriesOptions): ReadonlyArray<ConsoleEntry> {
    const level = opts?.level;
    const limit = opts?.limit;
    let slice: ConsoleEntry[];
    if (level !== undefined) {
      slice = this.entries.filter((e) => e.level === level);
    } else {
      slice = this.entries.slice();
    }
    if (limit !== undefined && limit >= 0 && slice.length > limit) {
      slice = slice.slice(slice.length - limit);
    }
    return slice;
  }

  subscribe(callback: ConsoleSubscriber): () => void {
    this.subscribers.add(callback);
    return () => {
      this.subscribers.delete(callback);
    };
  }

  /**
   * Record an entry at the given level. Drops the oldest entry when
   * the buffer overflows the cap, then fans the new entry out to every
   * subscriber. Subscriber throws are caught + reported through the
   * native `console.error` so one bad listener can't break recording.
   */
  private record(level: ConsoleLevel, args: ReadonlyArray<unknown>): void {
    const entry: ConsoleEntry = {
      level,
      args: args.slice(),
      timestamp:
        typeof performance !== "undefined" && typeof performance.now === "function"
          ? performance.now()
          : Date.now(),
    };
    this.entries.push(entry);
    if (this.entries.length > this.maxEntries) {
      // Trim from the front. A single shift() is O(n) but acceptable
      // here — recording is rare relative to render work, and the
      // bounded length keeps the cost paid-once-per-overflow.
      this.entries.splice(0, this.entries.length - this.maxEntries);
    }
    for (const sub of this.subscribers) {
      try {
        sub(entry);
      } catch (err) {
        // Last-resort fall-through to the host console so the failure
        // is visible without recursing back into our own buffer.
        // eslint-disable-next-line no-console
        console.error("[console] subscriber threw:", err);
      }
    }
  }
}

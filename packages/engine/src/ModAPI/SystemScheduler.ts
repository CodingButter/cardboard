import type { World, Entity } from "ECS";
import type { ModAPI } from "./types";

/**
 * Per-phase system identifier — WORLD_STATE.md §7. MVP supports the
 * three concrete phases the engine drives every frame. Future
 * additions go through the same enum (additive growth, per O2 of
 * WORLD_STATE §12).
 */
export type SystemPhase = "update" | "fixedUpdate" | "render";

/**
 * The runtime shape of a system function — what a pack's system
 * script's default export must match. See WORLD_STATE.md §7.3.
 *
 * `world` is the live ECS world; `dt` is the per-tick delta in
 * seconds; `api` is the same `ModAPI` instance the pack saw during
 * `runPackScripts`. Systems are called once per frame at their
 * scheduled phase; state lives on components, not in closures.
 */
export type SystemFn = (world: World, dt: number, api: ModAPI) => void;

/**
 * One entry in the scheduler's per-phase queue. Keyed by `(entity,
 * index)` so a `Systems`-component carrying multiple `list[]`
 * entries can register + unregister each independently when the
 * carrying entity is detached.
 */
interface ScheduledSystem {
  readonly entity: Entity;
  readonly index: number;
  readonly script: string;
  readonly fn: SystemFn;
}

/**
 * Phased system scheduler — WORLD_STATE.md §7.2 + §11. Owns the
 * per-phase queues that `Systems`-component handlers feed.
 *
 * Registration order = execution order within a phase. The
 * `dependencies` field on a `Systems.list[]` entry is captured (for
 * future topo-sort wiring) but not honoured by the MVP scheduler —
 * registration order rules. Known limitation, documented in §11.5
 * of WORLD_STATE.md.
 */
export class SystemScheduler {
  private readonly perPhase: Map<SystemPhase, ScheduledSystem[]> = new Map();

  constructor() {
    this.perPhase.set("update", []);
    this.perPhase.set("fixedUpdate", []);
    this.perPhase.set("render", []);
  }

  /**
   * Register one system entry. Idempotent on `(entity, index)` — a
   * second register with the same key replaces the prior entry (the
   * usual case is `Systems`-component re-attachment during HMR).
   */
  register(
    phase: SystemPhase,
    entity: Entity,
    index: number,
    script: string,
    fn: SystemFn,
  ): void {
    const queue = this.perPhase.get(phase);
    if (!queue) {
      console.warn(
        `[scheduler] unknown phase "${phase}" — skipping registration of "${script}"`,
      );
      return;
    }
    // Replace any existing entry with the same key (cheap; lists
    // are small).
    for (let i = 0; i < queue.length; i++) {
      const e = queue[i]!;
      if (e.entity === entity && e.index === index) {
        queue[i] = { entity, index, script, fn };
        return;
      }
    }
    queue.push({ entity, index, script, fn });
  }

  /** Remove every system registered under `entity`. */
  unregisterEntity(entity: Entity): void {
    for (const queue of this.perPhase.values()) {
      for (let i = queue.length - 1; i >= 0; i--) {
        if (queue[i]!.entity === entity) queue.splice(i, 1);
      }
    }
  }

  /**
   * Run every system registered to `phase` in registration order.
   * Throws inside system bodies are caught + logged so one broken
   * system can't take the whole frame loop down.
   */
  run(phase: SystemPhase, world: World, dt: number, api: ModAPI): void {
    const queue = this.perPhase.get(phase);
    if (!queue || queue.length === 0) return;
    for (let i = 0; i < queue.length; i++) {
      const entry = queue[i]!;
      try {
        entry.fn(world, dt, api);
      } catch (err) {
        console.error(
          `[scheduler] system "${entry.script}" threw in phase "${phase}":`,
          err,
        );
      }
    }
  }

  /** For diagnostics — counts per phase. */
  counts(): Record<SystemPhase, number> {
    return {
      update: this.perPhase.get("update")?.length ?? 0,
      fixedUpdate: this.perPhase.get("fixedUpdate")?.length ?? 0,
      render: this.perPhase.get("render")?.length ?? 0,
    };
  }
}

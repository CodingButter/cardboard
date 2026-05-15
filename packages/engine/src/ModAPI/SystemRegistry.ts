import type { World } from "ECS";
import type { FrameFn } from "./types";

/**
 * Holds the list of mod-registered per-frame systems and runs them in
 * registration order. `Game.update` calls `runFrame(dt)` once per tick.
 */
export class SystemRegistry {
  private readonly systems: FrameFn[] = [];

  /**
   * Register a per-frame system. Runs once per frame, after the engine's
   * built-in update phase. Returns a function that removes the system.
   */
  registerSystem(fn: FrameFn): () => void {
    this.systems.push(fn);
    return () => {
      const i = this.systems.indexOf(fn);
      if (i !== -1) this.systems.splice(i, 1);
    };
  }

  /** Called by `Game.update`. Runs every mod-registered system in order. */
  runFrame(world: World, deltaTime: number): void {
    for (const sys of this.systems) sys(world, deltaTime);
  }
}

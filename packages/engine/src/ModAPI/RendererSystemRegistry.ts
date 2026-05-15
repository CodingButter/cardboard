import type { World } from "ECS";
import type { SceneRenderer } from "Renderers";
import type { RendererSystemFn, RenderPhase } from "./types";

/**
 * Per-phase registry of mod-registered renderer systems.
 *
 * Pack-side HUD / overlay systems attach to one of four well-known
 * phases (`before-world`, `after-world`, `after-sprites`, `hud`)
 * instead of writing to `renderer.ctx` willy-nilly. `Game.render`
 * calls `run(phase, ...)` at the appropriate point in the draw flow
 * so registration order, not import order, decides who paints first.
 *
 * Returns an unsubscribe function from `register` so a system can
 * disable itself (e.g. on world change) without leaking callbacks.
 */
export class RendererSystemRegistry {
  private readonly byPhase: Record<RenderPhase, RendererSystemFn[]> = {
    "before-world": [],
    "after-world": [],
    "after-sprites": [],
    hud: [],
  };

  register(fn: RendererSystemFn, phase: RenderPhase): () => void {
    const bucket = this.byPhase[phase];
    bucket.push(fn);
    return () => {
      const i = bucket.indexOf(fn);
      if (i !== -1) bucket.splice(i, 1);
    };
  }

  run(phase: RenderPhase, renderer: SceneRenderer, world: World, deltaTime: number): void {
    const bucket = this.byPhase[phase];
    for (const fn of bucket) fn(renderer, world, deltaTime);
  }
}

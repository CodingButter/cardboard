import type { Entity, World } from "ECS";
import { Animation } from "Components";
import type { AnimAPI } from "./types";

/**
 * Concrete `api.anim` surface — A1 of `docs/plans/ANIMATIONS.md`.
 *
 * The animation state lives on each entity's `Animation` component.
 * These helpers mutate the component in place and return; the
 * `AnimationSystem` reads from it on its next tick.
 *
 * A1 keeps the surface minimal: `play` / `stop` / `resume` /
 * `isPlaying`. `onComplete` is A2 (rides `api.events` from
 * MULTIPLAYER M1).
 */
export class AnimRegistry implements AnimAPI {
  constructor(private readonly world: World) {}

  play(entity: Entity, animName: string): void {
    const anim = Animation.get(entity);
    if (anim) {
      // No-op if already playing this animation and not paused.
      if (anim.current === animName && !anim.paused) {
        return;
      }
      anim.current = animName;
      anim.frame = 0;
      anim.elapsed = 0;
      anim.paused = false;
      return;
    }
    // Late-attached: write a fresh component so callers can spawn an
    // entity without `Animation` then start playback later.
    this.world.add(entity, Animation, {
      current: animName,
      frame: 0,
      elapsed: 0,
      paused: false,
    });
  }

  stop(entity: Entity): void {
    const anim = Animation.get(entity);
    if (!anim) return;
    anim.paused = true;
  }

  resume(entity: Entity): void {
    const anim = Animation.get(entity);
    if (!anim) return;
    anim.paused = false;
  }

  isPlaying(entity: Entity, animName?: string): boolean {
    const anim = Animation.get(entity);
    if (!anim) return false;
    if (anim.paused) return false;
    if (animName === undefined) return true;
    return anim.current === animName;
  }
}

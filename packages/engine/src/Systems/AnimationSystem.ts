import type { World } from "ECS";
import type { AssetPack } from "AssetPack";
import { Animation, Sprite } from "Components";

/**
 * Per-frame animation advance loop — A1 of `docs/plans/ANIMATIONS.md`.
 *
 * Walks every entity carrying `Sprite + Animation`, drains `elapsed`
 * against the current animation's `frameDuration`, advances the frame
 * index, handles loop wrap and `next` transitions, and pauses on the
 * last frame of a non-looping clip with no `next`.
 *
 * Runs in the UPDATE phase (Game.update) before the render phase so
 * `SpriteRenderSystem` reads stable frame state for the frame it's
 * about to draw.
 *
 * A1 deliberately does NOT emit events — A2 picks up `api.events`
 * integration once MULTIPLAYER M1 lands. `api.anim.onComplete` (A2)
 * will use an internal map maintained here when events aren't ready.
 *
 * Edge cases:
 *   - empty `frames` → skip; warn once.
 *   - unknown `current` animation name → leave state; warn once.
 *   - `playbackRate < 0` → treat as 0 (paused). Reverse playback is
 *     not in A1 scope.
 *   - Very small `frameDuration` + large dt → the while-loop drains
 *     correctly but caps total advance at `frames.length` per tick to
 *     guard against pathological combinations.
 */
export default class AnimationSystem {
  private readonly warnedAnimKeys = new Set<string>();
  private readonly warnedEmptyFrameKeys = new Set<string>();

  /**
   * Pack to read manifest sprite/animation defs from. Set by `Game`
   * after pack scripts have run. When unset the system no-ops.
   */
  pack: AssetPack | undefined;

  update(world: World, deltaTime: number): void {
    if (deltaTime <= 0) return;
    const pack = this.pack;
    if (!pack) return;

    world.each(Sprite, Animation, (_entity, sprite, anim) => {
      if (anim.paused) return;

      const def = pack.manifest.sprites?.[sprite.imageId];
      const animDef = def?.animations?.[anim.current];
      if (!animDef) {
        const key = `${sprite.imageId}:${anim.current}`;
        if (!this.warnedAnimKeys.has(key)) {
          this.warnedAnimKeys.add(key);
          console.warn(
            `[AnimationSystem] sprite "${sprite.imageId}" has no animation "${anim.current}"`,
          );
        }
        return;
      }
      const framesLen = animDef.frames.length;
      if (framesLen === 0) {
        const key = `${sprite.imageId}:${anim.current}`;
        if (!this.warnedEmptyFrameKeys.has(key)) {
          this.warnedEmptyFrameKeys.add(key);
          console.warn(
            `[AnimationSystem] animation "${anim.current}" on sprite "${sprite.imageId}" has zero frames`,
          );
        }
        anim.paused = true;
        return;
      }
      if (animDef.frameDuration <= 0) return;

      const rate = anim.playbackRate ?? 1.0;
      if (rate <= 0) return;
      anim.elapsed += deltaTime * rate;

      // Drain elapsed time, but cap iterations at `framesLen` so a
      // gigantic dt / tiny frameDuration combo doesn't spin forever.
      let guard = framesLen + 1;
      while (anim.elapsed >= animDef.frameDuration && guard-- > 0) {
        anim.elapsed -= animDef.frameDuration;
        anim.frame += 1;
        if (anim.frame >= framesLen) {
          if (animDef.loop !== false) {
            // loop is true (or unset = default true)
            anim.frame = 0;
          } else if (animDef.next !== undefined) {
            const nextDef = def?.animations?.[animDef.next];
            anim.current = animDef.next;
            anim.frame = 0;
            // If the next animation doesn't exist, the next tick will
            // warn via the same path; for now we let it be.
            if (!nextDef) {
              anim.paused = true;
            }
            break;
          } else {
            // Hold on last frame.
            anim.frame = framesLen - 1;
            anim.paused = true;
            break;
          }
        }
      }
    });
  }
}

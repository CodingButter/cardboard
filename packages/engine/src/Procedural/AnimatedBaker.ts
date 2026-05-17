/**
 * Animated-recipe baker — IL4 stub.
 *
 * IL2 scope (per IMAGE_LAB.md §11 phasing) cuts off at the static
 * `output` sink. Animated recipes are recognised by their `animation`
 * block but baked as their first frame only — the resulting
 * "spritesheet" carries a single tile that matches the static
 * `BakedRecipe` shape.
 *
 * Why ship the surface anyway? The acceptance test calls out
 * `api.procedural.loadAnimated`; downstream consumers (Sprite atlas
 * upload, future Animation system wiring) need a stable shape to
 * code against. IL4 will fill in the per-frame keyframe evaluation
 * and the row × col packing per IMAGE_LAB.md §5.5.
 */

import type { CompiledRecipe } from "./Compiler";
import type { ProceduralRenderer } from "./Renderer";
import type { Spritesheet } from "./types";

export interface BakeAnimatedOptions {
  /** Force the bake to ignore the IDB cache (IL4 will use it per-frame). */
  bypassCache?: boolean;
  /** Per-instance seed override. */
  instanceSeed?: number;
}

/**
 * Bake a (potentially animated) recipe to a `Spritesheet`. For IL2,
 * only frame 0 is baked — the spritesheet's `cols × rows` is always
 * 1 × 1, `frameCount` is 1, and `duration` echoes the recipe's
 * declared loop length so consumers can detect the IL4 follow-up
 * payload via `frameCount > 1`.
 */
export function bakeAnimated(
  renderer: ProceduralRenderer,
  compiled: CompiledRecipe,
  animation: { frames: number; duration: number } | undefined,
  opts: BakeAnimatedOptions = {},
): Spritesheet {
  // IL2: collapse to a single-frame bake. The compiled program's
  // `u_time` uniform stays at 0; per-frame keyframe scrubbing is
  // IL4's job.
  const baked = renderer.bake(compiled, {
    time: 0,
    instanceSeed: opts.instanceSeed,
  });
  return {
    id: baked.id,
    frameWidth: baked.width,
    frameHeight: baked.height,
    cols: 1,
    rows: 1,
    frameCount: 1,
    duration: animation?.duration ?? 0,
    pixels: baked.pixels,
    texture: baked.texture,
    hash: baked.hash,
  };
}

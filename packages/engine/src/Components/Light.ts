import { Component } from "ECS";

/**
 * Dynamic light source attached to an entity. The runtime walks every
 * entity carrying `Light + Position` once per frame and hands the list
 * to the renderer; both backends apply a radius-based attenuation +
 * cheap DDA line-of-sight test to add the light's contribution on top
 * of the static lightmap. See LIGHTING_OVERHAUL.md § 6 / § 5.3-5.5.
 *
 * Author-facing shape mirrors the static `LightDef` in `Scene.ts` so a
 * mod can spawn lights using the same fields as a baked scene light:
 *
 *   `color`     RGB in `[0, 1]`. Multiplies the surface albedo, so
 *               values > 1 are fine (and useful for bright glows).
 *   `intensity` Scalar multiplier on top of `color`. Drops off with the
 *               radius-based attenuation.
 *   `radius`    World radius in tiles past which the light contributes
 *               zero. Used both for the attenuation curve and a cheap
 *               distance² early-out.
 *   `z`         Optional. World z height (`0` = floor, `1` = ceiling).
 *               Defaults to `0.5`. Currently used only by the LOS test
 *               (Phase 5 treats it as a point at that z); Phase 6 will
 *               start using it for spot-light direction math.
 */
export interface LightData {
  /** RGB in `[0, 1]`. */
  color: [number, number, number];
  intensity: number;
  /** World radius in tiles. */
  radius: number;
  /** Z height in world units. 0 = floor, 1 = ceiling. Default 0.5. */
  z?: number;
}
export const Light = new Component<LightData>("Light");

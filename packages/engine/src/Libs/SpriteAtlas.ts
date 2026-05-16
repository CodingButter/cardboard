/**
 * Pure helpers shared between the sprite render system and renderer
 * backends. Computes the atlas UV region for an animation frame +
 * camera angle, and the angle-bucket index given the camera-entity
 * relative bearing.
 *
 * A1 of `docs/plans/ANIMATIONS.md` — mirror optimisation, 5-angle
 * remap, and crossfade interpolation are A2 work and absent here.
 * Angle selection uses pure nearest-neighbour (snap) bucketing.
 *
 * Atlas layout convention (settled in §5 of ANIMATIONS.md): every
 * sprite sheet is a regular `cols × rows` grid. Within the rows, the
 * first `effectiveAngles(anim0)` rows hold animation 0's per-angle
 * strips; the next `effectiveAngles(anim1)` rows hold animation 1's
 * per-angle strips; etc. Within a row, columns index frame number
 * (`anim.frames[i]` references a column). Animation order = JS
 * object-key insertion order in `manifest.sprites[<id>].animations`.
 *
 *   row = rowBase[animName] + angleIndex
 *   col = anim.frames[Animation.frame]
 */

import type { AnimationDef, SpriteDef, SpriteAngleCount } from "AssetPack";
import type { AnimationData } from "Components";

const TAU = Math.PI * 2;

/** UV region within an atlas layer. Default (no animation): the full layer. */
export interface UVRegion {
  /** UV-space origin of the frame within the layer (0..1). */
  uvOffset: { x: number; y: number };
  /** UV-space size of the frame within the layer (0..1). */
  uvScale: { x: number; y: number };
}

/** Identity region — the whole layer. Used for non-animated sprites. */
export const FULL_LAYER_REGION: Readonly<UVRegion> = {
  uvOffset: { x: 0, y: 0 },
  uvScale: { x: 1, y: 1 },
};

/**
 * Discrete angle bucket the camera falls into relative to an entity's
 * facing. Per §3.2 of ANIMATIONS.md:
 *
 *   1. viewAngle = atan2(camera.y - entity.y, camera.x - entity.x)
 *   2. relAngle  = viewAngle - entity.facing
 *   3. normalise to [0, 2π)
 *   4. step = 2π / angleCount; bucket = round(relAngle / step) mod angleCount
 *
 * The "+ step/2 → floor" formulation in the doc is the rounding form;
 * we implement it directly here. For `angleCount === 1` we skip the
 * math and return 0 (view-independent sprite).
 */
export function angleIndexFor(
  angleCount: number,
  entityX: number,
  entityY: number,
  entityFacing: number,
  cameraX: number,
  cameraY: number,
): number {
  if (angleCount <= 1) return 0;
  const viewAngle = Math.atan2(cameraY - entityY, cameraX - entityX);
  let rel = viewAngle - entityFacing;
  // Normalise to [0, 2π).
  rel = ((rel % TAU) + TAU) % TAU;
  const step = TAU / angleCount;
  const idx = Math.floor((rel + step * 0.5) / step) % angleCount;
  return idx < 0 ? idx + angleCount : idx;
}

/** Resolved per-animation `angles` (clip override beats sprite default). */
function effectiveAngles(spriteAngles: number, animDef: AnimationDef): number {
  return animDef.angles ?? spriteAngles ?? 1;
}

/**
 * Sum of per-animation effective-angle row counts for every animation
 * key declared BEFORE `animName` in the sprite's `animations` map.
 * This is the row baseline within the sheet for `animName`'s strips.
 */
function rowBaseFor(spriteDef: SpriteDef, spriteAngles: number, animName: string): number {
  const anims = spriteDef.animations;
  if (!anims) return 0;
  let base = 0;
  for (const [key, def] of Object.entries(anims)) {
    if (key === animName) return base;
    base += effectiveAngles(spriteAngles, def);
  }
  // Animation name not found — return 0 as a safe fallback.
  return 0;
}

/**
 * Resolve the UV region the renderer should sample for an entity.
 *
 *  - Sprite has no grid / no animations → `FULL_LAYER_REGION` (the
 *    whole atlas layer is one frame).
 *  - Entity lacks an `Animation` component → first frame of the first
 *    animation in declaration order; angle 0.
 *  - Entity has an `Animation` component → use `current` + `frame`
 *    against the resolved animation, with the angle index picked from
 *    the camera-entity relative bearing.
 *
 * No-animation, no-Facing entities short-circuit angle math entirely.
 *
 * Out-of-range frame indices (stale after manifest hot-edit, or after
 * an `api.anim.play` raced an external set) are clamped via modulo
 * against the resolved frames list.
 */
export function resolveSpriteRegion(
  spriteDef: SpriteDef | undefined,
  animData: AnimationData | undefined,
  entityX: number,
  entityY: number,
  entityFacing: number | undefined,
  cameraX: number,
  cameraY: number,
): UVRegion {
  if (!spriteDef) return FULL_LAYER_REGION;
  // Pre-A1 single-image sprite — no grid, no animations.
  const cols = spriteDef.cols ?? 0;
  const rows = spriteDef.rows ?? 0;
  if (cols <= 0 || rows <= 0 || !spriteDef.frameWidth || !spriteDef.frameHeight) {
    return FULL_LAYER_REGION;
  }

  // Pick the active animation. Without an Animation component, use the
  // first declared animation. If the sprite declares no animations,
  // fall back to the full-layer region (matches pre-A1 behaviour for
  // any sprite the pack never animates).
  const anims = spriteDef.animations;
  if (!anims) return FULL_LAYER_REGION;
  const animNames = Object.keys(anims);
  if (animNames.length === 0) return FULL_LAYER_REGION;

  const animName = animData?.current ?? animNames[0]!;
  const animDef = anims[animName];
  if (!animDef || animDef.frames.length === 0) {
    // Stale `current` reference — fall back to first declared animation
    // so the renderer never reads garbage. The AnimationSystem logs.
    const fallback = anims[animNames[0]!]!;
    if (fallback.frames.length === 0) return FULL_LAYER_REGION;
    return regionFor(spriteDef, fallback, animNames[0]!, 0, 0);
  }

  const spriteAngles = spriteDef.angles ?? 1;
  const angles = effectiveAngles(spriteAngles, animDef);
  const angleIndex = entityFacing === undefined || angles <= 1
    ? 0
    : angleIndexFor(angles, entityX, entityY, entityFacing, cameraX, cameraY);

  const frameIndex = animData?.frame ?? 0;
  // Modulo-clamp against animation length to survive stale frame state.
  const safeFrame = ((frameIndex % animDef.frames.length) + animDef.frames.length) %
    animDef.frames.length;

  return regionFor(spriteDef, animDef, animName, safeFrame, angleIndex);
}

/**
 * Compute the UV-space region for a specific frame + angle. Caller
 * resolved `animName` already (we need it for the rowBase lookup).
 *
 * The sheet's full pixel dimensions are `cols * frameWidth × rows *
 * frameHeight`. The atlas-array layer is one slot for the whole sheet
 * (per ANIMATIONS.md §5.4), so the renderer normalises the source sheet
 * to fit the layer with letterboxing (see WebGLRenderer.uploadSpriteLayer
 * — this returns UVs in the sheet's NORMALISED space, not the layer
 * space; the renderer combines them as appropriate).
 *
 * Actually — the renderer uploads the FULL SHEET to the layer (one
 * `texSubImage3D` per layer, normalised to `SPRITE_RESOLUTION`). The
 * UV region we return is the rectangle in [0,1] layer space that
 * corresponds to the (col, row) cell, treating the sheet as filling
 * the layer 1:1 (it does, after the resize to SPRITE_RESOLUTION).
 */
function regionFor(
  spriteDef: SpriteDef,
  animDef: AnimationDef,
  animName: string,
  frameIndex: number,
  angleIndex: number,
): UVRegion {
  const cols = spriteDef.cols ?? 1;
  const rows = spriteDef.rows ?? 1;
  const spriteAngles = spriteDef.angles ?? 1;
  const rowBase = rowBaseFor(spriteDef, spriteAngles, animName);
  // Stale animation frame → safeFrame is the caller's responsibility;
  // here we just trust frameIndex < animDef.frames.length.
  const col = animDef.frames[frameIndex] ?? 0;
  const row = rowBase + angleIndex;
  // Clamp row + col to the sheet grid so a bad manifest doesn't read
  // OOB UV. (Renderer falls back visually; AnimationSystem warns once.)
  const safeCol = col >= 0 && col < cols ? col : 0;
  const safeRow = row >= 0 && row < rows ? row : 0;
  const u0 = safeCol / cols;
  const v0 = safeRow / rows;
  return {
    uvOffset: { x: u0, y: v0 },
    uvScale: { x: 1 / cols, y: 1 / rows },
  };
}

/** Number of allowed angle counts — used by pack-builder validation. */
export const ALLOWED_ANGLE_COUNTS: ReadonlyArray<SpriteAngleCount> = [1, 2, 4, 5, 8, 16];

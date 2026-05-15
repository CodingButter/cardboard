/**
 * Auto-injected GLSL helper functions (R4 / Phase S2).
 *
 * Helpers used to live inline inside `FRAG_WORLD_SRC` / `FRAG_SPRITE_SRC`
 * in `WebGLRenderer.ts`. They've been promoted here so:
 *
 *  - Pack-shipped Mode 1 (`worldFrag`) bodies can call them.
 *  - Pack-shipped Mode 3 (`worldHooks`) overrides can call them.
 *  - The engine's own default bodies use the SAME header + helpers a
 *    pack would see, keeping the contract honest.
 *
 * This module ONLY contains GLSL string constants — no runtime logic.
 * `shaderHeaders.ts` concatenates the right helper block into each role's
 * header.
 */

/**
 * Helpers used by the world fragment shader. Includes:
 *  - Scene-cell predicates (`inBounds`, `isFloorOccluderC`, `isCeilingOccluderC`).
 *  - Atlas sampler (`sampleTile`).
 *  - AO band math (`wallAo`, `surfaceAo`).
 *  - Reflectivity blend (`effectiveReflectiveness`).
 *  - Wall pixel re-shader (`wallPixelAt`).
 *  - In-shader DDA LOS (`losClearWorld`).
 *  - Dynamic light accumulator (`accumulateDynamicLight`).
 *  - Lightmap sampler (`sampleLightmap`).
 *
 * All helpers reference uniforms declared in `HEADER_WORLD`.
 *
 * The hook helpers `hook_modifyLightAttenuation`, `_modifyLightCoverage`,
 * and `_modifyLightColor` are CALLED here (inside `accumulateDynamicLight`)
 * but their identity defaults live in `HookPrelude.ts`. The prelude must
 * be injected BEFORE this helper block — see `shaderHeaders.ts`.
 */
export const HELPERS_WORLD = `
/* --- Engine helpers (S2 — promoted from FRAG_WORLD_SRC) -------------- */

bool inBounds(ivec2 c) {
  return c.x >= 0 && c.y >= 0
      && c.x < int(u_sceneSize.x) && c.y < int(u_sceneSize.y);
}

bool isFloorOccluderC_raw(ivec2 c) {
  if (!inBounds(c)) return false;
  return texelFetch(u_sceneTiles, c, 0).r > 0.5;
}
bool isCeilingOccluderC_raw(ivec2 c) {
  if (!inBounds(c)) return false;
  return texelFetch(u_sceneTiles, c, 0).a > 0.5;
}
// Hook-aware wrappers — let a pack-supplied hook_isOccluder reclassify
// neighbouring cells for AO predicate purposes.
bool isFloorOccluderC(ivec2 c) {
  return hook_isOccluder(isFloorOccluderC_raw(c), c, false);
}
bool isCeilingOccluderC(ivec2 c) {
  return hook_isOccluder(isCeilingOccluderC_raw(c), c, true);
}

vec3 sampleTile(int tile, vec2 uv) {
  return texture(u_tiles, vec3(uv, float(tile))).rgb;
}

vec3 sampleLightmap(vec2 worldPos, bool ceiling) {
  float lmK = u_lightmapResolution;
  vec2 lightUV = vec2((worldPos.x * lmK + 0.5) / (u_sceneSize.x * lmK + 1.0),
                      (worldPos.y * lmK + 0.5) / (u_sceneSize.y * lmK + 1.0));
  return ceiling
    ? texture(u_lightmapCeiling, lightUV).rgb
    : texture(u_lightmapFloor, lightUV).rgb;
}

// Wall AO multiplier as a function of screen y within the wall band.
// Identity-default hook_modifyWallAo passes the engine value through
// unchanged; pack overrides can soften / disable / invert the band.
float wallAo(float y, float wallTop, float wallHeight) {
  float aoBotStrength = 1.0 - u_wallAoBotDarken;
  float aoBotStart = wallTop + wallHeight * (1.0 - u_wallAoBotBand);
  float aoBotSpanInv = 1.0 / (wallHeight * u_wallAoBotBand);
  float botT = max(0.0, (y - aoBotStart) * aoBotSpanInv);

  float aoTopStrength = 1.0 - u_wallAoTopDarken;
  float aoTopEnd = wallTop + wallHeight * u_wallAoTopBand;
  float aoTopSpanInv = 1.0 / (wallHeight * u_wallAoTopBand);
  float topT = max(0.0, (aoTopEnd - y) * aoTopSpanInv);

  float base = (1.0 - aoBotStrength * botT * botT) * (1.0 - aoTopStrength * topT * topT);
  return hook_modifyWallAo(base, y, wallTop, wallHeight);
}

// World-space AO at cell-type boundaries — parameterised by which
// surface (floor / ceiling) we're testing so partial walls only cast a
// contact shadow on the surface they actually touch.
float surfaceAo(ivec2 cellCoord, vec2 frac, bool useCeiling) {
  bool self = useCeiling
    ? isCeilingOccluderC(cellCoord)
    : isFloorOccluderC(cellCoord);
  bool oL = (useCeiling ? isCeilingOccluderC(cellCoord + ivec2(-1, 0)) : isFloorOccluderC(cellCoord + ivec2(-1, 0))) != self;
  bool oR = (useCeiling ? isCeilingOccluderC(cellCoord + ivec2( 1, 0)) : isFloorOccluderC(cellCoord + ivec2( 1, 0))) != self;
  bool oU = (useCeiling ? isCeilingOccluderC(cellCoord + ivec2( 0,-1)) : isFloorOccluderC(cellCoord + ivec2( 0,-1))) != self;
  bool oD = (useCeiling ? isCeilingOccluderC(cellCoord + ivec2( 0, 1)) : isFloorOccluderC(cellCoord + ivec2( 0, 1))) != self;

  float prox = 0.0;
  if (oL) prox = max(prox, 1.0 - frac.x);
  if (oR) prox = max(prox, frac.x);
  if (oU) prox = max(prox, 1.0 - frac.y);
  if (oD) prox = max(prox, frac.y);

  bool dTL = useCeiling ? isCeilingOccluderC(cellCoord + ivec2(-1,-1)) : isFloorOccluderC(cellCoord + ivec2(-1,-1));
  bool dTR = useCeiling ? isCeilingOccluderC(cellCoord + ivec2( 1,-1)) : isFloorOccluderC(cellCoord + ivec2( 1,-1));
  bool dBL = useCeiling ? isCeilingOccluderC(cellCoord + ivec2(-1, 1)) : isFloorOccluderC(cellCoord + ivec2(-1, 1));
  bool dBR = useCeiling ? isCeilingOccluderC(cellCoord + ivec2( 1, 1)) : isFloorOccluderC(cellCoord + ivec2( 1, 1));
  if (!oL && !oU && dTL != self) prox = max(prox, (1.0 - frac.x) * (1.0 - frac.y));
  if (!oR && !oU && dTR != self) prox = max(prox, frac.x * (1.0 - frac.y));
  if (!oL && !oD && dBL != self) prox = max(prox, (1.0 - frac.x) * frac.y);
  if (!oR && !oD && dBR != self) prox = max(prox, frac.x * frac.y);

  if (prox <= 0.0) return 1.0;
  float aoT = max(0.0, (prox - (1.0 - u_floorAoBand)) / u_floorAoBand);
  return 1.0 - (1.0 - u_floorAoDarken) * aoT * aoT;
}

// Effective reflectiveness for this cell, blended bilinearly with its
// neighbors by transition. channel picks between floor (.r) and ceiling
// (.b) of u_sceneRefl.
float effectiveReflectiveness(
  ivec2 cellCoord, vec2 frac, float ownRefl, float trans,
  int channel
) {
  if (trans <= 0.0) return ownRefl;
  ivec2 off;
  off.x = frac.x < 0.5 ? -1 : 1;
  off.y = frac.y < 0.5 ? -1 : 1;
  float bix = frac.x < 0.5 ? 1.0 - 2.0 * frac.x : 2.0 * frac.x - 1.0;
  float biy = frac.y < 0.5 ? 1.0 - 2.0 * frac.y : 2.0 * frac.y - 1.0;
  float w00 = (1.0 - bix) * (1.0 - biy);
  float w10 = bix * (1.0 - biy);
  float w01 = (1.0 - bix) * biy;
  float w11 = bix * biy;

  ivec2 c10 = cellCoord + ivec2(off.x, 0);
  ivec2 c01 = cellCoord + ivec2(0, off.y);
  ivec2 c11 = cellCoord + ivec2(off.x, off.y);

  float r10 = inBounds(c10) ? texelFetch(u_sceneRefl, c10, 0)[channel] : ownRefl;
  float r01 = inBounds(c01) ? texelFetch(u_sceneRefl, c01, 0)[channel] : ownRefl;
  float r11 = inBounds(c11) ? texelFetch(u_sceneRefl, c11, 0)[channel] : ownRefl;
  float bilinear = ownRefl * w00 + r10 * w10 + r01 * w01 + r11 * w11;
  return ownRefl + (bilinear - ownRefl) * trans;
}

// Reproduce the shaded wall pixel at screen y wy -- for in-shader mirror reflection.
// segOffsetX and segOffsetY are pre-normalised by texture size on the CPU
// side, so adding them straight onto the [0,1] UV slides the sample with
// REPEAT wrap.
vec3 wallPixelAt(
  float wy, float wallTop, float wallHeight,
  int wallTile, float wallU, float sideMul, float perpDist,
  float segOffsetX, float segOffsetY
) {
  float texV = (wy - wallTop) / wallHeight + segOffsetY;
  vec3 wallColor = sampleTile(wallTile, vec2(wallU + segOffsetX, texV));
  float fogMul = clamp(1.0 - perpDist * u_fogInv, 0.0, 1.0);
  float aoMul = wallAo(wy, wallTop, wallHeight);
  return wallColor * sideMul * fogMul * aoMul;
}

// In-shader DDA LOS for the world pass. Walks integer cells from a to b
// and returns false on the first isFloorOccluderC hit between them.
// Capped at MAX_LOS_STEPS; fail-closed at the cap. The destination cell
// is skipped so a light can never self-occlude.
bool losClearWorld(vec2 a, vec2 b) {
  vec2 d = b - a;
  float dist = length(d);
  if (dist < 1e-4) return true;
  int steps = int(min(float(MAX_LOS_STEPS), ceil(dist) + 2.0));
  vec2 step = d / float(steps);
  ivec2 endCell = ivec2(floor(b));
  ivec2 cell = ivec2(floor(a));
  vec2 p = a;
  for (int i = 0; i < MAX_LOS_STEPS; i++) {
    if (i >= steps) break;
    p += step;
    ivec2 nc = ivec2(floor(p));
    if (nc == cell) continue;
    cell = nc;
    if (cell == endCell) return true;
    if (!inBounds(cell)) continue;
    if (isFloorOccluderC(cell)) return false;
  }
  return cell == endCell;
}

// Phase 5 dynamic light accumulator. Walks every uploaded light, drops
// any further than its radius, runs a cheap in-shader DDA LOS, and adds
// color * (1 - d/r)^2 * intensity. Result is in the same [0,1] colour
// space as the static lightmap multiplier — callers add it as
// albedo * (staticLight + dynamic).
//
// Soft-shadow jitter: each (pixel, light) pair runs LIGHT_JITTER_SAMPLES
// LOS tests at slightly offset light positions (matches the static bake's
// jitter table) and averages the boolean visibility into a fractional
// coverage in [0, 1]. Kills the dithering you'd otherwise see from
// adjacent rays' Bresenham LOS stepping through different cells.
//
// Per-light hooks (Mode 3) live inside this loop: _modifyLightColor lets
// a pack recolour the light pre-attenuation, _modifyLightCoverage tweaks
// the soft-shadow scalar, _modifyLightAttenuation overrides the final
// per-pixel falloff. Identity defaults reduce to a no-op.
vec3 accumulateDynamicLight(vec2 wp) {
  vec3 acc = vec3(0.0);
  if (u_lightCount <= 0) return acc;
  float invN = 1.0 / float(LIGHT_JITTER_SAMPLES);
  for (int i = 0; i < MAX_LIGHTS; i++) {
    if (i >= u_lightCount) break;
    vec3 lp = u_lightPos[i].xyz;
    float intensity = u_lightPos[i].w;
    vec3 lc = u_lightCol[i].rgb;
    float radius = u_lightCol[i].a;
    lc = hook_modifyLightColor(lc, i);
    vec2 dxy = lp.xy - wp;
    float dist2 = dot(dxy, dxy);
    if (dist2 > radius * radius) continue;
    float dist = sqrt(dist2);
    float coverage = 0.0;
    for (int s = 0; s < LIGHT_JITTER_SAMPLES; s++) {
      if (losClearWorld(wp, lp.xy + LIGHT_JITTER_OFFSETS[s])) coverage += 1.0;
    }
    if (coverage <= 0.0) continue;
    coverage *= invN;
    coverage = hook_modifyLightCoverage(coverage, lp, wp);
    float t = 1.0 - dist / radius;
    float atten = t * t * intensity * coverage;
    atten = hook_modifyLightAttenuation(atten, lp, wp, radius, intensity);
    acc += lc * atten;
  }
  return acc;
}
`;

/**
 * Helpers used by the sprite fragment shader. Mirrors the world helpers
 * but uses only the per-sprite uniform surface — no scene-refl, no
 * lightmap-ceiling, no full slab loop. The `losClearSprite` is the same
 * shape as `losClearWorld` but doesn't rely on the world helpers
 * existing in the same translation unit.
 */
export const HELPERS_SPRITE = `
/* --- Engine sprite helpers (S2 — promoted from FRAG_SPRITE_SRC) ------ */

bool isSpriteOccluder(ivec2 cell) {
  if (cell.x < 0 || cell.y < 0
      || cell.x >= int(u_sceneSize.x) || cell.y >= int(u_sceneSize.y)) return false;
  return texelFetch(u_sceneTiles, cell, 0).r > 0.5;
}

bool losClearSprite(vec2 a, vec2 b) {
  vec2 d = b - a;
  float dist = length(d);
  if (dist < 1e-4) return true;
  int steps = int(min(float(MAX_LOS_STEPS), ceil(dist) + 2.0));
  vec2 step = d / float(steps);
  ivec2 endCell = ivec2(floor(b));
  ivec2 cell = ivec2(floor(a));
  vec2 p = a;
  for (int i = 0; i < MAX_LOS_STEPS; i++) {
    if (i >= steps) break;
    p += step;
    ivec2 nc = ivec2(floor(p));
    if (nc == cell) continue;
    cell = nc;
    if (cell == endCell) return true;
    if (cell.x < 0 || cell.y < 0
        || cell.x >= int(u_sceneSize.x) || cell.y >= int(u_sceneSize.y)) continue;
    if (texelFetch(u_sceneTiles, cell, 0).r > 0.5) return false;
  }
  return cell == endCell;
}

// Sprite-only static lightmap sampler. Sprites only sample the floor
// lightmap today (see Phase 4 note above the uniform decl).
vec3 sampleLightmap(vec2 worldPos, bool ceiling) {
  // Sprite header only binds u_lightmapFloor; ignore the ceiling flag.
  float lmK = u_lightmapResolution;
  vec2 lightUV = vec2((worldPos.x * lmK + 0.5) / (u_sceneSize.x * lmK + 1.0),
                      (worldPos.y * lmK + 0.5) / (u_sceneSize.y * lmK + 1.0));
  return texture(u_lightmapFloor, lightUV).rgb;
}

// One-pixel-Y screen-coord slab z-clip used in main().
bool isSpriteHiddenBySlab() {
  int colX = int(floor(gl_FragCoord.x));
  float yTop = u_resolution.y - gl_FragCoord.y;
  float horizonY = u_resolution.y * 0.5 + u_horizonOffset;
  float pixelsPerUnit = u_resolution.x / (2.0 * u_planeScale);
  for (int s = 0; s < MAX_SLABS; s++) {
    vec4 col = texelFetch(u_columns, ivec2(colX, s), 0);
    int tile = int(col.a);
    if (tile <= 0) continue;
    float perpDist = col.r;
    if (perpDist >= v_camY) continue;
    vec4 seg = texelFetch(u_columnsSeg, ivec2(colX, s), 0);
    float startZ = seg.r;
    float height = seg.g;
    float unitH = pixelsPerUnit / perpDist;
    float wTop = horizonY - (startZ + height - u_cameraZ) * unitH;
    float wBot = horizonY - (startZ - u_cameraZ) * unitH;
    if (yTop >= wTop && yTop < wBot) return true;
  }
  return false;
}

vec3 accumulateDynamicLightSprite(vec2 wp) {
  vec3 acc = vec3(0.0);
  if (u_lightCount <= 0) return acc;
  float invN = 1.0 / float(LIGHT_JITTER_SAMPLES);
  for (int i = 0; i < MAX_LIGHTS; i++) {
    if (i >= u_lightCount) break;
    vec3 lp = u_lightPos[i].xyz;
    float intensity = u_lightPos[i].w;
    vec3 lc = u_lightCol[i].rgb;
    float radius = u_lightCol[i].a;
    vec2 dxy = lp.xy - wp;
    float dist2 = dot(dxy, dxy);
    if (dist2 > radius * radius) continue;
    float dist = sqrt(dist2);
    float coverage = 0.0;
    for (int s = 0; s < LIGHT_JITTER_SAMPLES; s++) {
      if (losClearSprite(wp, lp.xy + LIGHT_JITTER_OFFSETS[s])) coverage += 1.0;
    }
    if (coverage <= 0.0) continue;
    coverage *= invN;
    float t = 1.0 - dist / radius;
    float atten = t * t * intensity * coverage;
    acc += lc * atten;
  }
  return acc;
}
`;

/**
 * Jitter table for soft shadows. Shared verbatim between world + sprite
 * helpers — both reference `LIGHT_JITTER_OFFSETS`. Header-defined so a
 * pack body can read it (e.g. to extend the soft-shadow average over the
 * same jitter ring).
 */
export const JITTER_BLOCK = `
#define LIGHT_JITTER_SAMPLES 3
const vec2 LIGHT_JITTER_OFFSETS[LIGHT_JITTER_SAMPLES] = vec2[](
  vec2(0.0, 0.0),
  vec2(0.05, 0.0),
  vec2(-0.05, 0.0)
);
`;

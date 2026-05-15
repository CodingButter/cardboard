import type { Scene } from "Scene";
import { Vec2 } from "Libs/Vector";
import { castRayThroughWalls, WallSide, type WallHit } from "Libs/Raycast";
import type { IPixel } from "Libs/Geometry";
import type { CameraData } from "Components";
import { CONFIG } from "GameConfig";
import { Texture } from "./Texture";
import type { LightInstance, SceneRenderer, SpriteDrawRequest } from "./SceneRenderer";
import type { AssetPack, SheetEntry, ShaderRole } from "AssetPack";
import { getShaderSource, SHADER_ROLES } from "./ShaderRoleRegistry";

export interface WebGLRendererProps {
  canvas: HTMLCanvasElement;
  pack: AssetPack;
  width?: number;
  height?: number;
  /**
   * Pre-resolved shader source per role, as produced by
   * `WebGLRenderer.prefetchShaderSources(pack)`. When omitted, the
   * renderer uses its built-in defaults — equivalent to passing the
   * result of a `prefetchShaderSources` call on a pack with no
   * `shaders` field. Phase S1 of `ENGINE_PACK_SHADERS.md`.
   */
  shaderSources?: Partial<Record<ShaderRole, string>>;
}

/* --- Tile texture array --------------------------------------------------- */

/** Number of layers in the tile texture array (tile ids `0..TILE_LAYERS-1`). */
const TILE_LAYERS = 46;
/** All array layers share this resolution; smaller sources are upscaled. */
const TILE_RESOLUTION = 256;

/**
 * Per-column slab cap — how many wall hits the renderer can draw on a
 * single screen column. Knee-wall + tall-wall behind needs 2; the
 * spare 2 cover the corner cases (knee + knee + tall, hanging-header
 * + knee + tall, etc.). Bumping is cheap — just more bytes in the
 * three per-frame data textures.
 */
const MAX_SLABS_PER_COLUMN = 4;

/** Max simultaneous sprite ids in a pack. Bump if needed; each layer = 256 KB. */
const SPRITE_LAYERS = 32;
/** Square resolution every sprite layer is normalised to. Mirrors TILE_RESOLUTION. */
const SPRITE_RESOLUTION = 256;
/** Soft cap on sprites per frame. Drives VBO size; raising is cheap. */
const MAX_SPRITES_PER_FRAME = 256;

/**
 * Per-frame dynamic-light cap for the WebGL backend. Each light costs a
 * fragment-shader iteration with a bounded in-shader DDA LOS walk
 * (`MAX_LOS_STEPS` cells). Keep this in sync with the `MAX_LIGHTS`
 * `#define` in `FRAG_WORLD_SRC` / `FRAG_SPRITE_SRC`. The CPU backend
 * caps at 4 (`MAX_DYNAMIC_LIGHTS_CPU` in TwoDRenderer); 8 is comfortable
 * for mobile GPUs and matches LIGHTING_OVERHAUL.md § 5.4.
 */
const MAX_DYNAMIC_LIGHTS_GL = 8;

/* --- Shaders ----------------------------------------------------------- */

/** Pass-through fullscreen quad — fragment shader does all the work. */
const VERT_SRC = `#version 300 es
in vec2 a_position;
out vec2 v_uv;
void main() {
  gl_Position = vec4(a_position, 0.0, 1.0);
  v_uv = a_position * 0.5 + 0.5;
}
`;

/**
 * Sprite pass — billboarded quads alpha-blended over the world. CPU builds
 * a fresh VBO each frame (one quad per visible sprite, already projected
 * into clip space). The fragment shader samples a TEXTURE_2D_ARRAY for
 * the sprite atlas and z-clips by comparing the vertex-interpolated
 * `v_camY` against `u_columns` at the fragment's screen-x.
 */
const VERT_SPRITE_SRC = `#version 300 es
in vec2 a_position;
in vec2 a_uv;
in float a_layer;
in float a_camY;
in vec2 a_worldPos;
out vec2 v_uv;
flat out float v_layer;
flat out float v_camY;
flat out vec2 v_worldPos;
void main() {
  gl_Position = vec4(a_position, 0.0, 1.0);
  v_uv = a_uv;
  v_layer = a_layer;
  v_camY = a_camY;
  v_worldPos = a_worldPos;
}
`;

const FRAG_SPRITE_SRC = `#version 300 es
#define MAX_SLABS 4
#define MAX_LIGHTS 8
#define MAX_LOS_STEPS 16
precision highp float;
precision highp sampler2DArray;
in vec2 v_uv;
flat in float v_layer;
flat in float v_camY;
flat in vec2 v_worldPos;
out vec4 outColor;
uniform sampler2DArray u_sprites;
uniform sampler2D u_columns;
uniform sampler2D u_columnsSeg;
// Phase 4: sprites sample only the FLOOR lightmap. Most sprites sit
// near the floor; route a per-sprite-z choice later if needed.
uniform sampler2D u_lightmapFloor;
uniform sampler2D u_sceneTiles;
uniform vec2 u_resolution;
uniform vec2 u_sceneSize;
// K-factor: sub-samples per cell on each axis the bake used. Default
// 4 for new bakes; legacy bakes ship K=1 and the UV math degenerates
// to the original (W+1)×(H+1) corner grid.
uniform float u_lightmapResolution;
uniform float u_horizonOffset;
uniform float u_cameraZ;
uniform float u_planeScale;
uniform float u_fogInv;
// Dynamic lights — see MAX_DYNAMIC_LIGHTS_GL on the CPU side.
//   u_lightPos.xyz = world (x, y, z), .w = intensity.
//   u_lightCol.rgb = colour in [0,1] (HDR allowed), .a = radius (tiles).
uniform int u_lightCount;
uniform vec4 u_lightPos[MAX_LIGHTS];
uniform vec4 u_lightCol[MAX_LIGHTS];

// Soft-shadow jitter table — same offsets the world shader uses. See
// FRAG_WORLD_SRC for the rationale. Sprites get one sample per sprite
// (matching the CPU model), so the jitter loop runs once per sprite,
// not per pixel.
#define LIGHT_JITTER_SAMPLES 3
const vec2 LIGHT_JITTER_OFFSETS[LIGHT_JITTER_SAMPLES] = vec2[](
  vec2(0.0, 0.0),
  vec2(0.05, 0.0),
  vec2(-0.05, 0.0)
);
// In-shader DDA LOS — walks integer cells between (ax, ay) and (bx, by)
// using the same isFloorOccluderC predicate the AO pass uses (wall
// reaches floor — fine for Phase 5 LOS). Capped at MAX_LOS_STEPS;
// fail-closed at the cap so unreachable lights never leak. Skips the
// destination cell so the light's own cell never self-occludes.
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
void main() {
  // Per-pixel slab z-clip — walks every wall hit on this column and
  // discards the sprite pixel only if a slab CLOSER than the sprite
  // actually covers this fragment's y. Lets a sprite peek over the
  // top of a knee wall instead of being hidden whole-column.
  int colX = int(floor(gl_FragCoord.x));
  // Convert gl_FragCoord.y (bottom-up) to canvas-style y (top-down)
  // so it matches the world shader's wall-band math.
  float yTop = u_resolution.y - gl_FragCoord.y;
  float horizonY = u_resolution.y * 0.5 + u_horizonOffset;
  // Same aspect-correct per-unit Z scale as the world shader.
  float pixelsPerUnit = u_resolution.x / (2.0 * u_planeScale);
  bool hidden = false;
  for (int s = 0; s < MAX_SLABS; s++) {
    vec4 col = texelFetch(u_columns, ivec2(colX, s), 0);
    int tile = int(col.a);
    if (tile <= 0) continue;
    float perpDist = col.r;
    if (perpDist >= v_camY) continue; // slab is behind the sprite
    vec4 seg = texelFetch(u_columnsSeg, ivec2(colX, s), 0);
    float startZ = seg.r;
    float height = seg.g;
    float unitH = pixelsPerUnit / perpDist;
    float wTop = horizonY - (startZ + height - u_cameraZ) * unitH;
    float wBot = horizonY - (startZ - u_cameraZ) * unitH;
    if (yTop >= wTop && yTop < wBot) {
      hidden = true;
      break;
    }
  }
  if (hidden) discard;

  // Texture orientation: getImageData returns data top-down, and GL
  // upload (without UNPACK_FLIP_Y, which texSubImage3D ignores anyway)
  // places the first data row at v=0 (texture bottom). Our quad UVs
  // already use Y-down (TL = uv(0,0)), so the two flips cancel and a
  // direct sample lands right-side-up.
  vec4 tex = texture(u_sprites, vec3(v_uv, v_layer));
  if (tex.a <= 0.001) discard;
  float fogMul = clamp(1.0 - v_camY * u_fogInv, 0.0, 1.0);
  // Static lightmap — corner grid is (W*K+1)×(H*K+1) RGBA32F with
  // LINEAR filtering. K=1 reproduces the original (W+1)×(H+1) layout
  // for back-compat with legacy bakes; K>=2 sharpens shadow edges
  // because the boundary can snap to a 1/K-wide gridline instead of
  // the full integer cell line.
  float lmK = u_lightmapResolution;
  vec2 lightUV = vec2((v_worldPos.x * lmK + 0.5) / (u_sceneSize.x * lmK + 1.0),
                      (v_worldPos.y * lmK + 0.5) / (u_sceneSize.y * lmK + 1.0));
  vec3 staticLight = texture(u_lightmapFloor, lightUV).rgb;
  // Dynamic-light add — Phase 5. One sample per sprite at v_worldPos,
  // matching the canvas2d backend's per-sprite (not per-pixel) model.
  // Each light runs LIGHT_JITTER_SAMPLES LOS tests at jittered light
  // positions and averages into a coverage scalar — same soft-shadow
  // treatment the world shader applies.
  vec3 dynamicLight = vec3(0.0);
  if (u_lightCount > 0) {
    float invN = 1.0 / float(LIGHT_JITTER_SAMPLES);
    for (int i = 0; i < MAX_LIGHTS; i++) {
      if (i >= u_lightCount) break;
      vec3 lp = u_lightPos[i].xyz;
      float intensity = u_lightPos[i].w;
      vec3 lc = u_lightCol[i].rgb;
      float radius = u_lightCol[i].a;
      vec2 dxy = lp.xy - v_worldPos;
      float dist2 = dot(dxy, dxy);
      if (dist2 > radius * radius) continue;
      float dist = sqrt(dist2);
      float coverage = 0.0;
      for (int s = 0; s < LIGHT_JITTER_SAMPLES; s++) {
        if (losClearSprite(v_worldPos, lp.xy + LIGHT_JITTER_OFFSETS[s])) coverage += 1.0;
      }
      if (coverage <= 0.0) continue;
      coverage *= invN;
      float t = 1.0 - dist / radius;
      float atten = t * t * intensity * coverage;
      dynamicLight += lc * atten;
    }
  }
  outColor = vec4(tex.rgb * fogMul * (staticLight + dynamicLight), tex.a);
}
`;

/** Sky pass — two-color vertical gradient (top color on top half, bottom on bottom). */
const FRAG_SKY_SRC = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 outColor;
uniform vec3 u_top;
uniform vec3 u_bottom;
void main() {
  vec3 col = (v_uv.y > 0.5) ? u_top : u_bottom;
  outColor = vec4(col, 1.0);
}
`;

/**
 * World pass. The fragment shader is the entire scene renderer — for each
 * pixel it decides whether the pixel is wall / floor / ceiling, samples
 * the right tile texture, applies side darken + fog + AO bands + world-
 * space AO, and finally composites any reflection (wall mirror near the
 * wall band, tiled cross-reflection in open areas).
 *
 * Inputs:
 *
 *   - `u_tiles`        TEXTURE_2D_ARRAY, one layer per tile id (256×256
 *                       each, indices = tile id).
 *   - `u_columns`      1×W RGBA32F: per-screen-column DDA result
 *                       `(perpDist, wallU, sideMul, wallTile)`.
 *   - `u_sceneTiles`   SW×SH RGBA32F: per-cell `(wallTile, floorTile,
 *                       ceilTile, _)`.
 *   - `u_sceneRefl`    SW×SH RGBA32F: per-cell `(floorRefl, floorTrans,
 *                       ceilRefl, ceilTrans)`.
 *   - per-frame camera + tuning uniforms.
 *
 * Reflections recompute the wall pixel in-shader rather than reading from
 * an offscreen buffer — wall color is deterministic from `(wallTile,
 * wallU, sideMul, perpDist, mirroredY)`, so we don't need a render target.
 */
const FRAG_WORLD_SRC = `#version 300 es
precision highp float;
precision highp sampler2DArray;
in vec2 v_uv;
out vec4 outColor;

uniform sampler2DArray u_tiles;
uniform sampler2D u_columns;
uniform sampler2D u_columnsSeg;
uniform sampler2D u_columnsCap;
uniform sampler2D u_columnsCell;
uniform sampler2D u_columnsEmissive;
uniform sampler2D u_sceneTiles;
uniform sampler2D u_sceneRefl;
uniform sampler2D u_sceneEmissiveFloor;
uniform sampler2D u_sceneEmissiveCeil;
// Split lightmap (Phase 4 fix): floor + ceiling get their own baked
// corner grids. Knee walls block light to floor corners at z=0 but
// not to ceiling corners at z=1 — sharing a single grid leaked floor
// shadows onto the ceiling.
uniform sampler2D u_lightmapFloor;
uniform sampler2D u_lightmapCeiling;
uniform vec2 u_resolution;
uniform vec2 u_sceneSize;
// K-factor of the baked lightmap (sub-samples per cell). Texture
// dimensions are (W*K+1)×(H*K+1); UV math below scales world coords
// by K so the texel-center math still nails each baked corner.
uniform float u_lightmapResolution;
uniform float u_fogInv;
uniform vec2 u_position;
uniform vec2 u_forward;
uniform vec2 u_right;
uniform float u_planeScale;
uniform float u_horizonOffset;
uniform float u_cameraZ;

// Tuning knobs (mirror of CONFIG.* on the CPU path).
uniform float u_wallAoBotDarken;
uniform float u_wallAoBotBand;
uniform float u_wallAoTopDarken;
uniform float u_wallAoTopBand;
uniform float u_floorAoBand;
uniform float u_floorAoDarken;
uniform float u_reflTileScale;
uniform float u_wallReflStrength;
uniform float u_wallReflBand;

// Solid color fallbacks for tile id 0 (no texture bound).
uniform vec3 u_fallbackFloor;
uniform vec3 u_fallbackCeiling;

#define MAX_LIGHTS 8
#define MAX_LOS_STEPS 16
// Dynamic lights — see MAX_DYNAMIC_LIGHTS_GL on the CPU side.
//   u_lightPos.xyz = world (x, y, z), .w = intensity.
//   u_lightCol.rgb = colour, .a = radius (tiles).
uniform int u_lightCount;
uniform vec4 u_lightPos[MAX_LIGHTS];
uniform vec4 u_lightCol[MAX_LIGHTS];

/* --- Helpers --------------------------------------------------------- */

bool inBounds(ivec2 c) {
  return c.x >= 0 && c.y >= 0
      && c.x < int(u_sceneSize.x) && c.y < int(u_sceneSize.y);
}

bool isFloorOccluderC(ivec2 c) {
  if (!inBounds(c)) return false;
  return texelFetch(u_sceneTiles, c, 0).r > 0.5;
}
bool isCeilingOccluderC(ivec2 c) {
  if (!inBounds(c)) return false;
  return texelFetch(u_sceneTiles, c, 0).a > 0.5;
}

vec3 sampleTile(int tile, vec2 uv) {
  return texture(u_tiles, vec3(uv, float(tile))).rgb;
}

// Wall AO multiplier as a function of screen y within the wall band.
float wallAo(float y, float wallTop, float wallHeight) {
  float aoBotStrength = 1.0 - u_wallAoBotDarken;
  float aoBotStart = wallTop + wallHeight * (1.0 - u_wallAoBotBand);
  float aoBotSpanInv = 1.0 / (wallHeight * u_wallAoBotBand);
  float botT = max(0.0, (y - aoBotStart) * aoBotSpanInv);

  float aoTopStrength = 1.0 - u_wallAoTopDarken;
  float aoTopEnd = wallTop + wallHeight * u_wallAoTopBand;
  float aoTopSpanInv = 1.0 / (wallHeight * u_wallAoTopBand);
  float topT = max(0.0, (aoTopEnd - y) * aoTopSpanInv);

  return (1.0 - aoBotStrength * botT * botT) * (1.0 - aoTopStrength * topT * topT);
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
#define LIGHT_JITTER_SAMPLES 3
const vec2 LIGHT_JITTER_OFFSETS[LIGHT_JITTER_SAMPLES] = vec2[](
  vec2(0.0, 0.0),
  vec2(0.05, 0.0),
  vec2(-0.05, 0.0)
);
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
    float t = 1.0 - dist / radius;
    acc += lc * (t * t * intensity * coverage);
  }
  return acc;
}

#define MAX_SLABS 4

void main() {
  // Canvas-style coords: x to the right, y down from top.
  float x = v_uv.x * u_resolution.x;
  float y = (1.0 - v_uv.y) * u_resolution.y;
  int colX = int(floor(x));
  // Eye height in [0,1] (0.5 = standing). Horizon line stays at canvas
  // center since the player looks level even when crouching; the pitch
  // offset is the only thing shifting it.
  float horizonY = u_resolution.y * 0.5 + u_horizonOffset;
  // Aspect-correct pixels-per-world-Z-unit at perpDist=1. Using
  // canvas WIDTH (combined with the horizontal FOV) keeps walls
  // looking like their world proportions regardless of window
  // aspect — resizing changes the visible vertical FOV instead of
  // squashing walls.
  float unitH = u_resolution.x / (2.0 * u_planeScale);
  // Ray direction for this column — shared by floor/ceiling, walls,
  // caps, and the lightmap world-position lookup so we don't recompute
  // it in every branch.
  float cameraXn = (2.0 * x / u_resolution.x) - 1.0;
  vec2 rayDir = u_forward + u_right * (u_planeScale * cameraXn);
  // Per-fragment world position used to look up the static lightmap at
  // the very end of main(). Updated below as we determine which surface
  // wins this pixel — floor/ceiling -> exact world hit; wall slab ->
  // cell centre; cap -> cap world hit. Defaults to the camera (sample
  // would be valid even if nothing paints over the sky).
  vec2 lightWorldPos = u_position;
  // Phase 4 split: ceiling and top-caps sample the ceiling lightmap;
  // everything else samples the floor lightmap. Default false (floor).
  bool useCeilingLightmap = false;

  // Nearest slab (index 0) feeds the floor/ceiling reflection mirror.
  // Subsequent slabs (1..MAX_SLABS-1) are walls behind the nearest one —
  // the loop further down handles their slab + cap rendering.
  vec4 col = texelFetch(u_columns, ivec2(colX, 0), 0);
  float perpDist = col.r;
  float wallU = col.g;
  float sideMul = col.b;
  int wallTile = int(col.a);
  bool hasWall = wallTile > 0;

  vec4 segCol = texelFetch(u_columnsSeg, ivec2(colX, 0), 0);
  float segStartZ = segCol.r;
  float segHeight = segCol.g;
  float segOffsetX = segCol.b;
  float segOffsetY = segCol.a;

  float wallTop = horizonY;
  float wallBottom = horizonY;
  float wallHeight = 0.0;
  if (hasWall) {
    float unitHeight = unitH / perpDist;
    wallHeight = segHeight * unitHeight;
    wallTop = horizonY - (segStartZ + segHeight - u_cameraZ) * unitHeight;
    wallBottom = horizonY - (segStartZ - u_cameraZ) * unitHeight;
  }

  bool inWallBand = hasWall && y >= wallTop && y < wallBottom;

  // Floor / ceiling color for this pixel — computed for every pixel,
  // including those inside the wall band, because the wall's reflective
  // edge blends *over* this color via alpha.
  vec3 fcColor = vec3(0.0);
  // Emissive add accumulator — Phase 4. Each surface branch writes its
  // own emissive contribution; the final pass adds it AFTER the
  // lightmap multiply so glowing surfaces are visible in darkness.
  vec3 emissiveAdd = vec3(0.0);
  // Emissive contribution from the floor/ceiling under THIS pixel
  // (when fcColor is what we end up rendering). Walls and caps
  // overwrite emissiveAdd further down.
  vec3 fcEmissive = vec3(0.0);
  float p = abs(y - horizonY);
  if (p >= 0.5) {
    bool isFloor = y > horizonY;
    // Floor and ceiling each scale by their own "eye → surface"
    // world distance: cameraZ for the floor, (1 - cameraZ) for the
    // ceiling. When standing they're equal (0.5 each) and the formula
    // matches the legacy posZ/p.
    float surfaceZ = isFloor ? u_cameraZ : (1.0 - u_cameraZ);
    float rowDistance = (surfaceZ * unitH) / p;
    vec2 worldPos = u_position + rowDistance * rayDir;
    ivec2 cellCoord = ivec2(floor(worldPos));
    vec2 frac = fract(worldPos);
    // Floor/ceiling pixel — exact world position drives the lightmap.
    // Pick the ceiling grid for the ceiling row (isFloor == false).
    lightWorldPos = worldPos;
    useCeilingLightmap = !isFloor;

    float fogMul = clamp(1.0 - rowDistance * u_fogInv, 0.0, 1.0);

    vec4 cellTiles = inBounds(cellCoord) ? texelFetch(u_sceneTiles, cellCoord, 0) : vec4(0.0);
    vec4 cellRefl = inBounds(cellCoord) ? texelFetch(u_sceneRefl, cellCoord, 0) : vec4(0.0);
    int floorTile = int(cellTiles.g);
    int ceilTile = int(cellTiles.b);

    vec3 floorColor = floorTile > 0
      ? sampleTile(floorTile, frac) * fogMul
      : u_fallbackFloor * fogMul;
    vec3 ceilColor = ceilTile > 0
      ? sampleTile(ceilTile, frac) * fogMul
      : u_fallbackCeiling * fogMul;

    float fRefl = effectiveReflectiveness(cellCoord, frac, cellRefl.r, cellRefl.g, 0);
    float cRefl = effectiveReflectiveness(cellCoord, frac, cellRefl.b, cellRefl.a, 2);

    if (isFloor && fRefl > 0.0) {
      vec3 refl;
      bool foundWallMirror = false;
      // Multi-slab mirror: a knee wall in front of a tall wall must
      // reflect BOTH. Walk every slab on this column, mirror y about
      // each slab's own bottom edge, and pick the NEAREST slab whose
      // wall band brackets the mirrored y. Re-shading via wallPixelAt
      // means each slab gets its own correct fog / sideMul / AO.
      float bestPerp = 1e20;
      for (int s = 0; s < MAX_SLABS; s++) {
        vec4 sCol = texelFetch(u_columns, ivec2(colX, s), 0);
        int sTile = int(sCol.a);
        if (sTile <= 0) continue;
        float sPerp = sCol.r;
        if (sPerp <= 0.0 || sPerp >= bestPerp) continue;
        vec4 sSeg = texelFetch(u_columnsSeg, ivec2(colX, s), 0);
        float sStartZ = sSeg.r;
        float sHeight = sSeg.g;
        float sOffX = sSeg.b;
        float sOffY = sSeg.a;
        float sUnitH = unitH / sPerp;
        float sSlabH = sHeight * sUnitH;
        float sTop = horizonY - (sStartZ + sHeight - u_cameraZ) * sUnitH;
        float sBot = horizonY - (sStartZ - u_cameraZ) * sUnitH;
        float mirror = 2.0 * sBot - y;
        if (mirror >= sTop && mirror < sBot) {
          float sWallU = sCol.g;
          float sSide = sCol.b;
          refl = wallPixelAt(mirror, sTop, sSlabH, sTile, sWallU, sSide, sPerp, sOffX, sOffY);
          foundWallMirror = true;
          bestPerp = sPerp;
        }
      }
      if (!foundWallMirror) {
        if (ceilTile > 0) {
          vec2 tiledUv = fract(frac * u_reflTileScale);
          refl = sampleTile(ceilTile, tiledUv) * fogMul;
        } else {
          refl = ceilColor;
        }
      }
      floorColor = mix(floorColor, refl, fRefl);
    }
    if (!isFloor && cRefl > 0.0) {
      vec3 refl;
      bool foundWallMirror = false;
      // Symmetric multi-slab pick — each slab mirrors the ceiling pixel
      // about its OWN top edge. Nearest matching slab wins.
      float bestPerp = 1e20;
      for (int s = 0; s < MAX_SLABS; s++) {
        vec4 sCol = texelFetch(u_columns, ivec2(colX, s), 0);
        int sTile = int(sCol.a);
        if (sTile <= 0) continue;
        float sPerp = sCol.r;
        if (sPerp <= 0.0 || sPerp >= bestPerp) continue;
        vec4 sSeg = texelFetch(u_columnsSeg, ivec2(colX, s), 0);
        float sStartZ = sSeg.r;
        float sHeight = sSeg.g;
        float sOffX = sSeg.b;
        float sOffY = sSeg.a;
        float sUnitH = unitH / sPerp;
        float sSlabH = sHeight * sUnitH;
        float sTop = horizonY - (sStartZ + sHeight - u_cameraZ) * sUnitH;
        float sBot = horizonY - (sStartZ - u_cameraZ) * sUnitH;
        float mirror = 2.0 * sTop - y;
        if (mirror >= sTop && mirror < sBot) {
          float sWallU = sCol.g;
          float sSide = sCol.b;
          refl = wallPixelAt(mirror, sTop, sSlabH, sTile, sWallU, sSide, sPerp, sOffX, sOffY);
          foundWallMirror = true;
          bestPerp = sPerp;
        }
      }
      if (!foundWallMirror) {
        if (floorTile > 0) {
          vec2 tiledUv = fract(frac * u_reflTileScale);
          refl = sampleTile(floorTile, tiledUv) * fogMul;
        } else {
          refl = floorColor;
        }
      }
      ceilColor = mix(ceilColor, refl, cRefl);
    }

    // Surface-specific AO: floor pass uses floor-occluder neighbours
    // (knee walls qualify), ceiling pass uses ceiling-occluder
    // neighbours (hanging headers qualify).
    float aoMul = surfaceAo(cellCoord, frac, !isFloor);
    fcColor = (isFloor ? floorColor : ceilColor) * aoMul;

    // Per-cell emissive — RGB pre-packed as color*intensity on the
    // CPU. The texture is RGBA32F with alpha unused; we only read .rgb.
    if (inBounds(cellCoord)) {
      vec4 emFloor = texelFetch(u_sceneEmissiveFloor, cellCoord, 0);
      vec4 emCeil = texelFetch(u_sceneEmissiveCeil, cellCoord, 0);
      fcEmissive = isFloor ? emFloor.rgb : emCeil.rgb;
    }
  }
  emissiveAdd = fcEmissive;

  // ── Multi-slab pass: walk every wall hit on this column from
  // FARTHEST to nearest, overwriting with slab front face or cap
  // surface where this pixel lies in their respective screen-y
  // zones. Iterating back-to-front means a nearer slab naturally
  // clobbers a farther one in overlapping pixels. Only the nearest
  // slab gets the reflective-wall fade.
  vec3 surfaceColor = fcColor;
  for (int s = MAX_SLABS - 1; s >= 0; s--) {
    vec4 sCol = texelFetch(u_columns, ivec2(colX, s), 0);
    int sTile = int(sCol.a);
    if (sTile <= 0) continue;
    vec4 sSeg = texelFetch(u_columnsSeg, ivec2(colX, s), 0);
    vec4 sCap = texelFetch(u_columnsCap, ivec2(colX, s), 0);
    vec4 sEm = texelFetch(u_columnsEmissive, ivec2(colX, s), 0);
    float sPerp = sCol.r;
    float sWallU = sCol.g;
    float sSide = sCol.b;
    float sStartZ = sSeg.r;
    float sHeight = sSeg.g;
    float sOffX = sSeg.b;
    float sOffY = sSeg.a;
    float sBack = sCap.r;
    int sTopTile = int(sCap.g);
    int sBotTile = int(sCap.b);

    float sUnitH = unitH / sPerp;
    float sSlabH = sHeight * sUnitH;
    float sTop = horizonY - (sStartZ + sHeight - u_cameraZ) * sUnitH;
    float sBot = horizonY - (sStartZ - u_cameraZ) * sUnitH;

    if (y >= sTop && y < sBot) {
      vec3 wColor = wallPixelAt(y, sTop, sSlabH, sTile, sWallU, sSide, sPerp, sOffX, sOffY);
      if (s == 0) {
        // Reflective wall fade at top/bottom of the nearest slab.
        float reflBandSpan = sSlabH * u_wallReflBand;
        float reflBandSpanInv = 1.0 / reflBandSpan;
        float topReflT = max(0.0, (sTop + reflBandSpan - y) * reflBandSpanInv);
        float botReflT = max(0.0, (y - (sBot - reflBandSpan)) * reflBandSpanInv);
        float fadeT = max(topReflT, botReflT);
        float reflFade = u_wallReflStrength * fadeT * fadeT;
        surfaceColor = mix(wColor, fcColor, reflFade);
      } else {
        surfaceColor = wColor;
      }
      // Wall pixel: sample the lightmap at the hit cell's centre. The
      // CPU-side DDA already knows the exact cell, so we read it from
      // u_columnsCell rather than re-deriving from the (non-normalised)
      // ray — the ray-based derivation could grab the OPEN neighbour
      // cell for grazing-angle columns, producing a sliding dark band.
      vec4 sCell = texelFetch(u_columnsCell, ivec2(colX, s), 0);
      lightWorldPos = sCell.xy;
      emissiveAdd = sEm.rgb;
      continue;
    }

    // Cap test: top cap (visible looking down on a slab whose top is
    // below the eye), then bottom cap (looking up at a slab whose
    // bottom is above the eye).
    float topZ = sStartZ + sHeight;
    float bottomZ = sStartZ;
    if (sTopTile > 0 && topZ < 1.0 && u_cameraZ > topZ) {
      float dz = u_cameraZ - topZ;
      float yFrontT = horizonY + dz * unitH / sPerp;
      float yBackT = horizonY + dz * unitH / sBack;
      if (y >= yBackT && y < yFrontT) {
        float pCap = y - horizonY;
        if (abs(pCap) >= 0.5) {
          float dCap = dz * unitH / pCap;
          if (dCap > 0.0) {
            vec2 capWorld = u_position + dCap * rayDir;
            vec3 capColor = sampleTile(sTopTile, fract(capWorld));
            float capFog = clamp(1.0 - dCap * u_fogInv, 0.0, 1.0);
            surfaceColor = capColor * capFog;
            lightWorldPos = capWorld;
            // Top cap = looking down on the wall's upper face (a knee
            // wall's parapet, etc.). Cap sits at z = startZ + height;
            // sample the CEILING grid because that's the side the cap
            // surface looks toward.
            useCeilingLightmap = true;
            emissiveAdd = sEm.rgb;
            continue;
          }
        }
      }
    }
    if (sBotTile > 0 && bottomZ > 0.0 && u_cameraZ < bottomZ) {
      float dz = u_cameraZ - bottomZ; // negative
      float yFrontB = horizonY + dz * unitH / sPerp;
      float yBackB = horizonY + dz * unitH / sBack;
      if (y >= yFrontB && y < yBackB) {
        float pCap = y - horizonY;
        if (abs(pCap) >= 0.5) {
          float dCap = dz * unitH / pCap;
          if (dCap > 0.0) {
            vec2 capWorld = u_position + dCap * rayDir;
            vec3 capColor = sampleTile(sBotTile, fract(capWorld));
            float capFog = clamp(1.0 - dCap * u_fogInv, 0.0, 1.0);
            surfaceColor = capColor * capFog;
            lightWorldPos = capWorld;
            emissiveAdd = sEm.rgb;
          }
        }
      }
    }
  }

  // Static lightmap multiply — corner grid is (W*K+1)×(H*K+1), so
  // corner i lives at texel center (i+0.5)/(W*K+1) in UV space.
  // Bilinear filtering gives us the bilinear interpolation between
  // the 4 surrounding corners for free. Phase 4: floor + ceiling each
  // ship their own grid; the per-branch boolean above picks which one
  // this fragment samples. K (sub-samples per cell) sharpens shadow
  // edges; legacy K=1 bakes degenerate to the original layout.
  float lmK = u_lightmapResolution;
  vec2 lightUV = vec2((lightWorldPos.x * lmK + 0.5) / (u_sceneSize.x * lmK + 1.0),
                      (lightWorldPos.y * lmK + 0.5) / (u_sceneSize.y * lmK + 1.0));
  vec3 staticLight = useCeilingLightmap
    ? texture(u_lightmapCeiling, lightUV).rgb
    : texture(u_lightmapFloor, lightUV).rgb;
  // Phase 5 dynamic-light add — sampled at the same world point the
  // static lightmap uses for this surface (floor/ceiling = exact hit,
  // wall = cell centre, cap = cap hit). Folded into the lightmap
  // multiplier so the dynamic contribution and the static one both
  // modulate the surface albedo together.
  vec3 dynamicLight = accumulateDynamicLight(lightWorldPos);
  // Phase 4: emissive add lands AFTER the lightmap multiply so a
  // glowing surface stays bright in pitch darkness.
  outColor = vec4(surfaceColor * (staticLight + dynamicLight) + emissiveAdd, 1.0);
}
`;

/* --- WebGL helpers ----------------------------------------------------- */

function compileShader(gl: WebGL2RenderingContext, type: GLenum, source: string): WebGLShader {
  const shader = gl.createShader(type);
  if (!shader) throw new Error("Failed to create shader");
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader) ?? "(no log)";
    gl.deleteShader(shader);
    throw new Error(`Shader compile failed: ${log}\n--- source ---\n${source}`);
  }
  return shader;
}

function buildProgram(gl: WebGL2RenderingContext, vertSrc: string, fragSrc: string): WebGLProgram {
  const program = gl.createProgram();
  if (!program) throw new Error("Failed to create program");
  const vs = compileShader(gl, gl.VERTEX_SHADER, vertSrc);
  const fs = compileShader(gl, gl.FRAGMENT_SHADER, fragSrc);
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(program) ?? "(no log)";
    gl.deleteProgram(program);
    throw new Error(`Program link failed: ${log}`);
  }
  return program;
}

/** Upscale (or downscale) a Texture to `(w, h)` using canvas resampling. */
function resizeTexture(src: Texture, w: number, h: number): Uint8ClampedArray {
  if (src.width === w && src.height === h) return src.data;
  const sourceCanvas = new OffscreenCanvas(src.width, src.height);
  const sourceCtx = sourceCanvas.getContext("2d")!;
  const imageData = new ImageData(new Uint8ClampedArray(src.data), src.width, src.height);
  sourceCtx.putImageData(imageData, 0, 0);
  const destCanvas = new OffscreenCanvas(w, h);
  const destCtx = destCanvas.getContext("2d")!;
  destCtx.drawImage(sourceCanvas, 0, 0, w, h);
  return destCtx.getImageData(0, 0, w, h).data;
}

/* --- WebGLRenderer ----------------------------------------------------- */

/**
 * GPU-backed `SceneRenderer`. CPU runs DDA per column (small, bounded
 * work); fragment shader does every per-pixel detail — wall texturing,
 * floor/ceiling raymarching, side darken, distance fog, top/bottom AO
 * bands, world-space AO at cell-type boundaries, wall-mirror reflection,
 * tiled cross-reflection, and reflectiveness transition with bilinear
 * neighbor blending.
 *
 * Tile textures are packed into a TEXTURE_2D_ARRAY (46 layers, all
 * 256×256). Tile id = layer index — sheet tiles at ids 10..45 are
 * upscaled from their source resolution to fit.
 *
 * The scene grid is uploaded as two RGBA32F textures (tile ids +
 * reflectiveness/transition) so the shader can do neighbor lookups
 * cheaply via `texelFetch`.
 *
 * HUD layers (gun, minimap, stats, reticle) draw on a separate stacked
 * Canvas-2D element overlaid via CSS — a single canvas can only have
 * one context type.
 */
export class WebGLRenderer implements SceneRenderer {
  readonly canvas: HTMLCanvasElement;
  readonly ctx: CanvasRenderingContext2D;
  readonly assetsReady: Promise<void>;

  private readonly gl: WebGL2RenderingContext;
  private readonly hudCanvas: HTMLCanvasElement;

  private readonly skyProgram: WebGLProgram;
  private readonly skyTopLoc: WebGLUniformLocation;
  private readonly skyBottomLoc: WebGLUniformLocation;

  private readonly worldProgram: WebGLProgram;
  private readonly u: Record<string, WebGLUniformLocation | null>;

  private readonly quadVAO: WebGLVertexArrayObject;

  private readonly tilesTex: WebGLTexture;
  private readonly columnsTex: WebGLTexture;
  private readonly columnsSegTex: WebGLTexture;
  private readonly columnsCapTex: WebGLTexture;
  /**
   * Per-column slab wall-cell centre (RGBA32F). Channels packed
   * `(cellCenterX, cellCenterY, 0, 0)` with the +0.5 already baked in
   * on the CPU. Exists so the wall lightmap lookup uses the exact DDA
   * hit cell rather than re-deriving from the unnormalised ray (which
   * produces a sliding vertical dark band on grazing columns).
   */
  private readonly columnsCellTex: WebGLTexture;
  /**
   * Per-column slab emissive (RGBA32F). Channels packed `(emR×emI,
   * emG×emI, emB×emI, _)`. Empty slabs and non-emissive segments are
   * all-zero so the shader's `emissiveAdd = sEm.rgb` is a no-op for
   * everything that isn't a glowing wall. Phase 4 — see
   * LIGHTING_OVERHAUL.md § 3.2 / § 4.3.
   */
  private readonly columnsEmissiveTex: WebGLTexture;
  private readonly sceneTilesTex: WebGLTexture;
  private readonly sceneReflTex: WebGLTexture;
  /**
   * Per-cell floor / ceiling emissive (RGBA32F each). RGB is the
   * pre-multiplied `color × intensity`; alpha is unused. Static
   * across the scene's lifetime so we upload once on scene swap and
   * the shader pays nothing per frame.
   */
  private readonly sceneEmissiveFloorTex: WebGLTexture;
  private readonly sceneEmissiveCeilTex: WebGLTexture;
  private readonly sceneLightmapFloorTex: WebGLTexture;
  private readonly sceneLightmapCeilingTex: WebGLTexture;

  private columnsData: Float32Array;
  private columnsSegData: Float32Array;
  private columnsCapData: Float32Array;
  private columnsCellData: Float32Array;
  private columnsEmissiveData: Float32Array;
  private columnsWidth: number;
  private uploadedSceneKey: string = "";
  /**
   * Identity of the last-uploaded lightmap buffer. Same-dimension scene swaps
   * (Phase 2 hot-reload, scene transitions) reuse `uploadedSceneKey`, so we
   * track the buffer reference separately and re-upload when it changes.
   * Pattern can be extended to the tile / refl buffers if those ever mutate
   * without a dimension change.
   */
  /**
   * Cached `cornerRGB` references — one per surface. If EITHER changes
   * (typical: a re-bake produced a fresh pair), both textures
   * re-upload so we don't desync. Tracked by reference because a same-
   * dimensioned scene swap can carry different lightmap contents.
   */
  private uploadedFloorLightmapBuffer: Float32Array | null = null;
  private uploadedCeilingLightmapBuffer: Float32Array | null = null;
  /**
   * K-factor of the most-recently-uploaded lightmap. Tracked so a
   * scene swap to a bake with a different K re-uploads even if the
   * buffer reference happens to match (defence-in-depth — buffers
   * are freshly allocated per bake in practice). Also used to set
   * the `u_lightmapResolution` uniform every frame.
   */
  private uploadedLightmapResolution: number = 1;
  /** Cached scene size — used by the sprite pass for lightmap UV math. */
  private uploadedSceneW: number = 1;
  private uploadedSceneH: number = 1;

  // ── Sprite pass state ──────────────────────────────────────────────────
  private readonly spriteProgram: WebGLProgram;
  private readonly spriteVAO: WebGLVertexArrayObject;
  private readonly spriteVBO: WebGLBuffer;
  private readonly spritesTex: WebGLTexture;
  /** Sprite id → atlas layer. Assigned in insertion order at boot. */
  private readonly spriteLayers: Map<string, number> = new Map();
  /** Set of sprite ids we've warned about (unknown / unloaded), one log each. */
  private readonly warnedSpriteIds: Set<string> = new Set();
  /** CPU-side scratch VBO; one quad = 6 verts × 8 floats (pos2, uv2, layer, camY, worldPos2). */
  private readonly spriteVertexData: Float32Array = new Float32Array(MAX_SPRITES_PER_FRAME * 6 * 8);
  private readonly spriteUniforms: Record<string, WebGLUniformLocation | null>;
  /** Diagnostic: log sprite-pass stats once per session, then never again. */
  private spriteDiagLogged: boolean = false;

  // ── Dynamic lights ─────────────────────────────────────────────────────
  /**
   * Packed `(x, y, z, intensity)` per dynamic light, MAX_DYNAMIC_LIGHTS_GL
   * entries. Re-filled in `setDynamicLights` and uploaded as a `vec4[]`
   * uniform in `drawWorld` / `drawSprites`. Phase 5 of the lighting
   * overhaul — see LIGHTING_OVERHAUL.md § 5.3 / § 6.
   */
  private readonly dynamicLightPos: Float32Array = new Float32Array(MAX_DYNAMIC_LIGHTS_GL * 4);
  /** Packed `(r, g, b, radius)` per dynamic light. */
  private readonly dynamicLightCol: Float32Array = new Float32Array(MAX_DYNAMIC_LIGHTS_GL * 4);
  /** How many of the slots above are populated this frame. `0` means "no dynamic lights". */
  private dynamicLightCount: number = 0;

  /**
   * Resolve every role's fragment source for a given pack, applying
   * any `manifest.shaders` overrides. Async because pack-shipped
   * shader bodies are read via `pack.textBody()`. The result is
   * passed into the `WebGLRenderer` constructor via `shaderSources`,
   * which can then run synchronously.
   *
   * Roles the pack doesn't override are returned as the engine's
   * built-in default source. Phase S1 — single pack, no chain.
   */
  static async prefetchShaderSources(
    pack: AssetPack,
  ): Promise<Partial<Record<ShaderRole, string>>> {
    const out: Partial<Record<ShaderRole, string>> = {};
    const defaults: Record<ShaderRole, string> = {
      skyFrag: FRAG_SKY_SRC,
      worldFrag: FRAG_WORLD_SRC,
      spriteFrag: FRAG_SPRITE_SRC,
    };
    for (const role of SHADER_ROLES) {
      out[role] = await getShaderSource(role, pack, defaults[role]);
    }
    return out;
  }

  constructor({
    canvas,
    pack,
    width = canvas.clientWidth,
    height = canvas.clientHeight,
    shaderSources,
  }: WebGLRendererProps) {
    canvas.width = width;
    canvas.height = height;
    this.canvas = canvas;

    const gl = canvas.getContext("webgl2", { antialias: false, preserveDrawingBuffer: false });
    if (!gl) throw new Error("WebGL2 not supported in this browser");
    this.gl = gl;
    if (!gl.getExtension("EXT_color_buffer_float")) {
      console.warn("EXT_color_buffer_float not available — float textures may misbehave");
    }
    if (!gl.getExtension("OES_texture_float_linear")) {
      console.warn(
        "OES_texture_float_linear not available — float textures with LINEAR filtering will be sampler-incomplete",
      );
    }

    // ── HUD canvas overlay ─────────────────────────────────────────────
    // Mark with a data attribute so HMR can find+remove the previous
    // renderer's HUD canvas before appending the new one. Without this,
    // every module reload stacks another canvas (with its last frame
    // frozen) on top of the live one.
    const HUD_ATTR = "data-engine-hud";
    document.querySelectorAll(`[${HUD_ATTR}]`).forEach((stale) => stale.remove());
    const hudCanvas = document.createElement("canvas");
    hudCanvas.setAttribute(HUD_ATTR, "true");
    hudCanvas.width = width;
    hudCanvas.height = height;
    hudCanvas.style.position = "fixed";
    hudCanvas.style.pointerEvents = "none";
    hudCanvas.style.zIndex = "10";
    document.body.appendChild(hudCanvas);
    this.hudCanvas = hudCanvas;
    const hudCtx = hudCanvas.getContext("2d");
    if (!hudCtx) throw new Error("Failed to acquire HUD canvas 2D context");
    this.ctx = hudCtx;

    // ── Programs ───────────────────────────────────────────────────────
    // Per-role fragment source: pack override (when provided via
    // `prefetchShaderSources`) wins over the engine default. The
    // engine defaults (`FRAG_*_SRC`) are full source strings and ship
    // byte-identical to pre-S1 builds when no pack override exists.
    const fragSky = shaderSources?.skyFrag ?? FRAG_SKY_SRC;
    const fragWorld = shaderSources?.worldFrag ?? FRAG_WORLD_SRC;
    const fragSprite = shaderSources?.spriteFrag ?? FRAG_SPRITE_SRC;

    this.skyProgram = buildProgram(gl, VERT_SRC, fragSky);
    this.skyTopLoc = gl.getUniformLocation(this.skyProgram, "u_top")!;
    this.skyBottomLoc = gl.getUniformLocation(this.skyProgram, "u_bottom")!;

    this.worldProgram = buildProgram(gl, VERT_SRC, fragWorld);
    // Pack-supplied shaders may not reference every engine uniform; GLSL
    // strips unused ones. Tolerate optimized-out uniforms when the shader
    // came from a pack (gl.uniform* is a silent no-op on null locations).
    // Engine-default shaders still hard-throw — a missing uniform there
    // means the shader source drifted from this lookup table.
    const isPackWorldFrag = shaderSources?.worldFrag !== undefined;
    const ul = (name: string): WebGLUniformLocation | null => {
      const loc = gl.getUniformLocation(this.worldProgram, name);
      if (loc === null) {
        if (isPackWorldFrag) {
          console.warn(`[cardboard] pack worldFrag does not reference ${name}; uniform set calls will no-op`);
          return null;
        }
        throw new Error(`Uniform ${name} not found (optimized out?)`);
      }
      return loc;
    };
    this.u = {
      tiles: ul("u_tiles"),
      columns: ul("u_columns"),
      columnsSeg: ul("u_columnsSeg"),
      columnsCap: ul("u_columnsCap"),
      columnsCell: ul("u_columnsCell"),
      columnsEmissive: ul("u_columnsEmissive"),
      sceneTiles: ul("u_sceneTiles"),
      sceneRefl: ul("u_sceneRefl"),
      sceneEmissiveFloor: ul("u_sceneEmissiveFloor"),
      sceneEmissiveCeil: ul("u_sceneEmissiveCeil"),
      lightmapFloor: ul("u_lightmapFloor"),
      lightmapCeiling: ul("u_lightmapCeiling"),
      lightmapResolution: ul("u_lightmapResolution"),
      resolution: ul("u_resolution"),
      sceneSize: ul("u_sceneSize"),
      fogInv: ul("u_fogInv"),
      position: ul("u_position"),
      forward: ul("u_forward"),
      right: ul("u_right"),
      planeScale: ul("u_planeScale"),
      horizonOffset: ul("u_horizonOffset"),
      cameraZ: ul("u_cameraZ"),
      wallAoBotDarken: ul("u_wallAoBotDarken"),
      wallAoBotBand: ul("u_wallAoBotBand"),
      wallAoTopDarken: ul("u_wallAoTopDarken"),
      wallAoTopBand: ul("u_wallAoTopBand"),
      floorAoBand: ul("u_floorAoBand"),
      floorAoDarken: ul("u_floorAoDarken"),
      reflTileScale: ul("u_reflTileScale"),
      wallReflStrength: ul("u_wallReflStrength"),
      wallReflBand: ul("u_wallReflBand"),
      fallbackFloor: ul("u_fallbackFloor"),
      fallbackCeiling: ul("u_fallbackCeiling"),
      lightCount: ul("u_lightCount"),
      lightPos: ul("u_lightPos[0]"),
      lightCol: ul("u_lightCol[0]"),
    };

    // ── Fullscreen quad VAO ────────────────────────────────────────────
    const quad = new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]);
    const vao = gl.createVertexArray();
    if (!vao) throw new Error("Failed to create VAO");
    gl.bindVertexArray(vao);
    const vbo = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.bufferData(gl.ARRAY_BUFFER, quad, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);
    this.quadVAO = vao;

    // ── Tile texture array ─────────────────────────────────────────────
    // Pulled from the pack manifest. Each layer fills in as its source
    // finishes loading; until then the renderer samples the pink default
    // (set by `makeTileArray`). All load promises feed `assetsReady` so
    // the boot overlay can wait for them.
    const pending: Promise<unknown>[] = [];
    this.tilesTex = this.makeTileArray();
    for (const tileStr in pack.manifest.tileTextures) {
      const tile = Number(tileStr);
      const path = pack.manifest.tileTextures[tile]!;
      pending.push(
        pack
          .textureBlob(path)
          .then((blob) => Texture.loadFromBlob(blob))
          .then((t) => this.uploadTileLayer(tile, t))
          .catch((err) => console.warn(`Tile ${tile} (${path}) failed:`, err)),
      );
    }
    for (const sheet of pack.manifest.tileSheets) {
      pending.push(
        pack
          .textureBlob(sheet.path)
          .then((blob) => Texture.loadFromBlob(blob))
          .then((image) => this.registerSheet(image, sheet))
          .catch((err) => console.warn(`Sheet ${sheet.path} failed:`, err)),
      );
    }

    // ── Per-column data textures ───────────────────────────────────────
    // All three are 2D textures of shape (W, MAX_SLABS_PER_COLUMN).
    // Slab 0 is the nearest wall; slab N is farther. Empty slots have
    // wallTile=0 so the shader's loop can skip them.
    //   columnsTex   : (perpDist, wallU, sideMul, wallTile)
    //   columnsSegTex: (startZ, height, offsetX_normalised, offsetY_normalised)
    //   columnsCapTex: (perpDistBack, topTile, bottomTile, _)
    // Offsets are normalised by TILE_RESOLUTION on the CPU so they
    // slide a [0,1] UV directly.
    this.columnsWidth = width;
    const colTexSize = width * MAX_SLABS_PER_COLUMN * 4;
    this.columnsData = new Float32Array(colTexSize);
    this.columnsSegData = new Float32Array(colTexSize);
    this.columnsCapData = new Float32Array(colTexSize);
    this.columnsCellData = new Float32Array(colTexSize);
    this.columnsEmissiveData = new Float32Array(colTexSize);
    this.columnsTex = this.makeFloatTexture(width, MAX_SLABS_PER_COLUMN, this.columnsData);
    this.columnsSegTex = this.makeFloatTexture(width, MAX_SLABS_PER_COLUMN, this.columnsSegData);
    this.columnsCapTex = this.makeFloatTexture(width, MAX_SLABS_PER_COLUMN, this.columnsCapData);
    this.columnsCellTex = this.makeFloatTexture(width, MAX_SLABS_PER_COLUMN, this.columnsCellData);
    this.columnsEmissiveTex = this.makeFloatTexture(
      width,
      MAX_SLABS_PER_COLUMN,
      this.columnsEmissiveData,
    );

    // ── Sprite program + VAO + atlas ───────────────────────────────────
    this.spriteProgram = buildProgram(gl, VERT_SPRITE_SRC, fragSprite);
    const isPackSpriteFrag = shaderSources?.spriteFrag !== undefined;
    const sul = (name: string): WebGLUniformLocation | null => {
      const loc = gl.getUniformLocation(this.spriteProgram, name);
      if (loc === null) {
        if (isPackSpriteFrag) {
          console.warn(`[cardboard] pack spriteFrag does not reference ${name}; uniform set calls will no-op`);
          return null;
        }
        throw new Error(`Sprite uniform ${name} not found`);
      }
      return loc;
    };
    this.spriteUniforms = {
      sprites: sul("u_sprites"),
      columns: sul("u_columns"),
      columnsSeg: sul("u_columnsSeg"),
      lightmapFloor: sul("u_lightmapFloor"),
      lightmapResolution: sul("u_lightmapResolution"),
      sceneTiles: sul("u_sceneTiles"),
      resolution: sul("u_resolution"),
      sceneSize: sul("u_sceneSize"),
      horizonOffset: sul("u_horizonOffset"),
      cameraZ: sul("u_cameraZ"),
      planeScale: sul("u_planeScale"),
      fogInv: sul("u_fogInv"),
      lightCount: sul("u_lightCount"),
      lightPos: sul("u_lightPos[0]"),
      lightCol: sul("u_lightCol[0]"),
    };

    // Sprite VAO — per-vertex layout is [posX, posY, u, v, layer, camY, worldX, worldY].
    const svao = gl.createVertexArray();
    if (!svao) throw new Error("Failed to create sprite VAO");
    gl.bindVertexArray(svao);
    const svbo = gl.createBuffer();
    if (!svbo) throw new Error("Failed to create sprite VBO");
    gl.bindBuffer(gl.ARRAY_BUFFER, svbo);
    gl.bufferData(gl.ARRAY_BUFFER, this.spriteVertexData.byteLength, gl.DYNAMIC_DRAW);
    const stride = 8 * 4; // 8 floats × 4 bytes
    // Bind attribute locations by index; the vertex shader uses
    // `layout`-less `in`s so we set them via getAttribLocation.
    const posLoc = gl.getAttribLocation(this.spriteProgram, "a_position");
    const uvLoc = gl.getAttribLocation(this.spriteProgram, "a_uv");
    const layerLoc = gl.getAttribLocation(this.spriteProgram, "a_layer");
    const camYLoc = gl.getAttribLocation(this.spriteProgram, "a_camY");
    const worldLoc = gl.getAttribLocation(this.spriteProgram, "a_worldPos");
    gl.enableVertexAttribArray(posLoc);
    gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, stride, 0);
    gl.enableVertexAttribArray(uvLoc);
    gl.vertexAttribPointer(uvLoc, 2, gl.FLOAT, false, stride, 2 * 4);
    gl.enableVertexAttribArray(layerLoc);
    gl.vertexAttribPointer(layerLoc, 1, gl.FLOAT, false, stride, 4 * 4);
    gl.enableVertexAttribArray(camYLoc);
    gl.vertexAttribPointer(camYLoc, 1, gl.FLOAT, false, stride, 5 * 4);
    gl.enableVertexAttribArray(worldLoc);
    gl.vertexAttribPointer(worldLoc, 2, gl.FLOAT, false, stride, 6 * 4);
    gl.bindVertexArray(null);
    this.spriteVAO = svao;
    this.spriteVBO = svbo;

    // Sprite atlas — assign one layer per manifest entry, in iteration
    // order. Layers fill in async (and at most `SPRITE_LAYERS` of them).
    this.spritesTex = this.makeSpriteArray();
    const sprites = pack.manifest.sprites ?? {};
    let nextLayer = 0;
    for (const [id, def] of Object.entries(sprites)) {
      if (nextLayer >= SPRITE_LAYERS) {
        console.warn(`Sprite "${id}" dropped — atlas full (${SPRITE_LAYERS} layers)`);
        break;
      }
      const layer = nextLayer++;
      this.spriteLayers.set(id, layer);
      pending.push(
        pack
          .textureBlob(def.image)
          .then((blob) => Texture.loadFromBlob(blob))
          .then((t) => this.uploadSpriteLayer(layer, t))
          .catch((err) => console.warn(`Sprite ${id} (${def.image}) failed:`, err)),
      );
    }
    this.assetsReady = Promise.all(pending).then(() => undefined);

    // ── Scene data textures (allocated lazily on first drawWorld) ─────
    this.sceneTilesTex = gl.createTexture()!;
    this.sceneReflTex = gl.createTexture()!;
    this.sceneEmissiveFloorTex = gl.createTexture()!;
    this.sceneEmissiveCeilTex = gl.createTexture()!;
    for (const tex of [
      this.sceneTilesTex,
      this.sceneReflTex,
      this.sceneEmissiveFloorTex,
      this.sceneEmissiveCeilTex,
    ]) {
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    }
    // Seed the emissive textures with a 1×1 zero pixel so they're
    // sampler-complete from construction. `ensureSceneUploaded` will
    // resize-and-fill them on first draw.
    for (const tex of [this.sceneEmissiveFloorTex, this.sceneEmissiveCeilTex]) {
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texImage2D(
        gl.TEXTURE_2D,
        0,
        gl.RGBA32F,
        1,
        1,
        0,
        gl.RGBA,
        gl.FLOAT,
        new Float32Array([0, 0, 0, 0]),
      );
    }
    // Lightmap — LINEAR sampling so hardware gives us bilinear blend
    // between the 4 surrounding corners for free.
    // Seed with a 1×1 RGBA32F (1,1,1,1) texel so the texture is
    // sampler-complete from construction onward. This protects passes that
    // sample the lightmap before `drawWorld` has run (e.g. the sprite pass
    // in fixtures or hot-reload edge cases) — any pre-upload sample falls
    // through harmlessly to a uniform 1.0 multiplier. The first
    // `ensureSceneUploaded` overwrites it with the real lightmap.
    // Phase 4: floor + ceiling each get their own lightmap texture.
    // Both seeded with a 1×1 (1,1,1,1) texel so they're sampler-complete
    // before the first `ensureSceneUploaded` upload — pre-`drawWorld`
    // samples (e.g. sprite pass in fixtures) fall through to a uniform
    // 1.0 multiplier instead of a black-texture surprise.
    const makeLightmapTex = (): WebGLTexture => {
      const tex = gl.createTexture()!;
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texImage2D(
        gl.TEXTURE_2D,
        0,
        gl.RGBA32F,
        1,
        1,
        0,
        gl.RGBA,
        gl.FLOAT,
        new Float32Array([1, 1, 1, 1]),
      );
      return tex;
    };
    this.sceneLightmapFloorTex = makeLightmapTex();
    this.sceneLightmapCeilingTex = makeLightmapTex();

    gl.viewport(0, 0, width, height);
    this.syncHud();
    window.addEventListener("resize", this.syncHud);
  }

  /* --- SceneRenderer interface ---------------------------------------- */

  beginFrame(): void {
    this.syncHud();
    this.ctx.clearRect(0, 0, this.hudCanvas.width, this.hudCanvas.height);
  }

  /**
   * Stash the per-frame dynamic light list, capped at
   * `MAX_DYNAMIC_LIGHTS_GL`. The packed `Float32Array(MAX*4)` buffers
   * are uploaded as `vec4[]` uniforms inside `drawWorld` /
   * `drawSprites`, so callers must invoke this BEFORE either pass.
   * Excess lights past the cap are silently dropped — see § 5.3 of
   * LIGHTING_OVERHAUL.md for the model.
   */
  setDynamicLights(lights: ReadonlyArray<LightInstance>): void {
    const n = Math.min(lights.length, MAX_DYNAMIC_LIGHTS_GL);
    this.dynamicLightCount = n;
    const pos = this.dynamicLightPos;
    const col = this.dynamicLightCol;
    for (let i = 0; i < n; i++) {
      const L = lights[i]!;
      const o = i * 4;
      pos[o] = L.x;
      pos[o + 1] = L.y;
      pos[o + 2] = L.z;
      pos[o + 3] = L.intensity;
      col[o] = L.color[0];
      col[o + 1] = L.color[1];
      col[o + 2] = L.color[2];
      col[o + 3] = L.radius;
    }
    // Zero the trailing slots so a frame that drops from N to M < N
    // lights doesn't leak stale data into the shader's uniform array.
    for (let i = n; i < MAX_DYNAMIC_LIGHTS_GL; i++) {
      const o = i * 4;
      pos[o] = 0;
      pos[o + 1] = 0;
      pos[o + 2] = 0;
      pos[o + 3] = 0;
      col[o] = 0;
      col[o + 1] = 0;
      col[o + 2] = 0;
      col[o + 3] = 0;
    }
  }

  drawSky(top: IPixel, bottom: IPixel): void {
    const gl = this.gl;
    gl.useProgram(this.skyProgram);
    gl.uniform3f(this.skyTopLoc, top.r / 255, top.g / 255, top.b / 255);
    gl.uniform3f(this.skyBottomLoc, bottom.r / 255, bottom.g / 255, bottom.b / 255);
    gl.bindVertexArray(this.quadVAO);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  drawWorld(
    scene: Scene,
    position: Vec2,
    facing: number,
    camera: CameraData,
    horizonOffset: number = 0,
  ): void {
    const gl = this.gl;
    const width = this.canvas.width;
    const height = this.canvas.height;

    // Lazy scene upload — same scene every frame so we only push bytes
    // when the grid actually changes.
    this.ensureSceneUploaded(scene);

    // Per-column DDA on CPU. Each column produces up to
    // `MAX_SLABS_PER_COLUMN` wall hits; the shader walks them
    // back-to-front. Empty slots have wallTile=0.
    if (this.columnsWidth !== width) {
      this.columnsWidth = width;
      const sz = width * MAX_SLABS_PER_COLUMN * 4;
      this.columnsData = new Float32Array(sz);
      this.columnsSegData = new Float32Array(sz);
      this.columnsCapData = new Float32Array(sz);
      this.columnsCellData = new Float32Array(sz);
      this.columnsEmissiveData = new Float32Array(sz);
      gl.bindTexture(gl.TEXTURE_2D, this.columnsTex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, width, MAX_SLABS_PER_COLUMN, 0, gl.RGBA, gl.FLOAT, this.columnsData);
      gl.bindTexture(gl.TEXTURE_2D, this.columnsSegTex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, width, MAX_SLABS_PER_COLUMN, 0, gl.RGBA, gl.FLOAT, this.columnsSegData);
      gl.bindTexture(gl.TEXTURE_2D, this.columnsCapTex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, width, MAX_SLABS_PER_COLUMN, 0, gl.RGBA, gl.FLOAT, this.columnsCapData);
      gl.bindTexture(gl.TEXTURE_2D, this.columnsCellTex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, width, MAX_SLABS_PER_COLUMN, 0, gl.RGBA, gl.FLOAT, this.columnsCellData);
      gl.bindTexture(gl.TEXTURE_2D, this.columnsEmissiveTex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, width, MAX_SLABS_PER_COLUMN, 0, gl.RGBA, gl.FLOAT, this.columnsEmissiveData);
    }
    const forward = Vec2.fromAngle(facing);
    const right = Vec2.fromAngle(facing + Math.PI / 2);
    const planeScale = Math.tan(camera.fov / 2);
    const data = this.columnsData;
    const segData = this.columnsSegData;
    const capData = this.columnsCapData;
    const cellData = this.columnsCellData;
    const emData = this.columnsEmissiveData;
    const segOffsetScale = 1 / TILE_RESOLUTION;
    // Texel layout in 2D float texture: row-major, row = slab index.
    // Texel(x, s) = data[(s * width + x) * 4 + channel].
    for (let x = 0; x < width; x++) {
      const cameraX = (2 * x) / width - 1;
      const rayDir = forward.add(right.scale(planeScale * cameraX));
      const hits = castRayThroughWalls(scene, position, rayDir, camera.maxRaySteps);
      const n = Math.min(hits.length, MAX_SLABS_PER_COLUMN);
      for (let s = 0; s < MAX_SLABS_PER_COLUMN; s++) {
        const base = (s * width + x) * 4;
        if (s < n) {
          const hit = hits[s]!;
          data[base] = hit.perpDistance;
          data[base + 1] = hit.wallU;
          data[base + 2] = hit.side === WallSide.Horizontal ? 0.7 : 1.0;
          data[base + 3] = hit.tile;
          const seg = hit.segment;
          segData[base] = seg.startZ;
          segData[base + 1] = seg.height;
          segData[base + 2] = seg.offsetX * segOffsetScale;
          segData[base + 3] = seg.offsetY * segOffsetScale;
          capData[base] = hit.perpDistanceBack;
          capData[base + 1] = seg.topTile ?? seg.tile;
          capData[base + 2] = seg.bottomTile ?? seg.tile;
          capData[base + 3] = 0;
          // Pre-bake the +0.5 cell-centre offset on the CPU so the
          // shader can read the wall lightmap UV without any further
          // math — see the lightWorldPos = sCell.xy assignment in
          // FRAG_WORLD_SRC.
          cellData[base] = hit.cell.x + 0.5;
          cellData[base + 1] = hit.cell.y + 0.5;
          cellData[base + 2] = 0;
          cellData[base + 3] = 0;
          // Pre-multiply emissive on the CPU so the shader can just
          // add `sEm.rgb` without a per-fragment intensity multiply.
          const em = seg.emissive;
          if (em !== undefined) {
            emData[base] = em.color[0] * em.intensity;
            emData[base + 1] = em.color[1] * em.intensity;
            emData[base + 2] = em.color[2] * em.intensity;
          } else {
            emData[base] = 0;
            emData[base + 1] = 0;
            emData[base + 2] = 0;
          }
          emData[base + 3] = 0;
        } else {
          // Empty slot — wallTile=0 so the shader's loop skips it.
          data[base] = 0;
          data[base + 1] = 0;
          data[base + 2] = 1;
          data[base + 3] = 0;
          segData[base] = 0;
          segData[base + 1] = 1;
          segData[base + 2] = 0;
          segData[base + 3] = 0;
          capData[base] = 0;
          capData[base + 1] = 0;
          capData[base + 2] = 0;
          capData[base + 3] = 0;
          cellData[base] = 0;
          cellData[base + 1] = 0;
          cellData[base + 2] = 0;
          cellData[base + 3] = 0;
          emData[base] = 0;
          emData[base + 1] = 0;
          emData[base + 2] = 0;
          emData[base + 3] = 0;
        }
      }
    }
    gl.bindTexture(gl.TEXTURE_2D, this.columnsTex);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, width, MAX_SLABS_PER_COLUMN, gl.RGBA, gl.FLOAT, data);
    gl.bindTexture(gl.TEXTURE_2D, this.columnsSegTex);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, width, MAX_SLABS_PER_COLUMN, gl.RGBA, gl.FLOAT, segData);
    gl.bindTexture(gl.TEXTURE_2D, this.columnsCapTex);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, width, MAX_SLABS_PER_COLUMN, gl.RGBA, gl.FLOAT, capData);
    gl.bindTexture(gl.TEXTURE_2D, this.columnsCellTex);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, width, MAX_SLABS_PER_COLUMN, gl.RGBA, gl.FLOAT, cellData);
    gl.bindTexture(gl.TEXTURE_2D, this.columnsEmissiveTex);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, width, MAX_SLABS_PER_COLUMN, gl.RGBA, gl.FLOAT, emData);

    // Bind textures + set uniforms.
    gl.useProgram(this.worldProgram);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.tilesTex);
    gl.uniform1i(this.u.tiles!, 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.columnsTex);
    gl.uniform1i(this.u.columns!, 1);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, this.sceneTilesTex);
    gl.uniform1i(this.u.sceneTiles!, 2);
    gl.activeTexture(gl.TEXTURE3);
    gl.bindTexture(gl.TEXTURE_2D, this.sceneReflTex);
    gl.uniform1i(this.u.sceneRefl!, 3);
    gl.activeTexture(gl.TEXTURE4);
    gl.bindTexture(gl.TEXTURE_2D, this.columnsSegTex);
    gl.uniform1i(this.u.columnsSeg!, 4);
    gl.activeTexture(gl.TEXTURE5);
    gl.bindTexture(gl.TEXTURE_2D, this.columnsCapTex);
    gl.uniform1i(this.u.columnsCap!, 5);
    gl.activeTexture(gl.TEXTURE6);
    gl.bindTexture(gl.TEXTURE_2D, this.sceneLightmapFloorTex);
    gl.uniform1i(this.u.lightmapFloor!, 6);
    gl.activeTexture(gl.TEXTURE11);
    gl.bindTexture(gl.TEXTURE_2D, this.sceneLightmapCeilingTex);
    gl.uniform1i(this.u.lightmapCeiling!, 11);
    gl.activeTexture(gl.TEXTURE7);
    gl.bindTexture(gl.TEXTURE_2D, this.columnsEmissiveTex);
    gl.uniform1i(this.u.columnsEmissive!, 7);
    gl.activeTexture(gl.TEXTURE8);
    gl.bindTexture(gl.TEXTURE_2D, this.sceneEmissiveFloorTex);
    gl.uniform1i(this.u.sceneEmissiveFloor!, 8);
    gl.activeTexture(gl.TEXTURE9);
    gl.bindTexture(gl.TEXTURE_2D, this.sceneEmissiveCeilTex);
    gl.uniform1i(this.u.sceneEmissiveCeil!, 9);
    gl.activeTexture(gl.TEXTURE10);
    gl.bindTexture(gl.TEXTURE_2D, this.columnsCellTex);
    gl.uniform1i(this.u.columnsCell!, 10);

    gl.uniform2f(this.u.resolution!, width, height);
    gl.uniform2f(this.u.sceneSize!, scene.size.x, scene.size.y);
    gl.uniform1f(this.u.lightmapResolution!, scene.lightmap.resolution);
    gl.uniform1f(this.u.fogInv!, 1 / camera.fogDistance);
    gl.uniform2f(this.u.position!, position.x, position.y);
    gl.uniform2f(this.u.forward!, forward.x, forward.y);
    gl.uniform2f(this.u.right!, right.x, right.y);
    gl.uniform1f(this.u.planeScale!, planeScale);
    gl.uniform1f(this.u.horizonOffset!, horizonOffset);
    gl.uniform1f(this.u.cameraZ!, camera.cameraZ ?? 0.5);
    gl.uniform1f(this.u.wallAoBotDarken!, CONFIG.walls.ao.bottomDarken);
    gl.uniform1f(this.u.wallAoBotBand!, CONFIG.walls.ao.bottomBand);
    gl.uniform1f(this.u.wallAoTopDarken!, CONFIG.walls.ao.topDarken);
    gl.uniform1f(this.u.wallAoTopBand!, CONFIG.walls.ao.topBand);
    gl.uniform1f(this.u.floorAoBand!, CONFIG.floor.ao.band);
    gl.uniform1f(this.u.floorAoDarken!, CONFIG.floor.ao.darken);
    gl.uniform1f(this.u.reflTileScale!, CONFIG.floor.reflection.tileScale);
    gl.uniform1f(this.u.wallReflStrength!, CONFIG.walls.reflection.strength);
    gl.uniform1f(this.u.wallReflBand!, CONFIG.walls.reflection.band);
    gl.uniform3f(
      this.u.fallbackFloor!,
      camera.floor.r / 255,
      camera.floor.g / 255,
      camera.floor.b / 255,
    );
    gl.uniform3f(
      this.u.fallbackCeiling!,
      camera.ceiling.r / 255,
      camera.ceiling.g / 255,
      camera.ceiling.b / 255,
    );
    // Dynamic lights — one uniform array each frame. Cheap upload
    // (`MAX_DYNAMIC_LIGHTS_GL * 4` floats × 2 buffers); the per-fragment
    // cost is the in-shader loop, bounded by `MAX_LOS_STEPS`.
    gl.uniform1i(this.u.lightCount!, this.dynamicLightCount);
    gl.uniform4fv(this.u.lightPos!, this.dynamicLightPos);
    gl.uniform4fv(this.u.lightCol!, this.dynamicLightCol);

    gl.bindVertexArray(this.quadVAO);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  drawSprites(
    requests: readonly SpriteDrawRequest[],
    position: Vec2,
    facing: number,
    camera: CameraData,
    horizonOffset: number = 0,
  ): void {
    if (requests.length === 0) return;
    const gl = this.gl;
    const width = this.canvas.width;
    const height = this.canvas.height;
    const planeScale = Math.tan(camera.fov / 2);
    const cameraZ = camera.cameraZ ?? 0.5;
    // Same shift the canvas2d sprite pass applies — sprites stay
    // pinned to world Z as the player jumps / crouches.
    const cameraZDelta = cameraZ - 0.5;
    const horizonY = height / 2 + horizonOffset;

    const forward = Vec2.fromAngle(facing);
    const right = Vec2.fromAngle(facing + Math.PI / 2);

    // Project + cull. Behind-camera and unknown-sprite items drop.
    type Item = {
      camX: number;
      camY: number;
      layer: number;
      worldHeight: number;
      yOffset: number;
      worldX: number;
      worldY: number;
    };
    const items: Item[] = [];
    for (const req of requests) {
      const layer = this.spriteLayers.get(req.imageId);
      if (layer === undefined) {
        if (!this.warnedSpriteIds.has(req.imageId)) {
          console.warn(`Sprite "${req.imageId}" is not in the pack — drop or rename`);
          this.warnedSpriteIds.add(req.imageId);
        }
        continue;
      }
      const dx = req.x - position.x;
      const dy = req.y - position.y;
      const camX = dx * right.x + dy * right.y;
      const camY = dx * forward.x + dy * forward.y;
      if (camY <= 0.05) continue;
      items.push({
        camX,
        camY,
        layer,
        worldHeight: req.worldHeight,
        yOffset: req.yOffset,
        worldX: req.x,
        worldY: req.y,
      });
    }
    if (items.length === 0) return;
    // Back-to-front for alpha blending.
    items.sort((a, b) => b.camY - a.camY);
    const drawCount = Math.min(items.length, MAX_SPRITES_PER_FRAME);

    // One-shot diagnostic. Print the first time we have any visible
    // items so we can confirm the pass is wired end-to-end.
    if (!this.spriteDiagLogged) {
      this.spriteDiagLogged = true;
      console.log(
        `[WebGLRenderer.drawSprites] first visible frame — ${requests.length} requested, ${drawCount} drawn. ` +
          `Layers known: ${[...this.spriteLayers.entries()].map(([k, v]) => `${k}=${v}`).join(", ")}`,
      );
      for (const it of items.slice(0, 3)) {
        console.log(`  item camY=${it.camY.toFixed(2)} camX=${it.camX.toFixed(2)} layer=${it.layer}`);
      }
    }

    // Build vertex data — 6 verts per quad, 6 floats per vert.
    const data = this.spriteVertexData;
    const invW = 1 / width;
    const invH = 1 / height;
    let off = 0;
    // Sprites are square in their source image; aspect comes from the
    // texture layer (we normalised every sprite to SPRITE_RESOLUTION).
    for (let i = 0; i < drawCount; i++) {
      const it = items[i]!;
      const spriteH = (it.worldHeight * height) / it.camY;
      // Aspect 1.0 because we normalised. If you want non-square sprites
      // later, stash the original aspect alongside the layer index.
      const spriteW = spriteH;
      const cx = (width / 2) * (1 + it.camX / (it.camY * planeScale));
      const cy = horizonY + ((it.yOffset + cameraZDelta) * height) / it.camY;
      const screenLeft = cx - spriteW / 2;
      const screenRight = cx + spriteW / 2;
      const screenTop = cy - spriteH / 2;
      const screenBottom = cy + spriteH / 2;
      // Canvas (y grows down) → clip space (y grows up).
      const clipL = screenLeft * invW * 2 - 1;
      const clipR = screenRight * invW * 2 - 1;
      const clipT = 1 - screenTop * invH * 2;
      const clipB = 1 - screenBottom * invH * 2;
      const L = it.layer;
      const Y = it.camY;
      const WX = it.worldX;
      const WY = it.worldY;
      // Tri 1: TL, TR, BL
      data[off++] = clipL; data[off++] = clipT; data[off++] = 0; data[off++] = 0; data[off++] = L; data[off++] = Y; data[off++] = WX; data[off++] = WY;
      data[off++] = clipR; data[off++] = clipT; data[off++] = 1; data[off++] = 0; data[off++] = L; data[off++] = Y; data[off++] = WX; data[off++] = WY;
      data[off++] = clipL; data[off++] = clipB; data[off++] = 0; data[off++] = 1; data[off++] = L; data[off++] = Y; data[off++] = WX; data[off++] = WY;
      // Tri 2: TR, BR, BL
      data[off++] = clipR; data[off++] = clipT; data[off++] = 1; data[off++] = 0; data[off++] = L; data[off++] = Y; data[off++] = WX; data[off++] = WY;
      data[off++] = clipR; data[off++] = clipB; data[off++] = 1; data[off++] = 1; data[off++] = L; data[off++] = Y; data[off++] = WX; data[off++] = WY;
      data[off++] = clipL; data[off++] = clipB; data[off++] = 0; data[off++] = 1; data[off++] = L; data[off++] = Y; data[off++] = WX; data[off++] = WY;
    }

    // Upload only the bytes we filled.
    gl.bindBuffer(gl.ARRAY_BUFFER, this.spriteVBO);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, data.subarray(0, off));

    // Draw.
    gl.useProgram(this.spriteProgram);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.spritesTex);
    gl.uniform1i(this.spriteUniforms.sprites!, 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.columnsTex);
    gl.uniform1i(this.spriteUniforms.columns!, 1);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, this.columnsSegTex);
    gl.uniform1i(this.spriteUniforms.columnsSeg!, 2);
    gl.activeTexture(gl.TEXTURE3);
    gl.bindTexture(gl.TEXTURE_2D, this.sceneLightmapFloorTex);
    gl.uniform1i(this.spriteUniforms.lightmapFloor!, 3);
    // Bind sceneTiles for the in-shader LOS occluder test (Phase 5
    // dynamic lights). Reuses the same RGBA32F texture the world
    // shader's AO samples — channel R is the `isFloorOccluder` flag.
    gl.activeTexture(gl.TEXTURE4);
    gl.bindTexture(gl.TEXTURE_2D, this.sceneTilesTex);
    gl.uniform1i(this.spriteUniforms.sceneTiles!, 4);
    gl.uniform2f(this.spriteUniforms.resolution!, width, height);
    gl.uniform2f(this.spriteUniforms.sceneSize!, this.uploadedSceneW, this.uploadedSceneH);
    gl.uniform1f(this.spriteUniforms.lightmapResolution!, this.uploadedLightmapResolution);
    gl.uniform1f(this.spriteUniforms.horizonOffset!, horizonOffset);
    gl.uniform1f(this.spriteUniforms.cameraZ!, cameraZ);
    gl.uniform1f(this.spriteUniforms.planeScale!, planeScale);
    gl.uniform1f(this.spriteUniforms.fogInv!, 1 / camera.fogDistance);
    gl.uniform1i(this.spriteUniforms.lightCount!, this.dynamicLightCount);
    gl.uniform4fv(this.spriteUniforms.lightPos!, this.dynamicLightPos);
    gl.uniform4fv(this.spriteUniforms.lightCol!, this.dynamicLightCol);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.bindVertexArray(this.spriteVAO);
    gl.drawArrays(gl.TRIANGLES, 0, drawCount * 6);
    gl.bindVertexArray(null);
    gl.disable(gl.BLEND);
  }

  endFrame(): void {
    // WebGL has implicit present on rAF; nothing to flush here.
  }

  /**
   * Resize the backing pixel buffer + GL viewport + HUD canvas. The
   * per-column data textures auto-resize on the next `drawWorld` via
   * its `columnsWidth !== width` guard.
   */
  resize(width: number, height: number): void {
    if (this.canvas.width === width && this.canvas.height === height) return;
    this.canvas.width = width;
    this.canvas.height = height;
    this.hudCanvas.width = width;
    this.hudCanvas.height = height;
    this.gl.viewport(0, 0, width, height);
    this.syncHud();
  }

  /* --- Internal helpers ----------------------------------------------- */

  /** Allocate the empty tile texture array. Layers fill in async as textures load. */
  private makeTileArray(): WebGLTexture {
    const gl = this.gl;
    const tex = gl.createTexture();
    if (!tex) throw new Error("Failed to create tile array");
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, tex);
    gl.texImage3D(
      gl.TEXTURE_2D_ARRAY,
      0,
      gl.RGBA,
      TILE_RESOLUTION,
      TILE_RESOLUTION,
      TILE_LAYERS,
      0,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      null,
    );
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_T, gl.REPEAT);
    return tex;
  }

  /** Upload one decoded `Texture` into layer `tileId` of the tile array. */
  private uploadTileLayer(tileId: number, src: Texture): void {
    if (tileId < 0 || tileId >= TILE_LAYERS) {
      console.warn(`Tile id ${tileId} outside array range (0..${TILE_LAYERS - 1})`);
      return;
    }
    const gl = this.gl;
    const data = resizeTexture(src, TILE_RESOLUTION, TILE_RESOLUTION);
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.tilesTex);
    gl.texSubImage3D(
      gl.TEXTURE_2D_ARRAY,
      0,
      0,
      0,
      tileId,
      TILE_RESOLUTION,
      TILE_RESOLUTION,
      1,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      data,
    );
  }

  /** Allocate the empty sprite atlas (TEXTURE_2D_ARRAY). */
  private makeSpriteArray(): WebGLTexture {
    const gl = this.gl;
    const tex = gl.createTexture();
    if (!tex) throw new Error("Failed to create sprite array");
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, tex);
    gl.texImage3D(
      gl.TEXTURE_2D_ARRAY,
      0,
      gl.RGBA,
      SPRITE_RESOLUTION,
      SPRITE_RESOLUTION,
      SPRITE_LAYERS,
      0,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      null,
    );
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return tex;
  }

  /**
   * Upload one decoded sprite into atlas layer `layer`. Flips Y on the
   * way in so the source image's top row maps to UV.v = 0 (the sprite
   * pass samples with that convention).
   */
  private uploadSpriteLayer(layer: number, src: Texture): void {
    const gl = this.gl;
    const data = resizeTexture(src, SPRITE_RESOLUTION, SPRITE_RESOLUTION);
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.spritesTex);
    gl.texSubImage3D(
      gl.TEXTURE_2D_ARRAY,
      0,
      0,
      0,
      layer,
      SPRITE_RESOLUTION,
      SPRITE_RESOLUTION,
      1,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      data,
    );
  }

  /** Crop a sheet into per-tile layers (mirrors TwoDRenderer's logic). */
  private registerSheet(image: Texture, spec: SheetEntry): void {
    let id = spec.startTileId;
    for (let row = 0; row < spec.rows; row++) {
      for (let col = 0; col < spec.cols; col++) {
        const srcX = spec.offsetX + col * spec.tileWidth;
        const srcY = spec.offsetY + row * spec.tileHeight;
        const cropped = image.crop(srcX, srcY, spec.tileWidth, spec.tileHeight);
        this.uploadTileLayer(id, cropped);
        id++;
      }
    }
  }

  /** Create an RGBA32F texture seeded with `data`. */
  private makeFloatTexture(w: number, h: number, data: Float32Array): WebGLTexture {
    const gl = this.gl;
    const tex = gl.createTexture();
    if (!tex) throw new Error("Failed to create float texture");
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, w, h, 0, gl.RGBA, gl.FLOAT, data);
    return tex;
  }

  /** Upload the scene grid the first time (and re-upload if the scene swaps). */
  private ensureSceneUploaded(scene: Scene): void {
    const gl = this.gl;
    // Dimension-keyed cache for the tile / refl grids. For now the scene
    // grid itself is static post-load, so a dimension key is sufficient.
    // If cells start mutating without a dimension change, mirror the
    // buffer-identity pattern used below for the lightmap.
    const key = `${scene.size.x}x${scene.size.y}`;
    if (this.uploadedSceneKey !== key) {
      this.uploadedSceneKey = key;

      const w = scene.size.x;
      const h = scene.size.y;
      this.uploadedSceneW = w;
      this.uploadedSceneH = h;
      const tilesData = new Float32Array(w * h * 4);
      const reflData = new Float32Array(w * h * 4);
      // Per-cell emissive (RGB = color × intensity, A = 0). Filled
      // only for cells whose floor / ceiling has an `emissive` spec —
      // everything else stays at zero so the shader's add is a no-op.
      const emFloorData = new Float32Array(w * h * 4);
      const emCeilData = new Float32Array(w * h * 4);
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const cell = scene.getCell(x, y);
          const idx = (y * w + x) * 4;
          // Channels R / A are the floor / ceiling occluder flags the
          // shader's AO logic tests against. A knee wall sits on the
          // floor (floor AO on neighbour cells) but doesn't reach the
          // ceiling (no ceiling AO); a hanging header is the mirror.
          // Splitting the flag avoids spurious shadows from partial walls
          // on the surface they don't actually touch.
          tilesData[idx] = scene.isFloorOccluder(x, y) ? 1 : 0;
          tilesData[idx + 1] = cell.floor.tile;
          tilesData[idx + 2] = cell.ceiling.tile;
          tilesData[idx + 3] = scene.isCeilingOccluder(x, y) ? 1 : 0;
          reflData[idx] = cell.floor.reflectiveness;
          reflData[idx + 1] = cell.floor.transition;
          reflData[idx + 2] = cell.ceiling.reflectiveness;
          reflData[idx + 3] = cell.ceiling.transition;
          const fEm = cell.floor.emissive;
          if (fEm !== undefined) {
            emFloorData[idx] = fEm.color[0] * fEm.intensity;
            emFloorData[idx + 1] = fEm.color[1] * fEm.intensity;
            emFloorData[idx + 2] = fEm.color[2] * fEm.intensity;
          }
          const cEm = cell.ceiling.emissive;
          if (cEm !== undefined) {
            emCeilData[idx] = cEm.color[0] * cEm.intensity;
            emCeilData[idx + 1] = cEm.color[1] * cEm.intensity;
            emCeilData[idx + 2] = cEm.color[2] * cEm.intensity;
          }
        }
      }
      gl.bindTexture(gl.TEXTURE_2D, this.sceneTilesTex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, w, h, 0, gl.RGBA, gl.FLOAT, tilesData);
      gl.bindTexture(gl.TEXTURE_2D, this.sceneReflTex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, w, h, 0, gl.RGBA, gl.FLOAT, reflData);
      gl.bindTexture(gl.TEXTURE_2D, this.sceneEmissiveFloorTex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, w, h, 0, gl.RGBA, gl.FLOAT, emFloorData);
      gl.bindTexture(gl.TEXTURE_2D, this.sceneEmissiveCeilTex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, w, h, 0, gl.RGBA, gl.FLOAT, emCeilData);
    }

    // Lightmap — (W+1)×(H+1) corner grid, source is packed RGB. Pad to
    // RGBA32F (alpha=1) so GL sampling has no alpha surprises.
    //
    // Identity-tracked by buffer reference (not by dimension) so a same-size
    // scene swap with a fresh bake re-uploads correctly. The dimension key
    // above would silently keep the stale upload.
    const lm = scene.lightmap;
    const resolutionChanged = this.uploadedLightmapResolution !== lm.resolution;
    const floorChanged = this.uploadedFloorLightmapBuffer !== lm.floorRGB;
    const ceilingChanged = this.uploadedCeilingLightmapBuffer !== lm.ceilingRGB;
    if (floorChanged || ceilingChanged || resolutionChanged) {
      // Texture dimensions follow the bake: (W*K+1) × (H*K+1). K=1
      // gives the legacy (W+1)×(H+1) layout for old bakes.
      const lmW = lm.width * lm.resolution + 1;
      const lmH = lm.height * lm.resolution + 1;
      this.uploadedLightmapResolution = lm.resolution;
      const pack = (src: Float32Array): Float32Array => {
        const lmData = new Float32Array(lmW * lmH * 4);
        for (let i = 0, j = 0; i < src.length; i += 3, j += 4) {
          lmData[j] = src[i]!;
          lmData[j + 1] = src[i + 1]!;
          lmData[j + 2] = src[i + 2]!;
          lmData[j + 3] = 1;
        }
        return lmData;
      };
      // On a resolution change we must re-upload BOTH grids even if
      // the buffer refs match, otherwise the texture dimensions
      // disagree with the shader's UV math.
      if (floorChanged || resolutionChanged) {
        this.uploadedFloorLightmapBuffer = lm.floorRGB;
        gl.bindTexture(gl.TEXTURE_2D, this.sceneLightmapFloorTex);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, lmW, lmH, 0, gl.RGBA, gl.FLOAT, pack(lm.floorRGB));
      }
      if (ceilingChanged || resolutionChanged) {
        this.uploadedCeilingLightmapBuffer = lm.ceilingRGB;
        gl.bindTexture(gl.TEXTURE_2D, this.sceneLightmapCeilingTex);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, lmW, lmH, 0, gl.RGBA, gl.FLOAT, pack(lm.ceilingRGB));
      }
    }
  }

  /** Match the HUD canvas's screen rect to the WebGL canvas's. */
  private readonly syncHud = (): void => {
    const r = this.canvas.getBoundingClientRect();
    this.hudCanvas.style.left = `${r.left}px`;
    this.hudCanvas.style.top = `${r.top}px`;
    this.hudCanvas.style.width = `${r.width}px`;
    this.hudCanvas.style.height = `${r.height}px`;
  };
}

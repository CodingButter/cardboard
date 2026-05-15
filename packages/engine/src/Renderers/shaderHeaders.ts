/**
 * Auto-injected headers for pack-shipped shaders (R4 / Phases S1-S3).
 *
 * A pack manifest's `shaders` field maps a role to a shader path inside
 * the pack. The pack ships only the **body** of the shader (helpers
 * + `void main()`); the engine prepends one of these headers before
 * compilation so the pack author never has to redeclare uniforms,
 * varyings, defines, or `outColor`.
 *
 * S2 promoted helpers (`sampleTile`, `sampleLightmap`,
 * `accumulateDynamicLight`, …) and `#define`s (`MAX_LIGHTS`,
 * `MAX_SLABS`, `MAX_LOS_STEPS`, `LIGHT_JITTER_SAMPLES`) into the header.
 * The engine's own default bodies are now routed through the SAME
 * `buildFragmentSource` as pack overrides — keeping the contract
 * honest (single source of truth for the role's API).
 *
 * S3 layered the hook prelude in front of the helper block: every
 * compiled program has identity-default `hook_*` functions plus the
 * helpers that call them. A pack-supplied `*Hooks.glsl` overrides any
 * subset of those defaults.
 *
 * Layout per role (top to bottom):
 *   #version + precision
 *   varyings + uniforms (per-role contract)
 *   #defines (MAX_LIGHTS / MAX_SLABS / MAX_LOS_STEPS)
 *   jitter table (shared across roles)
 *   hook prelude (identity defaults) — S3
 *   engine helpers (call the hooks) — S2
 *   user body (engine default or pack override)
 */

import type { ShaderRole } from "./ShaderRoleRegistry";
import { HELPERS_WORLD, HELPERS_SPRITE, JITTER_BLOCK } from "./shaderHelpers";
import { hookPreludeFor } from "./HookPrelude";

/**
 * Sky frag header — minimal. Sky has no scene textures, no lightmap,
 * no helpers (just a two-color blend in `main()`).
 */
const HEADER_SKY = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 outColor;
uniform vec3 u_top;
uniform vec3 u_bottom;
`;

/**
 * World frag header — every uniform / varying the world body uses.
 * Includes `#define`s and the jitter table so a pack body can read them
 * directly; helpers + hook prelude are appended below at assemble time.
 */
const HEADER_WORLD = `#version 300 es
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
uniform sampler2D u_lightmapFloor;
uniform sampler2D u_lightmapCeiling;
uniform vec2 u_resolution;
uniform vec2 u_sceneSize;
uniform float u_lightmapResolution;
uniform float u_fogInv;
uniform vec2 u_position;
uniform vec2 u_forward;
uniform vec2 u_right;
uniform float u_planeScale;
uniform float u_horizonOffset;
uniform float u_cameraZ;

uniform float u_wallAoBotDarken;
uniform float u_wallAoBotBand;
uniform float u_wallAoTopDarken;
uniform float u_wallAoTopBand;
uniform float u_floorAoBand;
uniform float u_floorAoDarken;
uniform float u_reflTileScale;
uniform float u_wallReflStrength;
uniform float u_wallReflBand;

uniform vec3 u_fallbackFloor;
uniform vec3 u_fallbackCeiling;

#define MAX_LIGHTS 8
#define MAX_LOS_STEPS 16
#define MAX_SLABS 4
uniform int u_lightCount;
uniform vec4 u_lightPos[MAX_LIGHTS];
uniform vec4 u_lightCol[MAX_LIGHTS];
`;

/**
 * Sprite frag header — varyings from the sprite vertex shader, sprite
 * atlas sampler, plus the lightmap / dynamic-light contract.
 */
const HEADER_SPRITE = `#version 300 es
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
uniform sampler2D u_lightmapFloor;
uniform sampler2D u_sceneTiles;
uniform vec2 u_resolution;
uniform vec2 u_sceneSize;
uniform float u_lightmapResolution;
uniform float u_horizonOffset;
uniform float u_cameraZ;
uniform float u_planeScale;
uniform float u_fogInv;
uniform int u_lightCount;
uniform vec4 u_lightPos[MAX_LIGHTS];
uniform vec4 u_lightCol[MAX_LIGHTS];
`;

/**
 * Return the auto-injected GLSL header (uniforms + varyings + defines
 * only, no helpers / hook prelude) for a given role. Used by
 * `buildFragmentSource` in `ShaderInjection.ts` as the first stanza.
 */
export function headerFor(role: ShaderRole): string {
  switch (role) {
    case "skyFrag":
      return HEADER_SKY;
    case "worldFrag":
      return HEADER_WORLD;
    case "spriteFrag":
      return HEADER_SPRITE;
  }
}

/**
 * Helper block for a role (helpers + jitter table for the roles that
 * use it). World + sprite both reference the soft-shadow jitter table;
 * sky uses neither.
 */
export function helpersFor(role: ShaderRole): string {
  switch (role) {
    case "skyFrag":
      return "";
    case "worldFrag":
      return JITTER_BLOCK + HELPERS_WORLD;
    case "spriteFrag":
      return JITTER_BLOCK + HELPERS_SPRITE;
  }
}

/**
 * Full pre-body GLSL for a role: header + hook prelude + helpers.
 * Concatenated with the engine body (or pack-supplied override) before
 * compile.
 *
 * Order matters: helpers reference the identity-default hooks (for
 * roles that have them), so the prelude MUST precede the helper block.
 */
export function fullHeaderFor(role: ShaderRole): string {
  return headerFor(role) + hookPreludeFor(role) + helpersFor(role) + "// ==== user body begins ====\n";
}

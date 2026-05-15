/**
 * Auto-injected headers for pack-shipped shaders (R4 / Phase S1).
 *
 * A pack manifest's `shaders` field maps a role to a shader path inside
 * the pack. The pack ships only the **body** of the shader (helpers
 * + `void main()`); the engine prepends one of these headers before
 * compilation so the pack author never has to redeclare uniforms,
 * varyings, defines, or `outColor`.
 *
 * The engine's built-in defaults are NOT routed through this header —
 * they ship as full-source strings in `WebGLRenderer.ts` and are
 * byte-identical to before R4. The header here is the **contract** the
 * default-source declarations already satisfy. If a pack body and the
 * default body are appended after the matching header they compile
 * against the same uniform set.
 *
 * Scope: S1 — three roles (sky / world / sprite). No post-pass header
 * yet (S2). Engine helper functions (`sampleTile`, `sampleLightmap`,
 * `accumulateDynamicLight`, …) are intentionally NOT in the header for
 * S1; the default world frag keeps them inline. A pack body that wants
 * them must redeclare locally for now. Promoting helpers to the header
 * is an additive S2/S3 change.
 */

import type { ShaderRole } from "./ShaderRoleRegistry";

/**
 * Sky frag header. Mirrors the prelude inside `FRAG_SKY_SRC`.
 * Two-color vertical gradient inputs.
 */
const HEADER_SKY = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 outColor;
uniform vec3 u_top;
uniform vec3 u_bottom;
// ==== user body begins ====
`;

/**
 * World frag header. Mirrors the prelude inside `FRAG_WORLD_SRC` —
 * every uniform, varying, and `#define` the default world body
 * declares. Pack-shipped `worldFrag` bodies can reference any of these
 * directly.
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
// ==== user body begins ====
`;

/**
 * Sprite frag header. Mirrors the prelude inside `FRAG_SPRITE_SRC` —
 * varyings from the sprite vertex shader, sprite atlas sampler, plus
 * the lightmap / dynamic-light contract.
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
// ==== user body begins ====
`;

/**
 * Return the auto-injected GLSL header for a given role. Engine
 * prepends this to a pack-shipped shader body before compilation.
 * Engine's own defaults do NOT use this — they ship pre-built.
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

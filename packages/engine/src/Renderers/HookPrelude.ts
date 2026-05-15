/**
 * Mode-3 shader-hook identity-default prelude (R4 / Phase S3).
 *
 * Source-of-truth: `docs/plans/ENGINE_PACK_SHADERS.md` §7 (catalog) +
 * §5 (mechanism). The engine emits these identity-default `hook_*`
 * functions into every compiled program. The engine `main()` (and the
 * helpers in `shaderHelpers.ts`) call each hook at a fixed point; when
 * no pack overrides the hook, it inlines to the original value and the
 * GLSL compiler folds it away.
 *
 * A pack that ships `shaders.{role}Hooks` re-defines any subset of these
 * functions. The `HookParser` extracts them and `assembleShaderSource`
 * substitutes them into the prelude before compile.
 *
 * Surface enum used by hook signatures:
 *   0 = floor, 1 = ceiling, 2 = wall, 3 = top cap, 4 = bottom cap.
 *
 * `int channel` (reflection refl-channel discriminator):
 *   0 = floor refl (.r), 2 = ceiling refl (.b). Mirrors u_sceneRefl
 *   layout — kept symmetric with the helper API.
 */

import type { ShaderRole } from "./ShaderRoleRegistry";

/**
 * worldFrag identity defaults — 27 hooks from §7.2.
 *
 * Order is grouped by category. Each block matches the plan doc's
 * sub-sections (Surface color, Reflection, Lighting, AO, Fog, Emissive,
 * Final composite).
 */
const HOOK_PRELUDE_WORLD = `
/* --- Hook prelude — worldFrag (27 hooks, S3) ------------------------- */

// 7.2.1 Surface color (6)
vec3 hook_modifyAlbedo(vec3 base, vec2 uv, int tile, int surface) { return base; }
vec3 hook_modifyFallbackFloor(vec3 base) { return base; }
vec3 hook_modifyFallbackCeiling(vec3 base) { return base; }
vec3 hook_modifyWallColor(vec3 base, int wallTile, float wallU, float sideMul, float perpDist) { return base; }
vec3 hook_modifyCapColor(vec3 base, int capTile, vec2 capWorld, bool isTop) { return base; }
vec3 hook_modifySurfaceColor(vec3 base, int surface, vec2 worldPos) { return base; }

// 7.2.2 Reflection (4)
float hook_modifyReflectivity(float base, vec2 cellCoord, int surface) { return base; }
vec3 hook_modifyReflectionColor(vec3 base, int surface, vec2 worldPos) { return base; }
vec3 hook_modifyTiledReflection(vec3 base, vec2 tiledUv, int sampledTile) { return base; }
float hook_modifyWallReflFade(float base, float fadeT, int slabIndex) { return base; }

// 7.2.3 Lighting (5)
vec3 hook_modifyStaticLight(vec3 base, vec2 worldPos, bool isCeiling) { return base; }
vec3 hook_modifyDynamicLight(vec3 base, vec2 worldPos) { return base; }
float hook_modifyLightAttenuation(float base, vec3 lightPos, vec2 worldPos, float radius, float intensity) { return base; }
float hook_modifyLightCoverage(float base, vec3 lightPos, vec2 worldPos) { return base; }
vec3 hook_modifyLightColor(vec3 base, int lightIndex) { return base; }

// 7.2.4 AO (4)
float hook_modifyWallAo(float base, float y, float wallTop, float wallHeight) { return base; }
float hook_modifySurfaceAo(float base, ivec2 cellCoord, vec2 frac, bool useCeiling) { return base; }
bool hook_isOccluder(bool base, ivec2 cellCoord, bool useCeiling) { return base; }
float hook_modifyAoCombined(float base, int surface, vec2 worldPos) { return base; }

// 7.2.5 Fog (3)
float hook_modifyFogMul(float base, float depth) { return base; }
vec3 hook_modifyFogColor(vec3 base, float depth) { return base; }
float hook_modifyDepth(float base, vec2 worldPos) { return base; }

// 7.2.6 Emissive (2)
vec3 hook_modifyEmissive(vec3 base, int surface, vec2 worldPos) { return base; }
vec3 hook_addEmissive(vec3 base, vec2 worldPos, int surface) { return base; }

// 7.2.7 Final composite (3)
vec3 hook_modifyFinalSurface(vec3 base, vec2 worldPos, int surface) { return base; }
vec3 hook_modifyFinalColor(vec3 base, vec2 worldPos, int surface) { return base; }
float hook_modifyFinalAlpha(float base, int surface) { return base; }
`;

/**
 * spriteFrag identity defaults — 8 hooks from §7.3.
 */
const HOOK_PRELUDE_SPRITE = `
/* --- Hook prelude — spriteFrag (8 hooks, S3) ------------------------- */

// 7.3.1 Surface + alpha (3)
vec4 hook_modifySpriteSample(vec4 base, vec2 uv, int layer) { return base; }
float hook_modifySpriteAlpha(float base, vec2 uv, int layer) { return base; }
vec3 hook_modifySpriteColor(vec3 base, vec2 uv, int layer, vec2 worldPos) { return base; }

// 7.3.2 Lighting + composite (3)
vec3 hook_modifySpriteStaticLight(vec3 base, vec2 worldPos) { return base; }
vec3 hook_modifySpriteDynamicLight(vec3 base, vec2 worldPos) { return base; }
vec3 hook_modifySpriteFinalColor(vec3 base, int layer, vec2 worldPos) { return base; }

// 7.3.3 Discard / clip (2)
bool hook_shouldDiscardSprite(bool base, vec2 uv, int layer, vec2 worldPos) { return base; }
float hook_modifySpriteFog(float base, float camDepth) { return base; }
`;

/**
 * skyFrag identity defaults — 3 hooks from §7.4.
 */
const HOOK_PRELUDE_SKY = `
/* --- Hook prelude — skyFrag (3 hooks, S3) ---------------------------- */

vec3 hook_modifySkyTop(vec3 base, vec2 uv) { return base; }
vec3 hook_modifySkyBottom(vec3 base, vec2 uv) { return base; }
float hook_modifySkyGradient(float base, vec2 uv) { return base; }
`;

/**
 * Identity-default hook prelude for a given role. Engine prepends this
 * to every compiled program (engine default and pack-shipped alike) so
 * the call sites in `main()` always resolve to a known function — even
 * for packs that ship zero hooks.
 */
export function hookPreludeFor(role: ShaderRole): string {
  switch (role) {
    case "skyFrag":
      return HOOK_PRELUDE_SKY;
    case "worldFrag":
      return HOOK_PRELUDE_WORLD;
    case "spriteFrag":
      return HOOK_PRELUDE_SPRITE;
  }
}

/**
 * Catalog of valid hook names for a given role. Used by the hook
 * substitution pass to detect typos / wrong-role overrides at runtime,
 * and (later, S5) by build-time validation to surface "did you mean"
 * suggestions.
 *
 * Order matches the plan doc's §7 sub-section ordering.
 */
const HOOK_NAMES: Record<ShaderRole, readonly string[]> = {
  worldFrag: [
    "hook_modifyAlbedo",
    "hook_modifyFallbackFloor",
    "hook_modifyFallbackCeiling",
    "hook_modifyWallColor",
    "hook_modifyCapColor",
    "hook_modifySurfaceColor",
    "hook_modifyReflectivity",
    "hook_modifyReflectionColor",
    "hook_modifyTiledReflection",
    "hook_modifyWallReflFade",
    "hook_modifyStaticLight",
    "hook_modifyDynamicLight",
    "hook_modifyLightAttenuation",
    "hook_modifyLightCoverage",
    "hook_modifyLightColor",
    "hook_modifyWallAo",
    "hook_modifySurfaceAo",
    "hook_isOccluder",
    "hook_modifyAoCombined",
    "hook_modifyFogMul",
    "hook_modifyFogColor",
    "hook_modifyDepth",
    "hook_modifyEmissive",
    "hook_addEmissive",
    "hook_modifyFinalSurface",
    "hook_modifyFinalColor",
    "hook_modifyFinalAlpha",
  ],
  spriteFrag: [
    "hook_modifySpriteSample",
    "hook_modifySpriteAlpha",
    "hook_modifySpriteColor",
    "hook_modifySpriteStaticLight",
    "hook_modifySpriteDynamicLight",
    "hook_modifySpriteFinalColor",
    "hook_shouldDiscardSprite",
    "hook_modifySpriteFog",
  ],
  skyFrag: ["hook_modifySkyTop", "hook_modifySkyBottom", "hook_modifySkyGradient"],
};

export function hookNamesFor(role: ShaderRole): readonly string[] {
  return HOOK_NAMES[role];
}

// R4/S3 demo — phosphor-green night vision goggles + circular
// vignette so it reads as "looking through optics."
//
// Two effects per pixel:
//   1. Luminance + green tint  (classic NVG phosphor look).
//   2. Screen-space vignette   (aspect-corrected circular falloff).
//
// Applied to BOTH world surfaces (walls / floors / ceiling) AND
// sprites (items, projectiles, pickups). The world and sprite
// fragment shaders are separate WebGL programs with their own hook
// preludes, so the effect needs two hooks — one per role. Same math
// both times. Manifest references this file from BOTH `worldHooks`
// and `spriteHooks` so both shaders get patched.
//
// Note: the S3 hook parser only extracts functions named `hook_*`.
// Helpers defined in this file would not be carried into the
// compiled shader (no `#include` yet — deferred S3 work). So the
// math is inlined twice rather than factored into a shared helper.
//
// Surface enum for world (§7.1): 0 = floor, 1 = ceiling, 2 = wall.

// Walls / floors / ceiling.
vec3 hook_modifyFinalColor(vec3 base, vec2 worldPos, int surface) {
  // Phosphor-green NVG.
  float luminance = dot(base, vec3(0.299, 0.587, 0.114));
  float boosted = clamp(luminance * 1.6 + 0.05, 0.0, 1.0);
  vec3 phosphor = vec3(boosted * 0.15, boosted, boosted * 0.15);

  // Aspect-corrected circular vignette.
  vec2 screenUv = gl_FragCoord.xy / u_resolution.xy;
  vec2 fromCenter = screenUv - vec2(0.5);
  fromCenter.x *= u_resolution.x / u_resolution.y;
  float v = smoothstep(0.55, 0.22, length(fromCenter));

  return phosphor * v;
}

// Sprites (items, pickups, projectiles).
//
// Sprites do NOT get vignette darkening — they stay at full brightness
// regardless of screen position. On top of that, we *boost* their
// intensity in the vignette's dark zones, so items at the edge of
// the screen appear to glow against the darkened backdrop. Classic
// "thermal blob through NVG" read.
vec3 hook_modifySpriteFinalColor(vec3 base, int layer, vec2 worldPos) {
  // Phosphor-green NVG.
  float luminance = dot(base, vec3(0.299, 0.587, 0.114));
  float boosted = clamp(luminance * 1.6 + 0.05, 0.0, 1.0);
  vec3 phosphor = vec3(boosted * 0.15, boosted, boosted * 0.15);

  // Same aspect-corrected vignette math as the world hook.
  vec2 screenUv = gl_FragCoord.xy / u_resolution.xy;
  vec2 fromCenter = screenUv - vec2(0.5);
  fromCenter.x *= u_resolution.x / u_resolution.y;
  float v = smoothstep(0.55, 0.22, length(fromCenter));

  // Darkness ramp inverts the vignette: 0 at center, 1 at corner.
  // Quadratic curve so the glow only kicks in near the edge.
  float darkness = 1.0 - v;
  float glow = 1.0 + darkness * darkness * 1.5;

  return phosphor * glow;
}

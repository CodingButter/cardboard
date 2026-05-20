// M3 of materials plan smoke test (see git log) — scene-level world hooks.
//
// Attached to scene2.json via the scene's top-level `shaders`
// field. Every fragment in scene2 routes through these hooks; the
// engine layers them on top of pack-level hooks and underneath
// any per-cell (M2) or per-entity (M1) shader.
//
// We override both `hook_modifyFogColor` (catalog completeness —
// today the engine's worldFrag computes this value but doesn't
// composite it; see the comment at the call site in WebGLRenderer
// FRAG_WORLD_SRC §7.2.5) AND `hook_modifyFinalColor` (the real
// composite hook) — so the warm-orange fog actually shows on
// screen as a depth-attenuated tint over every surface.
//
// Surface enum (§7.1): 0 = floor, 1 = ceiling, 2 = wall.

vec3 hook_modifyFogColor(vec3 base, float depth) {
  // Hot orange tint, depth-attenuated. Kept for symmetry — see
  // the file header for why this alone isn't visible today.
  return mix(vec3(0.5, 0.2, 0.0), base, exp(-depth * 0.3));
}

vec3 hook_modifyFinalColor(vec3 base, vec2 worldPos, int surface) {
  // Visible smoke test: blend a hot-orange fog over the final
  // pixel. Camera-relative depth isn't easily available here —
  // use distance from the spawn origin (1.5, 1.5) as a rough
  // depth proxy that still shows the gradient against scene2's
  // 11×9 room.
  vec2 d = worldPos - vec2(1.5, 1.5);
  float depth = sqrt(d.x * d.x + d.y * d.y);
  vec3 fogTint = vec3(0.5, 0.2, 0.0);
  float weight = 1.0 - exp(-depth * 0.3);
  return mix(base, fogTint, weight * 0.4);
}

// R4/S3 smoke test — the canonical Mode 3 demo from
// docs/plans/ENGINE_PACK_SHADERS.md §13.1. Floors with any authored
// reflection coefficient become visibly wetter (4× reflective, capped
// at 95% so it never goes fully mirrored). Walls + ceilings unchanged.
//
// Surface enum (§7.1): 0 = floor, 1 = ceiling, 2 = wall.
float hook_modifyReflectivity(float base, vec2 cellCoord, int surface) {
  if (surface == 0) return clamp(base * 4.0, 0.0, 0.95);
  return base;
}

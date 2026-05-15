// R4/S3 smoke test — Mode 3 hooks proof-of-life.
//
// Forces every floor cell to 85% mirror regardless of its authored
// reflectivity. We override-not-amplify because default-pack scenes
// have no authored reflection (`cellRefl.r == 0` everywhere), so the
// plan doc's `base * 4.0` example is a no-op here visually. A modder
// amplifying real authored reflectivity would write
// `clamp(base * 4.0, 0.0, 0.95)` instead.
//
// Surface enum (§7.1): 0 = floor, 1 = ceiling, 2 = wall.

float hook_modifyReflectivity(float base, vec2 cellCoord, int surface) {
  if (surface == 0) return 0.85;
  return base;
}

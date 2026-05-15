// M2 of MATERIALS.md smoke test — per-cell wet floor shader.
//
// Attached to the `wet.floor` preset (see presets/floors.jsonc).
// Cells whose floor uses this preset get bumped to 85% mirror
// reflectivity; the engine's variant collector picks this up at
// scene-load and routes the affected fragments through a per-cell
// dispatcher. Other cells (variant 0) render with their original
// authored reflectivity unchanged.
//
// Surface enum (§7.1): 0 = floor, 1 = ceiling, 2 = wall.

float hook_modifyReflectivity(float base, vec2 cellCoord, int surface) {
  // Floor only — leave walls + ceilings alone so the smoke test
  // surfaces only on the floor cell that drove the preset.
  if (surface == 0) return 0.85;
  return base;
}

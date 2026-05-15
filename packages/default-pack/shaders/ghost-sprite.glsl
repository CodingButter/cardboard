// M1 of MATERIALS.md — per-entity sprite-shader smoke test.
//
// Attaches to ammo-pack pickups when `manifest.materialsSmokeTest`
// is on (see hello.js). Each ammo pickup carrying this shader
// renders translucent + green-tinted, while regular pickups
// (no Shader component) render normally.
//
// Demonstrates the M1 contract:
//
//   - Two of the 8 sprite hooks are overridden here.
//   - The other 6 inherit from the pack default automatically
//     (no need to copy identity defaults).
//   - The entity carrying this shader gets variant id != 0;
//     the engine routes its fragment-shader hook calls through
//     a per-variant dispatcher.
//   - Other entities (variant 0 / no Shader component) render
//     byte-identically to today.
//
// Surface enum (sprite-frag has no surface kinds — sprite hooks
// don't expose one). `int layer` is the sprite-atlas layer
// (one layer per sprite imageId).

/* Sin-wave alpha pulse — sprites breathe between 30% and 70%
 * opacity. The phase is fixed because we don't have a uniform
 * for sprite-local time in M1; a `uTime`-driven variant is a
 * follow-up. The constant 0.5 below is the static-time value;
 * if the engine routes `uTime` into the sprite frag in a future
 * phase, this becomes `sin(uTime * 4.0) * 0.2 + 0.5`. */
float hook_modifySpriteAlpha(float base, vec2 uv, int layer) {
  float wave = sin(uv.y * 6.28318 * 3.0) * 0.1 + 0.5;
  return base * wave;
}

/* Ghostly green tint. Multiplies the final composed sprite
 * color (post-lighting) by a desaturated green. */
vec3 hook_modifySpriteFinalColor(vec3 base, int layer, vec2 worldPos) {
  return base * vec3(0.4, 1.3, 0.5);
}

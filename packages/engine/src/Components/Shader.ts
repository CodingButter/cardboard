import { Component } from "ECS";

/**
 * Per-entity shader-hook attachment (M1 of materials plan — see git log).
 *
 * Each entity may carry a `Shader` component pointing at one or more
 * pack-shipped `.glsl` files containing `hook_modify*` definitions. The
 * engine collects every unique `Shader` component value used in the
 * scene at scene-load time, assigns each a non-zero variant id (variant
 * 0 = pack default), and emits a per-fragment dispatcher that picks the
 * right override per-pixel.
 *
 * Three-tier cascade (most specific wins per hook name):
 *
 *   Engine identity defaults (HookPrelude.ts)
 *     ↑ overridden by Pack-level hooks (manifest.shaders — R4)
 *     ↑ overridden by Scene-level hooks (scene.shaders — M3, future)
 *     ↑ overridden by THIS component (per-entity hooks — M1)
 *
 * Hooks not present in a more-specific tier fall through to the next.
 * A `Shader` component that only defines one hook inherits all others
 * from pack default.
 *
 * Paths are pack-relative (resolved via `pack.textBody`). All three
 * fields are optional — a missing field falls through to the pack
 * default for that role.
 *
 * M1 only consults `spriteHooks`; `worldHooks` (M2 — cell materials)
 * and `skyHooks` (M3+ — sky entities) are reserved fields so authoring
 * is stable across phases. Setting them today is a no-op.
 */
export interface ShaderData {
  /**
   * Pack-relative path to a `.glsl` file containing `hook_modify*`
   * definitions for worldFrag's 27 hooks. Reserved for M2 — today the
   * engine reads it only to assign distinct variant ids.
   */
  worldHooks?: string;
  /**
   * Pack-relative path to a `.glsl` file containing definitions for
   * spriteFrag's 8 hooks. M1 reads + dispatches this per sprite.
   */
  spriteHooks?: string;
  /**
   * Pack-relative path to a `.glsl` file for skyFrag's 3 hooks.
   * Reserved for future work (scene-driven sky / weather entities).
   */
  skyHooks?: string;
}

export const Shader = new Component<ShaderData>("Shader");

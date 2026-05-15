/**
 * Shader-role registry (R4 / Phases S1-S3).
 *
 * The engine ships a fixed catalog of fragment-shader **roles** that
 * make up the WebGL2 render pipeline. A pack can opt into replacing
 * any role by listing it under `manifest.shaders`. Roles not declared
 * by the pack fall back to the engine's built-in default body.
 *
 * S1 implemented Mode 1 (role replacement) only. S2 promoted engine
 * helpers to the auto-injected header. S3 added Mode 3 (shader hooks)
 * — pack-supplied `*Hooks.glsl` files redefine specific named
 * `hook_*` functions in the engine's call sites without replacing
 * `main()`. See `ShaderInjection.ts` for the assembly pass.
 *
 * The role catalog mirrors the WebGL2 renderer's actual programs.
 * Today the renderer has exactly three fragment programs (sky, world,
 * sprite) — see `WebGLRenderer.ts`. If the engine later splits the
 * world pass, additional roles (`wallFrag`, `floorFrag`, …) can be
 * added here additively without breaking existing `worldFrag` overrides.
 */

import type { AssetPack } from "AssetPack";
import { assembleShaderSource } from "./ShaderInjection";

/** Catalog of pack-overridable fragment shader roles. */
export type ShaderRole = "skyFrag" | "worldFrag" | "spriteFrag";

/**
 * Hook-file variant of every role. A pack supplies `{role}Hooks` to
 * redefine specific named hooks in the engine's default body, instead
 * of replacing the whole role (`{role}Frag`).
 */
export type ShaderHookRole = "skyHooks" | "worldHooks" | "spriteHooks";

/**
 * Union of every shader-related manifest key. Used by manifest typing.
 */
export type ShaderEntry = ShaderRole | ShaderHookRole;

/** Iteration-friendly tuple of every role. */
export const SHADER_ROLES: readonly ShaderRole[] = ["skyFrag", "worldFrag", "spriteFrag"] as const;

/** Type guard — `true` if `s` is a known role. */
export function isShaderRole(s: string): s is ShaderRole {
  return (SHADER_ROLES as readonly string[]).includes(s);
}

/**
 * Resolve the GLSL source to compile for a given role. Delegates to
 * `assembleShaderSource`, which:
 *
 *  - Returns the engine default + auto-injected header when the pack
 *    ships nothing for this role.
 *  - Returns the pack's Mode-1 body + auto-injected header when
 *    `shaders[role]` is set.
 *  - Returns the engine body with the pack's Mode-3 overrides spliced
 *    into the identity-default hook prelude when only
 *    `shaders[${role}Hooks]` is set.
 *
 * Mode 1 wins over Mode 3 inside a single pack (see §5.5 of
 * `ENGINE_PACK_SHADERS.md`) — a console warning surfaces when both are
 * present.
 */
export async function getShaderSource(
  role: ShaderRole,
  pack: AssetPack,
  defaultBody: string,
): Promise<string> {
  return assembleShaderSource(role, pack, defaultBody);
}

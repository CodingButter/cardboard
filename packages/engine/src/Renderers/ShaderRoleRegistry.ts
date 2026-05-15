/**
 * Shader-role registry (R4 / Phase S1).
 *
 * The engine ships a fixed catalog of fragment-shader **roles** that
 * make up the WebGL2 render pipeline. A pack can opt into replacing
 * any role by listing it under `manifest.shaders`. Roles not declared
 * by the pack fall back to the engine's built-in default body.
 *
 * S1 implements role replacement only — a single pack, no chain
 * resolution. Post-process passes, build-time validation, and
 * pack-chain conflict reporting are S2/S3/S4.
 *
 * The role catalog mirrors the WebGL2 renderer's actual programs.
 * Today the renderer has exactly three fragment programs (sky, world,
 * sprite) — see `WebGLRenderer.ts`. If the engine later splits the
 * world pass, additional roles (`wallFrag`, `floorFrag`, …) can be
 * added here additively without breaking existing `worldFrag` overrides.
 */

import type { AssetPack } from "AssetPack";
import { headerFor } from "./shaderHeaders";

/** Catalog of pack-overridable fragment shader roles. */
export type ShaderRole = "skyFrag" | "worldFrag" | "spriteFrag";

/** Iteration-friendly tuple of every role. */
export const SHADER_ROLES: readonly ShaderRole[] = ["skyFrag", "worldFrag", "spriteFrag"] as const;

/** Type guard — `true` if `s` is a known role. */
export function isShaderRole(s: string): s is ShaderRole {
  return (SHADER_ROLES as readonly string[]).includes(s);
}

/**
 * Resolve the GLSL source to compile for a given role.
 *
 * - If the pack manifest declares `shaders[role]`, fetch the body via
 *   `pack.textBody(path)` and prepend the engine's auto-injected
 *   header for that role.
 * - Otherwise return `defaultSource` (the engine's built-in shader,
 *   already a full source string with its own header).
 *
 * Errors reading the pack file propagate; the caller may choose to
 * log + fall back to the default, but S1 lets them surface (the user
 * sees the compile error rather than a silent fallback).
 */
export async function getShaderSource(
  role: ShaderRole,
  pack: AssetPack,
  defaultSource: string,
): Promise<string> {
  const path = pack.manifest.shaders?.[role];
  if (!path) return defaultSource;
  const body = await pack.textBody(path);
  return headerFor(role) + body;
}

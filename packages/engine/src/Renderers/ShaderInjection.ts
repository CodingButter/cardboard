/**
 * Shader source assembler (R4 / Phases S1-S3).
 *
 * Single entry point that turns a role + optional pack + engine-default
 * body into compile-ready GLSL.
 *
 *  - `buildFragmentSource(role, userBody)` — Mode 1 / engine default
 *    assembly. Concatenates header + hook prelude + helpers + body.
 *  - `assembleShaderSource(role, pack, engineBody)` — also resolves
 *    Mode-3 hook overrides if the pack supplies a `{role}Hooks` file.
 *    Mode 1 wins over Mode 3 in the same pack: when both are set, the
 *    pack's full role replacement wins and the hooks file is skipped
 *    with a console warning (per §5.5 / §10.2 of the plan doc).
 */

import type { AssetPack, ShaderHookRole } from "AssetPack";
import type { ShaderRole } from "./ShaderRoleRegistry";
import { fullHeaderFor } from "./shaderHeaders";
import { parseHookOverrides, substituteHooks } from "./HookParser";
import { hookPreludeFor, hookNamesFor } from "./HookPrelude";

/**
 * Map a shader role to its corresponding `*Hooks` manifest key.
 * Symmetric — engine never reads any other shape.
 */
function hookKeyFor(role: ShaderRole): ShaderHookRole {
  switch (role) {
    case "skyFrag":
      return "skyHooks";
    case "worldFrag":
      return "worldHooks";
    case "spriteFrag":
      return "spriteHooks";
  }
}

/**
 * Build the final fragment-shader source for a role given just the body
 * (engine default or pack Mode-1 override) — no hook resolution. Used
 * when no pack ships hooks for the role, or when the assembled source
 * has already been computed by `assembleShaderSource`.
 */
export function buildFragmentSource(role: ShaderRole, userBody: string): string {
  return fullHeaderFor(role) + userBody;
}

/**
 * Build the final fragment-shader source for a role, applying any
 * pack-supplied hook overrides. The hook prelude (identity defaults)
 * lives inside `fullHeaderFor(role)`; we splice the pack overrides into
 * the prelude part of the assembled source.
 *
 * - When the pack ships `{role}Frag` (Mode 1), that body REPLACES the
 *   `engineBody` argument. Hooks for the same role from the same pack
 *   are dropped with a warning per the §5.5 exclusion rule.
 *
 * - When the pack ships `{role}Hooks` only, the engine body is used
 *   and the prelude is rewritten in place to substitute the override
 *   functions for their identity defaults.
 *
 * `engineBody` is always the engine's authoritative default body for
 * the role — it contains the `main()` and any helpers not promoted to
 * the header. The caller passes the constants from `WebGLRenderer.ts`.
 */
export async function assembleShaderSource(
  role: ShaderRole,
  pack: AssetPack | undefined,
  engineBody: string,
): Promise<string> {
  if (!pack) return buildFragmentSource(role, engineBody);

  const shaders = pack.manifest.shaders;
  const fragPath = shaders?.[role];
  const hooksPath = shaders?.[hookKeyFor(role)];

  // Resolve body (Mode 1) — pack-supplied takes precedence over the
  // engine default. Hooks for the same role + same pack are dropped.
  let body = engineBody;
  if (fragPath) {
    body = await pack.textBody(fragPath);
    if (hooksPath) {
      console.warn(
        `[two_5_d] pack '${pack.manifest.name}' ships both shaders.${role} (Mode 1) and shaders.${hookKeyFor(role)} (Mode 3); ` +
          `Mode 1 wins per role-replacement rules. The hooks file is ignored.`,
      );
    }
    return buildFragmentSource(role, body);
  }

  // Mode-3-only path: substitute the pack's hook overrides into the
  // identity-default prelude, then concatenate with the engine body.
  if (!hooksPath) return buildFragmentSource(role, engineBody);

  let hookSource = "";
  try {
    hookSource = await pack.textBody(hooksPath);
  } catch (err) {
    console.warn(
      `[two_5_d] pack '${pack.manifest.name}' shaders.${hookKeyFor(role)} (${hooksPath}) failed to load — ignoring. ${(err as Error).message}`,
    );
    return buildFragmentSource(role, engineBody);
  }

  const overrides = parseHookOverrides(hookSource);
  if (overrides.size === 0) {
    console.warn(
      `[two_5_d] pack '${pack.manifest.name}' shaders.${hookKeyFor(role)} (${hooksPath}) contains no hook_* function definitions — ignoring.`,
    );
    return buildFragmentSource(role, engineBody);
  }

  // Validate overrides against the role catalog. Names that don't
  // match anything in the prelude get a warning per name; matching
  // hooks still apply.
  const valid = new Set(hookNamesFor(role));
  const unknown: string[] = [];
  for (const name of overrides.keys()) if (!valid.has(name)) unknown.push(name);
  for (const name of unknown) {
    console.warn(
      `[two_5_d] pack '${pack.manifest.name}' shaders.${hookKeyFor(role)} declares ${name}, which is not a known hook for role ${role}. Ignored.`,
    );
    overrides.delete(name);
  }

  // Splice into the prelude — `fullHeaderFor` returns header + prelude
  // + helpers + body-marker; we substitute overrides inside the
  // prelude region, leaving the rest untouched.
  const prelude = hookPreludeFor(role);
  const { source: assembledPrelude, unmatched } = substituteHooks(prelude, overrides);
  for (const u of unmatched) {
    console.warn(
      `[two_5_d] pack '${pack.manifest.name}' hook ${u} was parsed but its identity default could not be located in the role's prelude — possible signature drift?`,
    );
  }

  const fullSource = buildFragmentSource(role, engineBody);
  // Replace the unmodified prelude block with the assembled (with
  // overrides) version. The prelude appears verbatim in `fullSource`.
  return fullSource.replace(prelude, assembledPrelude);
}

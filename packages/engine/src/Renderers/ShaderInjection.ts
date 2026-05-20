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
import { fullHeaderFor, headerFor, helpersFor } from "./shaderHeaders";
import { parseHookOverrides, substituteHooks } from "./HookParser";
import { hookPreludeFor, hookNamesFor } from "./HookPrelude";
import type {
  SceneShaderLayer,
  ShaderVariantSet,
  WorldShaderVariantSet,
} from "./ShaderVariants";
import {
  cascadeHooks,
  findMode1WinnerForRole,
} from "./ShaderChainCascade";

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
  /**
   * Optional scene-level overrides (M3 of materials plan §9 — see git log). Already
   * parsed by `collectSceneShaderLayer` — a `Map<hookName, fullBody>`
   * keyed exactly like pack-side `parseHookOverrides` output. These
   * are merged ON TOP of pack-level overrides before the prelude
   * substitution runs, so scene-level wins on overlap.
   *
   * When `undefined` or empty, behaviour is byte-identical to the
   * pre-M3 single-tier (pack-only) path.
   */
  sceneOverrides?: ReadonlyMap<string, string>,
): Promise<string> {
  if (!pack) {
    // No pack — still apply scene overrides on top of the bare engine
    // default. This supports tests + fixtures where a Scene exists
    // without a pack.
    if (!sceneOverrides || sceneOverrides.size === 0) {
      return buildFragmentSource(role, engineBody);
    }
    return substitutePreludeOverrides(role, engineBody, sceneOverrides, "scene");
  }

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
    if (sceneOverrides && sceneOverrides.size > 0) {
      // Mode 1 has no hook prelude — the pack's body owns its own
      // main() and there's nowhere to splice in scene-level hook
      // overrides. Match the per-entity Mode-1 incompatibility
      // (materials plan §3.3 — see git log) and log + drop.
      console.warn(
        `[two_5_d] pack '${pack.manifest.name}' ships shaders.${role} (Mode 1) — scene.shaders.${hookKeyFor(role)} overrides are dropped for this scene (no hook call sites in pack main()).`,
      );
    }
    return buildFragmentSource(role, body);
  }

  // Mode-3-only path: merge pack-level overrides with scene-level
  // overrides (last-wins per hook), substitute into the identity-
  // default prelude, then concatenate with the engine body.
  const overrides = new Map<string, string>();

  if (hooksPath) {
    let hookSource = "";
    try {
      hookSource = await pack.textBody(hooksPath);
    } catch (err) {
      console.warn(
        `[two_5_d] pack '${pack.manifest.name}' shaders.${hookKeyFor(role)} (${hooksPath}) failed to load — ignoring. ${(err as Error).message}`,
      );
      hookSource = "";
    }
    if (hookSource) {
      const parsed = parseHookOverrides(hookSource);
      if (parsed.size === 0) {
        console.warn(
          `[two_5_d] pack '${pack.manifest.name}' shaders.${hookKeyFor(role)} (${hooksPath}) contains no hook_* function definitions — ignoring.`,
        );
      }
      for (const [name, body] of parsed) overrides.set(name, body);
    }
  }

  // Scene overrides layer on top — last-wins per hook name (§9.2).
  if (sceneOverrides) {
    for (const [name, body] of sceneOverrides) overrides.set(name, body);
  }

  if (overrides.size === 0) return buildFragmentSource(role, engineBody);

  // Validate overrides against the role catalog. Names that don't
  // match anything in the prelude get a warning per name; matching
  // hooks still apply.
  const valid = new Set(hookNamesFor(role));
  for (const name of [...overrides.keys()]) {
    if (!valid.has(name)) {
      console.warn(
        `[two_5_d] pack '${pack.manifest.name}' shaders.${hookKeyFor(role)} declares ${name}, which is not a known hook for role ${role}. Ignored.`,
      );
      overrides.delete(name);
    }
  }

  if (overrides.size === 0) return buildFragmentSource(role, engineBody);

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

/**
 * Chain-aware variant of `assembleShaderSource` — Phase M4 of
 * materials plan §10 (shipped, see git log). Resolves hook + Mode-1 cascade across
 * an ordered pack chain (deps-first → root-last) before assembling.
 *
 * Behaviour matches the single-pack `assembleShaderSource` for:
 *
 *  - **Mode 1**: the latest pack in the chain that ships a Mode-1
 *    body for `role` wins entirely; the chain's hook cascade is
 *    dropped (Mode 1 owns its own main() and has no hook call sites
 *    to splice into). Scene-level hooks are also dropped with a
 *    console warning — same shape as the single-pack rule.
 *
 *  - **Mode 3**: every pack in the chain that ships
 *    `shaders.{role}Hooks` contributes — last pack wins per hook name.
 *    Scene overrides layer on top (last-wins). Result is spliced into
 *    the identity-default prelude.
 *
 * Used by `WebGLRenderer.prefetchShaderSourcesFromChain` to build the
 * pack-default world / sprite / sky programs from the resolved chain
 * instead of just the root pack. Sprite / world per-cell variant
 * dispatch (M1 / M2) continues to scope by their declaring pack —
 * see `assembleSpriteSource` / `assembleWorldSource`, which call this
 * for the variant-0 source.
 */
export async function assembleShaderSourceFromChain(
  role: ShaderRole,
  chain: ReadonlyArray<AssetPack>,
  engineBody: string,
  sceneOverrides?: ReadonlyMap<string, string>,
): Promise<string> {
  // Empty / length-1 chain → fall through to the single-pack path so
  // existing diagnostics (pack name in warnings) stay sharp. Tests +
  // single-pack flows hit this fast-path verbatim.
  if (chain.length === 0) {
    if (!sceneOverrides || sceneOverrides.size === 0) {
      return buildFragmentSource(role, engineBody);
    }
    return substitutePreludeOverrides(role, engineBody, sceneOverrides, "scene");
  }
  if (chain.length === 1) {
    return assembleShaderSource(role, chain[0]!, engineBody, sceneOverrides);
  }

  // Mode 1: the LAST pack in the chain that ships `shaders.{role}`
  // wins entirely. All hook contributions (from any pack, plus scene)
  // are dropped — Mode 1 owns main() and has no hook call sites.
  const mode1Winner = findMode1WinnerForRole(chain, role);
  if (mode1Winner) {
    const fragPath = mode1Winner.manifest.shaders![role]!;
    const body = await mode1Winner.textBody(fragPath);
    if (sceneOverrides && sceneOverrides.size > 0) {
      console.warn(
        `[two_5_d] pack-chain ${role} resolved to Mode 1 from '${mode1Winner.manifest.name}' — scene.shaders.${hookKeyFor(role)} overrides are dropped for this scene (no hook call sites in pack main()).`,
      );
    }
    return buildFragmentSource(role, body);
  }

  // Mode 3 cascade: walk every pack's hooks file, merge last-wins,
  // layer scene on top, substitute into the prelude.
  const overrides = await cascadeHooks(chain, hookKeyFor(role));
  if (sceneOverrides) {
    for (const [name, body] of sceneOverrides) overrides.set(name, body);
  }

  if (overrides.size === 0) return buildFragmentSource(role, engineBody);

  // Validate against the role catalog — unknown names log + drop.
  const valid = new Set(hookNamesFor(role));
  for (const name of [...overrides.keys()]) {
    if (!valid.has(name)) {
      console.warn(
        `[two_5_d] pack-chain ${hookKeyFor(role)} declares ${name}, which is not a known hook for role ${role}. Ignored.`,
      );
      overrides.delete(name);
    }
  }
  if (overrides.size === 0) return buildFragmentSource(role, engineBody);

  const prelude = hookPreludeFor(role);
  const { source: assembledPrelude, unmatched } = substituteHooks(prelude, overrides);
  for (const u of unmatched) {
    console.warn(
      `[two_5_d] pack-chain hook ${u} was parsed but its identity default could not be located in the role's prelude — possible signature drift?`,
    );
  }
  const fullSource = buildFragmentSource(role, engineBody);
  return fullSource.replace(prelude, assembledPrelude);
}

/**
 * Standalone prelude substitution — when no pack is provided but a
 * Scene still wants to override hooks. Validates against the role
 * catalog and logs unknown names. `tierLabel` controls the warning
 * prefix ("pack" vs "scene") for clearer diagnostics.
 */
function substitutePreludeOverrides(
  role: ShaderRole,
  engineBody: string,
  overrides: ReadonlyMap<string, string>,
  tierLabel: string,
): string {
  const valid = new Set(hookNamesFor(role));
  const filtered = new Map<string, string>();
  for (const [name, body] of overrides) {
    if (!valid.has(name)) {
      console.warn(
        `[two_5_d] ${tierLabel} ${hookKeyFor(role)} declares ${name}, which is not a known hook for role ${role}. Ignored.`,
      );
      continue;
    }
    filtered.set(name, body);
  }
  if (filtered.size === 0) return buildFragmentSource(role, engineBody);
  const prelude = hookPreludeFor(role);
  const { source: assembledPrelude } = substituteHooks(prelude, filtered);
  const fullSource = buildFragmentSource(role, engineBody);
  return fullSource.replace(prelude, assembledPrelude);
}

/* ────────────────────────────────────────────────────────────────────
 * Per-entity sprite-variant assembly (M1 of materials plan — see git log).
 *
 * The pack-level path above produces ONE set of hook bodies for the
 * sprite-frag program. Per-entity shaders introduce N additional
 * variants — each entity carrying a `Shader` component contributes
 * its own hook overrides on top of the pack default. The frag program
 * grows a dispatcher that switches on a per-vertex `v_variant`
 * integer and routes each hook call to the variant-specific body.
 *
 * Variant 0 (= pack default) is the original prelude-after-pack-
 * substitution function. Variant 1..N are renamed `__vN` copies of
 * the modder-supplied bodies. Hooks not overridden by a particular
 * variant fall through `default:` in the switch to variant 0 — no
 * duplicated code, full inheritance from the pack tier.
 * ────────────────────────────────────────────────────────────────── */

/**
 * Find a `hook_<name>` function definition's `(start, end)` byte range
 * in `src`. Returns `null` when the named hook isn't present. Brace-
 * counting mirrors `HookParser.findHookDefinitionRange` (kept private
 * there) — sharing the implementation isn't worth a public export.
 */
function findHookRange(src: string, name: string): { start: number; end: number } | null {
  const re = new RegExp(`(\\w+)\\s+${name}\\s*\\(`);
  const m = re.exec(src);
  if (!m) return null;
  let i = m.index + m[0].length;
  let parenDepth = 1;
  while (i < src.length && parenDepth > 0) {
    const c = src[i];
    if (c === "(") parenDepth++;
    else if (c === ")") parenDepth--;
    i++;
  }
  while (i < src.length && src[i] !== "{") i++;
  if (src[i] !== "{") return null;
  i++;
  let braceDepth = 1;
  while (i < src.length && braceDepth > 0) {
    const c = src[i];
    if (c === "{") braceDepth++;
    else if (c === "}") braceDepth--;
    i++;
  }
  if (braceDepth !== 0) return null;
  return { start: m.index, end: i };
}

/**
 * Rename a hook function definition `hook_name(...)` → `hook_name__vN(
 * ...)` in its source. Operates on a single parsed-out function body
 * — does NOT touch call sites. Used to convert a variant's override
 * into a renamed function the dispatcher can call.
 */
function renameHookDefinition(src: string, name: string, variantId: number): string {
  const re = new RegExp(`(\\b)${name}(\\s*\\()`);
  return src.replace(re, `$1${name}__v${variantId}$2`);
}

/**
 * Parameter-list extractor for the sprite-frag hook prelude. Given a
 * hook function in source form (`<ret> name(<params>) { ... }`),
 * returns `{ retType, paramTypes[], paramNames[] }`. Used to build a
 * dispatcher that calls the variant-renamed function with the same
 * arguments the caller passed.
 *
 * Robust to extra whitespace and `in`/`out` qualifiers (not used by
 * any sprite hook today, but harmless to tolerate).
 */
function parseHookSignature(src: string): {
  retType: string;
  paramNames: string[];
} | null {
  const m = /(\w+)\s+(hook_\w+)\s*\(([^)]*)\)/.exec(src);
  if (!m) return null;
  const retType = m[1]!;
  const paramsRaw = m[3]!.trim();
  if (paramsRaw === "" || paramsRaw === "void") return { retType, paramNames: [] };
  const paramNames: string[] = [];
  for (const part of paramsRaw.split(",")) {
    // Each `part` looks like `vec3 base` or `int surface` — the last
    // identifier-shaped token is the name.
    const tokens = part.trim().split(/\s+/);
    paramNames.push(tokens[tokens.length - 1]!);
  }
  return { retType, paramNames };
}

/**
 * Assemble the sprite-frag GLSL source with per-entity variants
 * dispatched at fragment time. Builds on the existing pack-level
 * assembly:
 *
 *   1. Resolve the pack-default sprite source (header + prelude +
 *      pack-hook substitutions + helpers + main).
 *   2. For each sprite hook overridden by ANY variant:
 *      a. Rename the variant-0 (= pack-default) function to
 *         `hook_X__v0`.
 *      b. Emit each variant's override renamed to `hook_X__vN`.
 *      c. Emit a top-level `hook_X(...)` dispatcher that switches on
 *         `v_variant` and calls the right `__vN` copy.
 *   3. Inject `flat in int v_variant;` into the header just before
 *      the prelude.
 *
 * Hooks NOT overridden by any variant are left untouched — they keep
 * their pack-default identity (or pack-supplied override) inline and
 * the GLSL compiler folds the call site as before. Sprites with
 * `v_variant == 0` get the same generated code path as today for those
 * hooks.
 *
 * Called from `WebGLRenderer.rebuildSpriteProgram` when
 * `collectSpriteVariants` returned a non-empty variant set.
 *
 * `engineBody` is the engine's authoritative `main()` for the sprite
 * frag — the caller passes `FRAG_SPRITE_SRC` from `WebGLRenderer.ts`.
 * Mode-1 (pack-shipped `spriteFrag`) is incompatible with per-entity
 * variants — see materials plan §3.3 in git log. If the pack ships Mode 1, the
 * variants are dropped and the call falls back to the pack body.
 */
export async function assembleSpriteSource(
  pack: AssetPack | undefined,
  engineBody: string,
  variants: ShaderVariantSet,
  /**
   * Optional scene-level sprite hooks (M3 of materials plan — see git log). Layered
   * on top of pack hooks to form variant 0 for this scene. When
   * `undefined`/empty, behaviour is byte-identical to M1.
   */
  sceneSpriteOverrides?: ReadonlyMap<string, string>,
  /**
   * Optional full pack chain (M4 of materials plan §10 — see git log). When provided,
   * variant 0's hooks are cascaded across every pack in the chain
   * (last-wins per hook name) — see `assembleShaderSourceFromChain`.
   * Mode 1 / Mode 3 + variant interaction is unchanged. When omitted
   * (or length ≤ 1), behaviour is byte-identical to pre-M4 single-
   * pack rendering.
   */
  chain?: ReadonlyArray<AssetPack>,
): Promise<string> {
  // Mode-1 (pack ships its own main()) — variants can't splice into a
  // foreign main(); fall back to the pack-level path. The runtime
  // surface for entities still works (variant ids get written) but
  // the dispatcher has no hook call sites to extend.
  // When a chain is supplied, the Mode-1 winner is whichever pack
  // (any in the chain) ships `shaders.spriteFrag` last — not just the
  // root. Without a chain, fall back to the root pack's manifest.
  const mode1Winner =
    chain && chain.length > 1 ? findMode1WinnerForRole(chain, "spriteFrag") : undefined;
  const packShaders = pack?.manifest.shaders;
  if (mode1Winner || packShaders?.spriteFrag) {
    if (!variants.isEmpty()) {
      console.warn(
        `[two_5_d] pack ships shaders.spriteFrag (Mode 1) — per-entity Shader.spriteHooks overrides are dropped for this pack. See materials plan §3.3 in git log.`,
      );
    }
    if (chain && chain.length > 1) {
      return assembleShaderSourceFromChain("spriteFrag", chain, engineBody, sceneSpriteOverrides);
    }
    return assembleShaderSource("spriteFrag", pack, engineBody, sceneSpriteOverrides);
  }

  // Resolve the pack-default source (prelude + pack hook subs +
  // scene-level subs + helpers + body). This is the variant-0
  // hook-bearing source.
  const packDefaultSource =
    chain && chain.length > 1
      ? await assembleShaderSourceFromChain("spriteFrag", chain, engineBody, sceneSpriteOverrides)
      : pack
        ? await assembleShaderSource("spriteFrag", pack, engineBody, sceneSpriteOverrides)
        : sceneSpriteOverrides && sceneSpriteOverrides.size > 0
          ? substitutePreludeOverrides("spriteFrag", engineBody, sceneSpriteOverrides, "scene")
          : buildFragmentSource("spriteFrag", engineBody);

  if (variants.isEmpty()) return packDefaultSource;

  // The set of hook names that ANY variant overrides. We rewrite each
  // of these in the assembled source; other hooks stay byte-identical
  // (identity or pack-supplied) and inline as before.
  const overriddenHooks = new Set<string>();
  for (const v of variants.variants) {
    for (const name of v.spriteHookBodies.keys()) overriddenHooks.add(name);
  }

  // Validate names against the catalog — variants that reference a
  // wrong-role / mistyped hook get a warning and the offending
  // function is ignored.
  const valid = new Set(hookNamesFor("spriteFrag"));
  for (const name of [...overriddenHooks]) {
    if (!valid.has(name)) {
      console.warn(
        `[two_5_d] Shader.spriteHooks variant declares ${name}, which is not a known sprite-frag hook. Ignored.`,
      );
      overriddenHooks.delete(name);
      for (const v of variants.variants) v.spriteHookBodies.delete(name);
    }
  }

  if (overriddenHooks.size === 0) {
    // Variants exist but none of their overrides match a valid hook
    // — nothing to dispatch on; emit the pack-default source. The
    // per-vertex `a_variant` attribute is still written by the
    // sprite VBO but never read.
    return packDefaultSource;
  }

  // Inject `flat in int v_variant;` into the header. We append it
  // after the existing varyings (just before the first `out` line)
  // so the position is stable across edits to the header.
  let out = packDefaultSource;
  const variantVarying = `flat in int v_variant;\n`;
  out = out.replace(/(out\s+vec4\s+outColor\s*;\s*\n)/, `${variantVarying}$1`);

  // For each overridden hook: rename the pack-default copy to __v0,
  // append every variant's __vN, append a dispatcher with the
  // canonical hook name.
  for (const hookName of overriddenHooks) {
    const range = findHookRange(out, hookName);
    if (!range) {
      console.warn(
        `[two_5_d] sprite variant assembly: could not locate ${hookName} in the assembled source. Skipping.`,
      );
      continue;
    }
    const originalSrc = out.slice(range.start, range.end);
    const sig = parseHookSignature(originalSrc);
    if (!sig) {
      console.warn(
        `[two_5_d] sprite variant assembly: could not parse signature for ${hookName}. Skipping.`,
      );
      continue;
    }
    const v0Renamed = renameHookDefinition(originalSrc, hookName, 0);

    const variantBlocks: string[] = [];
    const switchCases: string[] = [];
    for (const v of variants.variants) {
      const override = v.spriteHookBodies.get(hookName);
      if (!override) continue;
      const renamed = renameHookDefinition(override, hookName, v.id);
      variantBlocks.push(renamed);
      const callArgs = sig.paramNames.join(", ");
      switchCases.push(`    case ${v.id}: return ${hookName}__v${v.id}(${callArgs});`);
    }

    const callArgs = sig.paramNames.join(", ");
    const dispatcher =
      `${sig.retType} ${hookName}(${parseHookSignatureToString(originalSrc)}) {\n` +
      `  switch (v_variant) {\n` +
      `${switchCases.join("\n")}\n` +
      `  }\n` +
      `  return ${hookName}__v0(${callArgs});\n` +
      `}\n`;

    const replacement =
      `${v0Renamed}\n` +
      variantBlocks.join("\n") +
      `\n` +
      dispatcher;

    out = out.slice(0, range.start) + replacement + out.slice(range.end);
  }

  return out;
}

/**
 * Re-emit a hook function's parameter list as a parameter declaration
 * string (e.g. `vec3 base, int layer, vec2 worldPos`). Used by the
 * dispatcher emitter to declare the canonical `hook_name(...)` with
 * the same signature as the original.
 */
function parseHookSignatureToString(src: string): string {
  const m = /(\w+)\s+(hook_\w+)\s*\(([^)]*)\)/.exec(src);
  if (!m) return "";
  return m[3]!.trim();
}

// `headerFor` and `helpersFor` are re-imported for potential future
// use by callers that need to inspect / re-build the sprite source
// piecewise. Re-exporting keeps the module's contract self-contained.
export { headerFor, helpersFor };

/* ────────────────────────────────────────────────────────────────────
 * Per-cell world-variant assembly (M2 of materials plan §8 — see git log).
 *
 * Same dispatcher pattern as `assembleSpriteSource`, but the variant
 * id comes from a per-cell texture (`u_sceneShaderVariants`, RGBA32F
 * SW×SH, R channel = variant id) rather than a per-vertex attribute.
 *
 * Each cell-aware hook (one whose signature contains a `vec2 worldPos`
 * / `vec2 cellCoord` / `vec2 capWorld` / `ivec2 cellCoord` parameter
 * we can derive a cell coord from) gets a dispatcher that reads the
 * cell variant from the texture at the relevant coord and routes the
 * call to the matching `__vN` body.
 *
 * Scene-only hooks (fog, fallback, final-alpha, etc. — see
 * materials plan §8 — see git log) DO NOT dispatch per-cell. They keep their pack +
 * scene baseline (variant 0) and the variant texture is never read.
 * ────────────────────────────────────────────────────────────────── */

/**
 * Which world-frag hooks are cell-aware (per-fragment dispatch) vs
 * scene-only (always run variant 0). The split derives from the hook
 * signatures in `HookPrelude.ts`: a hook is cell-aware iff its
 * parameter list contains a position-like argument we can map to a
 * grid cell.
 *
 * - `worldPos` / `capWorld` (`vec2`) → derive via `ivec2(floor(...))`
 * - `cellCoord` (`vec2` or `ivec2`) → use directly
 *
 * Any other hook (e.g. `hook_modifyAlbedo(base, uv, tile, surface)`
 * where `uv` is `fract(worldPos)` not a position) routes to
 * variant 0 always. See materials plan §8 in git log for the rationale.
 */
const WORLD_CELL_AWARE_HOOKS = new Map<string, string>([
  // hookName → parameter to derive cellCoord from
  ["hook_modifyCapColor", "capWorld"],
  ["hook_modifySurfaceColor", "worldPos"],
  ["hook_modifyReflectivity", "cellCoord"],
  ["hook_modifyReflectionColor", "worldPos"],
  ["hook_modifyStaticLight", "worldPos"],
  ["hook_modifyDynamicLight", "worldPos"],
  ["hook_modifyLightAttenuation", "worldPos"],
  ["hook_modifyLightCoverage", "worldPos"],
  ["hook_modifySurfaceAo", "cellCoord"],
  ["hook_isOccluder", "cellCoord"],
  ["hook_modifyAoCombined", "worldPos"],
  ["hook_modifyDepth", "worldPos"],
  ["hook_modifyEmissive", "worldPos"],
  ["hook_addEmissive", "worldPos"],
  ["hook_modifyFinalSurface", "worldPos"],
  ["hook_modifyFinalColor", "worldPos"],
]);

/**
 * GLSL snippet injected into the world-frag header (before the body)
 * when at least one cell-aware variant is registered. Provides a
 * `worldVariantAt(worldPos)` and `worldVariantAtCell(cellCoord)`
 * helper the dispatchers call. Reads `u_sceneShaderVariants.r` and
 * clamps out-of-bounds coords to 0 (= pack default).
 */
const WORLD_VARIANT_HEADER = `
uniform sampler2D u_sceneShaderVariants;
int worldVariantAtCell(ivec2 cellCoord) {
  if (cellCoord.x < 0 || cellCoord.y < 0
      || cellCoord.x >= int(u_sceneSize.x) || cellCoord.y >= int(u_sceneSize.y)) {
    return 0;
  }
  return int(texelFetch(u_sceneShaderVariants, cellCoord, 0).r + 0.5);
}
int worldVariantAtWorld(vec2 worldPos) {
  return worldVariantAtCell(ivec2(floor(worldPos)));
}
`;

/**
 * Assemble the world-frag GLSL source with per-cell variants
 * dispatched at fragment time. Mirrors `assembleSpriteSource` but
 * the variant source is a sampler not an attribute.
 *
 *   1. Resolve variant-0 source: pack-default world-frag with M3
 *      scene-level hooks layered on top (engine identity → pack hooks
 *      → scene hooks per materials plan §3.1 — see git log).
 *   2. Inject the `u_sceneShaderVariants` sampler + variant-lookup
 *      helpers into the assembled header.
 *   3. For each cell-aware hook overridden by ANY variant:
 *      a. Rename the variant-0 body to `hook_X__v0`.
 *      b. Emit each variant's override renamed to `hook_X__vN`.
 *      c. Emit a top-level `hook_X(...)` dispatcher that switches on
 *         the variant id at the fragment's cell coord.
 *   4. Scene-only hooks overridden by variants are warned + dropped
 *      (per materials plan §8 in git log — they belong on the scene tier, not the
 *      material tier).
 *
 * Mode-1 (pack ships `shaders.worldFrag`) is incompatible with
 * per-cell variants — the pack's `main()` has no hook call sites to
 * dispatch into. The variants are silently dropped (the cell texture
 * still uploads, but no dispatcher exists to read it).
 */
export async function assembleWorldSource(
  pack: AssetPack | undefined,
  engineBody: string,
  variants: WorldShaderVariantSet,
  /** Optional scene-level world hooks (M3). Layers on top of pack. */
  sceneWorldOverrides?: ReadonlyMap<string, string>,
  /**
   * Optional full pack chain (M4 of materials plan §10 — see git log). When provided,
   * variant 0's world hooks are cascaded across every pack in the
   * chain (last-wins per hook name). Per-cell variant dispatch (M2)
   * continues to scope by the preset's declaring pack. When omitted
   * (or length ≤ 1), behaviour is byte-identical to pre-M4 single-
   * pack rendering.
   */
  chain?: ReadonlyArray<AssetPack>,
): Promise<string> {
  const mode1Winner =
    chain && chain.length > 1 ? findMode1WinnerForRole(chain, "worldFrag") : undefined;
  const packShaders = pack?.manifest.shaders;
  if (mode1Winner || packShaders?.worldFrag) {
    if (!variants.isEmpty()) {
      console.warn(
        `[two_5_d] pack ships shaders.worldFrag (Mode 1) — per-cell preset.shader.worldHooks overrides are dropped for this pack. See materials plan §3.3 in git log.`,
      );
    }
    if (chain && chain.length > 1) {
      return assembleShaderSourceFromChain("worldFrag", chain, engineBody, sceneWorldOverrides);
    }
    return assembleShaderSource("worldFrag", pack, engineBody, sceneWorldOverrides);
  }

  // Variant-0 source — pack hooks merged with scene hooks.
  const variantZeroSource =
    chain && chain.length > 1
      ? await assembleShaderSourceFromChain("worldFrag", chain, engineBody, sceneWorldOverrides)
      : pack
        ? await assembleShaderSource("worldFrag", pack, engineBody, sceneWorldOverrides)
        : sceneWorldOverrides && sceneWorldOverrides.size > 0
          ? substitutePreludeOverrides("worldFrag", engineBody, sceneWorldOverrides, "scene")
          : buildFragmentSource("worldFrag", engineBody);

  if (variants.isEmpty()) return variantZeroSource;

  // Filter to cell-aware hooks. Scene-only hooks declared in variants
  // get a warning + are dropped — they don't make sense per-cell.
  const overriddenHooks = new Set<string>();
  for (const v of variants.variants) {
    for (const name of v.worldHookBodies.keys()) {
      if (!WORLD_CELL_AWARE_HOOKS.has(name)) {
        console.warn(
          `[two_5_d] preset shader.worldHooks declares ${name}, which is a scene-only hook (not cell-aware). Move it to scene.shaders.worldHooks. Ignored for variant ${v.id}.`,
        );
        v.worldHookBodies.delete(name);
        continue;
      }
      overriddenHooks.add(name);
    }
  }

  if (overriddenHooks.size === 0) return variantZeroSource;

  // Inject the variant-lookup helpers BEFORE the hook prelude so the
  // dispatchers (which replace identity-default hooks inside the
  // prelude) can call `u_sceneShaderVariants` / `worldVariantAt*` —
  // those need to be declared first in GLSL. Anchor on the prelude's
  // leading comment marker.
  const preludeMarker = "/* --- Hook prelude — worldFrag";
  let out = variantZeroSource.replace(preludeMarker, `${WORLD_VARIANT_HEADER}\n${preludeMarker}`);

  // For each overridden hook: rename variant 0 to __v0, append each
  // variant's __vN, append a dispatcher that reads the cell variant
  // and routes to the right __vN.
  for (const hookName of overriddenHooks) {
    const range = findHookRange(out, hookName);
    if (!range) {
      console.warn(
        `[two_5_d] world variant assembly: could not locate ${hookName} in the assembled source. Skipping.`,
      );
      continue;
    }
    const originalSrc = out.slice(range.start, range.end);
    const sig = parseHookSignature(originalSrc);
    if (!sig) {
      console.warn(
        `[two_5_d] world variant assembly: could not parse signature for ${hookName}. Skipping.`,
      );
      continue;
    }
    const v0Renamed = renameHookDefinition(originalSrc, hookName, 0);

    const cellArgName = WORLD_CELL_AWARE_HOOKS.get(hookName)!;
    // Look up which parameter index carries the cell arg (must exist
    // — the hook's in the cell-aware table). The dispatcher reads
    // that arg, computes the variant id, and routes.
    const cellArgIdx = sig.paramNames.indexOf(cellArgName);
    if (cellArgIdx < 0) {
      console.warn(
        `[two_5_d] world variant assembly: ${hookName} signature missing expected '${cellArgName}' parameter. Skipping.`,
      );
      continue;
    }

    const variantBlocks: string[] = [];
    const switchCases: string[] = [];
    for (const v of variants.variants) {
      const override = v.worldHookBodies.get(hookName);
      if (!override) continue;
      const renamed = renameHookDefinition(override, hookName, v.id);
      variantBlocks.push(renamed);
      const callArgs = sig.paramNames.join(", ");
      switchCases.push(`    case ${v.id}: return ${hookName}__v${v.id}(${callArgs});`);
    }

    // Pick the right variant-lookup helper based on the cell arg.
    // `cellCoord` may be ivec2 OR vec2 in the prelude — match
    // accordingly. The param's type is whatever the prelude declared
    // (we don't reparse it here; the helper signatures cover both).
    const cellArgRef = sig.paramNames[cellArgIdx]!;
    // ivec2-cellCoord hooks (`hook_isOccluder`, `hook_modifySurfaceAo`)
    // pass an `ivec2` directly. Everything else (`vec2 worldPos`,
    // `vec2 cellCoord`, `vec2 capWorld`) is a `vec2` we floor to ivec2.
    const isIvec2 = hookName === "hook_isOccluder" || hookName === "hook_modifySurfaceAo";
    const lookup = isIvec2
      ? `worldVariantAtCell(${cellArgRef})`
      : cellArgName === "cellCoord"
        ? `worldVariantAtCell(ivec2(${cellArgRef}))`
        : `worldVariantAtWorld(${cellArgRef})`;

    const callArgs = sig.paramNames.join(", ");
    const dispatcher =
      `${sig.retType} ${hookName}(${parseHookSignatureToString(originalSrc)}) {\n` +
      `  int variant = ${lookup};\n` +
      `  switch (variant) {\n` +
      `${switchCases.join("\n")}\n` +
      `  }\n` +
      `  return ${hookName}__v0(${callArgs});\n` +
      `}\n`;

    const replacement =
      `${v0Renamed}\n` +
      variantBlocks.join("\n") +
      `\n` +
      dispatcher;

    out = out.slice(0, range.start) + replacement + out.slice(range.end);
  }

  return out;
}

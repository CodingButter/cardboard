/**
 * Pack-chain shader cascade — Phase M4 of `docs/plans/MATERIALS.md` §10
 * (cross-ref `docs/plans/PACK_CHAIN.md` §5 and
 * `docs/plans/ENGINE_PACK_SHADERS.md` §10).
 *
 * P1 of PACK_CHAIN returns an ordered `AssetPack[]` (deps-first → root-
 * last). The engine had been using the root pack only for shader
 * assembly; M4 widens that so every pack in the chain can contribute
 * its `manifest.shaders` files.
 *
 * Cascade rules:
 *
 *  - **Pack-level hooks** (`shaders.worldHooks`, `spriteHooks`,
 *    `skyHooks`) cascade per-hook. We walk the chain in load order
 *    (deps-first → root-last), parse each pack's hook file into a
 *    `Map<hookName, body>`, and merge — later packs overwrite earlier
 *    on conflict. A console warning is emitted on every cross-pack
 *    conflict so the modder can see who shadowed whom.
 *
 *  - **Mode 1 role replacement** (`shaders.worldFrag`, `spriteFrag`,
 *    `skyFrag`) is last-wins per role. The latest pack in the chain
 *    that ships a Mode 1 body wins entirely; earlier packs' Mode 1
 *    bodies (and ALL hook contributions for that role from any pack)
 *    are dropped — Mode 1 owns its own `main()` and has no hook call
 *    sites to splice into.
 *
 *  - **Post-passes** (`shaders.postPasses`) append in chain order
 *    (per ENGINE_PACK_SHADERS.md §10.3). Cross-pack name collisions
 *    log a warning but BOTH passes run (the chain doesn't dedupe).
 *
 *  - **Materials** (per-cell preset.shader, per-entity Shader
 *    component) are per-pack scoped — each material's `.glsl` file
 *    resolves within its declaring pack and the chain doesn't merge
 *    across material variants. M4 leaves those code paths untouched.
 *
 * The module is intentionally a thin, testable kernel — it only walks
 * manifest fields and `pack.textBody` calls; it does no GL work. The
 * renderer / `ShaderInjection.ts` consume the returned maps.
 */

import type { AssetPack, PostPassDef, ShaderRole, ShaderHookRole } from "AssetPack";
import { parseHookOverrides } from "./HookParser";

/**
 * Map a fragment-shader `role` to its corresponding `*Hooks` manifest
 * key. Symmetric with the helper in `ShaderInjection.ts` — kept private
 * there and re-implemented here so the cascade module has no inward
 * dependency on the assembler.
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

/** Human label for a pack — used in cascade warnings. */
function packLabel(pack: AssetPack): string {
  const m = pack.manifest;
  if (m.id) return `${m.id}@${m.version ?? "?"}`;
  return `${m.name}@${m.version ?? "?"}`;
}

/**
 * Walk the pack chain (deps-first → root-last) and merge each pack's
 * `shaders.{hookRole}` file into a single `Map<hookName, body>`. Later
 * packs overwrite earlier ones per hook name; a console warning is
 * emitted on each cross-pack conflict so modders can audit shadowing
 * without opening the conflict-report UI (which lands in PACK_CHAIN
 * P2).
 *
 * Packs whose hook file is missing / unreadable / contains no
 * `hook_*` definitions log a warning and contribute nothing — same
 * shape the single-pack assembler emits today.
 *
 * Returns an empty map when no pack in the chain declares a hook file
 * for the role.
 */
export async function cascadeHooks(
  chain: ReadonlyArray<AssetPack>,
  hookRole: ShaderHookRole,
): Promise<Map<string, string>> {
  const merged = new Map<string, string>();
  // For conflict reporting: hook name → label of the pack that last
  // populated it.
  const provenance = new Map<string, string>();

  for (const pack of chain) {
    const path = pack.manifest.shaders?.[hookRole];
    if (!path) continue;
    const label = packLabel(pack);
    let source = "";
    try {
      source = await pack.textBody(path);
    } catch (err) {
      console.warn(
        `[two_5_d] pack-chain ${hookRole} cascade: ${label} (${path}) failed to load — skipping. ${(err as Error).message}`,
      );
      continue;
    }
    const parsed = parseHookOverrides(source);
    if (parsed.size === 0) {
      console.warn(
        `[two_5_d] pack-chain ${hookRole} cascade: ${label} (${path}) contains no hook_* definitions — skipping.`,
      );
      continue;
    }
    for (const [name, body] of parsed) {
      const prior = provenance.get(name);
      if (prior && prior !== label) {
        console.warn(
          `[two_5_d] pack-chain hook conflict: ${name} defined by ${prior} (${hookRole}) and ${label} (${hookRole}). ${label} wins.`,
        );
      }
      merged.set(name, body);
      provenance.set(name, label);
    }
  }

  return merged;
}

/**
 * Find the latest pack in the chain that ships a Mode-1 role
 * replacement for `role` (`shaders.worldFrag` / `spriteFrag` /
 * `skyFrag`). Walks the chain in reverse so the first match is the
 * "winner" per ENGINE_PACK_SHADERS.md §10.1. Returns `undefined` when
 * no pack ships Mode 1 for the role.
 *
 * When more than one pack ships Mode 1 for the same role, a single
 * console warning summarises the override list so modders can see
 * which packs got dropped — same shape as the hook-conflict warning.
 */
export function findMode1WinnerForRole(
  chain: ReadonlyArray<AssetPack>,
  role: ShaderRole,
): AssetPack | undefined {
  let winner: AssetPack | undefined;
  const losers: string[] = [];
  // Iterate in chain order; the LAST pack with a Mode 1 entry wins.
  for (const pack of chain) {
    const path = pack.manifest.shaders?.[role];
    if (!path) continue;
    if (winner) {
      losers.push(packLabel(winner));
    }
    winner = pack;
  }
  if (winner && losers.length > 0) {
    console.warn(
      `[two_5_d] pack-chain ${role} Mode-1 conflict: ${packLabel(winner)} wins; overridden ${losers.join(", ")}.`,
    );
  }
  return winner;
}

/** One post-pass + the pack that contributed it (label for warnings). */
export interface CascadedPostPass {
  def: PostPassDef;
  /** Label of the pack that declared the pass — `id@version` or `name@version`. */
  packLabel: string;
  /** Reference to the pack so the post-pass loader can call `textBody`. */
  pack: AssetPack;
}

/**
 * Concatenate every pack's `shaders.postPasses` in chain order
 * (per ENGINE_PACK_SHADERS.md §10.3). Unlike hooks + Mode 1 this is
 * **not** last-wins — every pass from every pack runs, in declaration
 * order, deps' passes first and root's last.
 *
 * Cross-pack name collisions log a soft warning so modders can rename
 * if unintentional, but BOTH passes are kept (two CRT passes is a
 * valid stylistic choice per §10.4). Same warning shape as the
 * single-pack `PostPassChain.create` emits for in-pack duplicates.
 */
export function cascadePostPasses(
  chain: ReadonlyArray<AssetPack>,
): CascadedPostPass[] {
  const out: CascadedPostPass[] = [];
  const seen = new Map<string, string>(); // name → first pack that used it
  for (const pack of chain) {
    const defs = pack.manifest.shaders?.postPasses;
    if (!defs || defs.length === 0) continue;
    const label = packLabel(pack);
    for (const def of defs) {
      const prior = seen.get(def.name);
      if (prior && prior !== label) {
        console.warn(
          `[two_5_d] pack-chain post-pass name '${def.name}' is declared by both ${prior} and ${label}. Both passes will run in chain order; rename one if unintentional.`,
        );
      }
      seen.set(def.name, label);
      out.push({ def, packLabel: label, pack });
    }
  }
  return out;
}

/**
 * Convenience wrapper around `findMode1WinnerForRole` — returns `true`
 * when ANY pack in the chain ships a Mode 1 body for the role. Lets
 * the renderer short-circuit hook cascade work when the chain is
 * Mode-1-owned (the cascaded hooks would have nowhere to splice into,
 * so building them is wasted work).
 */
export function chainHasMode1ForRole(
  chain: ReadonlyArray<AssetPack>,
  role: ShaderRole,
): boolean {
  for (const pack of chain) {
    if (pack.manifest.shaders?.[role]) return true;
  }
  return false;
}

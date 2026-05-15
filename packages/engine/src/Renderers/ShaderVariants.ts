/**
 * Per-entity shader-variant collection (M1 of MATERIALS.md).
 *
 * Walks the world at scene-load time, collects every unique `Shader`
 * component value used by sprite entities, assigns each a non-zero
 * variant id (variant 0 = pack default), and parses each variant's
 * referenced `.glsl` hook file via the existing `HookParser`.
 *
 * The resulting `ShaderVariantSet` lets:
 *
 *   - the renderer assemble a fragment-shader source with N variants'
 *     hook bodies merged + a per-fragment dispatcher switching on
 *     `v_variant`;
 *   - the sprite-render system look up a `Shader` component value's
 *     variant id (so the per-vertex variant attribute is written
 *     correctly on the sprite VBO).
 *
 * M1 collects only `spriteHooks`. `worldHooks` (M2 / cell materials)
 * and `skyHooks` (M3+ / scene-driven sky) participate in the variant
 * key — two entities with different `worldHooks` get distinct variant
 * ids even though M1's sprite dispatch ignores it — so when M2 lands
 * the variant set already partitions entities correctly.
 */

import type { World } from "ECS";
import type { AssetPack, PresetResolver, PresetShaderData } from "AssetPack";
import { Shader, type ShaderData } from "Components";
import { parseHookOverrides } from "./HookParser";

/**
 * Canonical key for a `ShaderData` value — a `(world|sprite|sky)`
 * triple. Two `Shader` components with the same triple share a
 * variant id. The empty string represents "this tier is absent" so
 * `{}` (= no overrides at all) keys to `"||"` and is treated as the
 * pack-default variant.
 */
function shaderDataKey(data: ShaderData | undefined): string {
  if (!data) return "||";
  return `${data.worldHooks ?? ""}|${data.spriteHooks ?? ""}|${data.skyHooks ?? ""}`;
}

/**
 * Snapshot of one variant — its id, its hook-file paths, and the
 * parsed hook bodies (per-role) the assembler will splice into the
 * dispatcher. Maps are empty for roles the variant doesn't override.
 */
export interface ShaderVariant {
  /** Non-zero. Variant 0 is the implicit pack default, not listed. */
  id: number;
  /** Canonical key (see `shaderDataKey`). */
  key: string;
  /** Pack-relative path that produced `spriteHookBodies`. */
  spriteHooksPath?: string;
  /**
   * Parsed hook overrides from the variant's `spriteHooks` file —
   * `Map<hookName, "<retType> hook_x(...) { ... }">`. The assembler
   * renames each function to `hook_x__v<id>` before emitting.
   */
  spriteHookBodies: Map<string, string>;
}

/**
 * Result of variant collection. Pass into
 * `assembleSpriteSource(pack, variants)` to build the dispatched
 * sprite-frag program; call `variantIdForShaderData(component)` per
 * sprite to populate the per-vertex `a_variant` attribute.
 */
export class ShaderVariantSet {
  readonly variants: ReadonlyArray<ShaderVariant>;
  private readonly keyToId: Map<string, number>;

  constructor(variants: ShaderVariant[]) {
    this.variants = variants;
    this.keyToId = new Map();
    for (const v of variants) this.keyToId.set(v.key, v.id);
  }

  /** Look up the variant id for a `Shader` component value (or 0). */
  variantIdForShaderData(data: ShaderData | undefined): number {
    if (!data) return 0;
    return this.keyToId.get(shaderDataKey(data)) ?? 0;
  }

  /** True when no entity in the scene carries a non-trivial `Shader`. */
  isEmpty(): boolean {
    return this.variants.length === 0;
  }
}

/**
 * Walk the world, collect every unique non-default `Shader`
 * component value among sprite entities, and load each one's
 * `spriteHooks` file.
 *
 * Entities without a `Shader` component, and `Shader` components
 * with no field set at all, hash to the default key and don't
 * occupy a variant slot — they implicitly use variant 0.
 *
 * Returns an empty `ShaderVariantSet` (`isEmpty()`) when no entity
 * in the scene carries a non-trivial Shader — the renderer can keep
 * its pack-default sprite program unchanged in that case (byte-
 * identical to today).
 */
export async function collectSpriteVariants(
  world: World,
  pack: AssetPack,
): Promise<ShaderVariantSet> {
  // Gather distinct keys + their representative ShaderData (for
  // the file path). One pass over entities with Shader; we don't
  // require the entity to also have Sprite because attaching a
  // shader to a non-sprite entity is harmless — the variant just
  // doesn't get used. M2 (cell materials) will share this path.
  const seen = new Map<string, ShaderData>();
  for (const entity of Shader.entities()) {
    const data = Shader.get(entity);
    if (!data) continue;
    if (!data.worldHooks && !data.spriteHooks && !data.skyHooks) continue;
    const key = shaderDataKey(data);
    if (seen.has(key)) continue;
    seen.set(key, data);
  }

  // Assign variant ids in iteration order (stable across reloads
  // because the ECS entity iteration order is insertion order).
  // Variant 0 stays reserved for the pack default, so ids start
  // at 1.
  let nextId = 1;
  const variants: ShaderVariant[] = [];
  for (const [key, data] of seen) {
    const spriteHookBodies = new Map<string, string>();
    let spriteHooksPath: string | undefined;
    if (data.spriteHooks) {
      spriteHooksPath = data.spriteHooks;
      try {
        const src = await pack.textBody(data.spriteHooks);
        const parsed = parseHookOverrides(src);
        for (const [name, body] of parsed) spriteHookBodies.set(name, body);
      } catch (err) {
        console.warn(
          `[two_5_d] Shader.spriteHooks (${data.spriteHooks}) failed to load — variant will fall back to pack default. ${(err as Error).message}`,
        );
      }
    }
    variants.push({ id: nextId++, key, spriteHooksPath, spriteHookBodies });
  }

  return new ShaderVariantSet(variants);
}

/* ────────────────────────────────────────────────────────────────────
 * World variant collection (M2 of MATERIALS.md §8).
 *
 * Walks every resolved preset, dedupes by the preset's
 * `shader.worldHooks` path, and assigns each unique value a non-zero
 * variant id. Variant 0 is the pack-default — preset-less cells, and
 * presets without a `shader.worldHooks` field, render with variant 0.
 *
 * The result is uploaded as a per-cell `u_sceneShaderVariants` texture
 * by the WebGL renderer; the world-frag dispatcher reads each
 * fragment's cell variant at the cell-aware hook call sites.
 *
 * Scene-only world hooks (fog, fallback, final composite — see
 * MATERIALS.md §8) DO NOT dispatch per-cell; they always run variant
 * 0. The scene-level layer (M3) merges into variant 0 so those hooks
 * pick up scene overrides correctly.
 * ────────────────────────────────────────────────────────────────── */

/** Canonical key for a world-variant — just the `worldHooks` path. */
function worldShaderKey(shader: PresetShaderData | undefined): string {
  if (!shader || !shader.worldHooks) return "";
  return shader.worldHooks;
}

/**
 * Snapshot of one world variant — its id, the source `.glsl` path,
 * and the parsed hook bodies the assembler splices into the world-
 * frag dispatcher. Variant 0 (pack-default + scene-level) is not
 * listed here — it's the base source the dispatcher falls through to.
 */
export interface WorldShaderVariant {
  /** Non-zero. Variant 0 is the implicit pack default. */
  id: number;
  /** Canonical key (= `worldHooks` path; see `worldShaderKey`). */
  key: string;
  /** Pack-relative `.glsl` path that produced `worldHookBodies`. */
  worldHooksPath: string;
  /**
   * Parsed hook overrides from the variant's `worldHooks` file —
   * `Map<hookName, "<retType> hook_x(...) { ... }">`. The assembler
   * renames each function to `hook_x__v<id>` before emitting.
   */
  worldHookBodies: Map<string, string>;
}

/**
 * Result of world-variant collection. Pass into `assembleWorldSource`
 * to build the dispatched world-frag program; the renderer uploads a
 * per-cell `u_sceneShaderVariants` texture mapping each cell coord to
 * its variant id.
 */
export class WorldShaderVariantSet {
  readonly variants: ReadonlyArray<WorldShaderVariant>;
  /** preset id → variant id (0 when the preset has no world shader). */
  private readonly presetIdToVariant: Map<string, number>;

  constructor(
    variants: WorldShaderVariant[],
    presetIdToVariant: Map<string, number>,
  ) {
    this.variants = variants;
    this.presetIdToVariant = presetIdToVariant;
  }

  /** Look up the variant id for a preset id (0 = pack default). */
  variantIdForPresetId(presetId: string | undefined): number {
    if (!presetId) return 0;
    return this.presetIdToVariant.get(presetId) ?? 0;
  }

  /** True when no preset in the pack carries a `shader.worldHooks`. */
  isEmpty(): boolean {
    return this.variants.length === 0;
  }
}

/**
 * Walk every preset in the resolver, collect the unique
 * `shader.worldHooks` values, assign variant ids, parse each
 * referenced `.glsl` file via `HookParser.parseHookOverrides`.
 *
 * Presets without `shader.worldHooks` (the common case) map to
 * variant 0 — they render with the pack + scene baseline. Variant
 * ids start at 1 and are stable across reloads (resolver iteration
 * order = insertion order).
 *
 * Returns an empty `WorldShaderVariantSet` (`isEmpty()`) when no
 * preset ships a world shader. The renderer's `u_sceneShaderVariants`
 * texture stays all-zero in that case and the world-frag dispatcher
 * is skipped (byte-identical to pre-M2 rendering).
 */
export async function collectWorldVariants(
  resolver: PresetResolver,
  pack: AssetPack,
): Promise<WorldShaderVariantSet> {
  // Group presets by their worldHooks path. Multiple presets that
  // reference the same `.glsl` file share a variant id (the file is
  // parsed once, the dispatcher emits one __vN copy).
  const keyToPresetIds = new Map<string, string[]>();
  for (const preset of resolver) {
    const key = worldShaderKey(preset.data.shader);
    if (key === "") continue; // pack-default — variant 0
    let arr = keyToPresetIds.get(key);
    if (!arr) {
      arr = [];
      keyToPresetIds.set(key, arr);
    }
    arr.push(preset.id);
  }

  let nextId = 1;
  const variants: WorldShaderVariant[] = [];
  const presetIdToVariant = new Map<string, number>();
  for (const [key, presetIds] of keyToPresetIds) {
    const id = nextId++;
    const worldHookBodies = new Map<string, string>();
    try {
      const src = await pack.textBody(key);
      const parsed = parseHookOverrides(src);
      for (const [name, body] of parsed) worldHookBodies.set(name, body);
    } catch (err) {
      console.warn(
        `[two_5_d] preset shader.worldHooks (${key}) failed to load — variant will fall back to pack default. ${(err as Error).message}`,
      );
    }
    variants.push({ id, key, worldHooksPath: key, worldHookBodies });
    for (const pid of presetIds) presetIdToVariant.set(pid, id);
  }

  return new WorldShaderVariantSet(variants, presetIdToVariant);
}

/* ────────────────────────────────────────────────────────────────────
 * Scene-level shader merge (M3 of MATERIALS.md §9).
 *
 * Scene JSON's `shaders` field is merged on top of pack-level hooks
 * to form variant 0. The merge is per-hook-name (last-wins) and uses
 * the same `parseHookOverrides` path as every other tier. The result
 * is a per-role hook-bodies map the assembler splices into the
 * prelude before variant assembly happens.
 *
 * When the scene has no `shaders` field (or the field is empty), the
 * returned layer is `isEmpty()` and rendering stays byte-identical
 * to the pre-M3 / pre-M2 path.
 * ────────────────────────────────────────────────────────────────── */

/**
 * Per-role parsed scene-level hook bodies. Each map is empty when the
 * scene doesn't ship a `.glsl` file for that role.
 */
export interface SceneShaderLayer {
  worldHookBodies: Map<string, string>;
  spriteHookBodies: Map<string, string>;
  skyHookBodies: Map<string, string>;
  isEmpty(): boolean;
}

/**
 * Empty scene-layer sentinel for scenes with no `shaders` field. All
 * three role maps are empty; `isEmpty()` is true.
 */
export function emptySceneLayer(): SceneShaderLayer {
  const worldHookBodies = new Map<string, string>();
  const spriteHookBodies = new Map<string, string>();
  const skyHookBodies = new Map<string, string>();
  return {
    worldHookBodies,
    spriteHookBodies,
    skyHookBodies,
    isEmpty: () =>
      worldHookBodies.size === 0 &&
      spriteHookBodies.size === 0 &&
      skyHookBodies.size === 0,
  };
}

/**
 * Resolve a scene's `shaders` field into parsed per-role hook bodies.
 * Each role's `.glsl` file is loaded through `pack.textBody` and
 * parsed via the same `parseHookOverrides` every tier uses.
 *
 * Missing / unreadable files log a warning and contribute an empty
 * map for that role; the engine continues with the pack default for
 * the affected hooks.
 */
export async function collectSceneShaderLayer(
  pack: AssetPack,
  shader: ShaderData | undefined,
): Promise<SceneShaderLayer> {
  const layer = emptySceneLayer();
  if (!shader) return layer;

  const loadInto = async (path: string | undefined, target: Map<string, string>): Promise<void> => {
    if (!path) return;
    try {
      const src = await pack.textBody(path);
      const parsed = parseHookOverrides(src);
      for (const [name, body] of parsed) target.set(name, body);
    } catch (err) {
      console.warn(
        `[two_5_d] scene.shaders (${path}) failed to load — falling back to pack default. ${(err as Error).message}`,
      );
    }
  };

  await loadInto(shader.worldHooks, layer.worldHookBodies);
  await loadInto(shader.spriteHooks, layer.spriteHookBodies);
  await loadInto(shader.skyHooks, layer.skyHookBodies);
  return layer;
}

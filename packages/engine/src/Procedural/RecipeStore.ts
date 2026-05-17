/**
 * Pack-load recipe registry.
 *
 * `RecipeStore` parses every `manifest.recipes[<id>]` entry from a
 * pack at boot, caching the JSON in memory. The compiler + renderer
 * draw against this store lazily — compilation only happens on the
 * first `api.procedural.load(recipeId)` call (IL2 spec — IMAGE_LAB.md
 * §6.5).
 *
 * The store also accepts loose `recipes/<id>.recipe.json` files
 * discovered on the pack file list, so packs that haven't yet
 * registered their recipes through `manifest.recipes` still surface
 * for development.
 */

import type { AssetPack } from "../AssetPack";
import type { RecipeDef, RecipeJson } from "./types";

interface ManifestWithRecipes {
  recipes?: Record<string, RecipeDef>;
}

export class RecipeStore {
  /** Recipe id → parsed JSON. Populated lazily on first `get(id)`. */
  private readonly cache = new Map<string, RecipeJson>();
  /** Recipe id → path in the pack. Built at construction time. */
  private readonly index = new Map<string, string>();
  private readonly pack: AssetPack;

  constructor(pack: AssetPack) {
    this.pack = pack;
    const manifest = pack.manifest as unknown as ManifestWithRecipes;

    // Pass 1 — `manifest.recipes` entries (the canonical path).
    if (manifest.recipes && typeof manifest.recipes === "object") {
      for (const [id, def] of Object.entries(manifest.recipes)) {
        if (def && typeof def.file === "string") {
          this.index.set(id, def.file);
        }
      }
    }

    // Pass 2 — discover any pack file ending in `.recipe.json` under
    // `recipes/` that isn't already indexed. Lets pack authors drop
    // a recipe into `recipes/` and have it surface without manifest
    // boilerplate. The id is derived from the filename
    // (`recipes/brick_wall.recipe.json` → `brick_wall`).
    for (const path of pack.listPaths()) {
      if (!path.startsWith("recipes/") || !path.endsWith(".recipe.json")) continue;
      const base = path.slice("recipes/".length, -".recipe.json".length);
      if (!this.index.has(base)) {
        this.index.set(base, path);
      }
    }
  }

  /** True if a recipe id is registered (manifest or filesystem). */
  has(id: string): boolean {
    return this.index.has(id);
  }

  /** Every registered recipe id. Useful for editor surfaces. */
  ids(): string[] {
    return [...this.index.keys()];
  }

  /**
   * Resolve a recipe by id. Parses + caches the JSON on first call.
   * Returns `null` if the id isn't registered (mismatch / typo).
   *
   * The cache survives the session — recipe content doesn't change
   * mid-run (editor reloads bypass this path entirely; pack reloads
   * rebuild the store).
   */
  async get(id: string): Promise<RecipeJson | null> {
    const cached = this.cache.get(id);
    if (cached) return cached;
    const path = this.index.get(id);
    if (!path) return null;
    if (!this.pack.has(path)) {
      console.warn(`[procedural] recipe "${id}" indexed at "${path}" but not in pack files`);
      return null;
    }
    let text: string;
    try {
      text = await this.pack.textBody(path);
    } catch (err) {
      console.warn(`[procedural] failed to read recipe "${id}" (${path}): ${(err as Error).message}`);
      return null;
    }
    let parsed: RecipeJson;
    try {
      parsed = JSON.parse(text) as RecipeJson;
    } catch (err) {
      console.warn(`[procedural] recipe "${id}" has invalid JSON: ${(err as Error).message}`);
      return null;
    }
    // Force `id` to match the registry key — packs occasionally ship
    // recipes whose internal `id` lags behind the filename rename.
    if (!parsed.id) parsed.id = id;
    this.cache.set(id, parsed);
    return parsed;
  }
}

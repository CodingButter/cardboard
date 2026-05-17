/**
 * Public-API entry point — what `api.procedural` returns.
 *
 * `ProceduralAPIImpl` owns:
 *
 *   - The `RecipeStore` (pack-scanned + lazy-parsed).
 *   - The `ProceduralRenderer` (offscreen WebGL2 context).
 *   - The `ProceduralIDBCache` (rendered-pixel sidecar).
 *
 * `load(id)` is the hot path: lookup → compile → cache check → bake
 * → IDB store → return. `loadAnimated(id)` collapses to a frame-0
 * bake for IL2 with the spritesheet shape stable for IL4.
 *
 * The renderer is lazily constructed because acquiring a WebGL2
 * context is comparatively expensive (~1 ms) and many sessions never
 * touch a procedural recipe. The store, by contrast, builds eagerly
 * — it just inspects the pack manifest + file list.
 */

import type { AssetPack } from "../AssetPack";
import { RecipeStore } from "./RecipeStore";
import { ProceduralRenderer } from "./Renderer";
import { ProceduralIDBCache } from "./IDBCache";
import { compileRecipe, type CompiledRecipe } from "./Compiler";
import { bakeAnimated } from "./AnimatedBaker";
import type { BakedRecipe, RecipeJson, Spritesheet } from "./types";

/**
 * Modding surface for procedural image recipes — IL2 of
 * `docs/plans/IMAGE_LAB.md`.
 *
 * `load(recipeId)` is the static path: returns one `WebGLTexture`
 * baked at the recipe's declared size. `loadAnimated(recipeId)`
 * returns a `Spritesheet` whose `frameCount` is the number of frames
 * in the bake (1 for IL2; > 1 once IL4 lands).
 */
export interface ProceduralAPI {
  /**
   * Compile + bake the recipe `recipeId` if not already cached, and
   * return the resulting WebGL texture (uploaded on the procedural
   * renderer's context). Returns `null` if the recipe id isn't
   * registered.
   */
  load(recipeId: string, opts?: { instanceSeed?: number }): Promise<BakedRecipe | null>;

  /**
   * Animated counterpart. IL2 collapses to a single-frame bake; the
   * returned `Spritesheet.frameCount` will be 1 until IL4 ships
   * per-frame keyframe scrubbing.
   */
  loadAnimated(
    recipeId: string,
    opts?: { instanceSeed?: number },
  ): Promise<Spritesheet | null>;

  /** Enumerate every registered recipe id. */
  list(): readonly string[];

  /** Whether `recipeId` exists in the pack's registry. */
  has(recipeId: string): boolean;
}

interface ProceduralCacheEntry {
  baked: BakedRecipe;
  /** Compiled program reference — kept so cache-hit re-uploads can also short-circuit recompile. */
  compiled: CompiledRecipe;
}

export class ProceduralAPIImpl implements ProceduralAPI {
  private readonly store: RecipeStore;
  private readonly cache: ProceduralIDBCache;
  /** In-memory cache of baked recipes — survives the session. */
  private readonly memoryCache = new Map<string, ProceduralCacheEntry>();
  /** Lazily-constructed offscreen renderer. */
  private renderer: ProceduralRenderer | null = null;

  constructor(pack: AssetPack) {
    this.store = new RecipeStore(pack);
    this.cache = new ProceduralIDBCache();
  }

  list(): readonly string[] {
    return this.store.ids();
  }

  has(recipeId: string): boolean {
    return this.store.has(recipeId);
  }

  async load(
    recipeId: string,
    opts: { instanceSeed?: number } = {},
  ): Promise<BakedRecipe | null> {
    const recipe = await this.store.get(recipeId);
    if (!recipe) {
      console.warn(`[procedural] unknown recipe id "${recipeId}"`);
      return null;
    }
    const compiled = this.compileForBake(recipe, opts.instanceSeed);
    const memoKey = compiled.hash;
    const memHit = this.memoryCache.get(memoKey);
    if (memHit) return memHit.baked;

    const renderer = this.ensureRenderer();
    const cached = await this.cache.get(recipeId, compiled.hash);
    let baked: BakedRecipe;
    if (cached) {
      // Cache hit — skip GLSL compile + render. Just re-upload bytes.
      const texture = renderer.uploadFromPixels(cached.width, cached.height, cached.pixels);
      baked = {
        id: recipeId,
        width: cached.width,
        height: cached.height,
        pixels: cached.pixels,
        texture,
        hash: compiled.hash,
      };
    } else {
      baked = renderer.bake(compiled, { instanceSeed: opts.instanceSeed });
      // Fire-and-forget — don't block the bake on the IDB write.
      void this.cache.put(recipeId, compiled.hash, {
        width: baked.width,
        height: baked.height,
        pixels: baked.pixels,
      });
    }
    this.memoryCache.set(memoKey, { baked, compiled });
    return baked;
  }

  async loadAnimated(
    recipeId: string,
    opts: { instanceSeed?: number } = {},
  ): Promise<Spritesheet | null> {
    const recipe = await this.store.get(recipeId);
    if (!recipe) {
      console.warn(`[procedural] unknown recipe id "${recipeId}"`);
      return null;
    }
    const compiled = this.compileForBake(recipe, opts.instanceSeed);
    const renderer = this.ensureRenderer();
    // IL2 still routes through the cache for the frame-0 bake.
    const cached = await this.cache.get(recipeId, compiled.hash);
    if (cached) {
      const texture = renderer.uploadFromPixels(cached.width, cached.height, cached.pixels);
      return {
        id: recipeId,
        frameWidth: cached.width,
        frameHeight: cached.height,
        cols: 1,
        rows: 1,
        frameCount: 1,
        duration: recipe.animation?.duration ?? 0,
        pixels: cached.pixels,
        texture,
        hash: compiled.hash,
      };
    }
    const sheet = bakeAnimated(renderer, compiled, recipe.animation, {
      instanceSeed: opts.instanceSeed,
    });
    void this.cache.put(recipeId, compiled.hash, {
      width: sheet.frameWidth * sheet.cols,
      height: sheet.frameHeight * sheet.rows,
      pixels: sheet.pixels,
    });
    return sheet;
  }

  /** Drop the in-memory cache (e.g. on scene unload / HMR). */
  dispose(): void {
    if (this.renderer) {
      this.renderer.dispose();
      this.renderer = null;
    }
    this.memoryCache.clear();
  }

  private compileForBake(recipe: RecipeJson, instanceSeed: number | undefined): CompiledRecipe {
    // `instanceSeed` rides via uniform — it never enters the
    // compile-time seed. That keeps the IDB cache key tied to the
    // recipe-level seed; per-instance variance is a runtime
    // distinguisher tracked separately (IL2 scope: no per-instance
    // caching, every call routes through the same compiled program).
    return compileRecipe(recipe);
  }

  private ensureRenderer(): ProceduralRenderer {
    if (!this.renderer) {
      this.renderer = new ProceduralRenderer();
    }
    return this.renderer;
  }
}

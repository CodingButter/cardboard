/**
 * Sound recipe registry. SOUND_LAB.md §6.6.
 *
 * Owns the procedural audio surface for a single pack:
 *
 *   - Parses every `recipes/*.sound.json` in the pack at boot.
 *   - Validates them at compile time. Bad recipes log + are dropped.
 *   - Lazily renders static + loop recipes via `renderRecipeOffline`
 *     on first `load(id)` call. Render → IDB cache → AudioBuffer.
 *   - Holds an in-memory `AudioBuffer` cache so subsequent loads hit
 *     RAM (no IDB round-trip).
 *   - For instrument recipes, holds the parsed JSON and instantiates
 *     a per-recipe `InstrumentVoicePool` on first `playInstrument`.
 *
 * The runtime engine queries this store FROM inside `AudioRegistry.play`
 * (per SL2 §6.6 + §12 Q11): recipe-ids resolve before manifest sound
 * ids, so a pack that ships both can transparently swap a hand-authored
 * sample for a procedural variant.
 */

import type { AssetPack } from "../AssetPack";
import type { PlayInstrumentOpts, SoundRecipeJson } from "./types";
import { renderRecipeOffline } from "./OfflineRenderer";
import { InstrumentVoicePool } from "./LiveInstrument";

interface StoredRecipe {
  recipe: SoundRecipeJson;
  /** RAM cache. Only populated for static + loop recipes after first load. */
  buffer: AudioBuffer | Promise<AudioBuffer> | null;
  /** Lazily-allocated voice pool. Only for instrument-mode recipes. */
  pool: InstrumentVoicePool | null;
}

/** Recipe-file path convention from SOUND_LAB.md SL2 + the brief. */
const RECIPE_PATH_RE = /(?:^|\/)recipes\/.+\.sound\.json$/i;

export class RecipeStore {
  private readonly recipes = new Map<string, StoredRecipe>();
  private loaded = false;

  /** Recipe ids currently registered. */
  ids(): readonly string[] {
    return [...this.recipes.keys()];
  }

  /** Whether a recipe with this id is known. */
  has(id: string): boolean {
    return this.recipes.has(id);
  }

  /** Lookup a parsed recipe. Returns `undefined` on miss. */
  get(id: string): SoundRecipeJson | undefined {
    return this.recipes.get(id)?.recipe;
  }

  /**
   * Scan the pack for `recipes/*.sound.json` files and register every
   * valid one. Idempotent — subsequent calls are no-ops. Errors are
   * logged + skipped; one bad recipe doesn't take down the others.
   *
   * Packs without any matching files load fine — the store stays
   * empty and the audio resolver falls through to `manifest.audio`.
   */
  async loadFromPack(pack: AssetPack): Promise<void> {
    if (this.loaded) return;
    this.loaded = true;
    const paths = pack.listPaths().filter((p) => RECIPE_PATH_RE.test(p));
    for (const path of paths) {
      try {
        const text = await pack.textBody(path);
        const json = JSON.parse(text) as SoundRecipeJson;
        if (!json || typeof json !== "object") {
          console.warn(`[procedural-audio] ${path}: not an object`);
          continue;
        }
        if (typeof json.id !== "string" || !json.id) {
          console.warn(`[procedural-audio] ${path}: missing string "id"`);
          continue;
        }
        if (json.mode !== "static" && json.mode !== "loop" && json.mode !== "instrument") {
          console.warn(`[procedural-audio] ${path}: invalid mode "${json.mode}"`);
          continue;
        }
        if (!Array.isArray(json.nodes)) {
          console.warn(`[procedural-audio] ${path}: missing nodes array`);
          continue;
        }
        if (this.recipes.has(json.id)) {
          // Per SOUND_LAB.md §6.6 — collisions log + last-write-wins
          // (matching `manifest.audio`).
          console.warn(`[procedural-audio] recipe id "${json.id}" already registered; replacing`);
        }
        this.recipes.set(json.id, { recipe: json, buffer: null, pool: null });
      } catch (err) {
        console.warn(`[procedural-audio] failed to load recipe ${path}:`, err);
      }
    }
    if (this.recipes.size > 0) {
      console.log(
        `[two_5_d] procedural-audio: registered ${this.recipes.size} sound recipe(s)`,
      );
    }
  }

  /**
   * Resolve a recipe's rendered buffer. Static + loop modes only;
   * instrument-mode recipes return `null` (they have no bake — voices
   * instantiate live). Returns `null` for unknown ids so callers can
   * fall through to a different resolver.
   */
  async loadBuffer(id: string, ctx: BaseAudioContext): Promise<AudioBuffer | null> {
    const stored = this.recipes.get(id);
    if (!stored) return null;
    if (stored.recipe.mode === "instrument") return null;

    if (stored.buffer) {
      return Promise.resolve(stored.buffer);
    }
    const promise = renderRecipeOffline(stored.recipe, ctx);
    stored.buffer = promise;
    try {
      const buf = await promise;
      stored.buffer = buf;
      return buf;
    } catch (err) {
      console.warn(`[procedural-audio] render failed for "${id}":`, err);
      stored.buffer = null;
      return null;
    }
  }

  /**
   * Trigger an instrument-mode voice. The voice is allocated against
   * the live AudioContext + group gain provided by the audio backend.
   * Returns `null` for unknown ids or non-instrument recipes; the
   * caller is expected to fall back through other audio paths.
   *
   * The returned object is the compiled voice — caller can read its
   * `.dispose` to stop early, or let the pool's GC sweep handle it.
   */
  triggerInstrument(
    id: string,
    ctx: AudioContext,
    groupGain: AudioNode,
    opts: PlayInstrumentOpts,
  ): { dispose(): void } | null {
    const stored = this.recipes.get(id);
    if (!stored) return null;
    if (stored.recipe.mode !== "instrument") {
      console.warn(
        `[procedural-audio] playInstrument("${id}") called on non-instrument recipe (mode="${stored.recipe.mode}")`,
      );
      return null;
    }
    if (!stored.pool) stored.pool = new InstrumentVoicePool(stored.recipe);
    return stored.pool.trigger(ctx, groupGain, opts);
  }

  /** Tear down all outstanding instrument voices. */
  dispose(): void {
    for (const stored of this.recipes.values()) {
      stored.pool?.stopAll();
    }
  }
}

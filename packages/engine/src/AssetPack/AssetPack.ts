import { Scene, type SceneJSON } from "Scene";
import { PresetResolver } from "./PresetResolver";
import type { PackManifest } from "./types";

/**
 * Abstract pack interface. The engine consumes only these methods.
 */
export abstract class AssetPack {
  abstract readonly manifest: PackManifest;
  /** Read a binary asset (image, sound, etc.) as a `Blob`. */
  abstract textureBlob(path: string): Promise<Blob>;
  /** Read a text asset (json, glsl, js) as a string. */
  abstract textBody(path: string): Promise<string>;
  /** `true` if a path exists in the pack. */
  abstract has(path: string): boolean;

  /**
   * Enumerate every asset path stored in the pack (manifest.json
   * included). Used by editor tooling — specifically the chain
   * conflict detector (`apps/editor/src/lib/chainConflictDetector.ts`)
   * — to walk the file set without having to know which backing
   * subclass is in play.
   *
   * Order is implementation-defined and not stable across runs;
   * callers that need a stable order should sort the result. The
   * default implementation returns an empty array so subclasses
   * that haven't been upgraded yet still construct.
   */
  listPaths(): string[] {
    return [];
  }

  /**
   * Read a binary asset (sound, font, arbitrary bytes) as a raw
   * `ArrayBuffer` — the form `AudioContext.decodeAudioData` consumes
   * directly. Au1 of `docs/plans/AUDIO.md` §5.4.
   *
   * Default implementation delegates to `textureBlob` and unwraps to
   * an `ArrayBuffer`; subclasses that have a cheaper byte-level
   * accessor (e.g. `ZipAssetPack`'s in-memory `Uint8Array`) override
   * this to skip the Blob round-trip.
   */
  async binaryBlob(path: string): Promise<ArrayBuffer> {
    const blob = await this.textureBlob(path);
    return await blob.arrayBuffer();
  }

  /**
   * Lazily-built tile-preset resolver. Loads every file listed in
   * `manifest.tilePresets[]`, synthesises legacy presets for any
   * `manifest.tileTextures` entries, and exposes a flat lookup the
   * renderer + scene loader share.
   *
   * Built once per pack, then cached. Scene loading reads through it
   * to translate preset IDs into the renderer's tile-id world. See
   * `docs/plans/TILE_PRESETS.md` § 6.
   */
  private _presets?: Promise<PresetResolver>;
  presets(): Promise<PresetResolver> {
    if (!this._presets) {
      this._presets = PresetResolver.build(
        this.manifest,
        this.manifest.name,
        (path) => this.textBody(path),
      ).then((resolver) => {
        // Surface preset-load diagnostics once, immediately after the
        // resolver builds. The pack-builder is the hard gate (T3 of
        // TILE_PRESETS.md §13): if errors got through to runtime the
        // pack was loaded without going through `bun run build-packs`,
        // so we still load the pack but loudly console.error each
        // problem so developers see them while iterating.
        if (resolver.errors.length > 0) {
          for (const e of resolver.errors) {
            const keyPath = e.keyPath && e.keyPath.length > 0 ? e.keyPath.join(".") : "(file)";
            const where = e.presetId
              ? `${e.file}:${e.presetId}:${keyPath}`
              : `${e.file}:${keyPath}`;
            const suggestion = e.suggestion ?? e.hint;
            const hint = suggestion ? `  (did you mean "${suggestion}"?)` : "";
            console.error(`[preset] ${e.packId} ${where}: ${e.message}${hint}`);
          }
        }
        return resolver;
      });
    }
    return this._presets;
  }

  /**
   * Parse a scene JSON file inside the pack into a `Scene`. Used by the
   * bootstrap to load `manifest.startScene`, and available to gameplay
   * code that wants to switch levels later.
   *
   * The resolver is consulted up front so scenes whose grids reference
   * preset ids via `idMap` resolve into the renderer's tile-id world
   * transparently. Legacy scenes (no `idMap`) skip the resolver
   * lookups entirely — `Scene.fromJSON` falls through to its existing
   * bare-int parsing.
   */
  async scene(path: string): Promise<Scene> {
    const text = await this.textBody(path);
    let data: SceneJSON;
    try {
      data = JSON.parse(text) as SceneJSON;
    } catch (err) {
      throw new Error(`Scene ${path}: invalid JSON — ${(err as Error).message}`);
    }
    const resolver = await this.presets();
    return Scene.fromJSON(data, undefined, resolver);
  }

  /** Convenience: load the scene named in `manifest.startScene`. */
  async startScene(): Promise<Scene> {
    const startScenePath = this.manifest.startScene;
    if (!startScenePath) {
      throw new Error(
        `Pack ${this.manifest.id ?? this.manifest.name} has no startScene` +
          ` declared — startScene() is only valid for game-scope packs.`,
      );
    }
    return this.scene(startScenePath);
  }

  /**
   * Read the pack's `config.json` (if `manifest.config` is set) and
   * return the parsed object. Returns `null` when the pack doesn't
   * override config. The caller is responsible for deep-merging.
   */
  async config(): Promise<unknown | null> {
    const path = this.manifest.config;
    if (!path) return null;
    const text = await this.textBody(path);
    try {
      return JSON.parse(text);
    } catch (err) {
      throw new Error(`Config ${path}: invalid JSON — ${(err as Error).message}`);
    }
  }

  /**
   * Read a series of script paths (post-WORLD_STATE "world.json
   * full-scope"). Caller resolves paths from `world.json.scripts[]`
   * and any `Scripts.refs[]` carried by world / scene / scene-entity
   * records, then hands them here for batch text loading. Returns an
   * array of `{ path, source }` so the caller can wire up Blob URLs +
   * dynamic imports. Order is preserved — scripts run in caller order.
   */
  async readScripts(
    paths: ReadonlyArray<string>,
  ): Promise<Array<{ path: string; source: string }>> {
    const out: Array<{ path: string; source: string }> = [];
    for (const path of paths) {
      const source = await this.textBody(path);
      out.push({ path, source });
    }
    return out;
  }
}

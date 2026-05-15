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
    return this.scene(this.manifest.startScene);
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
   * Read all script paths listed in `manifest.scripts`. Returns an array
   * of `{ path, source }` so the caller can wire up Blob URLs + dynamic
   * imports. Order is preserved — scripts run in manifest order.
   */
  async scripts(): Promise<Array<{ path: string; source: string }>> {
    const paths = this.manifest.scripts ?? [];
    const out: Array<{ path: string; source: string }> = [];
    for (const path of paths) {
      const source = await this.textBody(path);
      out.push({ path, source });
    }
    return out;
  }
}

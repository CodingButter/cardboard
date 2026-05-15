import { Scene, type SceneJSON } from "Scene";
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
   * Parse a scene JSON file inside the pack into a `Scene`. Used by the
   * bootstrap to load `manifest.startScene`, and available to gameplay
   * code that wants to switch levels later.
   */
  async scene(path: string): Promise<Scene> {
    const text = await this.textBody(path);
    let data: SceneJSON;
    try {
      data = JSON.parse(text) as SceneJSON;
    } catch (err) {
      throw new Error(`Scene ${path}: invalid JSON — ${(err as Error).message}`);
    }
    return Scene.fromJSON(data);
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

import type { AssetPack } from "AssetPack";

/**
 * Per-path cache of the resolved default export of a pack script.
 * Used by `Systems` + `Scripts` component handling (WORLD_STATE.md
 * §7 + §8) so multiple entities referencing the same script body
 * pay the dynamic-import cost once.
 *
 * Keyed by pack-relative path. Survives entity attach/detach so
 * re-attaching the same `Systems`-component entry skips the
 * second import.
 */
export class ScriptLoader {
  private readonly cache = new Map<string, Promise<unknown>>();
  private readonly pack: AssetPack;

  constructor(pack: AssetPack) {
    this.pack = pack;
  }

  /**
   * Resolve a pack-relative script path to its default export. The
   * script source is fetched via `pack.textBody`, wrapped in a Blob
   * URL, dynamic-imported, and its `default` (or named `default`
   * export from CJS-style modules) returned.
   *
   * Returns `undefined` if the script doesn't have a default export
   * the engine can call. The caller decides how to handle that —
   * `Systems` warns + skips, `Scripts` warns + skips.
   */
  async load(path: string): Promise<unknown> {
    const cached = this.cache.get(path);
    if (cached !== undefined) return cached;
    const promise = this.loadFresh(path);
    this.cache.set(path, promise);
    return promise;
  }

  private async loadFresh(path: string): Promise<unknown> {
    let source: string;
    try {
      source = await this.pack.textBody(path);
    } catch (err) {
      console.error(`[script-loader] failed to fetch "${path}":`, err);
      return undefined;
    }
    const blob = new Blob([source], { type: "application/javascript" });
    const url = URL.createObjectURL(blob);
    try {
      const mod = (await import(/* @vite-ignore */ url)) as Record<string, unknown>;
      const fn = mod.default ?? mod.setup;
      if (typeof fn !== "function") {
        console.warn(
          `[script-loader] "${path}" has no default export (or setup function) — skipping`,
        );
        return undefined;
      }
      return fn;
    } catch (err) {
      console.error(`[script-loader] failed to import "${path}":`, err);
      return undefined;
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  /** Drop the cache (HMR reload). */
  clear(): void {
    this.cache.clear();
  }
}

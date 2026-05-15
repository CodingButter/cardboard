import { AssetPack } from "AssetPack";
import type { PackManifest } from "@two_5_d/engine";
import { EditorProjectStore } from "./EditorProjectStore";

/**
 * IDB-backed pack adapter.
 *
 * Implements the abstract `AssetPack` surface (`textureBlob`,
 * `textBody`, `has`, `manifest`) on top of `EditorProjectStore` so the
 * engine can boot directly against an in-IDB editor project. The
 * concrete `AssetPack` base provides `.scene(path)`, `.startScene()`,
 * `.config()`, `.scripts()`, and `.presets()` for free — they all
 * route through the three abstract methods we override here.
 *
 * See `docs/plans/EDITOR.md` §3 for the spec this satisfies. E2 only
 * needs read-only consumption; live mutation (paint a tile, save,
 * re-render) ships in E3 and lands on top of this same surface.
 *
 * Construction is async (the manifest + asset-path index live in IDB),
 * so callers go through `EditorAssetPack.fromProject(projectId)`. The
 * private constructor mirrors `ZipAssetPack`'s pattern — the public
 * factory does the awaits, then hands a fully-formed pack back.
 *
 * No internal caching. The engine wraps `textureBlob` results in
 * `URL.createObjectURL` at point of use and the renderer maintains its
 * own decode cache; double-caching here would just bloat memory and
 * defeat write-through invalidation when the editor mutates an asset.
 */
export class EditorAssetPack extends AssetPack {
  readonly manifest: PackManifest;

  /** Project id this pack is bound to — used for every IDB lookup. */
  readonly projectId: string;

  /** In-memory mirror of every asset path in the project. */
  private readonly paths: Set<string>;

  /**
   * Store reference — defaults to the module-level singleton but
   * accepts an injected one so tests (the smoke script) can plug in
   * a `fake-indexeddb`-backed instance without globally mutating.
   */
  private readonly store: typeof EditorProjectStore;

  private constructor(
    projectId: string,
    manifest: PackManifest,
    paths: Iterable<string>,
    store: typeof EditorProjectStore,
  ) {
    super();
    this.projectId = projectId;
    this.manifest = manifest;
    this.paths = new Set(paths);
    this.store = store;
  }

  /**
   * Build a pack rooted at `projectId`. Loads the manifest + the path
   * index in parallel; throws if the project (or its manifest) doesn't
   * exist so the caller can surface a useful error instead of letting
   * the engine fall over on an undefined manifest later.
   */
  static async fromProject(
    projectId: string,
    store: typeof EditorProjectStore = EditorProjectStore,
  ): Promise<EditorAssetPack> {
    const [manifest, assets] = await Promise.all([
      store.loadManifest(projectId),
      store.listAssets(projectId),
    ]);
    if (!manifest) {
      throw new Error(
        `EditorAssetPack.fromProject: no manifest for project ${projectId}`,
      );
    }
    return new EditorAssetPack(
      projectId,
      manifest,
      assets.map((a) => a.path),
      store,
    );
  }

  has(path: string): boolean {
    return this.paths.has(path);
  }

  async textBody(path: string): Promise<string> {
    const body = await this.store.loadAsset(this.projectId, path);
    if (body === null) {
      throw new Error(
        `EditorAssetPack.textBody: ${path} not found in project ${this.projectId}`,
      );
    }
    if (typeof body === "string") return body;
    // The store decides text-vs-blob from the path extension; if a
    // caller asks for textBody on something stored as a blob (e.g.
    // someone manually saved a `.txt` payload as a Blob) decode it
    // here so the engine still gets a string. `Response.text()` is
    // the cheapest portable decode path on both browser + Bun.
    return new Response(body).text();
  }

  async textureBlob(path: string): Promise<Blob> {
    const body = await this.store.loadAsset(this.projectId, path);
    if (body === null) {
      throw new Error(
        `EditorAssetPack.textureBlob: ${path} not found in project ${this.projectId}`,
      );
    }
    if (body instanceof Blob) return body;
    // Mirror image of `textBody`'s coercion — if a caller stored a
    // string under a binary path, wrap it on the way out so the
    // engine's `URL.createObjectURL` consumer doesn't blow up.
    return new Blob([body]);
  }
}

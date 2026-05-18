import { AssetPack } from "./AssetPack";
import type { PackManifest } from "./types";

/**
 * Pack backed by a downloaded `.apg` zip file. Decoded once at `load`
 * time; subsequent asset reads are in-memory byte slices.
 */
export class ZipAssetPack extends AssetPack {
  readonly manifest: PackManifest;
  private readonly files: Map<string, Uint8Array>;

  private constructor(manifest: PackManifest, files: Map<string, Uint8Array>) {
    super();
    this.manifest = manifest;
    this.files = files;
  }

  /**
   * Fetch and decode a `.apg` from `url`. Resolves once the manifest is
   * parsed and all files are indexed; rejects on network errors,
   * malformed zips, or missing/invalid `manifest.json`.
   */
  static async load(url: string): Promise<ZipAssetPack> {
    const { rewriteCorsHostileUrl } = await import("./rewriteUrl");
    const fetchUrl = rewriteCorsHostileUrl(url);
    const res = await fetch(fetchUrl);
    if (!res.ok) throw new Error(`Failed to fetch pack ${url} (${res.status})`);
    const buffer = await res.arrayBuffer();
    return ZipAssetPack.loadFromBytes(new Uint8Array(buffer), url);
  }

  /**
   * Decode a `.apg` from raw bytes already in memory. Lets the chain
   * resolver fetch + hash + verify SRI integrity before paying the
   * unzip cost, and lets tests / smoke scripts construct a pack from
   * an inline buffer. `source` is purely for error messages; it's the
   * URL or filename the bytes came from.
   */
  static async loadFromBytes(bytes: Uint8Array, source = "<bytes>"): Promise<ZipAssetPack> {
    // Dynamic import keeps jszip out of the main bundle until a real
    // pack URL is supplied.
    const { default: JSZip } = await import("jszip");
    const zip = await JSZip.loadAsync(bytes);

    const files = new Map<string, Uint8Array>();
    for (const [name, entry] of Object.entries(zip.files)) {
      if (entry.dir) continue;
      files.set(name, await entry.async("uint8array"));
    }

    const manifestBytes = files.get("manifest.json");
    if (!manifestBytes) throw new Error(`Pack ${source} is missing manifest.json`);
    let manifest: PackManifest;
    try {
      manifest = JSON.parse(new TextDecoder().decode(manifestBytes)) as PackManifest;
    } catch (err) {
      throw new Error(`Pack ${source} has invalid manifest.json: ${err}`);
    }

    // Per-item world-sprite synthesis used to live here (auto-register
    // `<image>.world.<ext>` siblings as `manifest.sprites[itemId]`).
    // After the items move into pack data (`data/items.json`, loaded by
    // `scripts/setup/load-items.js`), the manifest no longer carries
    // an `items` map — packs that want this convenience now perform the
    // synth themselves during their item-loader script via
    // `api.itemImages.pathFor(...)` + an `api.spriteRegistry.register`
    // (follow-up). The default pack declares `worldSpriteId` explicitly
    // in `data/items.json`, so removing the synth here is a no-op for
    // it.
    return new ZipAssetPack(manifest, files);
  }

  async textureBlob(path: string): Promise<Blob> {
    const bytes = this.files.get(path);
    if (!bytes) throw new Error(`Pack missing ${path}`);
    return new Blob([bytes as BlobPart]);
  }

  override async binaryBlob(path: string): Promise<ArrayBuffer> {
    const bytes = this.files.get(path);
    if (!bytes) throw new Error(`Pack missing ${path}`);
    // Copy into a freshly-allocated ArrayBuffer — `decodeAudioData`
    // takes ownership of the buffer (detaches it), and we want every
    // call to `binaryBlob` for the same path to succeed (the pack's
    // own `Uint8Array` must NOT be detached).
    const copy = new ArrayBuffer(bytes.byteLength);
    new Uint8Array(copy).set(bytes);
    return copy;
  }

  async textBody(path: string): Promise<string> {
    const bytes = this.files.get(path);
    if (!bytes) throw new Error(`Pack missing ${path}`);
    return new TextDecoder().decode(bytes);
  }

  has(path: string): boolean {
    return this.files.has(path);
  }

  override listPaths(): string[] {
    return Array.from(this.files.keys());
  }
}

import { AssetPack } from "./AssetPack";
import { discoverItemVariants } from "./discoverItemVariants";
import type { PackManifest, SpriteDef } from "./types";

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

    // Auto-register sprite atlas entries for any item that ships a
    // `.world.<ext>` sibling but doesn't have one explicitly assigned.
    // Lets mods spawn pickups with `imageId: itemId` directly without
    // having to author a separate `manifest.sprites` entry.
    const has = (p: string): boolean => files.has(p);
    const sprites: Record<string, SpriteDef> = { ...(manifest.sprites ?? {}) };
    for (const [itemId, def] of Object.entries(manifest.items ?? {})) {
      if (def.worldSpriteId) continue;
      if (sprites[itemId]) continue; // honour an existing sprite of the same name
      const variants = discoverItemVariants(has, def.image);
      const worldPath = variants.world;
      if (worldPath) {
        sprites[itemId] = { image: worldPath };
        // Mutate the item def so callers that read worldSpriteId pick up
        // the synthesized id without further wiring.
        def.worldSpriteId = itemId;
      }
    }
    manifest.sprites = sprites;

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
}

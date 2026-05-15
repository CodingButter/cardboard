import type { AssetPack } from "AssetPack";
import { discoverItemVariants, ITEM_IMAGE_VARIANTS, type ItemImageVariant } from "AssetPack";

export { ITEM_IMAGE_VARIANTS };
export type { ItemImageVariant };

/**
 * Fallback chain when a requested variant isn't available. Walked in
 * order until one is found. `bare` is the manifest's `image` field
 * after stripping any variant suffix, so it acts as the final
 * "anything that loaded" fallback.
 */
const FALLBACK_CHAIN: ReadonlyArray<ItemImageVariant | "bare"> = [
  "icon",
  "held",
  "world",
  "bare",
];

/** Internal storage key shape: `${itemId}:${variant}` (variant includes "bare"). */
type StorageKey = `${string}:${ItemImageVariant | "bare"}`;

/**
 * Decoded `HTMLImageElement` per item id + variant, loaded once at
 * boot. Variant discovery follows the filename suffix convention
 * above so authors don't have to spell out every path in the manifest.
 *
 * `get(itemId)` defaults to the icon variant — that's what every
 * inventory call site wants. Pass `"held"` for the viewmodel or
 * `"world"` for the ground-pickup sprite. Missing variants walk the
 * fallback chain.
 *
 * Renderers that need their own resolution (sprite atlas in the world
 * renderers) preload from `manifest.sprites` directly; this class is
 * for HUD-style 2D blits.
 */
export default class ItemImages {
  private readonly images: Map<StorageKey, HTMLImageElement> = new Map();
  /**
   * Per-item resolved file paths, discovered synchronously at boot.
   * Exposed so other systems can introspect (e.g. the world-sprite
   * registrar can ask "does this item have a world variant?").
   */
  private readonly paths: Map<string, Partial<Record<ItemImageVariant | "bare", string>>> = new Map();

  constructor(private readonly pack: AssetPack) {
    const items = pack.manifest.items ?? {};
    const has = (p: string): boolean => pack.has(p);
    for (const [id, def] of Object.entries(items)) {
      const resolved = discoverItemVariants(has, def.image);
      // Explicit `weapon.viewmodelImage` wins over any auto-discovered
      // `.held` sibling — it's the legacy override hook.
      const viewmodelOverride = def.weapon?.viewmodelImage;
      if (viewmodelOverride && pack.has(viewmodelOverride)) {
        resolved.held = viewmodelOverride;
      }
      this.paths.set(id, resolved);
      for (const [key, path] of Object.entries(resolved)) {
        if (path) this.load(`${id}:${key as ItemImageVariant | "bare"}`, path);
      }
    }
  }

  private load(key: StorageKey, path: string): void {
    this.pack
      .textureBlob(path)
      .then((blob) => {
        const url = URL.createObjectURL(blob);
        const img = new Image();
        img.onload = () => {
          this.images.set(key, img);
        };
        img.onerror = (err) => {
          URL.revokeObjectURL(url);
          console.warn(`ItemImages: decode ${path} failed for "${key}":`, err);
        };
        img.src = url;
        // Intentionally do NOT revoke the URL on load — `ctx.drawImage`
        // works either way, but `<img src={img.src}>` in JSX re-fetches
        // and would 404 on a revoked URL.
      })
      .catch((err) => {
        console.warn(`ItemImages: fetch ${path} failed for "${key}":`, err);
      });
  }

  /**
   * Decoded image for `itemId` at the requested variant. Defaults to
   * the icon variant (what every inventory call site wants). When the
   * requested variant isn't loaded yet (or doesn't exist for this
   * item), walks the fallback chain
   * `icon → held → world → bare`.
   */
  get(itemId: string, variant: ItemImageVariant = "icon"): HTMLImageElement | undefined {
    const direct = this.images.get(`${itemId}:${variant}`);
    if (direct) return direct;
    for (const v of FALLBACK_CHAIN) {
      if (v === variant) continue;
      const img = this.images.get(`${itemId}:${v}`);
      if (img) return img;
    }
    return undefined;
  }

  /**
   * Resolved file path for `itemId` at `variant` (or undefined when
   * absent). Useful for other subsystems that need to load the same
   * asset themselves — e.g. the sprite registrar pulling the `world`
   * variant into the WebGL atlas.
   */
  pathFor(itemId: string, variant: ItemImageVariant | "bare"): string | undefined {
    return this.paths.get(itemId)?.[variant];
  }
}

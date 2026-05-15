import type { AssetPack } from "./AssetPack";
import { ZipAssetPack } from "./ZipAssetPack";

/** Default pack URL when no `?pack=` is provided. */
export const DEFAULT_PACK_URL = "/packs/default.apg";

/**
 * Load a pack. With no URL, fetches `DEFAULT_PACK_URL` (built by
 * `bun run build-packs` from `resources/packs/default/`). With a URL,
 * fetches that.
 */
export async function loadAssetPack(url?: string | null): Promise<AssetPack> {
  return ZipAssetPack.load(url ?? DEFAULT_PACK_URL);
}

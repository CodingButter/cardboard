import { EditorProjectStore } from "../lib/EditorProjectStore";
import { useTilePresetRegistryStore } from "./useTilePresetRegistryStore";

/**
 * tileTextureCache — async loader + memory cache for the actual texture
 * bitmaps shipped by the active pack.
 *
 * Wave 3.3.15: the preset registry holds a derived `color` per preset
 * for the fallback path (color square while the bitmap loads, or when
 * the texture is missing). This module fills in the other half — it
 * decodes the texture blob out of IDB, caches the resulting
 * `ImageBitmap`, and bumps a small epoch on
 * `useTilePresetRegistryStore` so subscribed canvases re-render and
 * pick up the newly-available bitmap.
 *
 * Design constraints
 *
 *   - Cache key is the pack-relative texture path (e.g.
 *     `"images/tiles/wall.jpg"`). Texture paths don't move between
 *     panels — MapCanvas + Minimap + Preview all key the same path —
 *     so a single global cache is correct.
 *
 *   - In-flight loads are de-duplicated: the second caller for a
 *     path that's currently being loaded gets the SAME promise the
 *     first caller is waiting on. Without this, a 4096-cell render
 *     loop on a freshly-hydrated scene would fire thousands of
 *     parallel IDB reads and `createImageBitmap()` decodes for the
 *     same handful of texture paths.
 *
 *   - Failures (missing asset, decode error) are remembered too —
 *     calling `ensureLoaded()` on a known-failed path is a fast no-op,
 *     not a retry storm. The cache stores `null` for failed loads so
 *     callers can tell "this path is known to be unloadable" apart
 *     from "this path hasn't been requested yet".
 *
 *   - This module does NOT subscribe to the project switch — callers
 *     pass `projectId` in. When the user opens a different project,
 *     `resetTextureCache()` should be called from the hydration path
 *     so we don't show the previous pack's bitmaps against the new
 *     pack's preset paths (which is almost always wrong because
 *     paths happen to collide on `"images/tiles/wall.jpg"`).
 *
 *   - Epoch bumping is done via `setState` on the registry store —
 *     `useTilePresetRegistryStore.texturesEpoch` is the dirty bit
 *     that canvas effects subscribe to. We avoid a second store just
 *     for the epoch because anything reading textures already reads
 *     the registry too.
 */

// ---------------------------------------------------------------------------
// Internal cache state
// ---------------------------------------------------------------------------

/**
 * Cached bitmap (or `null` when the load failed). `undefined` means
 * "never requested" — distinct from `null` ("requested, known-failed")
 * so retry logic can differentiate the two.
 */
const bitmapCache: Map<string, ImageBitmap | null> = new Map();

/** In-flight load promises keyed by texture path. De-dupes parallel
 *  requests for the same path from different cells / different panels. */
const inflight: Map<string, Promise<ImageBitmap | null>> = new Map();

/** Project id the cache is keyed against. When this flips (project
 *  switch) the cache is dropped so stale bitmaps don't bleed across
 *  packs. */
let currentProjectId: string | null = null;

// ---------------------------------------------------------------------------
// Epoch helper
// ---------------------------------------------------------------------------

/**
 * Bump `texturesEpoch` on the registry store. Subscribers (MapCanvas,
 * Minimap, Preview) wire this to their render effect's dep array, so
 * incrementing it triggers exactly one re-render per bitmap arrival.
 *
 * Batched via microtask so a burst of completed loads (initial preload
 * of 4 textures landing back-to-back) doesn't spam the dep chain.
 */
let epochBumpScheduled = false;
function scheduleEpochBump(): void {
  if (epochBumpScheduled) return;
  epochBumpScheduled = true;
  queueMicrotask(() => {
    epochBumpScheduled = false;
    const store = useTilePresetRegistryStore;
    const cur = store.getState().texturesEpoch ?? 0;
    store.setState({ texturesEpoch: cur + 1 });
  });
}

// ---------------------------------------------------------------------------
// Loader
// ---------------------------------------------------------------------------

/**
 * Load + decode the bitmap for `texturePath` against `projectId`. Caches
 * the result (success OR failure). Concurrent calls for the same path
 * de-dupe to a single IDB read + decode.
 *
 * Returns `null` on any failure — caller falls back to color. Never
 * throws (the loader catches its own errors so the per-cell render
 * loop can ignore the promise).
 */
export async function loadTextureBitmap(
  projectId: string,
  texturePath: string,
): Promise<ImageBitmap | null> {
  // Project switch — drop everything. We could keep entries keyed by
  // (projectId, path), but the all-windows-share-one-active-project
  // invariant means we'd just waste memory on bitmaps the user can
  // no longer reach.
  if (currentProjectId !== null && currentProjectId !== projectId) {
    resetTextureCache();
  }
  currentProjectId = projectId;

  // Fast path — already cached (success OR known-failed).
  if (bitmapCache.has(texturePath)) {
    return bitmapCache.get(texturePath) ?? null;
  }

  // Already loading — return the in-flight promise so we don't fire a
  // second IDB read.
  const pending = inflight.get(texturePath);
  if (pending) return pending;

  // Kick off a fresh load + register it for de-duping.
  const promise = (async (): Promise<ImageBitmap | null> => {
    try {
      const body = await EditorProjectStore.loadAsset(projectId, texturePath);
      if (!(body instanceof Blob)) {
        // Either missing (null) or accidentally stored as text (string).
        // Either way, we can't decode it as an image.
        bitmapCache.set(texturePath, null);
        scheduleEpochBump();
        return null;
      }
      const bitmap = await createImageBitmap(body);
      bitmapCache.set(texturePath, bitmap);
      scheduleEpochBump();
      return bitmap;
    } catch {
      // Decode failed (corrupt JPEG, unsupported codec, etc.). Mark
      // known-failed so we don't retry on every render.
      bitmapCache.set(texturePath, null);
      scheduleEpochBump();
      return null;
    } finally {
      inflight.delete(texturePath);
    }
  })();
  inflight.set(texturePath, promise);
  return promise;
}

/**
 * Synchronous lookup — returns the bitmap if it's already cached, or
 * `null` if it's missing / known-failed, or `undefined` if it's never
 * been requested. Hot-path call from the canvas render loop: doesn't
 * trigger an async load, doesn't touch the in-flight map.
 */
export function getTextureBitmap(
  texturePath: string,
): ImageBitmap | null | undefined {
  return bitmapCache.get(texturePath);
}

/**
 * Fire-and-forget load — kick off the async path if the bitmap isn't
 * cached yet, but return immediately. The render loop calls this on
 * every missing texture so the next render frame can pick up the
 * bitmap once it lands (driven by the `texturesEpoch` bump).
 */
export function ensureLoaded(projectId: string, texturePath: string): void {
  if (bitmapCache.has(texturePath)) return;
  if (inflight.has(texturePath)) return;
  void loadTextureBitmap(projectId, texturePath);
}

/**
 * Eagerly preload every texture referenced by the registry. Doesn't
 * block — fire-and-forget Promise.all so the caller (hydration) can
 * move on. As each bitmap lands, `scheduleEpochBump` ticks the
 * registry's `texturesEpoch` so any already-mounted canvases pick the
 * texture up.
 *
 * De-dupes naturally because `ensureLoaded` is a no-op for cached /
 * in-flight paths.
 */
export function preloadFromRegistry(projectId: string): void {
  // Project switch handled by loadTextureBitmap itself; here we just
  // walk the current registry and kick a load per unique texture path.
  if (currentProjectId !== null && currentProjectId !== projectId) {
    resetTextureCache();
  }
  currentProjectId = projectId;

  const presets = useTilePresetRegistryStore.getState().presets;
  const seen = new Set<string>();
  for (const id in presets) {
    const entry = presets[id];
    if (!entry) continue;
    const path = entry.texture;
    if (!path || seen.has(path)) continue;
    seen.add(path);
    ensureLoaded(projectId, path);
  }
}

/**
 * Drop every cached bitmap + in-flight promise. Called on project
 * switch so the next pack's textures don't render against the previous
 * pack's preset paths (which collide on `"images/tiles/wall.jpg"`
 * almost every time).
 *
 * Closes the underlying `ImageBitmap` handles so the GPU memory is
 * actually released — leaving them GC-only would leak across project
 * switches.
 */
export function resetTextureCache(): void {
  for (const bm of bitmapCache.values()) {
    if (bm) {
      try {
        bm.close();
      } catch {
        /* close() is no-op in older Safari; ignore */
      }
    }
  }
  bitmapCache.clear();
  inflight.clear();
  currentProjectId = null;
  scheduleEpochBump();
}

/**
 * Test-only helper — exposes the internal cache state for unit tests
 * without making `bitmapCache` itself part of the public surface.
 */
export function _debugCacheSize(): number {
  return bitmapCache.size;
}

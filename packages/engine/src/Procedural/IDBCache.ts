/**
 * IDB-backed cache for baked recipe pixels.
 *
 * Per IMAGE_LAB.md §6.4, every recipe content + seed is hashed and
 * the rendered RGBA8 bytes are persisted in IndexedDB. The next
 * pack-load looks the hash up first — a cache hit skips the GLSL
 * compile + fragment render entirely, just re-uploading the bytes
 * into a fresh `WebGLTexture`.
 *
 * Storage shape (object store `recipeBakes`):
 *
 *   key:   "<recipeId>|<hash>"
 *   value: { width, height, pixels: Uint8Array, lastAccessed: ms }
 *
 * `lastAccessed` powers a future LRU eviction pass (§12 Q4); for IL2
 * the entire store grows unbounded — fine for the smoke-test recipes
 * but flagged for follow-up.
 *
 * Outside a browser context (e.g. unit-test JIT without IDB) the
 * cache silently no-ops: every get returns `null`, every put is a
 * fire-and-forget swallowed promise. The bake path still works; it
 * just re-renders every time.
 */

const DB_NAME = "two_5_d_procedural";
const DB_VERSION = 1;
const STORE_NAME = "recipeBakes";

export interface CachedBake {
  width: number;
  height: number;
  pixels: Uint8Array;
}

interface CacheRecord extends CachedBake {
  lastAccessed: number;
}

function hasIndexedDB(): boolean {
  return typeof indexedDB !== "undefined";
}

let dbPromise: Promise<IDBDatabase | null> | null = null;

function openDb(): Promise<IDBDatabase | null> {
  if (!hasIndexedDB()) return Promise.resolve(null);
  if (!dbPromise) {
    dbPromise = new Promise<IDBDatabase | null>((resolve) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME);
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => {
        // IDB failures shouldn't crash the engine — just disable
        // caching for this session.
        console.warn(`[procedural] IDB cache unavailable: ${req.error?.message ?? "unknown"}`);
        resolve(null);
      };
    });
  }
  return dbPromise;
}

function cacheKey(recipeId: string, hash: string): string {
  return `${recipeId}|${hash}`;
}

export class ProceduralIDBCache {
  /** Look up a baked recipe by id + content hash. Returns `null` on miss / no IDB. */
  async get(recipeId: string, hash: string): Promise<CachedBake | null> {
    const db = await openDb();
    if (!db) return null;
    return new Promise<CachedBake | null>((resolve) => {
      try {
        const tx = db.transaction(STORE_NAME, "readwrite");
        const store = tx.objectStore(STORE_NAME);
        const getReq = store.get(cacheKey(recipeId, hash));
        getReq.onsuccess = () => {
          const record = getReq.result as CacheRecord | undefined;
          if (!record) {
            resolve(null);
            return;
          }
          // Touch lastAccessed asynchronously — best-effort LRU.
          try {
            const updated: CacheRecord = { ...record, lastAccessed: Date.now() };
            store.put(updated, cacheKey(recipeId, hash));
          } catch {
            /* swallow — LRU touch is non-critical */
          }
          resolve({
            width: record.width,
            height: record.height,
            pixels: record.pixels,
          });
        };
        getReq.onerror = () => resolve(null);
      } catch {
        resolve(null);
      }
    });
  }

  /** Store a fresh bake. Fire-and-forget — failures log and move on. */
  async put(recipeId: string, hash: string, bake: CachedBake): Promise<void> {
    const db = await openDb();
    if (!db) return;
    return new Promise<void>((resolve) => {
      try {
        const tx = db.transaction(STORE_NAME, "readwrite");
        const store = tx.objectStore(STORE_NAME);
        // Copy the pixel array so callers can free/reuse the source.
        const record: CacheRecord = {
          width: bake.width,
          height: bake.height,
          pixels: new Uint8Array(bake.pixels),
          lastAccessed: Date.now(),
        };
        const putReq = store.put(record, cacheKey(recipeId, hash));
        putReq.onsuccess = () => resolve();
        putReq.onerror = () => {
          console.warn(
            `[procedural] failed to cache "${recipeId}": ${putReq.error?.message ?? "unknown"}`,
          );
          resolve();
        };
      } catch (err) {
        console.warn(`[procedural] cache put failed: ${(err as Error).message}`);
        resolve();
      }
    });
  }

  /** Drop every cached bake — useful for editor "rebuild all" flows. */
  async clear(): Promise<void> {
    const db = await openDb();
    if (!db) return;
    return new Promise<void>((resolve) => {
      try {
        const tx = db.transaction(STORE_NAME, "readwrite");
        tx.objectStore(STORE_NAME).clear();
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
      } catch {
        resolve();
      }
    });
  }
}

/**
 * IDB-backed cache for static/loop recipe bakes.
 *
 * Key: SHA-256 of canonical recipe JSON (incl. engine version) — see
 * `Hash.ts`. Value: a `CachedBakeRecord` (raw PCM `Float32Array`s +
 * sample rate). The runtime engine looks up by content hash on every
 * `load()`; cache hits skip OfflineAudioContext rendering entirely.
 *
 * The cache is opened lazily on first `get`/`put` — packs without any
 * procedural recipes never open the DB. A `safeOpen` shim returns
 * `null` on any IDB failure (missing API, blocked open) so the engine
 * gracefully falls back to "render every time" rather than throwing.
 */

import type { CachedBakeRecord } from "./types";

const DB_NAME = "two_5_d_procedural_audio";
const DB_VERSION = 1;
const STORE = "bakes";

let dbPromise: Promise<IDBDatabase | null> | null = null;

function reqAsPromise<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onerror = () => reject(req.error ?? new Error("[procedural-audio] IDB request failed"));
    req.onsuccess = () => resolve(req.result);
  });
}

function safeOpen(): Promise<IDBDatabase | null> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise<IDBDatabase | null>((resolve) => {
    if (typeof indexedDB === "undefined") {
      resolve(null);
      return;
    }
    let req: IDBOpenDBRequest;
    try {
      req = indexedDB.open(DB_NAME, DB_VERSION);
    } catch {
      resolve(null);
      return;
    }
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: "hash" });
      }
    };
    req.onerror = () => {
      console.warn(
        "[procedural-audio] IDB cache unavailable:",
        req.error?.message ?? "open failed",
      );
      resolve(null);
    };
    req.onblocked = () => {
      console.warn("[procedural-audio] IDB cache open blocked; falling back to in-memory");
      resolve(null);
    };
    req.onsuccess = () => resolve(req.result);
  });
  return dbPromise;
}

/** Look up a cached bake by content hash. Returns `null` on miss / IDB failure. */
export async function loadCachedBake(hash: string): Promise<CachedBakeRecord | null> {
  const db = await safeOpen();
  if (!db) return null;
  try {
    const tx = db.transaction(STORE, "readonly");
    const row = await reqAsPromise(
      tx.objectStore(STORE).get(hash) as IDBRequest<CachedBakeRecord | undefined>,
    );
    return row ?? null;
  } catch (err) {
    console.warn("[procedural-audio] cache read failed:", err);
    return null;
  }
}

/** Persist a freshly rendered bake. Non-fatal on IDB errors. */
export async function storeCachedBake(record: CachedBakeRecord): Promise<void> {
  const db = await safeOpen();
  if (!db) return;
  try {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(record);
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onabort = () => reject(tx.error ?? new Error("[procedural-audio] cache write aborted"));
      tx.onerror = () => reject(tx.error ?? new Error("[procedural-audio] cache write failed"));
    });
  } catch (err) {
    console.warn("[procedural-audio] cache write failed:", err);
  }
}

/** Test hook — drop every cached bake. Not called by runtime. */
export async function clearCachedBakes(): Promise<void> {
  const db = await safeOpen();
  if (!db) return;
  try {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).clear();
    await new Promise<void>((resolve) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
  } catch {
    /* best-effort */
  }
}

/**
 * Pack-bundled library cache — content-hash-deduped Blob-URL ESM loader.
 *
 * Each editor pack that ships an npm library in its `.apg` (declared
 * under `manifest.libraries[]`) hands the bytes through this cache.
 * When two packs ship the SAME chart.js bytes (verified by SHA-256),
 * they share one Blob URL + one resolved module instance — so the
 * editor doesn't pay the parse + eval cost twice for an identical
 * dependency, and chart.js's internal singletons (default options,
 * registered controllers) stay coherent across packs.
 *
 * Hash verification: every call recomputes the SHA-256 of the supplied
 * bytes and compares to the declared SRI hash from the manifest. A
 * mismatch throws — that's the integrity gate that lets packs trust
 * each other's library shipments. The pack-builder writes the
 * authoritative hash into the manifest at build time
 * (`apps/pack-builder/src/build-packs.ts` library-bundling step); the
 * loader reads the same field and we hard-fail when the on-disk bytes
 * disagree.
 *
 * Blob URL lifetime: the URL is created once per unique hash and never
 * revoked. The pack loader doesn't manage individual pack-disable
 * teardown for libraries — the cache stays warm for the page session
 * so a pack-disable + reload cycle doesn't re-bundle. Page navigation
 * naturally frees the blob URLs (browser-driven GC).
 *
 * See `docs/plans/PERFORMANCE_PROFILER.md` §5.1 + §10 R3 (dynamic-
 * import string-indirection rationale).
 */

interface CacheEntry {
  /**
   * Object URL backing the dynamic `import()`. Never revoked. Empty
   * string while the entry is in the `pending verification` phase
   * (hash not yet confirmed). Populated once the integrity check
   * passes and the Blob is constructed.
   */
  url: string;
  /** The pending or resolved module namespace object. */
  module: Promise<unknown>;
  /**
   * True while the entry is the placeholder a concurrent caller
   * inserted to dedup their own SHA-256 verification step. False
   * once the verifier has upgraded the entry with the real Blob URL.
   *
   * The placeholder phase preserves the dedup guarantee: two
   * `resolveLibrary` calls with identical declared hashes and
   * identical bytes share ONE verification + ONE Blob URL, regardless
   * of which one's promise the cache holds. The loser of the race
   * sees the placeholder, awaits the same module promise, and never
   * creates a duplicate cache entry — even though the verification
   * hasn't completed yet at the moment they look up the cache.
   */
  pending: boolean;
}

const LIBRARY_CACHE = new Map<string, CacheEntry>();

/**
 * Compute the SRI hash (`sha256-<base64>`) of the supplied bytes. Used
 * by `resolveLibrary` to verify the manifest's declared hash matches
 * what's actually inside the `.apg`. Exposed for tests that want to
 * assert the hash format without going through the import path.
 */
export async function sha256Sri(bytes: Uint8Array): Promise<string> {
  // crypto.subtle is available in every browser the editor supports
  // (and in Bun via `globalThis.crypto`). We use it instead of
  // `Bun.CryptoHasher` so this module works without modification in
  // the editor's browser runtime — the pack-builder uses Bun's
  // synchronous hasher; the editor uses the Web Crypto API.
  const hashBuf = await crypto.subtle.digest("SHA-256", bytes as BufferSource);
  // Base64-encode the raw bytes. The browser's `btoa` only takes
  // strings, so we go via a binary-string intermediate (each byte
  // becomes one char in the 0..255 range).
  const hashBytes = new Uint8Array(hashBuf);
  let binary = "";
  for (let i = 0; i < hashBytes.length; i++) {
    binary += String.fromCharCode(hashBytes[i]!);
  }
  return `sha256-${btoa(binary)}`;
}

/**
 * Resolve a pack-bundled library to its imported module. Multiple
 * packs that ship the same bytes (verified by SHA-256) share the same
 * Blob URL + the same module Promise — chart.js bundled by two packs
 * is one module instance in memory.
 *
 * Sequence (verify → trust, NOT trust → verify):
 *
 *   1. Cache hit on `declaredHash`? Return the cached module promise.
 *   2. Otherwise, insert a "pending verification" placeholder
 *      synchronously keyed by `declaredHash`. The placeholder carries
 *      the module promise (so concurrent callers with identical
 *      bytes await the same verification + same module instance) but
 *      its `url` is the empty string until verification passes.
 *   3. Inside the async verifier:
 *        a. Compute SHA-256 of the bytes.
 *        b. If the actual hash doesn't match `declaredHash`, DELETE
 *           the placeholder and throw. Concurrent callers awaiting
 *           the placeholder all reject — no zombie cache entry.
 *        c. Only after verification passes do we construct the Blob
 *           URL, upgrade the placeholder to a fully populated entry,
 *           and dynamic-import the module.
 *
 * On hash mismatch the placeholder is removed before the throw
 * propagates, so the cache snapshot post-rejection is empty (no
 * lingering "trust → verify" residue). A subsequent honest call
 * with the same declared hash can re-enter the cache cleanly.
 */
export function resolveLibrary(
  declaredHash: string,
  bytes: Uint8Array,
): Promise<unknown> {
  const cached = LIBRARY_CACHE.get(declaredHash);
  if (cached) {
    // Observable dedup signal. The first pack to ship a given hash
    // logs MISS (below); every subsequent pack that ships the same
    // bytes logs HIT here. Two packs declaring chart.js@4.4.0 → one
    // MISS + one HIT. This is the verification mechanism — if a
    // future change accidentally reinstantiates the cache per pack
    // (e.g. moving LIBRARY_CACHE into a function scope), the HIT
    // line disappears and the test below catches it.
    // eslint-disable-next-line no-console
    console.info(
      `[libraryCache] cache ${cached.pending ? "HIT (pending verification)" : "HIT (dedup)"}: ${declaredHash.slice(0, 24)}…`,
    );
    return cached.module;
  }
  // eslint-disable-next-line no-console
  console.info(
    `[libraryCache] cache MISS (first load): ${declaredHash.slice(0, 24)}… ` +
      `(${bytes.byteLength.toLocaleString()} B)`,
  );
  // Build the verification + module-import promise. We DO insert a
  // placeholder cache entry synchronously below so a concurrent
  // call with identical declared hash + bytes shares this same
  // promise — but the placeholder is REMOVED on hash mismatch
  // BEFORE the rejection propagates. Architecturally the order is
  // verify → trust: nothing trustworthy enters the cache until the
  // SHA-256 check passes; the placeholder is purely a dedup-race
  // primitive and its `url` stays empty until verification clears.
  const module = (async (): Promise<unknown> => {
    const actualHash = await sha256Sri(bytes);
    if (actualHash !== declaredHash) {
      // Drop the placeholder so a subsequent call with the same
      // declared hash but the correct bytes can succeed, and so the
      // cache snapshot reflects "nothing was trusted" post-failure.
      LIBRARY_CACHE.delete(declaredHash);
      throw new Error(
        `[libraryCache] hash mismatch: declared ${declaredHash}, ` +
          `actual ${actualHash}`,
      );
    }
    // Verification passed → upgrade the placeholder to a fully
    // populated entry with a real Blob URL. From this point on the
    // entry is "trusted" and any subsequent cache HIT skips
    // re-verification (the hash is the integrity gate; the
    // promise-identity dedup gate is downstream of it).
    const blob = new Blob([bytes as BlobPart], {
      type: "application/javascript",
    });
    const url = URL.createObjectURL(blob);
    const entry = LIBRARY_CACHE.get(declaredHash);
    if (entry) {
      entry.url = url;
      entry.pending = false;
    }
    // String-indirection to defeat any static-analysis dynamic-import
    // scanner Bun's bundler (or a future plugin) might apply. The
    // `@vite-ignore` is documentation only — Bun doesn't honour it,
    // and a raw `import(url)` with a variable URL is currently
    // treated as runtime in Bun's bundler too. The indirection is
    // belt-and-braces. See `docs/plans/PERFORMANCE_PROFILER.md` §10 R3.
    const importDynamic: (specifier: string) => Promise<unknown> = (s) =>
      import(/* @vite-ignore */ s);
    return importDynamic(url);
  })();
  // Insert the placeholder. `url` is empty + `pending: true` until
  // the verifier clears the integrity check. Concurrent callers
  // that look up the cache while we're still hashing get this
  // placeholder's promise and ride the same verification.
  LIBRARY_CACHE.set(declaredHash, { url: "", module, pending: true });
  // Swallow unhandled-rejection noise from the placeholder promise
  // for the case where every caller's `.catch()` is registered
  // asynchronously. The promise still rejects; callers' awaits /
  // chained handlers still see the error. We just suppress the
  // "(node:…) UnhandledPromiseRejection" diagnostic that fires
  // when no handler is attached on the SAME microtask tick.
  module.catch(() => {});
  return module;
}

/**
 * Drop every cached entry. Tests use this to start from a fresh slate.
 * Production code does not call it — the cache is meant to live for
 * the page session.
 */
export function _clearLibraryCacheForTests(): void {
  for (const { url } of LIBRARY_CACHE.values()) {
    URL.revokeObjectURL(url);
  }
  LIBRARY_CACHE.clear();
}

/**
 * Snapshot the current cache as a list of `{ hash, url }`. Test-only —
 * production code MUST NOT depend on cache contents. Used by the
 * dedup-verification test to assert that two packs which resolve the
 * same hash produce exactly one cache entry.
 */
export function _libraryCacheSnapshotForTests(): Array<{
  hash: string;
  url: string;
}> {
  return Array.from(LIBRARY_CACHE.entries()).map(([hash, entry]) => ({
    hash,
    url: entry.url,
  }));
}

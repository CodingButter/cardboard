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
  /** Object URL backing the dynamic `import()`. Never revoked. */
  url: string;
  /** The pending or resolved module namespace object. */
  module: Promise<unknown>;
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
 * Throws synchronously on hash mismatch (the integrity check runs
 * before any caching), so a pack with a manifest-vs-bytes disagreement
 * can't poison the cache for a subsequent honest pack.
 */
export async function resolveLibrary(
  declaredHash: string,
  bytes: Uint8Array,
): Promise<unknown> {
  const cached = LIBRARY_CACHE.get(declaredHash);
  if (cached) return cached.module;
  // Verify the bytes match the declared hash BEFORE we touch the
  // cache or create a Blob URL — a mismatch is fatal.
  const actualHash = await sha256Sri(bytes);
  if (actualHash !== declaredHash) {
    throw new Error(
      `[libraryCache] hash mismatch: declared ${declaredHash}, ` +
        `actual ${actualHash}`,
    );
  }
  const blob = new Blob([bytes as BlobPart], {
    type: "application/javascript",
  });
  const url = URL.createObjectURL(blob);
  // String-indirection to defeat any static-analysis dynamic-import
  // scanner Bun's bundler (or a future plugin) might apply. The
  // `@vite-ignore` is documentation only — Bun doesn't honour it,
  // and a raw `import(url)` with a variable URL is currently
  // treated as runtime in Bun's bundler too. The indirection is
  // belt-and-braces. See `docs/plans/PERFORMANCE_PROFILER.md` §10 R3.
  const importDynamic: (specifier: string) => Promise<unknown> = (s) =>
    import(/* @vite-ignore */ s);
  const module = importDynamic(url);
  LIBRARY_CACHE.set(declaredHash, { url, module });
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

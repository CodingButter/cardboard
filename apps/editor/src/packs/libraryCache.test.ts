/**
 * libraryCache — content-hash dedup tests.
 *
 * The cache is the load-bearing piece of the editor's pack-bundled-
 * library story: two packs that ship the SAME library bytes share
 * one Blob URL + one resolved module Promise so chart.js (or any
 * other npm dep) is parsed exactly once across the page session.
 *
 * `demo-performance-profiler` + `demo-scene-stats` both ship
 * `chart.js@4.4.0` in their `manifest.libraries[]`. The pack-builder
 * computes the same SHA-256 for both because the entry path, version,
 * and bundler config are identical — that hash equality is what makes
 * the editor's loader collapse the two `resolveLibrary` calls into
 * one cache entry.
 *
 * These tests cover:
 *
 *   1. First call: cache MISS → entry inserted, module Promise returned.
 *   2. Second call with same hash + same bytes: cache HIT → returns the
 *      SAME Promise reference (not a re-instantiation).
 *   3. Different hash: separate entry — two libraries coexist.
 *   4. Hash mismatch between declared + actual bytes: throws.
 *
 * The Blob URL `import()` itself is not exercised here — it's an
 * environment-dependent dynamic import that doesn't play well with
 * `bun test`'s sandbox. We assert ABOUT the cache (entry count + Promise
 * identity + URL identity), which is what the dedup story actually
 * promises.
 */

import { afterEach, describe, expect, test } from "bun:test";
import {
  _clearLibraryCacheForTests,
  _libraryCacheSnapshotForTests,
  resolveLibrary,
  sha256Sri,
} from "./libraryCache";

afterEach(() => {
  _clearLibraryCacheForTests();
});

/**
 * Build a deterministic byte buffer + its SRI hash. The body is a
 * valid ESM source string so even if a future test path tries to
 * `import()` the Blob URL we're not feeding it gibberish.
 */
async function makeBytes(
  body: string,
): Promise<{ bytes: Uint8Array; hash: string }> {
  const bytes = new TextEncoder().encode(body);
  const hash = await sha256Sri(bytes);
  return { bytes, hash };
}

describe("libraryCache — content-hash dedup", () => {
  test("first resolve is a MISS — entry is inserted", async () => {
    const { bytes, hash } = await makeBytes("export const a = 1;");
    expect(_libraryCacheSnapshotForTests()).toHaveLength(0);
    await resolveLibrary(hash, bytes);
    const snap = _libraryCacheSnapshotForTests();
    expect(snap).toHaveLength(1);
    expect(snap[0]!.hash).toBe(hash);
    expect(typeof snap[0]!.url).toBe("string");
    expect(snap[0]!.url.startsWith("blob:")).toBe(true);
  });

  test("two packs with the SAME bytes share one cache entry + one Promise", async () => {
    // The chart.js dedup story end-to-end: pack A and pack B both
    // declare chart.js@4.4.0, both feed identical bytes through the
    // cache, both get the same module Promise back, and there is
    // ONLY ONE entry in the cache afterwards.
    const { bytes, hash } = await makeBytes("export const same = 'bytes';");
    const promiseA = resolveLibrary(hash, bytes);
    const promiseB = resolveLibrary(hash, bytes);
    expect(promiseA).toBe(promiseB);
    const snap = _libraryCacheSnapshotForTests();
    expect(snap).toHaveLength(1);
  });

  test("two libraries with DIFFERENT hashes coexist as distinct entries", async () => {
    const a = await makeBytes("export const a = 1;");
    const b = await makeBytes("export const b = 2;");
    expect(a.hash).not.toBe(b.hash);
    await resolveLibrary(a.hash, a.bytes);
    await resolveLibrary(b.hash, b.bytes);
    const snap = _libraryCacheSnapshotForTests();
    expect(snap).toHaveLength(2);
    const hashes = snap.map((e) => e.hash).sort();
    expect(hashes).toEqual([a.hash, b.hash].sort());
  });

  test("hash mismatch between declared + actual bytes throws + leaves cache empty", async () => {
    const { bytes } = await makeBytes("export const real = 1;");
    const fakeHash = "sha256-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";
    await expect(resolveLibrary(fakeHash, bytes)).rejects.toThrow(
      /hash mismatch/i,
    );
    expect(_libraryCacheSnapshotForTests()).toHaveLength(0);
  });

  test("sha256Sri produces the canonical `sha256-<base64>` format", async () => {
    const bytes = new TextEncoder().encode("hello");
    const hash = await sha256Sri(bytes);
    expect(hash.startsWith("sha256-")).toBe(true);
    // Known value: SHA-256("hello") base64 = LPJNul+wow4m6DsqxbninhsWHlwfp0JecwQzYpOLmCQ=
    expect(hash).toBe("sha256-LPJNul+wow4m6DsqxbninhsWHlwfp0JecwQzYpOLmCQ=");
  });
});

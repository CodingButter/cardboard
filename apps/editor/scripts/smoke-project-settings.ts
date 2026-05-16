/**
 * Smoke test for the Project Settings → Dependencies tab.
 *
 * The tab's UI is a thin React shell over `lib/dependencyManager.ts`.
 * This smoke test exercises every code path through that library
 * against a fake IDB-backed project so the real editor can ship
 * without DOM-driven assertions.
 *
 * Covered:
 *   1. Fetch + hash (with a stubbed `fetch` so we never hit the
 *      network).
 *   2. verifyIntegrity → match / mismatch / none branches.
 *   3. addDependency auto-populates id + version + integrity from the
 *      parsed parent manifest.
 *   4. toggleDependencyEnabled round-trips through saveManifest (the
 *      flag the engine's ChainResolver reads).
 *   5. reorderDependency persists in `requires[]` order.
 *   6. removeDependency drops the entry.
 *   7. Refresh-integrity flow on an existing entry.
 *
 * Run:
 *   cd apps/editor && bun run scripts/smoke-project-settings.ts
 */

import "fake-indexeddb/auto";

import {
  EditorProjectStore,
  _resetDBCache,
} from "../src/lib/EditorProjectStore";
import {
  addDependency,
  fetchAndHashPack,
  listRequires,
  patchDependency,
  removeDependency,
  reorderDependency,
  sha256OfBytes,
  toggleDependencyEnabled,
  verifyIntegrity,
  type FetchFn,
} from "../src/lib/dependencyManager";
import type { PackManifest } from "@two_5_d/engine";

// The editor lists `jszip` as a direct dep, so we can import it
// like any other source file. The fake-IDB smoke harness runs under
// Bun, which resolves Node packages from the nearest `node_modules`.
import JSZip from "jszip";

let passed = 0;
let failed = 0;

function assert(cond: unknown, message: string): asserts cond {
  if (cond) {
    passed += 1;
    console.log(`  ok  ${message}`);
  } else {
    failed += 1;
    console.error(`  FAIL ${message}`);
  }
}

function assertEqual<T>(actual: T, expected: T, message: string) {
  const eq = JSON.stringify(actual) === JSON.stringify(expected);
  if (eq) {
    passed += 1;
    console.log(`  ok  ${message}`);
  } else {
    failed += 1;
    console.error(
      `  FAIL ${message}\n    expected ${JSON.stringify(expected)}` +
        `\n    actual   ${JSON.stringify(actual)}`,
    );
  }
}

/** Build the minimal `.apg` bytes for a manifest. */
async function buildFakePack(manifest: PackManifest): Promise<Uint8Array> {
  const zip = new JSZip();
  zip.file("manifest.json", JSON.stringify(manifest));
  return new Uint8Array(await zip.generateAsync({ type: "uint8array" }));
}

/** Stub `FetchFn` that serves bytes from an in-memory URL → bytes map. */
function makeFetchStub(routes: Record<string, Uint8Array>): FetchFn {
  return async (input) => {
    const bytes = routes[input];
    if (!bytes) {
      return {
        ok: false,
        status: 404,
        arrayBuffer: async () => new ArrayBuffer(0),
      };
    }
    // Slice into a fresh ArrayBuffer so callers can't mutate the
    // backing store mid-test.
    const ab = bytes.buffer.slice(
      bytes.byteOffset,
      bytes.byteOffset + bytes.byteLength,
    ) as ArrayBuffer;
    return {
      ok: true,
      status: 200,
      arrayBuffer: async () => ab,
    };
  };
}

async function main() {
  _resetDBCache();

  console.log("Setup — fresh project + seed manifest.");
  const project = await EditorProjectStore.createProject("Settings smoke");
  const projectId = project.id;
  const seedManifest: PackManifest = {
    name: "settings-smoke",
    version: "0.1.0",
    engine: "*",
    tileTextures: {},
    tileSheets: [],
    startScene: "scenes/start.json",
  };
  await EditorProjectStore.saveManifest(projectId, seedManifest);

  // ── Build two fake parent packs we can "fetch" via the stub. ──
  const parentAManifest: PackManifest = {
    id: "parent-a",
    name: "Parent A",
    version: "1.2.3",
    tileTextures: {},
    tileSheets: [],
    startScene: "scenes/start.json",
  };
  const parentBManifest: PackManifest = {
    id: "parent-b",
    name: "Parent B",
    version: "0.4.0",
    tileTextures: {},
    tileSheets: [],
    startScene: "scenes/start.json",
  };
  const parentABytes = await buildFakePack(parentAManifest);
  const parentBBytes = await buildFakePack(parentBManifest);

  const parentAUrl = "https://example.invalid/parent-a.apg";
  const parentBUrl = "https://example.invalid/parent-b.apg";

  const fetchStub = makeFetchStub({
    [parentAUrl]: parentABytes,
    [parentBUrl]: parentBBytes,
  });

  const parentAHash = await sha256OfBytes(parentABytes);
  const parentBHash = await sha256OfBytes(parentBBytes);

  // ── 1. fetchAndHashPack ──
  console.log("\n[1] fetchAndHashPack returns hash + parsed parent manifest");
  {
    const result = await fetchAndHashPack(parentAUrl, { fetchImpl: fetchStub });
    assertEqual(
      result.integrity,
      parentAHash,
      "fetched pack hash matches expected SHA-256",
    );
    assert(result.manifest, "parent manifest parsed from zip");
    assertEqual(
      (result.manifest as unknown as { id?: string }).id,
      "parent-a",
      "parent manifest preserves id",
    );
    assertEqual(
      result.manifest!.version,
      "1.2.3",
      "parent manifest preserves version",
    );
  }

  // ── 2. verifyIntegrity branches ──
  console.log("\n[2] verifyIntegrity: match / mismatch / none");
  {
    const matchRes = verifyIntegrity(parentAHash, parentAHash);
    assertEqual(matchRes.kind, "match", "identical pin → match");

    const mismatchRes = verifyIntegrity(
      parentAHash,
      "sha256-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
    );
    assertEqual(mismatchRes.kind, "mismatch", "wrong pin → mismatch");
    if (mismatchRes.kind === "mismatch") {
      assertEqual(
        mismatchRes.computed,
        parentAHash,
        "mismatch carries computed hash",
      );
      assert(
        mismatchRes.userProvided.startsWith("sha256-AAAA"),
        "mismatch carries user-provided hash for the warn modal",
      );
    }

    const noneRes = verifyIntegrity(parentAHash, undefined);
    assertEqual(noneRes.kind, "none", "empty pin → none (auto-fill path)");

    // Separator tolerance — `sha256:` is the engine-friendly variant.
    const sepTolerant = verifyIntegrity(
      parentAHash,
      parentAHash.replace("sha256-", "sha256:"),
    );
    assertEqual(
      sepTolerant.kind,
      "match",
      "sha256:hex / sha256-base64 separator variants compare equal",
    );
  }

  // ── 3. addDependency auto-populates from parent manifest ──
  console.log("\n[3] addDependency auto-populates from fetched parent");
  {
    const fetched = await fetchAndHashPack(parentAUrl, { fetchImpl: fetchStub });
    const verify = verifyIntegrity(fetched.integrity, "");
    assertEqual(verify.kind, "none", "no user pin → auto-fill");
    const before = await EditorProjectStore.loadManifest(projectId);
    const next = addDependency(before!, {
      url: parentAUrl,
      integrity: fetched.integrity,
      id: fetched.manifest!.id ?? "",
      version: `^${fetched.manifest!.version}`,
    });
    await EditorProjectStore.saveManifest(projectId, next);

    const reloaded = await EditorProjectStore.loadManifest(projectId);
    const reqs = listRequires(reloaded!);
    assertEqual(reqs.length, 1, "manifest now has 1 dependency");
    assertEqual(reqs[0]?.url, parentAUrl, "url persisted");
    assertEqual(reqs[0]?.id, "parent-a", "id persisted");
    assertEqual(reqs[0]?.version, "^1.2.3", "version persisted as caret range");
    assertEqual(reqs[0]?.integrity, parentAHash, "integrity persisted");
  }

  // ── 4. Add a second dep, then test toggle / reorder / remove ──
  console.log("\n[4] add second dep + manipulate the list");
  {
    const fetched = await fetchAndHashPack(parentBUrl, { fetchImpl: fetchStub });
    const before = await EditorProjectStore.loadManifest(projectId);
    const next = addDependency(before!, {
      url: parentBUrl,
      integrity: fetched.integrity,
      id: fetched.manifest!.id ?? "",
      version: `^${fetched.manifest!.version}`,
    });
    await EditorProjectStore.saveManifest(projectId, next);

    const reloaded = await EditorProjectStore.loadManifest(projectId);
    const reqs = listRequires(reloaded!);
    assertEqual(reqs.length, 2, "manifest has 2 dependencies");
    assertEqual(
      reqs.map((r) => r.id),
      ["parent-a", "parent-b"],
      "order is insertion order (parent-a then parent-b)",
    );
  }

  // ── 5. Enable / disable round-trips through saveManifest ──
  console.log("\n[5] toggleDependencyEnabled round-trips");
  {
    const before = await EditorProjectStore.loadManifest(projectId);
    const disabled = toggleDependencyEnabled(before!, 0, false);
    await EditorProjectStore.saveManifest(projectId, disabled);

    const r1 = await EditorProjectStore.loadManifest(projectId);
    assertEqual(
      listRequires(r1!)[0]?.enabled,
      false,
      "disable persists `enabled: false`",
    );

    // Re-enable — the editor drops the `enabled` field entirely
    // because `true` is the default. Otherwise every manifest would
    // carry a noisy `"enabled": true` on every entry.
    const reEnabled = toggleDependencyEnabled(r1!, 0, true);
    await EditorProjectStore.saveManifest(projectId, reEnabled);
    const r2 = await EditorProjectStore.loadManifest(projectId);
    assertEqual(
      listRequires(r2!)[0]?.enabled,
      undefined,
      "re-enable drops the field (default is true)",
    );
  }

  // ── 6. Reorder ──
  console.log("\n[6] reorderDependency persists new order in requires[]");
  {
    const before = await EditorProjectStore.loadManifest(projectId);
    const beforeIds = listRequires(before!).map((r) => r.id);
    assertEqual(beforeIds, ["parent-a", "parent-b"], "starting order");

    const reordered = reorderDependency(before!, 0, 1);
    await EditorProjectStore.saveManifest(projectId, reordered);

    const r = await EditorProjectStore.loadManifest(projectId);
    const afterIds = listRequires(r!).map((r) => r.id);
    assertEqual(
      afterIds,
      ["parent-b", "parent-a"],
      "reordering moves parent-a to the bottom (highest precedence)",
    );

    // Out-of-range indices clamp to [0, length-1] — they don't
    // throw, and they don't no-op unless from===to after clamping.
    // Here `(99, -5)` clamps to `(1, 0)`, which is a valid swap.
    const clamped = reorderDependency(r!, 99, -5);
    assertEqual(
      listRequires(clamped).map((x) => x.id),
      ["parent-a", "parent-b"],
      "out-of-range reorder clamps to valid endpoints without throwing",
    );
    // Same-index reorder is a true no-op.
    const noop = reorderDependency(r!, 0, 0);
    assertEqual(
      listRequires(noop).map((x) => x.id),
      ["parent-b", "parent-a"],
      "(0,0) reorder is a no-op",
    );
  }

  // ── 7. Refresh-integrity flow ──
  console.log("\n[7] refresh-integrity re-hashes via fetchAndHashPack");
  {
    // Mutate the in-memory bytes so the hash differs.
    const tamperedManifest = { ...parentAManifest, version: "1.2.4" };
    const tamperedBytes = await buildFakePack(tamperedManifest);
    const tamperedHash = await sha256OfBytes(tamperedBytes);
    assert(
      tamperedHash !== parentAHash,
      "tampering with parent bytes changes the SHA-256 (sanity check)",
    );
    const newFetch = makeFetchStub({
      [parentAUrl]: tamperedBytes,
      [parentBUrl]: parentBBytes,
    });

    // Locate the parent-a entry (after reorder it's at index 1).
    const before = await EditorProjectStore.loadManifest(projectId);
    const i = listRequires(before!).findIndex((r) => r.id === "parent-a");
    assert(i !== -1, "found parent-a entry");

    // Refresh path: fetch, verify against existing pin, on mismatch
    // we'd prompt the user — here we simulate "user clicked OK" by
    // just patching with the new hash + version.
    const fresh = await fetchAndHashPack(parentAUrl, { fetchImpl: newFetch });
    const verify = verifyIntegrity(fresh.integrity, before!.requires![i]!.integrity);
    assertEqual(
      verify.kind,
      "mismatch",
      "refresh against tampered bytes surfaces a mismatch",
    );

    const next = patchDependency(before!, i, {
      integrity: fresh.integrity,
      version: `^${fresh.manifest!.version}`,
    });
    await EditorProjectStore.saveManifest(projectId, next);

    const r = await EditorProjectStore.loadManifest(projectId);
    const entry = listRequires(r!)[i];
    assertEqual(entry?.integrity, tamperedHash, "refresh persists new integrity");
    assertEqual(entry?.version, "^1.2.4", "refresh bumps version range");
  }

  // ── 8. Remove a dep ──
  console.log("\n[8] removeDependency drops the entry");
  {
    const before = await EditorProjectStore.loadManifest(projectId);
    const i = listRequires(before!).findIndex((r) => r.id === "parent-a");
    const next = removeDependency(before!, i);
    await EditorProjectStore.saveManifest(projectId, next);

    const r = await EditorProjectStore.loadManifest(projectId);
    const ids = listRequires(r!).map((x) => x.id);
    assertEqual(ids, ["parent-b"], "parent-a is gone, parent-b remains");
  }

  // ── 9. Remove the last dep → `requires` key dropped ──
  console.log("\n[9] removing the last dep clears the requires[] field");
  {
    const before = await EditorProjectStore.loadManifest(projectId);
    const next = removeDependency(before!, 0);
    await EditorProjectStore.saveManifest(projectId, next);
    const r = await EditorProjectStore.loadManifest(projectId);
    assert(
      r?.requires === undefined,
      "empty requires[] → key dropped from the saved manifest",
    );
  }

  // ── 10. Add-then-add same URL replaces (idempotent on URL) ──
  console.log("\n[10] addDependency with an existing URL replaces the entry");
  {
    const before = await EditorProjectStore.loadManifest(projectId);
    const a1 = addDependency(before!, {
      url: parentAUrl,
      integrity: parentAHash,
      id: "parent-a",
    });
    const a2 = addDependency(a1, {
      url: parentAUrl,
      integrity: parentAHash,
      id: "parent-a",
      version: "^1.2.3",
    });
    assertEqual(
      listRequires(a2).length,
      1,
      "two adds against the same URL collapse into one row",
    );
    assertEqual(
      listRequires(a2)[0]?.version,
      "^1.2.3",
      "the second add merged its fields onto the existing row",
    );
  }

  // ── 11. Cleanup ──
  await EditorProjectStore.deleteProject(projectId);
  const gone = await EditorProjectStore.loadManifest(projectId);
  assert(gone === null, "project deletion cascades to manifest");

  console.log();
  console.log(
    `Project-settings smoke test: ${passed} passed, ${failed} failed`,
  );
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error("Project-settings smoke test crashed:", err);
  process.exit(1);
});

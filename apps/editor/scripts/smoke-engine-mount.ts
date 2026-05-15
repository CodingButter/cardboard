/**
 * Smoke test for E2 — exercises the `EditorAssetPack` contract end to
 * end against a freshly-imported default-pack project.
 *
 * The actual engine `Game` constructor needs a DOM canvas, WebGL, and
 * a browser event loop — none of which Bun's runtime provides. So we
 * stop at the layer just below: prove that `EditorAssetPack` satisfies
 * the abstract `AssetPack` surface the engine reads from (manifest,
 * `has`, `textBody`, `textureBlob`, `startScene`). If those round-trip
 * here, the engine has everything it needs once a browser canvas is
 * available.
 *
 * Run with:
 *   cd apps/editor && bun run scripts/smoke-engine-mount.ts
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// Wire `fake-indexeddb` into the global env BEFORE importing anything
// that touches IDB. Mirrors `scripts/smoke-import.ts`.
import "fake-indexeddb/auto";

import {
  EditorProjectStore,
  _resetDBCache,
} from "../src/lib/EditorProjectStore";
import { importPackFromBlob } from "../src/lib/importPack";
import { EditorAssetPack } from "../src/lib/EditorAssetPack";

const PACK_PATH = resolve(
  import.meta.dir,
  "..",
  "..",
  "game",
  "public",
  "packs",
  "default.apg",
);

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

async function main() {
  _resetDBCache();

  console.log(`Reading ${PACK_PATH}`);
  const bytes = readFileSync(PACK_PATH);
  const blob = new Blob([new Uint8Array(bytes)]);

  console.log("Importing default pack into IDB…");
  const result = await importPackFromBlob(blob);
  assert(result.project?.id, "import returns a fresh project");

  console.log("Constructing EditorAssetPack…");
  const pack = await EditorAssetPack.fromProject(result.project.id);
  assert(pack.manifest, "pack has a manifest");
  assert(
    typeof pack.manifest.name === "string" && pack.manifest.name.length > 0,
    `pack.manifest.name is set ("${pack.manifest.name}")`,
  );
  assert(
    typeof pack.manifest.startScene === "string" &&
      pack.manifest.startScene.length > 0,
    `pack.manifest.startScene is set ("${pack.manifest.startScene}")`,
  );

  console.log("Checking path index (`has`)…");
  assert(
    pack.has(pack.manifest.startScene),
    `pack.has() reports startScene present (${pack.manifest.startScene})`,
  );
  assert(
    !pack.has("scenes/this-does-not-exist.json"),
    "pack.has() correctly returns false for missing paths",
  );

  console.log("Loading the start scene…");
  try {
    const scene = await pack.startScene();
    assert(
      scene !== null && scene !== undefined,
      "pack.startScene() resolves to a Scene instance",
    );
    // Scenes carry a `size` and a `spawn`; both are required by the
    // engine boot path. If they're absent, the engine would crash
    // inside Game's first frame, so this is a meaningful gate.
    assert(
      typeof scene.size?.x === "number" && typeof scene.size?.y === "number",
      `scene.size is populated (${scene.size?.x}×${scene.size?.y})`,
    );
    assert(
      scene.spawn !== undefined,
      "scene.spawn is defined",
    );
  } catch (err) {
    assert(false, `pack.startScene() should not throw — got ${(err as Error).message}`);
  }

  console.log("Sampling a text body…");
  // Pick the first script the manifest lists (default pack ships
  // several). Falls back to ANY text asset if no scripts.
  const scriptPath = pack.manifest.scripts?.[0];
  if (scriptPath) {
    try {
      const body = await pack.textBody(scriptPath);
      assert(typeof body === "string", "textBody returns a string");
      assert(body.length > 0, `textBody body is non-empty (${body.length} chars)`);
    } catch (err) {
      assert(false, `textBody should not throw — got ${(err as Error).message}`);
    }
  } else {
    // No scripts in this pack? Find any text asset to probe.
    const assets = await EditorProjectStore.listAssets(result.project.id);
    const text = assets.find((a) => a.kind === "text");
    if (text) {
      const body = await pack.textBody(text.path);
      assert(typeof body === "string", `textBody returns a string for ${text.path}`);
    } else {
      console.log("  -- pack has no text assets to sample (skipping textBody check)");
    }
  }

  console.log("Sampling a texture blob…");
  const assets = await EditorProjectStore.listAssets(result.project.id);
  const blobAsset = assets.find((a) => a.kind === "blob");
  if (blobAsset) {
    try {
      const out = await pack.textureBlob(blobAsset.path);
      assert(out instanceof Blob, `textureBlob returns a Blob (${blobAsset.path})`);
      assert(out.size > 0, `texture blob is non-empty (${out.size} bytes)`);
    } catch (err) {
      assert(false, `textureBlob should not throw — got ${(err as Error).message}`);
    }
  } else {
    console.log("  -- pack has no blob assets to sample (skipping textureBlob check)");
  }

  // Surface a missing-asset error so the engine can produce a useful
  // message rather than something like "Cannot read 'kind' of null".
  console.log("Checking missing-asset error path…");
  try {
    await pack.textBody("definitely/missing.json");
    assert(false, "textBody for missing path should throw");
  } catch (err) {
    assert(
      (err as Error).message.includes("not found"),
      `textBody throws for missing path: "${(err as Error).message}"`,
    );
  }

  // Clean up the IDB row so re-runs are deterministic. `_resetDBCache`
  // at the top already makes us hermetic, but it's still a polite
  // close-out.
  await EditorProjectStore.deleteProject(result.project.id);

  console.log();
  console.log(`Smoke test: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error("Smoke test crashed:", err);
  process.exit(1);
});

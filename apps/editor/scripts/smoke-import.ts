/**
 * Smoke test for the E1 import pipeline.
 *
 * Drives the editor's `EditorProjectStore` + `importPackFromBlob`
 * end-to-end against the real `apps/game/public/packs/default.apg`,
 * using `fake-indexeddb` to stand in for the browser's IDB. Verifies:
 *
 *   1. The pack unzips without throwing.
 *   2. A `ProjectMeta` row + manifest row land in IDB.
 *   3. Every entry from the zip becomes an `assets` row.
 *   4. Re-listing projects + assets returns what we just wrote.
 *
 * Run with:
 *   cd apps/editor && bun run scripts/smoke-import.ts
 *
 * No actual browser required; the goal is to prove the import path
 * doesn't crash on real pack data.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// Wire `fake-indexeddb` into the global env BEFORE importing anything
// that touches IDB. `idb` reads `globalThis.indexedDB` lazily on the
// first `openDB` call, so as long as we set this up first we're fine.
import "fake-indexeddb/auto";

import {
  EditorProjectStore,
  _resetDBCache,
} from "../src/lib/EditorProjectStore";
import { importPackFromBlob } from "../src/lib/importPack";

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
  console.log(`  ${bytes.byteLength} bytes`);

  // `Blob` is a global on Bun + modern Node, but `readFileSync` gives
  // us a `Buffer`. Wrap it for the import API.
  const blob = new Blob([new Uint8Array(bytes)]);

  console.log("Importing pack…");
  const result = await importPackFromBlob(blob);

  assert(result.project?.id, "import returns a project with an id");
  assert(result.assetCount > 0, "import wrote at least one asset row");
  console.log(`  imported ${result.assetCount} assets`);

  console.log("Re-querying store…");
  const projects = await EditorProjectStore.listProjects();
  assert(
    projects.some((p) => p.id === result.project.id),
    "listProjects() includes the new project",
  );

  const manifest = await EditorProjectStore.loadManifest(result.project.id);
  assert(manifest !== null, "loadManifest() returns the imported manifest");
  if (manifest) {
    assert(
      typeof manifest.name === "string" && manifest.name.length > 0,
      `manifest.name is set (got "${manifest.name}")`,
    );
    assert(
      typeof manifest.startScene === "string" &&
        manifest.startScene.length > 0,
      `manifest.startScene is set (got "${manifest.startScene}")`,
    );
  }

  const assets = await EditorProjectStore.listAssets(result.project.id);
  assert(
    assets.length === result.assetCount,
    `listAssets() count matches import (${assets.length})`,
  );

  const sceneAssets = assets.filter((a) => a.path.startsWith("scenes/"));
  assert(
    sceneAssets.length > 0,
    `at least one scenes/*.json asset present (${sceneAssets.length})`,
  );

  // Round-trip one scene body to make sure text decoding worked.
  if (sceneAssets.length > 0 && sceneAssets[0]) {
    const body = await EditorProjectStore.loadAsset(
      result.project.id,
      sceneAssets[0].path,
    );
    assert(typeof body === "string", "scene asset round-trips as text");
    if (typeof body === "string") {
      try {
        JSON.parse(body);
        assert(true, "scene asset parses as JSON");
      } catch (err) {
        assert(false, `scene asset parses as JSON (${(err as Error).message})`);
      }
    }
  }

  // Verify delete clears the rows.
  await EditorProjectStore.deleteProject(result.project.id);
  const afterDelete = await EditorProjectStore.listProjects();
  assert(
    !afterDelete.some((p) => p.id === result.project.id),
    "deleteProject() removes the project from listProjects()",
  );
  const orphanAssets = await EditorProjectStore.listAssets(
    result.project.id,
  );
  assert(
    orphanAssets.length === 0,
    `deleteProject() cascades to assets (${orphanAssets.length} orphans)`,
  );

  console.log();
  console.log(`Smoke test: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error("Smoke test crashed:", err);
  process.exit(1);
});

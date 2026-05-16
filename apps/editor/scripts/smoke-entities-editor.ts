/**
 * E-ENT (Entities mode) smoke test — declarative-prefab authoring
 * persistence pipeline exercised against `EditorProjectStore` directly.
 *
 * Like the AE1 smoke test, the React component itself can't run
 * headless (no DOM). We reproduce the mutation path the EntitiesEditor
 * takes:
 *
 *   1. Create a fresh fake-IDB project + seed a tiny manifest.
 *   2. Author a declarative prefab in memory (Position + Sprite + Light),
 *      assert the JSON shape matches the engine's `DeclarativePrefab`
 *      interface.
 *   3. Save the manifest via `EditorProjectStore.saveManifest`.
 *   4. Re-load the manifest and assert the prefab entry round-trips:
 *      - keyed under `manifest.prefabs[name]`,
 *      - `components.Position` / `components.Sprite` / `components.Light`
 *        carry the data we wrote,
 *      - tags + description survive.
 *   5. Author a second prefab with shared id but different components
 *      (the editor's "+ New" flow renames to avoid collision); assert
 *      both end up in the manifest.
 *   6. Delete a prefab from the draft + save; assert removal sticks.
 *   7. Empty `manifest.prefabs` after deleting the last prefab — the
 *      editor drops the key (`undefined`) so the manifest stays clean.
 *
 * Run:
 *   cd apps/editor && bun run scripts/smoke-entities-editor.ts
 */

import "fake-indexeddb/auto";

import {
  EditorProjectStore,
  _resetDBCache,
} from "../src/lib/EditorProjectStore";
import type {
  DeclarativePrefab,
  PackManifest,
} from "@two_5_d/engine";

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

/** Minimal seed manifest matching the shape `PackManifest` requires. */
function seedManifest(): PackManifest {
  return {
    name: "entities smoke pack",
    version: "0.0.1",
    tileTextures: {},
    tileSheets: [],
    startScene: "scenes/start.json",
    sprites: {
      zombie: { image: "images/sprites/zombie.png" },
      torch: { image: "images/sprites/torch.png" },
    },
  };
}

async function main() {
  _resetDBCache();

  console.log("Setup — fresh project + seed manifest.");
  const project = await EditorProjectStore.createProject("Entities smoke");
  const projectId = project.id;
  await EditorProjectStore.saveManifest(projectId, seedManifest());

  // ── 1. Author a declarative prefab ──
  const zombie: DeclarativePrefab = {
    name: "zombie",
    components: {
      Position: { x: 4, y: 5, z: 0 },
      Sprite: { imageId: "zombie", scale: 1 },
      Light: { color: [1, 0.4, 0.2], intensity: 1.2, radius: 4, z: 0.5 },
    },
    tags: ["enemy", "undead"],
    description: "Baseline zombie. Slow, light, scary.",
  };
  // Shape check — these are the fields the engine reads.
  assert(typeof zombie.name === "string", "zombie.name is string");
  assert(typeof zombie.components === "object", "zombie.components is object");
  assertEqual(
    Object.keys(zombie.components).sort(),
    ["Light", "Position", "Sprite"],
    "zombie has Position + Sprite + Light",
  );

  // ── 2. Save manifest with the prefab ──
  const mf1 = (await EditorProjectStore.loadManifest(projectId))!;
  mf1.prefabs = { zombie };
  await EditorProjectStore.saveManifest(projectId, mf1);

  // ── 3. Round-trip ──
  const reloaded = await EditorProjectStore.loadManifest(projectId);
  assert(reloaded !== null, "manifest reloads after save");
  assert(reloaded?.prefabs !== undefined, "reloaded manifest has prefabs");
  assert(
    reloaded?.prefabs?.["zombie"] !== undefined,
    "manifest.prefabs.zombie present",
  );
  const rt = reloaded!.prefabs!["zombie"]!;
  assertEqual(rt.name, "zombie", "prefab name round-trips");
  assertEqual(
    rt.components.Position,
    { x: 4, y: 5, z: 0 },
    "Position component data round-trips",
  );
  assertEqual(
    rt.components.Sprite,
    { imageId: "zombie", scale: 1 },
    "Sprite component data round-trips",
  );
  assertEqual(
    rt.components.Light,
    { color: [1, 0.4, 0.2], intensity: 1.2, radius: 4, z: 0.5 },
    "Light component data round-trips",
  );
  assertEqual(rt.tags, ["enemy", "undead"], "tags round-trip");
  assertEqual(
    rt.description,
    "Baseline zombie. Slow, light, scary.",
    "description round-trips",
  );

  // ── 4. Two prefabs coexist ──
  const torch: DeclarativePrefab = {
    name: "torch",
    components: {
      Position: { x: 2, y: 2, z: 0.8 },
      Sprite: { imageId: "torch", scale: 0.5 },
      Light: { color: [1, 0.7, 0.3], intensity: 1.5, radius: 5, z: 0.8 },
    },
    tags: ["light", "static"],
  };
  const mf2 = (await EditorProjectStore.loadManifest(projectId))!;
  mf2.prefabs = { ...(mf2.prefabs ?? {}), torch };
  await EditorProjectStore.saveManifest(projectId, mf2);

  const mfBoth = await EditorProjectStore.loadManifest(projectId);
  assertEqual(
    Object.keys(mfBoth?.prefabs ?? {}).sort(),
    ["torch", "zombie"],
    "two declarative prefabs coexist in manifest",
  );

  // ── 5. Delete one ──
  const mf3 = (await EditorProjectStore.loadManifest(projectId))!;
  const copy = { ...(mf3.prefabs ?? {}) };
  delete copy["zombie"];
  mf3.prefabs = copy;
  await EditorProjectStore.saveManifest(projectId, mf3);

  const mfAfterDelete = await EditorProjectStore.loadManifest(projectId);
  assertEqual(
    Object.keys(mfAfterDelete?.prefabs ?? {}).sort(),
    ["torch"],
    "deleting zombie leaves only torch",
  );

  // ── 6. Empty prefabs → key dropped ──
  const mf4 = (await EditorProjectStore.loadManifest(projectId))!;
  // EntitiesEditor sets `undefined` when the draft becomes empty so the
  // manifest doesn't ship an empty object. Mirror that here.
  mf4.prefabs = undefined;
  await EditorProjectStore.saveManifest(projectId, mf4);

  const mfClean = await EditorProjectStore.loadManifest(projectId);
  assert(
    mfClean?.prefabs === undefined,
    "manifest.prefabs key is undefined when the editor empties the draft",
  );

  // ── 7. Manifest non-prefab fields preserved across writes ──
  assertEqual(
    mfClean?.sprites,
    { zombie: { image: "images/sprites/zombie.png" }, torch: { image: "images/sprites/torch.png" } },
    "manifest.sprites preserved across all prefab writes",
  );
  assertEqual(
    mfClean?.startScene,
    "scenes/start.json",
    "manifest.startScene preserved",
  );

  // ── 8. Cleanup ──
  await EditorProjectStore.deleteProject(projectId);
  const gone = await EditorProjectStore.loadManifest(projectId);
  assert(gone === null, "project deletion cascades to manifest");

  console.log();
  console.log(`Entities-editor smoke test: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error("Entities-editor smoke test crashed:", err);
  process.exit(1);
});

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
import {
  buildAnimationComponentFromSuggestion,
  computeAnimationWiringState,
} from "../src/lib/prefabAnimationWiring";
import { findComponentSchema } from "../src/lib/componentSchemas";

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

  // ── 8. AE3 — Sprite → Animation auto-wire prompt ──
  //
  // The EntitiesEditor surfaces an inline suggestion under the Sprite
  // subform when the prefab points at a sheet-based sprite (one with
  // `animations` declared in the manifest) but has no Animation
  // component yet. Pure analysis lives in `prefabAnimationWiring`;
  // the React tree consumes it without adding state.
  //
  // Seed a fresh project + manifest with a sheet-based sprite. We
  // can reuse the same fake-IDB instance.
  const wireProj = await EditorProjectStore.createProject("anim-wire smoke");
  const wireId = wireProj.id;
  await EditorProjectStore.saveManifest(wireId, {
    name: "anim wire smoke",
    version: "0.0.1",
    tileTextures: {},
    tileSheets: [],
    startScene: "scenes/start.json",
    sprites: {
      zombie: {
        image: "images/sprites/zombie-sheet.png",
        frameWidth: 32,
        frameHeight: 32,
        cols: 4,
        rows: 5,
        angles: 1,
        animations: {
          idle: { frames: [0, 1, 2, 3], frameDuration: 0.2, loop: true },
          walk: { frames: [0, 1, 2, 3], frameDuration: 0.1, loop: true },
          attack: { frames: [0, 1, 2, 3], frameDuration: 0.08, loop: false, next: "idle" },
        },
      },
      // A second sprite with no animations — should NOT trigger the prompt.
      crate: { image: "images/sprites/crate.png" },
    },
  });
  const wireMf = (await EditorProjectStore.loadManifest(wireId))!;

  // ── 8a. Sprite with animations + no Animation component → suggest. ──
  const draftWithSprite: DeclarativePrefab = {
    name: "zombie_prefab",
    components: {
      Position: { x: 1, y: 1, z: 0 },
      Sprite: { imageId: "zombie", scale: 1 },
    },
  };
  const wiringSuggest = computeAnimationWiringState(
    draftWithSprite,
    wireMf.sprites ?? {},
  );
  assert(
    wiringSuggest.suggestAnimation,
    "AE3 — sprite with animations + no Animation component → suggestAnimation true",
  );
  assertEqual(
    [...wiringSuggest.spriteAnimationNames],
    ["idle", "walk", "attack"],
    "AE3 — spriteAnimationNames reflects sprite's animations dict (insertion order)",
  );
  assert(
    !wiringSuggest.animationMismatch,
    "AE3 — no Animation component → no mismatch warning",
  );

  // ── 8b. Click "+ Add Animation component" → component is added ──
  const animPayload = buildAnimationComponentFromSuggestion(
    wiringSuggest.spriteAnimationNames,
  );
  assert(animPayload !== null, "AE3 — suggestion produces a payload");
  if (animPayload) {
    assertEqual(
      animPayload.current,
      "idle",
      "AE3 — auto-wired Animation uses the FIRST animation name as `current`",
    );
    assertEqual(animPayload.frame, 0, "AE3 — auto-wired Animation has frame=0");
    assertEqual(animPayload.elapsed, 0, "AE3 — auto-wired Animation has elapsed=0");
  }

  // Simulate the editor mutation — add the Animation component to the
  // prefab draft. After the mutation, the suggestion should disappear
  // and the dropdown options should match the sprite's animations.
  const draftWithAnim: DeclarativePrefab = {
    ...draftWithSprite,
    components: {
      ...draftWithSprite.components,
      Animation: animPayload ?? { current: "", frame: 0, elapsed: 0 },
    },
  };
  const wiringAfterAdd = computeAnimationWiringState(
    draftWithAnim,
    wireMf.sprites ?? {},
  );
  assert(
    !wiringAfterAdd.suggestAnimation,
    "AE3 — after adding Animation component the suggestion disappears",
  );
  assert(
    !wiringAfterAdd.animationMismatch,
    "AE3 — current=idle is valid for the sprite → no mismatch",
  );
  assertEqual(
    [...wiringAfterAdd.spriteAnimationNames],
    ["idle", "walk", "attack"],
    "AE3 — dropdown options match the sprite's animations (current=idle case)",
  );

  // ── 8c. Animation `current` dropdown — schema is in BUILT_IN list ──
  // The schema-driven form needs the Animation component schema
  // surfaced from componentSchemas. Verify it exists + the `current`
  // field is the new `animationName` kind that drives the dropdown.
  const animSchema = findComponentSchema("Animation");
  assert(animSchema !== undefined, "AE3 — Animation component schema is registered");
  if (animSchema) {
    const current = animSchema.fields.find((f) => f.key === "current");
    assert(
      current?.kind === "animationName",
      "AE3 — Animation.current uses the context-aware `animationName` field kind",
    );
  }

  // ── 8d. Mismatch — current=foo not in animations → warning ──
  const draftMismatch: DeclarativePrefab = {
    ...draftWithSprite,
    components: {
      ...draftWithSprite.components,
      Animation: { current: "foo", frame: 0, elapsed: 0 },
    },
  };
  const wiringMismatch = computeAnimationWiringState(
    draftMismatch,
    wireMf.sprites ?? {},
  );
  assert(
    wiringMismatch.animationMismatch,
    "AE3 — current=foo (not in sprite's animations) → mismatch warning",
  );

  // ── 8e. Sprite cleared / removed → Animation mismatch ──
  const draftNoSprite: DeclarativePrefab = {
    name: "zombie_prefab",
    components: {
      Position: { x: 1, y: 1, z: 0 },
      Animation: { current: "idle", frame: 0, elapsed: 0 },
    },
  };
  const wiringNoSprite = computeAnimationWiringState(
    draftNoSprite,
    wireMf.sprites ?? {},
  );
  assert(
    wiringNoSprite.animationMismatch,
    "AE3 — Animation component without Sprite → mismatch warning",
  );

  // ── 8f. Sprite without animations → no suggestion ──
  const draftCrate: DeclarativePrefab = {
    name: "crate_prefab",
    components: {
      Position: { x: 1, y: 1, z: 0 },
      Sprite: { imageId: "crate", scale: 1 },
    },
  };
  const wiringCrate = computeAnimationWiringState(
    draftCrate,
    wireMf.sprites ?? {},
  );
  assert(
    !wiringCrate.suggestAnimation,
    "AE3 — sprite without animations → no suggestion (crate is just a static image)",
  );

  await EditorProjectStore.deleteProject(wireId);

  // ── 9. Cleanup ──
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

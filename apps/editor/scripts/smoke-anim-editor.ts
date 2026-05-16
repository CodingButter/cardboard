/**
 * AE1 smoke test — animation editor's import → grid-config → cell-assign
 * → save flow, exercised via the DOM-free helpers in
 * `apps/editor/src/lib/animationBaker.ts`.
 *
 * The React component itself can't run headless (it needs a DOM and a
 * real `<canvas>`), so we reproduce the persistence pipeline directly
 * against `EditorProjectStore` + `animationBaker` helpers. The
 * coverage matrix:
 *
 *   1. Create a project + import a fake spritesheet PNG into IDB
 *      under `_source/<id>-source.png`.
 *   2. Synthesize editor state, add two animations with cell-index
 *      mappings (one single-angle, one multi-angle to exercise the
 *      atlas-row math).
 *   3. Validate the state — no errors expected.
 *   4. Build the composite plan and assert the canonical layout
 *      matches ANIMATIONS.md §5.1 (row-per-(animation × angle),
 *      col-per-frame, rowBase = sum of prior effectiveAngles).
 *   5. Run `saveBakedSprite` with a synthetic PNG blob; assert
 *      manifest.sprites entry, canonical PNG, and spriteSources row
 *      all landed in IDB.
 *   6. Re-load the project + sprite source, reconstruct state via
 *      `fromSpriteSourceMeta`, assert round-trip equality.
 *
 * Run:
 *   cd apps/editor && bun run scripts/smoke-anim-editor.ts
 */

import "fake-indexeddb/auto";

import {
  EditorProjectStore,
  _resetDBCache,
} from "../src/lib/EditorProjectStore";
import {
  autoDetectGrid,
  buildCompositePlan,
  buildSpriteDef,
  effectiveAngles,
  fromSpriteSourceMeta,
  framesPerAngleFor,
  initialStateFromImport,
  isIdentityPlan,
  rowBaseFor,
  saveBakedSprite,
  toSpriteSourceMeta,
  totalOutputCols,
  totalOutputRows,
  validateState,
  type AnimationEditorState,
} from "../src/lib/animationBaker";

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

/**
 * Build a deterministic fake PNG. Real PNG bytes aren't needed for
 * the smoke test (the IDB layer treats it as an opaque blob and the
 * compositor is exercised via the plan helpers, not the canvas).
 * 16 bytes of header + a marker suffix the test can sniff back out.
 */
function fakePng(label: string): Blob {
  const header = new Uint8Array([
    0x89,
    0x50,
    0x4e,
    0x47,
    0x0d,
    0x0a,
    0x1a,
    0x0a,
  ]);
  const tail = new TextEncoder().encode(label);
  const buf = new Uint8Array(header.length + tail.length);
  buf.set(header, 0);
  buf.set(tail, header.length);
  // Wrap an ArrayBuffer slice so the Blob constructor accepts it
  // under both lib.dom and Bun's types.
  const ab = buf.buffer.slice(
    buf.byteOffset,
    buf.byteOffset + buf.byteLength,
  ) as ArrayBuffer;
  return new Blob([ab], { type: "image/png" });
}

async function main() {
  _resetDBCache();

  console.log("Setup — fake IDB, fresh project.");
  const project = await EditorProjectStore.createProject(
    "AE1 smoke project",
  );
  const projectId = project.id;
  assert(typeof projectId === "string", "createProject returned an id");

  // ── 1. Import flow ──
  const spriteId = "zombie";
  const sourcePath = `_source/${spriteId}-source.png`;
  const sourceBlob = fakePng(`${spriteId}-source`);
  await EditorProjectStore.saveAsset(projectId, sourcePath, sourceBlob);
  const readBack = await EditorProjectStore.loadAsset(projectId, sourcePath);
  assert(readBack instanceof Blob, "source PNG persisted to IDB");

  // Auto-detect — for a 512×256 image, the heuristic picks the
  // LARGEST cell in `AUTO_DETECT_CELLS` that divides both dims
  // evenly. 128 divides 512 (= 4) and 256 (= 2), so it wins.
  // That's a valid spritesheet layout (4 cols × 2 rows of 128 cells).
  const grid = autoDetectGrid(512, 256);
  assertEqual(
    grid,
    { frameWidth: 128, frameHeight: 128, cols: 4, rows: 2 },
    "autoDetectGrid picks 128-px cells on 512×256",
  );

  // For the actual smoke test we want a 8-col × 5-row × 64-px source
  // (40 cells, enough for idle + 4-angle walk) — author-side
  // override of the auto-detected grid is the explicit happy path.
  let state = initialStateFromImport({
    spriteId,
    sourcePath,
    imageWidth: 512,
    imageHeight: 320,
  });
  state = {
    ...state,
    frameWidth: 64,
    frameHeight: 64,
    cols: 8,
    rows: 5,
  };
  assert(state.cols === 8 && state.rows === 5, "state grid override to 8×5");
  assert(state.angles === 1, "initial angles default is 1");
  assert(state.animationOrder.length === 0, "no animations initially");

  // ── 2. Add animations ──
  // First: an `idle` animation, 1 angle, 4 frames — cells 0..3 (first
  // row of the source sheet).
  state = {
    ...state,
    animationOrder: ["idle", "walk"],
    animationsMeta: {
      idle: { frameDuration: 0.2, loop: true },
      walk: { frameDuration: 0.1, loop: true, anglesOverride: 4 },
    },
    cellMappings: {
      idle: [0, 1, 2, 3],
      // walk: 4 angles × 4 frames = 16 cells, drawn from rows 1..4 in
      // the source. The flat cell-index list is angle-major:
      //   [angle0_f0, angle0_f1, …, angle1_f0, …]
      walk: [
        // angle 0 — source row 1 (indices 8..11)
        8, 9, 10, 11,
        // angle 1 — source row 2 (indices 16..19)
        16, 17, 18, 19,
        // angle 2 — source row 3 (indices 24..27)
        24, 25, 26, 27,
        // angle 3 — source row 4 (out of bounds: 32..35 would exceed
        // an 8x4 sheet of 32 cells). For the smoke test we bump the
        // source rows to 5 so this is in bounds.
        32, 33, 34, 35,
      ],
    },
    angles: 1,
  };

  // ── 3. Validate ──
  const issues = validateState(state);
  const errors = issues.filter((i) => i.kind === "error");
  assertEqual(
    errors,
    [],
    `validation returns no errors (${JSON.stringify(errors)})`,
  );

  // ── 4. Composite plan + canonical layout ──
  const plan = buildCompositePlan(state);
  // Output rows = 1 (idle) + 4 (walk override) = 5.
  // Output cols = max framesPerAngle = 4.
  assertEqual(
    { rows: plan.outRows, cols: plan.outCols },
    { rows: 5, cols: 4 },
    "composite plan is 4 cols × 5 rows (idle:1 + walk:4 angles)",
  );
  assertEqual(
    framesPerAngleFor(state, "walk"),
    4,
    "walk has 4 frames per angle",
  );
  assertEqual(
    effectiveAngles(state, "walk"),
    4,
    "walk's anglesOverride wins over sprite-level angles=1",
  );
  assertEqual(rowBaseFor(state, "idle"), 0, "idle rowBase is 0");
  assertEqual(
    rowBaseFor(state, "walk"),
    1,
    "walk rowBase = 1 (sum of prior anim's angles)",
  );

  // Every op is at a sane (col, row, srcIndex) within the source's
  // 8×5 = 40-cell capacity.
  for (const op of plan.ops) {
    assert(
      op.srcIndex >= 0 && op.srcIndex < state.cols * state.rows,
      `op srcIndex ${op.srcIndex} in source bounds`,
    );
    assert(
      op.dstCol < plan.outCols && op.dstRow < plan.outRows,
      `op (${op.dstCol},${op.dstRow}) in output bounds`,
    );
  }

  // Spot-check a couple of ops:
  //   idle frame 0 → (0, 0) from source cell 0
  //   walk angle 0 frame 0 → (0, 1) from source cell 8
  //   walk angle 3 frame 3 → (3, 4) from source cell 35
  const idleF0 = plan.ops.find(
    (o) => o.animName === "idle" && o.frameIdx === 0,
  );
  assert(
    idleF0?.srcIndex === 0 && idleF0?.dstCol === 0 && idleF0?.dstRow === 0,
    "idle frame 0 maps source(0) → output(0, 0)",
  );
  const walkA0F0 = plan.ops.find(
    (o) => o.animName === "walk" && o.angleIdx === 0 && o.frameIdx === 0,
  );
  assert(
    walkA0F0?.srcIndex === 8 &&
      walkA0F0?.dstCol === 0 &&
      walkA0F0?.dstRow === 1,
    "walk angle 0 frame 0 maps source(8) → output(0, 1)",
  );
  const walkA3F3 = plan.ops.find(
    (o) => o.animName === "walk" && o.angleIdx === 3 && o.frameIdx === 3,
  );
  assert(
    walkA3F3?.srcIndex === 35 &&
      walkA3F3?.dstCol === 3 &&
      walkA3F3?.dstRow === 4,
    "walk angle 3 frame 3 maps source(35) → output(3, 4)",
  );

  // `isIdentityPlan` should be false — our author-side cell layout
  // (angle-major within the source's 8 cols) doesn't match the
  // canonical 4-cols output.
  assert(
    !isIdentityPlan(plan),
    "non-canonical input produces non-identity plan",
  );

  // ── 5. SpriteDef shape ──
  const def = buildSpriteDef(state);
  assertEqual(def.image, "images/sprites/zombie-sheet.png", "canonical image path");
  assertEqual(def.cols, 4, "manifest cols = 4");
  assertEqual(def.rows, 5, "manifest rows = 5");
  assertEqual(def.angles, 1, "manifest angles = sprite default 1");
  assert(def.animations !== undefined, "manifest has animations");
  assertEqual(
    def.animations!.idle!.frames,
    [0, 1, 2, 3],
    "idle frames are 0..3 (column indices)",
  );
  assertEqual(
    def.animations!.walk!.frames,
    [0, 1, 2, 3],
    "walk frames are 0..3 (column indices)",
  );
  assertEqual(
    def.animations!.walk!.angles,
    4,
    "walk's per-clip angles override = 4",
  );

  // ── 6. Save end-to-end ──
  const bakedBlob = fakePng("baked-zombie-sheet");
  const { manifest } = await saveBakedSprite(projectId, state, bakedBlob);
  assert(
    manifest.sprites?.[spriteId] !== undefined,
    "manifest.sprites.zombie written",
  );
  assertEqual(
    manifest.sprites![spriteId]!.image,
    "images/sprites/zombie-sheet.png",
    "manifest sprite points at canonical path",
  );

  const sheetAsset = await EditorProjectStore.loadAsset(
    projectId,
    "images/sprites/zombie-sheet.png",
  );
  assert(sheetAsset instanceof Blob, "canonical PNG asset persisted to IDB");

  const srcMeta = await EditorProjectStore.loadSpriteSource(
    projectId,
    spriteId,
  );
  assert(srcMeta !== null, "spriteSources row persisted");
  if (srcMeta) {
    assertEqual(srcMeta.kind, "spritesheet", "source kind = spritesheet");
    assertEqual(srcMeta.sourcePath, sourcePath, "source path round-trips");
    assertEqual(
      srcMeta.cellMappings,
      state.cellMappings,
      "cellMappings round-trip",
    );
    assertEqual(
      srcMeta.animationOrder,
      state.animationOrder,
      "animationOrder round-trips",
    );
    assertEqual(
      srcMeta.animationsMeta,
      state.animationsMeta,
      "animationsMeta round-trips",
    );
    assert(srcMeta.bakedAt > 0, "bakedAt timestamp set on save");
  }

  // ── 7. Round-trip re-edit ──
  const reloadedMeta = await EditorProjectStore.loadSpriteSource(
    projectId,
    spriteId,
  );
  if (!reloadedMeta) throw new Error("missing reloaded meta");
  const reloadedState = fromSpriteSourceMeta(reloadedMeta, 512, 320);
  assertEqual(
    reloadedState.cellMappings,
    state.cellMappings,
    "reloaded state cellMappings === pre-save state",
  );
  assertEqual(
    reloadedState.animationOrder,
    state.animationOrder,
    "reloaded animationOrder identical",
  );
  assertEqual(
    reloadedState.angles,
    state.angles,
    "reloaded angles identical",
  );
  assertEqual(
    reloadedState.frameWidth,
    state.frameWidth,
    "reloaded frameWidth identical",
  );
  // Re-running the plan builder on the reloaded state must produce
  // the same canonical layout — otherwise re-opening + re-saving
  // would drift.
  const replan = buildCompositePlan(reloadedState);
  assertEqual(
    { outCols: replan.outCols, outRows: replan.outRows },
    { outCols: plan.outCols, outRows: plan.outRows },
    "re-planned canonical dims identical",
  );
  assertEqual(
    replan.ops.length,
    plan.ops.length,
    "re-planned op count identical",
  );

  // ── 8. listSpriteSources ──
  const list = await EditorProjectStore.listSpriteSources(projectId);
  assert(list.length === 1, "listSpriteSources returns one entry");
  assertEqual(list[0]!.spriteId, spriteId, "listSpriteSources entry id matches");

  // ── 9. Manifest update preserves other sprites ──
  const mfWithOther = await EditorProjectStore.loadManifest(projectId);
  if (mfWithOther) {
    mfWithOther.sprites = {
      ...(mfWithOther.sprites ?? {}),
      ammo_pack: { image: "images/items/ammo_pack.png" },
    };
    await EditorProjectStore.saveManifest(projectId, mfWithOther);
  }
  // Re-save zombie via animationBaker; ammo_pack must survive.
  await saveBakedSprite(projectId, state, fakePng("re-bake"));
  const finalMf = await EditorProjectStore.loadManifest(projectId);
  assert(
    finalMf?.sprites?.["ammo_pack"] !== undefined,
    "saveBakedSprite preserves unrelated sprite entries",
  );
  assert(
    finalMf?.sprites?.["zombie"] !== undefined,
    "saveBakedSprite re-emits our sprite",
  );

  // ── 10. spriteSources cascade on project delete ──
  // (deferred below so the new AE3 assertions can keep operating on
  //  the live project.)

  // ── 11. AE3 — Sprite list categories (Baked vs Sources) ──
  //
  // The AnimationEditor's left rail now splits into two sections:
  // "Baked sprites" (every entry in manifest.sprites) and "Sources"
  // (every spriteSources row). Clicking a baked entry routes to the
  // read-only preview pane; clicking a source row routes to the
  // re-edit flow. Both lists are derived from the same IDB rows the
  // smoke test already exercises — assert the categorization works
  // by reading the manifest + spriteSources back directly.
  const railMf = await EditorProjectStore.loadManifest(projectId);
  const railSources = await EditorProjectStore.listSpriteSources(projectId);

  // The zombie sprite landed in BOTH lists — manifest entry from
  // saveBakedSprite + spriteSources row from the same call.
  const bakedIds = Object.keys(railMf?.sprites ?? {}).sort();
  const sourceIds = railSources.map((s) => s.spriteId).sort();
  assert(
    bakedIds.includes("zombie"),
    "AE3 — zombie shows up in Baked sprites list",
  );
  assert(
    bakedIds.includes("ammo_pack"),
    "AE3 — ammo_pack (no source row) shows up in Baked sprites list",
  );
  assert(
    sourceIds.includes("zombie"),
    "AE3 — zombie shows up in Sources list",
  );
  assert(
    !sourceIds.includes("ammo_pack"),
    "AE3 — ammo_pack does NOT show up in Sources list (no spriteSources row)",
  );

  // The "open baked" routing should produce a preview-state, not an
  // edit-state. We can't render the React tree headless, but we CAN
  // verify the precondition the routing code relies on: the
  // manifest entry + the baked PNG asset are present.
  const bakedAsset = await EditorProjectStore.loadAsset(
    projectId,
    railMf!.sprites!["zombie"]!.image,
  );
  assert(
    bakedAsset instanceof Blob,
    "AE3 — clicking a baked sprite has a PNG asset to feed the preview pane",
  );

  // Source detection — the editor decides "FBX vs spritesheet" by
  // reading `spriteSources[id].kind`. Verify the kind round-trips
  // (this powers the FBX/sheet badge on the Baked sprites list).
  const zombieSource = railSources.find((s) => s.spriteId === "zombie");
  assert(
    zombieSource?.kind === "spritesheet",
    "AE3 — Path A source persists kind: spritesheet (drives the [sheet] badge)",
  );

  // ── 12. spriteSources cascade on project delete ──
  await EditorProjectStore.deleteProject(projectId);
  const dangling = await EditorProjectStore.listSpriteSources(projectId);
  assert(
    dangling.length === 0,
    "deleteProject cascades to spriteSources rows",
  );

  console.log();
  console.log(`AE1 smoke test: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error("AE1 smoke test crashed:", err);
  process.exit(1);
});

/**
 * AE2 smoke test — FBX → spritesheet bake pipeline, exercised through
 * the DOM-free helpers in `apps/editor/src/lib/fbxBaker.ts`.
 *
 * The bake's WebGL render path can't run headless under Bun (no GL
 * context), so we verify the composable bits that ARE testable:
 *
 *   1. The real default-pack FBX (`packages/default-pack/character/
 *      player_idle.fbx`) is the concrete first-test target. We load
 *      its bytes from disk + assert the file exists + is roughly the
 *      expected size (~24 MB).
 *   2. `planFbxBake` produces the right output dimensions, capture
 *      count, and per-cell (dstCol, dstRow) layout matching
 *      ANIMATIONS.md §5.1 (rows = sum effectiveAngles, cols = max
 *      framesPerAnimation, captures ordered animations × angles ×
 *      frames).
 *   3. `buildFbxSpriteState` + `buildSpriteDef` together produce a
 *      manifest entry that round-trips through the engine's
 *      `SpriteDef` shape.
 *   4. `sanitizeClipName` strips DCC noise predictably.
 *   5. End-to-end persistence: a synthesized FBX-kind
 *      `SpriteSourceMeta` round-trips through IDB and `fromFbxMeta`-
 *      style restoration produces the same `FbxBakeConfig`.
 *
 * Live three.js rendering deferred to manual browser verification —
 * the editor's "Bake" button in `FbxImporter.tsx` exercises the full
 * render path when a real WebGL context is available.
 *
 * Run:
 *   cd apps/editor && bun run scripts/smoke-fbx-bake.ts
 */

import "fake-indexeddb/auto";

import { existsSync, statSync } from "node:fs";
import path from "node:path";

import {
  EditorProjectStore,
  _resetDBCache,
} from "../src/lib/EditorProjectStore";
import {
  buildFbxSpriteDef,
  buildFbxSpriteState,
  cloneRenderConfig,
  defaultFbxBakeConfig,
  DEFAULT_FBX_RENDER_CONFIG,
  fbxConfigToMeta,
  planFbxBake,
  restoreFbxBakeConfig,
  sanitizeClipName,
  type FbxBakeConfig,
} from "../src/lib/fbxBaker";
import { DEFAULT_FBX_RENDER_META } from "../src/lib/EditorProjectStore";
import { saveBakedSprite } from "../src/lib/animationBaker";

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
 * Fake PNG blob — the smoke test treats the bake output as opaque
 * (IDB stores it as a Blob; we just check it round-trips).
 */
function fakePng(label: string): Blob {
  const header = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const tail = new TextEncoder().encode(label);
  const buf = new Uint8Array(header.length + tail.length);
  buf.set(header, 0);
  buf.set(tail, header.length);
  const ab = buf.buffer.slice(
    buf.byteOffset,
    buf.byteOffset + buf.byteLength,
  ) as ArrayBuffer;
  return new Blob([ab], { type: "image/png" });
}

async function main() {
  _resetDBCache();

  // ── 1. Default-pack FBX present + readable ──
  console.log("Locating default-pack FBX…");
  const repoRoot = path.resolve(import.meta.dir, "../../..");
  const fbxPath = path.join(
    repoRoot,
    "packages/default-pack/character/player_idle.fbx",
  );
  assert(existsSync(fbxPath), `player_idle.fbx exists at ${fbxPath}`);
  const stat = statSync(fbxPath);
  assert(stat.size > 1_000_000, `player_idle.fbx is > 1MB (${stat.size}B)`);
  assert(stat.size < 100_000_000, `player_idle.fbx is < 100MB`);

  // Read the bytes — exercises the same IO the editor does at re-edit.
  const fbxBytes = await Bun.file(fbxPath).bytes();
  assert(fbxBytes.byteLength === stat.size, "FBX byte length matches stat");
  assert(fbxBytes[0] === 0x4b, "FBX starts with K (Kaydara magic)");

  // ── 2. sanitizeClipName ──
  assertEqual(
    sanitizeClipName("mixamo.com:Idle"),
    "idle",
    "sanitizeClipName strips mixamo.com: prefix",
  );
  assertEqual(
    sanitizeClipName("mixamo.com:Walk_Cycle_01"),
    "walk_cycle_01",
    "sanitizeClipName keeps internal underscores",
  );
  assertEqual(
    sanitizeClipName("Armature|Take 001"),
    "take_001",
    "sanitizeClipName strips Armature| + replaces space",
  );
  assertEqual(
    sanitizeClipName("Idle"),
    "idle",
    "sanitizeClipName lowercases bare names",
  );
  assertEqual(
    sanitizeClipName("___"),
    "anim",
    "sanitizeClipName falls back to 'anim' on empty",
  );

  // ── 3. planFbxBake — canonical layout per ANIMATIONS.md §5.1 ──
  const cfg: FbxBakeConfig = {
    spriteId: "player",
    angleCount: 8,
    cellSize: 64,
    forwardRotation: { x: 0, y: 0, z: 0 },
    cameraElevation: (8 * Math.PI) / 180,
    animations: [
      {
        fbxClipName: "mixamo.com:Idle",
        outputName: "idle",
        frameCount: 8,
        frameDuration: 0.125,
        loop: true,
        clipDurationSec: 1.0,
      },
      {
        fbxClipName: "mixamo.com:Walk",
        outputName: "walk",
        frameCount: 8,
        frameDuration: 0.1,
        loop: true,
        clipDurationSec: 0.8,
      },
      {
        fbxClipName: "mixamo.com:Die",
        outputName: "die",
        frameCount: 4,
        frameDuration: 0.15,
        loop: false,
        clipDurationSec: 1.5,
        anglesOverride: 1,
      },
    ],
    render: cloneRenderConfig(DEFAULT_FBX_RENDER_CONFIG),
  };
  const plan = planFbxBake(cfg);
  // idle (8 angles × 8f) + walk (8 angles × 8f) + die (1 angle × 4f)
  // → rows = 8 + 8 + 1 = 17 ; cols = max(8, 8, 4) = 8.
  assertEqual(
    { rows: plan.outRows, cols: plan.outCols },
    { rows: 17, cols: 8 },
    "plan is 8 cols × 17 rows (idle:8 + walk:8 + die:1 angles)",
  );
  assertEqual(
    { w: plan.outWidth, h: plan.outHeight },
    { w: 8 * 64, h: 17 * 64 },
    "plan output dims = cols×cellSize × rows×cellSize",
  );
  // Total captures = 8×8 + 8×8 + 1×4 = 64 + 64 + 4 = 132.
  assertEqual(plan.captures.length, 132, "total captures = 132");

  // Spot-check a few captures:
  const idleA0F0 = plan.captures.find(
    (c) =>
      c.outputName === "idle" && c.angleIdx === 0 && c.frameIdx === 0,
  );
  assert(
    idleA0F0?.dstCol === 0 && idleA0F0?.dstRow === 0,
    "idle angle 0 frame 0 → cell (0, 0)",
  );
  assertEqual(idleA0F0?.azimuth, 0, "idle angle 0 azimuth = 0");
  assertEqual(idleA0F0?.sampleTime, 0, "idle frame 0 sample time = 0");

  const idleA1F0 = plan.captures.find(
    (c) =>
      c.outputName === "idle" && c.angleIdx === 1 && c.frameIdx === 0,
  );
  assert(
    idleA1F0?.dstCol === 0 && idleA1F0?.dstRow === 1,
    "idle angle 1 frame 0 → cell (0, 1)",
  );
  assertEqual(
    idleA1F0?.azimuth,
    Math.PI / 4,
    "idle angle 1 azimuth = π/4 (8 angles)",
  );

  const walkA0F0 = plan.captures.find(
    (c) =>
      c.outputName === "walk" && c.angleIdx === 0 && c.frameIdx === 0,
  );
  assert(
    walkA0F0?.dstCol === 0 && walkA0F0?.dstRow === 8,
    "walk angle 0 frame 0 → cell (0, 8) [rowBase = 8 from idle]",
  );

  const dieA0F0 = plan.captures.find(
    (c) =>
      c.outputName === "die" && c.angleIdx === 0 && c.frameIdx === 0,
  );
  assert(
    dieA0F0?.dstCol === 0 && dieA0F0?.dstRow === 16,
    "die angle 0 frame 0 → cell (0, 16) [rowBase = 16 from idle+walk]",
  );

  // Sample time for mid-clip frame.
  const walkA0F4 = plan.captures.find(
    (c) =>
      c.outputName === "walk" && c.angleIdx === 0 && c.frameIdx === 4,
  );
  assert(
    Math.abs((walkA0F4?.sampleTime ?? 0) - 0.4) < 1e-6,
    "walk frame 4/8 of 0.8s clip → sampleTime = 0.4s",
  );

  // ── 4. buildFbxSpriteState / buildSpriteDef ──
  const state = buildFbxSpriteState(cfg, plan, "_source/player.fbx");
  assertEqual(state.spriteId, "player", "state.spriteId = player");
  assertEqual(state.frameWidth, 64, "state.frameWidth = cellSize 64");
  assertEqual(state.cols, 8, "state.cols = plan.outCols");
  assertEqual(state.rows, 17, "state.rows = plan.outRows");
  assertEqual(state.angles, 8, "state.angles = default angleCount");
  assertEqual(
    state.animationOrder,
    ["idle", "walk", "die"],
    "animation order preserves config order",
  );

  const def = buildFbxSpriteDef(cfg, plan, "_source/player.fbx");
  assertEqual(
    def.image,
    "images/sprites/player-sheet.png",
    "manifest sprite points at canonical path",
  );
  assertEqual(def.cols, 8, "manifest cols = 8");
  assertEqual(def.rows, 17, "manifest rows = 17");
  assertEqual(def.angles, 8, "manifest angles = 8");
  assert(def.animations !== undefined, "manifest has animations");
  assertEqual(
    def.animations!.die!.angles,
    1,
    "die's anglesOverride preserved",
  );
  assertEqual(
    def.animations!.idle!.frames.length,
    8,
    "idle has 8 frame entries",
  );
  assertEqual(
    def.animations!.walk!.frames,
    [0, 1, 2, 3, 4, 5, 6, 7],
    "walk frames are 0..7 (column indices)",
  );
  assertEqual(
    def.animations!.die!.frames,
    [0, 1, 2, 3],
    "die frames are 0..3 (shorter clip)",
  );
  assertEqual(
    def.animations!.idle!.frameDuration,
    0.125,
    "idle frameDuration round-tripped",
  );
  assertEqual(
    def.animations!.die!.loop,
    false,
    "die loop=false round-tripped",
  );

  // ── 5. defaultFbxBakeConfig ──
  const defaults = defaultFbxBakeConfig("zombie", [
    { name: "mixamo.com:Idle", duration: 1.0 },
    { name: "mixamo.com:Attack", duration: 0.5 },
  ]);
  assertEqual(defaults.angleCount, 8, "default angleCount = 8");
  assertEqual(defaults.cellSize, 64, "default cellSize = 64");
  assertEqual(defaults.animations.length, 2, "default has 2 animations");
  assertEqual(
    defaults.animations[0]!.outputName,
    "idle",
    "default sanitizes clip name → idle",
  );
  assertEqual(
    defaults.animations[1]!.outputName,
    "attack",
    "default sanitizes clip name → attack",
  );
  assert(
    Math.abs(defaults.cameraElevation - (8 * Math.PI) / 180) < 1e-6,
    "default cameraElevation ~ 8° (0.140 rad)",
  );

  // ── 6. fbxConfigToMeta + restoreFbxBakeConfig round-trip ──
  const meta = fbxConfigToMeta(cfg);
  assertEqual(meta.cellSize, 64, "meta.cellSize round-trips");
  assertEqual(meta.cameraElevation, cfg.cameraElevation, "elevation round-trips");
  assertEqual(
    meta.framesPerAnimation,
    { idle: 8, walk: 8, die: 4 },
    "framesPerAnimation contains all outputs",
  );
  assertEqual(
    meta.clipMapping,
    {
      "mixamo.com:Idle": "idle",
      "mixamo.com:Walk": "walk",
      "mixamo.com:Die": "die",
    },
    "clipMapping fbxName → outputName",
  );
  assertEqual(
    meta.enabledClips,
    ["mixamo.com:Idle", "mixamo.com:Walk", "mixamo.com:Die"],
    "enabledClips contains all FBX clip names",
  );

  // Restore via the inverse helper. Clip durations come from the FBX
  // loader; we supply them here as if we re-loaded the FBX.
  const clipDurations: Record<string, number> = {
    "mixamo.com:Idle": 1.0,
    "mixamo.com:Walk": 0.8,
    "mixamo.com:Die": 1.5,
  };
  const restored = restoreFbxBakeConfig(
    cfg.spriteId,
    meta,
    state.animationsMeta,
    state.animationOrder,
    cfg.angleCount,
    clipDurations,
  );
  assertEqual(restored.spriteId, cfg.spriteId, "restored spriteId");
  assertEqual(restored.cellSize, cfg.cellSize, "restored cellSize");
  assertEqual(restored.angleCount, cfg.angleCount, "restored angleCount");
  assertEqual(
    restored.cameraElevation,
    cfg.cameraElevation,
    "restored cameraElevation",
  );
  assertEqual(
    restored.animations.length,
    cfg.animations.length,
    "restored animation count",
  );
  for (let i = 0; i < cfg.animations.length; i++) {
    const a = cfg.animations[i]!;
    const r = restored.animations[i]!;
    assertEqual(r.fbxClipName, a.fbxClipName, `[${i}] fbxClipName`);
    assertEqual(r.outputName, a.outputName, `[${i}] outputName`);
    assertEqual(r.frameCount, a.frameCount, `[${i}] frameCount`);
    assertEqual(r.loop, a.loop, `[${i}] loop`);
    if (a.anglesOverride !== undefined) {
      assertEqual(r.anglesOverride, a.anglesOverride, `[${i}] anglesOverride`);
    }
    assertEqual(r.clipDurationSec, a.clipDurationSec, `[${i}] clipDurationSec`);
  }

  // Re-planning from the restored config produces an identical plan.
  const replan = planFbxBake(restored);
  assertEqual(
    { rows: replan.outRows, cols: replan.outCols, n: replan.captures.length },
    { rows: plan.outRows, cols: plan.outCols, n: plan.captures.length },
    "re-plan from restored config matches original",
  );

  // ── 7. End-to-end IDB persistence ──
  const project = await EditorProjectStore.createProject(
    "AE2 FBX smoke project",
  );
  const projectId = project.id;
  assert(typeof projectId === "string", "createProject returned an id");

  // Persist the real FBX bytes (as a Blob) at `_source/player.fbx`.
  const fbxBlob = new Blob([fbxBytes as unknown as ArrayBuffer], {
    type: "application/octet-stream",
  });
  await EditorProjectStore.saveAsset(projectId, "_source/player.fbx", fbxBlob);
  const fbxReadBack = await EditorProjectStore.loadAsset(
    projectId,
    "_source/player.fbx",
  );
  assert(fbxReadBack instanceof Blob, "FBX persisted to IDB under _source/");

  // Synthesize the canonical sheet (the real bake needs WebGL — we
  // substitute a fake PNG; the smoke test asserts manifest + meta
  // wiring, not the pixel contents).
  const bakedSheet = fakePng("baked-player-sheet");
  const { manifest, def: outDef } = await saveBakedSprite(
    projectId,
    state,
    bakedSheet,
  );
  assert(
    manifest.sprites?.["player"] !== undefined,
    "manifest.sprites.player written",
  );
  assertEqual(
    outDef.image,
    "images/sprites/player-sheet.png",
    "saved def points at canonical path",
  );

  // Persist the FBX-specific meta block (as the FbxImporter does).
  await EditorProjectStore.saveSpriteSource(projectId, "player", {
    projectId,
    spriteId: "player",
    kind: "fbx",
    sourcePath: "_source/player.fbx",
    grid: {
      frameWidth: 64,
      frameHeight: 64,
      cols: plan.outCols,
      rows: plan.outRows,
      padding: 0,
      offsetX: 0,
      offsetY: 0,
    },
    angles: cfg.angleCount,
    cellMappings: state.cellMappings,
    animationsMeta: state.animationsMeta,
    animationOrder: state.animationOrder,
    bakedAt: Date.now(),
    fbx: meta,
  });

  const loaded = await EditorProjectStore.loadSpriteSource(
    projectId,
    "player",
  );
  assert(loaded !== null, "spriteSources row persisted");
  if (loaded) {
    assertEqual(loaded.kind, "fbx", "stored kind = fbx");
    assertEqual(
      loaded.sourcePath,
      "_source/player.fbx",
      "stored sourcePath round-trips",
    );
    assert(loaded.fbx !== undefined, "stored fbx meta block present");
    if (loaded.fbx) {
      assertEqual(
        loaded.fbx.cellSize,
        cfg.cellSize,
        "stored fbx.cellSize round-trips",
      );
      assertEqual(
        loaded.fbx.framesPerAnimation,
        meta.framesPerAnimation,
        "stored fbx.framesPerAnimation round-trips",
      );
      assertEqual(
        loaded.fbx.clipMapping,
        meta.clipMapping,
        "stored fbx.clipMapping round-trips",
      );
    }
  }

  // Project listing — meta surfaces in listSpriteSources.
  const list = await EditorProjectStore.listSpriteSources(projectId);
  assert(list.length === 1, "listSpriteSources finds the FBX sprite");
  assertEqual(list[0]!.spriteId, "player", "listSpriteSources id matches");
  assertEqual(list[0]!.kind, "fbx", "listSpriteSources kind preserves FBX");

  // ── 8. Cascade: deleteProject removes FBX source + spriteSources ──
  await EditorProjectStore.deleteProject(projectId);
  const remaining = await EditorProjectStore.listSpriteSources(projectId);
  assert(
    remaining.length === 0,
    "deleteProject cascades to FBX spriteSources",
  );
  const danglingAsset = await EditorProjectStore.loadAsset(
    projectId,
    "_source/player.fbx",
  );
  assert(
    danglingAsset === null,
    "deleteProject cascades to _source/ FBX asset",
  );

  // ── 9. Edge: animation with anglesOverride=1 (static-pose fallback) ──
  const staticCfg: FbxBakeConfig = {
    spriteId: "static_prop",
    angleCount: 1,
    cellSize: 32,
    forwardRotation: { x: 0, y: 0, z: 0 },
    cameraElevation: 0,
    animations: [
      {
        fbxClipName: "RestPose",
        outputName: "idle",
        frameCount: 1,
        frameDuration: 1.0,
        loop: true,
        clipDurationSec: 0,
      },
    ],
    render: cloneRenderConfig(DEFAULT_FBX_RENDER_CONFIG),
  };
  const staticPlan = planFbxBake(staticCfg);
  assertEqual(
    { rows: staticPlan.outRows, cols: staticPlan.outCols, n: staticPlan.captures.length },
    { rows: 1, cols: 1, n: 1 },
    "static-pose plan: 1 cell, 1 capture",
  );
  assertEqual(
    staticPlan.captures[0]!.sampleTime,
    0,
    "static-pose sampleTime = 0 (no duration)",
  );

  // ── 10. Edge: mirror semantics not yet shipped — angleCount=5 still
  //          produces 5 rows (engine derives the mirrored half at draw). ──
  const mirroredCfg: FbxBakeConfig = {
    ...cfg,
    angleCount: 5,
    animations: cfg.animations.slice(0, 1).map((a) => ({
      ...a,
      anglesOverride: undefined,
    })),
  };
  const mirroredPlan = planFbxBake(mirroredCfg);
  assertEqual(
    mirroredPlan.outRows,
    5,
    "5-angle plan ships 5 rows (mirror derived at runtime)",
  );

  // ── 11. Render-meta block (R-controls) ──
  //
  // Coverage:
  //   - defaultFbxBakeConfig populates `render` with the documented
  //     defaults (so a freshly-loaded FBX renders lit out of the box).
  //   - fbxConfigToMeta round-trips the render block into the
  //     persisted FBX meta.
  //   - restoreFbxBakeConfig fills in defaults when the persisted meta
  //     predates the R-block (legacy bake).
  //   - cloneRenderConfig produces independent objects (mutating the
  //     clone doesn't taint the global default).
  assertEqual(
    DEFAULT_FBX_RENDER_CONFIG,
    DEFAULT_FBX_RENDER_META,
    "DEFAULT_FBX_RENDER_CONFIG re-exports the EditorProjectStore default",
  );
  assertEqual(
    DEFAULT_FBX_RENDER_CONFIG.ambient,
    0.5,
    "default ambient = 0.5",
  );
  assertEqual(
    DEFAULT_FBX_RENDER_CONFIG.keyIntensity,
    1.0,
    "default keyIntensity = 1.0",
  );
  assertEqual(
    DEFAULT_FBX_RENDER_CONFIG.keyDirection,
    "front",
    "default keyDirection = front",
  );
  assertEqual(
    DEFAULT_FBX_RENDER_CONFIG.fillIntensity,
    0.3,
    "default fillIntensity = 0.3",
  );
  assertEqual(
    DEFAULT_FBX_RENDER_CONFIG.background.kind,
    "transparent",
    "default background = transparent",
  );
  assertEqual(DEFAULT_FBX_RENDER_CONFIG.tone, "lit", "default tone = lit");
  assertEqual(DEFAULT_FBX_RENDER_CONFIG.shadow, false, "default shadow = false");

  // defaultFbxBakeConfig stamps the render block.
  const defaultsRender = defaultFbxBakeConfig("zombie", [
    { name: "Idle", duration: 1.0 },
  ]);
  assert(defaultsRender.render !== undefined, "defaultFbxBakeConfig fills .render");
  assertEqual(
    defaultsRender.render.ambient,
    DEFAULT_FBX_RENDER_CONFIG.ambient,
    "defaultFbxBakeConfig render.ambient = default",
  );
  assertEqual(
    defaultsRender.render.tone,
    "lit",
    "defaultFbxBakeConfig render.tone = lit",
  );

  // Mutating the cloned render doesn't affect the global default.
  defaultsRender.render.ambient = 1.5;
  assertEqual(
    DEFAULT_FBX_RENDER_CONFIG.ambient,
    0.5,
    "mutating cloned render doesn't taint global default",
  );

  // fbxConfigToMeta carries the render block through to the persisted meta.
  const customCfg: FbxBakeConfig = {
    ...cfg,
    render: {
      ambient: 0.2,
      keyIntensity: 1.8,
      keyDirection: "overhead",
      fillIntensity: 0.5,
      background: { kind: "solid", color: "#102030" },
      tone: "flat",
      shadow: true,
    },
  };
  const customMeta = fbxConfigToMeta(customCfg);
  assert(customMeta.render !== undefined, "fbxConfigToMeta persists render block");
  assertEqual(customMeta.render!.ambient, 0.2, "persisted render.ambient");
  assertEqual(
    customMeta.render!.keyDirection,
    "overhead",
    "persisted render.keyDirection",
  );
  assertEqual(customMeta.render!.tone, "flat", "persisted render.tone");
  assertEqual(customMeta.render!.shadow, true, "persisted render.shadow");
  assertEqual(
    customMeta.render!.background,
    { kind: "solid", color: "#102030" },
    "persisted render.background round-trips solid+color",
  );

  // Round-trip: customCfg → meta → restoreFbxBakeConfig should reproduce render.
  const customState = buildFbxSpriteState(
    customCfg,
    planFbxBake(customCfg),
    "_source/player.fbx",
  );
  const restoredCustom = restoreFbxBakeConfig(
    customCfg.spriteId,
    customMeta,
    customState.animationsMeta,
    customState.animationOrder,
    customCfg.angleCount,
    {
      "mixamo.com:Idle": 1.0,
      "mixamo.com:Walk": 0.8,
      "mixamo.com:Die": 1.5,
    },
  );
  assertEqual(
    restoredCustom.render.ambient,
    0.2,
    "restored render.ambient round-trips",
  );
  assertEqual(
    restoredCustom.render.background,
    { kind: "solid", color: "#102030" },
    "restored render.background round-trips",
  );
  assertEqual(
    restoredCustom.render.tone,
    "flat",
    "restored render.tone round-trips",
  );

  // Legacy: meta without render block falls back to defaults on restore.
  const legacyMeta = { ...customMeta };
  delete (legacyMeta as { render?: unknown }).render;
  const restoredLegacy = restoreFbxBakeConfig(
    customCfg.spriteId,
    legacyMeta as typeof customMeta,
    customState.animationsMeta,
    customState.animationOrder,
    customCfg.angleCount,
    {
      "mixamo.com:Idle": 1.0,
      "mixamo.com:Walk": 0.8,
      "mixamo.com:Die": 1.5,
    },
  );
  assertEqual(
    restoredLegacy.render.ambient,
    DEFAULT_FBX_RENDER_CONFIG.ambient,
    "legacy meta without render falls back to default.ambient",
  );
  assertEqual(
    restoredLegacy.render.tone,
    "lit",
    "legacy meta falls back to default.tone = lit",
  );
  assertEqual(
    restoredLegacy.render.background.kind,
    "transparent",
    "legacy meta falls back to default transparent background",
  );

  console.log();
  console.log(`AE2 smoke test: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error("AE2 smoke test crashed:", err);
  process.exit(1);
});

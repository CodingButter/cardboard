/**
 * E4 smoke test — exercises the ⚡ Bake button's orchestrator path
 * end-to-end against a synthetic project. The pipeline under test:
 *
 *   1. Create a project + write a manifest + write a tiny scene with
 *      one user-declared light into IDB via `EditorProjectStore`.
 *   2. Call `bakeSceneLightmap(projectId, scenePath)` with
 *      `useWorker: false` (Bun's smoke harness can't construct real
 *      Web Workers around module-graph imports, and the orchestrator's
 *      worker-construction is the only DOM-bound part — the bake
 *      logic itself runs inline via `runBakeJob`).
 *   3. Reload the scene from IDB; assert the `lightmap` field now has
 *      a populated `floorRGB` + `ceilingRGB` base64 blob.
 *   4. Sanity-check the engine's `IdbAssetPack.scene()` still parses
 *      the post-bake scene without errors — same path the iframe
 *      bridge takes on `scene-changed`.
 *
 * Run:
 *   cd apps/editor && bun run scripts/smoke-bake-lightmap.ts
 */

import "fake-indexeddb/auto";

import {
  EditorProjectStore,
  _resetDBCache,
} from "../src/lib/EditorProjectStore";
import { bakeSceneLightmap } from "../src/lib/lightmapBaker";
import { IdbAssetPack } from "@two_5_d/engine";

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

/**
 * Synthetic 4×4 scene with one light at the center. We only need a
 * valid grid + at least one light — the bake algorithm itself is
 * covered by the engine's own tests. The smoke test verifies the
 * orchestrator + IDB plumbing.
 */
function makeMinimalScene(): unknown {
  // 4×4 grid of zeros (open floor). Walls along the perimeter so the
  // bake has some geometry to cast LOS against — without walls every
  // corner just sees the full light contribution and the test would
  // still pass, but matching real authoring closer is cheap.
  const W = 4;
  const H = 4;
  const walls: number[][] = [];
  for (let y = 0; y < H; y++) {
    const row: number[] = [];
    for (let x = 0; x < W; x++) {
      const isEdge = x === 0 || y === 0 || x === W - 1 || y === H - 1;
      row.push(isEdge ? 1 : 0);
    }
    walls.push(row);
  }
  const floors: number[][] = Array.from({ length: H }, () =>
    Array.from({ length: W }, () => 0),
  );
  return {
    spawn: { x: 1.5, y: 1.5, facing: 0 },
    idMap: { "0": null, "1": "wall" },
    walls,
    floors,
    lights: [
      {
        x: 2,
        y: 2,
        z: 0.5,
        color: [1, 1, 1],
        intensity: 1,
        radius: 3,
        baked: true,
      },
    ],
  };
}

async function main() {
  _resetDBCache();

  // 1. Project + manifest + scene asset.
  const project = await EditorProjectStore.createProject("bake-smoke");
  assert(project.id, "project created");
  const projectId = project.id;

  const scenePath = "scenes/start.json";
  const manifest = await EditorProjectStore.loadManifest(projectId);
  assert(manifest !== null, "manifest created");
  manifest!.startScene = scenePath;
  await EditorProjectStore.saveManifest(projectId, manifest!);

  await EditorProjectStore.saveAsset(
    projectId,
    scenePath,
    JSON.stringify(makeMinimalScene(), null, 2),
  );

  // 2. Run the bake (in-thread — fake-indexeddb has no Worker runtime).
  let progressEvents = 0;
  const result = await bakeSceneLightmap(
    projectId,
    scenePath,
    () => {
      progressEvents += 1;
    },
    { useWorker: false },
  );
  assert(progressEvents > 0, `progress callback fired (${progressEvents}x)`);
  assert(result.stats.lights >= 1, `bake reports >=1 light (${result.stats.lights})`);
  assert(result.stats.width === 4, `bake stats width=4 (${result.stats.width})`);
  assert(result.stats.height === 4, `bake stats height=4 (${result.stats.height})`);

  // 3. Re-load the scene from IDB; assert lightmap landed.
  const reloadedBody = await EditorProjectStore.loadAsset(projectId, scenePath);
  assert(
    typeof reloadedBody === "string",
    "scene round-trips as text post-bake",
  );
  const reloaded = JSON.parse(reloadedBody as string) as {
    lightmap?: {
      width: number;
      height: number;
      resolution?: number;
      floorRGB?: string;
      ceilingRGB?: string;
    };
  };
  assert(
    reloaded.lightmap !== undefined && reloaded.lightmap !== null,
    "post-bake scene has lightmap field",
  );
  assert(
    typeof reloaded.lightmap!.floorRGB === "string" &&
      reloaded.lightmap!.floorRGB.length > 0,
    `floorRGB populated (${reloaded.lightmap!.floorRGB?.length ?? 0} chars)`,
  );
  assert(
    typeof reloaded.lightmap!.ceilingRGB === "string" &&
      reloaded.lightmap!.ceilingRGB.length > 0,
    `ceilingRGB populated (${reloaded.lightmap!.ceilingRGB?.length ?? 0} chars)`,
  );
  assert(
    reloaded.lightmap!.width === 4 && reloaded.lightmap!.height === 4,
    `lightmap dims match scene (${reloaded.lightmap!.width}×${reloaded.lightmap!.height})`,
  );

  // 4. Engine sanity: IdbAssetPack.scene() parses the baked scene.
  const pack = await IdbAssetPack.fromProject(projectId);
  let parsedScene;
  try {
    parsedScene = await pack.scene(scenePath);
    assert(true, "baked scene parses through IdbAssetPack.scene()");
  } catch (err) {
    assert(false, `baked scene parses (${(err as Error).message})`);
  }
  if (parsedScene) {
    assert(
      parsedScene.size.x === 4 && parsedScene.size.y === 4,
      `parsed scene grid is 4×4 (${parsedScene.size.x}×${parsedScene.size.y})`,
    );
    // The engine populated a real lightmap from the bake (not the
    // uniform-1 fallback). Both floor + ceiling Float32Arrays should
    // have the expected (W*K+1)*(H*K+1)*3 length.
    const K = reloaded.lightmap!.resolution ?? 1;
    const expected = (4 * K + 1) * (4 * K + 1) * 3;
    assert(
      parsedScene.lightmap.floorRGB.length === expected,
      `runtime floorRGB length matches K=${K} (${parsedScene.lightmap.floorRGB.length} === ${expected})`,
    );
  }

  // Cleanup.
  await EditorProjectStore.deleteProject(projectId);

  console.log();
  console.log(`E4 smoke test: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error("E4 smoke test crashed:", err);
  process.exit(1);
});

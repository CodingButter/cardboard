/**
 * E3 smoke test — exercises the GridEditor's mutation pathway end-to-end
 * against the real default-pack via fake-indexeddb.
 *
 * We can't drive the React canvas from a script, but the mutation
 * pathway is pure logic (preset-id allocation, idMap upserts, row
 * replacement, JSON.stringify, `EditorProjectStore.saveAsset`). This
 * script reproduces those steps exactly:
 *
 *   1. Import default.apg into IDB.
 *   2. Load the start scene as JSON, identify a `0` cell on the walls
 *      grid (or place at center if the map is fully painted).
 *   3. Allocate a fresh idMap id for a named preset (e.g. `brick.wall`).
 *   4. Mutate the row in place, rebuild the scene with replaceLayer
 *      semantics, JSON.stringify, save via `EditorProjectStore.saveAsset`.
 *   5. Reload the scene from IDB, assert the mutated cell + idMap
 *      entry survived.
 *   6. Re-run the IdbAssetPack → engine `scene()` path to make sure
 *      the modified scene still parses cleanly through the resolver
 *      (i.e. the engine could boot against it after a Play-mode flip).
 *
 * Run:
 *   cd apps/editor && bun run scripts/smoke-edit.ts
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import "fake-indexeddb/auto";

import {
  EditorProjectStore,
  _resetDBCache,
} from "../src/lib/EditorProjectStore";
import { IdbAssetPack, isRleGrid } from "@two_5_d/engine";
import { importPackFromBlob } from "../src/lib/importPack";
import {
  parseSceneText,
  stringifySceneRle,
} from "../src/lib/sceneSerde";

// Pack file was renamed default.apg → Cardboard.apg in the
// "Cardboard pack rename" commit; keep the smoke pointed at the
// new artefact so the round-trip still exercises real default-pack
// content (now shipped with RLE scene grids).
const PACK_PATH = resolve(
  import.meta.dir,
  "..",
  "..",
  "game",
  "public",
  "packs",
  "Cardboard.apg",
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

// --- Helpers that mirror GridEditor's mutation logic verbatim ---

interface MutableScene {
  spawn?: { x: number; y: number; facing?: number };
  idMap?: Record<string, string | null>;
  walls: Array<Array<number>>;
  floors?: Array<Array<number>>;
  ceiling?: Array<Array<number>>;
  ceilings?: Array<Array<number>>;
  [key: string]: unknown;
}

function ensureIdMap(scene: MutableScene): Record<string, string | null> {
  return { ...(scene.idMap ?? { "0": null }) };
}

function findIdForPreset(
  idMap: Record<string, string | null>,
  presetId: string,
): number | null {
  for (const [k, v] of Object.entries(idMap)) {
    if (v === presetId) return Number(k);
  }
  return null;
}

function nextFreeId(idMap: Record<string, string | null>): number {
  let max = 0;
  for (const k of Object.keys(idMap)) {
    const n = Number(k);
    if (Number.isFinite(n) && n > max) max = n;
  }
  return max + 1;
}

/** Replicates `GridEditor.paintCell` for the walls layer. Returns the
 *  modified scene. */
function paintWall(
  scene: MutableScene,
  x: number,
  y: number,
  presetId: string,
): MutableScene {
  const idMap = ensureIdMap(scene);
  let id = findIdForPreset(idMap, presetId);
  let nextScene = scene;
  if (id === null) {
    id = nextFreeId(idMap);
    idMap[String(id)] = presetId;
    nextScene = { ...nextScene, idMap };
  }
  const height = nextScene.walls.length;
  const width = nextScene.walls[0]?.length ?? 0;
  const rows: Array<Array<number>> = new Array(height);
  for (let yy = 0; yy < height; yy++) {
    const src = nextScene.walls[yy] ?? [];
    if (yy === y) {
      const nextRow = new Array<number>(width);
      for (let xx = 0; xx < width; xx++) nextRow[xx] = src[xx] ?? 0;
      nextRow[x] = id;
      rows[yy] = nextRow;
    } else {
      rows[yy] = src;
    }
  }
  return { ...nextScene, walls: rows };
}

async function main() {
  _resetDBCache();

  console.log(`Reading ${PACK_PATH}`);
  const bytes = readFileSync(PACK_PATH);
  const blob = new Blob([new Uint8Array(bytes)]);

  console.log("Importing pack…");
  const result = await importPackFromBlob(blob);
  assert(result.project?.id, "import returned a project id");
  const projectId = result.project.id;

  const manifest = await EditorProjectStore.loadManifest(projectId);
  assert(manifest !== null, "manifest loaded");
  const startScene = manifest!.startScene;
  assert(typeof startScene === "string", "manifest.startScene set");

  // Load the start scene as raw JSON — this is exactly what
  // ProjectView's edit-mode loader does before handing the parsed
  // object to GridEditor.
  const sceneBodyBefore = await EditorProjectStore.loadAsset(
    projectId,
    startScene,
  );
  assert(typeof sceneBodyBefore === "string", "scene loaded as text");
  // Real editor load path: parseSceneText normalises RLE grids → nested
  // arrays so the GridEditor's paint helpers below operate on the same
  // shape regardless of what the on-disk scene shipped as.
  const sceneBefore = parseSceneText<MutableScene>(sceneBodyBefore as string);
  assert(Array.isArray(sceneBefore.walls), "scene has a walls grid (normalised)");

  // Find a cell to mutate. We pick (1, 1) — guaranteed in-bounds for
  // every default-pack scene, and a value we can sanity-check before/after.
  const targetX = 1;
  const targetY = 1;
  const valueBefore = sceneBefore.walls[targetY]?.[targetX] ?? 0;
  console.log(
    `  start scene "${startScene}" — wall[${targetY}][${targetX}] = ${valueBefore}`,
  );

  // Pick a named preset known to exist in default-pack manifest.
  const presetId = "brick.wall";

  // Apply paint mutation.
  const sceneAfter = paintWall(sceneBefore, targetX, targetY, presetId);
  const afterId = sceneAfter.walls[targetY]?.[targetX];
  assert(typeof afterId === "number" && afterId > 0, "paint wrote a non-zero id");
  const mapped = sceneAfter.idMap?.[String(afterId)];
  assert(mapped === presetId, `idMap[${afterId}] === "${presetId}"`);

  // Persist via the same store API the editor uses, via
  // `stringifySceneRle` so the on-disk shape stays RLE.
  await EditorProjectStore.saveAsset(
    projectId,
    startScene,
    stringifySceneRle(sceneAfter as unknown as Record<string, unknown>),
  );

  // Reload to confirm round-trip.
  const sceneBodyReloaded = await EditorProjectStore.loadAsset(
    projectId,
    startScene,
  );
  assert(
    typeof sceneBodyReloaded === "string",
    "scene round-trips as text",
  );
  // Inspect the raw text BEFORE normalising — the on-disk shape
  // should be the RLE wire form (matches what default-pack ships).
  const rawReloaded = JSON.parse(sceneBodyReloaded as string) as Record<
    string,
    unknown
  >;
  assert(
    isRleGrid(rawReloaded.walls),
    "saved scene preserves RLE wire form for walls",
  );
  // Now normalise + assert the painted cell survived.
  const sceneReloaded = parseSceneText<MutableScene>(sceneBodyReloaded as string);
  const reloadedId = sceneReloaded.walls[targetY]?.[targetX];
  assert(
    reloadedId === afterId,
    `reloaded wall[${targetY}][${targetX}] === ${afterId}`,
  );
  assert(
    sceneReloaded.idMap?.[String(afterId)] === presetId,
    `reloaded idMap[${afterId}] === "${presetId}"`,
  );

  // Verify the engine can still boot against the mutated scene by
  // running it through IdbAssetPack.scene() — the same path the
  // viewport uses when flipping back to Play mode.
  const pack = await IdbAssetPack.fromProject(projectId);
  let parsedScene;
  try {
    parsedScene = await pack.scene(startScene);
    assert(true, "edited scene parses through IdbAssetPack.scene()");
  } catch (err) {
    assert(false, `edited scene parses (${(err as Error).message})`);
  }
  if (parsedScene) {
    assert(
      parsedScene.size.x > 0 && parsedScene.size.y > 0,
      `parsed scene has non-empty grid (${parsedScene.size.x}×${parsedScene.size.y})`,
    );
    // The painted cell should now be a wall in the runtime view.
    assert(
      parsedScene.isWall(targetX, targetY),
      `runtime scene reports wall at (${targetX}, ${targetY})`,
    );
  }

  // Re-running the paint with the SAME preset should reuse the same
  // idMap id (no duplicate allocation).
  const sceneRepaint = paintWall(sceneReloaded, 2, 2, presetId);
  const repaintId = sceneRepaint.walls[2]?.[2];
  assert(
    repaintId === afterId,
    `repaint of same preset reuses idMap id (${repaintId} === ${afterId})`,
  );
  const allMappingsCount = Object.values(sceneRepaint.idMap ?? {}).filter(
    (v) => v === presetId,
  ).length;
  assert(
    allMappingsCount === 1,
    `idMap contains exactly one entry for "${presetId}" (${allMappingsCount})`,
  );

  // Cleanup.
  await EditorProjectStore.deleteProject(projectId);
  const remaining = await EditorProjectStore.listProjects();
  assert(
    !remaining.some((p) => p.id === projectId),
    "test project removed after smoke run",
  );

  console.log();
  console.log(`E3 smoke test: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error("E3 smoke test crashed:", err);
  process.exit(1);
});

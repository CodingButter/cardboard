/**
 * Smoke test for `lib/chainConflictDetector.ts` + `lib/resolveDepChain.ts`.
 *
 * Builds two synthetic `.apg` packs in a tmpdir, each declaring some
 * deliberately-overlapping content (texture path, sprite id, item id,
 * preset id, post-pass name, prefab id, sound id, script path).
 * Resolves them via the engine's ChainResolver (file:// URLs work
 * under Bun), runs `detectConflicts`, and asserts the resulting
 * report flags every overlap with the correct winner/loser.
 *
 * Also covers:
 *   - flipping declaration order swaps winner/loser
 *   - `enabled: false` deps are excluded
 *   - empty `requires[]` returns an empty report
 *
 * Run with:
 *   cd apps/editor && bun run scripts/smoke-chain-conflict.ts
 */

import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import {
  clearChainCache,
  type PackManifest,
  type PackRequiresEntry,
} from "@two_5_d/engine";
import { resolveDepChain } from "../src/lib/resolveDepChain";
import { detectConflicts } from "../src/lib/chainConflictDetector";

import JSZip from "jszip";

let passed = 0;
let failed = 0;
function assert(cond: unknown, msg: string): void {
  if (cond) {
    passed++;
    console.log(`  ok  ${msg}`);
  } else {
    failed++;
    console.error(`  FAIL ${msg}`);
  }
}
function assertEqual<T>(actual: T, expected: T, msg: string): void {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) {
    passed++;
    console.log(`  ok  ${msg}`);
  } else {
    failed++;
    console.error(
      `  FAIL ${msg}\n    expected ${JSON.stringify(expected)}\n    actual   ${JSON.stringify(actual)}`,
    );
  }
}

async function buildFakePack(
  manifest: PackManifest,
  extraFiles: Record<string, string | Uint8Array> = {},
): Promise<Uint8Array> {
  const zip = new JSZip();
  zip.file("manifest.json", JSON.stringify(manifest, null, 2));
  for (const [p, body] of Object.entries(extraFiles)) {
    zip.file(p, body);
  }
  return new Uint8Array(await zip.generateAsync({ type: "uint8array" }));
}

async function sriOf(bytes: Uint8Array): Promise<string> {
  const digest = new Uint8Array(
    await crypto.subtle.digest("SHA-256", bytes as BufferSource),
  );
  let bin = "";
  for (let i = 0; i < digest.length; i++) bin += String.fromCharCode(digest[i]!);
  return `sha256-${btoa(bin)}`;
}

const tmp = await mkdtemp(join(tmpdir(), "chain-conflict-smoke-"));
console.log(`temp dir: ${tmp}`);

/* ────────────────────────────────────────────────────────────────
 * Pack A — declares a battery of identifiers.
 * ─────────────────────────────────────────────────────────────── */
const packAManifest: PackManifest = {
  id: "pack-a",
  name: "pack-a",
  version: "1.0.0",
  tileTextures: {},
  tileSheets: [],
  startScene: "scenes/none.json",
  sprites: {
    zombie: { image: "images/zombie.png" },
    aOnly: { image: "images/aonly.png" },
  },
  items: {
    health: { name: "Health A", image: "images/health.png", type: "misc" },
  },
  prefabs: {
    spawner: { name: "spawner", components: {} },
  },
  sounds: {
    boom: { file: "audio/boom.ogg" },
  },
  scripts: ["scripts/shared.js"],
  tilePresets: ["presets/walls.jsonc"],
  shaders: {
    postPasses: [{ name: "crt", frag: "shaders/crt.glsl" }],
  },
};
const packAFiles: Record<string, string | Uint8Array> = {
  "images/zombie.png": "ZOMBIE_A_BYTES",
  "images/aonly.png": "AONLY_BYTES",
  "images/health.png": "HEALTH_A_BYTES",
  "images/brick.png": "BRICK_A_BYTES",
  "audio/boom.ogg": "BOOM_A_BYTES",
  "scripts/shared.js": "// shared A",
  "shaders/crt.glsl": "void main(){}",
  "presets/walls.jsonc": JSON.stringify({
    "brick.wall": { texture: "images/brick.png" },
    "aonly.wall": { texture: "images/aonly.png" },
  }),
};
const packABytes = await buildFakePack(packAManifest, packAFiles);
const packAPath = join(tmp, "pack-a.apg");
await writeFile(packAPath, packABytes);
const packAUrl = pathToFileURL(packAPath).toString();
const packASri = await sriOf(packABytes);

/* ────────────────────────────────────────────────────────────────
 * Pack B — overlaps with pack A on a few keys, also has its own.
 * ─────────────────────────────────────────────────────────────── */
const packBManifest: PackManifest = {
  id: "pack-b",
  name: "pack-b",
  version: "1.0.0",
  tileTextures: {},
  tileSheets: [],
  startScene: "scenes/none.json",
  sprites: {
    zombie: { image: "images/zombie.png" }, // CONFLICT with pack-a
    bOnly: { image: "images/bonly.png" },
  },
  items: {
    health: { name: "Health B", image: "images/health.png", type: "misc" }, // CONFLICT
  },
  prefabs: {
    spawner: { name: "spawner", components: {} }, // CONFLICT
  },
  sounds: {
    boom: { file: "audio/boom.ogg" }, // CONFLICT
  },
  scripts: ["scripts/shared.js"], // CONFLICT
  tilePresets: ["presets/walls.jsonc"],
  shaders: {
    postPasses: [{ name: "crt", frag: "shaders/crt.glsl" }], // CONFLICT
  },
};
const packBFiles: Record<string, string | Uint8Array> = {
  "images/zombie.png": "ZOMBIE_B_BYTES", // path conflict
  "images/bonly.png": "BONLY_BYTES",
  "images/health.png": "HEALTH_B_BYTES", // path conflict
  "images/brick.png": "BRICK_B_BYTES", // path conflict
  "audio/boom.ogg": "BOOM_B_BYTES", // path conflict
  "scripts/shared.js": "// shared B", // path conflict
  "shaders/crt.glsl": "void main(){}", // path conflict
  "presets/walls.jsonc": JSON.stringify({
    "brick.wall": { texture: "images/brick.png" }, // preset conflict
    "bonly.wall": { texture: "images/bonly.png" },
  }),
};
const packBBytes = await buildFakePack(packBManifest, packBFiles);
const packBPath = join(tmp, "pack-b.apg");
await writeFile(packBPath, packBBytes);
const packBUrl = pathToFileURL(packBPath).toString();
const packBSri = await sriOf(packBBytes);

/* ────────────────────────────────────────────────────────────────
 * Test 1 — [A, B] declared: B wins everywhere.
 * ─────────────────────────────────────────────────────────────── */
console.log("\n[1] detectConflicts on [A, B] reports B as the winner");
{
  clearChainCache();
  const requires: PackRequiresEntry[] = [
    { id: "pack-a", url: packAUrl, integrity: packASri },
    { id: "pack-b", url: packBUrl, integrity: packBSri },
  ];
  const { chain, errors } = await resolveDepChain(requires);
  assertEqual(errors.length, 0, "resolveDepChain has no errors");
  assertEqual(chain.length, 2, "chain has 2 entries (one per declared dep)");
  assertEqual(chain[0]?.url, packAUrl, "chain[0] is pack-a (declared first)");
  assertEqual(chain[1]?.url, packBUrl, "chain[1] is pack-b (declared second)");

  const report = await detectConflicts(chain);
  const byKind: Record<string, number> = {};
  for (const c of report.conflicts) {
    byKind[c.kind] = (byKind[c.kind] ?? 0) + 1;
  }
  // Asset-path conflicts: zombie.png, health.png, brick.png, boom.ogg,
  // shared.js, crt.glsl, walls.jsonc → 7
  assert(
    (byKind["asset-path"] ?? 0) >= 6,
    `at least 6 asset-path conflicts (got ${byKind["asset-path"] ?? 0})`,
  );
  assertEqual(byKind["manifest-sprite"] ?? 0, 1, "1 sprite conflict (zombie)");
  assertEqual(byKind["manifest-item"] ?? 0, 1, "1 item conflict (health)");
  assertEqual(byKind["manifest-prefab"] ?? 0, 1, "1 prefab conflict (spawner)");
  assertEqual(byKind["manifest-sound"] ?? 0, 1, "1 sound conflict (boom)");
  assertEqual(byKind["manifest-script"] ?? 0, 1, "1 script conflict (shared.js)");
  assertEqual(byKind["shader-material"] ?? 0, 1, "1 material conflict (crt)");
  assertEqual(byKind["tile-preset"] ?? 0, 1, "1 tile-preset conflict (brick.wall)");

  // Every conflict has pack-b as the winner.
  const allBWins = report.conflicts.every((c) => c.winner === packBUrl);
  assert(allBWins, "every conflict lists pack-b as the winner");
  const allAlosers = report.conflicts.every((c) => c.losers.includes(packAUrl));
  assert(allAlosers, "every conflict lists pack-a in losers");

  // Per-dep counts: both packs are in every conflict, so both should
  // have a non-zero count equal to total conflicts.
  const aCount = report.countsByDep.get(packAUrl) ?? 0;
  const bCount = report.countsByDep.get(packBUrl) ?? 0;
  assertEqual(
    aCount,
    report.conflicts.length,
    "pack-a's per-dep count equals total conflicts",
  );
  assertEqual(
    bCount,
    report.conflicts.length,
    "pack-b's per-dep count equals total conflicts",
  );

  // Spot-check a known conflict — the sprite namespace 'zombie'.
  const zombie = report.conflicts.find(
    (c) => c.kind === "manifest-sprite" && c.identifier === "zombie",
  );
  assert(zombie !== undefined, "zombie sprite conflict is present");
  if (zombie) {
    assertEqual(zombie.winner, packBUrl, "zombie winner is pack-b");
    assertEqual(zombie.losers, [packAUrl], "zombie loser is pack-a");
  }

  // Spot-check the tile-preset conflict — identifier is the preset id.
  const brick = report.conflicts.find(
    (c) => c.kind === "tile-preset" && c.identifier === "brick.wall",
  );
  assert(brick !== undefined, "brick.wall preset conflict is present");
  if (brick) {
    assertEqual(brick.winner, packBUrl, "brick.wall winner is pack-b");
    assert(
      brick.details?.includes("presets/walls.jsonc") === true,
      "brick.wall details mention the source file",
    );
  }
}

/* ────────────────────────────────────────────────────────────────
 * Test 2 — flip the order to [B, A]: A now wins.
 * ─────────────────────────────────────────────────────────────── */
console.log("\n[2] flipping [A, B] → [B, A] swaps winner/loser");
{
  clearChainCache();
  const requires: PackRequiresEntry[] = [
    { id: "pack-b", url: packBUrl, integrity: packBSri },
    { id: "pack-a", url: packAUrl, integrity: packASri },
  ];
  const { chain } = await resolveDepChain(requires);
  const report = await detectConflicts(chain);

  const allAwins = report.conflicts.every((c) => c.winner === packAUrl);
  assert(allAwins, "with [B, A] every conflict has pack-a as the winner");
  const zombie = report.conflicts.find(
    (c) => c.kind === "manifest-sprite" && c.identifier === "zombie",
  );
  if (zombie) {
    assertEqual(zombie.winner, packAUrl, "zombie winner is pack-a after flip");
    assertEqual(zombie.losers, [packBUrl], "zombie loser is pack-b after flip");
  }
}

/* ────────────────────────────────────────────────────────────────
 * Test 3 — pack B disabled: no conflicts attributed.
 * ─────────────────────────────────────────────────────────────── */
console.log("\n[3] disabled dep is excluded from the conflict report");
{
  clearChainCache();
  const requires: PackRequiresEntry[] = [
    { id: "pack-a", url: packAUrl, integrity: packASri },
    { id: "pack-b", url: packBUrl, integrity: packBSri, enabled: false },
  ];
  const { chain } = await resolveDepChain(requires);
  assertEqual(chain.length, 1, "chain has 1 entry (disabled dep skipped)");
  assertEqual(chain[0]?.url, packAUrl, "remaining chain entry is pack-a");

  const report = await detectConflicts(chain);
  assertEqual(report.conflicts.length, 0, "no conflicts when only one dep is enabled");
  assertEqual(report.countsByDep.size, 0, "countsByDep is empty");
}

/* ────────────────────────────────────────────────────────────────
 * Test 4 — empty requires[]: empty report, no crash.
 * ─────────────────────────────────────────────────────────────── */
console.log("\n[4] empty requires[] produces an empty report");
{
  clearChainCache();
  const { chain, errors } = await resolveDepChain([]);
  assertEqual(chain.length, 0, "empty requires → empty chain");
  assertEqual(errors.length, 0, "empty requires → no errors");
  const report = await detectConflicts(chain);
  assertEqual(report.conflicts.length, 0, "empty chain → empty conflicts list");
}

/* ────────────────────────────────────────────────────────────────
 * Test 5 — `listPaths()` returns the expected files.
 * ─────────────────────────────────────────────────────────────── */
console.log("\n[5] AssetPack.listPaths() enumerates pack files");
{
  clearChainCache();
  const { chain } = await resolveDepChain([
    { id: "pack-a", url: packAUrl, integrity: packASri },
  ]);
  const paths = new Set(chain[0]!.pack.listPaths());
  assert(paths.has("manifest.json"), "listPaths() includes manifest.json");
  assert(paths.has("images/zombie.png"), "listPaths() includes images/zombie.png");
  assert(paths.has("presets/walls.jsonc"), "listPaths() includes the preset file");
}

console.log();
console.log(`Chain-conflict smoke test: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);

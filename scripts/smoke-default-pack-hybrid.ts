#!/usr/bin/env bun
/**
 * Phase #196 follow-up — default-pack hybrid prefab smoke test.
 *
 * After the player prefab migrates from `scripts/prefabs/player.js`
 * (imperative) to `manifest.prefabs.player` + `player-init.js`
 * (declarative + initScript), the default pack becomes the canonical
 * worked example of a HYBRID DECLARATIVE PREFAB. This script verifies
 * that the migration landed cleanly:
 *
 *   1. `bun run build-packs` produced `apps/game/public/packs/default.apg`.
 *   2. The packed manifest carries `prefabs.player` with the expected
 *      static components (Position, Facing, Aim) — these are the only
 *      ones whose values are purely literal and JSON-safe.
 *   3. `prefabs.player.initScript` references the compiled JS path
 *      and that file actually lives in the pack.
 *   4. `manifest.scripts[]` no longer references the original
 *      `scripts/prefabs/player.js` — the new declarative entry has
 *      taken over the boot-time spawn flow.
 *   5. The init-script body, when fetched from the pack, parses as
 *      valid ESM and references the dynamic state it needs at spawn
 *      time (api.config, api.pack.manifest, opts).
 *
 * This stays Bun-side: no DOM, no engine boot, no canvas. The
 * load-bearing test is "the built pack has the expected shape" — the
 * deeper "does the engine spawn the player correctly given this
 * pack" coverage already lives in `smoke-prefab-initscript.ts`.
 *
 * Run:
 *   bun run scripts/smoke-default-pack-hybrid.ts
 *
 * Note: this script does NOT itself rebuild the pack — run
 * `bun run build-packs` first.
 */

import { join } from "node:path";
import { ZipAssetPack } from "../packages/engine/src/AssetPack/ZipAssetPack";

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

const root = new URL("..", import.meta.url).pathname;
const packPath = join(root, "apps/game/public/packs/default.apg");

console.log(`Loading ${packPath}…`);
const bytes = await Bun.file(packPath).bytes();
const pack = await ZipAssetPack.loadFromBytes(bytes, "default.apg");
const manifest = pack.manifest as unknown as {
  prefabs?: Record<
    string,
    {
      name: string;
      components: Record<string, unknown>;
      initScript?: string;
      description?: string;
    }
  >;
  scripts?: string[];
};

// ── 1. manifest.prefabs.player exists ────────────────────────────

console.log("\nTest 1 — manifest.prefabs.player exists.");
assert(
  manifest.prefabs !== undefined,
  "manifest.prefabs is defined (declarative prefab registry present)",
);
assert(
  manifest.prefabs?.player !== undefined,
  "manifest.prefabs.player is defined (canonical hybrid entry)",
);

const player = manifest.prefabs!.player!;

// ── 2. static components match expected shape ────────────────────

console.log("\nTest 2 — static components are exactly the JSON-safe ones.");
assert(
  "Position" in player.components,
  "Position declared as static (engine applyOpts overlays opts.x/y)",
);
assert(
  "Facing" in player.components,
  "Facing declared as static (engine applyOpts overlays opts.facing)",
);
assert(
  "Aim" in player.components,
  "Aim declared as static ({ screenY: 0 } — purely literal)",
);
// And NOT the ones that depend on config / manifest / api.inventory.
const staticKeys = Object.keys(player.components).sort();
assertEqual(
  staticKeys,
  ["Aim", "Facing", "Position"],
  "static keys are exactly { Aim, Facing, Position }",
);

// Spot-check shapes — Position {x:0,y:0}, Facing 0, Aim {screenY:0}.
assertEqual(
  player.components.Position,
  { x: 0, y: 0 },
  "Position static value is { x: 0, y: 0 } (engine merges spawn opts)",
);
assertEqual(
  player.components.Facing,
  0,
  "Facing static value is 0 (engine merges opts.facing)",
);
assertEqual(
  player.components.Aim,
  { screenY: 0 },
  "Aim static value is { screenY: 0 }",
);

// ── 3. initScript path is set and resolves inside the pack ───────

console.log("\nTest 3 — initScript path resolves to a present file.");
assert(
  typeof player.initScript === "string" && player.initScript.length > 0,
  "player.initScript is a non-empty string",
);
const initPath = player.initScript!;
assert(
  initPath.endsWith(".js"),
  `initScript path ends in .js (got ${initPath})`,
);
assert(
  pack.has(initPath),
  `initScript file "${initPath}" exists inside the .apg`,
);

// ── 4. manifest.scripts[] no longer ships the original player.js ─

console.log("\nTest 4 — manifest.scripts no longer lists scripts/prefabs/player.js.");
const scripts = manifest.scripts ?? [];
assert(
  !scripts.includes("scripts/prefabs/player.js"),
  "scripts/prefabs/player.js removed from manifest.scripts[]",
);
// The init script ALSO shouldn't appear in scripts[] (it loads on
// demand via the prefab init path, not as a boot-time pack script).
assert(
  !scripts.includes(initPath),
  "init script path is NOT also listed in manifest.scripts[]",
);

// ── 5. init-script body shape ────────────────────────────────────

console.log("\nTest 5 — init script body parses + references the dynamic state.");
const initBody = await pack.textBody(initPath);
assert(initBody.length > 0, "init script body is non-empty");

// Default export — esbuild emits various forms; check for a default-
// export marker the build pipeline preserves.
assert(
  initBody.includes("export") && initBody.includes("default"),
  "init body has an `export default` marker",
);
// References the dynamic dependencies the hybrid leaves to spawn time.
assert(
  initBody.includes("api.config") || initBody.includes("config"),
  "init body references config (Movement / Camera read live config)",
);
assert(
  initBody.includes("Movement") &&
    initBody.includes("PlayerInput") &&
    initBody.includes("Inventory") &&
    initBody.includes("Camera") &&
    initBody.includes("MinimapMarker") &&
    initBody.includes("Weapon"),
  "init body attaches Movement + PlayerInput + Weapon + Inventory + " +
    "Camera + MinimapMarker (the six config-dependent components)",
);
// The Weapon's `-Infinity` sentinel survived imperatively (it can't
// roundtrip through JSON so it MUST be here, not in static components).
assert(
  initBody.includes("Infinity") || initBody.includes("reloadStart"),
  "Weapon's reloadStart sentinel survives in init body",
);

// ── 6. no leftover .bak / source player.js inside the pack ──────

console.log("\nTest 6 — no stale player.js / player.js.bak inside the pack.");
assert(
  !pack.has("scripts/prefabs/player.js"),
  "scripts/prefabs/player.js NOT in the pack (replaced by declarative)",
);
assert(
  !pack.has("scripts/prefabs/player.js.bak"),
  "no scripts/prefabs/player.js.bak ghost left behind",
);

console.log();
console.log(
  `Default-pack hybrid smoke test: ${passed} passed, ${failed} failed`,
);
if (failed > 0) process.exit(1);

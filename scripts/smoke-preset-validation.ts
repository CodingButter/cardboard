#!/usr/bin/env bun
/**
 * Smoke test for T3 of the tile-preset system.
 *
 * 1. Loads the default-pack manifest + presets via PresetResolver, asserts
 *    zero errors (the migrated default-pack is clean).
 * 2. Loads a deliberately-broken preset library inline, asserts the
 *    expected error shapes appear:
 *      - unknown field with Levenshtein suggestion (`textur` → `texture`)
 *      - bad enum value (`collision: "slid"` → suggestion "solid")
 *      - extends cycle
 *      - wrong-type field
 *
 * Run with:
 *   bun run scripts/smoke-preset-validation.ts
 *
 * See docs/plans/TILE_PRESETS.md §13.
 */

import { join } from "node:path";
import { PresetResolver, type PackManifest } from "../packages/engine/src/index";

const root = new URL("..", import.meta.url).pathname;
const defaultPackRoot = join(root, "packages", "default-pack");

let failed = 0;
function assert(cond: unknown, msg: string): void {
  if (cond) {
    console.log(`  ✔ ${msg}`);
  } else {
    console.log(`  ✘ ${msg}`);
    failed++;
  }
}

/* ────────────────────────────────────────────────────────────────────
 * 1. Default-pack baseline — must validate clean.
 * ────────────────────────────────────────────────────────────────── */
console.log("\n[1] default-pack must resolve with zero preset errors");
{
  const manifestText = await Bun.file(join(defaultPackRoot, "manifest.json")).text();
  const manifest = JSON.parse(manifestText) as PackManifest;
  const resolver = await PresetResolver.build(manifest, manifest.name, (p) =>
    Bun.file(join(defaultPackRoot, p)).text(),
  );
  if (resolver.errors.length > 0) {
    console.log("    Unexpected errors:");
    for (const e of resolver.errors) {
      const keyPath = e.keyPath.length > 0 ? e.keyPath.join(".") : "(file)";
      console.log(`      - ${e.file}:${e.presetId ?? "?"}:${keyPath}: ${e.message}`);
    }
  }
  assert(resolver.errors.length === 0, "default-pack has zero preset errors");
  assert(resolver.presets.size > 0, "default-pack registered at least one preset");
}

/* ────────────────────────────────────────────────────────────────────
 * 2. Broken-preset library — every category of error must surface.
 * ────────────────────────────────────────────────────────────────── */
console.log("\n[2] deliberately-broken preset library must surface every error");
{
  const brokenFile = "presets/broken.jsonc";
  const fakeManifest: PackManifest = {
    name: "broken-test",
    version: "0.0.0",
    engine: "two_5_d@0.1",
    startScene: "scenes/x.json",
    tilePresets: [brokenFile],
  } as unknown as PackManifest;

  // Cover every T3 validation path: unknown field with typo, bad enum,
  // wrong type, self-extending cycle, missing required texture.
  const brokenSource = `{
    // typo on a real field — should suggest "texture"
    "brick.wall.typo": {
      "textur": "images/tiles/brick.png"
    },
    // bad enum value — should suggest "solid"
    "brick.wall.badenum": {
      "texture": "images/tiles/brick.png",
      "collision": "slid"
    },
    // wrong-type field — wallHeight is a number, not a string
    "brick.wall.wrongtype": {
      "texture": "images/tiles/brick.png",
      "wallHeight": "tall"
    },
    // self-extending cycle
    "brick.wall.cycle": {
      "extends": "brick.wall.cycle"
    },
    // missing texture + no extends → required-field error
    "brick.wall.empty": {
      "displayName": "no texture"
    }
  }`;

  const resolver = await PresetResolver.build(
    fakeManifest,
    fakeManifest.name,
    async (p) => {
      if (p === brokenFile) return brokenSource;
      throw new Error(`unexpected file read: ${p}`);
    },
  );

  const errs = resolver.errors;

  const findErr = (predicate: (e: typeof errs[number]) => boolean) =>
    errs.find(predicate);

  // 2a. unknown field with Levenshtein typo suggestion
  const typoErr = findErr(
    (e) => e.presetId === "brick.wall.typo" && e.keyPath.join(".") === "textur",
  );
  assert(typoErr !== undefined, "unknown-field error captured for 'textur'");
  assert(typoErr?.suggestion === "texture", "suggestion for 'textur' is 'texture'");
  assert(
    typoErr?.message.includes('did you mean "texture"'),
    "message includes 'did you mean \"texture\"' hint",
  );

  // 2b. bad enum value with suggestion
  const enumErr = findErr(
    (e) => e.presetId === "brick.wall.badenum" && e.keyPath.join(".") === "collision",
  );
  assert(enumErr !== undefined, "bad-enum error captured for collision='slid'");
  assert(enumErr?.suggestion === "solid", "suggestion for 'slid' is 'solid'");

  // 2c. wrong type
  const typeErr = findErr(
    (e) => e.presetId === "brick.wall.wrongtype" && e.keyPath.join(".") === "wallHeight",
  );
  assert(typeErr !== undefined, "wrong-type error captured for wallHeight='tall'");
  assert(
    typeErr?.message.includes("expected number"),
    "message names the expected type ('number')",
  );

  // 2d. extends self-cycle
  const cycleErr = findErr(
    (e) => e.presetId === "brick.wall.cycle" && e.message.includes("cycle"),
  );
  assert(cycleErr !== undefined, "self-extending cycle reported");

  // 2e. missing required texture surfaces as a hard error
  const missingTex = findErr(
    (e) => e.presetId === "brick.wall.empty" && e.keyPath.join(".") === "texture",
  );
  assert(missingTex !== undefined, "missing-texture error captured");

  // Every error has the structured shape: keyPath array present, file path set.
  const wellShaped = errs.every(
    (e) =>
      Array.isArray(e.keyPath) &&
      typeof e.file === "string" &&
      typeof e.message === "string",
  );
  assert(wellShaped, "every error has structured shape (keyPath/file/message)");
}

/* ────────────────────────────────────────────────────────────────────
 * Summary
 * ────────────────────────────────────────────────────────────────── */
console.log("");
if (failed === 0) {
  console.log("ALL CHECKS PASSED ✓");
  process.exit(0);
} else {
  console.log(`${failed} check(s) FAILED`);
  process.exit(1);
}

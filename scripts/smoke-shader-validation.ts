#!/usr/bin/env bun
/**
 * Smoke test for M5 of the materials system —
 * `docs/plans/MATERIALS.md` §11.
 *
 * 1. Loads every `.glsl` in `packages/default-pack/shaders/` and
 *    validates each one against its expected role. The ship-checked
 *    shaders all pass (they're what the engine compiles successfully
 *    at runtime today).
 * 2. Feeds a deliberately-broken hook file (wrong arity) — asserts
 *    the validator catches it with a structured `signatureDiff`.
 * 3. Feeds a hook file that redeclares an engine uniform — asserts
 *    the "redeclares engine-provided uniform" error fires.
 * 4. Feeds a hook file with an unknown hook name — asserts the
 *    "not a known hook" error fires with a "did you mean" suggestion.
 * 5. Feeds an empty hook file — asserts the "contains no `hook_*`
 *    function definitions" error fires.
 * 6. Confirms the validator's reference collector picks up
 *    manifest.shaders, preset.shader, and scene.shaders entries (the
 *    M2/M3 shapes — exercised even though the in-tree pack doesn't
 *    use them yet).
 *
 * Run with:
 *   bun run scripts/smoke-shader-validation.ts
 */

import { join } from "node:path";
import {
  collectShaderReferences,
  resolveShaderBackend,
  validateShaderSource,
} from "../packages/engine/src/index";

const root = new URL("..", import.meta.url).pathname;
const defaultPackRoot = join(root, "packages", "default-pack");

let failed = 0;
function assert(cond: unknown, msg: string): void {
  if (cond) {
    console.log(`  ok   ${msg}`);
  } else {
    console.log(`  FAIL ${msg}`);
    failed++;
  }
}

const { backend, status } = await resolveShaderBackend();
console.log(
  `\nBackend: ${status.realGLAvailable ? "headless-gl (Path A)" : "syntactic-only (Path B)"}` +
    (status.fallbackReason ? ` — ${status.fallbackReason}` : ""),
);

/* ────────────────────────────────────────────────────────────────────
 * 1. Default-pack shaders must validate clean.
 *
 * The default-pack ships three `.glsl` files:
 *   - `shaders/ghost-sprite.glsl`     (spriteHooks)
 *   - `shaders/night-vision.glsl`     (worldHooks + spriteHooks)
 *   - `shaders/wet-world-hooks.glsl`  (worldHooks)
 *
 * `night-vision.glsl` is referenced from BOTH a worldHooks and a
 * spriteHooks slot in the manifest_example, so we validate it twice —
 * once per role.
 * ────────────────────────────────────────────────────────────────── */
console.log("\n[1] default-pack shaders must validate clean");
{
  const checks: { file: string; role: "worldFrag" | "spriteFrag" | "skyFrag"; key: string }[] = [
    { file: "shaders/ghost-sprite.glsl", role: "spriteFrag", key: "spriteHooks" },
    { file: "shaders/night-vision.glsl", role: "worldFrag", key: "worldHooks" },
    { file: "shaders/night-vision.glsl", role: "spriteFrag", key: "spriteHooks" },
    { file: "shaders/wet-world-hooks.glsl", role: "worldFrag", key: "worldHooks" },
  ];
  for (const c of checks) {
    const src = await Bun.file(join(defaultPackRoot, c.file)).text();
    const r = await validateShaderSource(
      src,
      { shaderPath: c.file, role: c.role, manifestKey: c.key as never },
      { backend },
    );
    if (r.errors.length > 0) {
      console.log(`    Unexpected errors for ${c.file} as ${c.role}:`);
      for (const e of r.errors) {
        console.log(`      - ${e.message}`);
        if (e.signatureDiff) {
          console.log(`          pack:   ${e.signatureDiff.actual}`);
          console.log(`          engine: ${e.signatureDiff.expected}`);
        }
      }
    }
    assert(r.errors.length === 0, `${c.file} (${c.role}) validates clean`);
  }
}

/* ────────────────────────────────────────────────────────────────────
 * 2. Wrong arity — the literal example from the M5 spec.
 *
 * `hook_modifySpriteFinalColor` should take `(vec3, int, vec2)`. We
 * pass it just `(vec3)`. The validator must fire a `signatureDiff`.
 * ────────────────────────────────────────────────────────────────── */
console.log("\n[2] wrong-arity hook must be caught");
{
  const broken = `
    vec3 hook_modifySpriteFinalColor(vec3 base) { return base; }
  `;
  const r = await validateShaderSource(
    broken,
    {
      shaderPath: "inline/broken-arity.glsl",
      role: "spriteFrag",
      manifestKey: "spriteHooks",
    },
    { backend },
  );
  assert(r.errors.length > 0, "broken-arity shader produced at least one error");
  const sigErr = r.errors.find((e) => e.signatureDiff?.hookName === "hook_modifySpriteFinalColor");
  assert(sigErr !== undefined, "error has a signatureDiff for hook_modifySpriteFinalColor");
  assert(
    sigErr?.signatureDiff?.expected.includes("vec3, int, vec2") ||
      sigErr?.signatureDiff?.expected.match(/\(vec3.*int.*vec2/) !== null,
    "expected signature mentions (vec3, int, vec2)",
  );
  assert(
    sigErr?.signatureDiff?.actual.includes("vec3 base") || sigErr?.signatureDiff?.actual.includes("vec3"),
    "actual signature is reported",
  );
}

/* ────────────────────────────────────────────────────────────────────
 * 3. Redeclares an engine-provided uniform.
 *
 * `u_resolution` is in the world + sprite headers. A pack that
 * accidentally pastes it into a hook file is a duplicate-decl
 * compile error — the validator catches it via static text scan.
 * ────────────────────────────────────────────────────────────────── */
console.log("\n[3] redeclaring an engine uniform must be caught");
{
  const broken = `
    uniform vec2 u_resolution;
    vec3 hook_modifyFinalColor(vec3 base, vec2 worldPos, int surface) {
      return base * vec3(u_resolution.x);
    }
  `;
  const r = await validateShaderSource(
    broken,
    {
      shaderPath: "inline/dup-uniform.glsl",
      role: "worldFrag",
      manifestKey: "worldHooks",
    },
    { backend },
  );
  const dupErr = r.errors.find((e) => e.message.includes("u_resolution"));
  assert(dupErr !== undefined, "duplicate-uniform error fired for u_resolution");
  assert(
    dupErr?.message.includes("redeclares engine-provided uniform"),
    "message names the duplicate-uniform failure",
  );
}

/* ────────────────────────────────────────────────────────────────────
 * 4. Unknown hook name — typo on a real hook surfaces a suggestion.
 * ────────────────────────────────────────────────────────────────── */
console.log("\n[4] unknown hook name must be caught with a 'did you mean'");
{
  const broken = `
    vec3 hook_modifyFinalColr(vec3 base, vec2 worldPos, int surface) {
      return base;
    }
  `;
  const r = await validateShaderSource(
    broken,
    {
      shaderPath: "inline/typo.glsl",
      role: "worldFrag",
      manifestKey: "worldHooks",
    },
    { backend },
  );
  const typoErr = r.errors.find((e) => e.message.includes("hook_modifyFinalColr"));
  assert(typoErr !== undefined, "unknown-hook error fired for typo'd hook");
  assert(
    typoErr?.suggestion === "hook_modifyFinalColor",
    "suggestion is hook_modifyFinalColor",
  );
}

/* ────────────────────────────────────────────────────────────────────
 * 5. Empty hook file.
 * ────────────────────────────────────────────────────────────────── */
console.log("\n[5] empty hook file must be caught");
{
  const empty = `
    // a hook file with no actual hooks. Common mid-edit mistake.
  `;
  const r = await validateShaderSource(
    empty,
    {
      shaderPath: "inline/empty.glsl",
      role: "spriteFrag",
      manifestKey: "spriteHooks",
    },
    { backend },
  );
  const emptyErr = r.errors.find((e) => e.message.includes("no `hook_*` function definitions"));
  assert(emptyErr !== undefined, "empty hook file produced 'no hook_*' error");
}

/* ────────────────────────────────────────────────────────────────────
 * 6. Reference collector — verifies the manifest + preset + scene
 *    crawl reaches every expected slot. Synthetic inputs so this test
 *    doesn't depend on M2/M3 schemas landing first.
 * ────────────────────────────────────────────────────────────────── */
console.log("\n[6] collectShaderReferences walks manifest, presets, and scenes");
{
  const refs = collectShaderReferences(
    {
      shaders: {
        worldHooks: "shaders/world-pack-hooks.glsl",
        spriteFrag: "shaders/full-sprite-body.glsl",
      },
    },
    [
      // Preset using the shorthand string form → worldHooks.
      { id: "wet.floor", file: "presets/floors.jsonc", shader: "shaders/wet-floor.glsl" },
      // Preset using the block form → worldHooks + skyHooks.
      {
        id: "fancy.floor",
        file: "presets/floors.jsonc",
        shader: { worldHooks: "shaders/fancy-world.glsl", skyHooks: "shaders/fancy-sky.glsl" },
      },
    ],
    [
      {
        path: "scenes/underwater.json",
        shaders: { spriteHooks: "shaders/uw-sprite.glsl", worldHooks: "shaders/uw-world.glsl" },
      },
    ],
  );
  const paths = refs.map((r) => `${r.role}::${r.manifestKey}::${r.path}`);
  assert(
    paths.includes("worldFrag::worldHooks::shaders/world-pack-hooks.glsl"),
    "manifest.worldHooks collected",
  );
  assert(
    paths.includes("spriteFrag::spriteFrag::shaders/full-sprite-body.glsl"),
    "manifest.spriteFrag collected",
  );
  assert(
    paths.includes("worldFrag::worldHooks::shaders/wet-floor.glsl"),
    "preset-shorthand string form collected as worldHooks",
  );
  assert(
    paths.includes("worldFrag::worldHooks::shaders/fancy-world.glsl"),
    "preset-block worldHooks collected",
  );
  assert(
    paths.includes("skyFrag::skyHooks::shaders/fancy-sky.glsl"),
    "preset-block skyHooks collected",
  );
  assert(
    paths.includes("spriteFrag::spriteHooks::shaders/uw-sprite.glsl"),
    "scene.spriteHooks collected",
  );
  assert(
    paths.includes("worldFrag::worldHooks::shaders/uw-world.glsl"),
    "scene.worldHooks collected",
  );
}

/* ────────────────────────────────────────────────────────────────────
 * Summary
 * ────────────────────────────────────────────────────────────────── */
console.log("");
if (failed === 0) {
  console.log("ALL CHECKS PASSED");
  process.exit(0);
} else {
  console.log(`${failed} check(s) FAILED`);
  process.exit(1);
}

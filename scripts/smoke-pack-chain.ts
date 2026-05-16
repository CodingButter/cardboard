#!/usr/bin/env bun
/**
 * Smoke test for Phase P1 of `docs/plans/PACK_CHAIN.md`.
 *
 * Builds the default pack, constructs a couple of fake "child" packs
 * inline with deliberate dependency declarations, and walks every
 * branch of the ChainResolver:
 *
 *   1. Happy path — child requires default by url+integrity; resolver
 *      returns [default, child] in that order, default is the same
 *      instance both call sites see (cache test).
 *   2. Integrity mismatch — corrupt the SRI hash; resolver throws.
 *   3. Cycle — pack A requires pack B requires pack A; resolver throws
 *      with a path-annotated cycle error.
 *
 * Runs entirely against `file://` URLs in `/tmp` so no network needed.
 * `fetch()` in Bun supports `file://` natively; the same code path
 * runs against `http(s)://` URLs in the browser at runtime.
 *
 * Run with:
 *   bun run scripts/smoke-pack-chain.ts
 *
 * Exits non-zero on any failed assertion.
 */

import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import {
  cascadeHooks,
  cascadePostPasses,
  chainHasMode1ForRole,
  clearChainCache,
  findMode1WinnerForRole,
  resolveChain,
  satisfies,
  type PackManifest,
} from "../packages/engine/src/index";

// jszip lives only inside `packages/engine/node_modules` (workspace
// hoisting doesn't pull it to root). Reach into the engine's local
// install so this script can be run directly from the repo root via
// `bun run scripts/smoke-pack-chain.ts`.
const { default: JSZip } = (await import(
  "../packages/engine/node_modules/jszip/dist/jszip.min.js"
)) as { default: typeof import("jszip") };

let failed = 0;
function assert(cond: unknown, msg: string): void {
  if (cond) {
    console.log(`  ✔ ${msg}`);
  } else {
    console.log(`  ✘ ${msg}`);
    failed++;
  }
}

/** Build the minimal `.apg` bytes for a manifest, optionally with extra files. */
async function buildFakePack(
  manifest: PackManifest,
  extraFiles: Record<string, string> = {},
): Promise<Uint8Array> {
  const zip = new JSZip();
  zip.file("manifest.json", JSON.stringify(manifest, null, 2));
  for (const [path, body] of Object.entries(extraFiles)) {
    zip.file(path, body);
  }
  return new Uint8Array(await zip.generateAsync({ type: "uint8array" }));
}

/** SHA-256 → `sha256-<base64>` SRI string. */
async function sriOf(bytes: Uint8Array): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  let bin = "";
  for (let i = 0; i < digest.length; i++) bin += String.fromCharCode(digest[i]!);
  return `sha256-${btoa(bin)}`;
}

const tmp = await mkdtemp(join(tmpdir(), "pack-chain-smoke-"));
console.log(`temp dir: ${tmp}`);

/* ────────────────────────────────────────────────────────────────────
 * 0. Ensure the default-pack `.apg` exists; if not, instruct the user.
 *    The smoke test could rebuild it, but `bun run build-packs`
 *    requires the pack-builder pipeline and we want a fast feedback
 *    loop. Fall back to a fake "base" pack when missing.
 * ────────────────────────────────────────────────────────────────── */
const defaultApgPath = join(
  new URL("..", import.meta.url).pathname,
  "apps",
  "game",
  "public",
  "packs",
  "default.apg",
);
const defaultExists = await Bun.file(defaultApgPath).exists();
if (defaultExists) {
  console.log(`using built default pack at ${defaultApgPath}`);
} else {
  console.log(`(no built default pack found — using a synthesized "base" pack)`);
}

const baseBytes = defaultExists
  ? new Uint8Array(await Bun.file(defaultApgPath).arrayBuffer())
  : await buildFakePack({
      id: "base",
      name: "base",
      version: "1.0.0",
      tileTextures: {},
      tileSheets: [],
      startScene: "scenes/none.json",
    });
const basePath = join(tmp, "base.apg");
await writeFile(basePath, baseBytes);
const baseUrl = pathToFileURL(basePath).toString();
const baseIntegrity = await sriOf(baseBytes);

/* ────────────────────────────────────────────────────────────────────
 * 1. Happy path — child requires base; resolver returns [base, child].
 * ────────────────────────────────────────────────────────────────── */
console.log("\n[1] resolveChain returns deps before dependents");
{
  clearChainCache();
  const childManifest: PackManifest = {
    id: "child",
    name: "child",
    version: "0.1.0",
    tileTextures: {},
    tileSheets: [],
    startScene: "scenes/none.json",
    requires: [{ id: "base", url: baseUrl, integrity: baseIntegrity }],
  };
  const childBytes = await buildFakePack(childManifest);
  const childPath = join(tmp, "child.apg");
  await writeFile(childPath, childBytes);
  const childUrl = pathToFileURL(childPath).toString();

  const chain = await resolveChain(childUrl);
  assert(chain.length === 2, `chain length is 2 (got ${chain.length})`);
  assert(chain[0]!.manifest.name === "base" || chain[0]!.manifest.name === "default",
    `chain[0] is the base pack (got "${chain[0]!.manifest.name}")`);
  assert(chain[1]!.manifest.name === "child",
    `chain[1] is the child pack (got "${chain[1]!.manifest.name}")`);

  // Cache identity — resolving the same URL again returns the same
  // child instance (and re-uses the base pack).
  const chain2 = await resolveChain(childUrl);
  assert(chain2[1] === chain[1]!, "second resolve returns cached root pack");
  assert(chain2[0] === chain[0]!, "second resolve returns cached dep pack");
}

/* ────────────────────────────────────────────────────────────────────
 * 2. Integrity mismatch — corrupt the SRI; resolver throws.
 * ────────────────────────────────────────────────────────────────── */
console.log("\n[2] integrity mismatch hard-aborts");
{
  clearChainCache();
  const tamperedManifest: PackManifest = {
    id: "child-bad",
    name: "child-bad",
    version: "0.1.0",
    tileTextures: {},
    tileSheets: [],
    startScene: "scenes/none.json",
    requires: [
      {
        id: "base",
        url: baseUrl,
        // Same length, valid base64, but wrong bytes.
        integrity: "sha256-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
      },
    ],
  };
  const childBytes = await buildFakePack(tamperedManifest);
  const childPath = join(tmp, "child-bad.apg");
  await writeFile(childPath, childBytes);
  const childUrl = pathToFileURL(childPath).toString();

  let threw = false;
  let errMsg = "";
  try {
    await resolveChain(childUrl);
  } catch (e) {
    threw = true;
    errMsg = (e as Error).message;
  }
  assert(threw, "resolveChain threw on integrity mismatch");
  assert(
    /integrity mismatch/i.test(errMsg),
    `error message mentions "integrity mismatch" (got: ${errMsg.slice(0, 120)}…)`,
  );
}

/* ────────────────────────────────────────────────────────────────────
 * 3. Cycle — pack A requires B, pack B requires A.
 * ────────────────────────────────────────────────────────────────── */
console.log("\n[3] dependency cycle hard-aborts");
{
  clearChainCache();
  const aPath = join(tmp, "a.apg");
  const bPath = join(tmp, "b.apg");
  const aUrl = pathToFileURL(aPath).toString();
  const bUrl = pathToFileURL(bPath).toString();

  // We need the integrity of B to be computable up front. Since A and
  // B mutually reference each other (and integrity hashes change with
  // any byte flip), write them without integrity — that path just
  // emits a warning and continues, which is the same path P1 ships.
  const aManifest: PackManifest = {
    id: "a",
    name: "a",
    version: "0.0.1",
    tileTextures: {},
    tileSheets: [],
    startScene: "scenes/none.json",
    requires: [{ id: "b", url: bUrl }],
  };
  const bManifest: PackManifest = {
    id: "b",
    name: "b",
    version: "0.0.1",
    tileTextures: {},
    tileSheets: [],
    startScene: "scenes/none.json",
    requires: [{ id: "a", url: aUrl }],
  };
  await writeFile(aPath, await buildFakePack(aManifest));
  await writeFile(bPath, await buildFakePack(bManifest));

  let threw = false;
  let errMsg = "";
  try {
    await resolveChain(aUrl);
  } catch (e) {
    threw = true;
    errMsg = (e as Error).message;
  }
  assert(threw, "resolveChain threw on dependency cycle");
  assert(/cycle/i.test(errMsg), `error message mentions "cycle" (got: ${errMsg.slice(0, 120)}…)`);
}

/* ────────────────────────────────────────────────────────────────────
 * 4. Backward compat — resolving a pack with no `requires` returns a
 *    length-1 chain. Confirms default-pack still loads unchanged.
 * ────────────────────────────────────────────────────────────────── */
console.log("\n[4] pack with no `requires` resolves to a length-1 chain");
{
  clearChainCache();
  const chain = await resolveChain(baseUrl);
  assert(chain.length === 1, `chain length is 1 (got ${chain.length})`);
}

/* ────────────────────────────────────────────────────────────────────
 * 5. M4 — pack-chain shader cascade.
 *
 * Build a base pack that ships `shaders.worldHooks` overriding
 * `hook_modifyFogColor`, and a "fog-mod" pack that depends on base
 * and ships its OWN `shaders.worldHooks` overriding the SAME hook
 * plus `hook_modifyReflectivity` (which base doesn't touch). Verify:
 *
 *   - chain length is 2 (base, fog-mod);
 *   - `cascadeHooks(chain, "worldHooks")` returns BOTH hooks;
 *   - `hook_modifyFogColor` body is fog-mod's (last-wins);
 *   - `hook_modifyReflectivity` body is base's (sparse override
 *     inheritance);
 *   - the same call logs a conflict warning naming both packs.
 *
 * Also exercise Mode 1 cascade + post-pass cascade in the same
 * fixture pair.
 * ────────────────────────────────────────────────────────────────── */
console.log("\n[5] M4 — hook cascade across a 2-pack chain");
{
  clearChainCache();

  const baseFogBody = `vec3 hook_modifyFogColor(vec3 base) { return vec3(1.0, 0.0, 0.0); }`;
  const baseReflBody = `float hook_modifyReflectivity(float base, vec2 c, int s) { return 0.5; }`;
  const baseHooks = `${baseFogBody}\n${baseReflBody}\n`;
  const baseSpriteFrag = `void main() { /* base mode-1 sprite */ }`;
  const baseCrtPass = `void main() { outColor = texture(u_color, v_uv); }`;

  const m4BaseManifest: PackManifest = {
    id: "m4-base",
    name: "m4-base",
    version: "1.0.0",
    tileTextures: {},
    tileSheets: [],
    startScene: "scenes/none.json",
    shaders: {
      worldHooks: "shaders/world.glsl",
      // Mode 1 winner candidate (base) — should LOSE to fog-mod's.
      spriteFrag: "shaders/sprite.glsl",
      postPasses: [{ name: "crt", frag: "shaders/crt.glsl" }],
    },
  };
  const baseBytes2 = await buildFakePack(m4BaseManifest, {
    "shaders/world.glsl": baseHooks,
    "shaders/sprite.glsl": baseSpriteFrag,
    "shaders/crt.glsl": baseCrtPass,
  });
  const basePath2 = join(tmp, "m4-base.apg");
  await writeFile(basePath2, baseBytes2);
  const baseUrl2 = pathToFileURL(basePath2).toString();
  const baseSri2 = await sriOf(baseBytes2);

  const fogModFogBody = `vec3 hook_modifyFogColor(vec3 base) { return vec3(0.0, 0.0, 1.0); }`;
  const fogModSpriteFrag = `void main() { /* fog-mod mode-1 sprite */ }`;
  const fogModBloomPass = `void main() { outColor = texture(u_color, v_uv); }`;

  const fogModManifest: PackManifest = {
    id: "m4-fog-mod",
    name: "m4-fog-mod",
    version: "0.1.0",
    tileTextures: {},
    tileSheets: [],
    startScene: "scenes/none.json",
    requires: [{ id: "m4-base", url: baseUrl2, integrity: baseSri2 }],
    shaders: {
      worldHooks: "shaders/world.glsl",
      // Mode 1 winner — later in chain → wins, base's drops with a
      // single console warning.
      spriteFrag: "shaders/sprite.glsl",
      postPasses: [{ name: "bloom", frag: "shaders/bloom.glsl" }],
    },
  };
  const fogModBytes = await buildFakePack(fogModManifest, {
    "shaders/world.glsl": fogModFogBody,
    "shaders/sprite.glsl": fogModSpriteFrag,
    "shaders/bloom.glsl": fogModBloomPass,
  });
  const fogModPath = join(tmp, "m4-fog-mod.apg");
  await writeFile(fogModPath, fogModBytes);
  const fogModUrl = pathToFileURL(fogModPath).toString();

  const chain = await resolveChain(fogModUrl);
  assert(chain.length === 2, `chain length is 2 (got ${chain.length})`);
  assert(
    chain[0]!.manifest.id === "m4-base",
    `chain[0] is m4-base (got "${chain[0]!.manifest.id}")`,
  );
  assert(
    chain[1]!.manifest.id === "m4-fog-mod",
    `chain[1] is m4-fog-mod (got "${chain[1]!.manifest.id}")`,
  );

  // Capture warnings so we can assert the conflict log fires.
  const warnings: string[] = [];
  const origWarn = console.warn;
  console.warn = (...args: unknown[]) => {
    warnings.push(args.map((a) => String(a)).join(" "));
  };
  let cascaded: Map<string, string>;
  try {
    cascaded = await cascadeHooks(chain, "worldHooks");
  } finally {
    console.warn = origWarn;
  }

  assert(
    cascaded.has("hook_modifyFogColor"),
    "cascade contains hook_modifyFogColor",
  );
  assert(
    cascaded.has("hook_modifyReflectivity"),
    "cascade contains hook_modifyReflectivity",
  );
  // Last-wins per hook name — fog-mod's body should be present.
  assert(
    /vec3\(0\.0,\s*0\.0,\s*1\.0\)/.test(
      cascaded.get("hook_modifyFogColor") ?? "",
    ),
    `hook_modifyFogColor body is from m4-fog-mod (got: ${(cascaded.get("hook_modifyFogColor") ?? "").slice(0, 60)}…)`,
  );
  // Sparse override — base's reflectivity hook survives untouched.
  assert(
    /return 0\.5/.test(cascaded.get("hook_modifyReflectivity") ?? ""),
    `hook_modifyReflectivity body is from m4-base (got: ${(cascaded.get("hook_modifyReflectivity") ?? "").slice(0, 60)}…)`,
  );

  // Conflict log fires once for hook_modifyFogColor, naming both packs.
  const fogConflict = warnings.find((w) =>
    /pack-chain hook conflict:.*hook_modifyFogColor/.test(w),
  );
  assert(
    fogConflict !== undefined,
    "console.warn surfaced 'pack-chain hook conflict' for hook_modifyFogColor",
  );
  if (fogConflict) {
    assert(
      /m4-base/.test(fogConflict) && /m4-fog-mod/.test(fogConflict),
      "conflict warning names both packs (m4-base, m4-fog-mod)",
    );
  }

  // Mode 1 cascade — fog-mod ships `spriteFrag`, base also does;
  // last-wins per role → fog-mod wins. `chainHasMode1ForRole` true.
  console.warn = () => {}; // suppress the Mode 1 override summary
  let mode1Winner;
  try {
    mode1Winner = findMode1WinnerForRole(chain, "spriteFrag");
  } finally {
    console.warn = origWarn;
  }
  assert(
    mode1Winner?.manifest.id === "m4-fog-mod",
    `Mode 1 winner for spriteFrag is m4-fog-mod (got "${mode1Winner?.manifest.id}")`,
  );
  assert(
    chainHasMode1ForRole(chain, "spriteFrag"),
    "chainHasMode1ForRole(spriteFrag) is true",
  );
  assert(
    !chainHasMode1ForRole(chain, "worldFrag"),
    "chainHasMode1ForRole(worldFrag) is false (neither pack ships Mode 1 for it)",
  );

  // Post-pass cascade — append in chain order; base.crt first,
  // fog-mod.bloom second. No name collision, no extra warnings.
  const passes = cascadePostPasses(chain);
  assert(
    passes.length === 2,
    `cascadePostPasses returned 2 entries (got ${passes.length})`,
  );
  assert(
    passes[0]!.def.name === "crt" && passes[0]!.packLabel.includes("m4-base"),
    `passes[0] is crt from m4-base (got "${passes[0]!.def.name}" from "${passes[0]!.packLabel}")`,
  );
  assert(
    passes[1]!.def.name === "bloom" && passes[1]!.packLabel.includes("m4-fog-mod"),
    `passes[1] is bloom from m4-fog-mod (got "${passes[1]!.def.name}" from "${passes[1]!.packLabel}")`,
  );
}

/* ────────────────────────────────────────────────────────────────────
 * 6. M4 — post-pass cross-pack name collision warns but keeps BOTH.
 * ────────────────────────────────────────────────────────────────── */
console.log("\n[6] M4 — post-pass cross-pack name collision");
{
  clearChainCache();
  const passBody = `void main() { outColor = texture(u_color, v_uv); }`;

  const baseManifest: PackManifest = {
    id: "m4-collision-base",
    name: "m4-collision-base",
    version: "1.0.0",
    tileTextures: {},
    tileSheets: [],
    startScene: "scenes/none.json",
    shaders: { postPasses: [{ name: "crt", frag: "shaders/crt.glsl" }] },
  };
  const baseBytes3 = await buildFakePack(baseManifest, {
    "shaders/crt.glsl": passBody,
  });
  const basePath3 = join(tmp, "m4-collision-base.apg");
  await writeFile(basePath3, baseBytes3);
  const baseUrl3 = pathToFileURL(basePath3).toString();
  const baseSri3 = await sriOf(baseBytes3);

  const rootManifest: PackManifest = {
    id: "m4-collision-root",
    name: "m4-collision-root",
    version: "0.1.0",
    tileTextures: {},
    tileSheets: [],
    startScene: "scenes/none.json",
    requires: [{ id: "m4-collision-base", url: baseUrl3, integrity: baseSri3 }],
    shaders: { postPasses: [{ name: "crt", frag: "shaders/crt2.glsl" }] },
  };
  const rootBytes = await buildFakePack(rootManifest, {
    "shaders/crt2.glsl": passBody,
  });
  const rootPath = join(tmp, "m4-collision-root.apg");
  await writeFile(rootPath, rootBytes);
  const rootUrl = pathToFileURL(rootPath).toString();

  const chain = await resolveChain(rootUrl);
  const warnings: string[] = [];
  const origWarn = console.warn;
  console.warn = (...args: unknown[]) => {
    warnings.push(args.map((a) => String(a)).join(" "));
  };
  let passes;
  try {
    passes = cascadePostPasses(chain);
  } finally {
    console.warn = origWarn;
  }

  assert(passes.length === 2, `both 'crt' passes kept (got ${passes.length})`);
  const collisionWarn = warnings.find((w) =>
    /pack-chain post-pass name 'crt' is declared by both/.test(w),
  );
  assert(
    collisionWarn !== undefined,
    "console.warn surfaced 'pack-chain post-pass name' collision for 'crt'",
  );
}

/* ────────────────────────────────────────────────────────────────────
 * 7. PackRequiresEntry.enabled = false — disabled deps are skipped.
 *    Build a child that requires TWO parents (parentA, parentB) where
 *    parentB is disabled. Resolver must return [parentA, child] and
 *    skip parentB entirely — no fetch attempt for it.
 * ────────────────────────────────────────────────────────────────── */
console.log("\n[7] requires entries with enabled=false are skipped");
{
  clearChainCache();

  const parentAManifest: PackManifest = {
    id: "parent-a",
    name: "parent-a",
    version: "1.0.0",
    tileTextures: {},
    tileSheets: [],
    startScene: "scenes/none.json",
  };
  const parentABytes = await buildFakePack(parentAManifest);
  const parentAPath = join(tmp, "parent-a.apg");
  await writeFile(parentAPath, parentABytes);
  const parentAUrl = pathToFileURL(parentAPath).toString();
  const parentAIntegrity = await sriOf(parentABytes);

  // parentB exists on disk but should NEVER be fetched because the
  // child's requires[] entry for it is disabled.
  const parentBManifest: PackManifest = {
    id: "parent-b",
    name: "parent-b",
    version: "1.0.0",
    tileTextures: {},
    tileSheets: [],
    startScene: "scenes/none.json",
  };
  const parentBBytes = await buildFakePack(parentBManifest);
  const parentBPath = join(tmp, "parent-b.apg");
  await writeFile(parentBPath, parentBBytes);
  const parentBUrl = pathToFileURL(parentBPath).toString();
  const parentBIntegrity = await sriOf(parentBBytes);

  const childManifest: PackManifest = {
    id: "child-toggle",
    name: "child-toggle",
    version: "0.1.0",
    tileTextures: {},
    tileSheets: [],
    startScene: "scenes/none.json",
    requires: [
      { id: "parent-a", url: parentAUrl, integrity: parentAIntegrity },
      {
        id: "parent-b",
        url: parentBUrl,
        integrity: parentBIntegrity,
        enabled: false, // ← disabled, must be skipped
      },
    ],
  };
  const childBytes = await buildFakePack(childManifest);
  const childPath = join(tmp, "child-toggle.apg");
  await writeFile(childPath, childBytes);
  const childUrl = pathToFileURL(childPath).toString();

  const chain = await resolveChain(childUrl);
  assert(chain.length === 2, `chain length is 2 (got ${chain.length})`);
  const ids = chain.map((p) => p.manifest.id ?? p.manifest.name);
  assert(
    ids.includes("parent-a"),
    `chain includes enabled parent-a (got: ${ids.join(", ")})`,
  );
  assert(
    !ids.includes("parent-b"),
    `chain does NOT include disabled parent-b (got: ${ids.join(", ")})`,
  );
  assert(
    ids[ids.length - 1] === "child-toggle",
    `chain ends with the root child (got: "${ids[ids.length - 1]}")`,
  );

  // Flipping enabled back to true on the second pass should pull
  // parent-b in too. Mutating manifests in flight isn't a public API
  // (the resolver re-reads from the cached `AssetPack.manifest`); we
  // construct a new child fixture and re-resolve to confirm behaviour.
  clearChainCache();
  const childEnabledManifest: PackManifest = {
    ...childManifest,
    id: "child-toggle-on",
    name: "child-toggle-on",
    requires: [
      { id: "parent-a", url: parentAUrl, integrity: parentAIntegrity },
      {
        id: "parent-b",
        url: parentBUrl,
        integrity: parentBIntegrity,
        enabled: true,
      },
    ],
  };
  const childOnBytes = await buildFakePack(childEnabledManifest);
  const childOnPath = join(tmp, "child-toggle-on.apg");
  await writeFile(childOnPath, childOnBytes);
  const childOnUrl = pathToFileURL(childOnPath).toString();
  const chainOn = await resolveChain(childOnUrl);
  const idsOn = chainOn.map((p) => p.manifest.id ?? p.manifest.name);
  assert(
    idsOn.includes("parent-b"),
    `enabled=true round-trips: chain includes parent-b (got: ${idsOn.join(", ")})`,
  );
}

/* ────────────────────────────────────────────────────────────────────
 * 8. PACK_CHAIN P1 follow-up — requires[].version enforcement.
 *    Tiny `satisfies()` unit tests + end-to-end chain assertions
 *    covering the supported subset (exact / caret / tilde / empty)
 *    and the new hard-fail path on version mismatch.
 * ────────────────────────────────────────────────────────────────── */
console.log("\n[8] requires[].version is enforced against parent manifest.version");
{
  // 8a. Tiny `satisfies()` unit tests — exercised directly so a regression
  //     in the matcher surfaces here without needing a full chain build.
  assert(satisfies("1.2.3", "1.2.3"), "satisfies exact match");
  assert(!satisfies("1.2.4", "1.2.3"), "satisfies exact mismatch is false");
  assert(satisfies("1.2.4", "^1.2.3"), "satisfies caret patch bump");
  assert(satisfies("1.3.0", "^1.2.3"), "satisfies caret minor bump");
  assert(!satisfies("2.0.0", "^1.2.3"), "satisfies caret major bump rejected");
  assert(!satisfies("1.2.2", "^1.2.3"), "satisfies caret below floor rejected");
  assert(satisfies("1.2.5", "~1.2.3"), "satisfies tilde patch bump");
  assert(!satisfies("1.3.0", "~1.2.3"), "satisfies tilde minor bump rejected");
  assert(!satisfies("1.2.2", "~1.2.3"), "satisfies tilde below floor rejected");
  assert(satisfies("9.9.9", undefined), "satisfies no constraint accepts anything");
  assert(satisfies("9.9.9", ""), "satisfies empty range accepts anything");

  // 8b. End-to-end: build a parent fixture once, then point a series of
  //     children at it with different `requires[].version` clauses.
  clearChainCache();
  const v8ParentManifest: PackManifest = {
    id: "v8-parent",
    name: "v8-parent",
    version: "0.2.0",
    tileTextures: {},
    tileSheets: [],
    startScene: "scenes/none.json",
  };
  const v8ParentBytes = await buildFakePack(v8ParentManifest);
  const v8ParentPath = join(tmp, "v8-parent.apg");
  await writeFile(v8ParentPath, v8ParentBytes);
  const v8ParentUrl = pathToFileURL(v8ParentPath).toString();
  const v8ParentSri = await sriOf(v8ParentBytes);

  // Helper: write a child with a custom `requires[]` and resolve it,
  // returning either the resolved chain or the thrown error message.
  async function tryResolveChild(
    label: string,
    requires: PackManifest["requires"],
  ): Promise<{ ok: boolean; chain?: Awaited<ReturnType<typeof resolveChain>>; err?: string }> {
    clearChainCache();
    const manifest: PackManifest = {
      id: label,
      name: label,
      version: "1.0.0",
      tileTextures: {},
      tileSheets: [],
      startScene: "scenes/none.json",
      requires,
    };
    const bytes = await buildFakePack(manifest);
    const path = join(tmp, `${label}.apg`);
    await writeFile(path, bytes);
    const url = pathToFileURL(path).toString();
    try {
      const chain = await resolveChain(url);
      return { ok: true, chain };
    } catch (e) {
      return { ok: false, err: (e as Error).message };
    }
  }

  // 8b-i. caret ^0.2.0 against parent 0.2.0 → resolves.
  {
    const r = await tryResolveChild("v8-child-caret-exact", [
      { id: "v8-parent", url: v8ParentUrl, integrity: v8ParentSri, version: "^0.2.0" },
    ]);
    assert(r.ok, "caret ^0.2.0 vs parent 0.2.0 resolves");
    if (r.ok) assert(r.chain!.length === 2, `caret-exact chain length is 2 (got ${r.chain!.length})`);
  }

  // 8b-ii. caret ^0.2.0 against parent 0.3.0 — same parent URL but rebuilt
  //        with a new manifest.version. Note: integrity changes too.
  {
    const v8ParentBumpManifest: PackManifest = { ...v8ParentManifest, version: "0.3.0" };
    const v8ParentBumpBytes = await buildFakePack(v8ParentBumpManifest);
    const v8ParentBumpPath = join(tmp, "v8-parent-0.3.apg");
    await writeFile(v8ParentBumpPath, v8ParentBumpBytes);
    const v8ParentBumpUrl = pathToFileURL(v8ParentBumpPath).toString();
    const v8ParentBumpSri = await sriOf(v8ParentBumpBytes);
    const r = await tryResolveChild("v8-child-caret-minor", [
      { id: "v8-parent", url: v8ParentBumpUrl, integrity: v8ParentBumpSri, version: "^0.2.0" },
    ]);
    assert(r.ok, "caret ^0.2.0 vs parent 0.3.0 resolves (compat minor bump)");
  }

  // 8b-iii. caret ^0.2.0 against parent 0.1.0 → hard-fail.
  {
    const v8ParentLowManifest: PackManifest = { ...v8ParentManifest, version: "0.1.0" };
    const v8ParentLowBytes = await buildFakePack(v8ParentLowManifest);
    const v8ParentLowPath = join(tmp, "v8-parent-0.1.apg");
    await writeFile(v8ParentLowPath, v8ParentLowBytes);
    const v8ParentLowUrl = pathToFileURL(v8ParentLowPath).toString();
    const v8ParentLowSri = await sriOf(v8ParentLowBytes);
    const r = await tryResolveChild("v8-child-caret-toolow", [
      { id: "v8-parent", url: v8ParentLowUrl, integrity: v8ParentLowSri, version: "^0.2.0" },
    ]);
    assert(!r.ok, "caret ^0.2.0 vs parent 0.1.0 throws");
    assert(
      r.err !== undefined && /version mismatch/i.test(r.err),
      `error mentions "version mismatch" (got: ${(r.err ?? "").slice(0, 120)}…)`,
    );
    assert(
      r.err !== undefined && /Required: \^0\.2\.0/.test(r.err),
      `error includes required range "Required: ^0.2.0"`,
    );
    assert(
      r.err !== undefined && /Found: 0\.1\.0/.test(r.err),
      `error includes found version "Found: 0.1.0"`,
    );
  }

  // 8b-iv. exact "1.2.3" against parent 1.2.4 → hard-fail.
  {
    const exactParentManifest: PackManifest = {
      id: "v8-parent-exact",
      name: "v8-parent-exact",
      version: "1.2.4",
      tileTextures: {},
      tileSheets: [],
      startScene: "scenes/none.json",
    };
    const exactParentBytes = await buildFakePack(exactParentManifest);
    const exactParentPath = join(tmp, "v8-parent-exact.apg");
    await writeFile(exactParentPath, exactParentBytes);
    const exactParentUrl = pathToFileURL(exactParentPath).toString();
    const exactParentSri = await sriOf(exactParentBytes);
    const r = await tryResolveChild("v8-child-exact", [
      { id: "v8-parent-exact", url: exactParentUrl, integrity: exactParentSri, version: "1.2.3" },
    ]);
    assert(!r.ok, "exact 1.2.3 vs parent 1.2.4 throws");
    assert(
      r.err !== undefined && /version mismatch/i.test(r.err),
      "exact-mismatch error mentions 'version mismatch'",
    );
  }

  // 8b-v. no `version` field → resolves (no constraint, back-compat).
  {
    const r = await tryResolveChild("v8-child-noversion", [
      { id: "v8-parent", url: v8ParentUrl, integrity: v8ParentSri },
    ]);
    assert(r.ok, "requires entry without version field resolves (no constraint)");
  }
}

console.log("");
if (failed > 0) {
  console.log(`✘ ${failed} assertion(s) failed`);
  process.exit(1);
}
console.log("✔ all assertions passed");

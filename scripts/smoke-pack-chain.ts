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
  clearChainCache,
  resolveChain,
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

/** Build the minimal `.apg` bytes for a manifest with no assets. */
async function buildFakePack(manifest: PackManifest): Promise<Uint8Array> {
  const zip = new JSZip();
  zip.file("manifest.json", JSON.stringify(manifest, null, 2));
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

console.log("");
if (failed > 0) {
  console.log(`✘ ${failed} assertion(s) failed`);
  process.exit(1);
}
console.log("✔ all assertions passed");

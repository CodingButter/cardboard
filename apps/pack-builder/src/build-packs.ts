#!/usr/bin/env bun
/**
 * Build every pack in `resources/packs/` into a `.apg` in `public/packs/`.
 *
 *   resources/packs/
 *   ├── default/
 *   │   ├── manifest.json
 *   │   └── images/...
 *   ├── my-mod/
 *   │   ├── manifest.json
 *   │   ├── images/...
 *   │   └── scripts/...   (phase 3+)
 *   └── ...
 *
 *   →
 *
 *   public/packs/
 *   ├── default.apg
 *   ├── my-mod.apg
 *   └── ...
 *
 * Each subdirectory under `resources/packs/` is treated as one pack's
 * working tree. The script walks the tree recursively, preserving paths
 * inside the zip so `images/foo.jpg` in source ends up at `images/foo.jpg`
 * inside the .apg.
 *
 * Run with: `bun run build-packs` (or `bun scripts/build-packs.ts`).
 */

import { readdir, stat } from "node:fs/promises";
import { join, relative } from "node:path";
import JSZip from "jszip";
import { bakeScene, type BakeOpts } from "./bake-lights";
import type { SceneJSON } from "@two_5_d/engine";

/**
 * Manifest-side lighting tuning block. Lives at
 * `manifest.lighting.{lightmapResolution, supersample}` and is plumbed
 * verbatim into `bakeScene`'s `BakeOpts`. Both fields are optional;
 * `bake-lights.ts` has the documented defaults (K=4, N=4).
 */
interface ManifestLightingBlock {
  lightmapResolution?: number;
  supersample?: number;
}

// Repo root, three levels up from `apps/pack-builder/src/`.
const root = new URL("../../../", import.meta.url).pathname;
// Source packs live under `packages/`. Every directory at that level
// that ends with `-pack` (or is the `default-pack` workspace) is built
// into one .apg. Today that's just `packages/default-pack/`.
const sourceRoot = join(root, "packages");
const outDir = join(root, "apps", "game", "public", "packs");

await Bun.$`mkdir -p ${outDir}`.quiet();

/**
 * Workspace-specific files we never want to ship inside a `.apg`.
 * `package.json` lives next to `manifest.json` so Bun's workspace
 * resolver picks the pack up as a named workspace; `node_modules` is
 * the install cache for that workspace if it ever grows deps.
 */
const PACK_EXCLUDED = new Set(["package.json", "node_modules", ".DS_Store"]);

/** Yield every file path under `dir`, recursively, as absolute paths. */
async function* walk(dir: string): AsyncGenerator<string> {
  for (const entry of await readdir(dir)) {
    if (PACK_EXCLUDED.has(entry)) continue;
    const full = join(dir, entry);
    const info = await stat(full);
    if (info.isDirectory()) {
      yield* walk(full);
    } else {
      yield full;
    }
  }
}

async function buildPack(dirName: string): Promise<{ size: number; files: number; outName: string }> {
  const packRoot = join(sourceRoot, dirName);
  const zip = new JSZip();

  // Read the manifest first (if it exists) so we can pick up the
  // optional `lighting` block before any scene bake runs. Doing it
  // up front means every scene in the pack uses the same K/N pair,
  // which matters for a consistent visual look across rooms.
  // We also use the manifest's `name` field as the output filename so
  // the workspace directory name (`default-pack`) doesn't have to
  // match the pack's runtime identifier (`default`).
  let bakeOpts: BakeOpts = {};
  let outName = dirName;
  const manifestPath = join(packRoot, "manifest.json");
  try {
    const manifestText = await Bun.file(manifestPath).text();
    const parsed = JSON.parse(manifestText) as {
      name?: string;
      lighting?: ManifestLightingBlock;
    };
    if (typeof parsed.name === "string" && parsed.name.length > 0) {
      outName = parsed.name;
    }
    if (parsed.lighting !== undefined) {
      bakeOpts = {
        lightmapResolution: parsed.lighting.lightmapResolution,
        supersample: parsed.lighting.supersample,
      };
    }
  } catch {
    // Missing or malformed manifest: fall through with default opts.
    // The "no manifest at zip root" guard below will still trip if
    // the file is actually absent.
  }

  let fileCount = 0;
  for await (const filePath of walk(packRoot)) {
    // Path inside the zip mirrors the path under the pack root —
    // forward-slash separated regardless of OS.
    const inZip = relative(packRoot, filePath).split(/[\\/]+/).join("/");

    // Scene JSONs go through the lighting bake before being zipped.
    // Everything else (manifest, images, mod scripts, etc.) passes
    // through byte-for-byte. The bake mutates only the in-zip copy —
    // the source file on disk stays clean.
    if (inZip.startsWith("scenes/") && inZip.endsWith(".json")) {
      const text = await Bun.file(filePath).text();
      let sceneJson: SceneJSON;
      try {
        sceneJson = JSON.parse(text) as SceneJSON;
      } catch (err) {
        throw new Error(`Failed to parse ${inZip}: ${(err as Error).message}`);
      }
      const { scene: baked, stats } = bakeScene(sceneJson, bakeOpts);
      zip.file(inZip, JSON.stringify(baked));
      console.log(
        `    baked ${inZip}: ${stats.lights} light(s)` +
          ` (${stats.userLights} user + ${stats.autoLights} auto-emissive),` +
          ` K=${stats.resolution} N=${stats.supersample}, ${stats.ms.toFixed(1)} ms`,
      );
    } else {
      const bytes = await Bun.file(filePath).bytes();
      zip.file(inZip, bytes);
    }
    fileCount++;
  }

  if (!zip.file("manifest.json")) {
    throw new Error(`Pack '${dirName}' is missing manifest.json at its root.`);
  }

  const buffer = await zip.generateAsync({
    type: "uint8array",
    compression: "DEFLATE",
  });
  const outFile = join(outDir, `${outName}.apg`);
  await Bun.write(outFile, buffer);
  return { size: buffer.byteLength, files: fileCount, outName };
}

// A "pack" is any workspace package under `packages/` whose root has
// a `manifest.json`. That filter skips the engine + shared packages
// (pure code, no content). Today only `default-pack` qualifies.
const subdirs: string[] = [];
for (const entry of await readdir(sourceRoot)) {
  const info = await stat(join(sourceRoot, entry));
  if (!info.isDirectory()) continue;
  const manifest = Bun.file(join(sourceRoot, entry, "manifest.json"));
  if (!(await manifest.exists())) continue;
  subdirs.push(entry);
}

if (subdirs.length === 0) {
  console.log(`No packs found in ${sourceRoot}. Create a subdirectory there with a manifest.json.`);
  process.exit(0);
}

console.log(`Building ${subdirs.length} pack(s) from ${relative(root, sourceRoot)}/`);
for (const name of subdirs) {
  try {
    const { size, files, outName } = await buildPack(name);
    console.log(`  ${outName}.apg  —  ${files} file(s), ${(size / 1024).toFixed(1)} KB`);
  } catch (err) {
    console.error(`  ${name}: FAILED — ${(err as Error).message}`);
    process.exitCode = 1;
  }
}

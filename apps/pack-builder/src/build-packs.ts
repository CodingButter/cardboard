#!/usr/bin/env bun
/**
 * Build every pack in `packages/*-pack/` into a `.apg` in
 * `apps/game/public/packs/`.
 *
 *   packages/default-pack/
 *   ├── manifest.json
 *   ├── presets/*.jsonc   ← preset libraries (T1 of tile-presets)
 *   ├── images/...
 *   ├── scenes/*.json     ← may use `idMap` or legacy bare-int grids
 *   └── scripts/...
 *
 *   →
 *
 *   apps/game/public/packs/
 *   └── default.apg
 *
 * Pipeline per pack:
 *   1. Read manifest.json.
 *   2. Build a `PresetResolver` from `manifest.tilePresets[]` (+ the
 *      `tileTextures` legacy shim). See `docs/plans/TILE_PRESETS.md` § 6.
 *   3. T2 build-merge: walk every scene, normalise each preset
 *      reference, collapse duplicates by content hash, rewrite each
 *      scene's idMap to a deterministic sorted form. Default-pack
 *      already ships migrated content so this is mostly a no-op
 *      today — the machinery is in place for editor output later.
 *   4. For each scene: pre-expand any idMap-resolved grids back into
 *      the legacy structured shape the bake script reads, bake
 *      lighting, emit into the zip.
 *   5. All other files pass through byte-for-byte.
 *
 * Run with: `bun run build-packs`.
 */

import { readdir, stat } from "node:fs/promises";
import { join, relative } from "node:path";
import JSZip from "jszip";
import { bakeScene, type BakeOpts } from "./bake-lights";
import {
  buildPackScript,
  compiledPackScriptPath,
  isCompilablePackScript,
} from "./build-pack-script";
import {
  PresetResolver,
  type SceneJSON,
  type PackManifest,
  type ResolvedPresetData,
  type WallCellInput,
  type FloorCellInput,
  type CeilingCellInput,
  type WallSegmentInput,
  type StructuredFloorSpec,
} from "@two_5_d/engine";

interface ManifestLightingBlock {
  lightmapResolution?: number;
  supersample?: number;
}

const root = new URL("../../../", import.meta.url).pathname;
const sourceRoot = join(root, "packages");
const outDir = join(root, "apps", "game", "public", "packs");

await Bun.$`mkdir -p ${outDir}`.quiet();

const PACK_EXCLUDED = new Set(["package.json", "node_modules", ".DS_Store"]);

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

/* --- T2: build-merge step ------------------------------------------------ */

/**
 * Canonical SHA-256-truncated-16 hash of a preset record. Mirrors the
 * algorithm in `scripts/migrate-default-pack-to-presets.ts` so identical
 * content collapses to the same id regardless of which path emitted it.
 */
function hashHex16(text: string): string {
  const hasher = new Bun.CryptoHasher("sha256");
  hasher.update(text);
  return hasher.digest("hex").slice(0, 16);
}

/** Sort object keys lexicographically, recursively. Drops `undefined`. */
function canonicalStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) {
    return "[" + value.map(canonicalStringify).join(",") + "]";
  }
  const keys = Object.keys(value as Record<string, unknown>).sort();
  return (
    "{" +
    keys
      .map((k) => JSON.stringify(k) + ":" + canonicalStringify((value as Record<string, unknown>)[k]))
      .join(",") +
    "}"
  );
}

/**
 * Normalise a `ResolvedPresetData` (fully-resolved, defaults applied)
 * for hashing. Drops authoring metadata + undefined fields per the
 * §8.2 canonical form.
 */
function normaliseResolvedForHash(data: ResolvedPresetData): string {
  const clean: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(data)) {
    if (k === "displayName" || k === "tags" || k === "thumbnail") continue;
    if (v === undefined) continue;
    clean[k] = v;
  }
  return canonicalStringify(clean);
}

/**
 * Walk every scene in the pack, collect referenced preset ids per
 * scene, collapse duplicates by content hash (named-wins, anonymous-
 * groups merge), rewrite idMap + grids to the deterministic sorted
 * form (named first alphabetical, then anonymous alphabetical).
 *
 * Returns a map from `path → rewritten SceneJSON text` for callers
 * that want to use the rewritten copy when emitting to zip.
 */
function buildMergeScenes(
  scenes: Map<string, SceneJSON>,
  resolver: PresetResolver,
): { rewritten: Map<string, SceneJSON>; collapsedCount: number } {
  const rewritten = new Map<string, SceneJSON>();
  let collapsedCount = 0;

  // First, build a global hash → preserved-id map. Named ids always
  // win their hash bucket; anonymous ids collapse onto the first
  // named id with the same hash (or the first anonymous id seen if
  // no named one exists). Iterate the resolver once to populate.
  const hashToPreferredId = new Map<string, string>();
  for (const p of resolver) {
    const hash = hashHex16(normaliseResolvedForHash(p.data));
    const existing = hashToPreferredId.get(hash);
    if (!existing) {
      hashToPreferredId.set(hash, p.id);
    } else {
      const existingAnon = existing.startsWith("_");
      const newAnon = p.id.startsWith("_");
      if (existingAnon && !newAnon) {
        // Named wins.
        hashToPreferredId.set(hash, p.id);
      }
      // Otherwise leave the existing entry — named never displaced by
      // an anonymous, and anonymous-anonymous collisions just pick
      // the first one (deterministic via the resolver's Map iteration
      // order, which mirrors insertion order from the manifest).
    }
  }

  // Map every preset id → its collapsed representative.
  const idToRepresentative = new Map<string, string>();
  for (const p of resolver) {
    const hash = hashHex16(normaliseResolvedForHash(p.data));
    const rep = hashToPreferredId.get(hash) ?? p.id;
    idToRepresentative.set(p.id, rep);
    if (rep !== p.id) collapsedCount++;
  }

  // Rewrite each scene's idMap + grids.
  for (const [path, scene] of scenes) {
    if (!scene.idMap) {
      // Legacy scene — no idMap, no rewriting to do.
      rewritten.set(path, scene);
      continue;
    }
    const referenced = new Set<string>();
    const collect = (rows: unknown[][] | undefined): void => {
      if (!rows) return;
      for (const row of rows) {
        for (const cell of row) {
          if (typeof cell !== "number" || cell === 0) continue;
          const presetId = scene.idMap![String(cell)];
          if (!presetId) continue;
          const rep = idToRepresentative.get(presetId) ?? presetId;
          referenced.add(rep);
        }
      }
    };
    collect(scene.walls as unknown[][]);
    collect(scene.floors as unknown[][]);
    collect(scene.ceilings as unknown[][]);

    // Build a deterministic ordering: named first (alphabetical),
    // then anonymous (alphabetical). Index 0 stays reserved.
    const ordered = [...referenced].sort((a, b) => {
      const aAnon = a.startsWith("_");
      const bAnon = b.startsWith("_");
      if (aAnon !== bAnon) return aAnon ? 1 : -1;
      return a < b ? -1 : a > b ? 1 : 0;
    });
    const idxOf = new Map<string, number>();
    const newIdMap: Record<string, string | null> = { "0": null };
    ordered.forEach((id, i) => {
      const idx = i + 1;
      newIdMap[String(idx)] = id;
      idxOf.set(id, idx);
    });

    const remap = (rows: unknown[][] | undefined): number[][] | undefined => {
      if (!rows) return undefined;
      return rows.map((row) =>
        row.map((cell) => {
          if (typeof cell !== "number" || cell === 0) return 0;
          const presetId = scene.idMap![String(cell)];
          if (!presetId) return 0;
          const rep = idToRepresentative.get(presetId) ?? presetId;
          return idxOf.get(rep) ?? 0;
        }),
      );
    };

    const out: SceneJSON = { ...scene };
    out.idMap = newIdMap;
    const newWalls = remap(scene.walls as unknown[][]);
    if (newWalls) out.walls = newWalls;
    const newFloors = remap(scene.floors as unknown[][]);
    if (newFloors) out.floors = newFloors;
    const newCeils = remap(scene.ceilings as unknown[][]);
    if (newCeils) out.ceilings = newCeils;
    rewritten.set(path, out);
  }

  return { rewritten, collapsedCount };
}

/* --- Scene pre-expansion for bake ---------------------------------------- */

/**
 * When a scene uses `idMap`, the bake script (which reads cell
 * `emissive` etc. directly from the scene JSON) needs the legacy-
 * structured form. Expand idMap cells into inlined
 * `WallSegmentInput` / `StructuredFloorSpec` objects via the resolver
 * so bake-time emissive collection still works.
 *
 * Returns a NEW SceneJSON with the same metadata but expanded grids.
 * The expansion is bake-only — the zipped scene is the post-merge
 * compact form.
 */
function expandSceneForBake(scene: SceneJSON, resolver: PresetResolver): SceneJSON {
  if (!scene.idMap) return scene;
  const idMap = scene.idMap;
  const tileIdForTexture = (texture: string | undefined): number => {
    if (!texture) return 0;
    return resolver.tileIdForTexture(texture) ?? 0;
  };
  const faceShort = (face: string | undefined): "N" | "S" | "E" | "W" => {
    switch (face) {
      case "south": return "S";
      case "east": return "E";
      case "west": return "W";
      default: return "N";
    }
  };

  const expandWall = (cell: unknown): WallCellInput => {
    if (typeof cell !== "number" || cell === 0) return 0;
    const id = idMap[String(cell)];
    if (!id) return 0;
    const data = resolver.resolveCell(id);
    if (!data) return 0;
    const seg: WallSegmentInput = {
      tile: tileIdForTexture(data.texture),
      startZ: data.wallStartZ,
      height: data.wallHeight,
      offsetX: data.offsetX,
      offsetY: data.offsetY,
    };
    if (data.partialWall) {
      seg.face = faceShort(data.partialWall.face);
      seg.startU = data.partialWall.startU;
      seg.widthU = data.partialWall.widthU;
    }
    if (data.topCap) seg.topTile = tileIdForTexture(data.topCap);
    if (data.bottomCap) seg.bottomTile = tileIdForTexture(data.bottomCap);
    if (data.emissive) {
      seg.emissive = {
        color: data.emissive.color,
        intensity: data.emissive.intensity,
        areaLight: data.emissive.areaLight,
      };
    }
    return seg;
  };

  const expandFloor = (cell: unknown): FloorCellInput | CeilingCellInput => {
    if (typeof cell !== "number" || cell === 0) return undefined;
    const id = idMap[String(cell)];
    if (!id) return undefined;
    const data = resolver.resolveCell(id);
    if (!data) return undefined;
    const out: StructuredFloorSpec = {
      tile: tileIdForTexture(data.texture),
      reflectiveness: data.reflectiveness,
      transition: data.transition,
    };
    if (data.emissive) {
      out.emissive = {
        color: data.emissive.color,
        intensity: data.emissive.intensity,
        areaLight: data.emissive.areaLight,
      };
    }
    return out;
  };

  const expanded: SceneJSON = { ...scene };
  if (scene.walls) {
    expanded.walls = (scene.walls as unknown[][]).map((row) =>
      row.map(expandWall),
    ) as WallCellInput[][];
  }
  if (scene.floors) {
    expanded.floors = (scene.floors as unknown[][]).map((row) =>
      row.map(expandFloor),
    ) as FloorCellInput[][];
  }
  if (scene.ceilings) {
    expanded.ceilings = (scene.ceilings as unknown[][]).map((row) =>
      row.map(expandFloor),
    ) as CeilingCellInput[][];
  }
  return expanded;
}

/* --- Per-pack build ------------------------------------------------------ */

async function buildPack(
  dirName: string,
): Promise<{ size: number; files: number; outName: string }> {
  const packRoot = join(sourceRoot, dirName);
  const zip = new JSZip();

  let bakeOpts: BakeOpts = {};
  let outName = dirName;
  let manifest: PackManifest | null = null;
  const manifestPath = join(packRoot, "manifest.json");
  try {
    const manifestText = await Bun.file(manifestPath).text();
    manifest = JSON.parse(manifestText) as PackManifest;
    if (typeof manifest.name === "string" && manifest.name.length > 0) {
      outName = manifest.name;
    }
    const lighting = (manifest as unknown as { lighting?: ManifestLightingBlock }).lighting;
    if (lighting !== undefined) {
      bakeOpts = {
        lightmapResolution: lighting.lightmapResolution,
        supersample: lighting.supersample,
      };
    }
  } catch {
    // Missing or malformed manifest: fall through with default opts.
  }

  // ── PresetResolver ───────────────────────────────────────────────
  // Built once per pack so we can pre-expand idMap scenes for bake and
  // drive the T2 build-merge step.
  const resolver = manifest
    ? await PresetResolver.build(manifest, manifest.name, (p) =>
        Bun.file(join(packRoot, p)).text(),
      )
    : null;
  if (resolver && resolver.errors.length > 0) {
    for (const e of resolver.errors) {
      console.warn(`    preset ${e.file}${e.presetId ? ":" + e.presetId : ""}: ${e.message}`);
    }
  }

  // ── Collect scenes for the T2 build-merge step ────────────────────
  // We walk the directory twice: first pass to load all scenes for
  // build-merge, second pass to emit (bake + write).
  const scenePaths: string[] = [];
  const sceneJsons = new Map<string, SceneJSON>();
  for await (const filePath of walk(packRoot)) {
    const inZip = relative(packRoot, filePath).split(/[\\/]+/).join("/");
    if (inZip.startsWith("scenes/") && inZip.endsWith(".json")) {
      const text = await Bun.file(filePath).text();
      try {
        sceneJsons.set(inZip, JSON.parse(text) as SceneJSON);
        scenePaths.push(inZip);
      } catch (err) {
        throw new Error(`Failed to parse ${inZip}: ${(err as Error).message}`);
      }
    }
  }

  // ── T2 build-merge: collapse anonymous duplicates + canonical sort.
  // For the migrated default-pack today this is a near-no-op (every
  // preset has a unique hash + the migration emitted them in the
  // canonical sort order already), but the machinery covers future
  // editor-emitted anonymous duplicates.
  let mergedScenes = sceneJsons;
  if (resolver) {
    const { rewritten, collapsedCount } = buildMergeScenes(sceneJsons, resolver);
    mergedScenes = rewritten;
    console.log(`    build-merge: ${collapsedCount} preset(s) collapsed across ${scenePaths.length} scene(s)`);
  }

  // ── Pack-script TSX compile step ─────────────────────────────────
  // Discover which scripts in `manifest.scripts` need a build-time
  // transform (`.ts` / `.tsx`). Each gets bundled into a single ESM
  // `.js` chunk via `buildPackScript`; the manifest's scripts[] entry
  // is rewritten to point at the compiled `.js` path, and the source
  // file (plus any imports the entrypoint pulls in from `scripts/ui/`
  // etc.) is excluded from the zip — it's a build input, not a
  // runtime artifact.
  const compiledScripts = new Map<string, string>(); // inZip path → compiled JS
  const scriptSourcesToSkip = new Set<string>();     // sources NOT to emit
  const scriptPathRewrites = new Map<string, string>(); // .tsx → .js mapping
  if (manifest?.scripts) {
    for (const scriptPath of manifest.scripts) {
      if (!isCompilablePackScript(scriptPath)) continue;
      const absSource = join(packRoot, scriptPath);
      try {
        const compiled = await buildPackScript(absSource);
        const compiledPath = compiledPackScriptPath(scriptPath);
        compiledScripts.set(compiledPath, compiled);
        scriptPathRewrites.set(scriptPath, compiledPath);
        // Skip the original .tsx in the zip pass.
        scriptSourcesToSkip.add(scriptPath);
        console.log(`    compiled ${scriptPath} → ${compiledPath}`);
      } catch (err) {
        throw new Error(
          `pack-build: failed to compile ${scriptPath}: ${(err as Error).message}`,
        );
      }
    }
  }

  // Any `scripts/ui/*.tsx` (or other deep helpers) are sucked in by
  // the bundler — they ship inside the compiled entrypoint already.
  // Exclude them from byte-for-byte copy so the .apg doesn't carry
  // dead source duplicates. Detection rule: `scripts/**/*.tsx` and
  // `scripts/**/*.ts` that aren't themselves manifest entries.
  const manifestScripts = new Set(manifest?.scripts ?? []);

  // Rebuild manifest.json with rewritten scripts[] paths before the
  // emit pass — the zipped manifest must reference the compiled .js
  // names the engine sees at runtime.
  let manifestText: string | null = null;
  if (manifest && scriptPathRewrites.size > 0) {
    const rewritten = {
      ...manifest,
      scripts: (manifest.scripts ?? []).map((p) => scriptPathRewrites.get(p) ?? p),
    };
    manifestText = JSON.stringify(rewritten, null, 2);
  }

  // ── Emit pass: bake + zip ─────────────────────────────────────────
  let fileCount = 0;
  for await (const filePath of walk(packRoot)) {
    const inZip = relative(packRoot, filePath).split(/[\\/]+/).join("/");

    // Skip the original .tsx/.ts script sources (their compiled
    // output is added separately below).
    if (scriptSourcesToSkip.has(inZip)) {
      continue;
    }
    // Skip any other .tsx/.ts inside the `scripts/` tree that isn't a
    // manifest entry — these are helpers (e.g. `scripts/ui/*.tsx`)
    // bundled into the entrypoint already.
    if (
      (inZip.startsWith("scripts/") && (inZip.endsWith(".tsx") || inZip.endsWith(".ts"))) &&
      !manifestScripts.has(inZip)
    ) {
      continue;
    }

    if (inZip === "manifest.json" && manifestText !== null) {
      zip.file(inZip, manifestText);
    } else if (inZip.startsWith("scenes/") && inZip.endsWith(".json")) {
      const sceneJson = mergedScenes.get(inZip)!;
      // Pre-expand idMap → legacy structured shape so the bake script's
      // emissive collection sees the cell `emissive` field directly.
      const expanded = resolver ? expandSceneForBake(sceneJson, resolver) : sceneJson;
      const { scene: baked, stats } = bakeScene(expanded, bakeOpts);
      // The expansion was bake-only. Re-attach the bake's `lightmap`
      // onto the compact (post-merge, idMap-bearing) scene so the
      // zipped scene keeps its small-int grid form.
      const finalScene: SceneJSON = { ...sceneJson, lightmap: baked.lightmap };
      zip.file(inZip, JSON.stringify(finalScene));
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

  // Emit each compiled .tsx → .js. Done after the walk so they land
  // in the zip even though the source file was skipped above.
  for (const [compiledPath, source] of compiledScripts) {
    zip.file(compiledPath, source);
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

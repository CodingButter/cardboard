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
import { bakeScene, type BakeOpts } from "@two_5_d/engine";
import {
  buildPackScript,
  compiledPackScriptPath,
  isCompilablePackScript,
} from "./build-pack-script";
import {
  PresetResolver,
  encodeRleGrid,
  normaliseGridField,
  type SceneJSON,
  type PackManifest,
  type ResolvedPresetData,
  type WallCellInput,
  type FloorCellInput,
  type CeilingCellInput,
  type WallSegmentInput,
  type StructuredFloorSpec,
  type GridField,
} from "@two_5_d/engine";
import {
  collectShaderReferences,
  formatValidationError,
  resolveShaderBackend,
  validateShaderFile,
  type ShaderValidationError,
  type ShaderRefToValidate,
} from "@two_5_d/engine";
import { generatePackTypes } from "@two_5_d/shared";

interface ManifestLightingBlock {
  lightmapResolution?: number;
  supersample?: number;
}

const root = new URL("../../../", import.meta.url).pathname;
const sourceRoot = join(root, "packages");
const outDir = join(root, "apps", "game", "public", "packs");

await Bun.$`mkdir -p ${outDir}`.quiet();

// Top-level directory entries skipped by the pack walker. `types/`
// holds the generated `pack.d.ts` declaration file (see
// `generatePackTypes` integration below) and is a tsc-only artefact;
// it must NOT be zipped into the `.apg`.
const PACK_EXCLUDED = new Set([
  "package.json",
  "node_modules",
  ".DS_Store",
  "types",
  "tsconfig.json",
]);

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
    // Normalise RLE → nested-array up-front so the merge/remap pass
    // can stay simple. The output is re-encoded back to RLE at the
    // end of this function so the on-disk scene keeps its compact form.
    const wallsArr = normaliseGridField(scene.walls as GridField<unknown>) as unknown[][];
    const floorsArr = normaliseGridField(scene.floors as GridField<unknown> | undefined) as
      | unknown[][]
      | undefined;
    const ceilingsArr = normaliseGridField(
      scene.ceilings as GridField<unknown> | undefined,
    ) as unknown[][] | undefined;
    collect(wallsArr);
    collect(floorsArr);
    collect(ceilingsArr);

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
    // Whether each grid was authored in RLE form on disk — preserve
    // that choice on the round-trip so authoring intent survives the
    // build-merge pass.
    const wallsWereRle = !Array.isArray(scene.walls);
    const floorsWereRle = scene.floors !== undefined && !Array.isArray(scene.floors);
    const ceilingsWereRle =
      scene.ceilings !== undefined && !Array.isArray(scene.ceilings);
    const newWalls = remap(wallsArr);
    if (newWalls) {
      out.walls = wallsWereRle ? encodeRleGrid(newWalls) : newWalls;
    }
    const newFloors = remap(floorsArr);
    if (newFloors) {
      out.floors = floorsWereRle ? encodeRleGrid(newFloors) : newFloors;
    }
    const newCeils = remap(ceilingsArr);
    if (newCeils) {
      out.ceilings = ceilingsWereRle ? encodeRleGrid(newCeils) : newCeils;
    }
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
  // Decode RLE wire form here so the bake script sees the legacy
  // nested-row shape it has always consumed. The expansion runs only
  // for the bake; the on-disk scene keeps whichever form the merge
  // step emitted.
  const wallsRows = normaliseGridField(scene.walls as GridField<unknown>) as
    | unknown[][]
    | undefined;
  const floorsRows = normaliseGridField(
    scene.floors as GridField<unknown> | undefined,
  ) as unknown[][] | undefined;
  const ceilingsRows = normaliseGridField(
    scene.ceilings as GridField<unknown> | undefined,
  ) as unknown[][] | undefined;
  if (wallsRows) {
    expanded.walls = wallsRows.map((row) => row.map(expandWall)) as WallCellInput[][];
  }
  if (floorsRows) {
    expanded.floors = floorsRows.map((row) => row.map(expandFloor)) as FloorCellInput[][];
  }
  if (ceilingsRows) {
    expanded.ceilings = ceilingsRows.map((row) => row.map(expandFloor)) as CeilingCellInput[][];
  }
  return expanded;
}

/* --- M5: shader validation ----------------------------------------------- */

/**
 * Walk every `.glsl` reference in the pack and validate it. Returns
 * the flat error list — empty when the pack passes. Each error is
 * pre-rendered by `formatValidationError` at the call site so the
 * build's logging stays in `build-packs.ts`.
 *
 * Reference sources (in order, deduplicated by path):
 *   - `manifest.shaders.{worldFrag, worldHooks, spriteFrag,
 *      spriteHooks, skyFrag, skyHooks}` (Mode 1 / Mode 3).
 *   - Per-preset `preset.shader` (M2 schema add — string or
 *     `{worldHooks, spriteHooks, skyHooks}` block). The validator
 *     is defensive: it reads `shader` off `ResolvedPresetData` even
 *     if the engine hasn't shipped the schema field yet.
 *   - Per-scene `scene.shaders.{worldHooks, spriteHooks, skyHooks}`
 *     (M3 schema add). Same defensive read.
 *
 * Resolves the headless-GL backend lazily — when the optional `gl`
 * native binding isn't installed (e.g. ARM Linux without X11 dev
 * headers, this dev box), Path B (syntactic-only) is used and a
 * single advisory line is printed.
 */
async function validatePackShaders(
  packRoot: string,
  manifest: PackManifest,
  resolver: PresetResolver | null,
  sceneJsons: Map<string, SceneJSON>,
): Promise<ShaderValidationError[]> {
  // Build the iterable of preset shader refs from the resolver. The
  // resolver's `ResolvedPresetData` doesn't expose `shader` today
  // (M2 schema add is in parallel) — we use a defensive `unknown`
  // cast so the validator is forward-compatible without forcing a
  // dep on M2's not-yet-merged types.
  const presetRefs: { id: string; file: string; shader?: unknown }[] = [];
  if (resolver) {
    for (const p of resolver) {
      // sourcePath is the file the preset was authored in; surface it
      // verbatim in error breadcrumbs.
      const data = p.data as unknown as { shader?: unknown };
      if (data.shader !== undefined) {
        presetRefs.push({ id: p.id, file: p.sourcePath, shader: data.shader });
      }
    }
  }

  // Scenes' `shaders` block: same defensive read — M3 hasn't added
  // it to `SceneJSON` yet, but the JSON-on-disk may carry it for
  // packs that pre-adopt the schema.
  const sceneRefs: { path: string; shaders?: Record<string, string> }[] = [];
  for (const [path, scene] of sceneJsons) {
    const sh = (scene as unknown as { shaders?: Record<string, unknown> }).shaders;
    if (sh && typeof sh === "object") {
      const filtered: Record<string, string> = {};
      for (const [k, v] of Object.entries(sh)) {
        if (typeof v === "string") filtered[k] = v;
      }
      if (Object.keys(filtered).length > 0) {
        sceneRefs.push({ path, shaders: filtered });
      }
    }
  }

  // Cast `presetRefs[].shader` to the shape `collectShaderReferences`
  // expects (`string | { worldHooks?, spriteHooks?, skyHooks? }`).
  // Anything else (a typo'd object, a number) is silently dropped —
  // M2's own preset-schema validator catches the type error.
  const presetIter = presetRefs.map((p) => ({
    id: p.id,
    file: p.file,
    shader:
      typeof p.shader === "string" || (typeof p.shader === "object" && p.shader !== null)
        ? (p.shader as string | Record<"worldHooks" | "spriteHooks" | "skyHooks", string>)
        : undefined,
  }));

  const refs: ShaderRefToValidate[] = collectShaderReferences(
    manifest,
    presetIter,
    sceneRefs,
  );

  if (refs.length === 0) return [];

  const { backend, status } = await resolveShaderBackend();
  if (!backend) {
    console.log(
      `    shader-validate: using syntactic-only fallback ` +
        `(optional 'gl' package not available${status.fallbackReason ? `: ${status.fallbackReason}` : ""}).`,
    );
  } else {
    console.log(`    shader-validate: headless-GL backend ready`);
  }

  // Group refs by path so a file referenced from N places is read +
  // validated once. Each origin is reported separately so the
  // pack author sees every breadcrumb that pointed at the bad file.
  const byPath = new Map<string, ShaderRefToValidate[]>();
  for (const r of refs) {
    const arr = byPath.get(r.path) ?? [];
    arr.push(r);
    byPath.set(r.path, arr);
  }

  const errors: ShaderValidationError[] = [];
  const readFile = (relPath: string) => Bun.file(join(packRoot, relPath)).text();
  for (const [path, origins] of byPath) {
    // First origin drives the actual validation pass; remaining
    // origins clone the errors with the alternate breadcrumb so the
    // pack author sees every path that depends on the bad file.
    const primary = origins[0]!;
    const result = await validateShaderFile(
      {
        shaderPath: primary.path,
        role: primary.role,
        manifestKey: primary.manifestKey,
        source: primary.source,
      },
      readFile,
      { backend },
    );
    for (const e of result.errors) errors.push(e);
    for (const extra of origins.slice(1)) {
      for (const e of result.errors) {
        errors.push({ ...e, origin: { ...e.origin, source: extra.source } });
      }
    }
    if (path !== primary.path) {
      // unreachable — grouped by path — defensive.
    }
  }

  return errors;
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

  // ── Component .d.ts emission ─────────────────────────────────────
  // Generate a TypeScript declaration file from `manifest.components`
  // and write it to `packages/<pack>/types/pack.d.ts`. The file
  // declaration-merges its component shapes into
  // `@two_5_d/engine`'s `PackComponents` interface so pack scripts'
  // `api.components.<Name>` reads typecheck against the schema.
  //
  // The generated file is NOT shipped inside the `.apg`; it lives
  // alongside the pack source for the script's `tsc` (and future
  // editor/Monaco wiring) to consume. `.gitignore` excludes it.
  if (manifest) {
    const dts = generatePackTypes(manifest.components ?? [], {
      packName: manifest.name,
      headerExtra: "Generated by `bun run build-packs`.",
    });
    const dtsPath = join(packRoot, "types", "pack.d.ts");
    await Bun.$`mkdir -p ${join(packRoot, "types")}`.quiet();
    await Bun.write(dtsPath, dts);
    // Make sure the `types/` folder doesn't get zipped into the
    // .apg — `walk` would otherwise sweep it up. Excluded via the
    // emit-pass guard below (see `PACK_EMIT_SKIP_DIRS`).
  }

  // ── PresetResolver ───────────────────────────────────────────────
  // Built once per pack so we can pre-expand idMap scenes for bake and
  // drive the T2 build-merge step.
  const resolver = manifest
    ? await PresetResolver.build(manifest, manifest.name, (p) =>
        Bun.file(join(packRoot, p)).text(),
      )
    : null;
  // ── T3: preset-validation gate ───────────────────────────────────
  // After resolver build, fail the pack-build if ANY preset error was
  // collected (schema typos, unknown fields, bad enum values, cycles,
  // missing texture, …). See `docs/plans/TILE_PRESETS.md` §13. Pack-
  // builder is the hard gate; the engine runtime keeps loading on
  // error and prints them via console.error for dev visibility.
  if (resolver && resolver.errors.length > 0) {
    console.error(`\nPreset validation failed for pack "${dirName}":`);
    for (const e of resolver.errors) {
      const keyPath = e.keyPath.length > 0 ? e.keyPath.join(".") : "(file)";
      const where = e.presetId
        ? `${e.file}:${e.presetId}:${keyPath}`
        : `${e.file}:${keyPath}`;
      console.error(`  ❌ ${where}: ${e.message}`);
      if (e.suggestion) {
        console.error(`     suggestion: ${e.suggestion}`);
      }
    }
    throw new Error(
      `pack "${dirName}" has ${resolver.errors.length} preset error(s); fix before build`,
    );
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

  // ── M5: GLSL shader validation gate ──────────────────────────────
  // Walk every `.glsl` reference (manifest.shaders, preset.shader,
  // scene.shaders) and validate before zipping. Fails the pack-build
  // on any error. The validator uses headless WebGL2 (`gl` npm
  // package) when available, falling back to syntactic-only checks
  // when the native binding isn't installed. See
  // `packages/engine/src/Renderers/ShaderValidator.ts`.
  if (manifest) {
    const shaderErrors = await validatePackShaders(
      packRoot,
      manifest,
      resolver,
      sceneJsons,
    );
    if (shaderErrors.length > 0) {
      console.error(`\nShader validation failed for pack "${dirName}":`);
      for (const e of shaderErrors) {
        for (const line of formatValidationError(e).split("\n")) {
          console.error(`  ${line}`);
        }
      }
      throw new Error(
        `pack "${dirName}" has ${shaderErrors.length} shader error(s); fix before build`,
      );
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
  // WORLD_STATE.md "world.json full-scope" (2026-05-17) — script
  // paths now live in `world.json.scripts[]` and any `Scripts.refs[]`
  // declared on world-scope entities or scene-controller components.
  // Walk every source surface, gather the unique path set, compile any
  // `.ts` / `.tsx` entries via `buildPackScript`, and rewrite each
  // reference to point at the compiled `.js` path. The source files
  // (plus any helpers they pull in from `scripts/ui/` etc.) are
  // excluded from the zip — they're build inputs, not runtime
  // artifacts.
  const compiledScripts = new Map<string, string>(); // inZip path → compiled JS
  const scriptSourcesToSkip = new Set<string>();     // sources NOT to emit
  const scriptPathRewrites = new Map<string, string>(); // .tsx → .js mapping

  // Read world.json once (post-rewrite emission of the rewritten file
  // happens below). Tolerate absence — packs without a world.json have
  // no scripts to compile.
  interface BuildWorldJson {
    singletons?: Record<string, unknown>;
    entities?: Array<{ name?: string; components?: Record<string, unknown> }>;
    scripts?: string[];
    systems?: unknown[];
  }
  const worldJsonPath = join(packRoot, "world.json");
  let worldJson: BuildWorldJson | null = null;
  if (await Bun.file(worldJsonPath).exists()) {
    try {
      worldJson = JSON.parse(await Bun.file(worldJsonPath).text()) as BuildWorldJson;
    } catch (err) {
      throw new Error(
        `pack-build: world.json parse failed: ${(err as Error).message}`,
      );
    }
  }

  // Collect every script path referenced anywhere in the pack:
  //   - world.json.scripts[]
  //   - world.json.entities[].components.Scripts.refs[]
  //   - scene.controller.components.Scripts.refs[]
  // Order matters for the `world.json.scripts[]` entries (the engine
  // runs them in declaration order); entity / controller `Scripts`
  // entries are addressed by their owning record so order across
  // surfaces is decoupled.
  const referencedScripts = new Set<string>();
  const collectFromScripts = (node: unknown): void => {
    if (!node || typeof node !== "object") return;
    const scriptsBag = (node as { Scripts?: unknown }).Scripts;
    if (scriptsBag && typeof scriptsBag === "object") {
      const refs = (scriptsBag as { refs?: unknown }).refs;
      if (Array.isArray(refs)) {
        for (const r of refs) if (typeof r === "string") referencedScripts.add(r);
      }
    }
  };
  if (worldJson?.scripts) {
    for (const p of worldJson.scripts) if (typeof p === "string") referencedScripts.add(p);
  }
  if (worldJson?.entities) {
    for (const e of worldJson.entities) collectFromScripts(e.components ?? {});
  }
  for (const sceneJson of sceneJsons.values()) {
    const controllerComponents = (
      sceneJson as { controller?: { components?: unknown } }
    ).controller?.components;
    collectFromScripts(controllerComponents ?? {});
    const entities = (sceneJson as { entities?: Array<{ components?: unknown }> }).entities;
    if (Array.isArray(entities)) {
      for (const e of entities) collectFromScripts(e.components ?? {});
    }
  }

  for (const scriptPath of referencedScripts) {
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

  // Any `scripts/ui/*.tsx` (or other deep helpers) are sucked in by
  // the bundler — they ship inside the compiled entrypoint already.
  // Exclude them from byte-for-byte copy so the .apg doesn't carry
  // dead source duplicates. Detection rule: `scripts/**/*.tsx` and
  // `scripts/**/*.ts` that aren't themselves referenced from
  // world.json / scene controllers / scene entities.
  const referencedScriptSet = new Set(referencedScripts);

  // Rewrite world.json with compiled .js paths. The on-disk world.json
  // ships its `.tsx` references; the zipped copy points at the .js
  // names the runtime engine imports.
  let worldJsonText: string | null = null;
  if (worldJson && scriptPathRewrites.size > 0) {
    const rewriteRefsList = (refs: unknown): unknown => {
      if (!Array.isArray(refs)) return refs;
      return refs.map((p) =>
        typeof p === "string" ? scriptPathRewrites.get(p) ?? p : p,
      );
    };
    const rewriteScriptsBag = (components: Record<string, unknown> | undefined): void => {
      if (!components) return;
      const scriptsBag = components.Scripts;
      if (scriptsBag && typeof scriptsBag === "object") {
        const next = { ...(scriptsBag as Record<string, unknown>) };
        next.refs = rewriteRefsList((scriptsBag as { refs?: unknown }).refs);
        components.Scripts = next;
      }
    };
    const rewritten = JSON.parse(JSON.stringify(worldJson)) as BuildWorldJson;
    if (rewritten.scripts) {
      rewritten.scripts = rewritten.scripts.map(
        (p: string) => scriptPathRewrites.get(p) ?? p,
      );
    }
    if (rewritten.entities) {
      for (const e of rewritten.entities) rewriteScriptsBag(e.components);
    }
    worldJsonText = JSON.stringify(rewritten, null, 2);
  }

  // Also rewrite scene-controller Scripts.refs[] when paths got
  // compiled — the scene JSONs are emitted from `mergedScenes` and
  // need their controller blocks updated alongside the bake.
  if (scriptPathRewrites.size > 0) {
    for (const [path, sceneJson] of mergedScenes) {
      const controllerComponents = (
        sceneJson as { controller?: { components?: Record<string, unknown> } }
      ).controller?.components;
      if (controllerComponents) {
        const scriptsBag = controllerComponents.Scripts;
        if (scriptsBag && typeof scriptsBag === "object") {
          const refs = (scriptsBag as { refs?: unknown }).refs;
          if (Array.isArray(refs)) {
            const next = { ...(scriptsBag as Record<string, unknown>) };
            next.refs = refs.map((p) =>
              typeof p === "string" ? scriptPathRewrites.get(p) ?? p : p,
            );
            controllerComponents.Scripts = next;
          }
        }
      }
      void path;
    }
  }

  // The manifest.json no longer carries a `scripts[]` field — but if
  // a stale one exists on disk the editor's previous-version output
  // may still ship it. Strip on emit so the zipped manifest stays
  // clean.
  let manifestText: string | null = null;
  if (
    manifest &&
    (manifest as unknown as { scripts?: unknown }).scripts !== undefined
  ) {
    const stripped: Record<string, unknown> = { ...(manifest as unknown as Record<string, unknown>) };
    delete stripped.scripts;
    manifestText = JSON.stringify(stripped, null, 2);
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
    // referenced entry — these are helpers (e.g. `scripts/ui/*.tsx`)
    // bundled into the entrypoint already.
    if (
      (inZip.startsWith("scripts/") && (inZip.endsWith(".tsx") || inZip.endsWith(".ts"))) &&
      !referencedScriptSet.has(inZip)
    ) {
      continue;
    }

    if (inZip === "manifest.json" && manifestText !== null) {
      zip.file(inZip, manifestText);
    } else if (inZip === "world.json" && worldJsonText !== null) {
      zip.file(inZip, worldJsonText);
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

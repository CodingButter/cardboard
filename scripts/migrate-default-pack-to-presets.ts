#!/usr/bin/env bun
/**
 * One-shot data migration — `packages/default-pack/`.
 *
 *   manifest.tileTextures        → presets/walls.jsonc + presets/floors.jsonc
 *                                  + presets/ceilings.jsonc (named presets per
 *                                  texture, semantic grouping)
 *   manifest.tileSheets          → presets/sheet_props.jsonc (one preset per
 *                                  resulting cell texture; the renderer keeps
 *                                  its tile-id mapping unchanged)
 *   scenes/scene*.json           → idMap + small-int grids (Tiled `firstgid`
 *                                  pattern)
 *
 * Idempotent — re-running on an already-migrated pack detects the
 * preset files + scene idMaps and exits cleanly without churn.
 *
 * Run with: `bun run scripts/migrate-default-pack-to-presets.ts`.
 *
 * See `docs/plans/TILE_PRESETS.md` §§ 4, 11 for the target data shape
 * and the migration plan.
 */

import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";

const REPO = new URL("../", import.meta.url).pathname;
const PACK = join(REPO, "packages/default-pack");

/* --- Manifest types (local mirror — avoids the engine import cycle) ----- */

interface SheetEntry {
  path: string;
  tileWidth: number;
  tileHeight: number;
  offsetX: number;
  offsetY: number;
  cols: number;
  rows: number;
  startTileId: number;
}

interface Manifest {
  name: string;
  version: string;
  engine?: string;
  startScene: string;
  config?: string;
  scripts?: string[];
  tileTextures: Record<string, string>;
  tileSheets: SheetEntry[];
  tilePresets?: string[];
  items?: unknown;
  defaultInventory?: unknown;
  sprites?: unknown;
  shaders_example?: unknown;
  shaders?: unknown;
  lighting?: unknown;
}

interface Emissive {
  color: [number, number, number];
  intensity: number;
  areaLight?: boolean;
}

interface PresetSource {
  texture?: string;
  topCap?: string;
  bottomCap?: string;
  wallHeight?: number;
  wallStartZ?: number;
  offsetX?: number;
  offsetY?: number;
  reflectiveness?: number;
  transition?: number;
  emissive?: Emissive;
  partialWall?: { face: "north" | "south" | "east" | "west"; startU: number; widthU: number };
  collision?: "solid" | "passable" | "trigger" | "blockBullets";
  displayName?: string;
  tags?: string[];
  extends?: string;
}

/* --- Friendly names for the canonical default-pack tiles ----------------- */

const TEXTURE_PRESET_ID: Record<string, { id: string; category: "walls" | "floors" | "ceilings" }> = {
  "images/tiles/wall.jpg": { id: "brick.wall", category: "walls" },
  "images/tiles/wood_floor.jpg": { id: "wood.floor", category: "floors" },
  "images/tiles/ceiling.jpg": { id: "stone.ceiling", category: "ceilings" },
  "images/tiles/tile_floor.jpg": { id: "tile.floor", category: "floors" },
};

/* --- IO helpers --------------------------------------------------------- */

async function readJson<T>(path: string): Promise<T> {
  const text = await Bun.file(path).text();
  return JSON.parse(text) as T;
}

async function writeJson(path: string, obj: unknown): Promise<void> {
  // Stable, hand-editable formatting.
  await Bun.write(path, JSON.stringify(obj, null, 2) + "\n");
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

/* --- Preset library construction ---------------------------------------- */

/** A bucket of preset entries keyed by preset id. */
type PresetBucket = Record<string, PresetSource>;

interface BuiltLibraries {
  walls: PresetBucket;
  floors: PresetBucket;
  ceilings: PresetBucket;
  sheetTiles: PresetBucket;
  /** Map from texture path → preset id (named entries only). */
  byTexture: Map<string, string>;
}

function buildBaseLibraries(manifest: Manifest): BuiltLibraries {
  const walls: PresetBucket = {};
  const floors: PresetBucket = {};
  const ceilings: PresetBucket = {};
  const sheetTiles: PresetBucket = {};
  const byTexture = new Map<string, string>();

  // tileTextures → named presets via TEXTURE_PRESET_ID.
  for (const [tileIdStr, texturePath] of Object.entries(manifest.tileTextures ?? {})) {
    const friendly = TEXTURE_PRESET_ID[texturePath];
    if (friendly) {
      const target =
        friendly.category === "walls" ? walls : friendly.category === "floors" ? floors : ceilings;
      target[friendly.id] = { texture: texturePath };
      byTexture.set(texturePath, friendly.id);
    } else {
      // Fallback: name by tile id; route to walls (the safest default).
      const id = `legacy.tile.${tileIdStr}`;
      walls[id] = { texture: texturePath };
      byTexture.set(texturePath, id);
    }
  }

  // tileSheets — preserve tile-id mapping by emitting one preset per
  // cell with texture pointing back at the sheet image. Renderer keeps
  // its existing sheet-cropping logic; this preset library exists for
  // future editor surfacing. Texture-path → tile-id reverse lookup
  // resolves to the sheet's `startTileId` (first match wins) — sheet
  // tiles share a texture path, so a preset library that references a
  // sheet entry can only resolve to ONE tile id today. That's
  // acceptable for default-pack because no scene references sheet tiles
  // yet.
  for (const sheet of manifest.tileSheets ?? []) {
    const total = sheet.cols * sheet.rows;
    for (let i = 0; i < total; i++) {
      const tileId = sheet.startTileId + i;
      const col = i % sheet.cols;
      const row = Math.floor(i / sheet.cols);
      const id = `sheet.${tileId}`;
      sheetTiles[id] = {
        texture: sheet.path,
        displayName: `Sheet tile ${tileId} (col ${col}, row ${row})`,
        tags: ["sheet"],
      };
      // Don't overwrite tileTextures-driven byTexture entries: the
      // first preset assigned to a texture path wins.
      if (!byTexture.has(sheet.path)) byTexture.set(sheet.path, id);
    }
  }

  return { walls, floors, ceilings, sheetTiles, byTexture };
}

/* --- JSONC emission ----------------------------------------------------- */

/**
 * Emit a JSONC preset library file with a small documentation header and
 * a stable, alphabetical key order. The strict-JSON body still parses
 * with the engine's bare `JSON.parse`, plus the resolver's JSONC
 * stripper if anyone hand-edits comments in later.
 */
async function writePresetFile(
  path: string,
  bucket: PresetBucket,
  header: string,
): Promise<void> {
  if (Object.keys(bucket).length === 0) return;
  const sorted: PresetBucket = {};
  for (const key of Object.keys(bucket).sort()) sorted[key] = bucket[key]!;
  const body = JSON.stringify(sorted, null, 2);
  const out = `// ${header}\n// Hand-editable — keys are preset IDs, values are PresetSource records.\n// See docs/plans/TILE_PRESETS.md § 3 for the schema.\n${body}\n`;
  await Bun.write(path, out);
}

/* --- Scene rewrite ------------------------------------------------------ */

interface SceneJSON {
  spawn?: unknown;
  lights?: unknown;
  walls?: unknown[][];
  floors?: unknown[][];
  ceilings?: unknown[][];
  idMap?: Record<string, string | null>;
  layerDefaults?: { floor?: string; ceiling?: string };
}

function normalisePresetForHash(src: PresetSource): string {
  // Drop authoring metadata (per § 8.2). Sort keys; recurse.
  const clean: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(src)) {
    if (k === "displayName" || k === "tags" || k === "thumbnail") continue;
    if (v === undefined) continue;
    clean[k] = v;
  }
  return canonicalStringify(clean);
}

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
 * Canonical-form SHA-256 truncated to 16 hex chars → anonymous preset
 * id (`_<hash>`). Mirrors the algorithm in `apps/pack-builder/src/
 * build-packs.ts` so migration-emitted and build-emitted anonymous
 * presets with identical content collapse onto the same id.
 */
function syncHashHex16(text: string): string {
  const hasher = new Bun.CryptoHasher("sha256");
  hasher.update(text);
  return hasher.digest("hex").slice(0, 16);
}

function anonymousIdSync(source: PresetSource): string {
  return "_" + syncHashHex16(normalisePresetForHash(source));
}

/* --- Scene migration core ------------------------------------------------ */

/**
 * Rewrite one scene file in place. Returns true if the scene changed.
 * Idempotent: re-running on an already-migrated scene exits cleanly.
 */
async function migrateScene(
  scenePath: string,
  tileTextures: Record<string, string>,
  manifestBaseId: Map<number, string>,
  derivedBucket: PresetBucket,
  inlineBucket: PresetBucket,
): Promise<boolean> {
  const scene = await readJson<SceneJSON>(scenePath);
  if (scene.idMap) {
    // Already migrated. Leave the file alone.
    return false;
  }

  // Walk walls/floors/ceilings, collect every preset id we'll need.
  const seen = new Set<string>();
  const wallIds: (string | null)[][] = [];
  const floorIds: (string | null)[][] = [];
  const ceilIds: (string | null)[][] = [];

  if (scene.walls) {
    for (const row of scene.walls) {
      const out: (string | null)[] = [];
      for (const cell of row) {
        const id = presetIdForWallCellSync(cell, tileTextures, manifestBaseId, inlineBucket);
        if (id) seen.add(id);
        out.push(id);
      }
      wallIds.push(out);
    }
  }
  if (scene.floors) {
    for (const row of scene.floors) {
      const out: (string | null)[] = [];
      for (const cell of row) {
        const id = presetIdForFloorCellSync(
          cell,
          tileTextures,
          manifestBaseId,
          inlineBucket,
          derivedBucket,
        );
        if (id) seen.add(id);
        out.push(id);
      }
      floorIds.push(out);
    }
  }
  if (scene.ceilings) {
    for (const row of scene.ceilings) {
      const out: (string | null)[] = [];
      for (const cell of row) {
        const id = presetIdForFloorCellSync(
          cell,
          tileTextures,
          manifestBaseId,
          inlineBucket,
          derivedBucket,
        );
        if (id) seen.add(id);
        out.push(id);
      }
      ceilIds.push(out);
    }
  }

  // Sort seen ids: named first (alphabetical), then anonymous
  // (alphabetical). 0 stays reserved for "no tile".
  const ordered = [...seen].sort((a, b) => {
    const aAnon = a.startsWith("_");
    const bAnon = b.startsWith("_");
    if (aAnon !== bAnon) return aAnon ? 1 : -1;
    return a < b ? -1 : a > b ? 1 : 0;
  });
  const idxOf = new Map<string, number>();
  const idMap: Record<string, string | null> = { "0": null };
  ordered.forEach((id, i) => {
    const idx = i + 1;
    idMap[String(idx)] = id;
    idxOf.set(id, idx);
  });

  const intify = (rows: (string | null)[][]): number[][] =>
    rows.map((row) => row.map((id) => (id === null ? 0 : (idxOf.get(id) ?? 0))));

  const newScene: SceneJSON = { ...scene };
  newScene.idMap = idMap;
  if (wallIds.length > 0) newScene.walls = intify(wallIds);
  if (floorIds.length > 0) newScene.floors = intify(floorIds);
  if (ceilIds.length > 0) newScene.ceilings = intify(ceilIds);

  // Reorder keys for readability — put idMap right after spawn.
  const out: Record<string, unknown> = {};
  if (newScene.spawn !== undefined) out.spawn = newScene.spawn;
  out.idMap = idMap;
  for (const [k, v] of Object.entries(newScene)) {
    if (k === "spawn" || k === "idMap") continue;
    out[k] = v;
  }

  await writeJson(scenePath, out);
  return true;
}

function presetIdForWallCellSync(
  cell: unknown,
  tileTextures: Record<string, string>,
  manifestBaseId: Map<number, string>,
  inlineBucket: PresetBucket,
): string | null {
  if (cell === 0 || cell === null || cell === undefined) return null;
  if (typeof cell === "number") {
    return manifestBaseId.get(cell) ?? `legacy.tile.${cell}`;
  }
  if (typeof cell === "object" && cell !== null) {
    const obj = cell as Record<string, unknown>;
    const tile = typeof obj.tile === "number" ? obj.tile : undefined;
    if (tile === undefined) return null;
    const texture = tileTextures[String(tile)];
    if (!texture) return null;
    const source: PresetSource = { texture };
    if (typeof obj.startZ === "number" && obj.startZ !== 0) source.wallStartZ = obj.startZ;
    if (typeof obj.height === "number" && obj.height !== 1) source.wallHeight = obj.height;
    if (typeof obj.offsetX === "number" && obj.offsetX !== 0) source.offsetX = obj.offsetX;
    if (typeof obj.offsetY === "number" && obj.offsetY !== 0) source.offsetY = obj.offsetY;
    if (typeof obj.topTile === "number") {
      const topTex = tileTextures[String(obj.topTile)];
      if (topTex) source.topCap = topTex;
    }
    if (typeof obj.bottomTile === "number") {
      const botTex = tileTextures[String(obj.bottomTile)];
      if (botTex) source.bottomCap = botTex;
    }
    if (obj.emissive && typeof obj.emissive === "object") {
      const em = obj.emissive as { color?: [number, number, number]; intensity?: number; areaLight?: boolean };
      if (em.color && typeof em.intensity === "number") {
        source.emissive = {
          color: em.color,
          intensity: em.intensity,
          ...(em.areaLight !== undefined ? { areaLight: em.areaLight } : {}),
        };
      }
    }
    const id = anonymousIdSync(source);
    inlineBucket[id] = source;
    return id;
  }
  return null;
}

function presetIdForFloorCellSync(
  cell: unknown,
  tileTextures: Record<string, string>,
  manifestBaseId: Map<number, string>,
  inlineBucket: PresetBucket,
  derivedBucket: PresetBucket,
): string | null {
  if (cell === null || cell === undefined || cell === "") return null;
  if (typeof cell === "string") {
    if (cell.trim() === "") return null;
    const parts = cell.trim().split("_");
    const tile = Number(parts[0]);
    if (!Number.isFinite(tile) || tile === 0) return null;
    const reflPct = parts[1] && parts[1].length > 0 ? Number(parts[1]) : 0;
    const transPct = parts[2] && parts[2].length > 0 ? Number(parts[2]) : 0;
    const texture = tileTextures[String(tile)];
    if (!texture) return null;
    const baseId = manifestBaseId.get(tile) ?? `legacy.tile.${tile}`;
    if (reflPct === 0 && transPct === 0) return baseId;
    const rTag = String(reflPct).padStart(3, "0");
    const tTag = String(transPct).padStart(3, "0");
    const id = `${baseId}.r${rTag}.t${tTag}`;
    derivedBucket[id] = {
      extends: baseId,
      reflectiveness: reflPct / 100,
      transition: transPct / 100,
    };
    return id;
  }
  if (typeof cell === "number") {
    if (cell === 0) return null;
    return manifestBaseId.get(cell) ?? `legacy.tile.${cell}`;
  }
  if (typeof cell === "object" && cell !== null) {
    const obj = cell as Record<string, unknown>;
    const tileField = obj.tile;
    let tile: number | undefined;
    let baseRefl = 0;
    let baseTrans = 0;
    if (typeof tileField === "string") {
      const parts = tileField.trim().split("_");
      tile = Number(parts[0]);
      baseRefl = parts[1] ? Number(parts[1]) / 100 : 0;
      baseTrans = parts[2] ? Number(parts[2]) / 100 : 0;
    } else if (typeof tileField === "number") {
      tile = tileField;
    }
    if (tile === undefined || !Number.isFinite(tile) || tile === 0) return null;
    const texture = tileTextures[String(tile)];
    if (!texture) return null;
    const refl = typeof obj.reflectiveness === "number" ? obj.reflectiveness : baseRefl;
    const trans = typeof obj.transition === "number" ? obj.transition : baseTrans;
    const source: PresetSource = { texture };
    if (refl !== 0) source.reflectiveness = refl;
    if (trans !== 0) source.transition = trans;
    if (obj.emissive && typeof obj.emissive === "object") {
      const em = obj.emissive as { color?: [number, number, number]; intensity?: number; areaLight?: boolean };
      if (em.color && typeof em.intensity === "number") {
        source.emissive = {
          color: em.color,
          intensity: em.intensity,
          ...(em.areaLight !== undefined ? { areaLight: em.areaLight } : {}),
        };
      }
    }
    const id = anonymousIdSync(source);
    inlineBucket[id] = source;
    return id;
  }
  return null;
}

/* --- Top-level driver --------------------------------------------------- */

async function main(): Promise<void> {
  const manifestPath = join(PACK, "manifest.json");
  const manifest = await readJson<Manifest>(manifestPath);

  const tileTextures = manifest.tileTextures ?? {};
  const manifestBaseId = new Map<number, string>();
  for (const [tileIdStr, texturePath] of Object.entries(tileTextures)) {
    const friendly = TEXTURE_PRESET_ID[texturePath];
    const id = friendly ? friendly.id : `legacy.tile.${tileIdStr}`;
    manifestBaseId.set(Number(tileIdStr), id);
  }

  const libs = buildBaseLibraries(manifest);

  // Derived (`.r*.t*` extensions) + anonymous buckets gathered during
  // scene walks.
  const derivedFloorBucket: PresetBucket = {};
  const derivedCeilBucket: PresetBucket = {};
  const inlineBucket: PresetBucket = {};

  // Migrate scenes.
  const scenesDir = join(PACK, "scenes");
  const sceneFiles = (await readdir(scenesDir)).filter((f) => f.endsWith(".json"));
  let changedScenes = 0;
  for (const sf of sceneFiles) {
    const p = join(scenesDir, sf);
    // Pick derived bucket by file name — floors derivations route to
    // floors.jsonc, ceilings derivations to ceilings.jsonc. For
    // simplicity in default-pack (well-behaved layers), we route ALL
    // derived `.r*.t*` presets to floors.jsonc except those derived
    // from the canonical ceiling texture, which go to ceilings.jsonc.
    // The router below post-processes derived entries.
    const _derivedAll: PresetBucket = {};
    const changed = await migrateScene(
      p,
      tileTextures,
      manifestBaseId,
      _derivedAll,
      inlineBucket,
    );
    if (changed) {
      changedScenes++;
      console.log(`  migrated ${sf}`);
    } else {
      console.log(`  skipped ${sf} (already migrated)`);
    }
    // Route derived presets by their `extends` parent's category.
    for (const [id, src] of Object.entries(_derivedAll)) {
      const parentId = src.extends;
      const parentCategory =
        parentId && libs.byTexture
          ? findCategoryOf(libs, parentId)
          : "floors";
      if (parentCategory === "ceilings") derivedCeilBucket[id] = src;
      else derivedFloorBucket[id] = src;
    }
  }

  // Merge derived buckets into floors/ceilings libraries.
  for (const [k, v] of Object.entries(derivedFloorBucket)) libs.floors[k] = v;
  for (const [k, v] of Object.entries(derivedCeilBucket)) libs.ceilings[k] = v;

  // Full-idempotency guard: when zero scenes changed, the buckets are
  // empty (we only collect from cells we just walked). Leave preset
  // files and manifest alone in that case — the prior run already
  // wrote the canonical content.
  if (changedScenes === 0) {
    console.log("Already migrated — no preset/manifest changes.");
    return;
  }

  // Write preset files (only categories that have entries).
  const presetsDir = join(PACK, "presets");
  await Bun.$`mkdir -p ${presetsDir}`.quiet();
  await writePresetFile(
    join(presetsDir, "walls.jsonc"),
    libs.walls,
    "Wall presets — default pack. Auto-generated by scripts/migrate-default-pack-to-presets.ts.",
  );
  await writePresetFile(
    join(presetsDir, "floors.jsonc"),
    libs.floors,
    "Floor presets — default pack. Auto-generated.",
  );
  await writePresetFile(
    join(presetsDir, "ceilings.jsonc"),
    libs.ceilings,
    "Ceiling presets — default pack. Auto-generated.",
  );
  if (Object.keys(libs.sheetTiles).length > 0) {
    await writePresetFile(
      join(presetsDir, "sheet_props.jsonc"),
      libs.sheetTiles,
      "Sheet-derived prop presets — one per cell in manifest.tileSheets. Auto-generated.",
    );
  }
  if (Object.keys(inlineBucket).length > 0) {
    await writePresetFile(
      join(presetsDir, "_anonymous.jsonc"),
      inlineBucket,
      "AUTO-GENERATED anonymous-bucket presets — collapsed inline cells. Do not hand-edit.",
    );
  }

  // Update manifest.json with tilePresets[] via minimal string surgery
  // so the rest of the file keeps its original formatting + ordering.
  const newTilePresets: string[] = [];
  if (Object.keys(libs.walls).length > 0) newTilePresets.push("presets/walls.jsonc");
  if (Object.keys(libs.floors).length > 0) newTilePresets.push("presets/floors.jsonc");
  if (Object.keys(libs.ceilings).length > 0) newTilePresets.push("presets/ceilings.jsonc");
  if (Object.keys(libs.sheetTiles).length > 0) newTilePresets.push("presets/sheet_props.jsonc");
  if (Object.keys(inlineBucket).length > 0) newTilePresets.push("presets/_anonymous.jsonc");

  const manifestText = await Bun.file(manifestPath).text();
  if (!/"\s*tilePresets\s*"\s*:/.test(manifestText)) {
    // Insert after the `tileSheets` block. We rely on the JSON having a
    // top-level `"tileSheets": [...]` array; find its matching `]` and
    // append the new key immediately after the trailing comma.
    const inject = `\n  "tilePresets": ${JSON.stringify(newTilePresets, null, 2)
      .replace(/\n/g, "\n  ")},`;
    const tileSheetsIdx = manifestText.indexOf('"tileSheets"');
    if (tileSheetsIdx === -1) {
      console.warn(
        "  manifest.json: no tileSheets block found to anchor tilePresets insertion; skipping.",
      );
    } else {
      // Walk past the matching `]` for the tileSheets array.
      let i = manifestText.indexOf("[", tileSheetsIdx);
      let depth = 0;
      while (i < manifestText.length) {
        const ch = manifestText[i];
        if (ch === "[") depth++;
        else if (ch === "]") {
          depth--;
          if (depth === 0) break;
        }
        i++;
      }
      // i now points to the closing `]` of tileSheets. Look for the
      // comma after it.
      let j = i + 1;
      while (j < manifestText.length && /\s/.test(manifestText[j]!)) j++;
      const insertAt = manifestText[j] === "," ? j + 1 : i + 1;
      const updated =
        manifestText.slice(0, insertAt) + inject + manifestText.slice(insertAt);
      await Bun.write(manifestPath, updated);
      console.log(`  updated manifest.json: tilePresets=${JSON.stringify(newTilePresets)}`);
    }
  } else {
    console.log(`  manifest.json: tilePresets already present, leaving alone`);
  }

  console.log(
    `Migration complete: ${changedScenes}/${sceneFiles.length} scene(s) updated, ` +
      `${Object.keys(libs.walls).length} wall, ${Object.keys(libs.floors).length} floor, ` +
      `${Object.keys(libs.ceilings).length} ceiling, ${Object.keys(libs.sheetTiles).length} sheet, ` +
      `${Object.keys(inlineBucket).length} anonymous preset(s).`,
  );
}

/** Find which category a named preset lives in. */
function findCategoryOf(libs: BuiltLibraries, id: string): "walls" | "floors" | "ceilings" {
  if (libs.floors[id]) return "floors";
  if (libs.ceilings[id]) return "ceilings";
  return "walls";
}

await main();
// Suppress unused-helper warnings.
void pathExists;

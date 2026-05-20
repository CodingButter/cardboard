import { normaliseGridField, stripJsonComments, type GridField } from "@two_5_d/engine";
import type { PackManifest } from "@two_5_d/engine";
import { EditorProjectStore } from "../lib/EditorProjectStore";
import { useSceneStore, type SceneCell } from "./useSceneStore";
import { useLayerStore } from "./useLayerStore";
import { useTilePresetStore } from "./useTilePresetStore";
import {
  useTilePresetRegistryStore,
  type TilePresetRegistryEntry,
} from "./useTilePresetRegistryStore";
import { useDiagnosticsStore } from "./useDiagnosticsStore";
import type { TilePresetCategory } from "../views/scene/scene-fixtures";

/**
 * hydrateStoresFromIdb — bridge the IDB → Zustand gap that Wave 3.3
 * forgot to wire.
 *
 * Pack-import (`importPack.ts`) writes the pack contents to IDB via
 * `EditorProjectStore.saveAsset`. Wave 3.3 migrated 14 panels off
 * `MOCK_*` fixtures onto `useSceneStore` / `useLayerStore` /
 * `useTilePresetStore` — but nothing populates those stores from IDB
 * when a project opens. Result: MapCanvas, LayersPanel, TilePresetPanel,
 * SceneSettingsPanel, MinimapPanel and PreviewPanel render empty after
 * `importPack`.
 *
 * This helper closes the loop on the READ side:
 *
 *   1. Load the project's manifest from IDB.
 *   2. Load every preset JSONC file referenced by `manifest.tilePresets[]`
 *      and synthesise legacy `__legacy.<id>` entries from
 *      `manifest.tileTextures`. The combined registry is pushed into
 *      `useTilePresetRegistryStore` so panels can look up
 *      preset → color / name / category.
 *   3. Resolve the active scene path — explicit
 *      `cardboard_editor_active_scene_<id>` LS value wins, else
 *      `manifest.startScene`.
 *   4. Parse the scene's `walls` / `floors` / `ceilings` grids (RLE or
 *      nested) and the scene-level `idMap` (`{ "0": null, "1": "brick.wall" }`).
 *      Project each non-zero int through `idMap` → real preset id and
 *      write into `useSceneStore.cells` keyed by `"x,y"`. Cells whose
 *      ints have no `idMap` entry get a diagnostic and are skipped
 *      (rather than written with a synthetic `tile:<n>` id).
 *   5. Push `dims` from the grid extent + a default layer set that
 *      includes the engine's three grid layers (`walls`/`floors`/`ceilings`).
 *
 * WRITE-BACK is out of scope here — `useSceneStore` mutations land in
 * LS via the persist middleware but are NOT written back to IDB.
 * Cross-window edit sync still works via the `storage` event because
 * `useSceneStore` is built on `createSyncedStore`.
 */

const ACTIVE_SCENE_KEY_PREFIX = "cardboard_editor_active_scene_";

/** Engine grid layer keys we hydrate into `useSceneStore.cells`. */
const GRID_LAYERS = ["walls", "floors", "ceilings"] as const;
type GridLayerId = (typeof GRID_LAYERS)[number];

/** Layer-store snapshot we install on hydrate. */
const DEFAULT_LAYER_ORDER = [
  "floors",
  "walls",
  "ceilings",
  "doors",
  "sprites",
  "lights",
] as const;

const DEFAULT_LAYER_VISIBILITY: Record<string, boolean> = {
  floors: true,
  walls: true,
  ceilings: true,
  doors: true,
  sprites: true,
  lights: false,
};

/** Type guard for the nested-grid form returned by `normaliseGridField`. */
function isFiniteCell(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v) && v !== 0;
}

/**
 * Read the per-project active scene path persisted by
 * `<ActiveSceneProvider/>` (key `cardboard_editor_active_scene_<id>`).
 * Falls back to the manifest's `startScene` field.
 */
function resolveActiveScenePath(
  projectId: string,
  manifestStartScene: string | null | undefined,
): string | null {
  try {
    const pinned = localStorage.getItem(ACTIVE_SCENE_KEY_PREFIX + projectId);
    if (pinned && pinned.trim()) return pinned;
  } catch {
    // ignore — LS unavailable (private mode etc.)
  }
  return manifestStartScene ?? null;
}

/**
 * Hash a string to a 32-bit unsigned int. Deterministic + stable across
 * runs — same texture path always yields the same color. FNV-1a in 7
 * LOC; cheap enough to do for every preset on every hydrate.
 */
function hashString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * Per-category base hue + saturation / lightness band. Walls trend
 * blue-gray, floors warm brown, ceilings cool gray, decor green. The
 * texture-path hash adds a ±30° hue jitter inside the band so distinct
 * presets in the same category render as distinguishable but related
 * colors.
 */
const CATEGORY_PALETTE: Record<
  TilePresetCategory,
  { baseHue: number; saturation: number; lightness: number }
> = {
  walls: { baseHue: 210, saturation: 35, lightness: 50 },
  floors: { baseHue: 28, saturation: 45, lightness: 42 },
  ceilings: { baseHue: 220, saturation: 12, lightness: 55 },
  decor: { baseHue: 140, saturation: 40, lightness: 50 },
};

/** HSL → `#RRGGBB`. Standard conversion, no deps. */
function hslToHex(h: number, s: number, l: number): string {
  const sn = s / 100;
  const ln = l / 100;
  const c = (1 - Math.abs(2 * ln - 1)) * sn;
  const hp = ((h % 360) + 360) % 360 / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  let r = 0;
  let g = 0;
  let b = 0;
  if (hp < 1) {
    r = c;
    g = x;
  } else if (hp < 2) {
    r = x;
    g = c;
  } else if (hp < 3) {
    g = c;
    b = x;
  } else if (hp < 4) {
    g = x;
    b = c;
  } else if (hp < 5) {
    r = x;
    b = c;
  } else {
    r = c;
    b = x;
  }
  const m = ln - c / 2;
  const toHex = (v: number): string => {
    const n = Math.round((v + m) * 255);
    const clamped = Math.max(0, Math.min(255, n));
    return clamped.toString(16).padStart(2, "0");
  };
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

/**
 * Derive a `#RRGGBB` color for a preset from its texture path +
 * category. Hash the texture path to a stable hue offset inside the
 * category's color band so two presets sharing a texture render the
 * same color (intentional — they're visually the same tile) but two
 * presets with different textures stand apart even within one layer.
 *
 * This is intentionally NOT a sample of the actual texture image —
 * loading textures here is a larger pass (atlas, fetch, decode). The
 * hash-based palette is good enough to distinguish presets on the
 * top-down map; the texture-sample pass can land later.
 */
function colorForPreset(category: TilePresetCategory, texture: string): string {
  const palette = CATEGORY_PALETTE[category];
  const hash = hashString(texture);
  // ±30° hue jitter — keeps presets in-category but visually distinct.
  const hueJitter = ((hash >>> 0) % 61) - 30;
  // ±10 lightness — adds another axis of variation so two presets
  // that happen to land on the same hue can still be told apart.
  const lightJitter = (((hash >>> 8) >>> 0) % 21) - 10;
  return hslToHex(
    palette.baseHue + hueJitter,
    palette.saturation,
    Math.max(20, Math.min(75, palette.lightness + lightJitter)),
  );
}

/**
 * Map a preset-file path (e.g. `presets/walls.jsonc`,
 * `presets/floors.jsonc`) to its category bucket. Anonymous /
 * unknown filenames default to `decor` so they still render somewhere.
 */
function categoryFromPresetFile(filePath: string): TilePresetCategory {
  const lower = filePath.toLowerCase();
  if (lower.includes("walls")) return "walls";
  if (lower.includes("floors")) return "floors";
  if (lower.includes("ceilings")) return "ceilings";
  return "decor";
}

/**
 * Best-effort category derivation for a legacy `__legacy.<n>` preset
 * synthesised from `manifest.tileTextures`. The texture path holds the
 * hint — e.g. `images/tiles/wall.jpg` → walls, `wood_floor` → floors.
 * Unknown paths fall back to `decor`.
 */
function categoryFromTexturePath(texture: string): TilePresetCategory {
  const lower = texture.toLowerCase();
  if (lower.includes("wall")) return "walls";
  if (lower.includes("floor")) return "floors";
  if (lower.includes("ceiling")) return "ceilings";
  return "decor";
}

/**
 * Derive a human-friendly display name from a preset id. `"brick.wall"`
 * → `"Brick Wall"`, `"wall.short.glow.pink"` → `"Wall Short Glow Pink"`,
 * `"__legacy.1"` → `"Tile 1"`.
 */
function displayNameForPresetId(id: string, fallback?: string): string {
  if (fallback && fallback.trim()) return fallback.trim();
  if (id.startsWith("__legacy.")) {
    return `Tile ${id.slice("__legacy.".length)}`;
  }
  return id
    .split(/[._-]/)
    .filter((part) => part.length > 0)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

/**
 * Minimal shape we care about from each preset's JSONC body. The full
 * resolver lives in the engine — we don't need its `extends` / shader
 * / validation machinery here, just enough to know which texture path
 * the preset declares so we can derive a color.
 */
interface PresetSourceLite {
  texture?: string;
  displayName?: string;
  extends?: string;
}

/**
 * Load + parse every preset library listed in `manifest.tilePresets[]`
 * plus synthesise legacy entries from `manifest.tileTextures`. Returns
 * a registry-shaped record keyed by preset id with a derived color +
 * display name. Failures (missing file, bad JSONC) surface as
 * diagnostics rather than throws.
 */
async function buildPresetRegistry(
  projectId: string,
  manifest: PackManifest,
): Promise<Record<string, TilePresetRegistryEntry>> {
  const out: Record<string, TilePresetRegistryEntry> = {};

  // ── Legacy compat shim: synthesise __legacy.<id> entries from
  //    manifest.tileTextures so scenes using bare ints still resolve.
  const tileTextures = manifest.tileTextures ?? {};
  for (const [idStr, path] of Object.entries(tileTextures)) {
    const id = `__legacy.${idStr}`;
    const texture = String(path);
    const category = categoryFromTexturePath(texture);
    out[id] = {
      id,
      name: displayNameForPresetId(id),
      category,
      texture,
      color: colorForPreset(category, texture),
    };
  }

  // ── Modder-authored libraries.
  const files = manifest.tilePresets ?? [];
  // First pass: parse + register raw sources keyed by id so `extends`
  // can be resolved with a simple lookup.
  type RawEntry = { source: PresetSourceLite; file: string };
  const raw: Record<string, RawEntry> = {};

  for (const filePath of files) {
    let body: string | Blob | null = null;
    try {
      body = await EditorProjectStore.loadAsset(projectId, filePath);
    } catch (err) {
      useDiagnosticsStore.getState().log(
        "warn",
        `[hydration] failed to read preset file "${filePath}": ${(err as Error).message}`,
      );
      continue;
    }
    if (typeof body !== "string") {
      useDiagnosticsStore.getState().log(
        "warn",
        `[hydration] preset file "${filePath}" missing or not a text asset`,
      );
      continue;
    }
    let parsed: Record<string, PresetSourceLite>;
    try {
      parsed = JSON.parse(stripJsonComments(body)) as Record<string, PresetSourceLite>;
    } catch (err) {
      useDiagnosticsStore.getState().log(
        "warn",
        `[hydration] preset file "${filePath}" — invalid JSONC: ${(err as Error).message}`,
      );
      continue;
    }
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      useDiagnosticsStore.getState().log(
        "warn",
        `[hydration] preset file "${filePath}" — expected top-level object`,
      );
      continue;
    }
    for (const [id, source] of Object.entries(parsed)) {
      if (typeof source !== "object" || source === null) continue;
      raw[id] = { source, file: filePath };
    }
  }

  // Second pass: resolve `extends` (shallow — chase parent chains for
  // their texture only, since that's all we need for color). Cap depth
  // to mirror the engine's `MAX_EXTENDS_DEPTH = 8`.
  function resolveTexture(id: string, depth: number): string | undefined {
    if (depth > 8) return undefined;
    const entry = raw[id];
    if (!entry) return undefined;
    if (entry.source.texture) return entry.source.texture;
    if (entry.source.extends) return resolveTexture(entry.source.extends, depth + 1);
    return undefined;
  }

  for (const [id, entry] of Object.entries(raw)) {
    const category = categoryFromPresetFile(entry.file);
    const texture = resolveTexture(id, 0);
    if (!texture) {
      // Engine resolver would flag this as a hard error; we just skip
      // it for color-derivation purposes and log a diagnostic.
      useDiagnosticsStore.getState().log(
        "warn",
        `[hydration] preset "${id}" has no resolvable texture (skipping color derivation)`,
      );
      continue;
    }
    out[id] = {
      id,
      name: displayNameForPresetId(id, entry.source.displayName),
      category,
      texture,
      color: colorForPreset(category, texture),
    };
  }

  return out;
}

/**
 * Read the `idMap` from a parsed scene object. Tolerates both string
 * and number keys (engine accepts both). Returns `null` when the
 * scene doesn't declare one — legacy scenes whose grids carry bare
 * tile-texture ints fall back to `__legacy.<n>` synthesised entries.
 */
function readSceneIdMap(
  scene: Record<string, unknown>,
): Record<string, string | null> | null {
  const raw = scene.idMap;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const out: Record<string, string | null> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (v === null) {
      out[String(k)] = null;
    } else if (typeof v === "string") {
      out[String(k)] = v;
    }
    // Other shapes (number, object) are not legal idMap values —
    // silently ignore so a malformed entry doesn't poison hydration.
  }
  return out;
}

/**
 * Convert an engine-shape scene's grid layers into the editor's sparse
 * `cells` map. Each non-zero cell on a grid becomes a `layers[<layer>]`
 * entry with the REAL preset id resolved through the scene's `idMap`
 * (or the legacy `__legacy.<n>` shim for scenes without an idMap).
 *
 * Cells whose ints can't be resolved log a single warning per missing
 * id and are skipped — we never write a synthetic preset id that the
 * registry doesn't know about.
 */
function projectGridsIntoCells(
  scene: Record<string, unknown>,
  registry: Record<string, TilePresetRegistryEntry>,
): { cells: Record<string, SceneCell>; dims: { w: number; h: number } } {
  const cells: Record<string, SceneCell> = {};
  let width = 0;
  let height = 0;

  const idMap = readSceneIdMap(scene);
  // Track per-int warnings we've already emitted so a 4096-cell grid
  // doesn't flood OutputPanel with the same message.
  const warnedInts = new Set<number>();
  const log = useDiagnosticsStore.getState().log;

  function resolvePresetId(tileInt: number): string | null {
    // idMap path — the modern scene shape. Falls back to `__legacy.<n>`
    // if the idMap entry is null/missing AND the legacy synth covers it.
    if (idMap) {
      const mapped = idMap[String(tileInt)];
      if (typeof mapped === "string" && mapped.length > 0) {
        if (registry[mapped]) return mapped;
        // The id resolves through idMap but the registry doesn't know
        // it — usually means the preset file failed to parse. Warn once.
        if (!warnedInts.has(tileInt)) {
          warnedInts.add(tileInt);
          log(
            "warn",
            `[hydration] scene tile ${tileInt} → preset "${mapped}" not in registry`,
          );
        }
        return null;
      }
      if (mapped === null) return null; // explicit null = empty cell
      // No entry for this int in idMap at all. Fall through to legacy.
    }
    const legacyId = `__legacy.${tileInt}`;
    if (registry[legacyId]) return legacyId;
    if (!warnedInts.has(tileInt)) {
      warnedInts.add(tileInt);
      log(
        "warn",
        `[hydration] scene tile ${tileInt} has no idMap entry and no legacy texture (skipping)`,
      );
    }
    return null;
  }

  for (const layerId of GRID_LAYERS) {
    const raw = scene[layerId] as GridField<unknown> | undefined;
    if (raw === undefined) continue;
    const grid = normaliseGridField(raw);
    if (!grid) continue;
    if (grid.length > height) height = grid.length;
    for (let y = 0; y < grid.length; y++) {
      const row = grid[y]!;
      if (row.length > width) width = row.length;
      for (let x = 0; x < row.length; x++) {
        const v = row[x];
        let tileId: number | null = null;
        if (typeof v === "number") {
          tileId = v;
        } else if (v && typeof v === "object" && "tile" in v) {
          const t = (v as { tile: unknown }).tile;
          if (typeof t === "number") tileId = t;
          else if (typeof t === "string") {
            const head = t.split("_", 1)[0];
            const n = Number(head);
            if (Number.isFinite(n)) tileId = n;
          }
        }
        if (!isFiniteCell(tileId)) continue;
        const presetId = resolvePresetId(tileId);
        if (!presetId) continue;
        const key = `${x},${y}`;
        const existing = cells[key];
        if (existing) {
          existing.layers[layerId] = presetId;
        } else {
          cells[key] = {
            layers: { [layerId as GridLayerId]: presetId },
            height: 0,
            tags: [],
            properties: {},
          };
        }
      }
    }
  }
  return { cells, dims: { w: width, h: height } };
}

/**
 * Hydrate the wave-3 Zustand stores from the project's IDB rows. Safe
 * to call multiple times — each call REPLACES the relevant slices.
 *
 * Failure modes:
 *   - No manifest → push empty cells + default 64×64 dims + default layers.
 *   - Scene asset missing → same as no manifest (panels render the
 *     "no painted cells" state rather than throwing).
 *   - Malformed scene JSON → caught; logged via diagnostics; empty hydration.
 *   - Bad preset file → diagnostic, that preset is skipped; the rest hydrate.
 */
export async function hydrateStoresFromIdb(projectId: string): Promise<void> {
  // 1) Manifest. Drives `startScene` + preset-file discovery.
  const manifest = await EditorProjectStore.loadManifest(projectId);

  // 2) Preset registry. Built from manifest.tilePresets[] +
  //    manifest.tileTextures (legacy compat). Pushed into the registry
  //    store BEFORE scene hydration so the cell projection can validate
  //    each idMap entry against the live registry.
  const registry = manifest
    ? await buildPresetRegistry(projectId, manifest)
    : {};
  useTilePresetRegistryStore.getState().replaceAll(registry);

  const scenePath = resolveActiveScenePath(projectId, manifest?.startScene);

  // 3) Scene JSON. Tolerate every kind of "no scene yet" state.
  let sceneRaw: string | null = null;
  if (scenePath) {
    const body = await EditorProjectStore.loadAsset(projectId, scenePath);
    if (typeof body === "string") sceneRaw = body;
  }

  let cells: Record<string, SceneCell> = {};
  let dims = { w: 64, h: 64 };
  let sceneName = "level-01";

  if (sceneRaw) {
    try {
      const parsed = JSON.parse(sceneRaw) as Record<string, unknown>;
      const projected = projectGridsIntoCells(parsed, registry);
      cells = projected.cells;
      if (projected.dims.w > 0) dims = projected.dims;
      const n = parsed.name;
      if (typeof n === "string" && n.trim()) sceneName = n.trim();
      else if (manifest?.name) sceneName = manifest.name;
    } catch (err) {
      useDiagnosticsStore.getState().log(
        "error",
        `[hydration] failed to parse scene ${scenePath}: ${(err as Error).message}`,
      );
    }
  } else if (manifest?.name) {
    sceneName = manifest.name;
  }

  // 4) Push into useSceneStore. `setState` here replaces only the data
  //    slice; action functions on the store remain intact.
  useSceneStore.setState({
    dims,
    cells,
    settings: {
      name: sceneName,
      fog: 0.25,
      ambient: 0.35,
    },
  });

  // 5) Push the default layer set. Adds `ceilings` to the legacy layer
  //    order so the engine's third grid renders too. Preserves any
  //    custom layers the user added in this session.
  const existingLayer = useLayerStore.getState();
  const visibility = { ...DEFAULT_LAYER_VISIBILITY };
  for (const c of existingLayer.customLayers) {
    if (visibility[c.id] === undefined) visibility[c.id] = true;
  }
  const order = [
    ...DEFAULT_LAYER_ORDER,
    ...existingLayer.customLayers
      .map((c) => c.id)
      .filter((id) => !DEFAULT_LAYER_ORDER.includes(id as typeof DEFAULT_LAYER_ORDER[number])),
  ];
  useLayerStore.setState({
    activeId: existingLayer.activeId in visibility
      ? existingLayer.activeId
      : "walls",
    visibility,
    order,
    customLayers: existingLayer.customLayers,
  });

  // 6) TilePreset UI store — reset only if the previously-selected
  //    preset id is obviously stale (a `MOCK_*` id from before Wave 3.3
  //    OR a `tile:<n>` synthetic from before the registry landed). If
  //    the active id is present in the new registry, leave it alone.
  const tp = useTilePresetStore.getState();
  const isStale =
    !tp.activeId ||
    tp.activeId.startsWith("tile:") ||
    tp.activeId.startsWith("wall-") ||
    tp.activeId.startsWith("floor-") ||
    tp.activeId.startsWith("ceil-") ||
    tp.activeId.startsWith("decor-");
  const inRegistry = registry[tp.activeId] !== undefined;
  if (isStale && !inRegistry) {
    // Prefer the first wall preset; fall back to the first registry
    // entry; fall back to empty string (panel handles unknown ids).
    const firstWall = Object.values(registry).find((p) => p.category === "walls");
    const firstAny = Object.values(registry)[0];
    const next = firstWall?.id ?? firstAny?.id ?? "";
    useTilePresetStore.setState({
      activeId: next,
      activeCategory: tp.activeCategory ?? "all",
    });
  }
}

import { Vec2 } from "Libs/Vector";
import type { PresetResolver, ResolvedPresetData } from "AssetPack/PresetResolver";
import type { ShaderData } from "Components/Shader";

/**
 * Which face of a cell a wall segment lies on. A wall is a 1-D segment in
 * the floor plane; constraining each one to a cell edge keeps DDA grid-
 * aligned and the data authoring legible. The face is named by the
 * compass direction of the edge relative to the cell centre — N = top
 * (low y), S = bottom (high y), W = left (low x), E = right (high x).
 */
export type WallFace = "N" | "S" | "E" | "W";

/**
 * One wall slab inside a cell. Phase 1 of the wall overhaul exposes
 * `startZ`/`height` so a single cell can host walls shorter than full
 * height (windows, half-walls, low pillars). `face` / `startU` / `widthU`
 * are filled in but not yet honoured by DDA — Phase 3 lights them up.
 */
export interface WallSegment {
  /** Texture tile id (manifest `tileTextures` / `tileSheets`). */
  tile: number;
  /** World z of the bottom of the wall slab. `0` = floor level. */
  startZ: number;
  /** Vertical extent in world z units. Full-height walls use `1`. */
  height: number;
  /**
   * Horizontal texture offset in texel units. Slides the sample along U.
   * Default `0`. Wraps modulo texture width.
   */
  offsetX: number;
  /**
   * Vertical texture offset in texel units. Slides the sample along V.
   * Default `0`. Wraps modulo texture height.
   */
  offsetY: number;
  /** Cell edge this segment lies on. Phase 3 honours partial widths. */
  face: WallFace;
  /** `[0, 1]` start position along the cell edge. `0` for full walls. */
  startU: number;
  /** `(0, 1]` fraction of the cell edge the segment covers. `1` for full. */
  widthU: number;
  /**
   * Texture for the horizontal surface at `z = startZ + height` (the cap
   * facing up). Visible when the camera looks down onto a wall whose top
   * is below eye level (e.g. a knee-high parapet). Defaults to `tile`
   * when absent so authors only specify it when the cap should differ
   * from the wall face. `0` = no cap drawn even if visible.
   */
  topTile?: number;
  /**
   * Texture for the horizontal surface at `z = startZ` (the cap facing
   * down). Visible when the camera looks up under a hanging wall (window
   * header, suspended beam). Defaults to `tile` when absent. `0` = no
   * cap drawn even if visible.
   */
  bottomTile?: number;
  /**
   * Optional self-illumination + area-light source. When present the
   * runtime adds `color × intensity` to the surface's final colour
   * (visible even in darkness), and the bake auto-spawns a matching
   * area light unless `areaLight: false`. See LIGHTING_OVERHAUL.md
   * §§ 3.2 / 4.3.
   */
  emissive?: EmissiveSpec;
}

/**
 * Emissive surface authoring shape. `areaLight` defaults to `true`,
 * meaning the bake will spawn a 3×3 grid of point lights on the
 * surface so it illuminates its neighbours; `false` keeps the runtime
 * self-illumination but skips the bake contribution.
 */
export interface EmissiveSpec {
  color: [number, number, number];
  intensity: number;
  /** Defaults to `true`. */
  areaLight?: boolean;
}

/** Floor metadata per cell. */
export interface FloorData {
  /** Texture tile id. `0` = no texture (renderer falls back to a solid color). */
  tile: number;
  /** `0..1`. How much the ceiling is mirrored into the floor. `0` = matte. */
  reflectiveness: number;
  /**
   * `0..1`. Bilinear blend strength with the 4 neighbor cells'
   * reflectiveness.
   *
   *   - `0` — hard edges; the cell uses its own `reflectiveness` flat.
   *   - `1` — fully bilinear; this cell's `reflectiveness` shows at the
   *     center, and the edges fade toward each neighbor's value.
   *
   * The center always renders this cell's own `reflectiveness`; only the
   * approach to the cell boundary is affected.
   */
  transition: number;
  /** Optional emissive — see `EmissiveSpec`. */
  emissive?: EmissiveSpec;
}

/** Ceiling metadata per cell. */
export interface CeilingData {
  /** Texture tile id. `0` = no texture (renderer falls back to a solid color). */
  tile: number;
  /** `0..1`. How much the floor is mirrored into the ceiling. `0` = matte. */
  reflectiveness: number;
  /** See `FloorData.transition` — same idea for the ceiling layer. */
  transition: number;
  /** Optional emissive — see `EmissiveSpec`. */
  emissive?: EmissiveSpec;
}

/**
 * One map cell. Carries everything the renderer needs to know about the
 * column of world above this tile.
 *
 * `walls` is the structured form (Phase 1+ of the wall overhaul). An
 * empty array means "walkable / open cell". `wall` is the legacy
 * compatibility view — it's the first segment's tile id, or `0` when
 * the cell is open — so existing callers (`scene.isWall`, AO, minimap,
 * collision) keep working without changes.
 *
 * For Phase 1, every cell has at most one full-extent wall segment
 * (`startU: 0, widthU: 1`). Phase 3 will populate multiple partial
 * segments per cell.
 */
export interface Cell {
  /** Legacy "is this cell solid + what tile" view. Derived from `walls[0]`. */
  wall: number;
  /** Structured wall slabs, in render order. Empty = open cell. */
  walls: ReadonlyArray<WallSegment>;
  floor: FloorData;
  ceiling: CeilingData;
  /**
   * Preset id that produced this cell's wall, if the scene used
   * `idMap` resolution. `undefined` for legacy bare-int scenes and
   * for open cells. M2 of MATERIALS.md uses this to map each cell
   * to its world-shader variant id; non-`idMap` scenes always render
   * with variant 0.
   */
  wallPresetId?: string;
  /** Preset id for this cell's floor. See `wallPresetId`. */
  floorPresetId?: string;
  /** Preset id for this cell's ceiling. See `wallPresetId`. */
  ceilingPresetId?: string;
}

/** The internal cell grid. `grid[row][col]`. */
export type SceneGrid = ReadonlyArray<ReadonlyArray<Cell>>;

/**
 * Per-cell preset id triple captured during `idMap` resolution. M2 of
 * MATERIALS.md routes per-cell world-shader variants via these ids.
 * All three fields optional — open cells leave `wall` undefined, and
 * legacy scenes without `idMap` leave every field undefined.
 */
export interface CellPresetIds {
  wall?: string;
  floor?: string;
  ceiling?: string;
}

/**
 * Scene-controller block — WORLD_STATE.md §5.2 + §6.2. Every scene
 * has one synthetic controller entity spawned at scene-load. The
 * `components` map is attached verbatim (same shape as
 * `scene.entities[].components`). Pack authors declare per-scene
 * state here: SpawnerList, Music, Victory, EnemyBudget, etc.
 *
 * Optional in the JSON shape — scenes without a controller block
 * get an empty synthetic entity (no components attached) so the
 * engine's controller-id stays valid for `api.scene.controller`.
 *
 * Per the WORLD_STATE.md "world.json full-scope" pass (2026-05-17)
 * the legacy top-level `spawn` field is GONE — new authoring goes
 * exclusively through `controller.components.SpawnerList`. Pack
 * scripts that need to reposition a persistent player on scene swap
 * read `api.scene.controller.components.SpawnerList.points[0]`.
 */
export interface SceneControllerJSON {
  /** componentName → componentData. Same shape as entity records. */
  components?: Record<string, unknown>;
  /** Editor-only metadata; engine ignores `_*` keys. */
  [editorOnly: `_${string}`]: unknown;
}

/**
 * Entity record stamped into a scene by the editor (or hand-authored).
 * PREFABS_EDITOR_ONLY.md §4.1: every entity the engine ever sees ships
 * pre-flattened in `scene.entities[]` (or gets spawned by a regular
 * pack script). The engine walks the array at scene-load, spawns a
 * fresh entity per record, looks each component up via
 * `api.getComponent(name)`, and attaches it.
 *
 * `_*`-prefixed keys are editor metadata (`_prefabSource`,
 * `_prefabSourceHash`, etc.) — engine ignores them entirely.
 */
export interface SceneEntityJSON {
  /**
   * Optional authored entity id. When supplied, the scene-load /
   * world-spawn path will materialise this entity at exactly that id
   * (via `World.spawn(id)`), giving pack authors a stable handle so one
   * entity can reference another by id (e.g. a `Carrier { hotbar: 2 }`
   * pointing at the container entity authored with `id: 2`). When
   * omitted the engine allocates the next free id.
   */
  id?: number;
  /** Optional human-readable name — round-trips; surface in editor UI. */
  name?: string;
  /** componentName → componentData. */
  components: Record<string, unknown>;
  /** Editor-only metadata; engine ignores `_*` keys. */
  [editorOnly: `_${string}`]: unknown;
}

/* --- Run-length grid encoding ------------------------------------------- */

/**
 * Run-length-encoded grid wire format for `walls` / `floors` /
 * `ceilings`. Storage / transport optimisation only — the engine
 * unrolls it back to the nested-array shape the rest of the pipeline
 * already consumes at `Scene.fromJSON` time.
 *
 *   `{ width, height, rle: [value, runLength, value, runLength, ...] }`
 *
 * The flat `rle` array carries alternating `(value, runLength)` pairs
 * in row-major order. The sum of every `runLength` MUST equal
 * `width * height`.
 *
 * For structured cells (objects, not bare ints) two cells are
 * considered "the same" if they compare deeply-equal via canonical
 * JSON. Int grids — what `idMap` produces and what `default-pack`
 * ships — collapse with a trivial `===` compare.
 */
export interface RleGrid<T = unknown> {
  width: number;
  height: number;
  rle: T[];
}

/**
 * Either the legacy nested-row form (`T[][]`) or the new RLE-object
 * form. Scene authors / tools pick whichever is more readable for the
 * grid; the loader auto-detects via `Array.isArray`.
 */
export type GridField<T> = T[][] | RleGrid<T>;

/** Type guard for the RLE wire form. */
export function isRleGrid<T>(value: unknown): value is RleGrid<T> {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Array.isArray((value as { rle?: unknown }).rle) &&
    typeof (value as { width?: unknown }).width === "number" &&
    typeof (value as { height?: unknown }).height === "number"
  );
}

/**
 * Unroll an RLE grid back into the nested-array shape the engine
 * consumes downstream. `width × height` cells walked row-major.
 *
 * Throws when the run-length sum doesn't match `width * height` —
 * silent truncation would let a typo'd scene render with a misaligned
 * grid and ship to disk on the next save.
 */
export function decodeRleGrid<T>(input: RleGrid<T>): T[][] {
  const { width, height, rle } = input;
  if (rle.length % 2 !== 0) {
    throw new Error(
      `[scene] RLE grid has odd-length pairs array (${rle.length}); expected alternating (value, runLength).`,
    );
  }
  const total = width * height;
  const out: T[][] = new Array(height);
  for (let y = 0; y < height; y++) out[y] = new Array(width) as T[];

  let cell = 0;
  for (let i = 0; i < rle.length; i += 2) {
    const value = rle[i] as T;
    const runRaw = rle[i + 1] as unknown;
    const run = typeof runRaw === "number" ? runRaw : Number(runRaw);
    if (!Number.isInteger(run) || run <= 0) {
      throw new Error(
        `[scene] RLE grid run length at pair ${i / 2} is not a positive integer (got ${String(runRaw)}).`,
      );
    }
    for (let k = 0; k < run; k++) {
      if (cell >= total) {
        throw new Error(
          `[scene] RLE grid overflow: runs sum to more than ${total} cells (${width} × ${height}).`,
        );
      }
      const y = (cell / width) | 0;
      const x = cell - y * width;
      out[y]![x] = value;
      cell++;
    }
  }
  if (cell !== total) {
    throw new Error(
      `[scene] RLE grid underflow: runs sum to ${cell} cells, expected ${total} (${width} × ${height}).`,
    );
  }
  return out;
}

/**
 * Encode a nested-array grid back into the RLE wire form. Mirrors
 * `decodeRleGrid`. Used by tooling that wants to ship scenes in the
 * compact form (the default-pack scenes + the editor's eventual save
 * path).
 *
 * Equality:
 *   - Primitives (numbers, strings, booleans, `null`) compare with
 *     `Object.is`.
 *   - Objects / arrays compare via canonical JSON. Cheap enough for
 *     scene-sized grids and stable across keys.
 *
 * Empty grids (height 0 or width 0) round-trip to an empty `rle`
 * array.
 */
export function encodeRleGrid<T>(grid: ReadonlyArray<ReadonlyArray<T>>): RleGrid<T> {
  const height = grid.length;
  const width = height > 0 ? grid[0]!.length : 0;
  const rle: T[] = [];
  if (width === 0 || height === 0) return { width, height, rle };

  let prev: T | undefined;
  let prevKey: string | null = null;
  let hasPrev = false;
  let run = 0;
  for (let y = 0; y < height; y++) {
    const row = grid[y]!;
    for (let x = 0; x < width; x++) {
      const v = row[x] as T;
      const k = rleKey(v);
      if (hasPrev && k === prevKey) {
        run++;
      } else {
        if (hasPrev) {
          rle.push(prev as T, run as unknown as T);
        }
        prev = v;
        prevKey = k;
        hasPrev = true;
        run = 1;
      }
    }
  }
  if (hasPrev) rle.push(prev as T, run as unknown as T);
  return { width, height, rle };
}

/**
 * Canonical key for RLE deduping. Primitives stringify to themselves;
 * objects/arrays go through `canonicalJsonKey` for stable, key-order-
 * independent comparison.
 */
function rleKey(value: unknown): string {
  if (value === null) return "n";
  const t = typeof value;
  if (t === "number" || t === "boolean") return t[0] + String(value);
  if (t === "string") return "s" + (value as string);
  if (t === "undefined") return "u";
  return "o" + canonicalJsonKey(value);
}

function canonicalJsonKey(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) {
    return "[" + value.map(canonicalJsonKey).join(",") + "]";
  }
  const keys = Object.keys(value as Record<string, unknown>).sort();
  return (
    "{" +
    keys
      .map((k) => JSON.stringify(k) + ":" + canonicalJsonKey((value as Record<string, unknown>)[k]))
      .join(",") +
    "}"
  );
}

/**
 * Normalise a `GridField<T>` into the nested-array shape. Pass-
 * through for legacy arrays; unrolls the RLE wire form via
 * `decodeRleGrid`. `undefined` returns `undefined` so optional grids
 * (`floors` / `ceilings`) keep their absence semantics.
 */
export function normaliseGridField<T>(field: GridField<T> | undefined): T[][] | undefined {
  if (field === undefined) return undefined;
  if (Array.isArray(field)) return field as T[][];
  return decodeRleGrid(field);
}

/* --- Layer-array input format ------------------------------------------- */

/**
 * Floor/ceiling cells are authored as a compact underscore-separated spec:
 *
 *   `"tile_reflectivenessPercent_transitionPercent"`
 *
 * - `"2_050_030"` → tile `2`, reflectiveness `0.50`, transition `0.30`
 * - `"2_050"`     → tile `2`, reflectiveness `0.50`, transition `0.00`
 * - `"2"`         → tile `2`, reflectiveness `0.00`, transition `0.00`
 * - `""`          → use the layer default (see `SceneOptions`)
 *
 * The 3-digit zero-padded percentage form keeps the scene grid aligned to
 * fixed-width columns so the level layout is readable as a literal.
 */
export type TileSpec = string;

/**
 * Structured authoring shape for floor / ceiling cells. The underscore
 * string form is preserved for hand-written maps; the object form is
 * the only way to attach an `emissive` because the underscore syntax
 * has no room for an RGB triple.
 */
export interface StructuredFloorSpec {
  /** Underscore spec for tile id / reflectiveness / transition, OR a bare tile id. */
  tile: TileSpec | number;
  reflectiveness?: number;
  transition?: number;
  emissive?: EmissiveSpec;
}

/**
 * One floor cell as authored. Strings carry the legacy compact spec;
 * objects carry the structured form (currently the only way to attach
 * `emissive`). `null` defers to the layer default.
 */
export type FloorCellInput = TileSpec | StructuredFloorSpec | null | undefined;
/** Same as `FloorCellInput` — ceilings use the same shape today. */
export type CeilingCellInput = FloorCellInput;

/** Per-layer defaults applied to empty cells (`""` or missing). */
export interface SceneOptions {
  defaultFloor?: FloorData;
  defaultCeiling?: FloorData;
}

const DEFAULT_FLOOR: FloorData = { tile: 2, reflectiveness: 0, transition: 0 };
const DEFAULT_CEILING: CeilingData = { tile: 3, reflectiveness: 0, transition: 0 };

const EMPTY_CELL: Cell = Object.freeze({
  wall: 0,
  walls: Object.freeze([]) as ReadonlyArray<WallSegment>,
  floor: Object.freeze({ tile: 0, reflectiveness: 0, transition: 0 }),
  ceiling: Object.freeze({ tile: 0, reflectiveness: 0, transition: 0 }),
}) as Cell;

/**
 * Build a single full-cell wall segment from a legacy tile id. Face is
 * arbitrary — for a full-extent wall the DDA side already decides which
 * edge the ray crossed, so `face: "N"` is just a placeholder until Phase 3
 * starts honouring partial widths.
 */
function legacyFullWall(tile: number): WallSegment {
  return {
    tile,
    startZ: 0,
    height: 1,
    offsetX: 0,
    offsetY: 0,
    face: "N",
    startU: 0,
    widthU: 1,
  };
}

/**
 * What a single cell's wall column can look like in the input data:
 *
 *  - `number`              — legacy shorthand. `0` = open, anything else
 *                            = full-height single wall using that tile.
 *  - `WallSegmentInput`    — one structured slab (fields default sensibly
 *                            so authoring stays terse).
 *  - `WallSegmentInput[]`  — multiple slabs in the same cell.
 *  - `null | undefined`    — open cell.
 */
export type WallCellInput =
  | number
  | WallSegmentInput
  | ReadonlyArray<WallSegmentInput>
  | null
  | undefined;

/** Authoring shape — every field except `tile` has a default. */
export interface WallSegmentInput {
  tile: number;
  startZ?: number;
  height?: number;
  offsetX?: number;
  offsetY?: number;
  face?: WallFace;
  startU?: number;
  widthU?: number;
  /** Texture for the top horizontal surface. Defaults to `tile`. */
  topTile?: number;
  /** Texture for the bottom horizontal surface. Defaults to `tile`. */
  bottomTile?: number;
  /**
   * Optional emissive. Forwarded verbatim to the runtime `WallSegment`.
   * See `EmissiveSpec` and LIGHTING_OVERHAUL.md § 3.2.
   */
  emissive?: EmissiveSpec;
}

/** Normalise one cell's input into the renderer-ready `WallSegment[]`. */
function parseWallCell(input: WallCellInput): ReadonlyArray<WallSegment> {
  if (input === null || input === undefined) return [];
  if (typeof input === "number") {
    return input === 0 ? [] : [legacyFullWall(input)];
  }
  if (Array.isArray(input)) {
    const out: WallSegment[] = [];
    for (const seg of input) out.push(normaliseSegment(seg));
    return out;
  }
  return [normaliseSegment(input as WallSegmentInput)];
}

function normaliseSegment(seg: WallSegmentInput): WallSegment {
  return {
    tile: seg.tile,
    startZ: seg.startZ ?? 0,
    height: seg.height ?? 1,
    offsetX: seg.offsetX ?? 0,
    offsetY: seg.offsetY ?? 0,
    face: seg.face ?? "N",
    startU: seg.startU ?? 0,
    widthU: seg.widthU ?? 1,
    topTile: seg.topTile,
    bottomTile: seg.bottomTile,
    emissive: seg.emissive,
  };
}

/**
 * Parse a `"tile_reflectivenessPercent_transitionPercent"` spec into a
 * `FloorData`-shaped object. Trailing fields are optional and default to
 * zero. Empty / malformed specs fall through to `fallback`.
 */
function parseTileSpec(spec: TileSpec | undefined, fallback: FloorData): FloorData {
  if (!spec) return fallback;
  // Trim so all-whitespace specs (used as column padding in the scene
  // literal) fall through to the layer default.
  const trimmed = spec.trim();
  if (!trimmed) return fallback;

  const parts = trimmed.split("_");
  const tileRaw = Number(parts[0]);
  const reflRaw = parts[1] !== undefined && parts[1] !== "" ? Number(parts[1]) / 100 : 0;
  const transRaw = parts[2] !== undefined && parts[2] !== "" ? Number(parts[2]) / 100 : 0;

  return {
    tile: Number.isFinite(tileRaw) ? tileRaw : fallback.tile,
    reflectiveness: Number.isFinite(reflRaw) ? Math.max(0, Math.min(1, reflRaw)) : 0,
    transition: Number.isFinite(transRaw) ? Math.max(0, Math.min(1, transRaw)) : 0,
  };
}

/**
 * Normalise a `FloorCellInput` (string spec OR structured object) into
 * the renderer-ready `FloorData`. Empty / nullish inputs return
 * `fallback` so blank cells still render the layer default. The
 * underscore-string form is parsed by `parseTileSpec`; the structured
 * form passes its fields through directly and is the only carrier for
 * `emissive`.
 */
function parseFloorCell(
  input: FloorCellInput,
  fallback: FloorData,
): FloorData {
  if (input === null || input === undefined) return fallback;
  if (typeof input === "string") return parseTileSpec(input, fallback);
  // Structured form. `tile` may itself be the underscore spec; route it
  // through `parseTileSpec` to inherit the same parsing so authors don't
  // lose the compact syntax when they need an `emissive` field.
  const base =
    typeof input.tile === "string"
      ? parseTileSpec(input.tile, fallback)
      : { tile: input.tile, reflectiveness: 0, transition: 0 };
  const reflectiveness =
    input.reflectiveness !== undefined
      ? Math.max(0, Math.min(1, input.reflectiveness))
      : base.reflectiveness;
  const transition =
    input.transition !== undefined
      ? Math.max(0, Math.min(1, input.transition))
      : base.transition;
  return {
    tile: base.tile,
    reflectiveness,
    transition,
    emissive: input.emissive,
  };
}

/**
 * A tile-based level for the raycaster.
 *
 * Authored as three parallel layer arrays — walls, floors, ceilings — and
 * compiled into a `Cell[][]` grid at construction. The internal `Cell` form
 * is what the renderers consume; the layered input is purely for human
 * readability.
 */
export class Scene {
  readonly grid: SceneGrid;
  /** Grid dimensions in tiles: `(width, height)`. */
  readonly size: Vec2;
  /**
   * Scene-controller declaration parsed from the scene JSON's
   * `controller` block (WORLD_STATE.md §5.2 + §6.2). The engine
   * spawns a synthetic controller entity at scene-load and attaches
   * `controller.components` to it; pack scripts read the live values
   * via `api.sceneController.components`. Always present — scenes
   * without a `controller` block get an empty components map (the
   * synthetic entity still spawns so `api.scene.controller.id` is
   * always valid).
   */
  readonly controller: { components: Readonly<Record<string, unknown>> };
  /**
   * Per-scene entity records — pre-flattened component bundles the
   * engine spawns at scene-load. PREFABS_EDITOR_ONLY.md §4.1. Empty
   * array when the scene JSON omits `entities`.
   */
  readonly entities: ReadonlyArray<SceneEntityJSON>;
  /** Authored static light sources (post-default-normalised). */
  readonly lights: ReadonlyArray<Required<LightDef>>;
  /**
   * Per-cell-corner RGB lightmap. When the scene JSON doesn't ship a
   * bake, this is a uniform-1.0 fallback so legacy scenes appear
   * fully lit. Both renderers sample bilinearly via `sampleLight`.
   */
  readonly lightmap: SceneLightmap;
  /**
   * Scene-level shader-hook overrides (M3 of MATERIALS.md §9).
   * Layered on top of pack-level hooks to form variant 0 for THIS
   * scene; per-entity / per-preset variants (M1 + M2) build on top.
   * `undefined` (default) means the scene contributes no overrides
   * and variant 0 is the pure pack default — byte-identical to
   * pre-M3 rendering.
   */
  readonly shaders?: ShaderData;

  constructor(
    walls: ReadonlyArray<ReadonlyArray<WallCellInput>>,
    floors: ReadonlyArray<ReadonlyArray<FloorCellInput>> = [],
    ceilings: ReadonlyArray<ReadonlyArray<CeilingCellInput>> = [],
    options: SceneOptions = {},
    lights: ReadonlyArray<LightDef> = [],
    lightmap: SceneLightmap | undefined = undefined,
    shaders: ShaderData | undefined = undefined,
    /**
     * Per-cell preset ids — `cellPresets[y][x] = { wall?, floor?,
     * ceiling? }`. Populated by `Scene.fromJSON` when the scene used
     * `idMap` resolution; absent / sparse for legacy bare-int scenes.
     * Wired into each `Cell.{wall|floor|ceiling}PresetId` so the
     * WebGL renderer can map cells to world-shader variants (M2).
     */
    cellPresets: ReadonlyArray<ReadonlyArray<CellPresetIds | undefined>> | undefined = undefined,
    /**
     * Pre-resolved scene-controller components (WORLD_STATE.md §5.2).
     * When omitted, the controller's components map is empty. Pack
     * scripts that need a per-scene SpawnerList declare it in the
     * scene JSON's `controller.components.SpawnerList` block.
     */
    controllerComponents: Readonly<Record<string, unknown>> | undefined = undefined,
    /**
     * Per-scene entity records — pre-flattened component bundles the
     * engine spawns at scene-load (`PREFABS_EDITOR_ONLY.md` §4.1).
     */
    entities: ReadonlyArray<SceneEntityJSON> = [],
  ) {
    this.shaders = shaders;
    this.entities = entities;
    this.controller = {
      components: controllerComponents ?? Object.freeze({}),
    };
    const defaultFloor = options.defaultFloor ?? DEFAULT_FLOOR;
    const defaultCeiling = options.defaultCeiling ?? DEFAULT_CEILING;

    const height = walls.length;
    const width = walls[0]?.length ?? 0;
    this.size = new Vec2(width, height);

    this.lights = lights.map((l) => normaliseLight(l));
    this.lightmap = lightmap ?? makeUniformLightmap(width, height);

    const grid: Cell[][] = new Array(height);
    for (let y = 0; y < height; y++) {
      const wallRow = walls[y]!;
      const floorRow = floors[y] ?? [];
      const ceilRow = ceilings[y] ?? [];
      const presetRow = cellPresets?.[y];
      const row: Cell[] = new Array(width);
      for (let x = 0; x < width; x++) {
        const segments = parseWallCell(wallRow[x]);
        const presets = presetRow?.[x];
        row[x] = {
          wall: segments[0]?.tile ?? 0,
          walls: segments,
          floor: parseFloorCell(floorRow[x], defaultFloor),
          ceiling: parseFloorCell(ceilRow[x], defaultCeiling),
          wallPresetId: presets?.wall,
          floorPresetId: presets?.floor,
          ceilingPresetId: presets?.ceiling,
        };
      }
      grid[y] = row;
    }
    this.grid = grid;
  }

  /**
   * Cell at the given grid coordinate, or a frozen empty cell if out of
   * bounds. Returning a default keeps callers simple — they don't have to
   * null-check before reading `.floor` / `.ceiling` etc.
   */
  getCell(x: number, y: number): Cell {
    return this.grid[y]?.[x] ?? EMPTY_CELL;
  }

  /** `true` when the cell at `(x, y)` has a wall (non-zero `wall` id). */
  isWall(x: number, y: number): boolean {
    return this.getCell(x, y).wall !== 0;
  }

  /**
   * `true` when the cell at `(x, y)` has a wall that fully spans
   * `z ∈ [0, 1]` — i.e. a full-height occluder. Partial-height walls
   * (knee walls, hanging headers) return `false` because they don't
   * actually block the line of sight to the floor / ceiling of their
   * cell.
   */
  isFullOccluder(x: number, y: number): boolean {
    const seg = this.getCell(x, y).walls[0];
    if (seg === undefined) return false;
    return seg.startZ <= 0 && seg.startZ + seg.height >= 1;
  }

  /**
   * `true` when the cell's wall reaches the floor (`startZ <= 0`). Used
   * by the floor-AO pass — a knee wall meets the floor at its base so
   * it should cast the same contact shadow on the neighbour floor as a
   * full wall does. A hanging header (floating above the floor) returns
   * `false` because it doesn't touch the floor and shouldn't shadow it.
   */
  isFloorOccluder(x: number, y: number): boolean {
    const seg = this.getCell(x, y).walls[0];
    if (seg === undefined) return false;
    return seg.startZ <= 0;
  }

  /**
   * `true` when the cell's wall reaches the ceiling (`startZ + height >=
   * 1`). Symmetric to `isFloorOccluder` — a hanging header should
   * shadow the neighbour ceiling, a knee wall shouldn't.
   */
  isCeilingOccluder(x: number, y: number): boolean {
    const seg = this.getCell(x, y).walls[0];
    if (seg === undefined) return false;
    return seg.startZ + seg.height >= 1;
  }

  /** Wall texture id at `(x, y)`, or `0` if empty. */
  wallTile(x: number, y: number): number {
    return this.getCell(x, y).wall;
  }

  /**
   * `true` when a player whose body occupies `z ∈ [0, headZ]` can pass
   * through the cell at `(x, y)`. Blocked when any wall segment overlaps
   * the body z range. A hanging header at `startZ = 0.6` is passable
   * for a crouched player (`headZ ≈ 0.4`) but blocks standing.
   */
  canPlayerPass(x: number, y: number, headZ: number): boolean {
    const segs = this.getCell(x, y).walls;
    for (let i = 0; i < segs.length; i++) {
      const seg = segs[i]!;
      // Body [0, headZ] overlaps wall [startZ, startZ+height] when
      // startZ < headZ (wall starts below head) AND startZ + height > 0
      // (wall extends above feet — always true for sensible walls).
      if (seg.startZ < headZ) return false;
    }
    return true;
  }

  /**
   * Available headroom in cell `(x, y)` — the lowest `startZ` of any
   * wall in the cell, or `1.0` when nothing hangs from above. A player
   * standing in this cell can have their head reach this z without
   * clipping into a wall. Used to cap stand-up height under hanging
   * headers.
   */
  maxHeadroom(x: number, y: number): number {
    const segs = this.getCell(x, y).walls;
    let minStartZ = 1;
    for (let i = 0; i < segs.length; i++) {
      const z = segs[i]!.startZ;
      if (z < minStartZ) minStartZ = z;
    }
    return minStartZ;
  }

  /** `true` when the integer grid coordinate is inside the scene bounds. */
  contains(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < this.size.x && y < this.size.y;
  }

  /**
   * Bilinearly sample the static lightmap at world position `(wx, wy)`.
   * Out `r`, `g`, `b` written into the provided `out` triple. Writing
   * to a caller-supplied buffer avoids per-pixel allocation on the
   * canvas2d backend's hot loops.
   *
   * Out-of-bounds samples clamp to the edge corner so distant floor
   * pixels at the scene boundary don't go pitch black.
   */
  /**
   * Bilinear sample of the FLOOR lightmap at world `(wx, wy)`. Used by
   * floor pixels, wall slab pixels, and bottom-cap pixels (all of which
   * sit at or near z=0 where blockers like knee walls actually shadow).
   */
  sampleFloorLight(wx: number, wy: number, out: [number, number, number]): void {
    this.sampleLightmap(this.lightmap.floorRGB, wx, wy, out);
  }

  /**
   * Bilinear sample of the CEILING lightmap at world `(wx, wy)`. Used by
   * ceiling pixels and top-cap pixels (where partial walls below the
   * ceiling-z don't cast shadows).
   */
  sampleCeilingLight(wx: number, wy: number, out: [number, number, number]): void {
    this.sampleLightmap(this.lightmap.ceilingRGB, wx, wy, out);
  }

  /** Shared bilinear interpolation for either lightmap grid. */
  private sampleLightmap(
    data: Float32Array,
    wx: number,
    wy: number,
    out: [number, number, number],
  ): void {
    // K-factor (sub-cell sample density): when > 1, every world unit
    // is sliced into K corner samples on each axis. The bilinear math
    // is unchanged; we just scale the world coords up by K before the
    // floor / fract split so the integer grid lines align with the
    // higher-resolution sample points.
    const K = this.lightmap.resolution;
    const W = this.size.x * K;
    const H = this.size.y * K;
    let cx = wx * K;
    let cy = wy * K;
    // Corners live at integer (x, y) of the SCALED grid. For world
    // (wx, wy) the bilinear weights come from fract of the scaled
    // coordinate. Clamp to scene bounds so out-of-bounds pixels at
    // the perimeter don't go pitch black.
    if (cx < 0) cx = 0;
    else if (cx > W) cx = W;
    if (cy < 0) cy = 0;
    else if (cy > H) cy = H;
    const x0 = Math.floor(cx);
    const y0 = Math.floor(cy);
    const x1 = Math.min(x0 + 1, W);
    const y1 = Math.min(y0 + 1, H);
    const fx = cx - x0;
    const fy = cy - y0;
    const stride = (W + 1) * 3;
    const i00 = y0 * stride + x0 * 3;
    const i10 = y0 * stride + x1 * 3;
    const i01 = y1 * stride + x0 * 3;
    const i11 = y1 * stride + x1 * 3;
    const w00 = (1 - fx) * (1 - fy);
    const w10 = fx * (1 - fy);
    const w01 = (1 - fx) * fy;
    const w11 = fx * fy;
    out[0] = data[i00]! * w00 + data[i10]! * w10 + data[i01]! * w01 + data[i11]! * w11;
    out[1] =
      data[i00 + 1]! * w00 +
      data[i10 + 1]! * w10 +
      data[i01 + 1]! * w01 +
      data[i11 + 1]! * w11;
    out[2] =
      data[i00 + 2]! * w00 +
      data[i10 + 2]! * w10 +
      data[i01 + 2]! * w01 +
      data[i11 + 2]! * w11;
  }

  /**
   * Parse a scene from the JSON shape used inside asset packs.
   * Equivalent to the `new Scene(walls, floors, ceilings, options, spawn)`
   * constructor — JSON keys map straight to the constructor args.
   *
   * When `data.idMap` is present the grids carry small ints that
   * resolve through the resolver to preset ids → renderer tile ids.
   * Legacy grids (no `idMap`) skip the resolver and parse exactly as
   * before.
   */
  static fromJSON(
    data: SceneJSON,
    options: SceneOptions = {},
    resolver?: PresetResolver,
  ): Scene {
    const lightmap = data.lightmap ? decodeLightmap(data.lightmap) : undefined;

    // ── RLE auto-detect ────────────────────────────────────────────
    // Scene grids accept either the legacy nested-row form or the
    // run-length-encoded wire form (see `RleGrid` / `decodeRleGrid`).
    // Unroll once here so the rest of the loader — idMap translation,
    // bake-time emissive collection, constructor — keeps working with
    // the nested-array shape unchanged.
    const wallsRaw = normaliseGridField(data.walls as GridField<unknown>) as unknown[][];
    const floorsRaw = normaliseGridField(
      data.floors as GridField<unknown> | undefined,
    ) as unknown[][] | undefined;
    const ceilingsRaw = normaliseGridField(
      data.ceilings as GridField<unknown> | undefined,
    ) as unknown[][] | undefined;

    // ── idMap fast path ────────────────────────────────────────────
    // When the scene declares an idMap, every cell is a small int that
    // resolves to a preset id. We translate each grid into the
    // existing WallCellInput / FloorCellInput shape the Scene
    // constructor already accepts — no runtime changes downstream.
    let walls = wallsRaw as WallCellInput[][];
    let floors = (floorsRaw ?? []) as FloorCellInput[][];
    let ceilings = (ceilingsRaw ?? []) as CeilingCellInput[][];
    // Per-cell preset id grid — M2 of MATERIALS.md uses this to map
    // each cell to its world-shader variant id. Sparse: only cells
    // resolved via `idMap` have entries; legacy scenes pass `undefined`.
    let cellPresets: (CellPresetIds | undefined)[][] | undefined;
    if (data.idMap && resolver) {
      const lookup = (idx: unknown): string | null => {
        // Tolerate either string or number keys in the source map.
        if (idx === null || idx === undefined) return null;
        if (typeof idx === "number") {
          if (idx === 0) return null;
          return data.idMap![String(idx)] ?? null;
        }
        if (typeof idx === "string") return data.idMap![idx] ?? null;
        return null;
      };
      walls = (wallsRaw as Array<Array<number | WallCellInput>>).map((row) =>
        row.map((cell) => translateWallCell(cell, lookup, resolver)),
      );
      const floorDefault = data.layerDefaults?.floor ?? null;
      const ceilingDefault = data.layerDefaults?.ceiling ?? null;
      floors = ((floorsRaw as Array<Array<number | FloorCellInput>>) ?? []).map((row) =>
        row.map((cell) => translateFloorCell(cell, lookup, resolver, floorDefault)),
      );
      ceilings = ((ceilingsRaw as Array<Array<number | CeilingCellInput>>) ?? []).map(
        (row) => row.map((cell) => translateFloorCell(cell, lookup, resolver, ceilingDefault)),
      );

      // Capture per-cell preset ids alongside the cell-translation
      // pass above. We re-walk the raw grids — cheap (small int
      // lookups) — and keep the translation logic above unchanged.
      const wallRowsRaw = wallsRaw as Array<Array<number | WallCellInput>>;
      const floorRowsRaw = (floorsRaw as Array<Array<number | FloorCellInput>>) ?? [];
      const ceilRowsRaw = (ceilingsRaw as Array<Array<number | CeilingCellInput>>) ?? [];
      cellPresets = wallRowsRaw.map((wallRow, y) => {
        const floorRow = floorRowsRaw[y] ?? [];
        const ceilRow = ceilRowsRaw[y] ?? [];
        return wallRow.map((wallCell, x) => {
          const ids: CellPresetIds = {};
          if (typeof wallCell === "number" && wallCell !== 0) {
            const id = lookup(wallCell);
            if (id) ids.wall = id;
          }
          const floorCell = floorRow[x];
          if (typeof floorCell === "number" && floorCell !== 0) {
            const id = lookup(floorCell);
            if (id) ids.floor = id;
          } else if (floorCell === 0 && floorDefault) {
            ids.floor = floorDefault;
          }
          const ceilCell = ceilRow[x];
          if (typeof ceilCell === "number" && ceilCell !== 0) {
            const id = lookup(ceilCell);
            if (id) ids.ceiling = id;
          } else if (ceilCell === 0 && ceilingDefault) {
            ids.ceiling = ceilingDefault;
          }
          return ids.wall !== undefined ||
            ids.floor !== undefined ||
            ids.ceiling !== undefined
            ? ids
            : undefined;
        });
      });
    }

    // WORLD_STATE.md §5.2 — read the scene-controller block verbatim
    // from JSON. When absent the constructor leaves the components map
    // empty (the synthetic controller entity still spawns so
    // `api.scene.controller.id` is always valid).
    const controllerComponents =
      data.controller?.components !== undefined
        ? Object.freeze({ ...data.controller.components })
        : undefined;

    return new Scene(
      walls,
      floors,
      ceilings,
      options,
      data.lights ?? [],
      lightmap,
      data.shaders,
      cellPresets,
      controllerComponents,
      data.entities ?? [],
    );
  }
}

/**
 * Translate one `walls[y][x]` value through the resolver.
 *
 * - Small int → idMap[idx] → preset → WallSegmentInput
 * - Inline WallSegment object → HARD ERROR (per TILE_PRESETS.md §5.3
 *   T3 — mixing idMap with inlined cell structs is the deprecated
 *   middle state; pure legacy bare-int scenes without idMap still work
 *   via the legacy shim).
 *
 * Unknown ids fall through to `null` (open cell) after warning.
 */
function translateWallCell(
  cell: number | WallCellInput,
  lookup: (idx: unknown) => string | null,
  resolver: PresetResolver,
): WallCellInput {
  if (cell === null || cell === undefined) return null;
  if (typeof cell === "object") {
    throw new Error(
      `[scene] idMap-bearing scene contains an inline WallSegment object — mixing idMap references with inline cell structs is not allowed (TILE_PRESETS.md §5.3). Move the cell to a named or anonymous preset and reference it via idMap, or drop idMap to fall back to the legacy bare-int format.`,
    );
  }
  if (typeof cell !== "number") return null;
  if (cell === 0) return 0;
  const presetId = lookup(cell);
  if (!presetId) return 0;
  const data = resolver.resolveCell(presetId);
  if (!data) {
    console.warn(`[scene] idMap references unknown preset "${presetId}" — rendering as open cell`);
    return 0;
  }
  return wallInputFromPreset(data, resolver);
}

function translateFloorCell(
  cell: number | FloorCellInput,
  lookup: (idx: unknown) => string | null,
  resolver: PresetResolver,
  defaultPresetId: string | null,
): FloorCellInput {
  if (cell === null || cell === undefined) return null;
  if (typeof cell === "object") {
    throw new Error(
      `[scene] idMap-bearing scene contains an inline floor/ceiling object — mixing idMap references with inline cell structs is not allowed (TILE_PRESETS.md §5.3). Move the cell to a preset and reference it via idMap.`,
    );
  }
  if (typeof cell === "string") return cell;
  if (typeof cell !== "number") return null;
  // `0` resolves to the layer default preset (if any), else "use layer default".
  let presetId: string | null;
  if (cell === 0) {
    if (!defaultPresetId) return undefined;
    presetId = defaultPresetId;
  } else {
    presetId = lookup(cell);
  }
  if (!presetId) return undefined;
  const data = resolver.resolveCell(presetId);
  if (!data) {
    console.warn(`[scene] idMap references unknown preset "${presetId}" — using layer default`);
    return undefined;
  }
  return floorInputFromPreset(data, resolver);
}

/**
 * Reduce a resolved preset to the `WallSegmentInput` shape the Scene
 * constructor consumes. Texture paths are reverse-looked-up against
 * `manifest.tileTextures` to recover the renderer's tile id; an
 * unmapped texture warns + falls back to tile id `0` (transparent
 * pink — the renderer's default-color path).
 */
function wallInputFromPreset(
  data: ResolvedPresetData,
  resolver: PresetResolver,
): WallSegmentInput {
  const tile = resolver.tileIdForTexture(data.texture);
  if (tile === undefined) {
    console.warn(`[scene] preset texture "${data.texture}" is not in manifest.tileTextures`);
  }
  const topTile = data.topCap ? resolver.tileIdForTexture(data.topCap) : undefined;
  const bottomTile = data.bottomCap ? resolver.tileIdForTexture(data.bottomCap) : undefined;
  const seg: WallSegmentInput = {
    tile: tile ?? 0,
    startZ: data.wallStartZ,
    height: data.wallHeight,
    offsetX: data.offsetX,
    offsetY: data.offsetY,
  };
  if (data.partialWall) {
    seg.face = facePresetToShort(data.partialWall.face);
    seg.startU = data.partialWall.startU;
    seg.widthU = data.partialWall.widthU;
  }
  if (topTile !== undefined) seg.topTile = topTile;
  if (bottomTile !== undefined) seg.bottomTile = bottomTile;
  if (data.emissive) {
    seg.emissive = {
      color: data.emissive.color,
      intensity: data.emissive.intensity,
      areaLight: data.emissive.areaLight,
    };
  }
  return seg;
}

function floorInputFromPreset(
  data: ResolvedPresetData,
  resolver: PresetResolver,
): FloorCellInput {
  const tile = resolver.tileIdForTexture(data.texture);
  if (tile === undefined) {
    console.warn(`[scene] preset texture "${data.texture}" is not in manifest.tileTextures`);
  }
  return {
    tile: tile ?? 0,
    reflectiveness: data.reflectiveness,
    transition: data.transition,
    emissive: data.emissive
      ? {
          color: data.emissive.color,
          intensity: data.emissive.intensity,
          areaLight: data.emissive.areaLight,
        }
      : undefined,
  };
}

function facePresetToShort(face: "north" | "south" | "east" | "west"): WallFace {
  switch (face) {
    case "north": return "N";
    case "south": return "S";
    case "east": return "E";
    case "west": return "W";
  }
}

/** Fill in light defaults so renderers can read fields directly. */
function normaliseLight(l: LightDef): Required<LightDef> {
  return {
    x: l.x,
    y: l.y,
    z: l.z ?? 0.5,
    color: l.color ?? [1, 1, 1],
    intensity: l.intensity ?? 1,
    radius: l.radius ?? 6,
  };
}

/** Build a uniform-1.0 lightmap for scenes that don't ship a bake. */
function makeUniformLightmap(width: number, height: number): SceneLightmap {
  // K=1 is the simplest grid we can synthesise; renderers and the
  // bilinear sampler both branch on `resolution` and degenerate
  // cleanly to the legacy per-corner layout when it's 1.
  const len = (width + 1) * (height + 1) * 3;
  const floorRGB = new Float32Array(len);
  const ceilingRGB = new Float32Array(len);
  floorRGB.fill(1);
  ceilingRGB.fill(1);
  return { width, height, resolution: 1, floorRGB, ceilingRGB };
}

/**
 * Decode a base64 lightmap blob from the scene JSON. Exposed so the
 * editor can decode `scene.lightmap` directly (e.g. to feed the
 * CellPreview's baked-lighting source) without round-tripping a full
 * `Scene.fromJSON` build.
 */
export function decodeLightmap(json: SceneLightmapJSON): SceneLightmap {
  // Back-compat: bakes from before the super-sampling change have no
  // `resolution` field. Treat them as the legacy 1-sample-per-corner
  // grid (K=1) so old packs keep rendering without re-baking.
  const K = json.resolution ?? 1;
  const expectedFloats = (json.width * K + 1) * (json.height * K + 1) * 3;
  const expectedBytes = expectedFloats * 4;

  // Back-compat: if only the legacy single `cornerRGB` is present, use
  // it for both floor and ceiling so older bakes keep rendering.
  const haveSplit = json.floorRGB !== undefined || json.ceilingRGB !== undefined;
  const haveLegacy = json.cornerRGB !== undefined;

  const decode = (b64: string | undefined): Float32Array | null => {
    if (b64 === undefined) return null;
    const bytes = base64ToBytes(b64);
    if (bytes.byteLength !== expectedBytes) {
      console.warn(
        `Lightmap size mismatch: expected ${expectedBytes} bytes, got ${bytes.byteLength}.` +
          " Falling back to uniform 1.0 for this grid.",
      );
      const u = new Float32Array(expectedFloats);
      u.fill(1);
      return u;
    }
    // Float32Array views must be aligned; copy into a fresh buffer.
    const buf = new ArrayBuffer(bytes.byteLength);
    new Uint8Array(buf).set(bytes);
    return new Float32Array(buf);
  };

  if (haveSplit) {
    const floor = decode(json.floorRGB);
    const ceiling = decode(json.ceilingRGB);
    const fallback = new Float32Array(expectedFloats);
    fallback.fill(1);
    return {
      width: json.width,
      height: json.height,
      resolution: K,
      floorRGB: floor ?? fallback,
      ceilingRGB: ceiling ?? fallback,
    };
  }
  if (haveLegacy) {
    const legacy = decode(json.cornerRGB);
    if (legacy) {
      return {
        width: json.width,
        height: json.height,
        resolution: K,
        floorRGB: legacy,
        ceilingRGB: legacy, // share — old bakes assumed a single grid
      };
    }
  }
  return makeUniformLightmap(json.width, json.height);
}

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/**
 * The JSON wire format for scenes inside asset packs. Mirrors the
 * `Scene` constructor's argument shape so the round trip is just
 * `JSON.parse` → `Scene.fromJSON`.
 *
 * `walls` accepts both forms:
 *
 *   - **Legacy shorthand** — `number[][]`. `0` = open, `>0` = full-height
 *     wall using that tile id. Every existing scene file works unchanged.
 *   - **Structured** — `WallCellInput[][]` where each cell is `null` /
 *     a tile id (shorthand) / one `WallSegmentInput` / an array of them.
 */
export interface SceneJSON {
  /**
   * Optional scene-local preset-id table. When present, every cell in
   * `walls`/`floors`/`ceilings` is read as a small int that resolves
   * through this map (Tiled `firstgid` pattern). `"0"` is reserved
   * for "no tile"; non-zero entries are preset IDs registered with the
   * pack's `PresetResolver`. See `docs/plans/TILE_PRESETS.md` § 4.
   *
   * When absent, the grids are parsed as today — bare ints (or full
   * structured `WallSegmentInput`/`StructuredFloorSpec` objects).
   */
  idMap?: Record<string, string | null>;
  /**
   * Optional per-layer default preset id. A cell value of `0` in a
   * `floors` / `ceilings` grid resolves to this preset instead of
   * "no tile". `walls` has no layer default — `0` always means open.
   */
  layerDefaults?: { floor?: string; ceiling?: string };
  /**
   * Wall grid. Two wire forms — auto-detected at load:
   *
   *   1. **Nested rows** (`T[][]`) — legacy hand-authored shape.
   *   2. **Run-length-encoded** (`{ width, height, rle: [...] }`) —
   *      compact storage form for pre-built scenes (default-pack,
   *      editor output). See `RleGrid` / `decodeRleGrid`.
   *
   * The engine unrolls the RLE form back to a nested array at
   * `Scene.fromJSON` time; everything downstream consumes nested rows
   * unchanged.
   */
  walls: GridField<WallCellInput | number>;
  /** Floor grid. Same dual wire form as `walls`. */
  floors?: GridField<FloorCellInput | number>;
  /** Ceiling grid. Same dual wire form as `walls`. */
  ceilings?: GridField<CeilingCellInput | number>;
  /**
   * Scene-controller block — WORLD_STATE.md §5.2 + §6.2. Carries the
   * per-scene component bundle attached to the synthetic controller
   * entity at scene-load. Optional — when missing the controller's
   * components map is empty (synthetic entity still spawns).
   */
  controller?: SceneControllerJSON;
  /**
   * Per-scene entity records — `PREFABS_EDITOR_ONLY.md` §4.1. Each
   * entry is a fully-flattened component bundle the engine walks at
   * scene-load to spawn entities. Optional — scenes without an
   * `entities` array spawn nothing here, and pack scripts are free to
   * spawn whatever they want from boot scripts / `onWorldReady`
   * handlers (the default-pack player today).
   */
  entities?: SceneEntityJSON[];
  /**
   * Static light sources to bake into the scene's lightmap at
   * `bun run build-packs` time. Each one contributes
   * `color × intensity × attenuation × visibility(LOS)` to the
   * cells within its `radius`.
   */
  lights?: LightDef[];
  /**
   * Baked lightmap output. Present only after the pack build step
   * runs `bake-lights`. When absent, the runtime synthesises a
   * uniform 1.0 lightmap so legacy scenes look fully lit.
   */
  lightmap?: SceneLightmapJSON;
  /**
   * Optional scene-level shader-hook overrides (M3 of MATERIALS.md
   * §9). Same shape as the `Shader` ECS component / pack-level
   * `manifest.shaders` — pack-relative paths to `.glsl` files
   * defining `hook_*` functions for any of the three roles.
   *
   * Scene-level overrides layer on top of pack-level (variant 0
   * for this scene) and underneath per-entity / per-preset variants
   * (M1 + M2). When absent (typical case for default-pack scenes),
   * variant 0 stays pure pack-default and rendering is byte-
   * identical to pre-M3.
   */
  shaders?: ShaderData;
}

/**
 * Static light source authoring shape. `z` is in [0, 1] world units
 * (0 = floor, 1 = ceiling). Defaults: `z = 0.5`, `color = [1, 1, 1]`,
 * `intensity = 1`, `radius = 6`.
 */
export interface LightDef {
  x: number;
  y: number;
  z?: number;
  color?: [number, number, number];
  intensity?: number;
  radius?: number;
}

/**
 * JSON wire format for a baked lightmap. Split into floor + ceiling
 * grids (Phase 4) because partial walls (knee walls, hanging headers)
 * block light differently at z=0 vs z=1 — sharing one grid made
 * ceilings inherit knee-wall shadows that shouldn't exist.
 *
 * Both fields are base64-encoded Float32Arrays of shape
 * `(height+1) × (width+1) × 3`. Bilinearly sampled at runtime.
 *
 * `cornerRGB` (legacy single grid) is parsed back-compat: when only
 * the old field is present, the loader uses it for BOTH `floorRGB`
 * and `ceilingRGB` — old scenes look unchanged.
 */
export interface SceneLightmapJSON {
  width: number;
  height: number;
  /**
   * K-factor: how many sub-samples per cell on each axis. The corner
   * grid shape is `(width * resolution + 1) × (height * resolution + 1)`.
   * Absent on legacy bakes — the decoder treats `undefined` as `1`
   * (one sample per cell corner, the original Phase 1-4 layout).
   * Default for new bakes is `4`, which gives 16× the spatial density
   * and visibly straightens / softens shadow edges.
   */
  resolution?: number;
  /** Floor-corner samples (z=0). New in Phase 4. */
  floorRGB?: string;
  /** Ceiling-corner samples (z=1). New in Phase 4. */
  ceilingRGB?: string;
  /** Legacy single grid — used for both floor + ceiling when present alone. */
  cornerRGB?: string;
}

/**
 * Runtime-decoded lightmap. `Scene.lightmap` always has one — either
 * decoded from JSON or a uniform-1.0 fallback for scenes without a
 * bake.
 */
export interface SceneLightmap {
  /** Cells along x. The corner grid is `(width * resolution + 1)` wide. */
  width: number;
  /** Cells along y. The corner grid is `(height * resolution + 1)` tall. */
  height: number;
  /**
   * K-factor: sub-samples per cell on each axis. `1` is the legacy
   * one-sample-per-corner layout; new bakes default to `4`, which
   * eliminates the visibly boxy shadow edges baked at K=1 because
   * the shadow boundary can now snap to a 1/K-wide gridline instead
   * of the full integer cell line. The bilinear sampler and shader
   * UV math both scale incoming world coords by `resolution`.
   */
  resolution: number;
  /**
   * Per-corner RGB at z=0, flat row-major. Index for corner
   * `(cx, cy)` (in scaled-grid units, 0..width*resolution) is
   * `(cy * (width * resolution + 1) + cx) * 3`. Sampled by floor /
   * wall / bottom-cap pixels.
   */
  floorRGB: Float32Array;
  /**
   * Per-corner RGB at z=1, same scaled-grid shape as `floorRGB`.
   * Sampled by ceiling / top-cap pixels.
   */
  ceilingRGB: Float32Array;
}


/**
 * Lightmap bake — engine-side home for the `bakeScene` algorithm.
 *
 * Phase 2 / Phase 4 of the lighting overhaul live here. Previously this
 * code lived in `apps/pack-builder/src/bake-lights.ts`; per
 * EDITOR.md Q11.2 it moved into the engine so BOTH the CLI build script
 * (`apps/pack-builder/src/build-packs.ts`) and the in-browser editor's
 * Web Worker (`apps/editor/src/workers/bake.worker.ts`) can call the
 * same code.
 *
 * The algorithm is unchanged from the original pack-builder version.
 * The only differences are:
 *
 *  - **No Node `Buffer`.** Base64 encoding uses a portable `btoa`-based
 *    path that works in browsers + Bun + Node ≥18.
 *  - **Optional `onProgress` callback.** Web-worker callers want to
 *    report progress to the UI; the CLI ignores it.
 *  - Intra-engine imports use the engine's bare-name path aliases
 *    (`"Scene"`, `"Libs/Vector"`) instead of `@two_5_d/engine`.
 *
 * See `docs/plans/EDITOR.md` §7 (bake workflow) and
 * `docs/plans/LIGHTING_OVERHAUL.md` for the user-facing model.
 */

import { Scene, normaliseGridField } from "Scene";
import { Vec2 } from "Libs/Vector";
import { castRayThroughWalls } from "Libs/Raycast";
import type {
  SceneJSON,
  LightDef,
  EmissiveSpec,
  WallSegmentInput,
  FloorCellInput,
  CeilingCellInput,
  WallCellInput,
  StructuredFloorSpec,
} from "Scene";

/** Same defaults as `Scene.ts#normaliseLight` — kept in sync by hand. */
const DEFAULT_Z = 0.5;
const DEFAULT_COLOR: readonly [number, number, number] = [1, 1, 1];
const DEFAULT_INTENSITY = 1;
const DEFAULT_RADIUS = 6;

/**
 * Default K (sub-samples per cell on each axis). 4 gives the corner
 * grid 4× the resolution per axis (16× the corner count) — enough
 * to align shadow edges with pillar silhouettes without ballooning
 * the JSON. See `BakeOpts.lightmapResolution`.
 */
const DEFAULT_LIGHTMAP_RESOLUTION = 4;
/**
 * Default jitter sample count for soft shadows. Sample 0 is the
 * light's nominal position; samples 1..N-1 use the deterministic
 * Halton-style offset table in `LIGHT_JITTER_OFFSETS`. The
 * contribution is averaged across all N — N=1 reproduces the
 * Phase 4 hard-shadow behaviour exactly.
 */
const DEFAULT_LIGHT_SUPERSAMPLE = 4;

/**
 * Fixed deterministic jitter offsets in `[-r, r]` on the XY plane
 * (r = `LIGHT_JITTER_RADIUS`). Slot 0 is the unjittered nominal
 * position; slots 1..7 sample a small Hammersley-ish disk around
 * it. We hard-code 8 entries because that's the largest reasonable
 * supersample count for a static bake; users requesting N > 8 wrap
 * around modulo 8 (still deterministic, no RNG).
 */
const LIGHT_JITTER_RADIUS = 0.05;
const LIGHT_JITTER_OFFSETS: ReadonlyArray<readonly [number, number]> = [
  [0, 0],
  [LIGHT_JITTER_RADIUS, 0],
  [-LIGHT_JITTER_RADIUS, 0],
  [0, LIGHT_JITTER_RADIUS],
  [0, -LIGHT_JITTER_RADIUS],
  [LIGHT_JITTER_RADIUS * 0.707, LIGHT_JITTER_RADIUS * 0.707],
  [-LIGHT_JITTER_RADIUS * 0.707, LIGHT_JITTER_RADIUS * 0.707],
  [LIGHT_JITTER_RADIUS * 0.707, -LIGHT_JITTER_RADIUS * 0.707],
];

/**
 * Default radius for auto-spawned area lights. Smaller than the user
 * default because emissive surfaces are short-range accents (a rune,
 * a glowing tile) rather than room-fill bulbs.
 */
const AREA_LIGHT_RADIUS = 4;
/**
 * Side length of the point-light grid used to approximate one
 * emissive surface (`AREA_LIGHT_SAMPLES × AREA_LIGHT_SAMPLES` total).
 */
const AREA_LIGHT_SAMPLES = 3;

export interface BakeStats {
  /** Total point-light contributions baked (user-declared + auto-spawned). */
  lights: number;
  /** User-declared lights from `scene.lights`. */
  userLights: number;
  /**
   * Point lights synthesised from emissive surfaces. One emissive
   * surface produces `AREA_LIGHT_SAMPLES²` point lights, so this is
   * `emissiveSurfaces × samples²`.
   */
  autoLights: number;
  /** Wall-clock milliseconds the bake took. */
  ms: number;
  /** Cell grid width — same as the input scene's `walls[0].length`. */
  width: number;
  /** Cell grid height — same as the input scene's `walls.length`. */
  height: number;
  /** K-factor actually used (post-budget downgrade — see `BakeOpts`). */
  resolution: number;
  /** Number of jitter samples per light, per corner (post-downgrade). */
  supersample: number;
}

/**
 * Bake-time tuning knobs. Both come from the pack manifest's
 * `lighting` block (`build-packs.ts` plumbs them through). Either
 * field may be omitted; defaults match
 * `DEFAULT_LIGHTMAP_RESOLUTION` / `DEFAULT_LIGHT_SUPERSAMPLE`.
 */
export interface BakeOpts {
  /** K-factor for the corner grid (sub-samples per cell on each axis). */
  lightmapResolution?: number;
  /** Jitter samples per light (one is averaged contribution). */
  supersample?: number;
  /**
   * Optional progress reporter — called periodically with a fraction
   * in `[0, 1]` so a Web Worker host can drive a progress bar. Phase
   * weighting: 0..0.5 is the floor grid, 0.5..1.0 is the ceiling
   * grid (the auto-downgrade pass overwrites the same range). Callers
   * who don't need progress reporting simply omit this.
   */
  onProgress?: (fraction: number) => void;
}

export interface BakeResult {
  scene: SceneJSON;
  stats: BakeStats;
}

/** Internal expanded form: defaults applied + a stable owner cell id. */
interface BakedLight {
  x: number;
  y: number;
  z: number;
  color: [number, number, number];
  intensity: number;
  radius: number;
  /**
   * Source-surface kind so the LOS self-shadow skip can be applied
   * surgically. `"floor"` sources skip blockers in their owner cell
   * (the runtime emissive add already paints the floor pixel, so
   * including the bake contribution would double-count near the
   * source). Ceiling and wall sources don't skip — they light a
   * different surface than they live on, so blockers in the owner
   * cell are legitimate. `null` for user-declared point lights.
   */
  source: "floor" | "ceiling" | "wall" | null;
  /** Owner cell for the skip predicate (undefined for user lights). */
  owner: { cx: number; cy: number } | null;
}

/**
 * Bake `scene` into a copy with `.lightmap` populated. Returns the
 * scene unchanged if there are no lights at all (user-declared OR
 * auto-spawned from emissive surfaces) — the runtime synthesises a
 * uniform-1.0 fallback in that case.
 *
 * `opts.lightmapResolution` (K) and `opts.supersample` (N) trade
 * bake time for shadow quality: cost scales `O(K² × N)`. Defaults
 * (K=4, N=4) bake the project's 12×12 demo in well under a second.
 * If the resulting bake exceeds the budget (`MAX_BUDGET_MS`), we
 * automatically downgrade to (K=2, N=2) and log a warning — see the
 * post-bake `tooSlow` branch.
 */
export function bakeScene(scene: SceneJSON, opts: BakeOpts = {}): BakeResult {
  // Auto-detect the wire form (legacy nested rows vs RLE wrapper)
  // and unroll up-front so the rest of bakeScene works with the
  // nested-array shape unchanged.
  const wallsArr = (normaliseGridField(scene.walls) ?? []) as WallCellInput[][];
  const floorsArr = normaliseGridField(scene.floors) as FloorCellInput[][] | undefined;
  const ceilingsArr = normaliseGridField(scene.ceilings) as
    | CeilingCellInput[][]
    | undefined;
  scene = { ...scene, walls: wallsArr, floors: floorsArr, ceilings: ceilingsArr };

  const W = wallsArr[0]?.length ?? 0;
  const H = wallsArr.length;

  let K = Math.max(1, Math.floor(opts.lightmapResolution ?? DEFAULT_LIGHTMAP_RESOLUTION));
  let N = Math.max(1, Math.floor(opts.supersample ?? DEFAULT_LIGHT_SUPERSAMPLE));
  const onProgress = opts.onProgress;

  // Build the combined light list FIRST so we know whether there's
  // any baking work to do at all.
  const userLights = (scene.lights ?? []).map((l) => normaliseUserLight(l));
  const autoLights = collectEmissiveLights(wallsArr, floorsArr, ceilingsArr, W, H);
  const allLights: BakedLight[] = [...userLights, ...autoLights];

  if (allLights.length === 0 || W === 0 || H === 0) {
    onProgress?.(1);
    return {
      scene,
      stats: {
        lights: 0,
        userLights: userLights.length,
        autoLights: autoLights.length,
        ms: 0,
        width: W,
        height: H,
        resolution: K,
        supersample: N,
      },
    };
  }

  // We need a `Scene` instance to call into the existing DDA helper.
  // Pass `lights: []` because we only care about the geometry; baking
  // shouldn't depend on the very lights we're computing.
  const sceneForLOS = Scene.fromJSON({ ...scene, lights: [], lightmap: undefined });

  // Bake TWO grids — floor corners at z=0, ceiling corners at z=1.
  const t0 = nowMs();
  let floorRGB = bakeGrid(sceneForLOS, allLights, W, H, 0, K, N, (f) =>
    onProgress?.(f * 0.5),
  );
  let ceilingRGB = bakeGrid(sceneForLOS, allLights, W, H, 1, K, N, (f) =>
    onProgress?.(0.5 + f * 0.5),
  );
  let ms = nowMs() - t0;

  // Budget guard — auto-downgrade if we blow past 5s.
  const MAX_BUDGET_MS = 5000;
  if (ms > MAX_BUDGET_MS && (K > 2 || N > 2)) {
    console.warn(
      `[bake-lights] scene bake hit ${ms.toFixed(0)} ms at K=${K}/N=${N};` +
        ` falling back to K=2/N=2 for budget.`,
    );
    K = Math.min(K, 2);
    N = Math.min(N, 2);
    const t1 = nowMs();
    floorRGB = bakeGrid(sceneForLOS, allLights, W, H, 0, K, N, (f) =>
      onProgress?.(f * 0.5),
    );
    ceilingRGB = bakeGrid(sceneForLOS, allLights, W, H, 1, K, N, (f) =>
      onProgress?.(0.5 + f * 0.5),
    );
    ms = nowMs() - t1;
  }

  const floorB64 = float32ToBase64(floorRGB);
  const ceilingB64 = float32ToBase64(ceilingRGB);

  const out: SceneJSON = {
    ...scene,
    lightmap: {
      width: W,
      height: H,
      resolution: K,
      floorRGB: floorB64,
      ceilingRGB: ceilingB64,
    },
  };

  onProgress?.(1);

  return {
    scene: out,
    stats: {
      lights: allLights.length,
      userLights: userLights.length,
      autoLights: autoLights.length,
      ms,
      width: W,
      height: H,
      resolution: K,
      supersample: N,
    },
  };
}

/**
 * Bake one corner grid at the given target z (0 for floor, 1 for
 * ceiling). See file header for math.
 *
 * `onRowProgress` (optional) is called once per scanline with a
 * fraction `0..1` of the grid completed. The bake step reports
 * progress at row granularity rather than per-corner so the cost is
 * one callback per `H*K` corners (~negligible).
 */
function bakeGrid(
  sceneForLOS: Scene,
  allLights: ReadonlyArray<BakedLight>,
  W: number,
  H: number,
  cornerZ: number,
  K: number,
  N: number,
  onRowProgress?: (fraction: number) => void,
): Float32Array {
  const gridW = W * K + 1;
  const gridH = H * K + 1;
  const stride = gridW * 3;
  const out = new Float32Array(gridW * gridH * 3);

  const invK = 1 / K;
  const invN = 1 / N;
  const totalRows = gridH;

  for (const L of allLights) {
    type JitterSample = { lx: number; ly: number; lightVec: Vec2 };
    const samples: JitterSample[] = [];
    for (let s = 0; s < N; s++) {
      const off = LIGHT_JITTER_OFFSETS[s % LIGHT_JITTER_OFFSETS.length]!;
      const lx = L.x + off[0];
      const ly = L.y + off[1];
      samples.push({ lx, ly, lightVec: new Vec2(lx, ly) });
    }

    for (let cy = 0; cy <= H * K; cy++) {
      const wy = cy * invK;
      for (let cx = 0; cx <= W * K; cx++) {
        const wx = cx * invK;
        let accR = 0;
        let accG = 0;
        let accB = 0;
        for (let s = 0; s < N; s++) {
          const samp = samples[s]!;
          const dx = wx - samp.lx;
          const dy = wy - samp.ly;
          const dHoriz2 = dx * dx + dy * dy;
          const dz = L.z - cornerZ;
          const d3 = Math.sqrt(dHoriz2 + dz * dz);
          if (d3 >= L.radius) continue;
          const dHoriz = Math.sqrt(dHoriz2);
          const t = 1 - d3 / L.radius;
          const atten = t * t;

          if (dHoriz <= 1e-6) {
            accR += L.color[0] * L.intensity * atten;
            accG += L.color[1] * L.intensity * atten;
            accB += L.color[2] * L.intensity * atten;
            continue;
          }

          const dirX = dx / dHoriz;
          const dirY = dy / dHoriz;
          const dirVec = new Vec2(dirX, dirY);
          const maxSteps = Math.ceil(Math.abs(dx) + Math.abs(dy)) + 4;
          const hits = castRayThroughWalls(sceneForLOS, samp.lightVec, dirVec, maxSteps);

          const cutoff = dHoriz - 0.001;

          let blocked = false;
          for (const hit of hits) {
            if (hit.perpDistance >= cutoff) break;
            if (
              L.source === "floor" &&
              L.owner !== null &&
              hit.cell.x === L.owner.cx &&
              hit.cell.y === L.owner.cy
            ) {
              continue;
            }
            const seg = hit.segment;
            const tParam = hit.perpDistance / dHoriz;
            const rayZ = L.z + (cornerZ - L.z) * tParam;
            if (rayZ >= seg.startZ && rayZ <= seg.startZ + seg.height) {
              blocked = true;
              break;
            }
          }
          if (blocked) continue;

          accR += L.color[0] * L.intensity * atten;
          accG += L.color[1] * L.intensity * atten;
          accB += L.color[2] * L.intensity * atten;
        }

        if (accR === 0 && accG === 0 && accB === 0) continue;
        const idx = cy * stride + cx * 3;
        out[idx]! += accR * invN;
        out[idx + 1]! += accG * invN;
        out[idx + 2]! += accB * invN;
      }
      if (onRowProgress && totalRows > 0) {
        // Aggregate light-row progress across all lights — fraction
        // of (totalLights × totalRows) completed.
        // The caller scales 0..1 to a phase window, so this fraction
        // need not be exact: report scanline-of-this-light only.
        onRowProgress(cy / totalRows);
      }
    }
  }

  return out;
}

/** Mirror of `Scene.ts#normaliseLight` for user-declared lights. */
function normaliseUserLight(l: LightDef): BakedLight {
  return {
    x: l.x,
    y: l.y,
    z: l.z ?? DEFAULT_Z,
    color: l.color ?? [DEFAULT_COLOR[0], DEFAULT_COLOR[1], DEFAULT_COLOR[2]],
    intensity: l.intensity ?? DEFAULT_INTENSITY,
    radius: l.radius ?? DEFAULT_RADIUS,
    source: null,
    owner: null,
  };
}

/**
 * Walk every cell once and synthesise area lights for emissive
 * surfaces whose `areaLight !== false`. Each emissive surface becomes
 * an `AREA_LIGHT_SAMPLES²` grid of point lights, each at 1/N² intensity.
 */
function collectEmissiveLights(
  walls: WallCellInput[][],
  floors: FloorCellInput[][] | undefined,
  ceilings: CeilingCellInput[][] | undefined,
  W: number,
  H: number,
): BakedLight[] {
  const out: BakedLight[] = [];
  if (W === 0 || H === 0) return out;

  const samples = AREA_LIGHT_SAMPLES;
  const inv = 1 / samples;
  const subIntensityScale = 1 / (samples * samples);

  for (let cy = 0; cy < H; cy++) {
    const wallRow = walls[cy] ?? [];
    const floorRow = floors?.[cy] ?? [];
    const ceilRow = ceilings?.[cy] ?? [];
    for (let cx = 0; cx < W; cx++) {
      const floorEm = readCellEmissive(floorRow[cx] as FloorCellInput);
      if (floorEm && floorEm.areaLight !== false) {
        for (let sy = 0; sy < samples; sy++) {
          for (let sx = 0; sx < samples; sx++) {
            out.push({
              x: cx + (sx + 0.5) * inv,
              y: cy + (sy + 0.5) * inv,
              z: 0,
              color: [floorEm.color[0], floorEm.color[1], floorEm.color[2]],
              intensity: floorEm.intensity * subIntensityScale,
              radius: AREA_LIGHT_RADIUS,
              source: "floor",
              owner: { cx, cy },
            });
          }
        }
      }

      const ceilEm = readCellEmissive(ceilRow[cx] as FloorCellInput);
      if (ceilEm && ceilEm.areaLight !== false) {
        for (let sy = 0; sy < samples; sy++) {
          for (let sx = 0; sx < samples; sx++) {
            out.push({
              x: cx + (sx + 0.5) * inv,
              y: cy + (sy + 0.5) * inv,
              z: 1,
              color: [ceilEm.color[0], ceilEm.color[1], ceilEm.color[2]],
              intensity: ceilEm.intensity * subIntensityScale,
              radius: AREA_LIGHT_RADIUS,
              source: "ceiling",
              owner: { cx, cy },
            });
          }
        }
      }

      const wallCell = wallRow[cx];
      const segs = wallCellToSegments(wallCell);
      for (const seg of segs) {
        const em = seg.emissive;
        if (!em || em.areaLight === false) continue;
        const startZ = seg.startZ ?? 0;
        const height = seg.height ?? 1;
        const startU = seg.startU ?? 0;
        const widthU = seg.widthU ?? 1;
        const face = seg.face ?? "N";
        for (let sy = 0; sy < samples; sy++) {
          const zT = (sy + 0.5) * inv;
          const wz = startZ + zT * height;
          for (let sx = 0; sx < samples; sx++) {
            const u = startU + ((sx + 0.5) * inv) * widthU;
            const { x, y } = wallSamplePos(cx, cy, face, u);
            out.push({
              x,
              y,
              z: wz,
              color: [em.color[0], em.color[1], em.color[2]],
              intensity: em.intensity * subIntensityScale,
              radius: AREA_LIGHT_RADIUS,
              source: "wall",
              owner: { cx, cy },
            });
          }
        }
      }
    }
  }

  return out;
}

function readCellEmissive(input: FloorCellInput): EmissiveSpec | null {
  if (input === null || input === undefined) return null;
  if (typeof input === "string") return null;
  return (input as StructuredFloorSpec).emissive ?? null;
}

function wallCellToSegments(input: unknown): WallSegmentInput[] {
  if (input === null || input === undefined) return [];
  if (typeof input === "number") return [];
  if (Array.isArray(input)) {
    const out: WallSegmentInput[] = [];
    for (const item of input) {
      if (item === null || item === undefined) continue;
      if (typeof item === "number") continue;
      out.push(item as WallSegmentInput);
    }
    return out;
  }
  return [input as WallSegmentInput];
}

function wallSamplePos(
  cx: number,
  cy: number,
  face: "N" | "S" | "E" | "W",
  u: number,
): { x: number; y: number } {
  const EPS = 0.5;
  switch (face) {
    case "N":
      return { x: cx + u, y: cy + EPS };
    case "S":
      return { x: cx + u, y: cy + EPS };
    case "E":
      return { x: cx + EPS, y: cy + u };
    case "W":
      return { x: cx + EPS, y: cy + u };
  }
}

/** Portable monotonic-clock millisecond reader. Falls back to `Date.now`. */
function nowMs(): number {
  if (typeof performance !== "undefined" && typeof performance.now === "function") {
    return performance.now();
  }
  return Date.now();
}

/**
 * Encode a Float32Array's underlying bytes as base64. Replaces the
 * Node-only `Buffer.from(...).toString("base64")` so the bake works
 * in browsers + workers. Chunked to avoid blowing the call-stack on
 * very large arrays (each `String.fromCharCode(...)` arg-spread is
 * bounded by the engine's stack size).
 */
function float32ToBase64(arr: Float32Array): string {
  const bytes = new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength);
  // 32 KB chunks keep the spread argument count well under any
  // browser's max-stack-size budget.
  const CHUNK = 0x8000;
  let binary = "";
  for (let i = 0; i < bytes.length; i += CHUNK) {
    const end = Math.min(i + CHUNK, bytes.length);
    binary += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, end)));
  }
  // `btoa` is GA in browsers + Node 18+ + Bun. No polyfill needed.
  return btoa(binary);
}

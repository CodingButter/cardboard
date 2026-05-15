/// <reference types="bun" />
/**
 * Phase 2 / Phase 4 of the lighting overhaul — the bake step.
 *
 * `bakeScene(sceneJson)` walks every authored static light in the scene
 * and emits a per-cell-corner RGB lightmap into the scene's `lightmap`
 * field. The runtime (`Scene.fromJSON` → `decodeLightmap` →
 * `Scene.sampleLight`) is already wired; this script's only job is to
 * produce the cornerRGB Float32Array and pack it as base64.
 *
 * Algorithm per scene:
 *
 *   collect lights = user-declared lights + auto-spawned area lights
 *                    from emissive floor / ceiling / wall surfaces
 *                    (each modelled as a 3×3 grid of point lights at
 *                    1/9 intensity — see LIGHTING_OVERHAUL § 4.3).
 *   for each light L:
 *     for each corner (cx, cy) in [0..W] × [0..H]:
 *       d = ||(cx, cy) - (L.x, L.y)||
 *       if d >= L.radius: continue
 *       atten = (1 - d / L.radius)²   // smoothstep-style edge falloff
 *       if !slabAwareLOS(L, corner): continue
 *       cornerRGB[cy * (W+1) + cx] += L.color × L.intensity × atten
 *
 * Phase 4 swapped the LOS test for a slab-aware variant: the ray's
 * 3D z at each wall crossing is `lz * (1 - pd / d_total)` (the ray
 * descends from the light to the corner, which sits at z = 0). A wall
 * blocks the ray only when that crossing-z falls inside the wall's
 * `[startZ, startZ + height]` slab. This lets knee walls cast shadows
 * for low-flying rays and hanging headers cast them for high ones.
 *
 * Pure function — no FS. `scripts/build-packs.ts` pipes scene JSONs
 * through it before zipping.
 */

import {
  Scene,
  castRayThroughWalls,
  Vec2,
  type SceneJSON,
  type LightDef,
  type EmissiveSpec,
  type WallSegmentInput,
  type FloorCellInput,
  type StructuredFloorSpec,
} from "@two_5_d/engine";

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
 * Hard-coded for now — LIGHTING_OVERHAUL § 4.3 notes a future
 * `manifest.lighting.areaLightSamples` knob; routing the manifest into
 * the bake is more wiring than this phase needs.
 * TODO(LIGHTING_OVERHAUL § 4.3): plumb the manifest knob through.
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
  const W = scene.walls[0]?.length ?? 0;
  const H = scene.walls.length;

  let K = Math.max(1, Math.floor(opts.lightmapResolution ?? DEFAULT_LIGHTMAP_RESOLUTION));
  let N = Math.max(1, Math.floor(opts.supersample ?? DEFAULT_LIGHT_SUPERSAMPLE));

  // Build the combined light list FIRST so we know whether there's
  // any baking work to do at all.
  const userLights = (scene.lights ?? []).map((l) => normaliseUserLight(l));
  const autoLights = collectEmissiveLights(scene, W, H);
  const allLights: BakedLight[] = [...userLights, ...autoLights];

  if (allLights.length === 0 || W === 0 || H === 0) {
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
  // Phase 1 used one shared grid; that made knee walls cast spurious
  // shadows on the ceiling because the floor's lightmap was reused for
  // both surfaces. Splitting fixes that at the cost of a 2× bake +
  // 2× lightmap bytes.
  const t0 = performance.now();
  let floorRGB = bakeGrid(sceneForLOS, allLights, W, H, 0, K, N);
  let ceilingRGB = bakeGrid(sceneForLOS, allLights, W, H, 1, K, N);
  let ms = performance.now() - t0;

  // Budget guard. The PLAN explicitly asks for an automatic downgrade
  // if the bake blows past 5s for any scene. The check happens AFTER
  // the first attempt so the common (fast) case has zero overhead.
  // The downgrade is a noticeable visual regression so we only trip
  // it when we have to.
  const MAX_BUDGET_MS = 5000;
  if (ms > MAX_BUDGET_MS && (K > 2 || N > 2)) {
    console.warn(
      `[bake-lights] scene bake hit ${ms.toFixed(0)} ms at K=${K}/N=${N};` +
        ` falling back to K=2/N=2 for budget.`,
    );
    K = Math.min(K, 2);
    N = Math.min(N, 2);
    const t1 = performance.now();
    floorRGB = bakeGrid(sceneForLOS, allLights, W, H, 0, K, N);
    ceilingRGB = bakeGrid(sceneForLOS, allLights, W, H, 1, K, N);
    ms = performance.now() - t1;
  }

  const floorB64 = Buffer.from(new Uint8Array(floorRGB.buffer)).toString("base64");
  const ceilingB64 = Buffer.from(new Uint8Array(ceilingRGB.buffer)).toString("base64");

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
 * ceiling). The ray from each light descends/ascends to a corner at
 * that z; the slab-aware LOS uses the same formula but with the
 * corner z plugged in.
 *
 * `K` is the sub-sample-per-cell factor: corner indices run
 * `[0, W*K]` × `[0, H*K]`, each corner sitting at world coords
 * `(cx / K, cy / K)`. The bilinear sampler in `Scene.sampleLightmap`
 * mirrors this with `wx *= K` before the floor / fract split.
 *
 * `N` is the jitter sample count per light — N=1 reproduces the
 * Phase 4 hard-shadow behaviour; N≥2 averages N LOS+falloff samples
 * from points within `LIGHT_JITTER_RADIUS` of the nominal light
 * position, producing soft penumbras without an RNG.
 */
function bakeGrid(
  sceneForLOS: Scene,
  allLights: ReadonlyArray<BakedLight>,
  W: number,
  H: number,
  cornerZ: number,
  K: number,
  N: number,
): Float32Array {
  const gridW = W * K + 1;
  const gridH = H * K + 1;
  const stride = gridW * 3;
  const out = new Float32Array(gridW * gridH * 3);

  // World coordinate per scaled-grid step. 1/K = the spacing of one
  // corner along an axis. Worth precomputing so the per-corner loop
  // doesn't divide.
  const invK = 1 / K;
  // Average across N samples — multiply once per accumulate.
  const invN = 1 / N;

  for (const L of allLights) {
    // Pre-build the N jitter samples for this light. Each one carries
    // its own (lx, ly, lightVec) — z is unchanged because jitter is
    // XY-only (LIGHTING_OVERHAUL.md plan note: only changes source
    // point). For N=1 we skip the offset table entirely.
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
        // Accumulate the contribution from each jittered source point;
        // divide by N at the end. Each iteration runs the original
        // Phase 4 path verbatim (3D distance falloff + slab-aware
        // LOS) — only the source xy changes.
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
          const atten = t * t; // smoothstep-ish edge falloff (§ 4.2)

          if (dHoriz <= 1e-6) {
            // Light directly above/below the corner — full contribution,
            // no LOS test (no horizontal ray to walk).
            accR += L.color[0] * L.intensity * atten;
            accG += L.color[1] * L.intensity * atten;
            accB += L.color[2] * L.intensity * atten;
            continue;
          }

          // LOS — cast from the (jittered) light TOWARD the corner.
          // Direction is unit-length in 2D so `perpDistance` is a true
          // horizontal world distance (matches `dHoriz`).
          const dirX = dx / dHoriz;
          const dirY = dy / dHoriz;
          const dirVec = new Vec2(dirX, dirY);
          const maxSteps = Math.ceil(Math.abs(dx) + Math.abs(dy)) + 4;
          const hits = castRayThroughWalls(sceneForLOS, samp.lightVec, dirVec, maxSteps);

          // Terminate the LOS walk a hair short of the corner. Corners
          // sit on grid lines so the DDA can step right onto a wall cell
          // at exactly `dHoriz` and falsely claim blockage.
          const cutoff = dHoriz - 0.001;

          let blocked = false;
          for (const hit of hits) {
            if (hit.perpDistance >= cutoff) break;
            // Surface-aware self-shadow skip. Only FLOOR-emissive
            // sources skip blockers in their owner cell — they sit at
            // z=0 and their auto-spawned area lights contribute to the
            // floor corners around the source, which would otherwise
            // be shadowed by the very wall they're emissive on.
            // CEILING and WALL sources lighting floor corners (or vice
            // versa) are different-surface contributions and any
            // blocker is legitimate. The runtime `emissive` add
            // handles the source pixel's self-illumination separately.
            if (
              L.source === "floor" &&
              L.owner !== null &&
              hit.cell.x === L.owner.cx &&
              hit.cell.y === L.owner.cy
            ) {
              continue;
            }
            // Slab-aware LOS — Phase 4. The ray runs linearly from
            // (lx, ly, lz) to (cx, cy, cornerZ). At fractional travel
            // tParam = pd / dHoriz, the ray's z is
            //   lz + (cornerZ - lz) * tParam.
            // The wall blocks only if that z falls inside the slab
            // `[startZ, startZ + height]`.
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
 * an `AREA_LIGHT_SAMPLES²` grid of point lights, each at 1/N²
 * intensity, scattered across the surface's plane:
 *
 *   - **Floor**  — XY footprint of the cell at `z = 0`.
 *   - **Ceiling** — XY footprint at `z = 1`.
 *   - **Wall** — along the face's U axis at the slab's vertical mid-
 *     range, jittered across the slab z-range.
 *
 * Each spawned light carries an `owner` pointer so the LOS pass can
 * skip self-shadowing.
 */
function collectEmissiveLights(scene: SceneJSON, W: number, H: number): BakedLight[] {
  const out: BakedLight[] = [];
  if (W === 0 || H === 0) return out;

  const samples = AREA_LIGHT_SAMPLES;
  const inv = 1 / samples;
  const subIntensityScale = 1 / (samples * samples);

  for (let cy = 0; cy < H; cy++) {
    const wallRow = scene.walls[cy] ?? [];
    const floorRow = scene.floors?.[cy] ?? [];
    const ceilRow = scene.ceilings?.[cy] ?? [];
    for (let cx = 0; cx < W; cx++) {
      // ── Floor emissive ─────────────────────────────────────────
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

      // ── Ceiling emissive ───────────────────────────────────────
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

      // ── Wall emissive (per segment) ───────────────────────────
      const wallCell = wallRow[cx];
      const segs = wallCellToSegments(wallCell);
      for (const seg of segs) {
        const em = seg.emissive;
        if (!em || em.areaLight === false) continue;
        const startZ = seg.startZ ?? 0;
        const height = seg.height ?? 1;
        const startU = seg.startU ?? 0;
        const widthU = seg.widthU ?? 1;
        // Map (startU, startU+widthU) across the cell's face axis.
        // Use the cell centre offset perpendicular to the face so
        // the spawned lights live just INSIDE the cell, then jitter
        // along U + Z. We pick a simple convention here: lights sit
        // at the cell centre on the perpendicular axis (avoids the
        // owner-skip getting confused by a light exactly on a cell
        // boundary). The runtime renderer uses segment.emissive for
        // the visual add — the precise xy of the spawned point
        // light is just for the LOS / falloff math.
        const face = seg.face ?? "N";
        // Compute (px, py) given a U parameter `u ∈ [0,1]` along the
        // segment span. We bias toward the wall face itself (not the
        // cell centre) so the contribution lands on neighbour cells
        // along the correct side.
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

/**
 * Pull the emissive spec out of a floor / ceiling cell input. Returns
 * `null` when the cell is a string spec (legacy compact form has no
 * room for emissive) or when no `emissive` field is set.
 */
function readCellEmissive(input: FloorCellInput): EmissiveSpec | null {
  if (input === null || input === undefined) return null;
  if (typeof input === "string") return null;
  return (input as StructuredFloorSpec).emissive ?? null;
}

/**
 * Coerce one cell's wall input into a flat array of `WallSegmentInput`
 * so we can iterate uniformly. Mirrors `parseWallCell` in Scene.ts but
 * preserves the raw `emissive` field (Scene's normaliser also keeps it,
 * but we don't want a dependency cycle on the runtime Scene here).
 */
function wallCellToSegments(input: unknown): WallSegmentInput[] {
  if (input === null || input === undefined) return [];
  if (typeof input === "number") return []; // legacy shorthand — no emissive
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

/**
 * World-space (x, y) of a wall-face sample at parameter `u ∈ [0, 1]`
 * along the segment. The N face runs along `y = cy` from `x = cx` to
 * `x = cx + 1`; the E face along `x = cx + 1`; etc. We push the sample
 * slightly INTO the cell so the LOS owner-skip catches the wall as
 * the first hit.
 */
function wallSamplePos(
  cx: number,
  cy: number,
  face: "N" | "S" | "E" | "W",
  u: number,
): { x: number; y: number } {
  const EPS = 0.5; // sample at cell centre on the perp axis
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

import {
  createPixel,
  pixelToCss,
  type ILine,
  type IPixel,
  type IPoint,
  type IRect,
  type ISize,
  type ITextOptions,
} from "Libs/Geometry";
import { Vec2 } from "Libs/Vector";
import { castRayThroughWalls, WallSide, type WallHit } from "Libs/Raycast";
import type { Scene } from "Scene";
import type { CameraData } from "Components";
import { CONFIG } from "GameConfig";
import { Texture } from "./Texture";
import type { LightInstance, SceneRenderer, SpriteDrawRequest } from "./SceneRenderer";
import type { AssetPack, SheetEntry } from "AssetPack";

export interface TwoDRendererProps {
  canvas: HTMLCanvasElement;
  pack: AssetPack;
  width?: number;
  height?: number;
}

/* --- Asset wiring (now provided by the AssetPack) ---------------------- */

const TILE_COLORS: Record<number, IPixel> = CONFIG.walls.tileColors;
const DEFAULT_TILE_COLOR: IPixel = CONFIG.walls.defaultColor;

/**
 * Per-column slab cap. Enough for "knee wall + tall wall behind" with
 * a couple of spares. Bumping this is cheap (just more bytes in the
 * per-frame slab arrays); the cost is the per-pixel sprite test
 * looping more.
 */
const MAX_SLABS_PER_COLUMN = 4;

/**
 * Per-frame dynamic-light cap for the CPU backend. Each light costs a
 * radius-check + a Bresenham-style LOS walk per affected pixel, so we
 * stay aggressive here. WebGL caps at 8 (`MAX_DYNAMIC_LIGHTS_GL`).
 * See LIGHTING_OVERHAUL.md § 5.3 / § 6.
 */
const MAX_DYNAMIC_LIGHTS_CPU = 4;

/**
 * Soft-shadow jitter for dynamic-light LOS. Each (pixel, light) pair runs
 * `LIGHT_JITTER_SAMPLES` LOS tests at slightly offset light positions
 * (deterministic Halton-style offsets — no RNG) and averages the boolean
 * visibility into a fractional coverage in `[0, 1]`. Mirrors the static
 * bake's offsets so dynamic light dithering matches baked soft shadows.
 *
 * Setting `LIGHT_JITTER_SAMPLES = 1` reduces gracefully to the original
 * hard-shadow single-sample path.
 */
const LIGHT_JITTER_SAMPLES = 3;
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

// Tuning knobs — sourced from game.config.json via GameConfig.ts. Aliased
// to short local names so the hot loops read cleanly.
const WALL_AO_DARKEN = CONFIG.walls.ao.bottomDarken;
const WALL_AO_BAND = CONFIG.walls.ao.bottomBand;
const WALL_AO_DARKEN_TOP = CONFIG.walls.ao.topDarken;
const WALL_AO_BAND_TOP = CONFIG.walls.ao.topBand;
const FLOOR_AO_BAND = CONFIG.floor.ao.band;
const FLOOR_AO_DARKEN = CONFIG.floor.ao.darken;
const REFLECTION_TILE_SCALE = CONFIG.floor.reflection.tileScale;
const WALL_REFL_STRENGTH = CONFIG.walls.reflection.strength;
const WALL_REFL_BAND = CONFIG.walls.reflection.band;
// Bilinear filtering is read into a per-frame instance field
// (`this.bilinear`) in `beginFrame` so the settings toggle is live.

/**
 * CPU-side `SceneRenderer` — owns a Uint8ClampedArray pixel buffer and
 * walks every pixel of the world pass in JS. Push-to-screen happens via
 * `ctx.putImageData` in `endFrame()`.
 *
 * This is also the eventual reference implementation: the upcoming
 * `WebGLRenderer` will produce the same images by feeding the same scene
 * data (camera + DDA results) to a fragment shader, so the two backends
 * stay visually identical from the outside.
 *
 * Texture management lives here because the asset set is part of the
 * renderer's resources, not the entity world. The wall sheet is decoded
 * once at construction and cropped into 36 sub-textures.
 */
export class TwoDRenderer implements SceneRenderer {
  readonly canvas: HTMLCanvasElement;
  readonly ctx: CanvasRenderingContext2D;
  readonly assetsReady: Promise<void>;
  imageData: ImageData;
  buffer: Uint8ClampedArray;

  /** Tile id → decoded texture. Populated asynchronously on construction. */
  private readonly textures: Map<number, Texture> = new Map();

  /** Sprite id (manifest key) → decoded texture. Populated async at boot. */
  private readonly spriteTextures: Map<string, Texture> = new Map();
  /** Set of sprite ids we've already warned about, so we log unknowns once. */
  private readonly warnedSpriteIds: Set<string> = new Set();

  /**
   * Scratch buffer for the most recently rendered wall column. Sized to
   * canvas height worth of RGBA bytes; reused across columns. The floor/
   * ceiling pass reads it for the wall-mirror reflection, and the wall
   * composite step reads it again to alpha-blend onto the main buffer.
   */
  private columnWallBuffer: Uint8ClampedArray = new Uint8ClampedArray(0);

  /**
   * Per-column nearest-wall distance captured during the world pass.
   * Cells without any hit are `Infinity`. The sprite pass uses this
   * for a fast early-out before the per-pixel slab test.
   */
  private columnDepth: Float32Array = new Float32Array(0);

  /**
   * Per-column slab list — for each column we store up to
   * `MAX_SLABS_PER_COLUMN` (perpDist, wallTop, wallBottom) triples
   * packed as flat floats. `columnSlabCount[x]` is how many entries
   * are populated. The sprite pass walks these to do per-pixel
   * occlusion testing, so a sprite peeking over a knee wall is
   * visible at pixels the slab doesn't cover.
   */
  private columnSlabs: Float32Array = new Float32Array(0);
  private columnSlabCount: Uint8Array = new Uint8Array(0);

  /** Bilinear filtering — refreshed in `beginFrame` from CONFIG. */
  private bilinear: boolean = false;

  /** Out-params for `sampleBilinear` — instance fields beat per-call allocation. */
  private sR = 0;
  private sG = 0;
  private sB = 0;

  /**
   * Scratch triple for `scene.sampleLight` — reused across every pass so
   * the per-pixel/per-row lightmap fetch doesn't allocate. See
   * LIGHTING_OVERHAUL.md § 5.1 / 5.5 for the runtime sampling model.
   */
  private lightSample: [number, number, number] = [1, 1, 1];

  /**
   * Per-frame dynamic-light list, capped at `MAX_DYNAMIC_LIGHTS_CPU`.
   * Reused buffer; cleared and re-filled in `setDynamicLights` each
   * frame. The world pass + sprite pass both read this. See
   * LIGHTING_OVERHAUL.md § 5.3 / § 6.
   */
  private dynamicLights: LightInstance[] = [];

  /**
   * Scratch triple for accumulated dynamic-light contribution at a
   * single world point. Refreshed inline in the hot loops; written by
   * `accumulateDynamicLight`. Keeps the per-pixel addition allocation-
   * free.
   */
  private dynamicSample: [number, number, number] = [0, 0, 0];

  /**
   * Last scene rendered via `drawWorld` — cached so `drawSprites` can
   * sample the static lightmap without expanding the `SceneRenderer`
   * interface. `drawSprites` is always called after `drawWorld` in the
   * same frame, so this is well-defined by the time it's read.
   */
  private currentScene: Scene | null = null;

  constructor({
    canvas,
    pack,
    width = canvas.clientWidth,
    height = canvas.clientHeight,
  }: TwoDRendererProps) {
    canvas.width = width;
    canvas.height = height;
    this.canvas = canvas;

    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Could not get 2D context");

    this.ctx = ctx;
    this.imageData = ctx.createImageData(canvas.width, canvas.height);
    this.buffer = this.imageData.data;

    // Pull tile assets from the pack. The renderer drops back to the
    // solid-color fallback (`TILE_COLORS[tileId]` / `DEFAULT_TILE_COLOR`)
    // until each load resolves — no blocking on startup. Promises are
    // collected into `assetsReady` so the boot overlay can wait for the
    // first complete frame.
    const pending: Promise<unknown>[] = [];
    const tileTextures = pack.manifest.tileTextures ?? {};
    for (const tileStr in tileTextures) {
      const tile = Number(tileStr);
      const path = tileTextures[tile]!;
      pending.push(
        pack
          .textureBlob(path)
          .then((blob) => Texture.loadFromBlob(blob))
          .then((tex) => this.textures.set(tile, tex))
          .catch((err) => console.warn(`Failed to load ${path}:`, err)),
      );
    }
    for (const sheet of pack.manifest.tileSheets ?? []) {
      pending.push(
        pack
          .textureBlob(sheet.path)
          .then((blob) => Texture.loadFromBlob(blob))
          .then((image) => this.registerSheet(image, sheet))
          .catch((err) => console.warn(`Failed to load tile sheet ${sheet.path}:`, err)),
      );
    }
    // Sprite atlas — preload every entry so spawning a sprite is a
    // synchronous component-add later.
    const sprites = pack.manifest.sprites ?? {};
    for (const [id, def] of Object.entries(sprites)) {
      pending.push(
        pack
          .textureBlob(def.image)
          .then((blob) => Texture.loadFromBlob(blob))
          .then((tex) => this.spriteTextures.set(id, tex))
          .catch((err) => console.warn(`Failed to load sprite ${id} (${def.image}):`, err)),
      );
    }
    this.assetsReady = Promise.all(pending).then(() => undefined);
  }

  /* --- SceneRenderer interface ---------------------------------------- */

  beginFrame(): void {
    // Ensure the scratch column buffer is large enough for the current
    // canvas height. Realistically this only allocates on the first frame
    // and after a resize.
    const needed = this.canvas.height * 4;
    if (this.columnWallBuffer.length < needed) {
      this.columnWallBuffer = new Uint8ClampedArray(needed);
    }
    if (this.columnDepth.length < this.canvas.width) {
      this.columnDepth = new Float32Array(this.canvas.width);
    }
    const slabBytes = this.canvas.width * MAX_SLABS_PER_COLUMN * 3;
    if (this.columnSlabs.length < slabBytes) {
      this.columnSlabs = new Float32Array(slabBytes);
      this.columnSlabCount = new Uint8Array(this.canvas.width);
    }
    // Pick up the live bilinear setting once per frame (vs per pixel).
    this.bilinear = CONFIG.rendering.bilinearFiltering;
  }

  /**
   * Stash the per-frame dynamic light list (capped at
   * `MAX_DYNAMIC_LIGHTS_CPU`). Called once per frame BEFORE `drawWorld`
   * so the world and sprite passes both read the same set.
   */
  setDynamicLights(lights: ReadonlyArray<LightInstance>): void {
    this.dynamicLights.length = 0;
    const n = Math.min(lights.length, MAX_DYNAMIC_LIGHTS_CPU);
    for (let i = 0; i < n; i++) this.dynamicLights.push(lights[i]!);
  }

  drawSky(top: IPixel, bottom: IPixel): void {
    this.fillHorizon(top, bottom);
  }

  drawWorld(
    scene: Scene,
    position: Vec2,
    facing: number,
    camera: CameraData,
    horizonOffset: number = 0,
  ): void {
    this.currentScene = scene;
    const width = this.canvas.width;
    const height = this.canvas.height;
    // Eye height in [0, 1] world units. 0.5 = mid-wall (standing).
    // Jump pushes toward 1, crouch toward 0. Drives wall positioning
    // and the floor-pass distance scaling.
    const cameraZ = camera.cameraZ ?? 0.5;
    const forward = Vec2.fromAngle(facing);
    const right = Vec2.fromAngle(facing + Math.PI / 2);
    const planeScale = Math.tan(camera.fov / 2);
    const fogInv = 1 / camera.fogDistance;
    // Aspect-correct vertical scale: pixels per world-z-unit at
    // `perpDist = 1` is `width / (2 * tan(fov/2))` — the same scale
    // used horizontally. This means walls preserve world aspect on
    // any window shape; resizing the window adjusts vertical FOV
    // (more sky / floor visible on a taller window) instead of
    // squashing or stretching the walls themselves.
    const unitH = width / (2 * planeScale);
    const posZ = cameraZ * unitH;
    // Horizon line stays at canvas-center (you look level even when
    // crouching) plus the pitch-derived offset.
    const horizonY = height / 2 + horizonOffset;

    const depth = this.columnDepth;
    const slabs = this.columnSlabs;
    const slabCount = this.columnSlabCount;
    for (let x = 0; x < width; x++) {
      const cameraX = (2 * x) / width - 1;
      const rayDir = forward.add(right.scale(planeScale * cameraX));

      // Multi-hit DDA: returns every wall the ray crosses, nearest
      // first, terminating at the first full-height occluder (or scene
      // exit / step budget). Empty for rays that miss everything.
      const hits = castRayThroughWalls(scene, position, rayDir, camera.maxRaySteps);
      const nearest = hits[0];

      // depth + per-column slab list (drive sprite z-clip — sprites
      // peeking over a knee wall are visible at pixels the slab doesn't
      // cover).
      depth[x] = nearest ? nearest.perpDistance : Infinity;
      const slabsBase = x * MAX_SLABS_PER_COLUMN * 3;
      const n = Math.min(hits.length, MAX_SLABS_PER_COLUMN);
      slabCount[x] = n;
      for (let i = 0; i < n; i++) {
        const h = hits[i]!;
        const unitHeight = unitH / h.perpDistance;
        const seg = h.segment;
        const wallTop = horizonY - (seg.startZ + seg.height - cameraZ) * unitHeight;
        const wallBottom = horizonY - (seg.startZ - cameraZ) * unitHeight;
        const o = slabsBase + i * 3;
        slabs[o] = h.perpDistance;
        slabs[o + 1] = wallTop;
        slabs[o + 2] = wallBottom;
      }

      // 1. Floor + ceiling → main buffer. Reflection mirror needs the
      //    nearest hit with an actual slab (perpDistance > 0); an
      //    inside-cell hit (perpDistance == 0) has no front face to
      //    mirror, so we walk past it.
      let mirrorHit: WallHit | undefined;
      for (let i = 0; i < n; i++) {
        const h = hits[i]!;
        if (h.perpDistance > 0) {
          mirrorHit = h;
          break;
        }
      }
      let nearestWallTop = horizonY;
      let nearestWallBottom = horizonY;
      if (mirrorHit) {
        const unitHeight = unitH / mirrorHit.perpDistance;
        const seg = mirrorHit.segment;
        nearestWallTop = horizonY - (seg.startZ + seg.height - cameraZ) * unitHeight;
        nearestWallBottom = horizonY - (seg.startZ - cameraZ) * unitHeight;
      }
      this.drawFloorCeilingColumn(
        scene,
        position,
        rayDir,
        camera,
        x,
        fogInv,
        horizonY,
        posZ,
        nearestWallTop,
        nearestWallBottom,
        mirrorHit !== undefined,
      );

      // 2. Walls + caps — back-to-front. Each pass renders one hit's
      //    cap then composites its slab. Nearer slabs naturally overlay
      //    farther ones via opaque writes.
      //    Inside-cell hits (perpDistance === 0) skip the slab — there's
      //    no front face to render from inside — but still draw the
      //    cap so the player sees the underside / top of the wall
      //    surrounding them.
      for (let i = n - 1; i >= 0; i--) {
        const h = hits[i]!;
        if (h.perpDistance > 0) {
          const unitHeight = unitH / h.perpDistance;
          const seg = h.segment;
          const slabHeight = seg.height * unitHeight;
          const wallTop = horizonY - (seg.startZ + seg.height - cameraZ) * unitHeight;
          const wallBottom = horizonY - (seg.startZ - cameraZ) * unitHeight;
          this.renderWallToColumn(scene, h, wallTop, slabHeight, height, fogInv);
          this.compositeWallColumn(x, wallTop, wallBottom, slabHeight);
        }
        this.renderCapColumn(scene, h, position, rayDir, x, cameraZ, horizonY, unitH, fogInv);
      }
    }
  }

  drawSprites(
    requests: readonly SpriteDrawRequest[],
    position: Vec2,
    facing: number,
    camera: CameraData,
    horizonOffset: number = 0,
  ): void {
    if (requests.length === 0) return;
    const width = this.canvas.width;
    const height = this.canvas.height;
    const cameraZ = camera.cameraZ ?? 0.5;
    // Horizon stays at canvas-center; the eye-height delta from the
    // default (0.5) shifts where world-anchored sprites appear.
    const horizonY = height / 2 + horizonOffset;
    const planeScale = Math.tan(camera.fov / 2);
    const fogInv = 1 / camera.fogDistance;

    // Camera basis. `forward` is the look direction; `right` is the
    // screen-x axis. Vec2 already provides these.
    const forward = Vec2.fromAngle(facing);
    const right = Vec2.fromAngle(facing + Math.PI / 2);

    // Project every request into camera space and discard anything behind
    // the camera before sorting. The `transformed` list parallels the
    // requests we keep so back-to-front order is by `camY` descending.
    type Item = {
      camX: number;
      camY: number;
      tex: Texture;
      worldHeight: number;
      yOffset: number;
      lightR: number;
      lightG: number;
      lightB: number;
      /** A1 of ANIMATIONS.md — atlas-layer source-rect origin (UV space, 0..1). */
      uvOffsetX: number;
      uvOffsetY: number;
      /** A1 of ANIMATIONS.md — atlas-layer source-rect size (UV space, 0..1). */
      uvScaleX: number;
      uvScaleY: number;
    };
    const items: Item[] = [];
    // Cached scene from this frame's `drawWorld`. Sprites without a prior
    // world pass (test fixtures) fall back to uniform 1.0 lighting.
    const scene = this.currentScene;
    for (const req of requests) {
      const tex = this.spriteTextures.get(req.imageId);
      if (!tex) {
        if (!this.warnedSpriteIds.has(req.imageId)) {
          console.warn(`Sprite "${req.imageId}" is not in the pack — drop or rename`);
          this.warnedSpriteIds.add(req.imageId);
        }
        continue;
      }
      const dx = req.x - position.x;
      const dy = req.y - position.y;
      const camX = dx * right.x + dy * right.y;
      const camY = dx * forward.x + dy * forward.y;
      // Behind or directly on the camera plane → cull. The 0.05 cushion
      // keeps the divide stable and prevents giant near-plane blowups.
      if (camY <= 0.05) continue;
      // One static lightmap sample per sprite — Phase 1 keeps the cost
      // sprite-constant (vs per-pixel). LIGHTING_OVERHAUL.md § 5.5.
      let lightR = 1;
      let lightG = 1;
      let lightB = 1;
      if (scene) {
        scene.sampleFloorLight(req.x, req.y, this.lightSample);
        lightR = this.lightSample[0];
        lightG = this.lightSample[1];
        lightB = this.lightSample[2];
        // One dynamic-light sample per sprite, matching the static
        // lightmap's "per-sprite, not per-pixel" model. Folds the
        // dynamic contribution into the same `lightR/G/B` multiplier
        // so the inner per-pixel loop stays the same shape.
        if (this.dynamicLights.length > 0) {
          this.accumulateDynamicLight(scene, req.x, req.y);
          lightR += this.dynamicSample[0];
          lightG += this.dynamicSample[1];
          lightB += this.dynamicSample[2];
        }
      }
      items.push({
        camX,
        camY,
        tex,
        worldHeight: req.worldHeight,
        yOffset: req.yOffset,
        lightR,
        lightG,
        lightB,
        uvOffsetX: req.uvOffset?.x ?? 0,
        uvOffsetY: req.uvOffset?.y ?? 0,
        uvScaleX: req.uvScale?.x ?? 1,
        uvScaleY: req.uvScale?.y ?? 1,
      });
    }
    if (items.length === 0) return;
    // Back-to-front: farthest first so alpha-blends composite correctly.
    items.sort((a, b) => b.camY - a.camY);

    const depth = this.columnDepth;
    const slabs = this.columnSlabs;
    const slabCount = this.columnSlabCount;
    const dstStride = width * 4;
    const dstData = this.buffer;

    for (const it of items) {
      // Per-pixel scale: walls of world-height 1 project to `height /
      // perpDistance`. A 1-unit-wide sprite at distance `camY` projects
      // to `width / (2 * camY * planeScale)` pixels wide. Sprites are
      // assumed square; if you need non-square, scale by the texture
      // aspect ratio here.
      const spriteH = (it.worldHeight * height) / it.camY;
      const aspect = it.tex.width / it.tex.height;
      const spriteW = spriteH * aspect;

      // Screen center: x from camera-plane projection, y shifted by
      // World-anchored vertical placement. `yOffset` is authored as the
      // sprite center's offset below standing eye height (cameraZ=0.5);
      // when the player crouches/jumps we shift by the delta so the
      // sprite stays pinned to its world Z.
      const screenCenterX = (width / 2) * (1 + it.camX / (it.camY * planeScale));
      const yOffsetEffective = it.yOffset + (cameraZ - 0.5);
      const screenCenterY = horizonY + (yOffsetEffective * height) / it.camY;

      const left = Math.floor(screenCenterX - spriteW / 2);
      const right_ = Math.ceil(screenCenterX + spriteW / 2);
      const top = Math.floor(screenCenterY - spriteH / 2);
      const bottom = Math.ceil(screenCenterY + spriteH / 2);

      // Trivial reject — fully off-screen.
      if (right_ <= 0 || left >= width || bottom <= 0 || top >= height) continue;

      const x0 = Math.max(0, left);
      const x1 = Math.min(width, right_);
      const y0 = Math.max(0, top);
      const y1 = Math.min(height, bottom);

      // Distance-based fog matches the wall pass.
      const fogMul = Math.max(0, Math.min(1, 1 - it.camY * fogInv));
      // Bake the per-sprite static lightmap sample into the per-channel
      // shade multiplier — keeps the inner per-pixel loop the same shape.
      const shadeR = fogMul * it.lightR;
      const shadeG = fogMul * it.lightG;
      const shadeB = fogMul * it.lightB;

      const texW = it.tex.width;
      const texH = it.tex.height;
      const texData = it.tex.data;
      // A1 of ANIMATIONS.md — restrict sampling to the (uvOffset,
      // uvScale) region within the source texture. For unanimated
      // sprites this is the whole texture (uvOffset=0,0 / uvScale=1,1)
      // so the stride math collapses to the pre-A1 path exactly.
      const srcLeft = it.uvOffsetX * texW;
      const srcTop = it.uvOffsetY * texH;
      const srcW = it.uvScaleX * texW;
      const srcH = it.uvScaleY * texH;
      const stepU = srcW / spriteW;
      const stepV = srcH / spriteH;

      const spriteLeft = screenCenterX - spriteW / 2;
      const spriteTop = screenCenterY - spriteH / 2;

      // Walk columns; per-pixel slab z-clip handles knee-wall peek-over.
      for (let x = x0; x < x1; x++) {
        // Fast early-out: if even the nearest wall is past this sprite,
        // the whole column is safe to draw.
        const nearest = depth[x]!;
        const skipColumnTest = nearest >= it.camY;
        // Offset by srcLeft so the per-screen-x texel index is anchored
        // at the active frame's column when this sprite is animated.
        const u = (srcLeft + (x - spriteLeft) * stepU) | 0;
        if (u < 0 || u >= texW) continue;

        // Per-column slab list — used when at least one slab is closer
        // than the sprite. Up to MAX_SLABS_PER_COLUMN entries.
        const sbase = x * MAX_SLABS_PER_COLUMN * 3;
        const scount = slabCount[x]!;

        let dstIdx = y0 * dstStride + x * 4;
        // Keep v as a float — `stepV` is < 1 whenever the sprite is
        // larger than its texture, so an integer-only step would freeze
        // sampling at the first row. Offset by srcTop so the per-y
        // sample index is anchored at the active frame's row when this
        // sprite is animated (= srcTop=0, srcH=texH for static).
        let vf = srcTop + (y0 - spriteTop) * stepV;
        for (let y = y0; y < y1; y++) {
          // Per-pixel slab occlusion: if any closer slab covers this y,
          // the sprite is hidden here. For knee walls, pixels above the
          // slab show the sprite peeking over.
          if (!skipColumnTest) {
            let hidden = false;
            for (let s = 0; s < scount; s++) {
              const o = sbase + s * 3;
              const slabDist = slabs[o]!;
              if (slabDist >= it.camY) continue; // slab is BEHIND sprite
              const slabTop = slabs[o + 1]!;
              const slabBot = slabs[o + 2]!;
              if (y >= slabTop && y < slabBot) {
                hidden = true;
                break;
              }
            }
            if (hidden) {
              vf += stepV;
              dstIdx += dstStride;
              continue;
            }
          }
          const v = vf | 0;
          if (v >= 0 && v < texH) {
            const sIdx = (v * texW + u) * 4;
            const a = texData[sIdx + 3]!;
            if (a > 0) {
              const sr = texData[sIdx]! * shadeR;
              const sg = texData[sIdx + 1]! * shadeG;
              const sb = texData[sIdx + 2]! * shadeB;
              if (a === 255) {
                dstData[dstIdx] = sr | 0;
                dstData[dstIdx + 1] = sg | 0;
                dstData[dstIdx + 2] = sb | 0;
                dstData[dstIdx + 3] = 255;
              } else {
                const af = a / 255;
                const ainv = 1 - af;
                dstData[dstIdx] = (sr * af + dstData[dstIdx]! * ainv) | 0;
                dstData[dstIdx + 1] = (sg * af + dstData[dstIdx + 1]! * ainv) | 0;
                dstData[dstIdx + 2] = (sb * af + dstData[dstIdx + 2]! * ainv) | 0;
                dstData[dstIdx + 3] = 255;
              }
            }
          }
          vf += stepV;
          dstIdx += dstStride;
        }
      }
    }
  }

  endFrame(): void {
    this.present();
  }

  /* --- Public low-level primitives (legacy / future systems) ----------- */

  /** Overwrite the entire buffer with `pixel`. Defaults to opaque black. */
  clear(pixel: IPixel = createPixel(0, 0, 0, 255)): void {
    for (let i = 0; i < this.buffer.length; i += 4) {
      this.buffer[i] = pixel.r;
      this.buffer[i + 1] = pixel.g;
      this.buffer[i + 2] = pixel.b;
      this.buffer[i + 3] = pixel.a;
    }
  }

  /**
   * Fill a single vertical column `[y1, y2)` at `x`. Used by `drawWorld`'s
   * untextured wall fallback and available for any other system that
   * wants a fast solid-column write.
   */
  fillColumn(x: number, y1: number, y2: number, pixel: IPixel): void {
    const px = Math.floor(x);
    if (px < 0 || px >= this.canvas.width) return;

    const startY = Math.max(0, Math.floor(y1));
    const endY = Math.min(this.canvas.height, Math.floor(y2));
    const stride = this.canvas.width * 4;
    let index = startY * stride + px * 4;

    const { r, g, b, a } = pixel;
    for (let y = startY; y < endY; y++) {
      this.buffer[index] = r;
      this.buffer[index + 1] = g;
      this.buffer[index + 2] = b;
      this.buffer[index + 3] = a;
      index += stride;
    }
  }

  /** Fill the top half of the canvas with `top` and the bottom half with `bottom`. */
  fillHorizon(top: IPixel, bottom: IPixel): void {
    const half = (this.canvas.height >> 1) * this.canvas.width * 4;
    const total = this.buffer.length;
    for (let i = 0; i < half; i += 4) {
      this.buffer[i] = top.r;
      this.buffer[i + 1] = top.g;
      this.buffer[i + 2] = top.b;
      this.buffer[i + 3] = top.a;
    }
    for (let i = half; i < total; i += 4) {
      this.buffer[i] = bottom.r;
      this.buffer[i + 1] = bottom.g;
      this.buffer[i + 2] = bottom.b;
      this.buffer[i + 3] = bottom.a;
    }
  }

  /** Fill an axis-aligned rect, clipped to the canvas bounds. */
  drawRect(rect: IRect, pixel: IPixel): void {
    const startX = Math.max(0, Math.floor(rect.x));
    const startY = Math.max(0, Math.floor(rect.y));
    const endX = Math.min(this.canvas.width, Math.floor(rect.x + rect.width));
    const endY = Math.min(this.canvas.height, Math.floor(rect.y + rect.height));

    for (let y = startY; y < endY; y++) {
      for (let x = startX; x < endX; x++) {
        this.setPixel({ x, y }, pixel);
      }
    }
  }

  /** Filled circle. Brute-force AABB scan — fine for the small overlays. */
  drawCircle(center: IPoint, radius: number, pixel: IPixel): void {
    const centerX = Math.floor(center.x);
    const centerY = Math.floor(center.y);
    const radiusSquared = radius * radius;

    const startX = Math.max(0, Math.floor(centerX - radius));
    const startY = Math.max(0, Math.floor(centerY - radius));
    const endX = Math.min(this.canvas.width - 1, Math.floor(centerX + radius));
    const endY = Math.min(this.canvas.height - 1, Math.floor(centerY + radius));

    for (let y = startY; y <= endY; y++) {
      for (let x = startX; x <= endX; x++) {
        const dx = x - centerX;
        const dy = y - centerY;
        if (dx * dx + dy * dy <= radiusSquared) {
          this.setPixel({ x, y }, pixel);
        }
      }
    }
  }

  /**
   * Bresenham line. `width` thickens the stroke by stamping a `width × width`
   * square at each pixel along the line.
   */
  drawLine(line: ILine, pixel: IPixel): void {
    let x = Math.floor(line.start.x);
    let y = Math.floor(line.start.y);
    const endX = Math.floor(line.end.x);
    const endY = Math.floor(line.end.y);

    const dx = Math.abs(endX - x);
    const dy = Math.abs(endY - y);
    const sx = x < endX ? 1 : -1;
    const sy = y < endY ? 1 : -1;
    let err = dx - dy;

    const width = Math.max(1, Math.floor(line.width ?? 1));
    const halfWidth = Math.floor(width / 2);

    while (true) {
      for (let offsetY = -halfWidth; offsetY <= halfWidth; offsetY++) {
        for (let offsetX = -halfWidth; offsetX <= halfWidth; offsetX++) {
          this.setPixel({ x: x + offsetX, y: y + offsetY }, pixel);
        }
      }

      if (x === endX && y === endY) break;

      const e2 = err * 2;
      if (e2 > -dy) {
        err -= dy;
        x += sx;
      }
      if (e2 < dx) {
        err += dx;
        y += sy;
      }
    }
  }

  /**
   * Draw text via the canvas API. Forces a `present()` first so the pixel
   * buffer is on screen before the canvas API draws over it.
   */
  drawText(text: string, position: IPoint, pixel: IPixel, options: ITextOptions = {}): void {
    this.present();
    this.ctx.fillStyle = pixelToCss(pixel);
    this.ctx.font = options.font ?? "16px Arial";
    this.ctx.fillText(text, position.x, position.y);
  }

  /**
   * Blit a `Texture` straight into the pixel buffer with nearest-neighbor
   * sampling. Skips alpha-0 source pixels for 1-bit transparency.
   */
  drawTexture(
    texture: Texture,
    destPos: Vec2,
    destSize: Vec2,
    srcPos: Vec2 = Vec2.zero(),
    srcSize: Vec2 = texture.size,
  ): void {
    if (destSize.x <= 0 || destSize.y <= 0 || srcSize.x <= 0 || srcSize.y <= 0) return;

    const destLeft = Math.floor(destPos.x);
    const destTop = Math.floor(destPos.y);
    const destRight = Math.floor(destPos.x + destSize.x);
    const destBottom = Math.floor(destPos.y + destSize.y);

    const canvasW = this.canvas.width;
    const canvasH = this.canvas.height;
    if (destRight <= 0 || destBottom <= 0 || destLeft >= canvasW || destTop >= canvasH) return;

    const x0 = Math.max(0, destLeft);
    const y0 = Math.max(0, destTop);
    const x1 = Math.min(canvasW, destRight);
    const y1 = Math.min(canvasH, destBottom);

    const stepX = srcSize.x / destSize.x;
    const stepY = srcSize.y / destSize.y;

    const dstStride = canvasW * 4;
    const srcStride = texture.width * 4;
    const srcData = texture.data;
    const dstData = this.buffer;
    const srcX0 = srcPos.x;
    const srcY0 = srcPos.y;

    for (let dy = y0; dy < y1; dy++) {
      const sy = (srcY0 + (dy - destTop) * stepY) | 0;
      let dstIdx = dy * dstStride + x0 * 4;
      const srcRow = sy * srcStride;

      for (let dx = x0; dx < x1; dx++) {
        const sx = (srcX0 + (dx - destLeft) * stepX) | 0;
        const srcIdx = srcRow + sx * 4;
        const a = srcData[srcIdx + 3]!;
        if (a !== 0) {
          dstData[dstIdx] = srcData[srcIdx]!;
          dstData[dstIdx + 1] = srcData[srcIdx + 1]!;
          dstData[dstIdx + 2] = srcData[srcIdx + 2]!;
          dstData[dstIdx + 3] = a;
        }
        dstIdx += 4;
      }
    }
  }

  /** Bounds-checked single-pixel write. Out-of-canvas writes are dropped. */
  setPixel(position: IPoint, pixel: IPixel): void {
    const x = Math.floor(position.x);
    const y = Math.floor(position.y);

    if (x < 0 || x >= this.canvas.width || y < 0 || y >= this.canvas.height) return;

    const index = (y * this.canvas.width + x) * 4;
    this.buffer[index] = pixel.r;
    this.buffer[index + 1] = pixel.g;
    this.buffer[index + 2] = pixel.b;
    this.buffer[index + 3] = pixel.a;
  }

  /** Push the in-memory buffer to the on-screen canvas. */
  present(): void {
    this.ctx.putImageData(this.imageData, 0, 0);
  }

  /**
   * Resize the backing buffer to `(width, height)`. Discards previous
   * pixel content. Per-column scratch arrays (`columnDepth`,
   * `columnSlabs`, etc.) auto-resize on the next `beginFrame` via
   * their length checks.
   *
   * Two call shapes for back-compat:
   *
   *   - `resize(width, height)` — preferred, matches `SceneRenderer`.
   *   - `resize({ width, height })` — original legacy form.
   */
  resize(size: ISize | number, height?: number): void {
    let w: number;
    let h: number;
    if (typeof size === "number") {
      w = size;
      h = height ?? size;
    } else {
      w = size.width;
      h = size.height;
    }
    if (this.canvas.width === w && this.canvas.height === h) return;
    this.canvas.width = w;
    this.canvas.height = h;
    this.imageData = this.ctx.createImageData(w, h);
    this.buffer = this.imageData.data;
  }

  /* --- Private: scene-pass internals (was in WallRenderSystem) -------- */

  /** Crop `image` into `cols × rows` tiles per `spec` and register them. */
  private registerSheet(image: Texture, spec: SheetEntry): void {
    let id = spec.startTileId;
    for (let row = 0; row < spec.rows; row++) {
      for (let col = 0; col < spec.cols; col++) {
        const srcX = spec.offsetX + col * spec.tileWidth;
        const srcY = spec.offsetY + row * spec.tileHeight;
        this.textures.set(id, image.crop(srcX, srcY, spec.tileWidth, spec.tileHeight));
        id++;
      }
    }
  }

  /**
   * Sample a texture at sub-texel coordinates `(u, v)` (in texel space) and
   * write the bilinearly-interpolated RGB into `this.sR/sG/sB`. Wraps both
   * axes modulo the texture size.
   */
  private sampleBilinear(
    data: Uint8ClampedArray,
    tw: number,
    th: number,
    u: number,
    v: number,
  ): void {
    const uInt = u | 0;
    const vInt = v | 0;
    const u0 = ((uInt % tw) + tw) % tw;
    const v0 = ((vInt % th) + th) % th;
    const u1 = (u0 + 1) % tw;
    const v1 = (v0 + 1) % th;
    const fu = u - uInt;
    const fv = v - vInt;

    const w00 = (1 - fu) * (1 - fv);
    const w10 = fu * (1 - fv);
    const w01 = (1 - fu) * fv;
    const w11 = fu * fv;

    const i00 = (v0 * tw + u0) * 4;
    const i10 = (v0 * tw + u1) * 4;
    const i01 = (v1 * tw + u0) * 4;
    const i11 = (v1 * tw + u1) * 4;

    this.sR = data[i00]! * w00 + data[i10]! * w10 + data[i01]! * w01 + data[i11]! * w11;
    this.sG =
      data[i00 + 1]! * w00 + data[i10 + 1]! * w10 + data[i01 + 1]! * w01 + data[i11 + 1]! * w11;
    this.sB =
      data[i00 + 2]! * w00 + data[i10 + 2]! * w10 + data[i01 + 2]! * w01 + data[i11 + 2]! * w11;
  }

  /**
   * Render one wall column into the scratch `columnWallBuffer` at full
   * opacity, with side darken / fog / AO baked in. The buffer feeds both
   * the floor/ceiling pass (mirror reflection) and the composite step.
   */
  private renderWallToColumn(
    scene: Scene,
    hit: WallHit,
    wallTop: number,
    wallHeight: number,
    canvasHeight: number,
    fogInv: number,
  ): void {
    const wallBottom = wallTop + wallHeight;
    const screenTop = Math.max(0, Math.floor(wallTop));
    const screenBottom = Math.min(canvasHeight, Math.ceil(wallBottom));
    if (screenBottom <= screenTop) return;

    const texture = this.textures.get(hit.tile);

    const sideMul = hit.side === WallSide.Horizontal ? 0.7 : 1.0;
    const fogMul = Math.max(0, Math.min(1, 1 - hit.perpDistance * fogInv));
    const baseShade = sideMul * fogMul;

    // Lightmap sample — Phase 1 uses ONE sample per slab at the hit cell's
    // centre, applied uniformly to every wall pixel. Phase 3 of the
    // lighting overhaul will switch to per-vertical-segment samples so
    // tall walls can show a lightmap gradient.
    // TODO(LIGHTING_OVERHAUL.md § 3.3 / Phase 3): sample per-segment.
    scene.sampleFloorLight(hit.cell.x + 0.5, hit.cell.y + 0.5, this.lightSample);
    const lightR = this.lightSample[0];
    const lightG = this.lightSample[1];
    const lightB = this.lightSample[2];
    // Dynamic-light add — one sample per slab at the cell centre (same
    // model the static lightmap uses for wall pixels in Phase 1). Phase
    // 3 of the lighting overhaul will move to per-vertical-segment
    // samples; until then a one-shot per-slab add matches the static
    // path. Premultiplied into `dynR/G/B` (in [0,1] colour space).
    let dynR = 0;
    let dynG = 0;
    let dynB = 0;
    if (this.dynamicLights.length > 0) {
      this.accumulateDynamicLight(scene, hit.cell.x + 0.5, hit.cell.y + 0.5);
      dynR = this.dynamicSample[0];
      dynG = this.dynamicSample[1];
      dynB = this.dynamicSample[2];
    }
    // Emissive add — self-illumination is independent of the lightmap.
    // Phase 4: cap pixels share the wall slab's emissive (same segment,
    // same colour). See LIGHTING_OVERHAUL.md § 3.2.
    const em = hit.segment.emissive;
    const emR = em ? em.color[0] * em.intensity * 255 : 0;
    const emG = em ? em.color[1] * em.intensity * 255 : 0;
    const emB = em ? em.color[2] * em.intensity * 255 : 0;

    const aoBotStrength = 1 - WALL_AO_DARKEN;
    const aoBotStart = wallTop + wallHeight * (1 - WALL_AO_BAND);
    const aoBotSpanInv = 1 / (wallHeight * WALL_AO_BAND);
    const aoTopStrength = 1 - WALL_AO_DARKEN_TOP;
    const aoTopEnd = wallTop + wallHeight * WALL_AO_BAND_TOP;
    const aoTopSpanInv = 1 / (wallHeight * WALL_AO_BAND_TOP);

    const cbData = this.columnWallBuffer;
    let cbIdx = screenTop * 4;

    if (texture) {
      const srcData = texture.data;
      const texW = texture.width;
      const texH = texture.height;
      // Wall-local UVs: the segment's [startZ, startZ + height] maps to
      // [0, texture.height], then `offsetX`/`offsetY` slide the sample
      // by that many texels. Both axes wrap modulo the texture size.
      const texUf = hit.wallU * texW + hit.segment.offsetX;
      const texU = ((((texUf | 0) % texW) + texW) % texW) | 0;
      const texStep = texH / wallHeight;
      let texV = (screenTop - wallTop) * texStep + hit.segment.offsetY;

      for (let y = screenTop; y < screenBottom; y++) {
        const botT = Math.max(0, (y - aoBotStart) * aoBotSpanInv);
        const topT = Math.max(0, (aoTopEnd - y) * aoTopSpanInv);
        const shade =
          baseShade * (1 - aoBotStrength * botT * botT) * (1 - aoTopStrength * topT * topT);

        let r: number, g: number, b: number;
        if (this.bilinear) {
          this.sampleBilinear(srcData, texW, texH, texUf, texV);
          r = this.sR;
          g = this.sG;
          b = this.sB;
        } else {
          const tv = ((((texV | 0) % texH) + texH) % texH) | 0;
          const srcIdx = (tv * texW + texU) * 4;
          r = srcData[srcIdx]!;
          g = srcData[srcIdx + 1]!;
          b = srcData[srcIdx + 2]!;
        }

        // Dynamic add uses raw albedo (no side darken / AO / fog) so a
        // dynamic light still illuminates the dark side of a corner or
        // a far-away wall. Matches LIGHTING_OVERHAUL.md § 5.3's
        // `r += albedoR * light.color * atten` model.
        cbData[cbIdx] = (r * shade * lightR + r * dynR + emR) | 0;
        cbData[cbIdx + 1] = (g * shade * lightG + g * dynG + emG) | 0;
        cbData[cbIdx + 2] = (b * shade * lightB + b * dynB + emB) | 0;
        cbData[cbIdx + 3] = 255;
        cbIdx += 4;
        texV += texStep;
      }
    } else {
      const base = TILE_COLORS[hit.tile] ?? DEFAULT_TILE_COLOR;
      for (let y = screenTop; y < screenBottom; y++) {
        const botT = Math.max(0, (y - aoBotStart) * aoBotSpanInv);
        const topT = Math.max(0, (aoTopEnd - y) * aoTopSpanInv);
        const shade =
          baseShade * (1 - aoBotStrength * botT * botT) * (1 - aoTopStrength * topT * topT);
        cbData[cbIdx] = (base.r * shade * lightR + base.r * dynR + emR) | 0;
        cbData[cbIdx + 1] = (base.g * shade * lightG + base.g * dynG + emG) | 0;
        cbData[cbIdx + 2] = (base.b * shade * lightB + base.b * dynB + emB) | 0;
        cbData[cbIdx + 3] = 255;
        cbIdx += 4;
      }
    }
  }

  /**
   * Render the horizontal cap surfaces for a wall slab — the top face
   * visible from above (camera looking down on a knee-wall) and the
   * bottom face visible from below (looking up under a window header).
   *
   * The cap occupies the screen rows between the slab edge (`wallTop`
   * for the top cap, `wallBottom` for the bottom) and the back-face edge
   * projection of the wall cell along this ray. Cap pixels overwrite the
   * floor/ceiling pass's earlier output. Skipped when the cap is at the
   * cell ceiling (top = 1) or floor (bottom = 0), or edge-on with the
   * camera eye.
   */
  private renderCapColumn(
    scene: Scene,
    hit: WallHit,
    position: Vec2,
    rayDir: Vec2,
    x: number,
    cameraZ: number,
    horizonY: number,
    unitH: number,
    fogInv: number,
  ): void {
    const seg = hit.segment;
    const dFront = hit.perpDistance;
    const dBack = hit.perpDistanceBack;
    const topZ = seg.startZ + seg.height;
    const bottomZ = seg.startZ;
    // Cap pixels share the wall segment's emissive — cap is just the
    // top/bottom face of the same slab.
    const em = seg.emissive;
    const emR = em ? em.color[0] * em.intensity * 255 : 0;
    const emG = em ? em.color[1] * em.intensity * 255 : 0;
    const emB = em ? em.color[2] * em.intensity * 255 : 0;

    // ── Top cap (looking down) ─────────────────────────────────────────
    if (topZ < 1 && cameraZ > topZ) {
      const topTile = seg.topTile ?? seg.tile;
      if (topTile > 0) {
        const dz = cameraZ - topZ;
        // The slab front edge in screen y maps to dFront → this is the
        // existing wallTop. The cap extends back to dBack, which yields
        // a smaller (closer to horizon) y above the slab.
        const yFront = horizonY + (dz * unitH) / dFront;
        const yBack = horizonY + (dz * unitH) / dBack;
        this.fillCapBand(
          scene,
          yBack,
          yFront,
          x,
          position,
          rayDir,
          dz,
          horizonY,
          unitH,
          fogInv,
          topTile,
          emR,
          emG,
          emB,
        );
      }
    }

    // ── Bottom cap (looking up) ────────────────────────────────────────
    if (bottomZ > 0 && cameraZ < bottomZ) {
      const botTile = seg.bottomTile ?? seg.tile;
      if (botTile > 0) {
        const dz = cameraZ - bottomZ; // negative — camera below cap
        const yFront = horizonY + (dz * unitH) / dFront;
        const yBack = horizonY + (dz * unitH) / dBack;
        // dz < 0 ⇒ both y values < horizonY, yBack > yFront (closer to
        // horizon means larger y on the upper half).
        this.fillCapBand(
          scene,
          yFront,
          yBack,
          x,
          position,
          rayDir,
          dz,
          horizonY,
          unitH,
          fogInv,
          botTile,
          emR,
          emG,
          emB,
        );
      }
    }
  }

  /**
   * Fill a vertical span `[yMin, yMax)` of one column with the cap
   * surface at world `z = cameraZ − dz`. Each row solves the perspective
   * `distance = dz * H / (y − horizonY)` to find which world point the
   * pixel sees, then samples the cap texture at that point's
   * `(fract(x), fract(y))`. Fog matches the floor/ceiling pass.
   */
  private fillCapBand(
    scene: Scene,
    yMinRaw: number,
    yMaxRaw: number,
    x: number,
    position: Vec2,
    rayDir: Vec2,
    dz: number,
    horizonY: number,
    unitH: number,
    fogInv: number,
    capTile: number,
    // Emissive add (premultiplied into 0..255 byte space). Pass zeros
    // for non-emissive caps. Caller computes once per slab.
    emR: number = 0,
    emG: number = 0,
    emB: number = 0,
  ): void {
    // Clip to the actual canvas (`this.canvas.height`); `unitH` is the
    // aspect-correct pixels-per-world-Z scale for the projection math
    // and is not necessarily the canvas height.
    const canvasHeight = this.canvas.height;
    const yStart = Math.max(0, Math.ceil(yMinRaw));
    const yEnd = Math.min(canvasHeight, Math.floor(yMaxRaw));
    if (yEnd <= yStart) return;

    const texture = this.textures.get(capTile);
    const dstStride = this.canvas.width * 4;
    const dstData = this.buffer;
    let dstIdx = yStart * dstStride + x * 4;

    if (texture) {
      const srcData = texture.data;
      const texW = texture.width;
      const texH = texture.height;
      for (let y = yStart; y < yEnd; y++) {
        const p = y - horizonY;
        if (p === 0) {
          dstIdx += dstStride;
          continue;
        }
        const d = (dz * unitH) / p;
        if (d <= 0) {
          dstIdx += dstStride;
          continue;
        }
        const worldX = position.x + d * rayDir.x;
        const worldY = position.y + d * rayDir.y;
        const fracX = worldX - Math.floor(worldX);
        const fracY = worldY - Math.floor(worldY);
        const fogMul = Math.max(0, Math.min(1, 1 - d * fogInv));

        let aR: number, aG: number, aB: number;
        if (this.bilinear) {
          this.sampleBilinear(srcData, texW, texH, fracX * texW, fracY * texH);
          aR = this.sR;
          aG = this.sG;
          aB = this.sB;
        } else {
          const tx = (fracX * texW) | 0;
          const ty = (fracY * texH) | 0;
          const idx = (ty * texW + tx) * 4;
          aR = srcData[idx]!;
          aG = srcData[idx + 1]!;
          aB = srcData[idx + 2]!;
        }
        let r = aR * fogMul;
        let g = aG * fogMul;
        let b = aB * fogMul;
        // Per-pixel static lightmap sample at the cap's world point.
        scene.sampleFloorLight(worldX, worldY, this.lightSample);
        r *= this.lightSample[0];
        g *= this.lightSample[1];
        b *= this.lightSample[2];
        // Per-pixel dynamic-light add — raw albedo (no fog) so a
        // dynamic light reaches into fogged distance. Matches the
        // floor/ceiling pass's `r += albedo * dynamicSample` model.
        if (this.dynamicLights.length > 0) {
          this.accumulateDynamicLight(scene, worldX, worldY);
          r += aR * this.dynamicSample[0];
          g += aG * this.dynamicSample[1];
          b += aB * this.dynamicSample[2];
        }
        dstData[dstIdx] = (r + emR) | 0;
        dstData[dstIdx + 1] = (g + emG) | 0;
        dstData[dstIdx + 2] = (b + emB) | 0;
        dstData[dstIdx + 3] = 255;
        dstIdx += dstStride;
      }
    } else {
      // No texture → solid fallback (cap tile color, default if unknown).
      const base = TILE_COLORS[capTile] ?? DEFAULT_TILE_COLOR;
      for (let y = yStart; y < yEnd; y++) {
        const p = y - horizonY;
        if (p === 0) {
          dstIdx += dstStride;
          continue;
        }
        const d = (dz * unitH) / p;
        if (d <= 0) {
          dstIdx += dstStride;
          continue;
        }
        const worldX = position.x + d * rayDir.x;
        const worldY = position.y + d * rayDir.y;
        const fogMul = Math.max(0, Math.min(1, 1 - d * fogInv));
        // Per-pixel static lightmap sample at the cap's world point.
        scene.sampleFloorLight(worldX, worldY, this.lightSample);
        let r = base.r * fogMul * this.lightSample[0];
        let g = base.g * fogMul * this.lightSample[1];
        let b = base.b * fogMul * this.lightSample[2];
        if (this.dynamicLights.length > 0) {
          this.accumulateDynamicLight(scene, worldX, worldY);
          r += base.r * this.dynamicSample[0];
          g += base.g * this.dynamicSample[1];
          b += base.b * this.dynamicSample[2];
        }
        dstData[dstIdx] = (r + emR) | 0;
        dstData[dstIdx + 1] = (g + emG) | 0;
        dstData[dstIdx + 2] = (b + emB) | 0;
        dstData[dstIdx + 3] = 255;
        dstIdx += dstStride;
      }
    }
  }

  /**
   * Alpha-blend the wall column from `columnWallBuffer` onto the main
   * buffer with edge-AA + reflective-band fade.
   */
  private compositeWallColumn(
    x: number,
    wallTop: number,
    wallBottom: number,
    wallHeight: number,
  ): void {
    const canvasHeight = this.canvas.height;
    const screenTop = Math.max(0, Math.floor(wallTop));
    const screenBottom = Math.min(canvasHeight, Math.ceil(wallBottom));
    if (screenBottom <= screenTop) return;

    const reflBandTopEnd = wallTop + wallHeight * WALL_REFL_BAND;
    const reflBandTopSpanInv = 1 / (wallHeight * WALL_REFL_BAND);
    const reflBandBotStart = wallTop + wallHeight * (1 - WALL_REFL_BAND);
    const reflBandBotSpanInv = 1 / (wallHeight * WALL_REFL_BAND);

    const dstStride = this.canvas.width * 4;
    const dstData = this.buffer;
    const cbData = this.columnWallBuffer;
    let dstIdx = screenTop * dstStride + x * 4;
    let cbIdx = screenTop * 4;

    for (let y = screenTop; y < screenBottom; y++) {
      let cover = 1;
      if (y === screenTop && wallTop > screenTop) cover = 1 - (wallTop - screenTop);
      if (y === screenBottom - 1 && wallBottom < y + 1) cover = wallBottom - y;

      const topReflT = Math.max(0, (reflBandTopEnd - y) * reflBandTopSpanInv);
      const botReflT = Math.max(0, (y + 1 - reflBandBotStart) * reflBandBotSpanInv);
      const fadeT = topReflT > botReflT ? topReflT : botReflT;
      const reflFade = WALL_REFL_STRENGTH * fadeT * fadeT;

      const alpha = cover * (1 - reflFade);

      if (alpha >= 1) {
        dstData[dstIdx] = cbData[cbIdx]!;
        dstData[dstIdx + 1] = cbData[cbIdx + 1]!;
        dstData[dstIdx + 2] = cbData[cbIdx + 2]!;
        dstData[dstIdx + 3] = 255;
      } else if (alpha > 0) {
        const inv = 1 - alpha;
        dstData[dstIdx] = (cbData[cbIdx]! * alpha + dstData[dstIdx]! * inv) | 0;
        dstData[dstIdx + 1] = (cbData[cbIdx + 1]! * alpha + dstData[dstIdx + 1]! * inv) | 0;
        dstData[dstIdx + 2] = (cbData[cbIdx + 2]! * alpha + dstData[dstIdx + 2]! * inv) | 0;
        dstData[dstIdx + 3] = 255;
      }

      dstIdx += dstStride;
      cbIdx += 4;
    }
  }

  /**
   * Floor and ceiling rendering for a single column. Walks `p` outward from
   * the horizon, drawing the floor row `horizonY + p` and the matching
   * ceiling row `horizonY - p` together — they sample the same world cell.
   */
  private drawFloorCeilingColumn(
    scene: Scene,
    position: Vec2,
    rayDir: Vec2,
    camera: CameraData,
    x: number,
    fogInv: number,
    horizonY: number,
    posZ: number,
    _wallTop: number,
    _wallBottom: number,
    hasWall: boolean,
  ): void {
    const dstStride = this.canvas.width * 4;
    const canvasHeight = this.canvas.height;
    const buffer = this.buffer;
    const cbData = this.columnWallBuffer;
    // Per-column slab list — the multi-slab mirror branch below walks
    // these to find the nearest slab whose screen-y range brackets the
    // mirrored pixel. Without this, only the FIRST hit reflects.
    const slabs = this.columnSlabs;
    const slabCount = this.columnSlabCount;

    // Floor row distance uses `posZ = cameraZ * unitH`. The matching ceiling
    // row distance is `(1 - cameraZ) * unitH = posZCeil` — they only coincide
    // when `cameraZ === 0.5`. We need the separate value to sample the
    // lightmap at the ceiling's actual world hit point under jump / crouch,
    // matching the WebGL backend (FRAG_WORLD_SRC uses `surfaceZ = 1 - cameraZ`).
    const cameraZ = camera.cameraZ ?? 0.5;
    const posZCeil = posZ === 0 ? 0 : (posZ * (1 - cameraZ)) / cameraZ;

    // The visible range above/below the horizon can differ when horizonY
    // is shifted, so iterate p out to whichever half is taller.
    const maxP = Math.max(horizonY, canvasHeight - horizonY) | 0;
    for (let p = 1; p < maxP; p++) {
      const yFloor = (horizonY + p) | 0;
      const yCeil = (horizonY - p - 1) | 0;
      const floorVisible = yFloor >= 0 && yFloor < canvasHeight;
      const ceilVisible = yCeil >= 0 && yCeil < canvasHeight;
      if (!floorVisible && !ceilVisible) continue;
      const rowDistance = posZ / p;
      const ceilRowDistance = posZCeil / p;

      const worldX = position.x + rowDistance * rayDir.x;
      const worldY = position.y + rowDistance * rayDir.y;
      // Ceiling samples its own world point — at jump / crouch this is a
      // different cell than the floor row at the same screen-y.
      const ceilWorldX = position.x + ceilRowDistance * rayDir.x;
      const ceilWorldY = position.y + ceilRowDistance * rayDir.y;
      const cellX = Math.floor(worldX);
      const cellY = Math.floor(worldY);
      const cell = scene.getCell(cellX, cellY);

      const fracX = worldX - cellX;
      const fracY = worldY - cellY;
      const fogMul = Math.max(0, Math.min(1, 1 - rowDistance * fogInv));

      // Base floor color
      let floorR: number, floorG: number, floorB: number;
      const floorTex = this.textures.get(cell.floor.tile);
      if (floorTex) {
        if (this.bilinear) {
          this.sampleBilinear(
            floorTex.data,
            floorTex.width,
            floorTex.height,
            fracX * floorTex.width,
            fracY * floorTex.height,
          );
          floorR = this.sR * fogMul;
          floorG = this.sG * fogMul;
          floorB = this.sB * fogMul;
        } else {
          const tx = (fracX * floorTex.width) | 0;
          const ty = (fracY * floorTex.height) | 0;
          const idx = (ty * floorTex.width + tx) * 4;
          floorR = floorTex.data[idx]! * fogMul;
          floorG = floorTex.data[idx + 1]! * fogMul;
          floorB = floorTex.data[idx + 2]! * fogMul;
        }
      } else {
        const c = TILE_COLORS[cell.floor.tile] ?? camera.floor;
        floorR = c.r * fogMul;
        floorG = c.g * fogMul;
        floorB = c.b * fogMul;
      }

      // Base ceiling color
      let ceilR: number, ceilG: number, ceilB: number;
      const ceilTex = this.textures.get(cell.ceiling.tile);
      if (ceilTex) {
        if (this.bilinear) {
          this.sampleBilinear(
            ceilTex.data,
            ceilTex.width,
            ceilTex.height,
            fracX * ceilTex.width,
            fracY * ceilTex.height,
          );
          ceilR = this.sR * fogMul;
          ceilG = this.sG * fogMul;
          ceilB = this.sB * fogMul;
        } else {
          const tx = (fracX * ceilTex.width) | 0;
          const ty = (fracY * ceilTex.height) | 0;
          const idx = (ty * ceilTex.width + tx) * 4;
          ceilR = ceilTex.data[idx]! * fogMul;
          ceilG = ceilTex.data[idx + 1]! * fogMul;
          ceilB = ceilTex.data[idx + 2]! * fogMul;
        }
      } else {
        const c = TILE_COLORS[cell.ceiling.tile] ?? camera.ceiling;
        ceilR = c.r * fogMul;
        ceilG = c.g * fogMul;
        ceilB = c.b * fogMul;
      }

      // Effective reflectiveness with bilinear neighbor blend (transition).
      const bdx = fracX < 0.5 ? -1 : 1;
      const bdy = fracY < 0.5 ? -1 : 1;
      const bix = fracX < 0.5 ? 1 - 2 * fracX : 2 * fracX - 1;
      const biy = fracY < 0.5 ? 1 - 2 * fracY : 2 * fracY - 1;
      const w00 = (1 - bix) * (1 - biy);
      const w10 = bix * (1 - biy);
      const w01 = (1 - bix) * biy;
      const w11 = bix * biy;

      const ownFRefl = cell.floor.reflectiveness;
      const fTrans = cell.floor.transition;
      let fRefl: number;
      if (fTrans > 0) {
        const r10 = scene.getCell(cellX + bdx, cellY).floor.reflectiveness;
        const r01 = scene.getCell(cellX, cellY + bdy).floor.reflectiveness;
        const r11 = scene.getCell(cellX + bdx, cellY + bdy).floor.reflectiveness;
        const bilinear = ownFRefl * w00 + r10 * w10 + r01 * w01 + r11 * w11;
        fRefl = ownFRefl + (bilinear - ownFRefl) * fTrans;
      } else {
        fRefl = ownFRefl;
      }

      const ownCRefl = cell.ceiling.reflectiveness;
      const cTrans = cell.ceiling.transition;
      let cRefl: number;
      if (cTrans > 0) {
        const r10 = scene.getCell(cellX + bdx, cellY).ceiling.reflectiveness;
        const r01 = scene.getCell(cellX, cellY + bdy).ceiling.reflectiveness;
        const r11 = scene.getCell(cellX + bdx, cellY + bdy).ceiling.reflectiveness;
        const bilinear = ownCRefl * w00 + r10 * w10 + r01 * w01 + r11 * w11;
        cRefl = ownCRefl + (bilinear - ownCRefl) * cTrans;
      } else {
        cRefl = ownCRefl;
      }

      // Floor reflectiveness — wall-band mirror first, then tiled ceiling.
      if (fRefl > 0) {
        let refR: number, refG: number, refB: number;
        let usedWallMirror = false;
        if (hasWall) {
          // Multi-slab mirror: a knee wall in front of a tall wall must
          // reflect both. Iterate every slab on this column; pick the
          // nearest whose `[wallTop, wallBottom]` brackets the mirrored
          // floor-pixel y. The slab's own `wallBottom` is the pivot
          // (each slab mirrors about its OWN front face).
          const sCount = slabCount[x]!;
          const sBase = x * MAX_SLABS_PER_COLUMN * 3;
          let bestPerp = Infinity;
          let bestMirror = -1;
          for (let s = 0; s < sCount; s++) {
            const o = sBase + s * 3;
            const sPerp = slabs[o]!;
            if (sPerp <= 0 || sPerp >= bestPerp) continue;
            const sTop = slabs[o + 1]!;
            const sBot = slabs[o + 2]!;
            const sMirror = (2 * sBot - yFloor) | 0;
            if (sMirror >= sTop && sMirror < sBot) {
              bestPerp = sPerp;
              bestMirror = sMirror;
            }
          }
          if (bestMirror >= 0 && bestMirror < canvasHeight) {
            const cbIdx = bestMirror * 4;
            refR = cbData[cbIdx]!;
            refG = cbData[cbIdx + 1]!;
            refB = cbData[cbIdx + 2]!;
            usedWallMirror = true;
          }
        }
        if (!usedWallMirror) {
          if (ceilTex) {
            const tw = ceilTex.width;
            const th = ceilTex.height;
            if (this.bilinear) {
              this.sampleBilinear(
                ceilTex.data,
                tw,
                th,
                fracX * REFLECTION_TILE_SCALE * tw,
                fracY * REFLECTION_TILE_SCALE * th,
              );
              refR = this.sR * fogMul;
              refG = this.sG * fogMul;
              refB = this.sB * fogMul;
            } else {
              const tx = ((fracX * REFLECTION_TILE_SCALE * tw) | 0) % tw;
              const ty = ((fracY * REFLECTION_TILE_SCALE * th) | 0) % th;
              const idx = (ty * tw + tx) * 4;
              refR = ceilTex.data[idx]! * fogMul;
              refG = ceilTex.data[idx + 1]! * fogMul;
              refB = ceilTex.data[idx + 2]! * fogMul;
            }
          } else {
            refR = ceilR;
            refG = ceilG;
            refB = ceilB;
          }
        }
        floorR = floorR + (refR! - floorR) * fRefl;
        floorG = floorG + (refG! - floorG) * fRefl;
        floorB = floorB + (refB! - floorB) * fRefl;
      }

      // Ceiling reflectiveness — symmetric mirror about wallTop, then tiled floor.
      if (cRefl > 0) {
        let refR: number, refG: number, refB: number;
        let usedWallMirror = false;
        if (hasWall) {
          // Symmetric multi-slab pick — each slab mirrors the ceiling
          // pixel about its OWN top edge. Nearest matching slab wins.
          const sCount = slabCount[x]!;
          const sBase = x * MAX_SLABS_PER_COLUMN * 3;
          let bestPerp = Infinity;
          let bestMirror = -1;
          for (let s = 0; s < sCount; s++) {
            const o = sBase + s * 3;
            const sPerp = slabs[o]!;
            if (sPerp <= 0 || sPerp >= bestPerp) continue;
            const sTop = slabs[o + 1]!;
            const sBot = slabs[o + 2]!;
            const sMirror = (2 * sTop - yCeil) | 0;
            if (sMirror >= sTop && sMirror < sBot) {
              bestPerp = sPerp;
              bestMirror = sMirror;
            }
          }
          if (bestMirror >= 0 && bestMirror < canvasHeight) {
            const cbIdx = bestMirror * 4;
            refR = cbData[cbIdx]!;
            refG = cbData[cbIdx + 1]!;
            refB = cbData[cbIdx + 2]!;
            usedWallMirror = true;
          }
        }
        if (!usedWallMirror) {
          if (floorTex) {
            const tw = floorTex.width;
            const th = floorTex.height;
            if (this.bilinear) {
              this.sampleBilinear(
                floorTex.data,
                tw,
                th,
                fracX * REFLECTION_TILE_SCALE * tw,
                fracY * REFLECTION_TILE_SCALE * th,
              );
              refR = this.sR * fogMul;
              refG = this.sG * fogMul;
              refB = this.sB * fogMul;
            } else {
              const tx = ((fracX * REFLECTION_TILE_SCALE * tw) | 0) % tw;
              const ty = ((fracY * REFLECTION_TILE_SCALE * th) | 0) % th;
              const idx = (ty * tw + tx) * 4;
              refR = floorTex.data[idx]! * fogMul;
              refG = floorTex.data[idx + 1]! * fogMul;
              refB = floorTex.data[idx + 2]! * fogMul;
            }
          } else {
            refR = floorR;
            refG = floorG;
            refB = floorB;
          }
        }
        ceilR = ceilR + (refR! - ceilR) * cRefl;
        ceilG = ceilG + (refG! - ceilG) * cRefl;
        ceilB = ceilB + (refB! - ceilB) * cRefl;
      }

      // World-space AO at cell-type boundaries. Floor + ceiling AO are
      // computed independently because a partial wall only casts a
      // contact shadow on the surface it actually touches: a knee wall
      // shadows the neighbour floor but not the ceiling, a hanging
      // header shadows the ceiling but not the floor.
      const floorProx = computeProx(scene, cellX, cellY, fracX, fracY, "floor");
      const ceilProx = computeProx(scene, cellX, cellY, fracX, fracY, "ceiling");
      if (floorProx > 0) {
        const aoT = Math.max(0, (floorProx - (1 - FLOOR_AO_BAND)) / FLOOR_AO_BAND);
        const aoMul = 1 - (1 - FLOOR_AO_DARKEN) * aoT * aoT;
        floorR *= aoMul;
        floorG *= aoMul;
        floorB *= aoMul;
      }
      if (ceilProx > 0) {
        const aoT = Math.max(0, (ceilProx - (1 - FLOOR_AO_BAND)) / FLOOR_AO_BAND);
        const aoMul = 1 - (1 - FLOOR_AO_DARKEN) * aoT * aoT;
        ceilR *= aoMul;
        ceilG *= aoMul;
        ceilB *= aoMul;
      }

      // Per-row static lightmap sample. Floor and ceiling sample at their
      // own world hit points — they only coincide when `cameraZ === 0.5`.
      // Matches the WebGL backend's `surfaceZ = 1 - cameraZ` ceiling sample
      // so the two backends agree under jump / crouch.
      scene.sampleFloorLight(worldX, worldY, this.lightSample);
      // Capture albedo for the dynamic-light add — needs the pre-lightmap
      // colour so we add `albedo * lightColor * atten` rather than
      // `litColor * lightColor * atten` (which would attenuate the dynamic
      // contribution by the static darkness). The albedo here already
      // has fog baked in (see the texture branches above); dynamic light
      // therefore fades with distance the same way the WebGL backend's
      // `surfaceColor * (staticLight + dynamicLight)` does. Acceptable
      // for Phase 5 — fog and dynamic-light radius overlap well in
      // practice and a full albedo recapture would require a deeper
      // refactor of this hot loop.
      const floorAlbedoR = floorR;
      const floorAlbedoG = floorG;
      const floorAlbedoB = floorB;
      floorR *= this.lightSample[0];
      floorG *= this.lightSample[1];
      floorB *= this.lightSample[2];
      scene.sampleCeilingLight(ceilWorldX, ceilWorldY, this.lightSample);
      const ceilAlbedoR = ceilR;
      const ceilAlbedoG = ceilG;
      const ceilAlbedoB = ceilB;
      ceilR *= this.lightSample[0];
      ceilG *= this.lightSample[1];
      ceilB *= this.lightSample[2];

      // Dynamic-light add — per-pixel for floor/ceiling. The
      // `accumulateDynamicLight` helper handles radius cull + LOS test
      // and writes into `this.dynamicSample` (in [0,1] colour space).
      if (this.dynamicLights.length > 0) {
        if (floorVisible) {
          this.accumulateDynamicLight(scene, worldX, worldY);
          floorR += floorAlbedoR * this.dynamicSample[0];
          floorG += floorAlbedoG * this.dynamicSample[1];
          floorB += floorAlbedoB * this.dynamicSample[2];
        }
        if (ceilVisible) {
          this.accumulateDynamicLight(scene, ceilWorldX, ceilWorldY);
          ceilR += ceilAlbedoR * this.dynamicSample[0];
          ceilG += ceilAlbedoG * this.dynamicSample[1];
          ceilB += ceilAlbedoB * this.dynamicSample[2];
        }
      }

      // Emissive self-illumination — added AFTER the lightmap multiply
      // so glowing surfaces are visible even in pitch-dark cells. The
      // ceiling cell sampled is `(cellX, cellY)` here because we look
      // up the cell using the floor's world position; that's fine for
      // standing (floor and ceiling rows hit the same cell) but breaks
      // mildly under aggressive jump/crouch when the ceiling row's
      // world position lands in a neighbour cell. Acceptable for
      // Phase 4 — fix it alongside the cap-cell emissive lookup.
      const fEm = cell.floor.emissive;
      if (fEm !== undefined) {
        floorR += fEm.color[0] * fEm.intensity * 255;
        floorG += fEm.color[1] * fEm.intensity * 255;
        floorB += fEm.color[2] * fEm.intensity * 255;
      }
      const cEm = cell.ceiling.emissive;
      if (cEm !== undefined) {
        ceilR += cEm.color[0] * cEm.intensity * 255;
        ceilG += cEm.color[1] * cEm.intensity * 255;
        ceilB += cEm.color[2] * cEm.intensity * 255;
      }

      // Write both rows — each only if it's actually inside the canvas.
      if (floorVisible) {
        const floorIdx = yFloor * dstStride + x * 4;
        buffer[floorIdx] = floorR | 0;
        buffer[floorIdx + 1] = floorG | 0;
        buffer[floorIdx + 2] = floorB | 0;
        buffer[floorIdx + 3] = 255;
      }

      if (ceilVisible) {
        const ceilIdx = yCeil * dstStride + x * 4;
        buffer[ceilIdx] = ceilR | 0;
        buffer[ceilIdx + 1] = ceilG | 0;
        buffer[ceilIdx + 2] = ceilB | 0;
        buffer[ceilIdx + 3] = 255;
      }
    }
  }

  /**
   * Walk every dynamic light against the world position `(wx, wy)` and
   * accumulate the (radius-attenuated, LOS-tested) contribution into
   * `this.dynamicSample`. Result is in the same `[0, 1]` colour space as
   * the static lightmap — callers multiply it by albedo (in `[0, 255]`)
   * and add to the lit colour. See LIGHTING_OVERHAUL.md § 5.3 / § 6.
   *
   * Cheap path: radius² early-out, smoothstep-style falloff
   * `(1 − d/r)² × intensity`, and a Bresenham-style grid stepper for
   * LOS that bails as soon as it hits a `scene.isFullOccluder` cell.
   * Step count capped at `ceil(dist) + 2` so far-away lights don't
   * blow the budget.
   */
  private accumulateDynamicLight(scene: Scene, wx: number, wy: number): void {
    let dr = 0;
    let dg = 0;
    let db = 0;
    const lights = this.dynamicLights;
    const n = LIGHT_JITTER_SAMPLES;
    const invN = 1 / n;
    for (let i = 0; i < lights.length; i++) {
      const L = lights[i]!;
      const dx = L.x - wx;
      const dy = L.y - wy;
      const dist2 = dx * dx + dy * dy;
      const r = L.radius;
      if (dist2 > r * r) continue;
      const dist = Math.sqrt(dist2);
      // Soft-shadow coverage: average N LOS tests at jittered light
      // positions. Slot 0 is the nominal position (matches the bake's
      // convention); N=1 collapses to the original hard-shadow path.
      let visible = 0;
      for (let s = 0; s < n; s++) {
        const off = LIGHT_JITTER_OFFSETS[s]!;
        if (this.losVisible(scene, wx, wy, L.x + off[0], L.y + off[1])) {
          visible++;
        }
      }
      if (visible === 0) continue;
      const coverage = visible * invN;
      const t = 1 - dist / r;
      const atten = t * t * L.intensity * coverage;
      dr += L.color[0] * atten;
      dg += L.color[1] * atten;
      db += L.color[2] * atten;
    }
    this.dynamicSample[0] = dr;
    this.dynamicSample[1] = dg;
    this.dynamicSample[2] = db;
  }

  /**
   * Cheap grid-step LOS — Bresenham-style walk from `(ax, ay)` to
   * `(bx, by)` checking `scene.isFullOccluder` at each integer cell
   * crossed. Returns false on the first hit. Capped at `ceil(dist) + 2`
   * steps so the worst-case light × pixel cost stays bounded.
   *
   * Fail-closed: if the stepper exits at the step cap without reaching
   * the destination cell, we treat the path as blocked. This avoids
   * faint light leaking through thick wall stacks at the edge of a
   * light's radius.
   */
  private losVisible(scene: Scene, ax: number, ay: number, bx: number, by: number): boolean {
    const dx = bx - ax;
    const dy = by - ay;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist < 1e-6) return true;
    const maxSteps = Math.ceil(dist) + 2;
    // Sub-cell step length; ≤ 1 cell per iteration so we don't skip
    // diagonal occluders. `Math.max(1, ...)` guards against tiny dists.
    const stepX = dx / maxSteps;
    const stepY = dy / maxSteps;
    let cx = Math.floor(ax);
    let cy = Math.floor(ay);
    const endCellX = Math.floor(bx);
    const endCellY = Math.floor(by);
    let x = ax;
    let y = ay;
    for (let i = 0; i < maxSteps; i++) {
      x += stepX;
      y += stepY;
      const nx = Math.floor(x);
      const ny = Math.floor(y);
      if (nx === cx && ny === cy) continue;
      cx = nx;
      cy = ny;
      // The light's own cell shouldn't occlude — only intermediate
      // cells along the path.
      if (cx === endCellX && cy === endCellY) return true;
      if (scene.isFullOccluder(cx, cy)) return false;
    }
    // Stepper exhausted without reaching the destination cell — treat
    // as blocked (fail-closed). For typical light radii (≤ 8 tiles)
    // this only fires on edge cases.
    return cx === endCellX && cy === endCellY;
  }
}

/**
 * Floor / ceiling AO proximity for the cell at `(cellX, cellY)`. The
 * `surface` argument picks which occluder predicate to use — a knee
 * wall qualifies for floor AO (it sits on the floor) but not ceiling
 * AO; a hanging header is the mirror case.
 *
 * Returns the maximum proximity (0..1) of any neighbour that's a
 * different "occluder type" from the current cell. Diagonal neighbours
 * only contribute when both flanking cardinals are the same type as
 * this cell (matches the existing AO style — no double-darkening on
 * inside corners).
 */
function computeProx(
  scene: Scene,
  cellX: number,
  cellY: number,
  fracX: number,
  fracY: number,
  surface: "floor" | "ceiling",
): number {
  const occ =
    surface === "floor"
      ? (x: number, y: number): boolean => scene.isFloorOccluder(x, y)
      : (x: number, y: number): boolean => scene.isCeilingOccluder(x, y);
  const self = occ(cellX, cellY);
  const aoL = occ(cellX - 1, cellY) !== self;
  const aoR = occ(cellX + 1, cellY) !== self;
  const aoU = occ(cellX, cellY - 1) !== self;
  const aoD = occ(cellX, cellY + 1) !== self;

  let prox = 0;
  if (aoL) {
    const p = 1 - fracX;
    if (p > prox) prox = p;
  }
  if (aoR) {
    const p = fracX;
    if (p > prox) prox = p;
  }
  if (aoU) {
    const p = 1 - fracY;
    if (p > prox) prox = p;
  }
  if (aoD) {
    const p = fracY;
    if (p > prox) prox = p;
  }
  if (!aoL && !aoU && occ(cellX - 1, cellY - 1) !== self) {
    const p = (1 - fracX) * (1 - fracY);
    if (p > prox) prox = p;
  }
  if (!aoR && !aoU && occ(cellX + 1, cellY - 1) !== self) {
    const p = fracX * (1 - fracY);
    if (p > prox) prox = p;
  }
  if (!aoL && !aoD && occ(cellX - 1, cellY + 1) !== self) {
    const p = (1 - fracX) * fracY;
    if (p > prox) prox = p;
  }
  if (!aoR && !aoD && occ(cellX + 1, cellY + 1) !== self) {
    const p = fracX * fracY;
    if (p > prox) prox = p;
  }
  return prox;
}

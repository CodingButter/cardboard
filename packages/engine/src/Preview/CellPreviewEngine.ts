import type { AssetPack } from "AssetPack";
import { Scene, type SceneJSON, type SceneLightmap } from "Scene";
import { Vec2 } from "Libs/Vector";
import { WebGLRenderer } from "Renderers/WebGLRenderer";
import type { CameraData } from "Components";

/**
 * Standalone preview renderer for the editor's right-rail "3D Preview"
 * panel. Wraps the in-game `WebGLRenderer` directly so the preview is
 * pixel-identical to what the engine produces for a real scene — same
 * walls, same materials, same lighting, same fog, same reflections.
 *
 * Architecture:
 *
 *   - Synthesises a 3×3 mini-`Scene` from a `PreviewScene` (preset ids
 *     per cell) using the engine's own `Scene.fromJSON(idMap)` path, so
 *     preset → tile-id resolution goes through the exact same code the
 *     in-game scene loader uses.
 *   - Constructs a `WebGLRenderer` with `embedHud: false` so the preview
 *     canvas doesn't litter the document body with a fullscreen fixed-
 *     position HUD canvas, and doesn't bind a window-level resize
 *     listener.
 *   - No ECS world, no Game lifecycle, no input handling, no audio.
 *     Just `renderer.beginFrame() / drawSky / drawWorld / endFrame` on
 *     a rAF loop, driven by an orbit-camera state.
 *   - Camera is the engine's first-person camera, positioned to orbit
 *     the centre cell of the 3×3 grid at world height 0.5.
 *
 * This is intentionally a thin shell — every rendering decision (wall
 * geometry, materials, partial walls, emissive area-lights, baked
 * lightmaps, reflections, fog) is delegated to the engine renderer.
 *
 * Future surfaces (Image Lab, Sound Lab, Animation Editor) can reuse
 * this same pattern: spin up a minimal `Scene` + `WebGLRenderer` for a
 * preview-only rendering surface without dragging in the full game
 * lifecycle.
 */

/**
 * Authoring shape for the N×N preview scene the editor synthesises
 * from the user's cell selection. Each layer is a flat `size * size`
 * array indexed by `y * size + x`. Null entries leave the cell open
 * / un-floored / un-ceilinged.
 *
 * The current editor synthesises a 12×12 "room" with the focus cell
 * at column 6, row 6 — the engine reads `walls.length` to derive the
 * grid size, so this scales naturally without further engine changes.
 */
export interface PreviewScene {
  /** Wall preset id per cell. `null` = open cell (no wall). */
  walls: ReadonlyArray<string | null>;
  /** Floor preset id per cell. `null` = bare floor (renderer fallback). */
  floors: ReadonlyArray<string | null>;
  /** Ceiling preset id per cell. `null` = bare ceiling. */
  ceilings: ReadonlyArray<string | null>;
  /**
   * Optional focus-cell coordinates (column, row). Used by the
   * camera-derivation step so the orbit centres on the focus cell
   * rather than the geometric grid centre. Defaults to the grid
   * centre when omitted.
   */
  focusX?: number;
  focusY?: number;
}

/**
 * Orbit-camera state. The preview camera doesn't use the same
 * first-person controls as the in-game player — instead the user
 * drags to orbit yaw/pitch around the centre cell, with a fixed
 * `radius` and eye `height`. The engine renderer is fed a derived
 * `position` + `facing` + `cameraZ` so the same code path produces
 * pixels.
 */
export interface OrbitCamera {
  /** Orbit yaw in radians. 0 = looking down +x. */
  yaw: number;
  /** Orbit pitch in radians, clamped by the caller. 0 = level. */
  pitch: number;
  /** Distance from the centre cell, in tile units. */
  radius: number;
  /** Eye height as a fraction of cell height (0..1). Default 0.5. */
  height: number;
}

/**
 * Optional baked-lightmap slice the preview can sample from. When
 * supplied, the engine bakes a per-cell slice of the source scene's
 * lightmap into the mini-scene so the preview reads pixel-identical to
 * the in-game render at the selected cell. When `null` / omitted, the
 * mini-scene falls back to a uniform 1.0 lightmap (renderer's default)
 * and lighting is dynamic-only — the legacy R4b preview behaviour.
 *
 * The source lightmap shape is the engine's runtime `SceneLightmap`
 * (decoded form) — same data the engine renderer reads. Slicing logic
 * lives in `sliceLightmap()` below: for each cell in the mini-scene's
 * N×N grid, we copy the K×K corner samples from the corresponding
 * source-scene cell (selected cell + offset). Cells outside the source
 * grid's bounds get neutral 1.0 samples — the cardboard equivalent of
 * "no bake data, fall through to ambient".
 */
export interface CellPreviewLightmapSource {
  /** Decoded lightmap from the active editor scene. */
  lightmap: SceneLightmap;
  /** Selected source-scene cell (x, y) — slice origin. */
  selectedX: number;
  /** Selected source-scene cell (x, y) — slice origin. */
  selectedY: number;
}

export interface CellPreviewEngineOptions {
  /** Target canvas — the renderer takes ownership of its size. */
  canvas: HTMLCanvasElement;
  /** Initial scene composition. Pass a placeholder if data isn't ready. */
  scene: PreviewScene;
  /** The editor's `IdbAssetPack` (or any `AssetPack` subclass). */
  pack: AssetPack;
  /** Initial camera. Defaults to a 30° off-axis orbit at radius 4.2. */
  camera?: Partial<OrbitCamera>;
  /** Show the wall slab in the centre cell. Default true. */
  showWalls?: boolean;
  /** Show the floor across the whole 3×3 grid. Default true. */
  showFloors?: boolean;
  /** Show the ceiling across the whole 3×3 grid. Default true. */
  showCeilings?: boolean;
  /**
   * Optional baked-lightmap source. When provided, the mini-scene
   * gets a sliced lightmap derived from the active editor scene so
   * the preview shows real bake contribution. When omitted / `null`,
   * the preview renders with dynamic lighting only (uniform 1.0
   * lightmap), matching the legacy R4b behaviour.
   */
  lightmap?: CellPreviewLightmapSource | null;
}

const DEFAULT_CAMERA: OrbitCamera = {
  yaw: Math.PI / 6,
  // Level gaze by default — pitch is the tilt the user adds via
  // vertical drag, clamped to ±30° in the React wrapper. The previous
  // 0.55 rad (≈31°) baked-in upward tilt looked correct only because
  // the broken `deriveCamera` also translated the eye toward the
  // ceiling; with the position fix, a level start matches the
  // cardboard-game's natural head pose.
  pitch: 0,
  radius: 4.2,
  height: 0.5,
};

/**
 * In-shader fog cutoff. The world frag uses `1 - depth × fogInv` for
 * the per-pixel fog multiplier; `fogDistance = Infinity` collapses to
 * "no fog" so the preview shows the surface at full brightness
 * regardless of the orbit radius.
 */
const PREVIEW_FOG_DISTANCE = Number.POSITIVE_INFINITY;
/** Field-of-view in degrees for the preview camera. */
const PREVIEW_FOV_DEG = 60;
/** Sky / floor fallback colours when no surface wins a pixel. zinc-950. */
const PREVIEW_SKY = { r: 12, g: 10, b: 9, a: 255 };

export class CellPreviewEngine {
  private readonly canvas: HTMLCanvasElement;
  private readonly pack: AssetPack;
  private renderer: WebGLRenderer | null = null;
  private scene: Scene | null = null;
  /**
   * The last `PreviewScene` the user passed. Cached so we can rebuild
   * the engine `Scene` when only one of (walls / floors / ceilings)
   * changes — we still re-synthesise the full 3×3 each time, but the
   * caller's setter API doesn't need to track diffs.
   */
  private lastScene: PreviewScene;
  private cameraState: OrbitCamera;
  private showWalls: boolean;
  private showFloors: boolean;
  private showCeilings: boolean;
  /**
   * Last lightmap source the caller provided. Null = render with the
   * renderer's default uniform-1.0 lightmap (dynamic lighting only).
   * When non-null, `rebuildScene()` builds a sliced `SceneLightmap` for
   * the mini-scene grid from this data and stamps it onto the resulting
   * `Scene` instance.
   */
  private lightmapSource: CellPreviewLightmapSource | null;
  /** rAF handle for the render loop. */
  private raf: number = 0;
  /** When `true`, `tick()` has been scheduled at least once. */
  private running: boolean = false;
  /** When `true`, `dispose()` has run — `tick` short-circuits. */
  private disposed: boolean = false;
  /**
   * Awaited inside `bootstrap()` after the WebGLRenderer is
   * constructed. The first paint blocks on this so we don't flash a
   * frame of pink-fallback tiles before the textures are uploaded.
   */
  private bootstrapPromise: Promise<void>;

  constructor(opts: CellPreviewEngineOptions) {
    this.canvas = opts.canvas;
    this.pack = opts.pack;
    this.lastScene = opts.scene;
    this.cameraState = { ...DEFAULT_CAMERA, ...(opts.camera ?? {}) };
    this.showWalls = opts.showWalls ?? true;
    this.showFloors = opts.showFloors ?? true;
    this.showCeilings = opts.showCeilings ?? true;
    this.lightmapSource = opts.lightmap ?? null;
    this.bootstrapPromise = this.bootstrap();
  }

  /**
   * Async construction tail. The WebGLRenderer's constructor itself is
   * synchronous, but it kicks off async texture uploads — we await
   * `renderer.assetsReady` so the first painted frame already has the
   * real textures in place (no pink-fallback flash). Pack preset
   * resolution is also async, so this is the single place those
   * awaits live.
   *
   * Errors surface back through the returned promise so the React
   * wrapper can render an error message.
   */
  private async bootstrap(): Promise<void> {
    // Pre-resolve shader sources from the pack's manifest so the
    // renderer's program-build path can stay synchronous. M4 of
    // MATERIALS.md handles the chain case; here we only need the
    // single root pack — preview surfaces don't load dep chains.
    const shaderSources = await WebGLRenderer.prefetchShaderSources(this.pack);
    if (this.disposed) return;

    // Default width/height — caller may resize after first frame.
    const w = Math.max(1, this.canvas.clientWidth || 256);
    const h = Math.max(1, this.canvas.clientHeight || 256);
    this.renderer = new WebGLRenderer({
      canvas: this.canvas,
      pack: this.pack,
      width: w,
      height: h,
      shaderSources,
      embedHud: false,
    });
    // Initialise post-pass chain if the pack ships any. Same
    // pattern Game.ts uses — keep preview parity with the in-game
    // pipeline.
    if (this.renderer.initPostPasses) {
      try { await this.renderer.initPostPasses(); } catch (err) {
        console.warn("[CellPreviewEngine] post-pass init failed:", err);
      }
    }
    if (this.disposed) {
      this.renderer.dispose();
      this.renderer = null;
      return;
    }

    // Build the initial 3×3 Scene from the preview-scene JSON.
    await this.rebuildScene();
    if (this.disposed) return;

    // Wait for tile + sprite atlas uploads so the first frame is real.
    try { await this.renderer.assetsReady; } catch { /* swallowed by renderer */ }
    if (this.disposed) return;

    this.running = true;
    this.scheduleTick();
  }

  /**
   * Translate `PreviewScene` (preset ids per cell) into a `Scene`
   * via the engine's `Scene.fromJSON` + `idMap` path. The idMap is
   * the bridge between our N×N grid and the pack's preset library,
   * resolved through `PresetResolver` — so every wall / floor /
   * ceiling rendered here goes through the same preset → tile-id
   * lookup the in-game scene loader uses.
   *
   * Grid size is inferred from `lastScene.walls.length` (square
   * N×N — the editor passes 12×12 for the room scene). When a
   * layer toggle is off, every cell in that layer is forced to
   * `null` so the engine renderer naturally treats it as "no
   * wall" / "no floor" / "no ceiling" — meaning shadows, AO, and
   * reflections honour the toggle automatically without any
   * per-surface visibility flag at the renderer level.
   */
  private async rebuildScene(): Promise<void> {
    const resolver = await this.pack.presets();
    if (this.disposed) return;

    // Collect every preset id referenced by the scene into a single
    // idMap. Ids start at 1 because `0` is reserved for "open / no
    // tile" in the engine's scene grids.
    const idMap: Record<string, string> = {};
    const idLookup = new Map<string, number>();
    const idFor = (presetId: string | null): number => {
      if (presetId === null) return 0;
      const cached = idLookup.get(presetId);
      if (cached !== undefined) return cached;
      const idx = idLookup.size + 1;
      idLookup.set(presetId, idx);
      idMap[String(idx)] = presetId;
      return idx;
    };

    // Derive grid size from the wall array length (square N×N). The
    // editor synthesises 12×12 by default; the engine just trusts
    // whatever the caller passed.
    const total = this.lastScene.walls.length;
    const size = Math.max(1, Math.round(Math.sqrt(total)));

    const walls: number[][] = [];
    const floors: number[][] = [];
    const ceilings: number[][] = [];
    for (let y = 0; y < size; y++) {
      const wallRow: number[] = [];
      const floorRow: number[] = [];
      const ceilRow: number[] = [];
      for (let x = 0; x < size; x++) {
        const i = y * size + x;
        const wallId = this.showWalls ? this.lastScene.walls[i] ?? null : null;
        const floorId = this.showFloors ? this.lastScene.floors[i] ?? null : null;
        const ceilId = this.showCeilings ? this.lastScene.ceilings[i] ?? null : null;
        wallRow.push(idFor(wallId));
        floorRow.push(idFor(floorId));
        ceilRow.push(idFor(ceilId));
      }
      walls.push(wallRow);
      floors.push(floorRow);
      ceilings.push(ceilRow);
    }

    const sceneJson: SceneJSON = {
      idMap,
      walls,
      floors,
      ceilings,
      // Preview mode drives the camera directly through `drawWorld`,
      // so no scene-controller / SpawnerList is needed — the
      // synthetic controller spawns with an empty components map.
    };
    const builtScene = Scene.fromJSON(sceneJson, undefined, resolver);

    // Stamp the sliced lightmap onto the freshly-built Scene. We
    // deliberately mutate `Scene.lightmap` (readonly in the public
    // type) here because `Scene.fromJSON` doesn't surface a way to
    // inject a pre-decoded lightmap, and round-tripping through
    // base64 every selection change would burn CPU for no win. The
    // engine renderer reads `scene.lightmap` straight from this
    // field — same path the in-game render uses.
    if (this.lightmapSource) {
      const sliced = sliceLightmap(this.lightmapSource, size);
      (builtScene as { lightmap: SceneLightmap }).lightmap = sliced;
    }

    this.scene = builtScene;
  }

  /**
   * rAF loop. Each tick:
   *   1. Computes a `CameraData` + position + facing from the orbit
   *      state.
   *   2. Calls `beginFrame` / `drawSky` / `drawWorld` / `endFrame`
   *      on the renderer.
   * No sprite pass — preview surfaces don't host entities.
   */
  private readonly tick = (): void => {
    if (this.disposed || !this.running) return;
    if (!this.renderer || !this.scene) {
      this.scheduleTick();
      return;
    }
    const { position, facing, camera, horizonOffset } = this.deriveCamera();
    this.renderer.beginFrame();
    // No dynamic lights — emissive surfaces contribute via the
    // scene's static lightmap and the renderer's emissive textures.
    this.renderer.setDynamicLights([]);
    this.renderer.drawSky(camera.ceiling, camera.floor);
    this.renderer.drawWorld(this.scene, position, facing, camera, horizonOffset);
    this.renderer.endFrame();
    this.scheduleTick();
  };

  private scheduleTick(): void {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.tick);
  }

  /**
   * Convert the orbit camera into the engine's first-person triplet:
   *   - `position`     — eye position in tile units (XY plane).
   *   - `facing`       — yaw radians toward the centre cell.
   *   - `camera`       — `CameraData` with `cameraZ` = eye height.
   *   - `horizonOffset`— screen-pixel offset that bakes the orbit
   *     `pitch` into the engine's fake-pitch mechanism.
   *
   * The 3×3 grid spans world `[0, 3]` on both axes; the centre cell
   * is at `(1.5, 1.5)`. The eye sits on a horizontal circle of
   * radius `cameraState.radius` centred on `(1.5, 1.5)` at world-z
   * `height`. **Critically, `pitch` does NOT translate the eye
   * vertically** — it only tilts the view direction. This matches a
   * cardboard-style head turn: the player's eye stays at standing
   * height (0.5) and they look up / down by rotating their head.
   *
   * The engine renderer doesn't accept a pitch angle directly —
   * instead it shifts the horizon line by `horizonOffset` pixels.
   * For a pitch `θ` and canvas height `H`, the screen-space horizon
   * sits at `H/2 + tan(θ) · (H/2) / tan(fov/2)` pixels from the top,
   * so `horizonOffset = tan(θ) · (H/2) / tan(fov/2)`. Looking up
   * (`pitch > 0`) pushes the horizon down on screen, which the
   * engine convention encodes as positive `horizonOffset`.
   */
  private deriveCamera(): {
    position: Vec2;
    facing: number;
    camera: CameraData;
    horizonOffset: number;
  } {
    const { yaw, pitch, radius, height } = this.cameraState;
    // Focus cell centre, in tile units. Falls back to the grid
    // centre when the caller didn't specify a focus. The 12×12 room
    // scene puts the focus at (6, 6) — world centre of that cell is
    // (6.5, 6.5).
    const total = this.lastScene.walls.length;
    const size = Math.max(1, Math.round(Math.sqrt(total)));
    const focusX = this.lastScene.focusX ?? Math.floor(size / 2);
    const focusY = this.lastScene.focusY ?? Math.floor(size / 2);
    const cx = focusX + 0.5;
    const cy = focusY + 0.5;
    // Orbit position on the *horizontal* circle. Pitch does not
    // contract the radius — the camera position is independent of
    // tilt. This fixes the "rises toward the ceiling on zoom / steep
    // pitch" bug.
    const ex = cx + Math.sin(yaw) * radius;
    const ey = cy + Math.cos(yaw) * radius;
    // Engine's `facing` is CCW from +x in the XY plane — derive
    // from the direction (cx, cy) - (ex, ey). This points horizontally
    // toward the focus cell; vertical aim is supplied via
    // `horizonOffset` below.
    const dx = cx - ex;
    const dy = cy - ey;
    const facing = Math.atan2(dy, dx);
    // Eye height is the caller's `height` parameter, full stop —
    // never modified by pitch or radius. Clamp defensively in case
    // the caller pushes outside the renderer's [0,1] range.
    const cameraZ = Math.max(0.05, Math.min(0.95, height));
    // Convert orbit pitch (radians) to screen-pixel horizon offset.
    // Uses the canvas's current backing-store height — when the
    // user resizes the panel the conversion stays correct without
    // a re-derivation step.
    const fovRad = (PREVIEW_FOV_DEG * Math.PI) / 180;
    const canvasH = Math.max(1, this.canvas.height);
    const horizonOffset =
      (Math.tan(pitch) * (canvasH / 2)) / Math.tan(fovRad / 2);
    return {
      position: new Vec2(ex, ey),
      facing,
      camera: {
        fov: fovRad,
        ceiling: PREVIEW_SKY,
        floor: PREVIEW_SKY,
        fogDistance: PREVIEW_FOG_DISTANCE,
        maxRaySteps: 64,
        cameraZ,
      },
      horizonOffset,
    };
  }

  /** Update the orbit-camera state. Cheap — applied next frame. */
  setCamera(c: Partial<OrbitCamera>): void {
    this.cameraState = { ...this.cameraState, ...c };
  }

  /**
   * Project a world-space point `(wx, wy, wz)` (tile units on XY,
   * cell-height fraction 0..1 on Z) into canvas-pixel coordinates,
   * using the same camera math the renderer uses for `drawWorld`.
   *
   * Returns `null` when the point is behind the camera. Returned
   * coordinates are in CSS pixels (matched to the canvas's
   * `clientWidth` / `clientHeight`) so callers can position
   * absolutely-placed DOM / SVG overlays directly.
   *
   * Used by the editor's focus-cell indicator to draw a thin floor
   * outline that tracks the orbit yaw / pitch without modifying the
   * raycaster.
   */
  projectWorldToScreen(wx: number, wy: number, wz: number): {
    x: number;
    y: number;
  } | null {
    const { position, facing, camera, horizonOffset } = this.deriveCamera();
    // Camera-space basis matches drawWorld(): forward along the gaze,
    // right perpendicular in the XY plane. `facing` is CCW from +x,
    // so forward = (cos, sin) and right = (cos+π/2, sin+π/2).
    const fwdX = Math.cos(facing);
    const fwdY = Math.sin(facing);
    const rightX = Math.cos(facing + Math.PI / 2);
    const rightY = Math.sin(facing + Math.PI / 2);
    const relX = wx - position.x;
    const relY = wy - position.y;
    // `depth` = how far ahead the point sits along the gaze.
    const depth = relX * fwdX + relY * fwdY;
    if (depth <= 0.0001) return null;
    // `lateral` = horizontal offset along the right vector. The
    // world frag uses backing-store pixels (canvas.width /
    // canvas.height); we translate the result to CSS pixels at the
    // end so it lines up with a DOM overlay sized via clientWidth /
    // clientHeight.
    const lateral = relX * rightX + relY * rightY;
    const cameraZ = camera.cameraZ ?? 0.5;
    const planeScale = Math.tan(camera.fov / 2);
    const widthBs = Math.max(1, this.canvas.width);
    const heightBs = Math.max(1, this.canvas.height);
    // `unitH` mirrors FRAG_WORLD_SRC: a single world-Z cell at unit
    // depth projects to `unitH` backing-store pixels. Per-pixel scale
    // is `unitH / perpDist` ≡ `unitH / depth`.
    const unitH = widthBs / (2 * planeScale);
    // Horizontal: the column index `colX = (cameraXn + 1) * W / 2`
    // where `cameraXn = (lateral / depth) / planeScale`.
    const cameraXn = lateral / depth / planeScale;
    const pxXBs = ((cameraXn + 1) * widthBs) / 2;
    // Vertical: `horizonY - (wz - cameraZ) * unitH / depth` matches
    // the wall-top / wall-bottom formula in FRAG_WORLD_SRC.
    const horizonY = heightBs / 2 + horizonOffset;
    const pxYBs = horizonY - ((wz - cameraZ) * unitH) / depth;
    // Backing-store → CSS pixels for DOM overlay placement.
    const widthCss = this.canvas.clientWidth || widthBs;
    const heightCss = this.canvas.clientHeight || heightBs;
    return {
      x: (pxXBs * widthCss) / widthBs,
      y: (pxYBs * heightCss) / heightBs,
    };
  }

  /**
   * Swap the scene composition (e.g. user clicked a different cell).
   * Triggers an async rebuild of the underlying `Scene`. The current
   * frame continues to render the previous scene until the rebuild
   * resolves — typical latency is < 1ms because preset resolution
   * is already cached on the resolver.
   */
  setScene(scene: PreviewScene): void {
    this.lastScene = scene;
    void this.rebuildScene();
  }

  /**
   * Replace the baked-lightmap source. Pass `null` to drop back to
   * the renderer's default uniform-1.0 lightmap (dynamic lighting
   * only). Triggers a scene rebuild so the next frame paints with
   * the new bake slice.
   *
   * Callers typically push this when:
   *   - The active editor scene's bake just finished (new lightmap
   *     data arrived).
   *   - The user toggled "Show baked lighting" in the settings panel
   *     (caller sets `null` to opt out).
   *   - The selected cell moved (slice origin shifted).
   */
  setLightmap(source: CellPreviewLightmapSource | null): void {
    this.lightmapSource = source;
    void this.rebuildScene();
  }

  /**
   * Toggle layer visibility. Re-builds the scene so the engine
   * renderer naturally treats hidden surfaces as "empty cells" /
   * "no wall" — meaning shadows, AO, and reflections honour the
   * toggle automatically.
   */
  setLayerVisibility(walls: boolean, floors: boolean, ceilings: boolean): void {
    if (
      walls === this.showWalls &&
      floors === this.showFloors &&
      ceilings === this.showCeilings
    ) {
      return;
    }
    this.showWalls = walls;
    this.showFloors = floors;
    this.showCeilings = ceilings;
    void this.rebuildScene();
  }

  /** Resize the GL backing buffer. Called on canvas resize / modal toggle. */
  resize(width: number, height: number): void {
    if (!this.renderer) return;
    this.renderer.resize(Math.max(1, width), Math.max(1, height));
  }

  /** Resolves when the first real frame can paint (textures + scene ready). */
  ready(): Promise<void> {
    return this.bootstrapPromise;
  }

  /**
   * Tear everything down — cancel the rAF, dispose the renderer
   * (which releases the GL programs / textures / FBOs). Idempotent.
   */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.running = false;
    if (this.raf !== 0) {
      cancelAnimationFrame(this.raf);
      this.raf = 0;
    }
    if (this.renderer) {
      try { this.renderer.dispose(); } catch (err) {
        console.warn("[CellPreviewEngine] renderer.dispose failed:", err);
      }
      this.renderer = null;
    }
    this.scene = null;
  }
}

/**
 * Build a `SceneLightmap` for the mini-scene's N×N grid by slicing the
 * source scene's lightmap centred on the selected cell. The mini-scene
 * places the focus cell at index `floor(N/2)`; for every mini-cell
 * `(mx, my)` we copy the `K×K` corner samples (plus the trailing
 * boundary corner row/column) from the source cell at:
 *
 *     sx = selectedX - focusIdx + mx
 *     sy = selectedY - focusIdx + my
 *
 * Source cells outside the bake's `[0, width) × [0, height)` bounds
 * get neutral 1.0 samples — equivalent to "no bake data, fall back to
 * ambient", which is the cardboard-engine convention for unbaked
 * areas. The K-factor is preserved so the renderer's shader UV math
 * (which divides world coords by K) keeps working without changes.
 *
 * Corner-grid layout: the source grid is `(W*K+1) × (H*K+1)` corners
 * row-major flat, three floats per corner. Each cell `(cx, cy)` owns
 * the `K×K` block of corners starting at `(cx*K, cy*K)` and ending
 * AT (not BEFORE) `((cx+1)*K, (cy+1)*K)` — neighbouring cells share
 * their boundary corners. Writing destination corners works the same
 * way; the +1 trailing row/col is shared with the neighbouring
 * destination cell, so we write each corner exactly once.
 */
function sliceLightmap(
  src: CellPreviewLightmapSource,
  miniSize: number,
): SceneLightmap {
  const K = src.lightmap.resolution;
  const sW = src.lightmap.width;
  const sH = src.lightmap.height;
  const sStride = (sW * K + 1) * 3;

  const dW = miniSize;
  const dH = miniSize;
  const dStride = (dW * K + 1) * 3;
  const floorOut = new Float32Array((dW * K + 1) * (dH * K + 1) * 3);
  const ceilingOut = new Float32Array((dW * K + 1) * (dH * K + 1) * 3);
  // Default to neutral 1.0 — out-of-bounds and "no source data" cells
  // fall back to ambient instead of black.
  floorOut.fill(1);
  ceilingOut.fill(1);

  const focusIdx = Math.floor(miniSize / 2);
  const offsetX = src.selectedX - focusIdx;
  const offsetY = src.selectedY - focusIdx;

  /**
   * Copy one source corner at scaled-grid coord (scx, scy) into
   * destination corner (dcx, dcy). Bounds-check on the source side —
   * out-of-bounds reads leave the destination at its neutral 1.0
   * default, which is exactly the "no bake" fallback we want for
   * cells outside the source scene.
   */
  const copyCorner = (
    scx: number,
    scy: number,
    dcx: number,
    dcy: number,
  ): void => {
    if (scx < 0 || scy < 0 || scx > sW * K || scy > sH * K) return;
    const si = scy * sStride + scx * 3;
    const di = dcy * dStride + dcx * 3;
    floorOut[di] = src.lightmap.floorRGB[si]!;
    floorOut[di + 1] = src.lightmap.floorRGB[si + 1]!;
    floorOut[di + 2] = src.lightmap.floorRGB[si + 2]!;
    ceilingOut[di] = src.lightmap.ceilingRGB[si]!;
    ceilingOut[di + 1] = src.lightmap.ceilingRGB[si + 1]!;
    ceilingOut[di + 2] = src.lightmap.ceilingRGB[si + 2]!;
  };

  // Walk every destination corner exactly once. For destination
  // corner (dcx, dcy), the source corner is at scaled-grid coords
  // (dcx + offsetX*K, dcy + offsetY*K). Neighbouring cells naturally
  // share boundary corners — no special-case logic needed.
  for (let dcy = 0; dcy <= dH * K; dcy++) {
    for (let dcx = 0; dcx <= dW * K; dcx++) {
      copyCorner(dcx + offsetX * K, dcy + offsetY * K, dcx, dcy);
    }
  }

  return {
    width: dW,
    height: dH,
    resolution: K,
    floorRGB: floorOut,
    ceilingRGB: ceilingOut,
  };
}

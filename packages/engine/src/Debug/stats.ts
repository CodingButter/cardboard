/**
 * Engine profiling/telemetry surface — Q5 of `docs/plans/EDITOR_REDESIGN.md` §12.
 *
 * Single source of truth for frame-timing + GPU + ECS counts. Two
 * consumers today:
 *
 *   - The in-game dev console (CONSOLE.md `stats` / `gpu` / `entities`
 *     commands) reads via `api.debug.stats()` directly.
 *   - The editor Playtest stats panel reads via the iframe telemetry
 *     channel (EDITOR_IFRAME.md §6 — `engine-stats` postMessage at
 *     10 Hz). The iframe bridge calls `api.debug.stats()` and pipes
 *     the result; ModAPI is the source, postMessage is just transport.
 *
 * Hook points:
 *
 *   - Frame timing: `Game.update` calls `beginFrame()` at the top of
 *     the update tick; `Game.render` (or the end of the render tick)
 *     calls `endFrame()`. Frame ms is `endFrame - beginFrame`;
 *     sliding-window avg keeps a 1-second history.
 *
 *   - Renderer counts: the WebGL backend wraps its `gl` context so
 *     `drawElements` / `drawArrays` / `useProgram` calls increment
 *     counters. Counters reset at `beginFrame`. The canvas2d backend
 *     leaves the renderer counters at 0 (it doesn't issue GL draws —
 *     they don't apply).
 *
 *   - ECS counts: read live every `collect()` call from the bound
 *     `World` + `Scene` + `Light` component.
 *
 *   - Audio: live size of the AudioRegistry's `liveHandles`.
 *
 * Memory heuristics:
 *
 *   - `textureMem` / `geometryMem` — best-effort renderer-reported
 *     estimates. The WebGL renderer doesn't currently track these so
 *     they sit at 0 (documented in EngineStats below). Future work
 *     can hook texture-upload sites in WebGLRenderer.
 *   - `performance.memory` exists only in Chromium; we don't use it
 *     here (the consumer can hit it directly if needed).
 *
 * Engine code stays content-agnostic: this module reads ECS state +
 * counters but doesn't poke any pack-specific component or system.
 */

/**
 * Single snapshot of engine state for one tick of the
 * console / Playtest stats panel. Stable shape — adding fields is
 * backwards-compatible (consumers ignore unknowns); renaming is not.
 */
export interface EngineStats {
  // ── Frame timing ────────────────────────────────────────────────
  /** Frames per second over the last ~1s sliding window. */
  fps: number;
  /** Wall-clock ms for the most recent completed frame. */
  frameMs: number;
  /** Average ms per frame over the last ~1s sliding window. */
  frameMsAvg: number;

  // ── ECS counts ──────────────────────────────────────────────────
  /** Alive entities in the active world. */
  entityCount: number;
  /** Entities carrying a `Light` component. Dynamic lights. */
  lightCount: number;
  /**
   * Sub-sample count baked into the active scene's lightmap
   * (`width * height * resolution^2`). Approximates "how many lit
   * cells the renderer has to sample".
   */
  bakedCellCount: number;
  /**
   * Frustum-culled sprite count for the most recent frame. Heuristic:
   * tracks the count of sprites the renderer actually drew (post-cull,
   * after the `MAX_SPRITES_PER_FRAME` clamp). Lights + non-sprite
   * entities are NOT included — that's why this is "visibleEntity"
   * rather than `visibleSpriteCount`; the value is dominated by
   * sprites in practice. 0 on the canvas2d backend (it doesn't report).
   */
  visibleEntityCount: number;

  // ── Renderer ────────────────────────────────────────────────────
  /** WebGL draw calls issued this frame (drawElements + drawArrays). */
  drawCalls: number;
  /**
   * Estimated triangle count this frame. Heuristic: each
   * `drawArrays(TRIANGLES, _, n)` contributes `n / 3`, each
   * `drawArrays(TRIANGLE_STRIP, _, n)` contributes `n - 2`. Not
   * tracked across `drawElements` (no easy access to count without
   * shadowing every buffer); reported as best-effort.
   */
  triangles: number;
  /** Distinct `useProgram` calls this frame. Proxy for shader switches. */
  shaderSwitches: number;
  /**
   * Active shader programs the renderer has compiled (sky, world,
   * sprite, post-passes). Steady-state count — bumps on
   * `rebuild{Sprite,World}Program` and post-pass init.
   */
  programCount: number;
  /**
   * Estimated bytes of texture memory the renderer holds. STUBBED at
   * 0 today — WebGLRenderer doesn't track upload bytes. Future work
   * can hook `texImage2D` / `texImage3D` call sites and accumulate.
   */
  textureMem: number;
  /**
   * Estimated bytes of vertex / index buffer memory. STUBBED at 0 —
   * the sprite VBO + quad VAO are small and static; if pack scripts
   * ever upload large meshes this is where it'd show up.
   */
  geometryMem: number;

  // ── Audio ───────────────────────────────────────────────────────
  /** Live `AudioHandle`s playing right now. */
  audioActiveVoices: number;
  /**
   * Mixer load 0..1 — STUBBED at 0. Web Audio doesn't expose a
   * cheap "graph load" metric; future work could approximate via
   * `AudioContext.baseLatency` + handle count.
   */
  audioMixerLoad: number;
}

/**
 * Sentinel — `0` means "no scene bound yet". Consumers should treat
 * any stats field with this value as "engine not yet running".
 */
const NOT_YET = 0;

/** Sliding-window length for fps / frameMsAvg. Keeps roughly 1s of frames. */
const WINDOW_MS = 1000;

/**
 * Lightweight ECS surface the collector consumes. Avoids pulling in
 * the full `World` / `Scene` / component types so this module stays
 * pure-utility — anything that can hand back the four numbers below
 * works.
 */
export interface StatsWorldView {
  entityCount(): number;
  /** Live count of entities with a `Light` component. */
  lightCount(): number;
}

export interface StatsSceneView {
  /** Sub-sample count of the active scene's lightmap, or 0. */
  bakedCellCount(): number;
}

export interface StatsAudioView {
  /** Number of currently-playing `AudioHandle` instances. */
  activeVoices(): number;
}

/**
 * Renderer hook the collector consumes. The WebGL backend implements
 * this; the canvas2d backend can omit it and report zeros.
 */
export interface StatsRendererView {
  /** Reset per-frame counters. Called at `beginFrame`. */
  resetFrameCounters(): void;
  /** Current draw-call count since last reset. */
  drawCalls(): number;
  /** Triangle estimate since last reset. */
  triangles(): number;
  /** `useProgram` calls since last reset. */
  shaderSwitches(): number;
  /** Compiled programs alive right now. */
  programCount(): number;
  /** Texture-memory heuristic (bytes). 0 if not tracked. */
  textureMem(): number;
  /** Geometry-memory heuristic (bytes). 0 if not tracked. */
  geometryMem(): number;
  /** Sprites drawn (post-cull, post-clamp) on the most recent frame. */
  visibleSpriteCount(): number;
}

/**
 * Frame-timing + counter sink. One instance per `Game`; passed
 * downstream to the ModAPI (so pack scripts can call
 * `api.debug.stats()`) and to the WebGL renderer (so the gl wrapper
 * has a counter to bump).
 *
 * Lifecycle:
 *   - `new StatsCollector()` — caller doesn't need to wire anything
 *     up front; setters can be deferred until after construction.
 *   - `setWorld(w)` / `setScene(s)` / `setAudio(a)` / `setRenderer(r)`
 *     — called by `Game` once each is ready.
 *   - `beginFrame()` at the top of `Game.update`.
 *   - `endFrame()` at the bottom of `Game.render`.
 *   - `collect()` — read snapshot. Cheap; safe to call mid-frame
 *     (returns the most recent completed frame's numbers).
 */
export class StatsCollector {
  private world: StatsWorldView | null = null;
  private scene: StatsSceneView | null = null;
  private audio: StatsAudioView | null = null;
  private renderer: StatsRendererView | null = null;

  /** Most recent completed frame's ms. */
  private lastFrameMs: number = 0;
  /** `performance.now()` snapshot at the top of the current frame. */
  private frameStart: number = 0;
  /**
   * Sliding window of (timestamp, frameMs) pairs. Pruned at every
   * `endFrame` to drop entries older than `WINDOW_MS`. Plain arrays —
   * the window is bounded by frame rate, ~60 entries at 60 fps.
   */
  private readonly windowTs: number[] = [];
  private readonly windowMs: number[] = [];

  setWorld(world: StatsWorldView | null): void {
    this.world = world;
  }

  setScene(scene: StatsSceneView | null): void {
    this.scene = scene;
  }

  setAudio(audio: StatsAudioView | null): void {
    this.audio = audio;
  }

  setRenderer(renderer: StatsRendererView | null): void {
    this.renderer = renderer;
  }

  /** Mark the start of a frame. Reset per-frame renderer counters. */
  beginFrame(): void {
    this.frameStart = performance.now();
    if (this.renderer !== null) this.renderer.resetFrameCounters();
  }

  /** Mark the end of a frame. Pushes the elapsed ms into the window. */
  endFrame(): void {
    const now = performance.now();
    const ms = now - this.frameStart;
    this.lastFrameMs = ms;
    this.windowTs.push(now);
    this.windowMs.push(ms);
    // Drop stale entries. Tight loop because we drop at most one per
    // frame in steady state.
    const cutoff = now - WINDOW_MS;
    while (this.windowTs.length > 0 && this.windowTs[0]! < cutoff) {
      this.windowTs.shift();
      this.windowMs.shift();
    }
  }

  /**
   * Read a snapshot. Safe to call any time; uses last-completed-frame
   * timing data, current-state ECS counts, and per-frame renderer
   * counters (which reset at the next `beginFrame`).
   */
  collect(): EngineStats {
    const sampleCount = this.windowTs.length;
    let frameMsAvg = this.lastFrameMs;
    let fps = NOT_YET;
    if (sampleCount > 0) {
      let sum = 0;
      for (let i = 0; i < sampleCount; i++) sum += this.windowMs[i]!;
      frameMsAvg = sum / sampleCount;
      // Span of the window in seconds, derived from the timestamps
      // themselves rather than count * frameMsAvg — handles partial
      // windows during boot more gracefully.
      const span =
        sampleCount === 1
          ? frameMsAvg / 1000
          : (this.windowTs[sampleCount - 1]! - this.windowTs[0]!) / 1000;
      fps = span > 0 ? sampleCount / span : NOT_YET;
    }

    const entityCount = this.world?.entityCount() ?? NOT_YET;
    const lightCount = this.world?.lightCount() ?? NOT_YET;
    const bakedCellCount = this.scene?.bakedCellCount() ?? NOT_YET;
    const audioActiveVoices = this.audio?.activeVoices() ?? NOT_YET;

    const r = this.renderer;
    return {
      fps,
      frameMs: this.lastFrameMs,
      frameMsAvg,
      entityCount,
      lightCount,
      bakedCellCount,
      visibleEntityCount: r?.visibleSpriteCount() ?? NOT_YET,
      drawCalls: r?.drawCalls() ?? NOT_YET,
      triangles: r?.triangles() ?? NOT_YET,
      shaderSwitches: r?.shaderSwitches() ?? NOT_YET,
      programCount: r?.programCount() ?? NOT_YET,
      textureMem: r?.textureMem() ?? NOT_YET,
      geometryMem: r?.geometryMem() ?? NOT_YET,
      audioActiveVoices,
      audioMixerLoad: NOT_YET,
    };
  }
}

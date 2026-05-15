import type { Scene } from "Scene";
import type { Vec2 } from "Libs/Vector";
import type { IPixel } from "Libs/Geometry";
import type { CameraData } from "Components";

/**
 * One billboarded sprite to draw this frame. The renderer projects the
 * world position against the camera, sizes it by `worldHeight`, and
 * z-clips against the wall depth buffer captured by `drawWorld`.
 *
 * `imageId` must match a key in the active pack's `manifest.sprites`
 * (the renderer preloads every entry at construction).
 */
export interface SpriteDrawRequest {
  /** World-space x in tile units. */
  x: number;
  /** World-space y in tile units. */
  y: number;
  /** Pack manifest key of the sprite image. */
  imageId: string;
  /** Visible height in tile units (1.0 ≈ wall height). */
  worldHeight: number;
  /** Vertical offset of the sprite's center from eye level (+ = down). */
  yOffset: number;
}

/**
 * One dynamic light to apply this frame. Built by `LightCollectionSystem`
 * from every entity carrying `Light + Position`, and handed to the
 * renderer via `setDynamicLights` before the world pass. Renderers cap
 * the list internally (`MAX_DYNAMIC_LIGHTS_CPU = 4` /
 * `MAX_DYNAMIC_LIGHTS_GL = 8`) so the caller doesn't need to pre-cull
 * aggressively — radius-based attenuation drops contributions to near
 * zero past `radius` anyway. See LIGHTING_OVERHAUL.md § 5.3 / 6.
 */
export interface LightInstance {
  x: number;
  y: number;
  /** Resolved from `LightData.z ?? 0.5` on the system side. */
  z: number;
  color: [number, number, number];
  intensity: number;
  radius: number;
}

/**
 * The contract every "world renderer" implements. Game.ts holds one of
 * these and calls its methods each frame; the concrete backend (CPU pixel
 * buffer today, WebGL fragment shader later) is hidden behind the
 * interface so the rest of the codebase doesn't care which is plugged in.
 *
 * Per-frame flow:
 *
 *   renderer.beginFrame();
 *   renderer.drawSky(top, bottom);
 *   renderer.drawWorld(scene, position, facing, camera);
 *   renderer.endFrame();
 *   // HUD systems then draw onto `renderer.ctx`
 *
 * `drawWorld` is the workhorse — it owns the full per-pixel scene pass
 * (walls + floor + ceiling, with AO, fog, reflectiveness, bilinear,
 * etc.). The CPU backend walks pixels in JS; the eventual WebGL backend
 * will assemble draw calls and let the GPU do the per-pixel work.
 *
 * `ctx` is the HUD escape hatch. For the 2D backend it's the same canvas
 * the world lives on; for the WebGL backend it'll be a stacked
 * Canvas-2D layered via CSS. Either way the HUD systems (minimap, stats,
 * gun, reticle) don't care which they're drawing into.
 */
export interface SceneRenderer {
  /** The on-screen canvas the world is rendered to. */
  readonly canvas: HTMLCanvasElement;
  /** Canvas-2D context the HUD layers draw into after `endFrame`. */
  readonly ctx: CanvasRenderingContext2D;
  /**
   * Resolves once every tile + sprite asset the renderer started
   * loading at construction has decoded and uploaded. Individual
   * failures don't reject — the renderer logs them and falls back to
   * its solid-color palette. The loading overlay awaits this so the
   * first visible frame doesn't flash the fallback pink.
   */
  readonly assetsReady: Promise<void>;

  /** Set up per-frame state. Implementations can no-op this. */
  beginFrame(): void;

  /**
   * Hand the per-frame dynamic light list to the renderer. Called once
   * per frame BEFORE `drawWorld` so both the world pass and the sprite
   * pass see the same lights. The renderer is free to cap the count for
   * perf — caller need not pre-cull aggressively.
   *
   * Both backends apply the lights inline during their existing
   * per-pixel hot loops (TwoD CPU loop, WebGL fragment shader). See
   * LIGHTING_OVERHAUL.md § 5.3 / § 6 and `LightInstance` above.
   */
  setDynamicLights(lights: ReadonlyArray<LightInstance>): void;

  /** Fill the world's top half with `top` and bottom half with `bottom`. */
  drawSky(top: IPixel, bottom: IPixel): void;

  /**
   * Render the 3D scene from the camera at (`position`, `facing`).
   * Includes walls, floor, ceiling, all reflections, AO, fog — every
   * per-pixel detail of the scene pass.
   *
   * `horizonOffset` shifts the horizon line by that many pixels (positive
   * = down, negative = up). The wall band re-centers around the new
   * horizon and the floor/ceiling extents expand/shrink accordingly — a
   * Heretic-style fake-pitch effect driven by mouse Y. Defaults to `0`
   * (no shift).
   */
  drawWorld(
    scene: Scene,
    position: Vec2,
    facing: number,
    camera: CameraData,
    horizonOffset?: number,
  ): void;

  /**
   * Render every requested sprite on top of the world pass. Must be
   * called *after* `drawWorld` (so the per-column wall depth captured
   * during the world pass is available) and *before* `endFrame`. Order
   * within the list is preserved internally — the renderer sorts
   * back-to-front so alpha blending composites correctly.
   *
   * `position`/`facing`/`camera`/`horizonOffset` should match what was
   * passed to `drawWorld` this frame. The renderer doesn't cache the
   * camera state between calls because there's no need.
   */
  drawSprites(
    requests: readonly SpriteDrawRequest[],
    position: Vec2,
    facing: number,
    camera: CameraData,
    horizonOffset?: number,
  ): void;

  /** Commit the world pass to the screen and ready the HUD canvas. */
  endFrame(): void;

  /**
   * Resize the backing pixel buffer to `(width, height)`. Called on
   * window resize so the rendered image can fill the screen at the
   * current aspect ratio without stretching. Each backend reallocates
   * what it owns: TwoD reallocates `imageData` + per-column scratch
   * buffers; WebGL updates the viewport and resizes the HUD canvas.
   * The frame-loop arrays (columns, slabs, etc.) auto-resize on the
   * next `beginFrame` / `drawWorld` via their existing length checks.
   */
  resize(width: number, height: number): void;
}

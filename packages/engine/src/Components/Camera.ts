import { Component } from "ECS";
import type { IPixel } from "Libs/Geometry";

/* --- Rendering ----------------------------------------------------------- */

/**
 * Marker for "the world is rendered from this entity's pose". One entity
 * carries it at a time — `WallRenderSystem.render` reads the camera's
 * Position + Facing to build the projection.
 */
export interface CameraData {
  /** Horizontal field of view in radians. */
  fov: number;
  /** Sky color (top half of the screen). */
  ceiling: IPixel;
  /** Floor color (bottom half). */
  floor: IPixel;
  /**
   * Distance — in tile units — past which a wall fades to black. Pure
   * cosmetic depth cue; `Infinity` disables shading.
   */
  fogDistance: number;
  /** Max DDA cells to walk per ray before giving up. */
  maxRaySteps: number;
  /**
   * Eye height as a fraction of the wall's world height. 0.5 means
   * the eyes are mid-wall (standing default). Jumping lifts this
   * toward 1.0; crouching drops it toward 0. Renderers use it to
   * center the wall band and choose floor/ceiling distance scaling.
   */
  cameraZ: number;
}
export const Camera = new Component<CameraData>("Camera");

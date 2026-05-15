import { Component } from "ECS";

/* --- Movement ------------------------------------------------------------ */

/**
 * How an entity moves. Mutable: systems update `isRunning` / vertical
 * fields directly without replacing the component value.
 *
 * Horizontal motion comes from `speed` / `runMultiplier`. Vertical
 * motion is a simple kinematic model:
 *   - `z` is the eye-height offset from standing (world units; 0 =
 *     standing, > 0 = airborne / jumped, < 0 = crouched).
 *   - `vz` is the vertical velocity. Gravity decrements it while
 *     airborne; jump impulse spikes it positive.
 *   - `crouching` mirrors the held crouch input; while held on the
 *     ground we ease `z` toward `CROUCH_Z`.
 */
export interface MovementData {
  /** Base movement speed in tiles/sec. */
  speed: number;
  /** Turn rate in radians per (mouse-dx · second). */
  rotationSpeed: number;
  /** Multiplier applied to `speed` while `isRunning` is true. */
  runMultiplier: number;
  /** Toggled by the input system. */
  isRunning: boolean;
  /** Eye-height offset from standing, world units. */
  z: number;
  /** Vertical velocity, world units/sec. */
  vz: number;
  /** True while the crouch key is held. */
  crouching: boolean;
}
export const Movement = new Component<MovementData>("Movement");

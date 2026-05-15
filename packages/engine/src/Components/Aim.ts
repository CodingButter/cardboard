import { Component } from "ECS";

/**
 * Vertical aim — the on-screen reticle's Y offset from the canvas center,
 * in pixels. Positive = below center. The body's `Facing` handles
 * horizontal aim; this is the "free look" pitch that doesn't change where
 * the player is actually pointing in the world, only where they're aiming
 * the reticle.
 */
export interface AimData {
  screenY: number;
}
export const Aim = new Component<AimData>("Aim");

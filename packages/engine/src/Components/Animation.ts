import { Component } from "ECS";

/**
 * Frame-based sprite animation state — A1 of
 * `docs/plans/ANIMATIONS.md`. Attached to an entity alongside `Sprite`
 * to drive flipbook playback. The `AnimationSystem` advances `frame` +
 * `elapsed` each tick; the sprite render system reads `current` +
 * `frame` per render to resolve the atlas UV region.
 *
 * Entities without an `Animation` component render frame 0 of angle 0
 * (= byte-identical to the pre-A1 single-image sprite path).
 */
export interface AnimationData {
  /**
   * Name of the currently-playing animation — must be a key in
   * `manifest.sprites[<imageId>].animations`. Unknown names log once
   * and the system leaves state untouched (renderer falls back to
   * frame 0 of angle 0).
   */
  current: string;
  /**
   * Index INTO the `animations[current].frames` array (not the atlas).
   * `0 ≤ frame < frames.length`.
   */
  frame: number;
  /** Seconds elapsed in the current frame. Drained by AnimationSystem. */
  elapsed: number;
  /** When true the system doesn't advance. Default false. */
  paused?: boolean;
  /** Multiplier applied to dt for this entity. Default 1.0. Negative rates clamp to 0. */
  playbackRate?: number;
}

export const Animation = new Component<AnimationData>("Animation");

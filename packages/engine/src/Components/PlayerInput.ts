import { Component } from "ECS";
import type { KeyCode } from "Controllers/KeyboardController";
import { CONFIG } from "GameConfig";

/* --- Input --------------------------------------------------------------- */

/**
 * Maps player actions to physical keys. All slots accept multiple keys so
 * "either shift" / "either WASD or arrows" works without special-casing.
 */
export interface KeyBindings {
  forward: readonly KeyCode[];
  backward: readonly KeyCode[];
  strafeLeft: readonly KeyCode[];
  strafeRight: readonly KeyCode[];
  run: readonly KeyCode[];
  jump: readonly KeyCode[];
  crouch: readonly KeyCode[];
}

/** Standard FPS layout — sourced from `game.config.json`. */
export const DEFAULT_BINDINGS: KeyBindings = CONFIG.bindings;

/** Marker that says "this entity is driven by the human at the keyboard". */
export interface PlayerInputData {
  bindings: KeyBindings;
}
export const PlayerInput = new Component<PlayerInputData>("PlayerInput");

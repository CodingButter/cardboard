import { Component } from "ECS";

/**
 * Held weapon — state for the bottom-of-screen viewmodel animation and
 * fire/reload timing.
 *
 *   - `lastFireTime`: `performance.now() / 1000` of the most recent shot.
 *     The recoil envelope and fire-rate gate are both derived from
 *     `(now − lastFireTime)`.
 *   - `walkPhase`: phase accumulator for the sine-driven walk sway. Only
 *     advances while a movement key is held, so the viewmodel stops
 *     bobbing the instant you stop walking.
 *   - `wasFiring`: previous frame's fire-button state. Used to edge-trigger
 *     semi-auto weapons (one shot per click, not per frame held).
 *   - `reloadStart`: time the current reload began. `−Infinity` when not
 *     reloading; once `(now − reloadStart) ≥ reloadTime` the system
 *     consummates the reload (moves reserve → mag).
 */
export interface WeaponData {
  lastFireTime: number;
  walkPhase: number;
  wasFiring: boolean;
  reloadStart: number;
}
export const Weapon = new Component<WeaponData>("Weapon");

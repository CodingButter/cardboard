import { Component } from "ECS";

/**
 * Billboarded sprite — a flat image always facing the camera, drawn at
 * the entity's `Position` and z-clipped against the wall depth buffer.
 *
 *   - `imageId` must be a key in the active pack's `manifest.sprites`.
 *     Unknown ids no-op (renderer logs a warning once).
 *   - `worldHeight` is the on-screen height in tile units. `1` matches
 *     wall height; `0.5` is half-wall.
 *   - `yOffset` shifts the *center* of the sprite away from camera
 *     height, in tile units. `0` = sprite center sits at eye level; the
 *     default of `0` means a height-1 sprite has its bottom at the
 *     floor and top at the ceiling (camera is at z=0.5). Positive =
 *     down, negative = up.
 */
export interface SpriteData {
  imageId: string;
  worldHeight: number;
  yOffset: number;
}
export const Sprite = new Component<SpriteData>("Sprite");

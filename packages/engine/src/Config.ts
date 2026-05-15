import { Vec2 } from "Libs/Vector";

/**
 * Pixels-per-unit used when sizing the backing canvas from the aspect ratio.
 * Increase for a sharper image, decrease for a cheaper render.
 */
export const FACTOR: number = 80;

/** Logical aspect ratio of the rendering surface, in arbitrary units. */
export const ASPECT: Vec2 = new Vec2(16, 9);

/** Aspect ratio as a single scalar (width / height). */
export const ASPECT_RATIO: number = ASPECT.x / ASPECT.y;

/** Backing canvas size in CSS pixels, derived from `ASPECT * FACTOR`. */
export const CANVAS_SIZE: Vec2 = ASPECT.scale(FACTOR);

/**
 * Small epsilon used to nudge ray origins off integer grid lines so the next
 * ray step never lands exactly on the boundary we just crossed.
 */
export const EPS: number = 0.0001;

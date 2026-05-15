import { Vec2 } from "Libs/Vector";
import { EPS } from "Config";
import type { Scene, WallSegment } from "Scene";

/**
 * Grid-marching raycast helpers.
 *
 * The minimap uses these to draw rays through the tile grid, and the same
 * primitives will drive the upcoming first-person wall renderer.
 *
 * Coordinates are in *tile* units — `(2.5, 3.0)` means halfway across tile
 * column 2 on row 3. Walls live on integer grid lines.
 */

/**
 * Snap a coordinate to the next integer grid line in the direction of `dx`.
 *
 * The tiny `sin(dx) * EPS` nudge pushes the result a hair past the line so the
 * next step doesn't repeatedly land on the same boundary.
 */
export function snap(x: number, dx: number): number {
  if (dx > 0) return Math.ceil(x) + Math.sin(dx) * EPS;
  if (dx < 0) return Math.floor(x) + Math.sin(dx) * EPS;
  return x;
}

/**
 * Step a ray defined by two points to the next grid intersection.
 *
 * Returns the closest of:
 * - the vertical grid line ahead (if dx ≠ 0)
 * - the horizontal grid line ahead (if the slope is finite and dy ≠ 0)
 *
 * The result becomes the new `p2` for the next step; the previous `p2` becomes
 * the new `p1`.
 */
export function rayStep(p1: Vec2, p2: Vec2): Vec2 {
  let p3 = p2.copy();
  const d = p2.sub(p1);

  if (d.x !== 0) {
    const k = d.y / d.x;
    const c = p1.y - k * p1.x;

    const x3 = snap(p2.x, d.x);
    const y3 = k * x3 + c;
    p3 = new Vec2(x3, y3);

    if (k !== 0) {
      const yCand = snap(p2.y, d.y);
      const xCand = (yCand - c) / k;
      const candidate = new Vec2(xCand, yCand);
      if (candidate.distanceTo(p2) < p3.distanceTo(p2)) {
        p3 = candidate;
      }
    }
  } else {
    const y3 = snap(p2.y, d.y);
    p3 = new Vec2(p2.x, y3);
  }

  return p3;
}

/**
 * Result of stepping a ray through the grid until it exits the bounds.
 *
 * `points` are the successive intersections in order, starting one EPS-step
 * away from `origin`. `points.at(-1)` is the boundary-crossing point.
 */
export interface RayTrace {
  origin: Vec2;
  direction: Vec2;
  points: Vec2[];
}

/**
 * Walk a ray from `origin` in `direction` (need not be unit-length), stepping
 * cell by cell, until it leaves the rectangle `[0, bounds.x] × [0, bounds.y]`
 * or exhausts `maxSteps`.
 */
export function traceRay(
  origin: Vec2,
  direction: Vec2,
  bounds: Vec2,
  maxSteps: number,
): RayTrace {
  const points: Vec2[] = [];
  let p1 = origin;
  let p2 = origin.add(direction.scale(EPS));
  for (let i = 0; i < maxSteps; i++) {
    const p3 = rayStep(p1, p2);
    if (p3.x < 0 || p3.x > bounds.x || p3.y < 0 || p3.y > bounds.y) break;
    points.push(p3);
    p1 = p2;
    p2 = p3;
  }
  return { origin, direction, points };
}

/** Which face of a wall a DDA ray crossed. */
export const enum WallSide {
  /** Hit a vertical grid line — ray was moving primarily along x. */
  Vertical = 0,
  /** Hit a horizontal grid line — ray was moving primarily along y. */
  Horizontal = 1,
}

/** What `castRayToWall` returns on a hit. */
export interface WallHit {
  /**
   * Perpendicular distance from the camera plane to the wall (NOT the
   * Euclidean distance from origin to hit point). Using perpendicular distance
   * is what removes the fish-eye distortion you'd otherwise get.
   */
  perpDistance: number;
  /**
   * Perpendicular distance to the FAR side of the wall cell along the same
   * ray. The cap pass uses this to know how far along the ray the cell's
   * top/bottom horizontal surface extends — caps are visible between
   * `perpDistance` (the slab face the ray crossed) and `perpDistanceBack`
   * (the opposite cell boundary along the ray).
   */
  perpDistanceBack: number;
  /** Which face was hit (see `WallSide`). Useful for shading. */
  side: WallSide;
  /** Grid cell that was hit. */
  cell: Vec2;
  /** Tile id at the hit cell (the wall's "kind"). */
  tile: number;
  /**
   * Coordinate along the wall face where the hit occurred, in `[0, 1)`. This
   * is the U coordinate when the wall is textured — left edge to right edge,
   * looking at the face from outside.
   */
  wallU: number;
  /**
   * The wall segment the ray hit. The renderer uses this to size the wall
   * slab vertically (`startZ` + `height`) and apply texture offsets. For
   * Phase 1 of the wall overhaul there's always one segment per wall cell,
   * so this is `cell.walls[0]`.
   */
  segment: WallSegment;
}

/**
 * DDA (Digital Differential Analyzer) raycast that walks grid cells in the
 * order they're crossed and stops at the first wall.
 *
 * This is the standard Wolfenstein/Lode-tutorial algorithm. It's the right
 * tool for the wall renderer because:
 *
 * 1. Each iteration advances exactly one cell, so the loop count is bounded
 *    by the Manhattan distance through the grid — no oversampling.
 * 2. `perpDistance` falls out for free from the side-distance counters,
 *    saving a separate fish-eye correction.
 *
 * Returns `null` if the ray leaves the scene without hitting anything, or if
 * `maxSteps` is exceeded.
 */
export function castRayToWall(
  scene: Scene,
  origin: Vec2,
  direction: Vec2,
  maxSteps: number = 64,
): WallHit | null {
  let mapX = Math.floor(origin.x);
  let mapY = Math.floor(origin.y);

  // Distance the ray travels along itself to cross one cell along each axis.
  const deltaDistX = direction.x === 0 ? Infinity : Math.abs(1 / direction.x);
  const deltaDistY = direction.y === 0 ? Infinity : Math.abs(1 / direction.y);

  // Step direction and initial distance to the first grid line in each axis.
  let stepX: number;
  let stepY: number;
  let sideDistX: number;
  let sideDistY: number;

  if (direction.x < 0) {
    stepX = -1;
    sideDistX = (origin.x - mapX) * deltaDistX;
  } else {
    stepX = 1;
    sideDistX = (mapX + 1 - origin.x) * deltaDistX;
  }
  if (direction.y < 0) {
    stepY = -1;
    sideDistY = (origin.y - mapY) * deltaDistY;
  } else {
    stepY = 1;
    sideDistY = (mapY + 1 - origin.y) * deltaDistY;
  }

  let side: WallSide = WallSide.Vertical;
  for (let i = 0; i < maxSteps; i++) {
    if (sideDistX < sideDistY) {
      sideDistX += deltaDistX;
      mapX += stepX;
      side = WallSide.Vertical;
    } else {
      sideDistY += deltaDistY;
      mapY += stepY;
      side = WallSide.Horizontal;
    }

    if (!scene.contains(mapX, mapY)) return null;

    const cell = scene.getCell(mapX, mapY);
    const segment = cell.walls[0];
    if (segment !== undefined) {
      // We just stepped *into* the wall cell, so back out one delta to get
      // the distance to the wall face we crossed.
      const perpDistance =
        side === WallSide.Vertical ? sideDistX - deltaDistX : sideDistY - deltaDistY;
      // The opposite cell boundary along the ray is at min(sideDistX,
      // sideDistY) — the next axis crossing after entering this cell.
      // Used by the cap pass to know how far the cell's top/bottom
      // horizontal surface extends in screen space.
      const perpDistanceBack = sideDistX < sideDistY ? sideDistX : sideDistY;

      // Where on the wall face the ray landed. For a vertical face the U
      // coordinate runs along Y, and vice versa.
      let wallU: number;
      if (side === WallSide.Vertical) {
        wallU = origin.y + perpDistance * direction.y;
      } else {
        wallU = origin.x + perpDistance * direction.x;
      }
      wallU -= Math.floor(wallU);

      return {
        perpDistance,
        perpDistanceBack,
        side,
        cell: new Vec2(mapX, mapY),
        tile: segment.tile,
        wallU,
        segment,
      };
    }
  }

  return null;
}

/**
 * Multi-hit DDA — same algorithm as `castRayToWall` but doesn't stop
 * at the first wall. Continues stepping until it either:
 *
 * - lands in a cell with a **full-height** wall (`startZ <= 0` and
 *   `startZ + height >= 1`) — that wall fully occludes everything
 *   behind it, so further hits would never be visible;
 * - leaves the scene bounds; or
 * - exhausts `maxSteps`.
 *
 * The renderer walks the returned list back-to-front (farthest first)
 * so nearer walls naturally overlay farther ones. Needed to make
 * walls / items / enemies behind partial walls (knee walls, hanging
 * headers) actually visible.
 *
 * Hits are returned in distance order (nearest first) — same shape as
 * `castRayToWall` would have returned, but with the trailing slabs
 * the original function dropped on the floor.
 */
export function castRayThroughWalls(
  scene: Scene,
  origin: Vec2,
  direction: Vec2,
  maxSteps: number = 64,
): WallHit[] {
  const hits: WallHit[] = [];
  let mapX = Math.floor(origin.x);
  let mapY = Math.floor(origin.y);

  const deltaDistX = direction.x === 0 ? Infinity : Math.abs(1 / direction.x);
  const deltaDistY = direction.y === 0 ? Infinity : Math.abs(1 / direction.y);

  let stepX: number;
  let stepY: number;
  let sideDistX: number;
  let sideDistY: number;

  if (direction.x < 0) {
    stepX = -1;
    sideDistX = (origin.x - mapX) * deltaDistX;
  } else {
    stepX = 1;
    sideDistX = (mapX + 1 - origin.x) * deltaDistX;
  }
  if (direction.y < 0) {
    stepY = -1;
    sideDistY = (origin.y - mapY) * deltaDistY;
  } else {
    stepY = 1;
    sideDistY = (mapY + 1 - origin.y) * deltaDistY;
  }

  // Starting-cell check: if the camera origin is INSIDE a wall cell
  // (only possible for partial walls — knee walls or hanging headers
  // the player walked into), the standard DDA would skip that wall
  // because it only tests cells the ray enters. We synthesise an
  // "inside-cell" hit with perpDistance = 0; the renderer treats it
  // as "no slab front face, but still draw the caps". perpDistanceBack
  // is min(sideDistX, sideDistY) BEFORE any step — the first cell
  // boundary the ray crosses.
  const startCell = scene.getCell(mapX, mapY);
  const startSeg = startCell.walls[0];
  if (startSeg !== undefined) {
    const exitDistance = sideDistX < sideDistY ? sideDistX : sideDistY;
    hits.push({
      perpDistance: 0,
      perpDistanceBack: exitDistance,
      // Picking Vertical is arbitrary — there's no entry face for an
      // "inside" hit. The renderer doesn't use `side` for caps.
      side: WallSide.Vertical,
      cell: new Vec2(mapX, mapY),
      tile: startSeg.tile,
      wallU: 0,
      segment: startSeg,
    });
    // Don't early-exit on a full-height start cell — that shouldn't
    // happen (collision would have blocked entry) and exhausting the
    // loop is fine.
  }

  let side: WallSide = WallSide.Vertical;
  for (let i = 0; i < maxSteps; i++) {
    if (sideDistX < sideDistY) {
      sideDistX += deltaDistX;
      mapX += stepX;
      side = WallSide.Vertical;
    } else {
      sideDistY += deltaDistY;
      mapY += stepY;
      side = WallSide.Horizontal;
    }

    if (!scene.contains(mapX, mapY)) return hits;

    const cell = scene.getCell(mapX, mapY);
    const segment = cell.walls[0];
    if (segment === undefined) continue;

    const perpDistance =
      side === WallSide.Vertical ? sideDistX - deltaDistX : sideDistY - deltaDistY;
    const perpDistanceBack = sideDistX < sideDistY ? sideDistX : sideDistY;

    let wallU: number;
    if (side === WallSide.Vertical) {
      wallU = origin.y + perpDistance * direction.y;
    } else {
      wallU = origin.x + perpDistance * direction.x;
    }
    wallU -= Math.floor(wallU);

    hits.push({
      perpDistance,
      perpDistanceBack,
      side,
      cell: new Vec2(mapX, mapY),
      tile: segment.tile,
      wallU,
      segment,
    });

    // Stop once we hit a wall that covers the full vertical range —
    // anything past it is occluded for every screen y in this column.
    const fullOccluder = segment.startZ <= 0 && segment.startZ + segment.height >= 1;
    if (fullOccluder) return hits;
  }

  return hits;
}

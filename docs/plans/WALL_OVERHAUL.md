# Wall overhaul — sector-style geometry

Plan for migrating the renderer from Wolfenstein-style fixed-shape walls
to **Build-engine-style** variable geometry: per-cell floor/ceiling
heights, multiple partial walls per cell, and proper z-clipping for
sprites and walls against each other.

The user picked the **full vision** (Phase 1 + 2 + 3) and **wall-local
UVs** for texturing (the wall's `[startZ, startZ+height]` range maps to
`[0, 1]` of the texture, then `offsetX`/`offsetY` slide the sample).

This is a multi-session refactor touching both renderers. Treat this
document as the canonical brief — a fresh Claude session can start
from here.

**Status (2026-05-16):** Phase 1 (variable wall heights + caps +
multi-slab + per-cell-corner LOS) shipped. Phase 2 (per-cell floor
+ ceiling heights) and Phase 3 (partial-width walls + true DDA)
pending.

---

## 1. Existing architecture (what to evolve away from)

The map is a 2D grid. Each cell:

```ts
// packages/engine/src/Scene.ts
interface Cell {
  wall: number;           // 0 = open, > 0 = solid wall (tile id)
  floor: { tile, reflectiveness, transition };
  ceiling: { tile, reflectiveness, transition };
}
```

Walls always fill a cell floor-to-ceiling and edge-to-edge. The
floor is implicitly at `z=0`, the ceiling at `z=1`. The camera sits
between them (default `cameraZ = 0.5`; jump/crouch already shipped).

Rendering:
- **CPU backend** `packages/engine/src/Renderers/TwoDRenderer.ts` — DDA in
  `drawWorld`, one wall hit per ray, wall column + floor/ceiling
  column written together. Per-column wall distance is captured in
  `columnDepth` for the sprite pass to z-clip against.
- **GPU backend** `packages/engine/src/Renderers/WebGLRenderer.ts` — same DDA on CPU
  produces `u_columns` (1×W RGBA32F: perpDist, wallU, sideMul,
  wallTile). The fragment shader does the per-pixel work.

Sprites get z-clipped via the per-column distance — fine as long as
walls have one perpDist per column. **Breaks** as soon as a column
contains multiple walls at different distances.

`cameraZ` is already plumbed end-to-end (jump/crouch). That's good
news — the asymmetric wall positioning math is in place.

---

## 2. Target data model

### 2.1 Cell

```ts
interface Cell {
  walls: WallSegment[];      // 0..N walls in this cell (was: single tile id)
  floor: FloorSpec;
  ceiling: CeilingSpec;
}

interface WallSegment {
  tile: number;              // texture id (manifest tileTextures)
  /** Vertical extent in world units. */
  startZ: number;            // 0 = floor level, 1 = ceiling level
  height: number;            // span in world units
  /** Texture offset in texel units; wraps. */
  offsetX: number;
  offsetY: number;
  /**
   * Which face of the cell the wall sits on AND how far across that face.
   * Build-engine-style "wall as a line segment" within the cell.
   *
   *   face: which cell edge the wall lies on (N / S / E / W).
   *   startU: where along the edge the wall begins, [0, 1].
   *   widthU: how much of the edge the wall covers, (0, 1].
   *
   * A "full wall" (legacy) is { face: …, startU: 0, widthU: 1 }.
   */
  face: "N" | "S" | "E" | "W";
  startU: number;
  widthU: number;
}

interface FloorSpec {
  tile: number;
  height: number;            // world z of the floor surface; default 0
  reflectiveness: number;    // existing
  transition: number;        // existing
}

interface CeilingSpec {
  tile: number;
  height: number;            // world z of the ceiling surface; default 1
  reflectiveness: number;
  transition: number;
}
```

**Rationale for `face` instead of free placement**: a wall is a 1-D
segment in the floor plane. Constraining each wall to a cell *edge*
keeps DDA grid-aligned and keeps the data authoring legible. Diagonal
walls or arbitrary polygons would force us off the grid entirely.

**Authoring note**: the user's original proposal was a flat
`tile_offX_offY_startZ_height_startX_width` string. We can still emit
that string form alongside the structured object — the parser splits
on `_`, the renderer reads the structured object. The legacy short
form `walls: number[][]` (an int per cell, full wall when nonzero)
must still parse for backward compatibility with `scene1.json`.

### 2.2 Scene JSON

Augment the existing `SceneJSON` (see `packages/engine/src/Scene.ts`) with an
optional `cells` array. Old `walls` / `floors` / `ceilings` arrays
keep working as a shorthand for "full walls + flat floor at z=0 +
flat ceiling at z=1." Parser code lives in `Scene.fromJSON`.

```json
{
  "spawn": { "x": 32.5, "y": 58.0, "facing": 0 },
  "cells": [
    [
      {
        "walls": [
          {
            "tile": 1, "face": "N", "startU": 0, "widthU": 1,
            "startZ": 0, "height": 0.5,
            "offsetX": 0, "offsetY": 0
          }
        ],
        "floor": { "tile": 2, "height": 0, "reflectiveness": 0, "transition": 0 },
        "ceiling": { "tile": 3, "height": 1, "reflectiveness": 0, "transition": 0 }
      },
      …
    ],
    …
  ]
}
```

---

## 3. DDA traversal

Current DDA in `packages/engine/src/Libs/Raycast.ts` (`castRayToWall`):
- Steps cell-by-cell along the ray.
- Stops at the first cell where `scene.isWall(x, y)`.

### 3.1 New behavior

A ray crosses cells along the standard grid stepping path, but
**inside each cell** it checks every `WallSegment.face` for
intersection with the segment's `[startU, startU + widthU]` extent
along the cell's edge.

For each candidate hit, compute:
- `perpDistance` — same as before.
- `wallU` (texture-space U within the segment, normalized to its
  `widthU`).
- `wallSegment` reference — the renderer needs `startZ`, `height`,
  `tile`, `offsetX`, `offsetY` to draw the vertical span.

The ray may hit **multiple** wall segments at different distances
(low wall in front, taller wall behind). Collect all of them sorted
by `perpDistance` ascending.

### 3.2 Algorithm sketch

```pseudo
hits: WallHit[] = []
loop DDA cell traversal:
  for each wall in current cell:
    if wall.face matches the ray's incoming side from this cell:
      t = intersection distance from camera along the ray
      u = position along the face's edge
      if u in [wall.startU, wall.startU + wall.widthU]:
        hits.push({ t, wallU = (u - wall.startU) / wall.widthU, wall })
  step DDA
  // Termination: once we've gathered "enough" hits and no more
  // walls can occlude what's already collected, we can early-out.
  // For correctness, just walk to maxRaySteps.
sort hits by t ascending
return hits
```

**Performance**: every cell crossed multiplies by `walls.length`.
Most cells will have 0-1 walls. Worst case is dense interior walls;
acceptable.

**Open-cell handling**: a cell with no walls just gets DDA-stepped
through. A cell with a partial-width wall on one face still lets the
ray "miss" the wall when it crosses elsewhere on that face.

### 3.3 New WallHit shape

```ts
interface WallHit {
  perpDistance: number;
  wallU: number;           // 0..1 within the segment
  segment: WallSegment;    // for startZ/height/offset access
  side: WallSide;          // existing enum, derived from face
  cellX: number;           // for AO / lookup
  cellY: number;
}
```

Tests: cover the legacy "full wall" case (face = whichever edge the
ray crosses, startU=0, widthU=1) — output must equal old castRayToWall
within float precision.

---

## 4. Wall pass — interval-based rendering

A single screen column now has potentially multiple wall slabs.
Each slab covers a vertical range; behind it, you can see further
walls AND the floor/ceiling spans between them.

### 4.1 Per-column slab list

For each column x:
1. Run new DDA → list of hits sorted by perpDistance ascending.
2. For each hit, compute screen y-range:
   - `wallScreenTop = horizonY - (segment.startZ + segment.height - cameraZ) * (height / perpDist)`
   - `wallScreenBottom = horizonY - (segment.startZ - cameraZ) * (height / perpDist)`
   - (Asymmetric centering; already implemented in jump/crouch refactor — extend to use segment.startZ + segment.height as the "top z" instead of always 1.)
3. Render slabs **back-to-front** (farthest first) so nearer slabs
   correctly overwrite distant ones.

### 4.2 Texture sampling (wall-local UV)

Per the user's pick:
- `texV = (worldZ_at_pixel - segment.startZ) / segment.height` →
  segment's vertical extent maps to `[0, 1]` of the texture.
- `texU = wallU` (already 0..1 within the segment).
- Apply `offsetX` / `offsetY` (in texel units): `texU += offsetX / textureWidth`, etc., wrap modulo 1.

A 1-tall full wall (legacy) maps to the existing texturing. A
half-height wall stretches the texture to half height — fine for
the simple case. If artwork looks ugly because the texture stretches,
authors can use a different tile or set `height` to match the
texture's natural aspect.

### 4.3 Floor/ceiling visibility through gaps

When a column has a low wall in front and tall wall behind, the
visible y-ranges per column are something like:

```
[ ceiling …  far wall top … near wall top … floor visible over near wall … near wall body … floor in front of near wall ]
```

The wall pass writes wall slabs at their projected y-ranges. The
floor/ceiling pass fills everything else.

### 4.4 Wall column buffer

Currently `columnWallBuffer` holds one wall column's pixels for the
reflection mirror. With multiple walls per column, we need either:
- Per-slab buffers (allocate per hit).
- A single column buffer indexed by screen-y; each slab writes its
  pixels into the right y-range.

Use the single-buffer approach. The reflection mirror logic
currently samples `columnWallBuffer[mirroredY]` — that still works as
long as the y-coordinate is the slab's screen y.

---

## 5. Floor / ceiling pass — per-cell heights

Currently the floor pass marches `p = 1 … maxP` outward from the
horizon and computes `rowDistance = posZ / p` where `posZ = cameraZ
* canvasHeight`. This assumes a flat floor at `z = 0`.

With per-cell floor heights:
- A given screen pixel at row offset `p` below the horizon maps to a
  **different** world distance depending on which cell's floor it
  intersects.
- The projection equation is `screenY = horizonY + (cameraZ -
  floorHeight) * canvasHeight / D`, solved for `D` given `screenY`.
- But `floorHeight` depends on which cell `D` lands in. Chicken/egg.

### 5.1 Per-column floor raymarch

For each column, march outward from the horizon (or from the
nearest wall hit) and **iterate**:
1. Start with an assumed floor height (e.g. previous cell's height,
   or 0).
2. Compute candidate distance `D = (cameraZ - assumedHeight) * H / p`.
3. Look up the cell at `(position + D * rayDir)`.
4. If that cell's `floor.height` ≠ assumed, recompute `D` with the
   new height. Usually converges in 1-2 iterations.

Alternative (simpler, slightly less accurate): march in distance
units rather than screen-y units. Step `D` outward; for each `D`,
look up the cell, then convert to `screenY` via the projection.
Write pixels whose `screenY` lands in the current row. Pros: cells
naturally drive height. Cons: variable step size, more work per row.

### 5.2 "Step up" geometry — looking onto a raised floor

If the next cell has a higher floor than the current, the ray
crossing the cell boundary "hits" the raised floor at some
distance. From there outward, that cell's higher floor surface is
visible. This works naturally with the iterative algorithm — the
projected distance shortens at the boundary.

If the next cell has a LOWER floor, you can see "down into" it
(like a pit). The lower floor is visible only at screen rows below
the boundary.

For a first cut, **clamp** to the closer of the two heights to
avoid weird edge cases — the proper way is to render the vertical
"riser" between cells as a wall (which is how Build engine handles
it).

### 5.3 Ceiling pass — same idea

Same as the floor pass but mirrored: `screenY = horizonY -
(ceilingHeight - cameraZ) * H / D`, ceiling heights look up the
ceiling layer per cell. Lowered-ceiling cells (e.g. a tunnel under a
larger room) become visible above the player as a step-down.

Risers between cells with different ceiling heights ALSO render as
walls — the ceiling "drop" is a vertical surface.

### 5.4 Implicit walls (risers)

Between cell A (floor at 0) and cell B (floor at 0.3), there's a
0.3-tall wall along the shared edge. This isn't authored — it's
implicit.

Options:
- **Implicit risers (recommended)**: the renderer detects floor /
  ceiling height changes between adjacent cells and renders a
  riser segment automatically. Texture taken from the lower cell's
  floor by default, or a designated `riser` field on `FloorSpec`.
- **Explicit risers**: authors must place a `WallSegment` to
  describe the riser. Verbose but flexible.

Implicit risers are the better default. Add an optional
`floor.riserTile` and `ceiling.riserTile` to let authors override
the texture.

---

## 6. Sprite z-clipping

Current per-column scalar `columnDepth[x]` no longer suffices — a
sprite might appear *above* a low wall and *below* a tall one in
the same column.

### 6.1 CPU backend

Switch to a per-pixel depth buffer:

```ts
private depth: Float32Array;   // length = canvasWidth × canvasHeight
```

The wall pass writes `perpDistance` into every pixel it draws. The
floor/ceiling pass writes its `rowDistance`. The sprite pass tests
`if (depth[idx] < sprite.camY) skip else write`.

Memory: 600×600 × 4 bytes = 1.44 MB. Fine.

### 6.2 GPU backend

Enable the WebGL depth buffer:
- Create the canvas with `depth: true` (default already).
- Add `gl_FragDepth = perpDistance / fogDistance` (normalized) in the
  fragment shader for the world pass.
- Sprite shader does the same for its camY, with depth testing
  enabled.

Free occlusion. Cleaner than the current `u_columns` z-test in the
sprite shader.

---

## 7. WebGL fragment shader changes

The current `FRAG_WORLD_SRC` is structured around one wall hit per
column. Two options:

### 7.1 Keep CPU-driven, fatter `u_columns`

CPU computes the full slab list per column. Upload as a wider
texture: `u_columns` becomes `MAX_SLABS_PER_COLUMN × W`, each texel
encodes `(perpDist, wallU, segmentIndex, …)` for one slab.

Per pixel:
1. Loop `u_columns` slabs at this x.
2. For each slab, decide if `y` is in its `[wallTop, wallBottom]`.
3. If yes, sample the wall texture using `(wallU, texV)` with
   segment-supplied `startZ/height/offsets`.
4. Pick the *nearest* slab whose range contains `y`.
5. If no slab contains `y`, fall through to floor/ceiling.

Floor/ceiling sampling: needs per-cell heights. Upload a second
scene data texture with `floor.height` / `ceiling.height` per
cell. The shader's floor raymarch reads them.

### 7.2 Move DDA to a compute / vertex pass (advanced)

Out of scope for v1. Stick with CPU-driven DDA.

### 7.3 New uniforms / textures

- `u_segments`: a 2D float texture indexed by segment id, encoding
  `(tile, startZ, height, packed flags…)`. Or pack per-slab data
  directly into `u_columns` to avoid the extra fetch.
- `u_sceneHeights`: `SW × SH × RGBA32F` with
  `(floorHeight, ceilHeight, riserTileFloor, riserTileCeil)` per cell.
- Existing `u_sceneTiles` / `u_sceneRefl` carry over with their
  current shape.

---

## 8. Migration of `scene1.json`

The current scene1 (`packages/default-pack/scenes/scene1.json`)
uses the legacy `walls`/`floors`/`ceilings` shorthand. Two paths:

### 8.1 Compatibility (recommended)

Keep the legacy parser. Convert internally to the new `Cell` shape
with single full-wall segments per cell. The renderer always works
on the new shape.

### 8.2 Showcase scene

Author a new `scene_demo.json` that uses the full new format —
variable-height rooms, partial walls, raised platforms. Use it as
the visual regression test for the overhaul.

`apps/pack-builder/src/generate-scene.ts` should also be updated to emit the new
format (still legacy-compatible) and add an opt-in flag for
height variation.

---

## 9. Phased delivery

Inside the "full vision" pick, build in this order so each step
ships visible value:

### Phase 1 — Variable wall heights (walls still fill cell)

1. Extend `Cell` schema with `walls: WallSegment[]`. Legacy parser
   converts to single full-cell wall with `startZ=0, height=1,
   face=appropriate, startU=0, widthU=1`. Renderers still treat each
   cell as having at most one full-width wall (don't touch DDA yet —
   walls still align to cell edges with full width).
2. Update wall pass to use `segment.startZ / height` instead of
   assumed `[0, 1]`.
3. Both renderers; sprite z-test unchanged (single distance still
   works since only one wall per column).
4. Demo: scene with mixed wall heights — half-walls (windows),
   raised pillars at full height, etc.

### Phase 2 — Per-cell floor/ceiling heights + implicit risers

1. Extend `FloorSpec` / `CeilingSpec` with `height`.
2. Rewrite floor/ceiling pass with iterative per-column raymarch.
3. Detect adjacent-cell height jumps; render risers.
4. Sprite z-clipping: upgrade to per-pixel depth buffer (both
   backends).
5. Demo: scene with raised platforms, sunken pits, lowered tunnel
   ceilings.

### Phase 3 — Partial walls (multiple per cell, variable widthU)

1. Real new DDA that walks each cell's wall list.
2. Wall pass handles multiple slabs per column; back-to-front
   sorted.
3. Reflective wall mirror in the floor pass: works per-slab.
4. WebGL shader gains the per-column slab list.
5. Demo: scene with windows (partial wall + gap above), columns
   inside rooms (cells with central pillars), L-shaped wall
   placements.

Each phase merges independently. Phase 2 unblocks vertical level
design; Phase 3 unblocks complex interior geometry.

---

## 10. Files to touch (likely)

- `packages/engine/src/Scene.ts` — schema, `fromJSON` parser, legacy-shorthand
  converter, `Cell` type, new `WallSegment`.
- `packages/engine/src/Libs/Raycast.ts` — new `castRayThroughWalls` returning sorted
  hits; keep `castRayToWall` as a back-compat wrapper.
- `packages/engine/src/Renderers/TwoDRenderer.ts` — wall pass, floor pass, ceiling
  pass, per-pixel depth buffer, sprite z-clip via depth.
- `packages/engine/src/Renderers/WebGLRenderer.ts` — analogous changes, fragment
  shader rewrite, new scene-heights texture, slab list in
  `u_columns`.
- `packages/engine/src/Renderers/SceneRenderer.ts` — interface unchanged externally
  (drawWorld / drawSprites signatures stay), internal contracts
  shift.
- `packages/default-pack/scenes/scene1.json` — keep legacy or add
  alongside.
- `apps/pack-builder/src/generate-scene.ts` — emit new format with optional
  height variation.
- New: `packages/default-pack/scenes/scene_demo.json` — showcase
  the new geometry.

Touchpoints in jump/crouch (already done) are good news — the
asymmetric `cameraZ` math is already correct; we're just extending
it to use per-segment `startZ` and per-cell heights.

---

## 11. Risk register

- **Floor pass performance** — iterative raymarch per pixel is
  pricier than the current closed-form formula. Profile early on a
  64×64 map. Mitigations: limit iterations to 2, use SIMD-friendly
  arrays, switch to span-based rendering if needed.
- **Riser correctness** — easy to get visual seams where risers meet
  floors. Test with adjacent cells at different heights aggressively.
- **Sprite depth** — switching to per-pixel depth changes the
  contract with `SpriteRenderSystem`. Verify with the existing ammo
  packs that nothing regresses.
- **WebGL slab budget** — `u_columns` width × `MAX_SLABS_PER_COLUMN`
  is the per-frame cost. Start with `MAX_SLABS = 4`, observe.
- **Legacy scene parsing** — every existing `.apg` (just the
  default pack right now) MUST keep working. Lock with a smoke test.

---

## 12. Open questions to flag to the user

1. **Diagonal walls?** Currently spec'd as on cell edges only. If
   the user wants 45° walls or arbitrary lines (Doom linedefs),
   that's a *separate* refactor (full off-grid geometry, BSP-like
   structures). Probably "no" for now — stay grid-aligned.
2. **Floor/ceiling height ramps?** A "floor with a slope from 0 to
   0.5 across one cell" needs a different floor renderer. Probably
   "no" for v1 — only flat floors per cell, height changes happen at
   cell boundaries.
3. **One floor / one ceiling per cell**, or stacked floors (mezzanine
   above)? Stacked sectors are a Build engine concept. Probably "no"
   — single floor/ceiling per cell.
4. **Texture wrap mode in `offsetY`** — repeating textures wrap;
   what about a wall taller than the texture's natural height? With
   wall-local UVs, the texture stretches. Confirm that's fine, or add
   a `texHeight` field on `WallSegment` to control the vertical
   sampling rate.

Get answers before Phase 1 starts — they shape the schema.

---

## 13. Bootstrap commands for the fresh session

```sh
# Catch up on shipped work
cat docs/PLAN.md
# Read the existing renderer (the meat of the change)
sed -n '160,400p' packages/engine/src/Renderers/TwoDRenderer.ts
sed -n '264,360p' packages/engine/src/Renderers/WebGLRenderer.ts
# Existing DDA + Scene
cat packages/engine/src/Libs/Raycast.ts
cat packages/engine/src/Scene.ts
# Look at how jump/crouch already plumbed cameraZ
grep -rn "cameraZ" packages/engine/src
# Smoke test
bunx tsc -b && bun run build-packs && bun run build
```

Then start on **Phase 1**: extend `Cell` schema, add the
legacy-shorthand converter, update the wall pass in both renderers
to use `segment.startZ + height` instead of the implicit `[0, 1]`
band. Phase 1 alone should give visible value (mixed wall heights,
windows) without touching DDA or the floor pass.

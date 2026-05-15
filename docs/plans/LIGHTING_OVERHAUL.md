# Lighting overhaul — bake-heavy, runtime-light

Replace the current fog-distance attenuation with a real emissive
lighting model. Static lights bake into a per-scene lightmap at
`bun run build-packs` time so the runtime is mostly texture lookups;
dynamic lights (player flashlight, item glow, muzzle flash) add at
runtime with bounded LOS raycasts.

This is the canonical brief — both for the current session and any
fresh session that picks it up.

---

## 1. Goals & scope

- **All visibility comes from emission.** Default scene = pitch black.
  Walls, floors, ceilings, items only show where light reaches them.
- **Maximum work at bake time, minimum at runtime.** Anything static
  is precomputed; runtime is bilinear sample + a handful of dynamic
  light adds.
- **Smooth gradients.** Per-cell-corner lightmap (4 corners per cell)
  + bilinear interpolation at runtime — fast and visually clean for
  the Wolfenstein-grid geometry we have.
- **Authoring is simple.** Drop `lights` into scene JSON; flag any
  surface as `emissive`; the bake handles the rest.
- **Backward-compat.** Scenes with no lights bake to a uniform fully-
  lit lightmap — they look exactly like they do today.

Not in this phase:
- Coloured shadows / penumbras.
- Volumetric / god-rays.
- Indirect bounces beyond a single albedo×light multiply.
- Path-traced area lights with sampled visibility (we approximate area
  lights as a small grid of point lights).

---

## 2. Architecture

```
authoring → build-time → runtime → shader

scene.json (lights + emissive flags)
        │
        ▼
scripts/build-packs.ts            (existing)
        │
        ▼
scripts/bake-lights.ts            (NEW)
   - reads scene, runs DDA-LOS bake for each light
   - emits per-cell-corner lightmap + per-wall-segment lightmap
        │
        ▼
default.apg/scenes/scene1.json (now includes baked `lightmap` field)
        │
        ▼
runtime: Scene.fromJSON loads lightmap → Scene.lightmap
        │
        ▼
both renderers: sample lightmap bilinearly per pixel
        │
        ▼
runtime dynamic lights: iterate visible Light entities, add to sample
```

Two distinct surfaces:
- **Surface = a wall slab / floor cell / ceiling cell pixel.** Its
  final colour is `albedo × max(staticLight + dynamicLight, ambient)`.
- **Light source = a point with colour + intensity + radius.** Static
  ones live in scene JSON and get baked. Dynamic ones live on
  entities (Light component).

---

## 3. Data model

### 3.1 Lights in the scene file

```jsonc
{
  "spawn": { "x": 2.5, "y": 5.5, "facing": 0 },
  "lights": [
    {
      "x": 5.5, "y": 4.5, "z": 0.8,
      "color": [1.0, 0.85, 0.6],
      "intensity": 2.0,
      "radius": 8.0
    }
    // (later) {"type": "spot", "direction": [...], "cone": 30, ...}
  ],
  "walls": [ ... ],
  "floors": [ ... ],
  "ceilings": [ ... ]
}
```

Defaults — `z = 0.5` (mid-cell), `color = [1, 1, 1]` (white),
`intensity = 1`, `radius = 6`. Authors only spell out what differs.

### 3.2 Emissive on surfaces

Optional per-surface `emissive`:

- `FloorSpec.emissive: { color: [r,g,b], intensity: number }`
- `CeilingSpec.emissive: ...`
- `WallSegment.emissive: ...`

Two behaviours fall out of one field:
- **Self-illumination** — at runtime the pixel adds
  `emissive.color × emissive.intensity` to its lit colour. Cheap; the
  surface looks bright even in the dark.
- **Area light** — at bake time, every emissive surface auto-spawns a
  matching light entry. Default behaviour, opt-out per-surface with
  `emissive.areaLight: false` for cases where the surface should glow
  but not illuminate other surfaces.

Floor/ceiling area lights spawn at the cell centre at `z=0` or `z=1`
respectively. Wall area lights spawn at the wall's centre.

### 3.3 Baked lightmap (output of the bake)

```ts
interface SceneLightmap {
  /**
   * RGB per cell corner — shape `(width+1) × (height+1) × 3`.
   * Sampled bilinearly at runtime by floor/ceiling at `(worldX,
   * worldY)`. Stored flat as a Float32Array for direct
   * Float32Array slicing into the WebGL upload.
   */
  cornerRGB: Float32Array;
  /**
   * RGB per wall-segment "lit strip" — for each wall the bake
   * samples N points along its [startU, startU+widthU] range at the
   * vertical midpoint. Wall pass samples this for the slab colour.
   * Shape `(segments × samplesPerWall × 3)`.
   */
  wallRGB: Float32Array;
  /** Header so the runtime knows shapes without reparsing. */
  width: number;
  height: number;
  samplesPerWall: number; // default 4
}
```

Embedded directly in the scene JSON for now (encoded as base64 of
the Float32 buffer + dimension header). Tiny per scene: 64² + 1
corners × 3 × 4 = ~50 KB raw, ~70 KB base64 — well under the
existing scene size.

Later we can split into a sibling `.lightmap.bin` file if scenes get
huge, but compatible with the current `.apg` zip format either way.

---

## 4. Bake pipeline

`scripts/bake-lights.ts` — invoked from `scripts/build-packs.ts` for
each scene file in each pack.

```pseudo
for each scene file:
  parse scene
  collect all light sources (explicit + auto-spawned from emissive)
  for each corner (cx, cy) in [0..W] × [0..H]:
    accumulator = [0, 0, 0]
    for each light:
      d = distance(corner, light)
      if d > light.radius: continue
      atten = falloff(d, light.radius)
      if !visible(corner_world, light_world): continue
      accumulator += light.color × light.intensity × atten
    cornerRGB[cy * (W+1) + cx] = accumulator
  for each wall segment:
    for k in [0..samplesPerWall]:
      // sample point at the slab's mid-height, along the face
      // ... same iteration as corners
  write scene with embedded lightmap
```

### 4.1 Visibility test (LOS)

For each (point, light) pair: cast a DDA ray from `light` to `point`.
If a **full-height occluder** sits between them, the light is
blocked. Partial walls (knee walls, headers) don't block at z=lightZ
unless they cover that z-range — needs a slab-aware DDA variant.

For Phase 1 simplicity: use the existing `castRayThroughWalls` and
treat any wall along the path as blocking. Phase 2 makes it slab-aware
(only walls whose `[startZ, startZ+height]` includes the segment's
midpoint count as occluders).

### 4.2 Falloff function

Inverse-square with a clamped 1/(1+d²) shape so the centre doesn't
blow up:

```
atten = max(0, 1 - (d / radius)²)²   // smoothstep-style
```

Symmetric, soft edges at the radius, contributes most near the
source — looks better than pure linear or pure 1/d².

### 4.3 Area light approximation

An emissive ceiling tile spans 1×1 in world. Treat it as a 3×3 grid
of point lights at z=1, each at 1/9 the intensity. The bake samples
each one with its own LOS test — close to a real area light without
introducing path tracing.

Knob: `manifest.lighting.areaLightSamples` (default 3, i.e. 3×3 grid).

### 4.4 Cost & perf

Per scene:
- corners ≈ (W+1)² ≈ 4225 for a 64² map
- + (segments × samplesPerWall) ≈ 200×4 = 800 for a typical map
- × lights (say 20 typical, 50 with auto-spawned area lights)
- × DDA visibility = maxRaySteps ≈ 64
- ≈ 7M DDA steps per scene → well under 1 second in JS.

The bake is incremental — only re-runs when the scene mtime is newer
than its baked output, so iteration is fast.

---

## 5. Runtime — both renderers

### 5.1 Scene loads lightmap

`Scene.fromJSON` parses the `lightmap` blob into `Scene.lightmap`
(typed). Renderers receive it via `scene` like they do today.

### 5.2 Sampling

For each pixel that's drawn (wall / floor / ceiling / cap / sprite):
```
worldPos = ... (already computed for floor/cap; for walls = cell + UV)
staticLight = bilinearSample(scene.lightmap.cornerRGB, worldPos)
dynamicLight = sumOverVisibleLights(worldPos)
emissive = surface.emissive ?? [0,0,0]
litColor = albedo × clamp(staticLight + dynamicLight + emissive, 0, 1)
```

For walls, the bake produced wallRGB samples along each segment's
face; the wall pixel uses those (interpolated by wallU) instead of
sampling the corner grid (which is for floor/ceiling).

### 5.3 Dynamic light loop

Each frame, the renderer:
1. Builds the visible-lights list (those within view frustum + range).
   Tiny: a handful of entities.
2. For each pixel, iterates them, computes LOS via DDA (one per
   pixel × light pair, bounded by N_lights × maxRaySteps).
3. Adds contribution to the sampled static light.

GPU does this naturally; CPU backend caps to 4–6 dynamic lights to
keep frame time bounded.

### 5.4 WebGL specifics

- New uniform `u_lightmap` — `(W+1) × (H+1)` RGBA32F texture
  (bilinear sampling free in hardware).
- New `u_dynamicLights` — small UBO or array uniform of light
  positions/colors. Up to N_DYNAMIC_LIGHTS (16).
- Fragment shader's final colour pass: sample lightmap at world pos,
  accumulate dynamic lights, multiply with sampled albedo.
- Fog uniform path stays as a legacy fallback when lightmap is absent
  (back-compat for scenes without a bake).

### 5.5 canvas2d specifics

- `scene.lightmap.cornerRGB` indexed directly during the floor /
  ceiling / cap pass.
- Wall pass uses `scene.lightmap.wallRGB`.
- Dynamic lights iterated in a small inner loop per pixel — capped to
  4 for perf.

### 5.6 Backward-compat ambient

If a scene has no `lightmap`, runtime synthesises a uniform fully-lit
one at load (`cornerRGB.fill(1)`). Old scenes render unchanged. The
fog distance keeps its current behaviour as a soft attenuation on
top.

`manifest.lighting.ambient` (per pack, default `[0,0,0,0]`) is added
to every pixel — for moonlight / fog glow effects.

---

## 6. Dynamic lights — `Light` component

```ts
// src/Components.ts
export interface LightData {
  color: [number, number, number];
  intensity: number;
  radius: number;
  /** Light's z height (0 = floor, 1 = ceiling). Default 0.5. */
  z?: number;
}
export const Light = new Component<LightData>("Light");
```

Spawned from prefabs / mods, attached to whatever moves: held
weapons (flashlight attachment glow), dropped items (potion glow),
projectiles (muzzle flash, fireball).

### Held-light helper

Player + `Light` component: position is `Position + small offset
forward`. Renderer treats player-attached lights as following the
camera each frame — no special code, just a Position update each
frame (already handled by the input system).

---

## 7. Migration & defaults

- `Scene.fromJSON` learns the new `lights` array. If absent, scenes
  bake to fully-lit (back-compat).
- All existing demo scenes get implicit "fully lit" until lights are
  added.
- `scene1.json` (the procedural map) stays uniformly lit (no
  authored lights).
- `scene_heights_demo.json` gets a handful of lights at the corners
  + over each knee-wall row so the user can SEE the lighting result.

### Build pipeline change

`scripts/build-packs.ts` calls `bakeScene` for each scene before
zipping. Bake output is written into a `.apg`-internal `.baked.json`
alongside the source scene, or merged in-place — TBD. Net effect:
shipped `.apg` files include lightmaps.

For dev iteration, `bun run dev` should re-bake on scene save.
Server.ts watches the pack dir; can re-run `build-packs` on change.
Cheap because bake is fast.

---

## 8. Phased delivery

### Phase 1 — Plumbing + uniform light (zero gameplay change)
1. Add `lights` field + `lightmap` field to SceneJSON.
2. `Scene.fromJSON` parses both. When `lightmap` absent, generates
   uniform 1.0 cornerRGB.
3. Add `Scene.sampleLight(worldX, worldY)` bilinear helper.
4. Both renderers: pass the sampled light through (multiply albedo
   by sample). With uniform 1.0, no visible change.
5. Smoke test — every existing scene still renders correctly.

### Phase 2 — Bake step
1. `scripts/bake-lights.ts`: corners + visibility via DDA + falloff.
2. `scripts/build-packs.ts`: invoke bake before zipping.
3. Add lights to scene_heights_demo for the user to see the result.
4. Demo: dark room with a few floor lights, light pools visible.

### Phase 3 — Wall lightmap
1. Bake wall-segment samples too.
2. Both renderers sample `wallRGB` during the wall pass.
3. Without this, walls would sample at their cell-corner average —
   acceptable but blocky. Phase 3 makes walls match floors.

### Phase 4 — Emissive surfaces
1. Add `emissive` to FloorSpec / CeilingSpec / WallSegment.
2. Bake step auto-spawns area lights for emissive surfaces.
3. Runtime adds `emissive.color × intensity` to lit colour.
4. Demo: glowing ceiling tile, glowing rune wall.

### Phase 5 — Dynamic lights
1. `Light` component + ModAPI hook.
2. Renderers iterate visible Light entities per frame.
3. Per-pixel DDA LOS (capped count for canvas2d; full count for WebGL).
4. Demo: player-held flashlight attached to held weapon, follows the
   reticle.

### Phase 6 — Spot lights + cone falloff
1. Light.type = "spot" + direction + cone params.
2. Bake & runtime both compute angular falloff.
3. Flashlights use this.

Phases 1–4 are shippable independently and each gives visible
results. Phases 5–6 unlock the gameplay loop ("things only visible
when you light them").

---

## 9. Files to touch

- `src/Scene.ts` — `LightDef`, `SceneLightmap`, parser extensions,
  `Scene.lightmap`, `Scene.sampleLight`.
- `src/Components.ts` — `Light` component, `Emissive` on surface
  definitions.
- `src/Prefabs.ts` — optional helper for player-held lights.
- `src/Renderers/TwoDRenderer.ts` — sample static lightmap per
  pixel; dynamic light accumulator; multiply at the end.
- `src/Renderers/WebGLRenderer.ts` — analogous; new uniforms + UBO;
  shader gets a lighting block.
- `scripts/build-packs.ts` — bake invocation per scene.
- `scripts/bake-lights.ts` — NEW, the bake script.
- `src/Libs/Raycast.ts` — slab-aware LOS variant (Phase 2 enough,
  Phase 4 if we want emissive walls to bake LOS-correctly).
- `resources/packs/default/scenes/scene_heights_demo.json` — add a
  few lights for the demo.

---

## 10. Risk register

- **Bake time** — should stay <1s per scene for our sizes. Watch on
  generated 96² stress scenes.
- **WebGL lightmap upload** — RGBA32F texture per scene; uploaded
  once on scene load. Storage cost negligible.
- **Dynamic light count budget** — canvas2d caps at ~6, WebGL at
  ~16. Bigger scenes with lots of moving lights need light culling.
- **Emissive surface "double-light"** — emissive surface auto-spawns
  a light + its own emissive add. The bake should NOT include the
  emissive surface's own self-illumination in the lightmap, only the
  light's contribution to OTHER surfaces.
- **Lightmap interpolation seams** — at boundaries between cells with
  vastly different lighting (lit room next to pitch-black corridor),
  bilinear filtering bleeds across the wall. Use the corner grid
  (lightmap stored at corners shared by 4 cells) so the boundary
  values are computed once per corner — no seams.

---

## 11. Open questions

1. **Where do lightmaps live in the .apg?** Embedded base64 in the
   scene JSON, or sibling `.lightmap.bin`? Embedded is simpler;
   binary is leaner if scenes get huge.
2. **Re-bake on dev HMR?** Detect scene changes in `bun run dev` and
   re-bake automatically? Or require manual `bun run build-packs`?
   Auto is friendlier.
3. **Spot lights from the player?** Built-in flashlight attachment,
   or a generic item that mods can configure?

Defaults until otherwise specified:
1. Embedded in scene JSON.
2. Auto re-bake on scene save (cheap).
3. Flashlight is a generic emissive item; mods configure.

---

## 12. Phase 1 starting point

```sh
# Catch up
cat PLAN.md
cat LIGHTING_OVERHAUL.md
# Existing scene type
sed -n '1,250p' src/Scene.ts
# Renderer light-sample insertion points
grep -n "fogMul\|floorR =\|floorG =\|floorB =" src/Renderers/TwoDRenderer.ts | head
grep -n "fcColor\|wallColor" src/Renderers/WebGLRenderer.ts | head
```

Then start with Scene.ts: add `LightDef`, `SceneLightmap` types,
parse them in `fromJSON`, expose `Scene.lightmap` + a
`sampleLight(wx, wy)` bilinear helper. Once that's plumbed (with
fallback uniform map), wire both renderers to multiply by the
sample — should be invisible. Then move on to Phase 2 (bake).

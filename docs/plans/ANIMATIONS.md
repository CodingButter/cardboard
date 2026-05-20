# Animated sprites + multi-angle view variants — ANIMATIONS plan

Frame-based sprite-sheet animation + Doom-style multi-angle
view-dependent rendering for billboarded sprites. Replaces today's
single-image sprite path with a fully backward-compatible
animation-aware path that drives most of the difference between
"prop in a box" and "creature that turns to face you."

Source-of-truth for implementation. Phases A1–A4 below. Cross-refs:
the materials plan (shipped — variant-assembly model + ECS-attached
subsystem pattern this plan mirrors; see git log),
[ENGINE_PACK_SHADERS.md](./ENGINE_PACK_SHADERS.md) (sprite vertex
format + sprite atlas this plan extends),
[TILE_PRESETS.md](./TILE_PRESETS.md) (the `tileSheets` precedent for
grid-into-atlas decomposition),
[EDITOR.md](./EDITOR.md) (A3 authoring UX cross-refs the editor
plan — defer animation editor scope to a future EDITOR.md addition),
[MULTIPLAYER_PLAN.md](./MULTIPLAYER_PLAN.md) (A2 `onComplete` event
plumbing rides on the pending `api.events` from M-phase).

Last revised: 2026-05-16.

---

## 1. Goals & non-goals

### Goals

- **Frame-based sprite animation.** Manifest declares a sprite sheet
  (grid of frames). Named animations on the sprite list the frame
  indices, per-frame duration, loop flag, and optional `next`
  transition. An ECS `Animation` component drives playback per
  entity.
- **Multi-angle view variants.** A sprite can ship 1, 2, 4, 5, 8, or
  16 view angles. The engine selects the visible angle by computing
  the signed angle between the camera and the entity's `Facing`,
  rounded to the nearest cell. This is what makes raycaster enemies
  feel like they have a front and a back.
- **Backward compatible.** A manifest entry that omits
  `frameWidth`/`frameHeight`/`animations` keeps today's single-image
  path. An entity without an `Animation` component renders frame 0
  of angle 0. The default pack continues to load without manifest
  edits.
- **Pack-authorable.** Sprite sheets ship as ordinary PNG/JPG inside
  the `.apg`. Animation definitions live in `manifest.sprites`. No
  new file format, no auxiliary metadata files (the grid is the
  metadata).
- **Cheap per-frame cost.** Angle selection = one `atan2` + arithmetic
  per visible sprite. Frame advance = one branch per `Animation`
  component per frame. The renderer's hot path adds two `vec2`
  per-vertex attributes and reads them as the atlas region — no
  shader switch, no second draw call.
- **Mirror-aware atlas layout.** A sprite can declare `mirror: true`
  so the right-side angles in the atlas serve as horizontally-
  flipped sources for the left-side angles. Halves the disk + atlas
  footprint for symmetric sprites.

### Non-goals

- **Animation blending / hierarchical clips.** Single-clip playback
  per entity. Upper-body shoot + lower-body walk simultaneously is
  speculative; deferred to A4.
- **Skeletal animation.** No bones, no IK, no inverse kinematics —
  this is 2D sprite-sheet flipbook playback. The `character/player_idle.fbx`
  in the default pack is consumed by the animation editor's FBX importer
  ([ANIMATION_EDITOR.md AE2](./ANIMATION_EDITOR.md)) — Three.js + FBXLoader
  render it to a canonical multi-angle sheet at authoring time, then the
  engine plays the resulting 2D sprite sheet through this system.
- **Pixel-perfect crossfade between frames.** Default is hard-snap
  per frame. Crossfade between adjacent angles is opt-in (A2) and
  carries documented ghosting for pixel-art sources.
- **Per-frame collision boxes.** A sprite's collider, if any, is
  whatever the entity's other components describe. Animations don't
  retime collisions.
- **Texture atlas packing for non-grid sources.** Frame layout is
  always a regular grid (cols × rows × frame size). Pack the sheet
  in Aseprite / TexturePacker / Pyxel with grid mode; the engine
  doesn't read XML / JSON sidecars.
- **Animation HMR.** Editing `manifest.sprites` live re-decodes the
  sheet only on full pack reload. See §14, open question.
- **Sprite-shader interaction (per-frame variant).** A `Shader`
  component on an animated entity rides the same variant as it does
  today — animation has no opinion on shader hooks. The sprite's
  frame + angle just changes the UV region read by the existing
  fragment dispatcher.

---

## 2. Status quo

Today's sprite path (as of 2026-05-16):

- **Manifest** (`packages/default-pack/manifest.json`):
  ```jsonc
  "sprites": {
    "ammo_pack": { "image": "images/items/ammo_pack.png" }
  }
  ```
  `SpriteDef` in `packages/engine/src/AssetPack/types.ts` is one
  field: `{ image: string }`. No frames, no animations, no angle
  awareness.

- **Component** (`packages/engine/src/Components/Sprite.ts`):
  ```ts
  interface SpriteData {
    imageId: string;
    worldHeight: number;
    yOffset: number;
  }
  ```
  Pure positioning data — `imageId` is a one-shot lookup.

- **Render system**
  (`packages/engine/src/Systems/SpriteRenderSystem.ts`): queries
  every entity with `Position + Sprite`, pushes one
  `SpriteDrawRequest` per entity, hands the batch to the renderer.

- **Renderer atlas** (`packages/engine/src/Renderers/WebGLRenderer.ts`):
  `TEXTURE_2D_ARRAY` with one layer per `sprites` manifest entry.
  Per-vertex `a_uv` is always the full `[0,1]×[0,1]` quad of that
  layer. No UV slicing exists today.

- **Vertex layout**: 9 floats per vertex (36 bytes), already extended
  for materials-plan M1's `a_variant` (shipped). The hot field for this plan is
  `a_uv` (vec2) — currently fixed at the corners of the layer; this
  plan changes that to a region within the layer.

- **`Facing` component** (`packages/engine/src/Components/Facing.ts`):
  scalar radian angle, CCW from +x. Already present on the player
  entity; this plan starts using it on sprite-bearing entities.

Net: a sprite is a single image, view-independent, never animated.
The plan adds three orthogonal extensions (grid, animation,
multi-angle) that compose.

---

## 3. Multi-angle convention

### 3.1 Supported angle counts

| `angles` | Coverage | Use case |
|---|---|---|
| **1** | View-independent — every camera angle shows the same row | Pickups, projectiles, doors, props |
| **2** | 180° split: front + back | Very simple enemies, signs |
| **4** | 90° split: front, right, back, left | NPCs / props with clear orientation |
| **5** | 180° coverage stored, mirrored for the other 180°: front, front-side, side, back-side, back | 8-direction look with 5 textures (memory win) |
| **8** | 45° split: front, FR, right, BR, back, BL, left, FL | Classic Doom enemies |
| **16** | 22.5° split | Smooth high-detail enemies (rare) |

Other values (3, 6, 7, 9, …) are not supported. The pack-builder
should error on them.

The angle ids are zero-indexed and proceed **clockwise from front**
in the entity's local frame:

```
        0 (front)
   7         1
 6   entity    2
   5         3
        4 (back)
```

(Diagram shows the 8-angle case. 4-angle uses ids 0/2/4/6. 2-angle
uses ids 0/4. 5-angle: see §3.4.)

### 3.2 Angle-selection algorithm

```
// Inputs:
//   camera.x, camera.y    — world-space camera position
//   entity.x, entity.y    — world-space entity position
//   entity.facing         — radians, CCW from +x (Facing component)
//   angleCount            — number of cells (1, 2, 4, 5, 8, 16)

dx          = camera.x - entity.x
dy          = camera.y - entity.y
viewAngle   = atan2(dy, dx)               // angle from entity to camera
relAngle    = viewAngle - entity.facing   // entity-local
relAngle    = ((relAngle % TAU) + TAU) % TAU   // normalize [0, 2π)

step        = TAU / angleCount
angleIndex  = floor((relAngle + step/2) / step) mod angleCount
```

Worked example (8 angles): entity at (0,0) facing 0 rad (east),
camera at (3, 3). `viewAngle = atan2(3, 3) = π/4`. `relAngle = π/4`.
`step = π/4`. `angleIndex = floor((π/4 + π/8) / (π/4)) mod 8 =
floor(1.5) = 1`. The camera is looking at the entity from its
front-right, so we render angle 1 (front-right cell). Correct.

Worked example (4 angles): same entity + camera. `step = π/2`.
`angleIndex = floor((π/4 + π/4) / (π/2)) mod 4 = floor(1.0) = 1`.
Angle id 1 = right side. Correct (camera is to the entity's NE,
which rounds to right since we only have N/E/S/W).

Worked example (1 angle): step undefined, always returns 0. Skip the
math.

### 3.3 Mirror optimization

When a sprite declares `mirror: true`, the right-half angles in the
atlas serve double duty as the horizontally-flipped left-half
angles. The pack ships fewer textures; the renderer flips at draw
time via a negative-x `a_uvScale.x` (free — no shader branch).

Mapping for 8 angles with mirror enabled (only rows 0–4 ship in the
atlas; rows 5–7 are derived):

| `angleIndex` | Atlas row | Flip horizontal? |
|---|---|---|
| 0 (front) | 0 | no |
| 1 (FR) | 1 | no |
| 2 (right) | 2 | no |
| 3 (BR) | 3 | no |
| 4 (back) | 4 | no |
| 5 (BL) | 3 | **yes** |
| 6 (left) | 2 | **yes** |
| 7 (FL) | 1 | **yes** |

For 4 angles + mirror: rows 0, 1, 2 ship; row 3 (left) is row 1
(right) flipped. For 5-angle (always implies mirror — that's the
point of the layout): rows 0–4 ship and represent front, front-
side, side, back-side, back; the "other half" reads the same rows
1 and 3 flipped.

### 3.4 5-angle layout (special)

5 angles is a Doom-era trick to cover all 8 visual directions with
five textures by exploiting bilateral symmetry. The cells are:

| Cell | Atlas row | Represents | Flipped reads |
|---|---|---|---|
| 0 | 0 | front | — |
| 1 | 1 | front-quarter (FR) | also serves as FL with flip |
| 2 | 2 | side (right) | also serves as left with flip |
| 3 | 3 | back-quarter (BR) | also serves as BL with flip |
| 4 | 4 | back | — |

The angle-selection algorithm above runs with `angleCount = 8`
internally (the renderer always discretizes to 8 visual cells for
5-angle sprites), and the renderer remaps 8→5 via:

```
visualAngleIndex (0..7)  →  atlas-row + flip
  0 → row 0, no flip      (front)
  1 → row 1, no flip      (FR)
  2 → row 2, no flip      (right)
  3 → row 3, no flip      (BR)
  4 → row 4, no flip      (back)
  5 → row 3, flip x       (BL)
  6 → row 2, flip x       (left)
  7 → row 1, flip x       (FL)
```

So `mirror: true` is **implicit** for `angles: 5`. Setting
`mirror: false` with `angles: 5` is a manifest error.

### 3.5 Interpolation: snap vs. crossfade

- `interpolation: "snap"` (default) — nearest-neighbor angle. No
  blending. Recommended for pixel art.
- `interpolation: "crossfade"` — render both adjacent angle cells
  with alpha-blending. The blend weight comes from the remainder of
  the angle division: weight on cell N is `1 - (relAngle / step -
  floor(relAngle / step + 0.5) + 0.5)`. **Recommended only for
  non-pixel-art sources** (high-res or photographic) — pixel-art
  crossfading produces visible ghosting and double-edged silhouettes.
  Defer to A2; A1 ships snap only.

---

## 4. Manifest schema additions

### 4.1 Per-sprite fields

`SpriteDef` (in `packages/engine/src/AssetPack/types.ts`) gains:

```ts
export interface SpriteDef {
  image: string;
  /** Grid frame width in source-image pixels. Omit → single-image. */
  frameWidth?: number;
  /** Grid frame height in source-image pixels. */
  frameHeight?: number;
  /** Columns in the source sheet. */
  cols?: number;
  /** Rows in the source sheet. */
  rows?: number;
  /** Pixels of padding around each frame inside the grid cell. Default 0. */
  padding?: number;
  /** Pixels of offset before the first column / row begins. Default {x:0,y:0}. */
  offset?: { x: number; y: number };
  /** Default view-angle count for animations that don't override. Default 1. */
  angles?: 1 | 2 | 4 | 5 | 8 | 16;
  /** Right-half atlas serves left-half via h-flip. Default false. Implicit true for `angles: 5`. */
  mirror?: boolean;
  /** "snap" (default) or "crossfade" (A2 only). */
  interpolation?: "snap" | "crossfade";
  /** Named animations. Keys are arbitrary identifiers used by `api.anim.play(e, name)`. */
  animations?: Record<string, AnimationDef>;
}

export interface AnimationDef {
  /**
   * Frame indices into the sheet (row-major, top-left = 0). For
   * multi-angle sprites these are indices into the FRAMES axis of
   * the sheet (cols within a row), not the full sheet's flat index.
   * See §5 for atlas-layout convention.
   */
  frames: number[];
  /** Per-frame duration in seconds. */
  frameDuration: number;
  /** Default true. */
  loop?: boolean;
  /** Name of the next animation to play when this one finishes (loop: false). */
  next?: string;
  /** Override the sprite-level `angles` for this clip. e.g. die collapses to 1. */
  angles?: 1 | 2 | 4 | 5 | 8 | 16;
}
```

### 4.2 Full example

```jsonc
{
  "sprites": {
    "ammo_pack": {
      "image": "images/items/ammo_pack.png"
    },

    "zombie": {
      "image": "images/sprites/zombie-sheet.png",
      "frameWidth": 64,
      "frameHeight": 64,
      "cols": 8,
      "rows": 16,
      "angles": 8,
      "mirror": false,
      "interpolation": "snap",
      "animations": {
        "idle":   { "frames": [0, 1, 2, 1], "frameDuration": 0.2,  "loop": true },
        "walk":   { "frames": [0, 1, 2, 3, 4, 5], "frameDuration": 0.1, "loop": true },
        "attack": { "frames": [0, 1, 2, 3], "frameDuration": 0.08, "loop": false, "next": "idle" },
        "die":    { "frames": [0, 1, 2, 3], "frameDuration": 0.12, "loop": false, "angles": 1 }
      }
    },

    "fireball": {
      "image": "images/sprites/fireball.png",
      "frameWidth": 32,
      "frameHeight": 32,
      "cols": 4,
      "rows": 1,
      "angles": 1,
      "animations": {
        "spin": { "frames": [0, 1, 2, 3], "frameDuration": 0.05, "loop": true }
      }
    },

    "door_red": {
      "image": "images/sprites/door-red.png",
      "frameWidth": 64,
      "frameHeight": 96,
      "cols": 8,
      "rows": 1,
      "angles": 1,
      "animations": {
        "closed":  { "frames": [0],            "frameDuration": 1.0,  "loop": true },
        "opening": { "frames": [1, 2, 3],      "frameDuration": 0.08, "loop": false, "next": "open" },
        "open":    { "frames": [4],            "frameDuration": 1.0,  "loop": true },
        "closing": { "frames": [5, 6, 7],      "frameDuration": 0.08, "loop": false, "next": "closed" }
      }
    }
  }
}
```

### 4.3 Schema validation

At pack-load time the engine validates each sprite:

1. If any of `frameWidth`/`frameHeight`/`cols`/`rows`/`animations`
   is set, **all** must be set (no partial spec).
2. `angles` must be one of the allowed values. `mirror: false` with
   `angles: 5` is an error.
3. For each animation, `frames[i] < cols` for every frame index when
   the (effective) `angles` value × cols × `frames-per-angle-group`
   needs to fit inside `rows × cols`. The build-time validator in
   `apps/pack-builder` (A1 includes a small extension) performs the
   bounds check; a runtime check warns once and falls back to frame
   0.
4. `frameDuration > 0`.
5. `next` (if set) names a real animation on the same sprite.

Failures are warnings (renderer falls back to frame 0 of angle 0)
at runtime; the pack-builder upgrades them to build errors.

---

## 5. Atlas layout convention

**This is the single source of truth for how a multi-angle animated
sheet maps to the WebGL atlas.** Pack authors and the editor's
spritesheet importer (A3) both follow this convention.

### 5.1 Axes

- **Columns = frames within an animation.** Cell `(0, r)` is frame 0
  of whatever animation owns row `r`; `(1, r)` is frame 1; etc. The
  `cols` value is the maximum frames-per-animation the sheet
  supports.
- **Rows = (angle, animation) pairs, angles-first.** The first
  `angles` rows hold animation 0's per-angle strips; the next
  `angles` rows hold animation 1's per-angle strips; etc.

So for `angles: 8` and three animations (idle, walk, attack) at
`cols: 8`:

```
              col 0  col 1  col 2  col 3  col 4  col 5  col 6  col 7
row  0  idle  angle 0 (front)  — frames 0..7 (or however many idle uses)
row  1  idle  angle 1 (FR)
row  2  idle  angle 2 (right)
row  3  idle  angle 3 (BR)
row  4  idle  angle 4 (back)
row  5  idle  angle 5 (BL)
row  6  idle  angle 6 (left)
row  7  idle  angle 7 (FL)
row  8  walk  angle 0
row  9  walk  angle 1
...
row 15  walk  angle 7
row 16  attack angle 0
...
```

Total `rows = angles_used × animationCount` (with the largest
per-animation `angles` if an animation has a per-clip override). An
animation that overrides `angles: 1` occupies only **1** row, not
`angles_default`. The engine computes the row baseline per
animation by summing prior animations' `angles` values:

```
rowBase[a] = sum(animations[0..a-1].effectiveAngles)
```

The animation order is the order of the keys in the `animations`
object literal (JavaScript map insertion order is preserved). Pack
authors who care about layout stability should document the order
in the JSONC.

### 5.2 Frame-index resolution

Given:
- `animName` → look up `AnimationDef`
- `frame` = `Animation.frame` (index INTO `frames[]` array, not the
  atlas)
- `frames[frame]` = e.g. `2` (an animation-local frame number)
- `angleIndex` from §3.2

Atlas cell read:

```
animDef    = sprite.animations[animName]
animAngles = animDef.angles ?? sprite.angles ?? 1
atlasRow   = rowBase[animName] + angleIndex     // angleIndex < animAngles
atlasCol   = animDef.frames[frame]
```

For mirrored angles (see §3.3), `atlasRow` may map to a different
row + flip flag.

### 5.3 UV-region computation

```
sheetW       = sprite.frameWidth  * cols + padding * (cols - 1) + 2*offset.x
sheetH       = sprite.frameHeight * rows + padding * (rows - 1) + 2*offset.y

uvOriginX    = (offset.x + atlasCol * (frameWidth + padding))  / sheetW
uvOriginY    = (offset.y + atlasRow * (frameHeight + padding)) / sheetH
uvScaleX     = frameWidth  / sheetW   (negative if mirrored this draw)
uvScaleY     = frameHeight / sheetH
```

These four scalars are what the renderer writes per-vertex as
`a_uvOffset` (vec2) and `a_uvScale` (vec2). See §9.

### 5.4 Storage in the texture array

The atlas is still a `TEXTURE_2D_ARRAY` with one **layer per sprite
id** (existing layout — unchanged). The whole sheet uploads to a
single layer; UV regions select frames within that layer. Layer
resolution today is `SPRITE_LAYER_RESOLUTION` (square, ≈256 px) — A1
must raise it to accommodate larger sheets, OR change the atlas to
non-square layers, OR upload the full source sheet at native
resolution. **Recommendation: A1 changes the per-layer texture to
match the source sheet's `(sheetW, sheetH)` dimensions** (allocate
per-layer at upload time) and drops the fixed square normalization.

`TEXTURE_2D_ARRAY` requires all layers to share dimensions, so
"per-layer dimensions" actually means we either (a) normalize every
sheet to the max-of-pack `(maxW, maxH)` with letterbox (wasteful),
(b) switch the atlas to one `TEXTURE_2D` per sprite (loses batching
benefit — each sprite-id is now one texture binding), or (c) bucket
sheets by dimension and ship one `TEXTURE_2D_ARRAY` per bucket
(complex).

**A1 picks (a)** with a configurable max via
`CONFIG.rendering.spriteAtlasSize` (default 1024×1024). Sheets
larger than this clamp + warn at load. A future revision can adopt
(c) if memory pressure shows up.

---

## 6. ECS Animation component

### 6.1 Schema

```ts
// packages/engine/src/Components/Animation.ts
export interface AnimationData {
  /** Animation name — key in the sprite's `animations` dict. */
  current: string;
  /**
   * Index INTO `animations[current].frames` (not the atlas).
   * 0 ≤ frame < frames.length.
   */
  frame: number;
  /** Seconds elapsed in the current frame. 0 ≤ elapsed < frameDuration. */
  elapsed: number;
  /** When true the system doesn't advance. Default false. */
  paused?: boolean;
  /** Multiplier on dt for this entity. Default 1.0. */
  playbackRate?: number;
}

export const Animation = new Component<AnimationData>("Animation");
```

### 6.2 Lifecycle

- **Authored.** Prefab factories add the component immediately after
  `Sprite`:
  ```js
  api.world
    .add(e, api.components.Sprite, { imageId: "zombie", worldHeight: 1, yOffset: 0 })
    .add(e, api.components.Animation, { current: "idle", frame: 0, elapsed: 0 });
  ```
- **Mutated.** Pack scripts use `api.anim.play(entity, name)` to
  switch animations — that helper resets `frame` + `elapsed` to 0.
  Direct mutation of `current` without resetting `frame`/`elapsed`
  is permitted but the engine treats stale `frame` as bounds-clamped
  (modulo the new animation's frame count).
- **Read.** The `AnimationSystem` advances state every update tick;
  the `SpriteRenderSystem` reads `current` + `frame` per render to
  resolve the atlas region.
- **Optional.** An entity with `Sprite` but no `Animation` renders
  the first frame of the first animation (or frame 0 of angle 0 if
  the sprite has no animations declared).

### 6.3 Mod-defined-component parity

`Animation` ships as a built-in (registered in `BuiltInComponents`
and `ComponentRegistry.builtIns`), exposed as
`api.components.Animation`. Same plumbing as the existing `Sprite`
and `Shader` components.

---

## 7. AnimationSystem behavior

New engine system at
`packages/engine/src/Systems/AnimationSystem.ts`. Runs in the update
phase (not render) so the renderer reads stable state.

### 7.1 Per-frame loop

```ts
world.each(Sprite, Animation, (entity, sprite, anim) => {
  if (anim.paused) return;
  const def = pack.manifest.sprites[sprite.imageId];
  const animDef = def?.animations?.[anim.current];
  if (!animDef) return; // unknown animation — leave state untouched

  const rate = anim.playbackRate ?? 1.0;
  anim.elapsed += deltaTime * rate;

  // Drain elapsed; supports very high rates / very small frame durations.
  while (anim.elapsed >= animDef.frameDuration) {
    anim.elapsed -= animDef.frameDuration;
    anim.frame += 1;

    if (anim.frame >= animDef.frames.length) {
      if (animDef.loop) {
        anim.frame = 0;
        emit("animation:looped", { entity, animName: anim.current });
      } else if (animDef.next) {
        const prevName = anim.current;
        anim.current = animDef.next;
        anim.frame = 0;
        emit("animation:completed", { entity, animName: prevName });
        emit("animation:started", { entity, animName: anim.current });
      } else {
        // Stop on last frame.
        anim.frame = animDef.frames.length - 1;
        anim.paused = true;
        emit("animation:completed", { entity, animName: anim.current });
      }
    }
  }
});
```

### 7.2 Edge cases

- **Empty `frames`**: skip the entity, log once (`"animation 'x' on
  sprite 'y' has zero frames"`). Treat as paused.
- **`current` references a non-existent animation**: leave state
  alone (renderer falls back to first animation's first frame and
  warns once).
- **Switching animations mid-frame**: `api.anim.play` resets frame +
  elapsed; the engine emits `animation:started` for the new and
  `animation:completed` for the old if and only if the old was
  configured `loop: false` and was at its final frame (otherwise the
  old just gets cancelled — emit `animation:cancelled`).
- **`playbackRate < 0` (reverse playback)**: A1 does NOT support
  negative rates. Validation clamps to ≥ 0 and logs once. Reverse
  playback is a future extension; the manifest is the wrong place
  for it (mods can author a reverse animation by listing frames in
  reverse order).
- **Very small `frameDuration` + low frame rate**: the `while` loop
  drains correctly; one entity won't advance more than
  `frames.length` frames in a single tick (loop guard against
  pathological dt + ratio combinations).

### 7.3 Where it lives in the loop

`Game.update` registers the engine systems in order:
`PlayerMovementSystem`, `PickupSystem`, `WeaponSystem`, …,
**`AnimationSystem`** (new — runs near the end of update, BEFORE
rendering). Pack scripts' `registerSystem` callbacks run after
engine systems (today's order) — so a mod that wants to call
`api.anim.play` reacting to "attack hit" sees the up-to-date frame
state from this tick.

---

## 8. ModAPI additions

### 8.1 `api.anim`

```ts
// packages/engine/src/ModAPI/types.ts
export interface AnimAPI {
  /**
   * Switch to a named animation. Resets frame + elapsed to 0,
   * unpauses, fires `animation:started` (and `animation:cancelled`
   * for any in-flight non-loop animation that was interrupted).
   * No-op if the entity already plays `animName`.
   */
  play(entity: Entity, animName: string): void;
  /** Pause playback. Frame state preserved. */
  stop(entity: Entity): void;
  /** Resume playback. */
  resume(entity: Entity): void;
  /**
   * `true` if the entity has an Animation component AND is not
   * paused AND (when `animName` is given) `current === animName`.
   */
  isPlaying(entity: Entity, animName?: string): boolean;
  /**
   * Register a one-shot callback for when the entity's CURRENT
   * non-looping animation completes. Replaces any prior callback
   * for the entity. Cleared after firing.
   *
   * If `api.events` is available (post-MULTIPLAYER M1), this is
   * implemented as a thin wrapper that subscribes to
   * `animation:completed` filtered by `entity`. If not, the
   * AnimationSystem maintains an internal map<Entity, callback>.
   */
  onComplete(entity: Entity, callback: () => void): void;
}

export interface ModAPI {
  // ...existing fields...
  /** Sprite-animation control surface. See `AnimAPI`. */
  readonly anim: AnimAPI;
}
```

### 8.2 Events (A2 — depends on `api.events`)

When `api.events` ships (MULTIPLAYER_PLAN M1 adds it; ANIMATIONS A2
takes a hard dependency), the AnimationSystem fires:

| Event | Payload | When |
|---|---|---|
| `animation:started` | `{ entity, animName }` | Frame 0 of a freshly-played animation. |
| `animation:looped` | `{ entity, animName }` | Each time a `loop: true` animation rolls past its last frame back to 0. |
| `animation:completed` | `{ entity, animName }` | A `loop: false` animation reaches its last frame (and either transitions to `next` or pauses). |
| `animation:cancelled` | `{ entity, prevAnimName, newAnimName }` | A non-looping animation was interrupted by `api.anim.play(...)`. |

A1 ships only the `onComplete` callback path (internal map) — events
follow in A2 once `api.events` exists. Once events exist,
`onComplete` becomes a thin wrapper for back-compat.

### 8.3 No new component exposure on top of §6

`api.components.Animation` is the only new built-in addition.

---

## 9. Renderer changes

### 9.1 Per-vertex `a_uvOffset` + `a_uvScale`

The sprite VBO's per-vertex layout grows by 4 floats — two vec2s for
the atlas-region origin + size within the layer:

| Field | Before (post-materials M1) | After |
|---|---|---|
| `a_position` (vec2) | 0..7 | 0..7 |
| `a_uv` (vec2) | 8..15 | 8..15 (now in 0..1 of the **region**, not the layer) |
| `a_layer` (float) | 16..19 | 16..19 |
| `a_camY` (float) | 20..23 | 20..23 |
| `a_worldPos` (vec2) | 24..31 | 24..31 |
| `a_variant` (float) | 32..35 | 32..35 |
| `a_uvOffset` (vec2, **NEW**) | — | 36..43 |
| `a_uvScale` (vec2, **NEW**) | — | 44..51 |
| **Stride** | 36 bytes | 52 bytes |

Vertex shader maps the per-vertex `a_uv` (still the 4 quad corners,
in `[0,1]`) into the region:

```glsl
vec2 uvInLayer = a_uvOffset + a_uv * a_uvScale;
v_uv = uvInLayer;
```

(The fragment shader is unchanged — `texture(u_sprites, vec3(v_uv,
v_layer))` already reads from `v_uv` interpreted as 0..1 within the
layer. The region math collapses to a multiply-add in the VS.)

**Mirror via negative `a_uvScale.x`.** When the angle resolution
yields a mirrored cell (§3.3), the CPU writes `a_uvScale.x` as a
**negative** number. The VS's multiply-add naturally flips U. No
fragment-shader branch.

VBO size: `MAX_SPRITES_PER_FRAME * 6 * 13 floats * 4 bytes = 312 KB`
at the default 1024 sprites/frame (up from 216 KB). Negligible.

### 9.2 Alternative considered — atlas-grid uniform + per-vertex `a_frameIndex`

Approach: per-vertex `a_frameIndex` (int) + per-sprite
`u_atlasGrid (cols, rows)` uniform; the shader computes UV in-shader.

| | Per-vertex uvOffset + uvScale | atlas-grid uniform |
|---|---|---|
| Vertex bytes/sprite | +16 (4 floats × 6 verts) | +8 (1 int × 6 verts + uniform setup) |
| Shader complexity | One mul-add (cheap) | Modulo + divide per vertex |
| Per-sprite uniform sets | none | one per unique sheet — breaks single-batch |
| Mirror handling | flip sign of `a_uvScale.x` | extra per-vertex flag attribute |
| Flexibility | Region can be ANY rect — supports non-grid future, easy to extend per-frame nudges | Tied to grid math — non-grid frames impossible |
| Future shader hooks | UV region is already first-class; per-pixel hooks can read it directly | Would need to recompute region in every hook |

**Recommendation: per-vertex `a_uvOffset` + `a_uvScale`.** Trades 8
extra bytes/sprite for shader simplicity, per-frame flexibility, and
first-class region data the hooks can read. Single-batch model
preserved.

### 9.3 SpriteDrawRequest schema

```ts
export interface SpriteDrawRequest {
  // ...existing fields (x, y, imageId, worldHeight, yOffset, shaderVariant)...
  /**
   * Source-region origin in 0..1 layer coords. Default {x:0,y:0}.
   * SpriteRenderSystem populates this from animation + angle.
   */
  uvOffset?: { x: number; y: number };
  /**
   * Source-region size in 0..1 layer coords. Default {x:1,y:1}.
   * Negative x = horizontal mirror.
   */
  uvScale?: { x: number; y: number };
}
```

Defaults preserve the existing single-image path (full layer).

### 9.4 SpriteRenderSystem changes

```ts
world.each(Position, Sprite, (entity, position, sprite) => {
  const shaderData = Shader.get(entity);
  const shaderVariant = renderer.spriteVariantIdFor?.(shaderData) ?? 0;

  const animData = Animation.get(entity);
  const { uvOffset, uvScale } = resolveSpriteRegion(
    pack.manifest.sprites[sprite.imageId],
    animData,
    /* entity world pos */ position,
    /* entity facing */    Facing.get(entity) ?? 0,
    /* camera pos */       camPos,
  );

  this.requests.push({
    x: position.x, y: position.y,
    imageId: sprite.imageId,
    worldHeight: sprite.worldHeight,
    yOffset: sprite.yOffset,
    shaderVariant,
    uvOffset, uvScale,
  });
});
```

`resolveSpriteRegion` is a pure helper exported from
`packages/engine/src/Libs/SpriteAtlas.ts` (new module). It returns
`{uvOffset: {0,0}, uvScale: {1,1}}` for the no-animation,
single-image path — zero behavior change for unanimated sprites.

### 9.5 Canvas2D backend

`packages/engine/src/Renderers/TwoDRenderer.ts` reads the same
`SpriteDrawRequest` fields and slices the source `HTMLImageElement`
via `ctx.drawImage(img, sx, sy, sw, sh, dx, dy, dw, dh)`. For mirror
(negative `uvScale.x`), wrap the draw in
`ctx.save(); ctx.scale(-1, 1); ctx.drawImage(..., -dx-dw, dy, dw,
dh); ctx.restore()`. Same backward-compat — `uvOffset` undefined +
`uvScale` undefined = full-image draw.

### 9.6 Sprite-atlas upload

`WebGLRenderer.constructor` and `TwoDRenderer.preloadSprites` need
to upload the full sheet (not just the first frame). The existing
`uploadSpriteLayer(layer, image)` call already does that — it uploads
the whole `HTMLImageElement` to one `TEXTURE_2D_ARRAY` layer. The
change is only: clamp/letterbox the sheet to
`CONFIG.rendering.spriteAtlasSize` (default 1024×1024) instead of
the existing `SPRITE_LAYER_RESOLUTION` (256×256). A1 raises the
default; modders with smaller sheets pay zero extra GPU memory
(empty texels don't cost upload bandwidth).

---

## 10. Worked examples

### 10.1 Zombie enemy — 8-angle, 4 animations

**Sheet:** `zombie-sheet.png` at 1024×1024.
**Grid:** 8 cols × 16 rows of 128×128-px cells. Total animations
fit:

| Rows | Animation | Per-clip angles | Frames/anim |
|---|---|---|---|
| 0–7 | idle | 8 | 4 (frames 0..3 per row) |
| 8–15 | walk | 8 | 8 (frames 0..7 per row) |
| 16–23 | attack | 8 | 4 |
| 24 | die | 1 | 4 |

Total rows used: 25. Modder authors the sheet at 1024×1024 (cells
beyond row 24 are blank — the engine doesn't care).

**Manifest:** see §4.2. **Spawn helper** (pack-local — there is no
runtime prefab API; spawn via the bare ECS):

```js
function spawnZombie(api, x, y, facing) {
  const e = api.world.spawn();
  api.world.add(e, api.components.Position, new api.Vec2(x, y));
  api.world.add(e, api.components.Facing, facing ?? 0);
  api.world.add(e, api.components.Sprite, {
    imageId: "zombie", worldHeight: 1.0, yOffset: 0,
  });
  api.world.add(e, api.components.Animation, {
    current: "idle", frame: 0, elapsed: 0,
  });
  return e;
}
// <!-- historical: this block originally used `api.registerPrefab("zombie", ...)`;
//      runtime prefab API was removed 2026-05-17 (prefabs are editor-only authoring
//      assets now). Pack scripts spawn via the bare ECS. -->
```

**Behavior:** the AI system calls `api.anim.play(zombie, "walk")`
when the player enters detection range; `play("attack")` when in
melee. On the attack animation's `animation:completed` (subscribed
via `api.events` once A2 lands — `api.anim.onComplete` is explicitly
deferred to A2 per the comment in `packages/engine/src/ModAPI/types.ts`
lines 283-285), the mod emits a damage event. On HP zero, `play("die")`.
Because die's
`angles: 1` override, the corpse always renders the same row
regardless of camera position — appropriate, since a corpse on the
floor doesn't have a "front."

### 10.2 Ammo pickup — single image (backward-compat path)

```jsonc
"ammo_pack": { "image": "images/items/ammo_pack.png" }
```

No `frameWidth`/`animations`/`angles`. Entity gets a `Sprite`
component but **no `Animation`** component. Renderer sees
`uvOffset = (0,0)`, `uvScale = (1,1)`, draws the full layer.
Byte-identical to today.

### 10.3 Fireball projectile — 1-angle, spin animation

```jsonc
"fireball": {
  "image": "images/sprites/fireball.png",
  "frameWidth": 32, "frameHeight": 32, "cols": 4, "rows": 1,
  "angles": 1,
  "animations": {
    "spin": { "frames": [0,1,2,3], "frameDuration": 0.05, "loop": true }
  }
}
```

Spawn:
```js
api.world
  .add(e, api.components.Sprite, { imageId: "fireball", worldHeight: 0.4, yOffset: 0.3 })
  .add(e, api.components.Animation, { current: "spin", frame: 0, elapsed: 0 });
```

No `Facing` needed — `angles: 1` skips the angle math entirely. The
sprite renders the spin cycle the same from every camera angle. The
projectile's own velocity is independent of the sprite cycle.

### 10.4 Door — 1-angle, multi-clip with `next` transitions

Manifest (full def in §4.2). Behavior:

```js
// Door starts closed.
api.world.add(e, api.components.Animation, { current: "closed", frame: 0, elapsed: 0 });

// On player proximity:
api.anim.play(door, "opening");
// "opening" has next: "open" → AnimationSystem auto-transitions.
// Door stays in "open" (looping) until something calls play("closing").
```

Single row in the atlas (8 cols × 1 row). `angles: 1`. The door's
"facing" doesn't matter for the sprite (it always renders straight
on) — but in the world, the door's collision still uses the entity's
Facing.

### 10.5 NPC — 4-angle walk + 1-angle idle (mixed angles)

Manifest:

```jsonc
"merchant": {
  "image": "images/sprites/merchant.png",
  "frameWidth": 64, "frameHeight": 96,
  "cols": 4, "rows": 5,
  "angles": 4,
  "mirror": false,
  "animations": {
    "idle": { "frames": [0],          "frameDuration": 1.0, "loop": true, "angles": 1 },
    "walk": { "frames": [0,1,2,3],    "frameDuration": 0.15, "loop": true }
  }
}
```

Atlas layout:

| Row | Content |
|---|---|
| 0 | idle, angle 0 (only — `angles: 1`) |
| 1 | walk, angle 0 |
| 2 | walk, angle 1 |
| 3 | walk, angle 2 |
| 4 | walk, angle 3 |

The idle state is one frame total — modder didn't author 4 directional
idle poses because the merchant just stands there. As soon as the
merchant walks (e.g. on a patrol), the 4-angle walk kicks in and
the camera sees the right side of him as he passes by.

This is a common authoring pattern — full angle coverage for the
common dynamic state, single angle for the long-tail still states.

### 10.6 Bonus: chained transitions (`next` chain)

```jsonc
"reload":   { "frames": [...], "frameDuration": 0.1, "loop": false, "next": "idle_after_reload" },
"idle_after_reload": { "frames": [0], "frameDuration": 0.5, "loop": false, "next": "idle" },
"idle":     { "frames": [0,1,2,1], "frameDuration": 0.2, "loop": true }
```

`reload` → `idle_after_reload` (a 0.5s pause on the bare-handed
pose) → `idle`. Each transition fires
`animation:completed` for the source clip and
`animation:started` for the destination.

---

## 11. Backward compat

### Invariants

| Existing case | Post-A1 behavior |
|---|---|
| Sprite manifest entry with only `image` | Renders full layer (uvOffset=0, uvScale=1). Identical to today. |
| Entity with `Sprite` but no `Animation` | Renders frame 0 of first animation if sheet defines animations; otherwise full layer. |
| Entity with `Facing` but `angles=1` sprite | Angle math skipped; renders the single angle. |
| `Animation` component without matching sprite animations dict | Logs once; renders frame 0 of angle 0. |
| Canvas2D renderer | Reads `uvOffset/uvScale`; defaults to full image when undefined. |
| Materials-plan shaders (variant 0 ghost, etc.) | Composes — animation drives UV region, shader still runs per-pixel. No conflict. |
| Default pack | `ammo_pack` stays unchanged. A1 ships ONE example animated sprite (door or 4-angle NPC) opt-in via a manifest flag (mirrors `_materialsSmokeTest_doc` pattern in `manifest.json`). |

### Zero-cost when unused

A scene with no `Animation` components incurs zero AnimationSystem
work beyond the `world.each` query (which is empty). The renderer
still writes `uvOffset/uvScale` per vertex but the values are
constant `(0,0)+(1,1)` — VBO size grows unconditionally, but per-
frame fill cost is identical to today's hot path.

---

## 12. Editor authoring UX (brief — cross-ref EDITOR.md)

A3 surfaces the animation system in `apps/editor`. Not in A1's
scope; capture the requirements here so EDITOR.md can absorb them.

### Asset import flow

- Drop a PNG onto the editor's sprite library → prompt:
  - "Single image" vs. "Sprite sheet"
  - If sheet: `frameWidth`, `frameHeight`, `cols`, `rows` (auto-
    detect via common power-of-2 dimensions when possible)
  - `angles` (1/2/4/5/8/16) — radio buttons with a tooltip showing
    the angle-id layout from §3.1
  - `mirror` checkbox (disabled + forced-true when angles=5)

### Animation editor panel

- List of named animations on the selected sprite. "+ New
  Animation" prompts for name.
- For each animation:
  - Frame picker: a strip of the sheet's cells in row order with
    click-to-toggle to build the `frames[]` array. Drag-to-reorder.
  - `frameDuration` numeric input (with a "frames per second"
    helper).
  - `loop`, `next` (dropdown of sibling animations), `angles`
    (override).
- Timeline scrub: play the animation in the inspector at 1× / 0.5× /
  paused with a frame-step slider.

### Per-angle preview

- Cycle through all `angles` values (← / → arrow keys) with the
  current animation playing. Lets the author verify the atlas
  layout matches the angle convention (catches "I authored my
  rows in the wrong order" before the engine shows it).

### Live preview in the scene

- An entity placed in the editor's live-mode viewport plays its
  default animation. Camera orbit (right-click drag) verifies the
  multi-angle resolution.

### Out of scope for A3

- Per-frame collider edits.
- Onion-skin overlays between frames.
- Importing aseprite/spritestack metadata. A future EDITOR addition
  can read `.aseprite`/`.json` sidecars and pre-populate the
  manifest fields.

---

## 13. Phases

| Phase | Scope | Where it lives | State |
|---|---|---|---|
| **A1** | **Core animation + multi-angle + backward compat.** New manifest fields (`frameWidth`, `cols`, `angles`, `animations`, …). New `Animation` ECS component. New `AnimationSystem` (engine). New `api.anim` ModAPI surface — `play(entity, animName)` / `stop` / `resume` / `isPlaying` (no `onComplete` in A1 — explicitly deferred to A2 per `types.ts:283-285`). Renderer per-vertex `a_uvOffset`/`a_uvScale`. Angle-selection algorithm in `Libs/SpriteAtlas.ts` (snap only). Sprite atlas layer dimensions raised to 1024×1024 (config). Default-pack ships ONE example animated sprite (recommend a 4-angle merchant or a 1-angle door) gated by a `_animationsSmokeTest` manifest flag. Canvas2D backend honors UV region (sliced `drawImage`). | engine/src/Components/Animation.ts, engine/src/Systems/AnimationSystem.ts, engine/src/Libs/SpriteAtlas.ts, engine/src/AssetPack/types.ts, engine/src/Renderers/{WebGLRenderer,TwoDRenderer,SceneRenderer}.ts, engine/src/ModAPI/{types,...}, default-pack/manifest.json, default-pack/images/sprites/* | ✅ Shipped (commit `ab9dbee`). |
| **A2** | **Mirror + 5-angle + crossfade + events.** `mirror: true` support (atlas halving + per-vertex flip-sign on uvScale.x). 5-angle layout (implicit mirror). `interpolation: "crossfade"` (renders two cells with alpha mix). Uses `api.events` (Ev1 shipped) for `animation:started`/`completed`/`looped`/`cancelled`. `api.anim.onComplete` becomes a thin wrapper. | engine/src/Libs/SpriteAtlas.ts (mirror + 5-angle remap), AnimationSystem (event emission), api.events integration | Designed. Ready to start — `api.events` (Ev1) shipped (commit `52d8e27`). |
| **A3** | **Editor authoring UX.** Spritesheet importer, frame-picker, animation timeline scrubber, per-angle preview. Live-mode editor renders the sprite with animations playing. Updates EDITOR.md with an "Animations panel" section. | apps/editor/src/panels/Animation*, apps/editor/src/import/Spritesheet*, EDITOR.md edits | Designed. Depends on EDITOR baseline (E1–E3). |
| **A4** | **Hierarchical / blended animations.** Upper-body + lower-body clip composition (sprite ships pre-composed atlases — engine plays two `Animation` components on one entity, renderer composites via additional sprite quads). Speculative — defer until a real game needs it. | engine/src/Components/Animation.ts (multi-slot), AnimationSystem (multi-slot iteration), renderer (multi-quad emission) | Speculative. Not started. |

### Default-pack smoke-test convention

Following the `_materialsSmokeTest_doc` / `shaders_example` pattern
in `default-pack/manifest.json`, A1's example sprite ships under a
`_animationsSmokeTest_doc` field with documentation on how to flip
the flag and rebuild the pack. Disabled by default — without the
flag the default pack renders byte-identically to pre-A1.

---

## 14. Open questions

1. **Atlas layout convention — frames-by-col, angles-by-row, animations stacked vertically (§5).** This plan settles on it; called out here so an implementer doesn't second-guess. Alternative was angles-by-col and frames-by-row, rejected because animations typically have more frames than the typical angle count (8) and rows are cheap to add while cols affect every animation's max length.
2. **Per-animation `angles` override + atlas bounds.** A pack ships `angles: 8` at the sprite level and `angles: 1` on the die animation. The pack-builder's row-count validator needs the rule from §5: `rows ≥ sum(animations[i].effectiveAngles)`. Engine runtime accepts whatever the pack ships; pack-builder enforces. Open: do we require a stable animation order, or does the engine reorder for tighter packing? **Recommendation: stable insertion order** (JSON map iteration), because the editor's atlas exporter (A3) needs determinism.
3. **HMR for manifest sprite edits.** Editing `frameDuration` in `manifest.json` mid-session currently requires a full page reload (pack scripts cache the parsed manifest). A future agent should add a manifest-only HMR path that re-parses the sprite section without re-uploading the texture array. Defer.
4. **MAX_FRAMES_PER_ANIMATION cap.** Practical: the renderer treats `frames` as an arbitrary `number[]` — no cap. The pack-builder might warn at 64+ for diagnostic value. Leave uncapped for now.
5. **Sprite layer dimensions.** §5.4 picks letterbox-to-max (1024×1024 default). If memory pressure shows up, switch to bucketed `TEXTURE_2D_ARRAY` per sheet size — implementation-level decision, doesn't change manifest or runtime API.
6. **`api.events` dependency for A2.** ✅ Resolved — `api.events` shipped as part of Ev1 (commit `52d8e27`), independent of MULTIPLAYER M1. A1 currently uses the internal-map fallback for `onComplete`; A2 can switch to the canonical `animation:*` events whenever it lands.
7. **Animation networking (multiplayer).** Replicating animation state needs care — the canonical scheme is to replicate `(current, elapsed, paused)` rather than `frame` (which the receiver derives from `elapsed`). Cross-ref MULTIPLAYER_PLAN; defer to the multiplayer plan to spec.
8. **Crossfade for mirror cells.** When `mirror: true` and the player is at the seam between a mirrored and non-mirrored cell (e.g. angle 4↔5), crossfade between a not-flipped and a flipped texture produces a visible double-edge. A2 should either disable crossfade across the mirror boundary or document the artifact. Recommend: disable across mirror boundary (snap there).
9. **Pixel-art vs. smooth — interpolation default per sprite type.** Today's default is `snap`. We could detect "pixel art" via small `frameWidth` (< 64?) and warn if `crossfade` is selected. Defer to A2.
10. **Frame-level events (`onFrame`).** A modder wants to fire a footstep sound on frame 2 of a walk animation. Not in A1 — workaround: subscribe to `animation:looped` and time the sound. A clean `onFrame` event with `{ entity, animName, frame }` is a candidate A2 extension once `api.events` ships.

---

## 15. Implementation summary (A1)

Files touched / added:

- `packages/engine/src/Components/Animation.ts` — **NEW.**
  `AnimationData` interface + `Animation` component singleton.
- `packages/engine/src/Components/index.ts` — re-export.
- `packages/engine/src/Systems/AnimationSystem.ts` — **NEW.** Per-
  frame advance loop, `next` transitions, edge-case handling.
- `packages/engine/src/Systems/SpriteRenderSystem.ts` — read
  `Animation` + `Facing`; populate `uvOffset` / `uvScale`.
- `packages/engine/src/Libs/SpriteAtlas.ts` — **NEW.** Pure helpers:
  `resolveSpriteRegion(spriteDef, animData, entityPos, entityFacing,
  camPos) → {uvOffset, uvScale}`; `angleIndexFor(angleCount,
  entityPos, entityFacing, camPos) → number`. Unit-tested with the
  worked examples from §3.2.
- `packages/engine/src/AssetPack/types.ts` — extend `SpriteDef` per
  §4.1; new `AnimationDef`.
- `packages/engine/src/AssetPack/ZipAssetPack.ts` — pass animation
  fields through without modification (currently only synthesizes
  `image` from filename-suffix variants; new fields require neither
  inference nor mutation).
- `packages/engine/src/Renderers/SceneRenderer.ts` — extend
  `SpriteDrawRequest` with `uvOffset` / `uvScale`.
- `packages/engine/src/Renderers/WebGLRenderer.ts` — vertex layout
  +4 floats (`a_uvOffset`, `a_uvScale`); VS multiply-add; raise
  `SPRITE_LAYER_RESOLUTION` (or split into a config-driven constant
  read from `CONFIG.rendering.spriteAtlasSize`); upload sheet at
  native resolution within the new max.
- `packages/engine/src/Renderers/TwoDRenderer.ts` — honor
  `uvOffset`/`uvScale` via `drawImage` source-rect slicing; mirror
  via `ctx.scale(-1, 1)` when `uvScale.x < 0`.
- `packages/engine/src/ModAPI/types.ts` — `Animation` in
  `BuiltInComponents`; `AnimAPI` interface; `anim` field on
  `ModAPI`.
- `packages/engine/src/ModAPI/ComponentRegistry.ts` — register
  `Animation` in `builtIns`.
- `packages/engine/src/ModAPI/ModAPIImpl.ts` (or wherever the api
  factory lives) — wire `api.anim` to the AnimationSystem's
  control methods.
- `packages/engine/src/Game.ts` — register `AnimationSystem` in the
  update phase order.
- `packages/engine/src/GameConfig.ts` — add
  `rendering.spriteAtlasSize` (default 1024).
- `packages/default-pack/manifest.json` — `_animationsSmokeTest_doc`
  + example sprite (door OR 4-angle merchant).
- `packages/default-pack/images/sprites/<smoke-test>.png` — the
  example sheet.
- `packages/default-pack/scripts/hello.js` — opt-in spawn of the
  smoke-test entity when the flag is on.
- `apps/pack-builder/src/build-packs.ts` — validation pass: every
  sprite with `animations` has a complete grid spec; every animation
  `frames[i] < cols`; `angles ∈ {1,2,4,5,8,16}`; `mirror: false`
  with `angles: 5` is a build error; row-count fits the declared
  animations × per-clip angles. Warnings (not errors) where feasible.

No removals. No ModAPI breakage. Canvas2D backend remains feature-
matched with WebGL2 for the animation path.

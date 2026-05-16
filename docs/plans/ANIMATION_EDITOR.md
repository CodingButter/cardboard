# Animation editor — in-browser FBX-to-spritesheet authoring

A plan for the **animation-authoring surface** inside `apps/editor`.
This is the editor companion to [ANIMATIONS.md](./ANIMATIONS.md)'s
engine-side animation system. The killer feature: **drop an FBX in,
get a Doom-style 2D spritesheet out**, with the user picking angle
count + frames + cell size + forward direction. Source assets stay
re-editable; the output is canonical, manifest-conformant, and
shipped inside the user's `.apg`.

Source-of-truth for implementation. Phases AE1–AE3 below. Cross-refs:
[ANIMATIONS.md](./ANIMATIONS.md) (engine consumer — defines the
atlas layout, manifest schema, and angle convention this editor
must emit unmodified),
[EDITOR.md](./EDITOR.md) (editor shell, workflow modes, IDB-backed
project store, asset sidebar — animation editing slots in as a new
workflow mode),
[MATERIALS.md](./MATERIALS.md) (precedent for editor-side baking
that touches engine asset formats),
[PACK_CHAIN.md](./PACK_CHAIN.md) (source assets vs shipped assets —
the FBX itself is dev-only, the rendered sheet ships).

Last revised: 2026-05-16.

---

## 1. Goals & non-goals

### Goals

- **In-browser asset authoring, no offline tooling.** A modder can
  drop an FBX or a hand-painted spritesheet onto the editor and walk
  out with an engine-consumable sprite asset. No Blender, no
  TexturePacker, no command-line. The whole pipeline runs in the
  browser tab the editor already lives in.
- **Two input paths, one output format.** Either bring your own
  pixels (spritesheet PNG or a folder of loose-frame PNGs) **or**
  auto-render from a 3D source (FBX → spritesheet). Both terminate
  in the same canonical multi-angle multi-animation grid that
  [ANIMATIONS.md § 5](./ANIMATIONS.md) defines.
- **Canonical output owned by the editor.** The editor is the single
  source of truth for spritesheet layout. The author never has to
  hand-pack a grid, count rows, or compute UV offsets. The output PNG
  is engine-consumable unmodified — same byte layout as if the author
  hand-authored a sheet in Aseprite + filled in `manifest.sprites.X`
  themselves.
- **Source assets stay editable.** The source FBX (or imported sheet)
  is persisted alongside the project in IDB. Re-baking with different
  angle counts / cell sizes / forward directions is one click. The
  user never re-uploads the source.
- **Manifest round-trip.** Clicking an existing sprite in the asset
  sidebar opens it for re-editing with all configuration restored.
  The editor reads `manifest.sprites.X` + the parallel `spriteSources`
  IDB store, regenerates exactly, and writes back.
- **First-class with the rest of editor authoring.** Lives as a
  proper workflow mode (alongside Map / Entities / Scripts / Assets
  per [EDITOR.md § 5.1](./EDITOR.md)), not as a one-off modal hidden
  behind an asset's context menu.
- **Three.js is a lazy-loaded dependency.** Animation mode is the
  only place that needs Three.js. Lazy-load on mode entry so the
  editor's cold start doesn't pay ~600 KB for users who never bake a
  sprite.

### Non-goals

- **Real-time 3D in the engine.** The engine is a raycaster. Three.js
  exists in the editor solely as an offline bake source. Built assets
  are 2D billboarded sprites at runtime, same as today.
- **Authoring bones / animations inside an FBX.** We consume FBX
  clips; we don't edit them. If the FBX has bad animation, the modder
  re-exports from their DCC tool. The editor never writes back to the
  FBX.
- **Vector / SVG / procedural sources.** The output is a raster PNG
  on a pixel grid. No SVG path tessellation, no procedural shape
  baking. Bring pixels in or bring a 3D mesh in.
- **Animation blending preview.** The engine doesn't blend
  ([ANIMATIONS.md § 1 non-goal](./ANIMATIONS.md)). The editor doesn't
  preview blending. Each animation is captured and previewed
  independently.
- **GIF / video export.** Output is a single PNG spritesheet matching
  the engine atlas convention. A GIF preview for sharing is a polish
  item (AE3); it is **not** an alternative output target.
- **Editing inside the .apg after export.** The editor is the
  authoring surface — exported `.apg`s are read-only from the
  editor's perspective. Re-editing means re-opening the IDB project
  the export came from.
- **Skeleton / bone authoring on top of sprites.** The engine plays
  2D flipbooks. There is no skeletal layer to surface in the editor.
- **Auto-trim transparent margins on capture.** The cell-size config
  is what it is; tight-trimming the rendered frame to its visible
  pixels would invalidate the engine's fixed-grid atlas math. If the
  author wants tighter cells, they bake at a smaller cell size.

---

## 2. Status quo

As of 2026-05-16:

- **Engine** (per [ANIMATIONS.md](./ANIMATIONS.md)): the engine-side
  animation system is **not yet implemented**. Phase A1 is the next
  engine deliverable; this editor plan describes the authoring tool
  for the same system.
- **Editor** (per [EDITOR.md](./EDITOR.md)): scaffold landed; phases
  E1 (home + IDB) and E2 (live engine in viewport) are designed. The
  animation editor is **a new workflow mode** in that shell — it
  doesn't exist yet.
- **Spritesheet authoring today**: ad-hoc. The default pack has
  `packages/default-pack/character/player_idle.fbx` (24 MB) that no
  tool currently consumes. Modders authoring a sprite have to hand-
  pack a sheet in a desktop tool, name the file, drop it into the
  pack at the right path, and edit `manifest.sprites` JSON to wire it
  up. No live preview of UV regions, no validation that the grid
  math actually matches what the engine will read.

Net: there is currently no in-browser path from "I have a 3D model"
or even "I have a folder of frames" to "I have a sprite my engine can
play." Pack-builder authors do all of it offline, by hand. This plan
fixes that.

---

## 3. Two input paths

The editor offers two distinct entry workflows, picked at sprite-
creation time. Both terminate in the same canonical spritesheet +
manifest entry.

### 3.1 Path A — bring-your-own

The author has pixels already.

#### A.1 Spritesheet PNG

```
Author drops zombie.png onto the editor
  → editor opens "New sprite from spritesheet" panel
  → user inputs: cols, rows, cell size, angles, mirror, animations
  → editor renders a preview grid over the imported image showing
    cell boundaries + the angle-id + animation labels per cell
  → user clicks cells to assign them to (animation, frame, angle)
    triples, OR if the input already conforms to the canonical
    layout, hits "Auto-detect" and the editor populates it from the
    grid dimensions
  → "Bake" regenerates a canonical-format PNG (might be byte-identical
    to the input if it already conforms — that's the point) plus
    writes the manifest entry
```

The "regenerate to canonical" step is what makes this Path A and not
just "import sheet verbatim." Even if the input already matches the
engine's layout, we round-trip through the editor's compositor so:
- The output cell dimensions are guaranteed to match what the manifest
  declares.
- Padding is consistently 0 (or whatever the user picks).
- The sheet's PNG metadata is normalized.
- Any cell the user explicitly **left blank** (e.g., "this monster has
  no FL angle, mirror it") is filled in correctly per the mirror
  semantics from [ANIMATIONS.md § 3.3](./ANIMATIONS.md).

#### A.2 Loose frames

```
Author drops a folder/zip of 64 PNG files
  → editor sorts by filename (lexical) and shows them as a strip
  → user drags frames into a grid layout panel: each cell = one PNG
  → user assigns each row to (angle, animation) and each column to
    frame index — same UI as A.1 but the source pool is a stack of
    distinct images rather than cells inside one image
  → editor composites them into a single sheet at the chosen cell
    size + grid dimensions
  → manifest written, source frame-set persisted to IDB
```

Loose-frame stitching is what Aseprite users get today as "export
animation as sheet" — except in our case it runs in the browser, the
output matches our engine layout exactly, and the source frames stay
re-editable.

### 3.2 Path B — FBX auto-render (the killer feature)

The author has a 3D mesh + animation clips.

```
Author drops player_idle.fbx onto the editor
  → editor loads via three.js FBXLoader, displays mesh in a viewport
  → user configures:
      - angle count (1/2/4/5/8/16)
      - frames per animation (one number per clip in the FBX,
        defaulting to a "sensible" sample count e.g. 8)
      - output cell size in pixels (default 64)
      - forward-direction vector (default +Z; gizmo in the viewport
        for click-pick)
      - camera elevation angle (default 8°, range -45°..+45°)
      - per-clip "include? rename to?" mapping
  → user hits "Bake"
  → for each animation, for each angle, for each frame:
      - position camera at the angle's vector around the model
      - step the AnimationMixer to the frame's time
      - render to an offscreen render target at the chosen cell size
      - composite into the spritesheet
  → output PNG + manifest entry + spriteSources record written to IDB
```

This is the path that turns a 24 MB FBX into a 256 KB
engine-consumable sprite asset in roughly three seconds.

### 3.3 Picking the path

When the author clicks "+ New sprite" in the asset sidebar, the
editor shows a three-card chooser:

```
+--------------------+  +--------------------+  +--------------------+
|  📄 Spritesheet    |  |  🗂️ Loose frames   |  |  🎲 3D model (FBX)  |
|                    |  |                    |  |                    |
|  Already have a    |  |  Folder of PNG     |  |  Auto-render from  |
|  packed sheet?     |  |  files? We stitch  |  |  an animated rig.  |
|  Import + tag.     |  |  them.             |  |  Pick angles +     |
|                    |  |                    |  |  frame count.      |
+--------------------+  +--------------------+  +--------------------+
```

Paths A.1, A.2, B respectively. The chooser also offers a "Re-open
existing sprite" shortcut that lists every sprite in the project's
manifest with a thumbnail + "Re-bake" button. Re-baking opens the
appropriate path (A.1/A.2/B) with all prior configuration restored
from the `spriteSources` IDB store.

---

## 4. Canonical output format

The editor's output must match [ANIMATIONS.md § 5](./ANIMATIONS.md)
**exactly**. Repeating the spec here so this doc is the editor's
authoritative reference; if these two docs ever drift, ANIMATIONS.md
wins.

### 4.1 Atlas layout (per ANIMATIONS.md § 5.1)

- **Columns = frames within an animation.** Cell `(c, r)` is frame
  `c` of whatever animation owns row `r`.
- **Rows = (angle, animation) pairs, angles-first.** The first
  `effectiveAngles` rows hold animation 0's per-angle strips; the
  next `effectiveAngles` rows hold animation 1's strips; etc.

A canonical sheet for `angles: 8` + three animations at `cols: 8`:

```
            col 0  col 1  ...  col 7
row  0  idle    angle 0 (front)
row  1  idle    angle 1 (FR)
row  2  idle    angle 2 (right)
row  3  idle    angle 3 (BR)
row  4  idle    angle 4 (back)
row  5  idle    angle 5 (BL)
row  6  idle    angle 6 (left)
row  7  idle    angle 7 (FL)
row  8  walk    angle 0
...
row 15  walk    angle 7
row 16  attack  angle 0
...
```

Per-clip `angles` overrides (an attack animation that collapses to
`angles: 1`) shrink that animation's row block to 1 row, not 8. The
editor implements
`rowBase[a] = sum(animations[0..a-1].effectiveAngles)` exactly as the
engine reads it.

### 4.2 Cell dimensions

| Field | Value | Notes |
|---|---|---|
| **Cell size** | Power-of-2 preferred. Default 64. UI offers 32 / 64 / 128 / 256. | Engine atlas tops out at `CONFIG.rendering.spriteAtlasSize` = 1024 (per [ANIMATIONS.md § 5.4](./ANIMATIONS.md)) — so an 8-angle × 16-frame × 4-animation sheet at 64 px cells is `8×16=128` cells wide max — no, that wraps as `cols=16, rows=8×4=32`, giving `1024×2048` — over the 1024 ceiling. Editor warns the author when the projected sheet dimensions exceed the atlas ceiling and suggests dropping cell size, angles, or frames. |
| **Color depth** | RGBA8 with premultiplied alpha | Matches what `WebGLRenderer` uploads to `TEXTURE_2D_ARRAY`. The PNG encoder produces straight alpha; the editor pre-multiplies during composite so what ships in the `.apg` matches what the engine reads with one less GPU-side multiply. Document this trade. |
| **Background** | Fully transparent (RGBA `0,0,0,0`) | Padding cells (e.g., a 4-frame idle in an 8-col sheet that supports up to 8-frame walk) stay transparent. Renderer's UV math points at them only if the manifest mis-declares `frames` — fail-safe, no garbage colors. |
| **Padding between cells** | Configurable. Default 0. | Engine math expects tight grid. Non-zero padding (typical 1-2 px) prevents bilinear-filter bleed in WebGL when MIN/MAG filters are LINEAR. We default to 0 because the engine uses NEAREST for sprite sampling, so bleed isn't a risk. Document that crossfade interpolation (ANIMATIONS A2) flips this — when the engine adds crossfade, padding becomes recommended. |
| **Offset (border around the grid)** | Default 0. Available in UI. | Symmetric with padding. Mostly useful for visual diagnostics — a 4-px transparent border lets the user see the sheet's actual bounds against a checkered editor background. Documented but rarely needed. |

The editor writes `frameWidth` / `frameHeight` / `cols` / `rows` /
`padding` / `offset` into the manifest exactly as
[ANIMATIONS.md § 4.1](./ANIMATIONS.md) specifies.

### 4.3 Sprite filename convention

Output spritesheets land at:

```
images/sprites/<sprite-id>-sheet.png
```

The `-sheet` suffix distinguishes auto-baked spritesheets from single-
image sprites (which keep today's `images/items/<id>.png` style
naming). The asset sidebar groups sheets together; the suffix is also
a hint to a curious modder cracking open an `.apg` zip.

`sprite-id` is a slug derived from a user-supplied display name (e.g.
"Frost Zombie" → `frost_zombie`). The slug is the manifest key
(`manifest.sprites.frost_zombie`) and the filename stem.

### 4.4 Mirror-aware output

When the user enables `mirror: true` (or picks `angles: 5` which
implies it per [ANIMATIONS.md § 3.4](./ANIMATIONS.md)), the editor:

- For Path A: only **bakes** the un-flipped rows. Left-side cells are
  generated by the engine at draw time via negative `a_uvScale.x`.
  The output sheet has half (or 5/8ths) as many rows as the un-
  mirrored equivalent.
- For Path B: only **renders** the un-flipped angles. Path B skips
  capturing cameras for the mirrored half — saving render time
  proportionally.

The editor exposes mirror as a checkbox in the configuration panel
with an inline diagram showing which rows ship vs which are derived.
Picking `angles: 5` greys the checkbox to "forced on" with a note.

---

## 5. UX surfacing — mode, not modal

### 5.1 Decision: top-level workflow mode

The animation editor lives as a **fifth workflow mode** in the
editor's top tab bar, alongside Map / Entities / Scripts / Assets
([EDITOR.md § 5.1](./EDITOR.md)).

```
+-- [ 🗺️ Map ] [ 🎯 Entities ] [ 📜 Scripts ] [ 🎨 Assets ] [ 🎬 Animation ] --+
```

Rationale:
- **Authoring an FBX-derived sprite is a focused workflow.** It owns
  the whole viewport (3D model preview) and the whole inspector
  (angle / frame / cell config). A modal dialog can't show a usable
  3D viewport without consuming most of the screen anyway.
- **Multiple iterations per sprite.** Authors tweak forward-direction,
  re-bake, scrub the result, tweak elevation, re-bake. A mode
  encourages staying in the surface; a modal encourages "commit and
  leave."
- **Discoverable.** A tab in the top bar is more obvious than "right-
  click an asset → New sprite → … → animation editor opens."
- **Cleanly separable.** Three.js + FBXLoader lazy-load only when
  Animation mode is first entered. The other four modes never pull
  in 3D dependencies.

The "quick re-bake" workflow (user changed nothing but wants to
re-render at a different cell size) still works **without** entering
Animation mode: right-click a sprite in the asset sidebar → "Re-bake
at..." → modal with cell size / angle count selectors → bakes in
place, no mode switch. This is the modal escape hatch for cases where
the user already knows the answer.

### 5.2 Mode layout

Animation mode hijacks the standard 3-column shell but redefines each
column's contents:

```
+-- [...modes...] [ 🎬 Animation ] -----------------------------------+
|                                                                     |
| Sprite library | Viewport                       | Configuration     |
|                |                                 |                   |
| [+ New]        | (Path B selected)               | Output           |
|                | +-----------------------------+ |   Name: zombie    |
| ● zombie       | |                             | |   Cell size: 64▾ |
| ○ merchant     | |   <three.js canvas>         | |   Angles: 8 ▾    |
| ○ door         | |   - orbit controls          | |   Mirror: [x]    |
|                | |   - model preview           | |                   |
|                | |   - forward dir gizmo       | | Source            |
| Re-open recent | |                             | |   .fbx (24 MB)    |
|                | +-----------------------------+ |   [Replace…]      |
|                |                                 |                   |
|                | Cell-grid preview              | Animations         |
|                | +-----------------------------+ |   [x] Idle (24f)  |
|                | |  [front][FR][R][BR][...]    | |       → 8 frames  |
|                | |  scrub: ●─────────────      | |   [x] Walk (32f)  |
|                | +-----------------------------+ |       → 8 frames  |
|                |                                 |   [ ] T-pose      |
|                | [▶ Play] [⚡ Bake (3.2 s est.)]  |                   |
+----------------+---------------------------------+-------------------+
| Status: sprite "zombie" — last bake 12s ago — 16 angles × 8 frames    |
+-----------------------------------------------------------------------+
```

### 5.3 Sprite library (left column)

- Lists every sprite in the active project's `manifest.sprites`
  (filtered to those with `animations` defined — single-image sprites
  show up under Assets mode instead).
- Click a sprite → loads it for re-editing.
- "+ New sprite" → path chooser (§3.3).
- "Re-open recent" → last 5 edited sprites for quick alt-tab.

### 5.4 Viewport (center column)

Per-path content:

- **Path A.1 (sheet)**: viewport shows the imported sheet with the
  proposed cell grid overlaid as a green wireframe. Click a cell to
  set its (animation, angle, frame) assignment. Hover shows the cell's
  current binding.
- **Path A.2 (loose frames)**: viewport is split top/bottom. Top: a
  scrollable strip of imported frame PNGs. Bottom: the target sheet
  layout with empty cells; drag frames from top to bottom.
- **Path B (FBX)**: viewport is a Three.js canvas. Orbit controls
  (left-drag = rotate, right-drag = pan, scroll = zoom). The forward-
  direction gizmo is a yellow arrow attached to the model's origin
  that the user can drag to align with the model's intuitive "front."
  Below the 3D viewport, a cell-grid preview shows what the most
  recent bake produced. Scrubbing a slider plays through frames; a
  drop-down picks which angle row is shown.

All three sub-paths share the **cell-grid preview** strip below the
primary viewport. Scrubbing through (angle, animation, frame) shows
the user exactly what cell the renderer will sample at runtime. This
is the visual contract: "if it looks right here, it'll look right in
the engine."

### 5.5 Configuration panel (right column)

A scrollable form, mode-specific:

- **Path A.1** form fields: cols, rows, cell size, angles, mirror,
  animations (list with [+ Add] / [Remove] per row), per-animation
  frame count + frame-duration + loop + next.
- **Path A.2** form fields: same as A.1 minus the source dimensions
  (those come from the imported frame count).
- **Path B** form fields: angles, frames-per-animation (per FBX clip),
  cell size, forward-direction (3-vector input + viewport gizmo
  binding), camera elevation, mirror, per-animation
  loop/next/duration.

A **"Bake (≈ Xs)"** button at the bottom estimates runtime based on
(angles × frames × animations × renderCost) and runs the pipeline in
a Web Worker for Path B (Path A is cheap enough to stay on main
thread). Progress bar overlays the viewport during bake. On completion,
the cell-grid preview repopulates and a toast confirms the manifest
update.

### 5.6 Status strip

Same global strip as the rest of the editor. In Animation mode it
shows: current sprite id, last-bake age, total cells (rows × cols),
total disk size of the output PNG.

---

## 6. FBX pipeline (Path B in detail)

This is the killer-feature pipeline. Concretely, in-browser, with
existing libraries.

### 6.1 Loading

Three.js `FBXLoader` is dynamic-imported when Animation mode loads:

```ts
const { FBXLoader } = await import("three/examples/jsm/loaders/FBXLoader.js");
const loader = new FBXLoader();
const arrayBuffer = await idb.read(`_source/${spriteId}.fbx`);
const blobUrl = URL.createObjectURL(new Blob([arrayBuffer]));
const fbx = await loader.loadAsync(blobUrl);
URL.revokeObjectURL(blobUrl);
```

`fbx` is a `THREE.Group` containing:
- `fbx.children` — the meshes / skeletons.
- `fbx.animations` — a `THREE.AnimationClip[]` of every animation
  baked into the FBX.

For `packages/default-pack/character/player_idle.fbx` (the 24 MB
concrete first-test case): expect 1-2 clips, a single rigged mesh, a
few materials. The editor surfaces each clip in the configuration
panel as a checkbox + rename + frames-to-sample input.

### 6.2 Scene setup

The bake scene is set up once per Animation-mode session:

```ts
const scene = new THREE.Scene();
scene.add(fbx);

const ambient = new THREE.AmbientLight(0xffffff, 0.6);
scene.add(ambient);

const key = new THREE.DirectionalLight(0xffffff, 0.8);
key.position.set(3, 5, 5);  // upper-right, classic 3/4 lighting
scene.add(key);

const camera = new THREE.OrthographicCamera(
  -frustumSize / 2, frustumSize / 2,
   frustumSize / 2, -frustumSize / 2,
   0.1, 100
);
camera.position.set(0, 0, 5);
camera.lookAt(0, 0, 0);

const renderTarget = new THREE.WebGLRenderTarget(cellSize, cellSize, {
  format: THREE.RGBAFormat,
  type: THREE.UnsignedByteType,
  generateMipmaps: false,
});

const renderer = new THREE.WebGLRenderer({
  alpha: true,
  preserveDrawingBuffer: true,
  antialias: false,  // pixel-grid output, no MSAA
});
```

Orthographic projection matches the raycaster's flat-projected feel
([ANIMATIONS.md § 3](./ANIMATIONS.md) sprite math is parallel-view
anyway). MSAA is off because the engine's atlas uses NEAREST sampling
and antialiased silhouettes would alpha-bleed against the transparent
background.

The directional + ambient combination produces a classic 3/4 lit look
without the photo-realistic GI of a PBR scene. AE3's "flat shading"
toggle replaces this with `MeshBasicMaterial` overrides for a true
flat retro look; the default is the lit setup above.

### 6.3 The render loop

The bake is a nested triple-loop:

```ts
for (const clipConfig of enabledClips) {
  const clip = fbx.animations.find((c) => c.name === clipConfig.fbxName);
  const mixer = new THREE.AnimationMixer(fbx);
  const action = mixer.clipAction(clip).play();

  for (let angleIdx = 0; angleIdx < effectiveAngles(clipConfig); angleIdx++) {
    if (mirror && isMirroredAngle(angleIdx, totalAngles)) continue;

    positionCameraForAngle(camera, angleIdx, totalAngles, forwardDir, elevationDeg, frustumSize);

    for (let frameIdx = 0; frameIdx < clipConfig.frameCount; frameIdx++) {
      const t = (frameIdx / clipConfig.frameCount) * clip.duration;
      mixer.setTime(t);
      fbx.updateMatrixWorld(true);

      renderer.setRenderTarget(renderTarget);
      renderer.render(scene, camera);
      renderer.setRenderTarget(null);

      // Pull pixels into a typed array and composite into the master canvas
      const pixels = new Uint8Array(cellSize * cellSize * 4);
      renderer.readRenderTargetPixels(renderTarget, 0, 0, cellSize, cellSize, pixels);
      compositeCellIntoMasterSheet(masterCanvas, pixels, cellSize, atlasCol, atlasRow);

      progress.report((doneCells++) / totalCells);
    }
  }
}
```

### 6.4 Camera positioning per angle

The author picks a forward-direction vector (default `+Z`) and an
elevation angle (default 8°). For each angle index, the editor:

1. Constructs the angle's azimuth: `azimuth = (angleIdx / totalAngles) * 2π`.
2. Builds the camera's offset in the model's local frame:
   ```
   offset = R_y(azimuth) * R_x(-elevationDeg) * normalize(forwardDir) * radius
   ```
   `radius` is the distance from origin needed to fit the model in
   the orthographic frustum — computed once per session from the
   FBX's bounding box. Adding 5° pitch above horizon for the
   classic Doom 3/4 quarter-view feel; the user can override.
3. `camera.position.copy(offset); camera.lookAt(0, 0, 0);`

Forward-direction `+Z` means "the model's nose points along world +Z
at clip start," which is the FBX export convention out of most DCC
tools. Authors with non-standard FBXs use the gizmo to align.

### 6.5 Compositing into the master sheet

`compositeCellIntoMasterSheet` is a simple `ImageData` blit:

```ts
function compositeCellIntoMasterSheet(masterCtx, pixels, cellSize, atlasCol, atlasRow) {
  // Flip Y because WebGL render-target pixels are bottom-up, canvas is top-down.
  const flipped = new Uint8ClampedArray(pixels.length);
  for (let y = 0; y < cellSize; y++) {
    const srcOff = y * cellSize * 4;
    const dstOff = (cellSize - 1 - y) * cellSize * 4;
    flipped.set(pixels.subarray(srcOff, srcOff + cellSize * 4), dstOff);
  }
  const imageData = new ImageData(flipped, cellSize, cellSize);

  const x = atlasCol * cellSize + padding * atlasCol + offset.x;
  const y = atlasRow * cellSize + padding * atlasRow + offset.y;
  masterCtx.putImageData(imageData, x, y);
}
```

Premultiplication of alpha happens during this blit (multiply each
RGBA's RGB by A/255 before storage). The output PNG is then encoded
via the canvas's `toBlob('image/png')` API and persisted to IDB.

### 6.6 Performance budget

A worst-realistic case:
- 16 angles × 8 frames × 4 animations = 512 captures
- Per-capture: ~1 ms WebGL render at 64×64 + ~5 ms `readRenderTargetPixels`
- Compositing: ~0.2 ms per cell
- Total: ~3.2 s

This is acceptable for an explicit "Bake" button (the user clicks and
sees a progress bar). Bake is **not** in any hot path.

If the user picks an 8 × 8 × 1 setup (typical first-pass for a single
clip), bake completes in ~0.5 s — feels instant.

If `readRenderTargetPixels` blocks too long on slower hardware, AE3
can move the whole render loop into an `OffscreenCanvas` inside a
Web Worker. Three.js + OffscreenCanvas support is well-trodden ground
in 2026 (`OffscreenCanvas` shipped in Firefox 105 + Safari 16.4); the
fallback for older browsers is the main-thread loop with `await new
Promise(r => requestAnimationFrame(r))` yields every ~16 ms to keep
the UI responsive. Document the fallback path.

### 6.7 Edge cases

- **FBX with no animations.** `fbx.animations` is `[]`. The editor
  offers a "Static pose capture (idle)" mode: a single AnimationClip
  is synthesized from the mesh's rest pose, the user picks the angle
  count, and the bake produces a 1-frame multi-angle sheet. Useful
  for prop sprites (chairs, barrels) that don't animate but need
  multi-angle billboard rotation.
- **FBX with no skeleton / static mesh.** Same as above — synthesize
  a rest-pose clip and rotate the mesh per angle. Skeletal weighting
  isn't required.
- **FBX file size.** The default-pack's 24 MB file is concrete. We
  warn at 50 MB ("this will take a few seconds to load and may strain
  Safari's IDB quota"). We hard-fail at 200 MB with an error
  suggesting the author re-export with fewer subdivision levels or
  strip unused meshes. The `_source/` files are NOT shipped by
  default (§7) so even a 200 MB FBX doesn't bloat the `.apg`.
- **FBX with non-pixel-aligned bounding box.** The bake's orthographic
  frustum is sized from `fbx.box3()` — if the model's pivot is far
  from its bounding-box center, the cell will be off-center. The
  editor centers the model in the frustum (translates by `-box.center`)
  before each render. Author still sees the pivot when scrubbing in
  the viewport (no auto-translate there — useful diagnostic).
- **FBX with multiple meshes per clip (multi-character file).** If
  `fbx.children.length > 1` and they are meshes (not bones), the
  editor surfaces a "Capture which root?" picker so multi-character
  FBXs export to multiple sprites. The non-picked roots are hidden
  via `visible: false` during their respective bakes.
- **Animations with wildly different durations.** Clip A is 0.5s
  long; clip B is 4s. The per-clip "frames" picker is independent —
  the user samples 4 frames from clip A (0.125s apart) and 24 from
  clip B (0.166s apart). Per-frame durations in the output manifest
  reflect the sample interval, not the source clip's wall-clock
  duration.
- **Translation / root motion in the FBX clip.** The character walks
  forward 3m over the clip's duration. We don't want the rendered
  sprite to drift across the cell. The editor offers a "Remove root
  motion" toggle (default on) that zeroes translation on the root
  bone before each frame. Authors who want drift (rare) can disable.

---

## 7. Persistence

The editor distinguishes **source assets** (dev-only, big, kept) from
**output assets** (small, shipped, regenerable).

### 7.1 IDB layout extension

Per [EDITOR.md § 4.2](./EDITOR.md), the editor uses one shared IDB
DB with object stores keyed by `(projectId, path)`. The animation
editor adds two conventions:

- **Source assets under `_source/`.** A leading underscore avoids
  any collision with engine-recognized pack paths. Examples:
  ```
  _source/zombie.fbx              ← original FBX
  _source/zombie.frames/0.png     ← loose-frame source for Path A.2
  _source/zombie.frames/1.png
  _source/zombie.input-sheet.png  ← original sheet for Path A.1
  ```
- **Parallel `spriteSources` store** keyed by
  `(projectId, spriteId)`:
  ```ts
  spriteSources:  keyPath ["projectId", "spriteId"]
    {
      projectId,
      spriteId,
      kind: "fbx" | "spritesheet" | "loose-frames",
      sourcePath: string,                  // "_source/zombie.fbx"
      forwardDirection: [number, number, number],
      cameraElevation: number,
      outputCellSize: number,
      mirror: boolean,
      clips: Array<{
        fbxName: string,                   // FBX clip name (Path B)
        outputName: string,                // manifest-side animation name
        frameCount: number,
        frameDuration: number,
        loop: boolean,
        next?: string,
        anglesOverride?: number,
        enabled: boolean,
      }>,
      bakedAt: number,                     // last bake epoch ms
      bakeDurationMs: number,
    }
  ```

The `spriteSources` store is separate from `manifests` because
manifest entries get **shipped**, but `spriteSources` records are
authoring metadata that must never leak into the `.apg`. Keeping them
in a parallel store guarantees the export pipeline can't accidentally
include them.

### 7.2 Source-asset shipping (default off)

By default the export pipeline (per
[EDITOR.md § 8](./EDITOR.md)) **excludes** any path starting with
`_source/`. Bundled `.apg` size stays small.

A user who wants to share source assets (e.g. an open-source pack
shipping its FBXs so other modders can re-bake) can flip a per-
manifest opt-in `_includeSources: true` flag in the export dialog.
When set, the exporter still strips the `spriteSources` IDB store
(those records are noisy authoring state) but ships `_source/*`
files verbatim under a `_source/` directory in the zip. A re-imported
project with `_source/` files preserves them; with `spriteSources`
gone, the editor reconstructs **default** config when the user opens
the sprite for re-baking. The user can then re-customize and re-bake.

This split — files shippable, metadata not — is the right factoring:
files are obvious content the user understands; metadata is private
editor state that should be regenerated on re-open.

### 7.3 Output asset shipping (always on)

Generated spritesheets land at the canonical pack path:

```
images/sprites/<sprite-id>-sheet.png
```

These are normal sprite assets. The exporter treats them like any
other PNG — included in the zip, no special handling. The engine
loads them through the existing `TEXTURE_2D_ARRAY` upload path; no
runtime changes needed (per [ANIMATIONS.md § 9.6](./ANIMATIONS.md)).

### 7.4 Re-bake on open

When the user opens an existing sprite for re-editing, the editor:

1. Reads `manifest.sprites[id]` → gets canonical animation/grid
   declarations.
2. Reads `spriteSources` IDB row → gets source kind + config.
3. Reads the source file from IDB (`_source/...`).
4. If the source kind is FBX, lazy-loads Three.js and re-creates the
   scene + viewport.
5. Populates the configuration panel with the stored config.
6. **Does not auto re-bake.** The user must explicitly click "Bake."
   This keeps the workflow predictable — opening a sprite is read-
   only until the user commits.

If `spriteSources` is missing (e.g. the project was imported from a
`.apg` that shipped sources but no metadata), the editor populates
defaults and surfaces a "Source asset found, config unknown — pick
parameters and re-bake to regenerate."

### 7.5 Storage size considerations

A 24 MB FBX × ~5 player sprites = 120 MB IDB usage per project.
[EDITOR.md § 11 Q3](./EDITOR.md) already flags storage quota as an
open question; this plan adds:

- A per-sprite size readout in the sprite library (X MB source + Y KB
  output).
- A "Drop source after bake" option on Path B for the size-sensitive
  user. If checked, the FBX is deleted from IDB after the first
  successful bake; re-editing requires re-uploading. The output
  sheet is fully self-sufficient (the manifest declares the grid;
  the sheet is the bytes), so dropping the source breaks only the
  one-click re-bake workflow.

---

## 8. Manifest integration

The editor reads from and writes to `manifest.sprites` and is
responsible for round-tripping all spritesheet metadata losslessly.

### 8.1 What the editor writes

For a baked sprite, the editor writes a manifest entry matching
[ANIMATIONS.md § 4.1](./ANIMATIONS.md):

```jsonc
"sprites": {
  "zombie": {
    "image": "images/sprites/zombie-sheet.png",
    "frameWidth": 64,
    "frameHeight": 64,
    "cols": 8,
    "rows": 32,
    "padding": 0,
    "offset": { "x": 0, "y": 0 },
    "angles": 8,
    "mirror": false,
    "interpolation": "snap",
    "animations": {
      "idle":   { "frames": [0,1,2,1],     "frameDuration": 0.2,  "loop": true },
      "walk":   { "frames": [0,1,2,3,4,5], "frameDuration": 0.1,  "loop": true },
      "attack": { "frames": [0,1,2,3],     "frameDuration": 0.08, "loop": false, "next": "idle" },
      "die":    { "frames": [0,1,2,3],     "frameDuration": 0.12, "loop": false, "angles": 1 }
    }
  }
}
```

Every field in [ANIMATIONS.md § 4.1](./ANIMATIONS.md)'s schema is
surfaced in the configuration panel. The editor never produces fields
that ANIMATIONS.md doesn't recognize.

### 8.2 What the editor reads (round-trip)

When the user re-opens a sprite, the editor:

1. Reads the manifest entry.
2. Reconciles it with the `spriteSources` IDB row.
3. Populates form fields from the manifest where they overlap, from
   `spriteSources` where they don't.

Manifest is authoritative for engine-visible fields (cols, rows,
frame counts, etc.). `spriteSources` is authoritative for editor-only
fields (forward-direction, FBX clip name → output name mapping, etc.).
Reconciliation on read is straightforward because the field sets
don't overlap — except `frameDuration`, which is both visible to the
engine (via `manifest`) and editable in the editor (via either
source). For `frameDuration` the manifest wins; the editor copies
it into `spriteSources` on read for consistency.

### 8.3 Multi-clip mapping

Path B introduces a subtlety: the FBX has clips named by the DCC tool
("mixamo.com" or "Idle_01" or "T-Pose Reference"). The manifest uses
clean names (`idle`, `walk`, `attack`). The editor's configuration
panel surfaces a 1-column rename mapping:

```
FBX clip name           → Output animation name        Frames  ☑
─────────────────────────────────────────────────────────────────
"mixamo.com:Idle"       → [idle           ]            [8]     [x]
"mixamo.com:Walk_Cycle" → [walk           ]            [8]     [x]
"mixamo.com:Attack_01"  → [attack         ]            [4]     [x]
"T-Pose Reference"      → [                ]            [-]     [ ]
```

Unchecked clips are skipped entirely. Renames are stored in
`spriteSources.clips[].outputName`. Reordering the rows reorders the
animations in the output manifest (which is significant — atlas row
layout depends on insertion order per
[ANIMATIONS.md § 5.1](./ANIMATIONS.md)).

### 8.4 Deletion + rename

- **Deleting a sprite**: removes manifest entry, removes
  `spriteSources` row, removes `images/sprites/<id>-sheet.png` from
  the assets store, leaves `_source/*` files in place (in case the
  user wants to recover). A separate "delete source too" confirms.
- **Renaming a sprite**: changes the manifest key, renames the
  `images/sprites/<id>-sheet.png` asset path, updates the
  `spriteSources` row's key. Source files stay at their original
  path (`_source/zombie.fbx` doesn't auto-rename to `_source/frost.fbx`
  — sources are content-addressed by their original filename).

### 8.5 Conflicts with hand-edited manifests

A pack author who manually edits `manifest.sprites.zombie` in the
manifest form (per [EDITOR.md § 6.5](./EDITOR.md)) outside Animation
mode could corrupt the editor's round-trip. Mitigation:

- The manifest editor in Assets mode **greys out** the sprite-entry
  fields for animation-managed sprites and shows a banner: "Edit
  this sprite in Animation mode →" with a deep-link button.
- Hand-edits to grid fields (cols, rows, frameWidth) are still
  permitted but trigger a re-bake-required indicator on next open.
- The export pipeline still ships whatever's in the manifest, even
  if `spriteSources` disagrees. The editor warns at export time:
  "sprite X has unbaked changes — re-bake before export?"

---

## 9. Phases

Three phases. Each ships independently and produces a runnable result.

### AE1 — Path A: bring-your-own (no 3D)

Scope:
- UI for "+ New sprite from spritesheet" (Path A.1).
- UI for "+ New sprite from loose frames" (Path A.2).
- Grid-overlay viewport with cell-picker and (animation, angle,
  frame) assignment.
- Canvas2D-based compositing pipeline that outputs a canonical
  spritesheet PNG conforming to
  [ANIMATIONS.md § 5](./ANIMATIONS.md).
- Manifest write + `spriteSources` IDB store.
- `_source/` asset persistence.
- Animation mode tab in the editor shell (basic shell, no Three.js
  dependencies pulled in).

Why AE1 first:
- Unblocks animation authoring without taking the Three.js dependency
  hit. A modder who has hand-painted pixel-art frames can ship an
  animated sprite the day AE1 lands.
- Exercises the canonical-output pipeline end-to-end — when AE2
  (FBX) lands, it shares the same compositor + manifest writer.
- Small surface area; high confidence; good first-mile.

Acceptance:
- Import a sheet of zombie frames painted in Aseprite, mark cells
  as `(walk, angle 0, frame 0..3)` etc., bake, see the output sheet
  match the engine's atlas layout, drop the manifest into the active
  scene, walk into the zombie in Play mode, see it animate.

### AE2 — Path B: FBX auto-render (the killer feature)

Scope:
- Three.js + FBXLoader lazy-load on Animation-mode entry.
- 3D viewport with orbit controls, model preview, animation scrubber,
  forward-direction gizmo.
- FBX bake pipeline (§6): orthographic camera + per-angle positioning
  + AnimationMixer + render-target capture + composite into the AE1
  output pipeline.
- "+ New sprite from FBX" entry point.
- Multi-clip mapping UI.
- Camera elevation + forward-direction config.
- Path B re-bake on existing sprites (config restored from
  `spriteSources`).
- Static-pose fallback for FBX-without-animations.
- The default-pack's `character/player_idle.fbx` becomes a concrete
  first-test case — AE2's acceptance test is "produce a working
  multi-angle player sprite from this file with no manual editing."

Acceptance:
- Drop `packages/default-pack/character/player_idle.fbx` onto the
  editor, pick 8 angles + 8 frames, click Bake, wait ~1-2 seconds,
  see a canonical sheet in the cell-grid preview, drop the manifest
  reference into a scene, walk around the player sprite in Play mode
  and see the angle change as the camera moves.

### AE3 — Loose-frame batch + polish

Scope:
- Drag-a-folder support for Path A.2 (currently AE1 ships it but with
  single-file drag; AE3 adds the multi-file batch).
- Web Worker for Path B compositing on slower hardware.
- OffscreenCanvas-based Three.js render path with main-thread
  fallback.
- GIF preview generator (uses `gif.js` or similar; ~150 KB lazy-load)
  for sharing a preview of the baked sprite outside the editor.
- Before/after diff viewer on re-bake (overlays old + new sheets
  with a slider).
- Flat-shading toggle (replaces lit-scene materials with
  `MeshBasicMaterial` for a retro look — see §6.2).
- Outline-shader pass during capture (1-px dark outline for the
  classic Doom silhouette; optional checkbox).
- Auto-detect grid for Path A.1 (use computer-vision-lite — sample
  pixel rows, find transparent gutters, propose `cols`/`rows`).
- Per-clip frame-count "smart default" — sample a low-pass-filtered
  estimate from the FBX clip's keyframe count.

These are polish, not blockers. Each is independently shippable.

### Default-pack smoke test

Following the `_animationsSmokeTest_doc` pattern in
[ANIMATIONS.md § 13](./ANIMATIONS.md), the default pack ships **one**
animation-editor-generated sprite when AE2 lands. The
`character/player_idle.fbx` becomes the canonical test fixture: the
editor's acceptance test re-bakes it and bytewise-compares to a
checked-in expected output. Drift in the FBX pipeline (Three.js
version bump, hook changes) is caught at CI time.

---

## 10. Open questions

Numbered for cross-reference; each block under 80 words.

1. **Three.js bundle size.** Three.js + FBXLoader minified is
   ~600 KB. **Recommendation: lazy-load** on Animation-mode entry.
   Cold start cost stays unchanged for users in other modes. Open: do
   we prefetch on idle (heuristic — once the user opens any sprite-
   like asset) or wait for explicit mode entry? Recommend explicit
   entry; the prefetch heuristic is a polish item.

2. **FBX clip naming surface.** FBX clips have DCC-tool names like
   `"mixamo.com:Idle_01"`. Three options: (a) surface as-is, force
   the user to read DCC noise; (b) auto-strip prefixes / suffixes by
   heuristic; (c) free-form rename per §8.3 (recommended). The user-
   rename UI is unavoidable; the auto-strip heuristic could be a
   pre-fill convenience. Recommend free-form with smart pre-fill.

3. **Outline rendering for retro feel.** Doom-style sprites often
   have a 1-px shadow outline. Implementable as an extra render pass
   per cell using Three.js `OutlineEffect` (post-process) or a custom
   Sobel-filter pass on the rendered cell. **Defer to AE3**; AE2 ships
   without. Open: is the outline a property of the sprite (manifest
   stores it) or a per-bake config (re-bake with different outline
   regenerates the sheet)? Recommend per-bake.

4. **Material handling from FBX.** PBR materials in the FBX (albedo,
   normal, roughness) — does the rendered sprite honor them via
   Three.js `MeshStandardMaterial`, or flatten to `MeshBasicMaterial`?
   **Recommend honor by default, with a "Flat shading" toggle**
   (AE3) that overrides every material with `MeshBasicMaterial(map:
   material.map)`. The flat toggle is the right default for retro
   pixel art; lit is the right default for higher-detail packs.

5. **OffscreenCanvas + WebGL in Workers.** Three.js works inside a
   Web Worker via `OffscreenCanvas`, but support is not universal
   (Safari 16.4+ only as of 2026). **Document the fallback**: if
   `typeof OffscreenCanvas === "undefined"`, the bake runs on the
   main thread with `await new Promise(r => requestAnimationFrame(r))`
   yields every ~16 ms. UI stays responsive at ~50 fps during a bake.

6. **Source-asset shipping.** Per §7.2, `_source/*` files default to
   **excluded** from the `.apg` export. Open: should we instead
   default to **included** for open-source-feel collaboration? The
   24 MB inflation per FBX argues against. Recommend default-off
   with a per-manifest opt-in. Revisit if user feedback says modders
   want to share sources by default.

7. **Cell-size auto-suggest.** When the user drops a 1024×1024
   spritesheet with a clear 8×8 grid of 128-px cells, can the editor
   detect that? **Yes, heuristically**: scan for transparent gutters
   between cells (Path A.1) or pick cell size = source-frame-image
   size (Path A.2). Confirm to the user before applying. Defer
   sophisticated CV to AE3.

8. **Per-frame events (footstep on frame 2 of walk).** Authoring
   surface for [ANIMATIONS.md Q10](./ANIMATIONS.md)'s deferred
   `onFrame` event. When the engine adds frame-level events, the
   editor surfaces them as a checkbox on each frame in the cell-grid
   preview: "fire event at this frame." Deferred until ANIMATIONS A2
   ships events.

9. **Live engine sprite refresh on re-bake.** When the user re-bakes
   a sprite that's currently in-scene during Play mode, should the
   running engine pick up the new sheet immediately? Per
   [ANIMATIONS.md § 1 non-goal](./ANIMATIONS.md), animation HMR is
   not in scope for A1 (texture array re-upload required). The editor
   can paper over: when AE2 ships a new sheet, prompt "Restart engine
   to apply?" Recommend yes — pause / restart is fast enough that a
   full reload feels acceptable for this workflow.

10. **FBX format vs glTF.** glTF is the modern Khronos standard;
    FBX is the legacy de-facto from Maya / 3ds Max. Should the editor
    support both? **Recommend yes, AE2 supports FBX (the user's
    concrete first case); AE3 adds glTF via `GLTFLoader`.** Same
    pipeline downstream of the loader; only the loader call differs.

11. **Forward-direction storage convention.** §6.4 defaults to `+Z`.
    The stored value (a 3-vector) is a unit vector in the model's
    local frame. Open: when a user picks a non-axis-aligned direction
    via the gizmo, do we snap to nearest cardinal? Recommend no — free
    rotation matters for FBXs with rotated rigs. Authoring overhead
    is one click on the gizmo.

12. **Multi-character FBXs.** §6.7 mentions multi-root FBXs.
    Practically, do we ever see those? Mixamo exports single-character.
    Custom rigs can pack multiple. **Recommend: detect at load time,
    surface a picker, treat each picked root as a separate sprite
    bake.** A user can author 4 sprites from one FBX by re-opening
    the same source with a different `rootIndex` config.

13. **Editor-internal preview vs canonical bake parity.** The cell-
    grid preview under the viewport (§5.4) re-renders quickly when
    the user scrubs config sliders. Is that preview always byte-
    identical to the eventual "Bake" output? **No — the live preview
    runs on the main thread at lower quality (no MSAA, no pixel
    snapping). The "Bake" button is the authoritative path.** Document
    that the preview is a rough indication, not a contract; the cell-
    grid preview after-bake (re-displaying the actual baked sheet) is
    the contract.

14. **Concurrent bakes.** A user clicks Bake on sprite A, then
    switches to sprite B and clicks Bake again. Cancel A or queue B?
    **Recommend cancel A**, surface a toast. Queue is more complex
    and rarely useful — the user's mental model is "I'm working on
    one thing."

15. **Bake determinism across browsers.** Three.js renders at slightly
    different sub-pixel positions on Chrome vs Firefox vs Safari. For
    cross-browser-stable diffs (e.g. for the default-pack smoke-test
    CI), we either ship a per-browser expected output or fuzzy-compare
    with a per-pixel tolerance. **Recommend fuzzy-compare** (≤2 LSB
    delta per channel + ≤2% pixel-count mismatch). Document in CI
    setup.

---

## 11. Implementation summary (AE1+AE2)

Files touched / added. Path B (AE2) entries marked **AE2**; the rest
are AE1.

- `apps/editor/src/AnimationMode/` — **NEW.** Top-level directory for
  Animation mode's React components.
- `apps/editor/src/AnimationMode/AnimationMode.tsx` — **NEW.** The
  workflow-mode root component. Renders the three-column shell.
- `apps/editor/src/AnimationMode/SpriteLibrary.tsx` — **NEW.** Left-
  column sprite list + "+ New" entry + recent sprites.
- `apps/editor/src/AnimationMode/PathChooser.tsx` — **NEW.** Three-
  card modal for picking import source.
- `apps/editor/src/AnimationMode/SheetImportView.tsx` — **NEW.** Path
  A.1 viewport — grid overlay + cell-picker.
- `apps/editor/src/AnimationMode/LooseFramesView.tsx` — **NEW.** Path
  A.2 viewport — frame strip + drag-to-grid.
- `apps/editor/src/AnimationMode/FbxViewport.tsx` — **NEW, AE2.**
  Three.js canvas + orbit controls + animation scrubber + forward-
  dir gizmo.
- `apps/editor/src/AnimationMode/CellGridPreview.tsx` — **NEW.**
  Below-viewport strip showing baked cells with scrubber.
- `apps/editor/src/AnimationMode/ConfigPanel.tsx` — **NEW.** Right-
  column form, path-specific.
- `apps/editor/src/AnimationMode/lib/composite.ts` — **NEW.** Pure
  helper: given a list of cell images + grid dimensions, produces a
  canonical spritesheet `Blob`. Unit tested.
- `apps/editor/src/AnimationMode/lib/manifestWriter.ts` — **NEW.**
  Pure helper: given a baked sheet + config, produces the
  `manifest.sprites.X` entry. Round-trips with `manifestReader`.
- `apps/editor/src/AnimationMode/lib/manifestReader.ts` — **NEW.**
  Inverse of `manifestWriter`. Reconciles with `spriteSources`.
- `apps/editor/src/AnimationMode/lib/fbxBake.ts` — **NEW, AE2.** The
  bake-loop core: takes a loaded `THREE.Group` + config + progress
  callback; returns a `Blob`. No React. Worker-portable.
- `apps/editor/src/AnimationMode/lib/cameraPositioning.ts` — **NEW,
  AE2.** Pure helper: `positionCameraForAngle(camera, angleIdx,
  totalAngles, forwardDir, elevationDeg, frustumSize)`. Unit-tested
  with the worked examples from §6.4.
- `apps/editor/src/AnimationMode/SpriteSourcesStore.ts` — **NEW.**
  IDB CRUD for the `spriteSources` object store. Mirrors `EditorAssetPack`
  patterns.
- `apps/editor/src/EditorProjectStore.ts` — **MODIFY.** Add a
  `_source/` path-prefix convention (no schema change — paths are
  arbitrary strings already).
- `apps/editor/src/EditorAssetPack.ts` — **MODIFY.** `has()` returns
  `false` for `_source/*` paths (those aren't engine-visible). The
  export pipeline already skips them.
- `apps/editor/src/Export/exportApg.ts` — **MODIFY.** Strip
  `_source/*` paths by default; add `_includeSources` opt-in per §7.2.
- `apps/editor/package.json` — **MODIFY, AE2.** Add `three` and
  `three/examples` as workspace deps. Lazy-imported (no main-bundle
  hit).
- `apps/editor/vite.config.ts` (or `bun.config.ts`) — **MODIFY, AE2.**
  Ensure Three.js is code-split into its own chunk that loads only
  when Animation mode mounts.
- `packages/default-pack/manifest.json` — **MODIFY.** Once AE2 ships
  and the player FBX is baked, add a smoke-test sprite entry (under
  `_animationEditorSmokeTest_doc` gate).
- `packages/default-pack/images/sprites/player-sheet.png` — **NEW**
  artifact from AE2's bake of `character/player_idle.fbx`.

No engine code changes are required for the editor. The editor
consumes the engine via the existing `AssetPack` interface and writes
manifests / assets the engine consumes unmodified.

No removals. No ModAPI breakage. The engine doesn't need to know the
editor exists.

---

## 12. Acceptance smoke test (AE1+AE2 combined)

End-to-end check, runnable at the end of AE2:

1. Open the editor at `/`.
2. Create a new project, name it "AnimationEditor smoke test."
3. Click "+ New sprite" → "🎲 3D model (FBX)" → drop the default-pack's
   `character/player_idle.fbx` (24 MB).
4. Wait for Three.js to lazy-load (~600 KB, ~1-2 s on a fast
   connection).
5. Configure: 8 angles, 8 frames per animation, 64-px cell size,
   forward `+Z`, 8° elevation, mirror off.
6. Confirm the FBX loads, the model previews in the viewport, the
   forward-direction gizmo is interactive.
7. Click Bake. Watch the progress bar fill in ~1-3 seconds.
8. Confirm the cell-grid preview shows 8 angles × 8 frames per
   animation, animation scrubber plays each clip.
9. Switch to Map mode, drop a player-prefab onto a cell that uses the
   new sprite (via a script or scene edit).
10. Switch to Play mode. Walk around the entity. Confirm the sprite
    changes angles as the camera position moves.
11. Click Export. Get a `.apg` file out. Load it in `apps/game` via
    `?pack=...`. Confirm identical behavior.
12. Re-open the editor, re-open the sprite, change to 16 angles, hit
    Re-bake. Confirm the manifest + sheet update; sources untouched.

Pass conditions:
- No console errors during any step.
- Bake completes within 5 s wall-clock for the configuration in
  step 5.
- Output PNG's grid matches the engine's atlas convention
  ([ANIMATIONS.md § 5](./ANIMATIONS.md)).
- Round-trip from step 12 produces a different sheet (more rows) but
  the same animation playback (engine reads the new manifest +
  sheet correctly).

If all 12 steps pass, the killer feature is real and shippable.

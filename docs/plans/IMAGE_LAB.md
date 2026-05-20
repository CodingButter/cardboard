# Image Lab — procedural image recipes + the editor tab

A plan for cardboard's **Image Lab**: a procedural-image engine that
turns tiny JSON recipes (~200 B – 2 KB) into rasterized textures and
animated spritesheets at pack-load time, plus the editor tab that
authors those recipes via a node-graph workspace, live preview, and
asset visibility everywhere a sprite is consumed.

Image Lab is the visual half of the procedural-asset push captured in
[IDEAS.md](../IDEAS.md) (2026-05-16 — "Procedural assets (image +
audio recipe DSL)"). The audio half is its sibling lab, **Sound Lab**
([SOUND_LAB.md](./SOUND_LAB.md)). Both labs share a common editor
shell — that shell is documented **canonically in §7.1 of this doc**;
SOUND_LAB.md cross-references rather than duplicates.

Source-of-truth for implementation. Phases IL1–IL7 below. Cross-refs:
[IDEAS.md](../IDEAS.md) (origin entry),
the materials plan (shipped; materials own shaders, recipes own
textures — they compose),
[ANIMATIONS.md](./ANIMATIONS.md) §5 (animated recipes export to a
spritesheet matching this convention),
[ANIMATION_EDITOR.md](./ANIMATION_EDITOR.md) §6 (FBX-baker pipeline —
parallel pattern for editor-side baking with IDB sidecar storage),
[EDITOR_REDESIGN.md](./EDITOR_REDESIGN.md) (shell + tab placement —
Image Lab is a top-level tab in the canonical 10-tab list),
[AUDIO.md](./AUDIO.md) (sibling area — procedural recipes for audio
ride the same DSL philosophy in Sound Lab),
[PACK_CHAIN.md](./PACK_CHAIN.md) (recipes ship as pack assets,
last-pack-wins on id collision),
[STORE.md](./STORE.md) (IL7 — community recipe sharing),
[TILE_PRESETS.md](./TILE_PRESETS.md) (tile presets reference recipes
as image sources),
[SOUND_LAB.md](./SOUND_LAB.md) (sibling lab — references §7.1 here
for shared shell architecture).

Last revised: 2026-05-16.

---

## 0. tl;dr

A `.recipe.json` is a tiny node graph (~200 B – 2 KB) that describes
how to procedurally generate a texture: `solid` + `perlin-noise` +
`brick-pattern` + `color-ramp` + `output`, wired together. The engine
compiles the graph to a single WebGL fragment-shader program at
pack-load, runs it once into a render target, uploads the result to
the sprite atlas, caches the bytes in IDB. Subsequent loads hit the
cache and skip compilation entirely.

Animated recipes add a per-parameter keyframe timeline. The engine
runs the same shader N times with different `u_time` uniforms, packs
the frames into a spritesheet matching [ANIMATIONS.md § 5](./
ANIMATIONS.md), and the existing Animation system consumes it
unchanged — **the engine never knows the spritesheet came from a
procedural recipe**.

The editor's **Image Lab** tab is the authoring surface: a 4-column
shell (Layers + Ops library / node-graph workspace / preview +
inspector / bottom strip with recent bakes + compiled output +
export status). The editor pre-bakes every recipe on save and caches
the PNG in IDB. Every sprite picker / tile-preset inspector / prefab
Sprite component picker in the editor renders the **baked PNG** with
a small **"IL" badge** in the corner; right-click → "Edit recipe…"
jumps back to Image Lab.

Determinism is the engineering contract: the editor's pre-bake uses
the **same compiler** as the engine's runtime bake. Given the same
recipe + same seed, both produce **byte-identical** output. A unit
test pixel-compares.

Why bother? A 64×64 RGBA PNG of a brick wall is ~12 KB. The recipe
that generates it is ~400 B — a **30× ship-size win**. At pack-chain
scale (a 100-tile pack ships 100 textures) the win compounds. Plus
every brick wall placed in a scene gets its own seed for "subtly
different at zero ship cost." Plus animated water / fire / plasma
without keyframe artistry. Plus modders without Aseprite skill can
ship presentable art.

---

## 1. Goals & non-goals

### Goals

- **Tiny ship size.** Recipes (~200 B – 2 KB) replace rasterized
  textures (~5–50 KB). A 100-recipe pack saves on the order of
  hundreds of KB-to-MB on the wire.
- **Per-instance variation at zero ship cost.** Each brick wall in a
  scene seeds independently; every brick is subtly different. The
  recipe + a seed-per-instance = unique pixels every spawn, with the
  recipe authored once.
- **Browser-only, no external tooling.** The compiler runs in the
  browser (engine context + editor context, same code). No CLI, no
  Substance Designer, no asset-pipeline daemon.
- **Animation-aware.** A recipe can declare keyframed parameter
  timelines; the engine bakes N frames at pack-load into a
  spritesheet matching the existing Animation atlas convention.
  Procedural fire, water, plasma, neon — all without hand-keyed
  pixel-art.
- **Editor-first authoring.** Image Lab is a node-graph IDE: drag
  ops from a categorized library, wire them with mouse, scrub
  parameter values with live preview, save → bakes a PNG sidecar
  in IDB. The user never touches the underlying JSON unless they
  want to.
- **Determinism is the contract.** Same recipe + same seed →
  byte-identical pixels in editor pre-bake and engine runtime bake.
  Unit-tested per browser via pixel-compare against a checked-in
  expected output.
- **Asset-system citizen.** Recipes appear in every editor surface
  that picks a sprite/texture, rendered as their **baked PNG** with
  an "IL" corner badge. Right-click → "Edit recipe…" jumps to Image
  Lab. Re-saving a recipe invalidates every IDB-cached bake that
  references it, mirroring the lightmap-invalidation pattern.
- **Composes with Materials.** The materials plan (shipped)
  shaders sample regular textures; a procedural recipe IS a regular
  texture from the shader's point of view. Materials and recipes
  compose orthogonally — a wet-floor shader can sample a procedural
  cobblestone recipe.
- **Pack-chain friendly.** Recipes live as pack assets at
  `recipes/<id>.recipe.json`; later packs override by id with the
  same last-pack-wins semantics already used for items / sprites /
  sounds.

### Non-goals

- **Pixel-art authoring.** Image Lab is procedural — formula-driven.
  If a modder wants hand-painted pixel art, they author it in
  Aseprite and import via Path A of [ANIMATION_EDITOR.md](./
  ANIMATION_EDITOR.md). The two paths coexist.
- **3D textures / cubemaps / volumetrics.** 2D RGBA-byte output
  only. The engine is a raycaster; sprite + tile + sky textures are
  the only consumers.
- **Compute-shader / GPGPU paths.** WebGL2 fragment-shader output
  only. Same constraint as the materials plan.
- **Live re-evaluation per frame.** Recipes bake **once** at
  pack-load (animated: N times into a spritesheet). The engine
  doesn't run the recipe shader every frame — the *baked sprite*
  is what renders. Live-evaluated procedurals are out of scope.
- **Vector / SVG-style path output.** Output is a raster RGBA8
  buffer on a pixel grid. No SVG path tessellation, no infinite-
  resolution preview.
- **Recipe-driven shader uniforms per instance.** A recipe bakes
  to a fixed atlas region. Per-instance variation comes from
  seeding *the bake*, not from runtime uniforms. (The seed could
  in principle change per-cell at runtime, but that breaks the
  cache + atlas model; defer.)
- **Hot-reload of recipes in a running playtest iframe.** Same as
  ANIMATIONS.md non-goal — atlas re-upload required. Editor
  surfaces "Restart engine to apply" after a save.
- **Authoring inside a published .apg.** Recipes are dev-time
  artifacts that ship inside the pack; modifying them post-export
  requires re-opening the project in Image Lab.

---

## 2. Status quo

As of 2026-05-16:

- **Engine**: zero procedural-image support. `manifest.sprites.X`
  declares an `image: "images/sprites/...png"` path; the AssetPack
  loader fetches the bytes; the WebGLRenderer uploads to
  `TEXTURE_2D_ARRAY`. There is no notion of a recipe asset, no
  shader compiler beyond the materials hook system, no IDB-cached
  rendered texture.
- **Editor**: no Image Lab tab. The 10-tab canonical list in
  [EDITOR_REDESIGN.md](./EDITOR_REDESIGN.md) §6.3 includes "Image
  Lab" + "Sound Lab" placeholders; their bodies are stubs awaiting
  IL3 and SL3 respectively.
- **Procedural ambition**: captured in [IDEAS.md](../IDEAS.md)'s
  2026-05-16 entry. A single paragraph; no schema, no editor
  layout, no compiler design. This doc is the build-out of that
  idea.
- **Adjacent precedent**: [ANIMATION_EDITOR.md](./ANIMATION_EDITOR.md)
  §6 already ships an in-editor bake pipeline (FBX → spritesheet,
  Three.js + IDB sidecar). [LIGHTING_OVERHAUL.md](./
  LIGHTING_OVERHAUL.md) ships `apps/editor/src/lib/lightmapBaker.ts`
  + `apps/editor/src/workers/bake-lightmap.worker.ts` — the
  worker-based bake pattern Image Lab mirrors. The materials plan
  (shipped) ships the GLSL hook-parsing + variant-assembly
  machinery the compiler reuses for op-to-GLSL emission.

Net: no infrastructure exists. The engine doesn't know what a
recipe is. The editor has placeholder tab slots. Everything below
is new.

---

## 3. JSON recipe schema

### 3.1 Top-level shape

```jsonc
{
  "id": "brick_wall_01",
  "kind": "image-recipe",
  "version": 1,
  "size": { "w": 128, "h": 128 },
  "seed": 0,
  "animated": false,
  "duration": 0,
  "frames": 1,
  "graph": {
    "output": "out_node_id",
    "nodes": {
      "node_id_1": { /* see §3.2 */ },
      "node_id_2": { /* ... */ }
    }
  }
}
```

| Field | Type | Notes |
|---|---|---|
| `id` | string | Slug — matches the recipe's pack-relative filename (`recipes/<id>.recipe.json`) + the manifest key (`manifest.recipes.<id>` — see §3.1 below). |
| `kind` | `"image-recipe"` | Discriminator. Audio recipes use `"sound-recipe"`. |
| `version` | int | Schema version. Starts at 1; increments per breaking change. See §3.5. |
| `size` | `{w, h}` | Output texture dimensions. Power-of-2 preferred; max 1024 per side (engine atlas ceiling). |
| `seed` | int | Default seed for noise-driven ops; per-instance bakes override at the engine call site. |
| `animated` | bool | When true, `frames` > 1 and parameter timelines (§5) are honoured. |
| `duration` | float | Seconds per loop (animated only). |
| `frames` | int | Number of baked frames in the output spritesheet (animated only). |
| `graph` | object | The node graph. `output` names the sink node; `nodes` is a map of id → node spec. |

Pack manifests gain a `recipes` registry parallel to `sprites`:

```jsonc
{
  "recipes": {
    "brick_wall_01": { "file": "recipes/brick_wall_01.recipe.json" },
    "water_shimmer": { "file": "recipes/water_shimmer.recipe.json" }
  },
  "sprites": {
    "brick_wall": { "recipe": "brick_wall_01" },
    "water":      { "recipe": "water_shimmer", "frameWidth": 64, "frameHeight": 64, "cols": 16, "rows": 1, "animations": { "shimmer": { "frames": [0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15], "frameDuration": 0.125, "loop": true } } }
  }
}
```

Sprites pull their image bytes from either `image: "..."` (today's
path, unchanged) **or** `recipe: "<recipe-id>"` (the new path).
Mutually exclusive. The pack-loader resolves a `recipe`-ref to a
runtime-baked PNG before the sprite's atlas-upload path runs — the
WebGLRenderer never sees the recipe, only its rendered pixels.

### 3.2 Node graph representation

Each node in `graph.nodes` is:

```ts
interface Node {
  op: string;          // e.g. "perlin-noise", "blend", "output"
  params: Record<string, unknown>;
  inputs?: Record<string, { node: string; port?: string }>;
}
```

- `op` names a registered op (§4).
- `params` are scalar / vector / enum values consumed by the op.
  Each op declares which keys it expects.
- `inputs` is a map of input-port name → upstream `{ node, port }`
  reference. Most ops have one default output port called `out` and
  inputs come into ports named after their semantic role (`base`,
  `mask`, `top`, `bottom`, etc.). The optional `port` field lets a
  node read a non-default output from an upstream multi-output op
  (rare; included for future-proofing).

The graph is a DAG. Cycles are a build-time error. `graph.output`
must name a node whose `op` is one of the sinks (typically
`"output"`; see §4.6).

### 3.3 Static recipes — worked example

A 128×128 brick wall, no animation:

```jsonc
{
  "id": "brick_wall_01",
  "kind": "image-recipe",
  "version": 1,
  "size": { "w": 128, "h": 128 },
  "seed": 17,
  "animated": false,
  "duration": 0,
  "frames": 1,
  "graph": {
    "output": "out",
    "nodes": {
      "mortar": {
        "op": "solid",
        "params": { "color": [0.3, 0.27, 0.25, 1.0] }
      },
      "noise": {
        "op": "perlin-noise",
        "params": { "scale": 8.0, "octaves": 3, "seed": "$recipe.seed" }
      },
      "bricks": {
        "op": "brick-pattern",
        "params": {
          "cellSize": [32, 16],
          "mortarWidth": 2,
          "offsetEveryOtherRow": 0.5
        }
      },
      "ramp": {
        "op": "color-ramp",
        "params": {
          "stops": [
            { "t": 0.0, "color": [0.55, 0.30, 0.20, 1] },
            { "t": 0.5, "color": [0.70, 0.40, 0.30, 1] },
            { "t": 1.0, "color": [0.85, 0.55, 0.40, 1] }
          ]
        },
        "inputs": { "t": { "node": "noise" } }
      },
      "composite": {
        "op": "blend",
        "params": { "mode": "normal" },
        "inputs": {
          "bottom": { "node": "mortar" },
          "top":    { "node": "ramp" },
          "mask":   { "node": "bricks" }
        }
      },
      "out": {
        "op": "output",
        "inputs": { "in": { "node": "composite" } }
      }
    }
  }
}
```

Six nodes. Roughly 750 B serialized. The output texture is a
128×128 RGBA8 brick wall with subtly noise-varied per-brick color,
crisp mortar lines. Seed 17 here, but the engine substitutes a
per-instance seed at call sites that pass one (§6.5).

`$recipe.seed` is a built-in parameter reference token — the
compiler resolves it to the recipe-level `seed` value (or the
per-bake override). Same syntax works for `$instance.x` /
`$instance.y` / `$time` to enable position-aware or animated
recipes. See §4.7 for full token list.

### 3.4 Animated recipes — worked example

A 64×64 water-shimmer recipe, 16 frames, 2-second loop:

```jsonc
{
  "id": "water_shimmer",
  "kind": "image-recipe",
  "version": 1,
  "size": { "w": 64, "h": 64 },
  "seed": 0,
  "animated": true,
  "duration": 2.0,
  "frames": 16,
  "graph": {
    "output": "out",
    "nodes": {
      "base": {
        "op": "solid",
        "params": {
          "color": {
            "$keyframes": [
              { "t": 0.0,  "value": [0.1, 0.3, 0.5, 1], "easing": "linear" },
              { "t": 0.5,  "value": [0.15, 0.4, 0.6, 1], "easing": "linear" },
              { "t": 1.0,  "value": [0.1, 0.3, 0.5, 1], "easing": "linear" }
            ]
          }
        }
      },
      "ripples": {
        "op": "perlin-noise",
        "params": {
          "scale": 12.0,
          "octaves": 2,
          "seed": "$recipe.seed",
          "uvOffset": {
            "$keyframes": [
              { "t": 0.0, "value": [0, 0],     "easing": "linear" },
              { "t": 1.0, "value": [1.0, 0.5], "easing": "linear" }
            ]
          }
        }
      },
      "highlight": {
        "op": "threshold",
        "params": { "threshold": 0.65, "softness": 0.05 },
        "inputs": { "in": { "node": "ripples" } }
      },
      "tinted_highlights": {
        "op": "blend",
        "params": { "mode": "screen", "opacity": 0.6 },
        "inputs": {
          "bottom": { "node": "base" },
          "top":    { "node": "highlight" }
        }
      },
      "out": {
        "op": "output",
        "inputs": { "in": { "node": "tinted_highlights" } }
      }
    }
  }
}
```

Two parameters animate: `base.color` (a 3-stop loop) and
`ripples.uvOffset` (a continuous slide). At pack-load the engine
runs the compiled shader 16 times with `t = i / 16` and packs the
16 frames into a 1024×64 (16 cols × 1 row) spritesheet. The
manifest's `sprites.water` block (§3.1 example) declares the
animation `shimmer` that consumes those 16 frames.

Recipe size on disk: ~1.1 KB. Output spritesheet: ~24 KB. Engine
ships **only the recipe** (1.1 KB) — the spritesheet is regenerated
on first pack-load. IDB cache on subsequent loads skips the work.

### 3.5 Versioning + migration

`version: 1` ships in IL2. The compiler accepts only its current
version unless a migration is registered.

Migration policy:

- **Bump on any breaking schema change** — op rename, param rename,
  default-value semantic change.
- **Migrations are pure functions** `(recipeJson: vN) → vN+1`
  registered at `packages/engine/src/Procedural/migrations/`. Same
  pattern as ANIMATIONS / materials-plan's future schema evolution.
- **Editor auto-migrates on open.** When Image Lab opens a recipe
  authored against an older version, it applies the migration
  chain in-memory, surfaces a "Schema upgraded vN → vN+1" toast,
  and re-saves at next bake.
- **Engine errors hard on unknown version.** Better to fail the
  pack-load than silently render the wrong thing. The error
  includes a "you may need a newer engine" hint.

Migrations are first-class because recipes are intended to be a
long-lived pack asset — a community recipe shared in 2027 should
still load in 2028's engine. Same compatibility contract as
manifest sprite shapes.

---

## 4. Ops library

Ops are the atomic operations in a recipe graph. Each op:

- Has a stable string id (`"perlin-noise"`, `"blend"`, …).
- Declares its **input ports** (name → expected type — typically
  `RGBA texture` or `scalar`).
- Declares its **output ports** (name → produced type; usually a
  single port `out` producing `RGBA texture`).
- Declares its **params** (name + type + default + UI hint, e.g.
  `scale: float ∈ [0.5, 32], default 8, slider`).
- Emits a **GLSL chunk** that consumes its input samplers + uniforms
  and writes its output. The compiler stitches chunks into one
  fragment-shader program (§6.2).

The IL2 op set is below. IL6 polish adds more. Each op header is the
stable id; the body describes purpose + ports + params + how the
GLSL chunk computes its output.

### 4.1 Generators

Generators have **zero input ports**. They synthesize pixels from
their params + the fragment's UV coordinate + global uniforms.

#### `solid`
Constant-color fill.
- Ports: out (RGBA).
- Params: `color: vec4 RGBA`.
- GLSL: `gl_FragColor = u_color;`. Trivial.
- Use case: backgrounds, mask sources, blend backgrounds.

#### `perlin-noise`
Classic Perlin noise — smooth, organic. Hand-rolled in GLSL for
cross-browser bit-identical output (see §12 Q5).
- Ports: out (greyscale, packed in `rgb` with `a=1`).
- Params: `scale: float`, `octaves: int [1, 6]`, `persistence:
  float`, `seed: int`, `uvOffset: vec2`.
- GLSL: standard fractal-Brownian-motion sum-of-octaves of a
  hash-noise primitive that uses bit-exact integer hashing
  (no float-precision wobble).
- Use case: clouds, rust, marble, water, organic textures.

#### `simplex-noise`
Simplex variant — better gradient distribution at higher dimensions,
cheaper at d≥3.
- Ports + params: same shape as `perlin-noise`.
- GLSL: 2D-simplex fragment from canonical Ashima/Ian-McEwan
  implementation, audited for cross-driver consistency.
- Use case: alternative organic noise; pairs with `perlin-noise`
  to get different visual character.

#### `worley` (Voronoi)
Worley / cellular noise — distance-to-nearest-point fields. Useful
for stones, scales, cracked-mud, leather.
- Ports: out (RGBA — `r`=F1 distance, `g`=F2 distance,
  `b`=cell-id-hash, `a`=1).
- Params: `cellSize: float`, `jitter: float ∈ [0, 1]`, `seed: int`,
  `distanceMetric: "euclidean" | "manhattan" | "chebyshev"`.
- GLSL: 3×3 cell-neighbourhood scan around the fragment's UV cell,
  finding F1 (nearest) and F2 (second-nearest) feature distances.
- Use case: cobblestone, scales, leather, leaf veins.

#### `brick-pattern`
Procedural brick tiling — solid white inside bricks, transparent in
mortar lines.
- Ports: out (single-channel mask, `rgb=1, a=mask`).
- Params: `cellSize: vec2`, `mortarWidth: float`, `offsetEveryOther
  Row: float ∈ [0, 1]`, `jitter: float`.
- GLSL: pixel position modulo cell dimensions, with offset applied
  to odd rows. Inside brick → 1; inside mortar gap → 0.
- Use case: brick walls (composed with a color generator via a
  blend node).

#### `checker`
Two-color checkerboard.
- Ports: out (RGBA).
- Params: `cellSize: vec2`, `color1: vec4`, `color2: vec4`.
- GLSL: `step(0.5, mod(uv.x + uv.y, 2.0))` blended.
- Use case: debug textures, retro tiles, pattern bases.

#### `gradient`
Linear / radial gradient between N color stops.
- Ports: out (RGBA).
- Params: `kind: "linear" | "radial"`, `angle: float` (linear),
  `center: vec2` + `radius: float` (radial), `stops: [{t, color}]`.
- GLSL: project fragment along gradient axis, lookup the stops
  table.
- Use case: skies, light falloffs, vignettes (also see §4.4
  `vignette`).

#### `circle`
Single antialiased circle.
- Ports: out (RGBA).
- Params: `center: vec2`, `radius: float`, `feather: float`,
  `color: vec4`.
- GLSL: `1 - smoothstep(r-feather, r, distance(uv, center))`.
- Use case: highlights, light orbs, pickup glyphs.

#### `rect`
Single antialiased rectangle.
- Ports: out (RGBA).
- Params: `pos: vec2`, `size: vec2`, `feather: float`, `color: vec4`.
- GLSL: max distance to nearest edge with `smoothstep` antialiasing.
- Use case: HUD frames, button bases, simple icons.

#### `shape`
N-sided regular polygon.
- Ports: out (RGBA).
- Params: `center: vec2`, `radius: float`, `sides: int ∈ [3, 32]`,
  `rotation: float`, `feather: float`, `color: vec4`.
- GLSL: distance-to-polygon via `cos(angle - rotation - 2π·k/sides)`
  bound.
- Use case: gems, stars, plus-signs, retro tokens.

#### `hash-noise`
Cheap per-pixel hash → uniform random ∈ [0, 1]. Useful for grain,
TV static, dithering sources.
- Ports: out (greyscale).
- Params: `seed: int`.
- GLSL: integer hash `fract(sin(dot(p, vec2(12.9898,78.233))) *
  43758.5453)` — the canonical not-quite-uniform-but-good-enough
  GLSL hash. (For determinism §12 Q5 considers replacing this
  with a stricter integer hash.)
- Use case: grain, dither input, TV-static, salt-and-pepper.

### 4.2 Modifiers

Modifiers take one input texture, produce one output. Equivalent
to a Photoshop "filter."

#### `blur`
Gaussian / box blur.
- Ports: in (RGBA), out (RGBA).
- Params: `kernel: "gaussian" | "box"`, `radius: int ∈ [1, 16]`.
- GLSL: separable two-pass blur via a small intermediate pass.
  (For IL2 a single-pass 9-tap suffices; full separable convolution
  defers to IL6 polish.)
- Use case: softening hard edges, glow setup.

#### `sharpen`
Unsharp-mask sharpening.
- Ports: in, out.
- Params: `amount: float`, `radius: int`.
- GLSL: subtract a blurred version from the original, scaled by
  `amount`.
- Use case: tightening soft noise output.

#### `levels`
Levels / contrast / brightness.
- Ports: in, out.
- Params: `inputBlack: float ∈ [0, 1]`, `inputWhite: float ∈ [0,
  1]`, `gamma: float ∈ [0.1, 5]`, `outputBlack: float`, `outputWhite
  : float`.
- GLSL: classic levels formula — remap input range to output range
  with a gamma curve.
- Use case: contrast bumps, exposing detail in noise.

#### `hue-shift`
HSL hue rotation.
- Ports: in, out.
- Params: `hue: float ∈ [0, 360]`, `saturation: float ∈ [-1, 1]`,
  `lightness: float ∈ [-1, 1]`.
- GLSL: RGB→HSL→shift→HSL→RGB. Standard chunk.
- Use case: color variation per seed, palette swap.

#### `posterize`
Quantize colors to N levels per channel.
- Ports: in, out.
- Params: `levels: int ∈ [2, 32]`.
- GLSL: `floor(c * levels) / (levels - 1)`.
- Use case: retro look, cel-shaded feel.

#### `threshold`
Binarize on a single channel.
- Ports: in (RGBA — uses luminance by default), out (RGBA — typically
  greyscale 0/1).
- Params: `threshold: float ∈ [0, 1]`, `softness: float ∈ [0, 0.5]`,
  `channel: "luminance" | "r" | "g" | "b" | "a"`.
- GLSL: `smoothstep(threshold-softness, threshold+softness, c)`.
- Use case: mask generation, glow extraction.

#### `dither`
Add per-pixel dithered noise — useful for low-bit-depth or pixel-art
output.
- Ports: in, out.
- Params: `kind: "bayer" | "white" | "blue"`, `strength: float`.
- GLSL: lookup a Bayer matrix or sample `hash-noise` per pixel,
  add at `strength` amplitude.
- Use case: stylized pixel-art noise, faux-1-bit dither.

### 4.3 Compositors

Compositors merge two (or more) input textures.

#### `blend`
The Photoshop blend-mode workhorse.
- Ports: in `bottom`, in `top`, optional in `mask`, out.
- Params: `mode: "normal" | "multiply" | "screen" | "overlay" |
  "soft-light" | "hard-light" | "add" | "subtract" | "difference" |
  "darken" | "lighten"`, `opacity: float ∈ [0, 1]`.
- GLSL: per-mode formula; mask scales the top's alpha if present.
- Use case: every composite step — combine layers, apply masks,
  tint.

#### `mask`
Multiply input's alpha by a mask texture.
- Ports: in, in `mask`, out.
- Params: `invert: bool`.
- GLSL: `out.a = in.a * (invert ? 1.0 - mask.r : mask.r)`.
- Use case: cutting out shapes, clipping noise to bricks.

#### `copy`
No-op pass-through. Useful when re-wiring graphs to maintain a
stable node id without changing semantics.
- Ports: in, out.
- Params: none.
- GLSL: `gl_FragColor = texture2D(in, uv);`.

#### `color-ramp`
1D color lookup from a stops table; input is a scalar selector.
- Ports: in `t` (scalar — uses luminance), out (RGBA).
- Params: `stops: [{t, color}]` (sorted by `t` ∈ [0, 1]).
- GLSL: piecewise-linear interp between stops indexed by input
  luminance.
- Use case: turn greyscale noise into a colorful image; palette
  swap.

### 4.4 Effects

Effects are higher-level compositions — often Photoshop "layer
style" equivalents — that internally combine modifiers + compositors.

#### `drop-shadow`
Offset blurred copy underneath the input.
- Ports: in, out.
- Params: `offset: vec2`, `blur: float`, `color: vec4`, `opacity:
  float`.
- GLSL: composite-pass that samples the input at `uv - offset` with
  blur applied, multiplied by color, drawn below the original.
- Use case: HUD elements, sprite outlines, depth cue.

#### `glow`
Outward bloom — blurred bright pixels added on top.
- Ports: in, out.
- Params: `radius: float`, `threshold: float`, `intensity: float`,
  `color: vec4`.
- GLSL: extract pixels above `threshold`, blur, add scaled by
  `intensity`.
- Use case: neon, magic, hot metal, plasma.

#### `bevel`
Inner / outer bevel via normal-from-alpha.
- Ports: in, out.
- Params: `depth: float`, `size: float`, `highlight: vec4`, `shadow
  : vec4`, `angle: float`.
- GLSL: compute normal from alpha gradient, dot with light dir,
  blend highlight / shadow.
- Use case: chunky 3D-looking icons, retro buttons.

#### `displace`
UV-displace one input by another (used as a vector field).
- Ports: in `base`, in `displacement` (RGB → vec2 offset), out.
- Params: `strength: float`, `channel: "rg" | "r" | "luminance"`.
- GLSL: sample `base` at `uv + displacement.xy * strength`.
- Use case: heat shimmer, glass distortion, ripples.

#### `edge-detect`
Sobel-based edge extraction. (Same op as §4.5 `sobel`; here as a
high-level alias with a color-coded output.) Reserved name; IL2
implements as `sobel` in §4.5 and aliases.

### 4.5 Filters

Filters are single-purpose convolutions.

#### `sobel`
Sobel edge-detection convolution.
- Ports: in, out (greyscale).
- Params: `intensity: float`.
- GLSL: 3×3 sobel kernel along x + y, magnitude → out.

#### `emboss`
Emboss filter — directional 3D-ish raise/lower.
- Ports: in, out.
- Params: `angle: float`, `depth: float`.
- GLSL: directional sobel-style convolution, biased to 0.5
  midtone.

#### `vignette`
Radial darkening around the edges.
- Ports: in, out.
- Params: `falloff: float ∈ [0, 1]`, `power: float`, `color: vec4`.
- GLSL: multiply input by `1 - smoothstep(0, falloff, dist-from-
  center)`.

### 4.6 Tools (sinks)

Sinks finalize the graph. **Every recipe must have exactly one
sink node, named by `graph.output`.**

#### `output`
The canonical sink — what `graph.output` references.
- Ports: in (RGBA).
- Params: none.
- GLSL: `gl_FragColor = texture2D(in, uv);` — but conceptually,
  this is where the compiler's "this is the final pass" logic
  lives. The chunk for `output` is special-cased to emit `gl_Frag
  Color` directly rather than writing to a sampler-bound texture.

#### `preview`
Editor-only sink — used by Image Lab to render intermediate-node
thumbnails on the canvas without altering the final output. Never
appears in shipped recipes; the editor adds and removes preview
nodes ephemerally.
- Ports: in (RGBA).
- Params: `nodeId: string` (the id of the upstream node whose
  result this previews).

### 4.7 Determinism + seeding

Determinism is the engineering contract. Given a recipe + a seed,
the compiler MUST produce byte-identical pixels in every
environment.

Sources of nondeterminism + how each is closed:

- **Float precision drift across drivers.** WebGL2 `highp` is 32-bit
  IEEE-754 on every conformant implementation, but tan/sin/cos can
  vary in last-bit. Mitigation: all hashes go through an integer
  hash (`floatBitsToUint(uv) ^ seed` etc.), not via `sin()`. The
  `hash-noise` op's `sin`-based hash is a known liability; §12 Q5
  proposes replacing with `pcg32` in IL2.
- **Mipmap generation.** Disabled on all recipe render targets —
  recipes always produce a single-mip texture.
- **MSAA.** Disabled — recipe output is fixed-pixel-grid, no AA
  smoothing.
- **Texture filtering during intermediate passes.** All intermediate
  samplers use `NEAREST` filtering. Antialiasing inside ops (e.g.
  `circle` feather) is computed analytically via `smoothstep`, not
  via texture filtering.
- **Float format.** All intermediate render targets are RGBA8 (not
  float), so per-stage quantization is identical across drivers.
  Exception: noise scalars may benefit from RGBA16F for high-octave
  fBm; §12 Q5 evaluates trade-off (defer to IL6).
- **Seed substitution tokens.** The compiler resolves these tokens
  at compile time:
  - `$recipe.seed` → recipe-level seed.
  - `$instance.seed` → per-bake override (engine passes via
    uniform — see §6.5).
  - `$time` → animation phase ∈ [0, 1) (animated recipes only).
  - `$instance.x` / `$instance.y` → world position of the instance
    (engine passes via uniform; tile-preset recipes can vary per
    cell).
  - `$frame` → integer frame index (animated only).

A recipe that uses none of these tokens is **position-stable** —
every instance bakes to the same pixels. A recipe that uses
`$instance.seed` produces unique pixels per instance.

The default-pack ships a recipe smoke test (an emerald `solid`
recipe + a 3-stop `gradient` recipe + the brick wall above) with a
checked-in expected RGBA8 buffer; CI re-bakes and bytewise compares.
Drift in the compiler (op-chunk change, hash change, etc.) caught
at CI.

---

## 5. Keyframes + tweening

Animation in recipes is **per-parameter keyframe arrays**. The
recipe's `frames` count + `duration` defines the playback; each
animated parameter declares its own keyframe timeline.

### 5.1 Keyframe model

A parameter that animates is replaced with a `$keyframes` object:

```jsonc
"scale": {
  "$keyframes": [
    { "t": 0.0, "value": 4.0, "easing": "linear" },
    { "t": 0.5, "value": 8.0, "easing": "ease-in-out" },
    { "t": 1.0, "value": 4.0, "easing": "linear" }
  ]
}
```

Fields per keyframe:

| Field | Type | Notes |
|---|---|---|
| `t` | float ∈ [0, 1] | Phase. 0 = recipe-start; 1 = recipe-end. The first keyframe must have `t=0`; the last must have `t=1` (the editor enforces). |
| `value` | scalar / vec / RGBA | Same type as the static param. |
| `easing` | string | See §5.2. Names the curve **going INTO this keyframe** from the previous one. |

The compiler resolves the parameter's value at any phase `t ∈
[0, 1)` by:

1. Finding the bracketing keyframe pair `(k_i, k_{i+1})` such that
   `k_i.t ≤ t < k_{i+1}.t`.
2. Computing local-t: `localT = (t - k_i.t) / (k_{i+1}.t - k_i.t)`.
3. Applying `k_{i+1}.easing` to `localT` (the easing function
   reshapes the lerp parameter).
4. Lerping between `k_i.value` and `k_{i+1}.value` by the eased
   localT.

This evaluation happens **once per frame at bake time**, not
per-pixel. The resulting concrete scalar is what the GLSL chunk
sees as a uniform.

### 5.2 Easing functions

The IL2 easing library:

| Easing | Shape |
|---|---|
| `linear` | `f(t) = t`. Identity. |
| `ease-in` | `f(t) = t*t`. Starts slow. |
| `ease-out` | `f(t) = 1 - (1-t)*(1-t)`. Ends slow. |
| `ease-in-out` | `f(t) = 3t² - 2t³`. Smoothstep — slow at both ends. |
| `cubic-bezier(x1, y1, x2, y2)` | Standard CSS cubic-bezier. Used when the named curves aren't expressive enough. |
| `hold` | `f(t) = 0`. Output stays at `k_i.value` until `t = k_{i+1}.t`, then jumps. Useful for stepped/8-bit animation. |
| `bounce` | Decaying bounce — useful for landing impacts. |

Easing functions are pure JS at bake time; no GLSL involvement.
The output of the easing is a concrete number plugged into a
uniform.

### 5.3 Per-parameter timelines

The recommended (and default) model: every parameter is independent.
Many parameters can animate at once, each on its own schedule.

Rationale: maximal flexibility. A water recipe can animate `base.
color` slowly while `ripples.uvOffset` slides continuously and
`highlight.threshold` pulses every half-second — all in the same
2-second loop.

Alternatives considered:

- **Per-node timeline.** Cheaper to author ("animate this whole
  node together") but inflexible — two params on the same node
  almost always want different curves.
- **Per-recipe timeline.** A single global parameter that ops sample
  by name. Hyper-cheap but couples everything; can't have two
  unrelated animations co-existing.

Decision: **per-parameter timelines.** The editor offers grouping
sugar later (IL6 — "select multiple parameters, set them all on the
same curve in one operation") but the underlying model stays
per-parameter.

### 5.4 Multi-track animation

Concretely, multi-track animation is what you get by default: each
animated parameter is its own track. The water recipe in §3.4
already does it — `base.color` and `ripples.uvOffset` are two
independent tracks sharing the same `duration` but different
keyframe positions.

The timeline UI (§7.9) visualizes this as a stack of horizontal
tracks, one per animated parameter, with keyframe markers along
each.

### 5.5 Animation export — spritesheet packing

For an animated recipe with `frames: N`:

1. Compiler builds **one** fragment-shader program (per the static
   compiler — animation introduces no shader-level branching).
2. Engine creates **one** WebGL render target sized `(size.w *
   cols) × (size.h * rows)` where `cols × rows ≥ N` and `cols`
   maximizes (typically `cols = N, rows = 1` for short anims; the
   compiler splits across rows when `cols * size.w > 1024`).
3. For each frame `i ∈ [0, N)`:
   - Compute `t = i / N`.
   - Evaluate every animated parameter at phase `t` per §5.1.
   - Upload concrete uniforms.
   - Render to render-target cell `(i % cols, floor(i / cols))`
     with viewport set to that cell.
4. Glue the result into a single spritesheet; upload to the sprite
   atlas as a regular layer.
5. The sprite's `manifest.sprites.<id>` declares `frameWidth = size.
   w`, `frameHeight = size.h`, `cols`, `rows`, plus an `animations`
   block (typically one animation named `loop` with the full frame
   range) — matching [ANIMATIONS.md § 5](./ANIMATIONS.md)'s atlas
   layout.

**The crucial property: the engine's Animation system never knows
the spritesheet came from a recipe.** It reads the same
`manifest.sprites.X` shape it reads today; the atlas layout matches
§5 of ANIMATIONS.md; the Animation component plays the frames the
same way it plays a hand-painted sheet. The recipe is invisible
downstream.

This is the same design philosophy as ANIMATION_EDITOR's FBX baker
([ANIMATION_EDITOR.md § 3.2](./ANIMATION_EDITOR.md)): a complex
authoring path that produces a canonical asset format the engine
consumes unmodified.

---

## 6. Runtime engine (the compiler)

### 6.1 Recipe JSON → WebGL fragment shader

The compiler lives at `packages/engine/src/Procedural/compiler.ts`.
It is the **single source of truth** for recipe → pixels — used by
both the engine at pack-load and the editor at design-time.

Compilation steps:

1. **Validate the recipe.** Schema version check. Output node
   exists. No dangling input refs. No cycles. Param types match op
   declarations.
2. **Topologically sort** the node graph by reachability from
   `graph.output`.
3. **Emit one GLSL fragment shader.** Each non-sink node becomes a
   function in the assembled GLSL. Each function takes its inputs
   as `sampler2D` arguments (for textured ports) or scalar
   uniforms (for animated parameters). The function body is the
   op's GLSL chunk with input references substituted.
4. **Emit `main()`** that calls the sink-node function and writes
   `gl_FragColor`.
5. **Compile + link** the shader program; cache the program handle
   per (recipe-id, schema-version) hash.

Worked compiler output (highly abbreviated, the brick wall recipe
from §3.3):

```glsl
#version 300 es
precision highp float;

uniform float u_recipe_seed;
uniform float u_instance_seed;
uniform float u_time;
in vec2 v_uv;
out vec4 fragColor;

vec4 node_mortar(vec2 uv) {
  return vec4(0.3, 0.27, 0.25, 1.0);
}

float node_noise(vec2 uv) {
  // ... perlin fBm body with seed = u_recipe_seed ...
}

float node_bricks(vec2 uv) {
  // ... brick-pattern mask ...
}

vec4 node_ramp(vec2 uv) {
  float t = node_noise(uv);
  // ... color-ramp lookup ...
}

vec4 node_composite(vec2 uv) {
  vec4 bottom = node_mortar(uv);
  vec4 top = node_ramp(uv);
  float mask = node_bricks(uv);
  return mix(bottom, top, top.a * mask);
}

void main() {
  fragColor = node_composite(v_uv);
}
```

Function inlining vs sampler-based passes is decided per op
category: cheap pure-math ops (generators, modifiers without
heavy filtering) inline as functions sharing one fragment program.
Expensive multi-tap ops (`blur`, `displace`) emit intermediate
sampler passes via a second render-target write. The compiler
emits a **two-stage pipeline** at most for IL2 — most recipes
collapse to one stage.

### 6.2 Node-graph evaluation order

Topological sort from `graph.output` upward. The compiler walks the
DAG depth-first, emitting each node's GLSL function exactly once.
Nodes referenced by multiple downstream nodes are emitted once;
their function is called by every consumer. (The GLSL compiler is
free to inline; we don't bother CSE-ing at our level.)

Cycles (which schema validation should reject) would cause infinite
recursion in the emit walk — second line of defense.

The compiler emits functions in **reverse topological order**
(leaves first) so each function definition is in-scope by the time
its consumer is emitted.

### 6.3 Texture upload + spritesheet packing

For static recipes:

1. Allocate a `(size.w, size.h)` RGBA8 render target.
2. Bind the compiled program; set uniforms.
3. Draw a fullscreen quad with `v_uv ∈ [0, 1]²`.
4. Read pixels (`gl.readPixels` into a Uint8Array) — used for IDB
   caching.
5. Upload directly to the sprite atlas's `TEXTURE_2D_ARRAY` layer
   for the consuming sprite id.

For animated recipes — see §5.5. The spritesheet is the single
atlas-layer upload; the renderer reads its frames via UV offset
exactly as it reads a hand-painted sheet.

### 6.4 IDB cache (per recipe hash)

Pack-load is expensive if every recipe re-bakes. The engine caches
baked PNG bytes in IDB keyed by:

```
key = sha256( recipe.id || JSON.stringify(recipe.graph) || seed )
```

Cache hit → skip the WebGL pipeline entirely, decode the PNG, upload
to the atlas. Cache miss → compile + bake + write the result back
to IDB.

The cache lives in the same IDB database the editor uses for
projects (per [EDITOR.md § 4.2](./EDITOR.md)). In the playable game
(`apps/game`) the cache is its own DB. The cache invalidates by
hash; if the recipe changes by one byte, the hash changes, the new
key misses, the old key never gets read again. Stale entries are
LRU-evicted when the IDB store grows past a configured ceiling
(50 MB default — see §12 Q4).

Pack-update flow:
- User installs an updated pack chain.
- Each recipe's hash changes.
- First pack-load on the new chain bakes every recipe; subsequent
  loads hit cache.

This mirrors the lightmap cache pattern in `apps/editor/src/lib/
lightmapBaker.ts` — keyed by scene + content hash, IDB-stored,
worker-baked.

### 6.5 Pack load flow

When is a recipe evaluated? At **pack-load time**, after the
manifest is parsed but before sprite atlases are uploaded. The
flow:

1. `loadAssetPack(pack)` parses manifest.
2. For each `manifest.recipes.<id>`:
   - Fetch `recipes/<id>.recipe.json`.
   - Compute hash.
   - Look up in IDB cache.
   - **Cache hit**: decode cached PNG → ready.
   - **Cache miss**: compile recipe → bake → write IDB → ready.
3. For each `manifest.sprites.<id>` whose `recipe` field is set:
   - The sprite's image bytes come from the corresponding cached/
     baked recipe output.
   - Atlas upload proceeds exactly as for hand-painted sheets.

Per-instance bakes (when an `$instance.seed`-using recipe needs a
unique-per-spawn texture) **defer** to the spawning code. The
recipe still compiles once at pack-load (to build the shader
program); each instance's bake happens on first render of that
instance and is cached per-instance-id in a runtime LRU. Out of
scope for IL2; recorded as §12 Q3.

### 6.6 Performance budget

| Scenario | Time |
|---|---|
| Static recipe, 128×128, single pass, cache miss | ~5 ms (compile ~2 ms + render ~1 ms + readback ~1 ms + IDB write ~1 ms). |
| Static recipe, cache hit | <1 ms (IDB read + atlas upload). |
| Animated 16-frame recipe, 64×64, cache miss | ~50 ms (compile + 16 render passes + readback + IDB write). |
| Animated, cache hit | ~5 ms (16-frame PNG decode + upload). |
| 100 recipes per pack, all misses | ~500 ms — the baseline boot tax for a recipe-heavy pack. |
| 100 recipes per pack, all hits | ~50 ms — within typical pack-load budget. |

The 500 ms cold-start tax is acceptable: it's a one-time cost per
recipe content. Once cached, every subsequent boot is fast. We
warn at pack-builder time when a pack contains > 200 recipes (§12
Q4 — recipe count ceiling).

Bake work runs on the **main thread by default** (it's WebGL — no
worker option without `OffscreenCanvas`). The editor uses
`OffscreenCanvas` + a Web Worker where supported, falling back to
yielded main-thread bakes — same fallback story as
[ANIMATION_EDITOR.md § 6.6](./ANIMATION_EDITOR.md).

---

## 7. Editor tab layout (Image Lab)

### 7.1 Shared shell architecture (Image Lab + Sound Lab) — CANONICAL

This section documents the 4-column shell pattern shared by **Image
Lab** and **Sound Lab**. [SOUND_LAB.md](./SOUND_LAB.md) §7.1
cross-references this section instead of duplicating it.

Both labs solve the same problem — node-graph authoring of a
procedural asset with live preview + parameter inspector — and
share the same visual language: a dense IDE aesthetic, amber-on-
zinc theme per [EDITOR_REDESIGN.md § 3](./EDITOR_REDESIGN.md), and
a 4-column grid with a bottom strip.

#### 7.1.1 Layout grammar

```
+-- TopBar (shared editor chrome) -----------------------------+
+-- PrimaryTabs (Home / Map / Entities / ... / Image Lab / ...)+
+--------------------------------------------------------------+
|                                                              |
|   Left rail    |   Center (graph)   |   Right rail (split)   |
|   (260 px)     |   (fluid)          |   (340 px)             |
|                |                    |                        |
|   Layers       |                    |   Live Preview (top)   |
|   panel        |   Node graph       |   ─────────────        |
|   ──────       |   workspace        |   Node Properties      |
|   Ops library  |                    |   inspector (bottom)   |
|                |                    |                        |
+--------------------------------------------------------------+
|  Bottom strip (3 sub-panels):                                |
|   Recent Bakes | Compiled Output details | Export Outputs   |
|   (260 px)     | (fluid)                 | (320 px)         |
+--------------------------------------------------------------+
| StatusBar                                                    |
+--------------------------------------------------------------+
```

**Column widths**: pinned, not percentage. Left rail 260 px. Right
rail 340 px. Bottom strip's three sub-panels: 260 / fluid / 320.
The center workspace grows / shrinks to fill remaining space.

**Responsive collapse**: at viewport widths < 1366 px, the right
rail's Live Preview panel collapses to an icon-tab strip; the user
can re-expand it. At < 1180 px, the left rail's Ops library
collapses below the Layers panel into a single tab. Below 1024 px,
the layout falls back to a single-column scrollable layout —
explicitly second-class; Image Lab targets >= 1366 px.

#### 7.1.2 Left rail: Layers panel + Ops library

The left rail is split vertically:

- **Top: Layers panel (~30% height).** A flat list of "layers" in
  the current recipe — actually, a flattened-to-list view of the
  node graph for users who think in stacks. Each entry shows the
  node's display name + its op icon + a visibility toggle. Clicking
  a layer selects the corresponding node in the graph. The Layers
  panel is a **convenience** for stack-thinkers; the graph
  workspace remains the canonical authoring surface. Per §0 and
  the canonical decision, layer-stack-as-MVP was rejected; this
  panel is read-mostly + select-only, not edit-the-stack-here.

  PanelHeader: "LAYERS" + a count Badge ("7"). Below: a scrollable
  list of rows. Each row = one node, with op icon + display name
  + a small chevron that, when expanded, shows the node's top
  params inline. Clicking the body selects the node in the graph
  and scrolls the Node Properties inspector to it.

- **Bottom: Ops library (~70% height).** A categorized, searchable
  palette of every available op. Search Input at top filters by op
  name + tag. Below: CollapsibleSection per category — Generators,
  Modifiers, Compositors, Effects, Filters, Tools. Each category
  is a 2-column grid of op tiles (icon + name + 1-line description
  on hover).

  PanelHeader: "OPS LIBRARY" + a search IconButton.

  Each op tile is **draggable**. Drag from the tile and drop onto
  the graph workspace to instantiate a new node at the drop
  position (§7.1.3). Or double-click the tile to instantiate at
  the workspace's current center.

#### 7.1.3 Center: Node graph workspace

The heart of the editor. Mirrors Blender's shader editor,
Substance Designer's node graph, Houdini's network editor.

- **Pan**: middle-mouse drag (or trackpad two-finger pan, or
  Space+drag).
- **Zoom**: scroll wheel, with a max zoom-in of 2× and max
  zoom-out of 0.25×. Pinch zoom on trackpad.
- **Background**: a faint dot-grid at the workspace's zoom level —
  helps with layout but doesn't constrain placement.
- **Selection**:
  - Click a node to select it.
  - Shift-click to add/remove from selection.
  - Drag-rectangle (left-mouse on empty space) for marquee select.
  - Cmd/Ctrl+A selects all nodes.
- **Multi-select inspector**: when 2+ nodes are selected, the
  Node Properties inspector shows shared parameters (parameters
  present on every selected node) for batch-edit. §12 Q2 captures
  the design question.

Each node renders as a rounded card with:

- A title bar (op name in caps + node display name editable
  inline).
- An **input port column** on the left — a small dot per input
  port with a hover label.
- An **output port column** on the right — same shape, but for
  outputs (typically just `out`).
- A central thumbnail showing the node's current output
  (intermediate result of that node's pixels). Computed
  on-the-fly via the compiler's `preview` sink (§4.6) the
  editor injects ephemerally per node. Thumbnails update on
  every parameter change with a small debounce (200 ms).
- A small kebab IconButton in the title bar — opens a context
  menu with `Rename`, `Disable`, `Duplicate`, `Delete`.

**Wiring**: click-drag from an output port to an input port to
create a connection. The wire is an SVG bezier curve. If the
user drops on empty space, a small floating menu appears showing
compatible ops to insert mid-air — Substance-Designer-style. If
the user clicks an existing wire, it highlights; pressing Delete
removes it.

**Wire type validation**: ports are typed (RGBA texture,
greyscale, scalar). The graph rejects type-mismatched wires
visually (wire turns red while dragging); on drop, the
connection isn't made. Auto-coerce rules (e.g. RGBA → greyscale
via luminance) ship as a fallback for common cases.

**Keyboard shortcuts** (workspace-focus):

| Key | Action |
|---|---|
| `Del` / `Backspace` | Delete selected nodes + their incident wires. |
| `Cmd/Ctrl+D` | Duplicate selected nodes (offset by 32 px). |
| `Cmd/Ctrl+C` / `Cmd/Ctrl+V` | Copy / paste — across recipes too. |
| `Cmd/Ctrl+G` | Group selected nodes into a subgraph (IL6 feature; reserved). |
| `F` | Fit-all — pan/zoom to encompass every node. |
| `Home` | Pan to graph origin. |
| `Cmd/Ctrl+/` | Toggle disabled state on selected nodes. |
| `Cmd/Ctrl+Z` / `Shift+Cmd/Ctrl+Z` | Undo / redo. |
| `Tab` | Open "add node" search palette at cursor. |

**Contextual menus**:

- Right-click empty space → "Add node…" submenu (categorized;
  echoes Ops library).
- Right-click a node → `Rename`, `Disable`, `Duplicate`, `Delete`,
  `Preview output` (sets this node as the active preview in the
  Live Preview panel), `Set as output` (rewires `graph.output`
  to this node).
- Right-click a wire → `Delete`, `Insert node…` (drops a chooser
  to inject a node mid-wire — `mask`, `levels`, etc.).

#### 7.1.4 Right rail (top): Live preview pane

A square (or near-square) panel rendering the current recipe's
output **at the recipe's actual size**, surrounded by:

- A small toolbar above the preview: zoom toggle (1× / 2× / 4×),
  background toggle (checker / black / white / pack-color), a
  scrubber (for animated recipes — see §7.10), a "Re-bake" Button.
- Below the preview: a row of stats — current frame, last bake
  time, output size in pixels, last cache hit/miss.

The preview re-bakes **incrementally** as the user edits:
- Parameter change → re-bake (compile cached) ~5 ms.
- Wire change → recompile + re-bake (~20 ms).
- Op change → recompile + re-bake.

A "Live preview" ToggleSwitch in the toolbar disables auto-refresh
for users who want to edit a complex graph without per-keystroke
re-bakes; in that mode, the user clicks "Re-bake" manually.

The Live Preview panel is **also** the surface the user sets via
right-click → "Preview output" on any node — switching the preview
to show that node's intermediate output. A small Badge in the
toolbar shows which node is being previewed ("default" = the
graph's output node, or the node id otherwise).

#### 7.1.5 Right rail (bottom): Node Properties inspector

Inspector for the currently selected node (or, with multi-select,
the shared param surface).

- PanelHeader: "NODE PROPERTIES" + the node's op name as a Badge.
- Body: a vertical stack of PropertyRows, one per param the op
  exposes. Each row uses the appropriate primitive:
  - Scalar / int → Slider (with value chip) or numeric Input.
  - Boolean → ToggleSwitch.
  - Enum → Select or SegmentedControl (≤ 4 options).
  - Color → ColorChip.
  - Vec2 / Vec3 → row of numeric Inputs.
  - Animation keyframes → a small inline "Animate ▾" affordance —
    clicking it converts the param to keyframed and reveals an
    inline keyframe editor (§7.9).
- At the bottom: an "Advanced" CollapsibleSection for rarely-used
  params (`octaves` on `perlin-noise`, `distanceMetric` on
  `worley`, etc.).

#### 7.1.6 Bottom strip: Recent Bakes + Compiled Output + Export Outputs

A three-panel horizontal strip ~180 px tall, fixed below the
center + right columns.

- **Recent Bakes (left, 260 px)**: a horizontally scrollable strip
  of thumbnail tiles — the most recent N (default 12) baked outputs
  in this session. Each tile shows the baked PNG + the recipe id +
  the bake timestamp. Click a tile to load that recipe into the
  workspace. Useful for rapidly iterating across multiple recipes
  ("how did the brick recipe look at this seed?"). Persists per-
  project in IDB.

- **Compiled Output details (center, fluid)**: a key-value display
  of metadata for the most recent successful bake:
  - Output size (e.g. "128×128 RGBA").
  - GLSL source size (e.g. "2.4 KB").
  - Compile time (e.g. "1.8 ms").
  - Bake time (e.g. "0.9 ms").
  - Hash (truncated SHA — useful for confirming IDB cache key).
  - Node count, port count, wire count.
  - A "View GLSL" Button — opens a modal showing the compiler's
    generated GLSL (useful debugging tool; also useful as a
    teaching surface).

- **Export Outputs (right, 320 px)**: status panel for export
  flows.
  - Recipe export status: "Saved to pack" / "Unsaved changes" /
    "Bake failed: ..."
  - A "Export PNG" Button — writes the current bake to a download
    (useful when the user wants the result outside the editor).
  - A "Copy recipe JSON" Button — copies the recipe JSON to the
    clipboard (useful for sharing snippets in chat / pasting into
    another project).
  - IL7-reserved: a "Share to Community" Button — uploads the
    recipe to the Store (§13 cross-ref).

#### 7.1.7 Header toolbar

Above the columns, below the PrimaryTabs (within the Image Lab
view body), a horizontal Toolbar:

- Recipe selector — DropdownMenu listing every recipe in the
  current project, with "+ NEW RECIPE" at the bottom.
- Recipe name Input (inline rename).
- Static ↔ Animated mode toggle (SegmentedControl: "Static" /
  "Animated"). Toggling to Animated reveals the timeline (§7.9).
- A Save Button (amber primary). Disabled when nothing has changed.
- A Re-bake Button.
- An IconButton menu (kebab) — Delete recipe, Duplicate recipe,
  Export PNG, Import recipe (paste JSON).

#### 7.1.8 Keyboard shortcuts (lab-wide)

In addition to workspace shortcuts (§7.1.3):

| Key | Action |
|---|---|
| `Cmd/Ctrl+S` | Save recipe (writes JSON to project + triggers bake). |
| `Cmd/Ctrl+N` | New recipe. |
| `Cmd/Ctrl+P` | Toggle Live preview auto-refresh. |
| `Cmd/Ctrl+B` | Manually trigger re-bake. |
| `Cmd/Ctrl+E` | Export current bake as PNG download. |
| `Space` | (When holding) pan the graph workspace. |
| `Cmd/Ctrl+1..6` | Jump preview to one of the most-recent 6 recipes. |

#### 7.1.9 Drag-drop semantics (shared)

- **Drag an op from the Ops library → drop on workspace** =
  instantiate node at drop position.
- **Drag an op from the Ops library → drop on an existing wire**
  = insert node into the wire (compatible ports auto-connect).
- **Drag an op from the Ops library → drop on an existing node** =
  replace that node's op (preserves the node's wires where port
  names match).
- **Drag a node from the graph → drop on another node** =
  reorder z (node card stacking — for visual clarity only; no
  graph-semantic change).
- **Drag a recipe from Recent Bakes → drop on workspace** = open
  that recipe in place.
- **Drag a recipe from the recipe-list / Recent Bakes → drop on
  a Live Preview region of another tool** (e.g. Map's cell
  inspector) = wire the recipe up to that consumer surface as a
  texture source. (Cross-tab DnD — IL5 / IL6 polish.)

#### 7.1.10 Wiring semantics (shared)

- **Ports are typed.** RGBA / greyscale / scalar / vec2.
- **Type-compatible** connections succeed. **Incompatible**
  connections fail silently (wire snaps back, brief red flash).
- **Coercion rules**:
  - RGBA → greyscale: luminance.
  - greyscale → RGBA: replicate to RGB, alpha=1.
  - RGBA → scalar (rare; e.g. `color-ramp`'s `t` input): luminance.
- **One output → many inputs**: legal. The output node's chunk
  appears once but is called by each consumer.
- **Many outputs → one input**: illegal. The user must insert an
  explicit composite (blend / mask / add).
- **Cycle prevention**: while dragging, the workspace
  highlights nodes that would close a cycle in red — drops on
  those are rejected.

This shell architecture is **canonical for Image Lab and Sound
Lab**. Sound Lab's graph ops differ (oscillators, filters,
envelopes) but the shell is identical — same column widths, same
keyboard shortcuts, same drag-drop semantics, same Live preview +
properties + bottom-strip split. The only difference: Sound Lab's
"Live preview" is a waveform / spectrogram instead of a texture
thumbnail, and the timeline scrubber drives audio playback instead
of frame indexing.

### 7.2 Header + toolbar

See §7.1.7. Image Lab–specific additions:

- "Apply seed" Input chip — set the seed used for both the in-
  editor preview and the IDB-cached bake. Useful for iterating
  visual variations.
- A "Variations" Button — generates 8 quick previews of the
  current recipe at 8 random seeds in a popover, lets the user
  pick one and commit its seed.

### 7.3 Left rail: Layers panel + Ops library

See §7.1.2. Image Lab–specific:

- The Ops library categories match §4 (Generators, Modifiers,
  Compositors, Effects, Filters, Tools).
- Each op tile has a tiny live preview (a 32×32 thumbnail showing
  the op applied to a canonical input — useful for tactile op
  discovery).

### 7.4 Center: Procedural Graph workspace

See §7.1.3. Image Lab–specific note: nodes render their preview
thumbnail at 64×64 (lower-quality fast bake) — the Live preview
panel is the high-quality at-size preview.

### 7.5 Right rail (top): Live preview pane

See §7.1.4.

### 7.6 Right rail (bottom): Node Properties inspector

See §7.1.5. Image Lab–specific:

- Param rows that animate gain a small clock icon next to the
  parameter name. Hovering it shows a tooltip "animated — 3
  keyframes". Clicking it expands the inline keyframe editor.

### 7.7 Bottom strip: Recent Bakes + Compiled Output + Export Outputs

See §7.1.6.

### 7.8 Static ↔ Animated mode toggle

A SegmentedControl in the header (§7.1.7). Switching to Animated:

- Reveals the timeline + scrubber + playback controls (§§7.9–7.10).
- Enables the inline "Animate ▾" affordance on every parameter row.
- Adds `duration` (seconds) and `frames` (int) Input fields to the
  header toolbar.
- Live Preview's "Re-bake" Button bakes the full N-frame spritesheet
  (slower than the static single-frame bake — show progress).
- The Live preview gains a scrubber + play/pause buttons.

Switching back to Static **preserves** keyframe data on parameters
in case the user toggles back; the param's static value is the
keyframe-at-t=0.0 value.

### 7.9 Timeline + keyframe editor (animated only)

When animated mode is on, a horizontal timeline panel slides up
between the workspace and the bottom strip (reducing the workspace
height by 200 px):

```
+-- Timeline (200 px tall) ----------------------------------+
| [▶] [⏸] [⏮] [⏭]  ●─────────────────── 1.20s / 2.00s  16fps |
| ─────────────────────────────────────────────────────────── |
| Tracks (one row per animated parameter):                    |
|                                                             |
| ▾ base.color           ●─────●─────────●        loop ▸     |
| ▾ ripples.uvOffset     ●─────────────────●      linear ▸   |
| ▾ highlight.threshold  ●──●──●──●──●──●──●      step ▸     |
|                                                             |
+-------------------------------------------------------------+
```

Each track:

- Left: the parameter name (`<node.id>.<param>`).
- Center: a horizontal timeline with keyframe dots positioned by
  their `t` value.
- Right: easing dropdown (applies to the next keyframe).
- Clicking a keyframe dot selects it; the dot's tooltip shows
  `(t, value, easing)`. Drag horizontally to retime. Right-click
  → Delete keyframe.
- Click empty space on a track to add a keyframe at that `t` with
  the parameter's current value.
- Tracks are reorderable; the timeline header has a "Sort by name"
  Button.

The playback controls in the timeline header drive the Live
Preview panel:

- Play / Pause / Stop.
- Step Forward / Step Back (one frame).
- Speed Slider (0.25× → 4×).
- Loop ToggleSwitch.

The current playhead is a vertical line through every track.

Multi-track edits:

- Select multiple keyframes (shift-click or marquee) → drag to
  retime them all by the same offset, or right-click → "Set easing
  → ..." to bulk-apply.

### 7.10 Frame scrubber + playback controls

For static recipes the Live Preview pane has a single re-bake
button. For animated recipes it grows a scrubber (horizontal slider
0 → `frames - 1`) and play/pause buttons that loop through the
baked frames at the recipe's nominal frameDuration. This is a
**preview** of the baked spritesheet — the same bytes the engine
will use. It does **not** re-evaluate parameters per frame at
preview time — the bake has already happened.

A "Detach preview" IconButton opens the preview in a popout window
for side-by-side comparison while iterating in the workspace.

### 7.11 Recipe list

Three placement candidates considered:

- **Inline in header** (current decision): the recipe selector
  Dropdown in the header toolbar (§7.1.7). Compact; doesn't eat
  visual real estate. Recommended.
- **As a left-most rail above Layers** (the column becomes 3-pane
  vertically split). Discoverable; eats height for users with
  20+ recipes.
- **A separate "Recipes" sub-view inside Image Lab** (a TabStrip
  within the lab — "Recipes" / "Editor"). Forces a click before
  starting work; feels like overhead.

Decision: inline in header (per §7.1.7) with a "Browse all
recipes" item at the bottom of the dropdown that opens a modal
grid view. The modal grid is the discoverable surface for users
with many recipes; the dropdown is the fast path.

Flagged in §12 Q1 for re-evaluation after first-user feedback.

---

## 8. Asset visibility across editor

Recipes are first-class assets. Every surface in the editor that
picks or displays a sprite/texture renders the **baked PNG** of a
recipe, identically to how it renders a hand-painted PNG. A small
**"IL"** badge in the corner indicates the asset is procedural.

### 8.1 Sprite picker

The Prefabs tab's Sprite component picker (per
[EDITOR_REDESIGN.md § 7.3](./EDITOR_REDESIGN.md)) shows every
sprite in the project as a thumbnail tile. Sprites backed by a
recipe (`manifest.sprites.<id>.recipe` set, not `image`) render
the baked PNG with the "IL" badge.

Right-click a recipe-backed sprite tile → context menu includes
**"Edit recipe…"** which switches the editor to the Image Lab tab
and opens the recipe.

### 8.2 Tile preset inspector

The Map tab's Cell Inspector (per [EDITOR_REDESIGN.md § 7.2](./
EDITOR_REDESIGN.md)) shows the cell's wall / floor / ceiling tile
previews. Tile-preset entries that reference a procedural recipe
(per [TILE_PRESETS.md](./TILE_PRESETS.md) — a small addition lets
preset `image:` fields accept either a path or `recipe:<id>`)
render the baked recipe output. Same "IL" badge + right-click
"Edit recipe…" affordance.

### 8.3 Prefab Sprite component picker

The Entities tab's per-prefab Sprite component (per
[EDITOR_REDESIGN.md § 7.3](./EDITOR_REDESIGN.md)) shows the current
sprite as a preview thumbnail. Procedural recipes render their
baked PNG with the IL badge.

### 8.4 Animation tab as a source

When a sprite's recipe is animated, the Animation tab can consume
it as a source for animation authoring. Specifically:

- The Animation tab's "+ New animation" flow gains a fourth source
  type: **Procedural recipe** (alongside Spritesheet / Loose frames
  / FBX from [ANIMATION_EDITOR.md § 3](./ANIMATION_EDITOR.md)).
- Selecting a procedural-recipe source binds the animation to the
  recipe's already-baked spritesheet. Frame timing comes from the
  recipe's `duration` / `frames`; the user can override per-frame
  duration but cannot edit frames (that would require re-baking
  the recipe — which they can do from Image Lab).
- Re-baking the recipe in Image Lab triggers an Animation-tab
  refresh; the existing animation entry updates to the new frame
  layout. If the frame count changed, a warning surfaces with an
  "Update frames" Button.

### 8.5 "IL" badge + right-click "Edit recipe…"

Across every surface above, the **convention is uniform**:

- A small 16-px amber-bordered chip in the bottom-right of the
  thumbnail with the letters "IL" (Image Lab).
- Right-click context menu has "Edit recipe…" at the top, above
  the standard sprite actions (Rename, Delete, etc.).
- Hovering the IL badge shows a tooltip: "Procedural — generated
  from `<recipe-id>.recipe.json`. Right-click to edit."

The badge is a small primitive (`<RecipeBadge />` — to be added
in IL5; reuses the existing Badge primitive with amber variant +
custom content).

### 8.6 Re-bake propagation

When the user saves a recipe in Image Lab:

1. Editor compute the new recipe hash.
2. Editor invalidates every IDB-cached bake under the **old** hash.
3. Every editor surface holding a stale reference (Sprite pickers,
   Map cell previews, prefab Sprite components, the
   running playtest iframe) receives a `recipe-changed`
   broadcast over the same channel the playtest iframe already
   uses for editor↔engine messaging. Consumers re-fetch the new
   baked PNG.
4. The playtest iframe surfaces a "Restart engine to apply" toast
   (atlas-reupload not in scope mid-session — same as
   ANIMATIONS.md non-goal).

This is the same invalidation pattern lightmaps already use (per
[LIGHTING_OVERHAUL.md](./LIGHTING_OVERHAUL.md) lightmap-cache
invalidation in `apps/editor/src/lib/lightmapBaker.ts`). The
recipe pipeline reuses that channel — no new broadcast surface.

---

## 9. Editor bake pipeline

The editor pre-bakes every recipe for development convenience: it
gives the user instant thumbnails everywhere, it warms the IDB
cache the engine will read from, and it ensures the user's preview
matches what ships.

### 9.1 Bake button + auto-bake on save

- **Manual**: Re-bake Button in the Image Lab header + Live
  Preview toolbar.
- **Auto-on-save**: Cmd/Ctrl+S triggers a bake before the JSON
  write completes. The user can disable auto-bake in editor
  preferences (per [EDITOR_REDESIGN.md § 12 Q2](./
  EDITOR_REDESIGN.md) — cog ≠ project settings; this is a user
  pref).

### 9.2 Web worker

Static recipes bake fast enough on the main thread (~5 ms each).
Animated recipes' multi-frame bakes take 50 ms+ — too slow to block
the UI thread. The editor uses an `OffscreenCanvas` + Web Worker
where the browser supports it.

The worker lives at `apps/editor/src/workers/bake-recipe.worker.ts`,
mirroring the existing lightmap-bake worker
(`apps/editor/src/workers/bake-lightmap.worker.ts`). It owns its
own `OffscreenCanvas` + WebGL2 context; the main thread sends in
the recipe JSON, receives back the baked PNG bytes.

Browsers without `OffscreenCanvas` (rare in 2026, but possible on
older mobile Safari) fall back to a main-thread bake with explicit
`await new Promise(r => requestAnimationFrame(r))` yields every
~16 ms — same fallback as [ANIMATION_EDITOR.md § 6.6](./
ANIMATION_EDITOR.md).

### 9.3 IDB sidecar storage

The editor stores baked PNG bytes per recipe in IDB under:

```
recipeBakes:  keyPath ["projectId", "recipeId", "seedKey"]
  {
    projectId,
    recipeId,
    seedKey: "<seedHash>",         // hashes recipe.seed + content hash
    pngBytes: Uint8Array,
    width,
    height,
    frames,
    bakedAt: number,
    bakeDurationMs: number,
  }
```

Cache reads on every recipe-thumbnail render. Cache writes after
every successful bake.

Cache is shared between editor-side previews and the engine's
runtime bake under the same IDB DB (in same-origin contexts) —
the editor warms the engine's cache by virtue of being the same
storage. In `apps/game` (the player runner), the cache is the
game's own DB; the editor's writes don't reach it. This means a
fresh page load in `apps/game` does a fresh bake — same as
lightmaps.

The lightmap cache uses a similar pattern; see #210.

### 9.4 Determinism

The editor's WebGL pipeline must produce **byte-identical** output
to the engine's at-runtime pipeline. Concretely:

- Same compiler module (`packages/engine/src/Procedural/compiler.
  ts`) imported by both.
- Same GLSL chunk library.
- Same shader compilation flags.
- Same render-target format (RGBA8, no MSAA, no mipmaps, NEAREST
  filtering).
- Same uniform-evaluation logic (seed substitution, keyframe
  evaluation).
- Same per-byte pixel readback path.

The editor MUST pass the same per-browser determinism test the
engine runs in CI (§10.3).

### 9.5 Invalidation on parameter change

The editor maintains a per-recipe IDB-cached bake. Any change to
the recipe (a parameter, a wire, an op) invalidates the cache for
that recipe — the next preview re-bakes. Invalidation is keyed by
the recipe's content hash (computed from a canonical JSON
serialization). If the user's edits land at byte-identical JSON
(e.g. a no-op change like reformatting), the hash unchanged → no
invalidation → cache hit on next render.

---

## 10. Engine-to-editor parity

### 10.1 Same compiler

Both contexts import `packages/engine/src/Procedural/compiler.ts`.
The compiler exports:

```ts
export interface CompiledRecipe {
  programSource: string;        // The assembled GLSL.
  uniformDescriptors: ...;       // What to bind.
  evaluate(params: BakeParams): BakedTexture;
}

export function compileRecipe(recipe: Recipe): CompiledRecipe;
```

The editor imports compiler.ts from `packages/engine` as a normal
intra-monorepo dependency. The engine uses the same module. The
shader source string is identical at the byte level (so pixel
output is identical at the byte level).

### 10.2 Seed governs reproducibility

A recipe's `seed` field + any `$recipe.seed` / `$instance.seed`
tokens are the only sources of "randomness." Given the same seed,
the same recipe produces the same pixels in both contexts. Same-
seed editor preview = same-seed engine runtime bake.

### 10.3 Test plan: pixel-compare

A CI test:

1. Boot a headless WebGL2 environment (e.g. via Playwright with
   chromium WebGL2 enabled, or via a node-side WebGL2 polyfill).
2. Compile + bake a canonical fixture recipe (the brick wall from
   §3.3) with seed 17.
3. Compute SHA of the RGBA8 byte array.
4. Compare against a checked-in expected SHA.

The fixture is the smoke test. Per-browser variation (§12 Q5) may
require per-browser expected SHAs or a fuzzy compare (matches
[ANIMATION_EDITOR.md § 10 Q15](./ANIMATION_EDITOR.md)'s decision
for FBX bakes). The IL2 acceptance recommends **strict equality
on the canonical browser (Chrome stable)** and a fuzzy compare
elsewhere — if integer-hash discipline is enforced (§4.7) the
strict compare should hold cross-browser, but we don't promise it
in IL2.

The fixture lives at `packages/default-pack/recipes/_smoke/_il_
smoke.recipe.json` + an adjacent `.expected.png`. The test runs in
both CI lanes (pack-builder regression + editor smoke). Drift
(compiler change, op rename, GLSL refactor) caught at PR time.

---

## 11. Phased rollout

Each phase ships independently. The phase table also lands in
PLAN.md once IL1 is approved.

### IL1 — this plan doc

Scope: this document.

Acceptance: doc reviewed; canonical decisions enumerated in
§12 as RESOLVED; cross-doc updates (EDITOR_REDESIGN.md tab list,
ANIMATIONS.md cross-ref note, SOUND_LAB.md sibling) flagged.

### IL2 — runtime engine + JSON schema + ops MVP

Scope:

- `packages/engine/src/Procedural/` — new module.
- `packages/engine/src/Procedural/types.ts` — Recipe + Node +
  AnimatedParam type definitions; `version: 1` schema.
- `packages/engine/src/Procedural/compiler.ts` — recipe → GLSL
  fragment program.
- `packages/engine/src/Procedural/ops/*` — one file per op (~25
  files for the IL2 op set per §4).
- `packages/engine/src/Procedural/bake.ts` — render-target setup,
  uniform binding, pixel readback.
- `packages/engine/src/Procedural/cache.ts` — IDB cache wrapper
  (LRU eviction, hash key).
- `packages/engine/src/AssetPack/types.ts` — extend `PackManifest`
  with `recipes: Record<string, RecipeDef>`; extend `SpriteDef`
  with optional `recipe: string`.
- `packages/engine/src/AssetPack/loadAssetPack.ts` — resolve
  `sprite.recipe` to a baked PNG before atlas upload.
- `packages/engine/src/Procedural/migrations/` — empty stub for
  future migrations.
- CLI test harness at `packages/engine/src/Procedural/__tests__/
  smoke.test.ts` — bakes the brick fixture, compares SHA.
- Default-pack ships `_il_smoke.recipe.json` + the expected PNG.

Out of scope: any editor UI.

Acceptance: a `bun test` pass that compiles the brick recipe,
bakes it via WebGL2 (headless), and pixel-compares to the
expected PNG. Plus a manual smoke: a hand-edited `manifest.recipes`
entry in default-pack renders as a sprite in `apps/game`.

### IL3 — editor tab MVP

Scope:

- `apps/editor/src/views/ImageLab/ImageLab.tsx` — top-level Image
  Lab view; mounts the 4-column shell.
- `apps/editor/src/views/ImageLab/GraphWorkspace.tsx` — node-graph
  canvas (pan/zoom/select/wire/contextual menus).
- `apps/editor/src/views/ImageLab/OpsLibrary.tsx` — left-rail Ops
  library (categorized, searchable).
- `apps/editor/src/views/ImageLab/LayersPanel.tsx` — left-rail
  Layers panel (flattened graph view).
- `apps/editor/src/views/ImageLab/NodePropertiesInspector.tsx` —
  right-rail bottom inspector.
- `apps/editor/src/views/ImageLab/LivePreview.tsx` — right-rail top
  pane with embedded `<canvas>` rendering the compiled recipe.
- `apps/editor/src/views/ImageLab/BottomStrip.tsx` — Recent Bakes
  + Compiled Output + Export Outputs.
- `apps/editor/src/views/ImageLab/RecipeStore.ts` — IDB CRUD for
  recipes (`recipes` object store) + bakes (`recipeBakes`).
- `apps/editor/src/views/ImageLab/lib/graphLayout.ts` — node
  placement, wire routing.
- `apps/editor/src/views/ImageLab/lib/dragDrop.ts` — Ops-drop
  semantics.

Scope cap: **static recipes only.** No animation, no timeline.
The Static / Animated toggle exists but disabling the Animated
side until IL4.

Acceptance: open the editor, create a new recipe, drag a `perlin-
noise` + `solid` + `blend` + `output` onto the workspace, wire
them, see the Live Preview render the result in real time, save
the recipe, see the bake appear in Recent Bakes, observe the
manifest.recipes entry written to IDB.

### IL4 — keyframes + animation timeline + spritesheet output

Scope:

- Recipe schema extension: `$keyframes` parameter shape.
- Compiler extension: keyframe evaluation per frame; spritesheet
  packing per §5.5.
- `apps/editor/src/views/ImageLab/Timeline.tsx` — multi-track
  timeline component.
- `apps/editor/src/views/ImageLab/lib/keyframes.ts` — keyframe
  arithmetic (lerp + easing).
- Live Preview gains scrubber + play/pause for animated mode.
- Static ↔ Animated toggle becomes functional.
- Sprite manifest writer outputs the `animations` block matching
  ANIMATIONS.md § 5 atlas layout.

Acceptance: open the water-shimmer recipe (§3.4), toggle Animated
mode, see the timeline with two tracks (base.color +
ripples.uvOffset), scrub through frames, save → produces a
1024×64 spritesheet that the engine consumes as a 16-frame
animation.

### IL5 — editor bake pipeline + asset visibility

Scope:

- `apps/editor/src/workers/bake-recipe.worker.ts` — OffscreenCanvas
  worker bake.
- `RecipeBadge` primitive — the IL badge across the editor.
- Sprite-picker integration — show baked previews + IL badge +
  context menu.
- Tile-preset inspector integration.
- Prefab Sprite component picker integration.
- Animation tab integration — procedural-recipe source.
- `recipe-changed` broadcast channel — wires every consumer to
  invalidation events.

Acceptance: edit a recipe in Image Lab, save it, see the baked
preview update everywhere the recipe is referenced (the cell
preview in Map, the sprite tile in Entities, etc.) within ~50 ms
of save. Right-click an IL-badged sprite → jumps to Image Lab
with the recipe loaded.

### IL6 — advanced ops + UX polish

Scope:

- Additional ops: `simplex-noise`, `worley`, `displace`, `bevel`,
  full separable blur, integer-hash noise primitive (replaces
  the IL2 `sin`-based hash — see §12 Q5).
- Recipe templates — a "+ NEW RECIPE" flow with starter templates
  (Brick Wall / Cobblestone / Water / Fire / Wood / Metal / TV
  Static / Plasma). Templates are checked-in `.recipe.json`
  examples seeded into new projects.
- Recipe library modal — the discover-all-recipes grid (§7.11).
- Recipe presets per op — saved param-bundles per op
  ("realistic-perlin-noise: octaves=4, persistence=0.55, scale=
  16").
- Variations popover (§7.2) — 8-seed gallery.
- Multi-select node edit (§12 Q2 resolution).
- Subgraph grouping (§12 Q3 resolution).
- "View GLSL" modal in Compiled Output panel.
- Performance budget enforcement: pack-builder warns at >50 nodes
  per recipe, errors at >200; warns at >200 recipes per pack.

Acceptance: usability pass — a user authors a 30-node recipe
from a template in under 5 minutes, with confident multi-select
edits + IDB-warm previews.

### IL7 — pack export + community recipes (Store integration)

Scope:

- Pack export: recipes ship as `.recipe.json` files inside the
  `.apg` (just normal pack assets — no special handling).
- A "Share to Community" Button (§7.1.6) uploading a single recipe
  + its baked preview PNG + author metadata to the cardboard Store
  (per [STORE.md](./STORE.md)).
- Store integration: browse community recipes; one-click "Add to
  project" pulls a recipe into the current project's recipes
  directory.
- Pack-only-of-recipes — Store hosts recipe-only sub-packs
  (`recipes/` plus a thin manifest); user can install via the same
  dep-chain mechanism as full packs.
- Recipe license + attribution metadata (a `license` + `author`
  block in the recipe JSON).

Acceptance: publish a recipe to Store; another user discovers it,
installs it, uses it as a tile-preset image in their map, all
without leaving the editor.

---

## 12. Open questions

Numbered for cross-reference. Each block ≤ 80 words.

1. **Q1**: Recipe list placement. §7.11 recommends inline-in-header
   dropdown + "Browse all" modal. Open: with > 30 recipes, is the
   dropdown unusable? Should there be a dedicated "Recipes" sub-
   view (TabStrip inside Image Lab)? Recommend revisit after
   first-user feedback. IL3 ships the dropdown; IL6 may add the
   modal grid.

   **RESOLVED**: Left rail, mirroring Map tab's Tile Presets layout. Consistency across editor surfaces.

2. **Q2**: Multi-select node-edit granularity. §7.1.3 hints at it; the
   model is "shared params surface." But across two `perlin-noise`
   nodes, do both get edited synchronously, or does each Node
   Properties panel show its own state alongside a shared
   "common" panel? Recommend single shared panel showing params
   present on all selected nodes; per-node panels accessible by
   single-select. IL6 polish.

   **RESOLVED**: Photoshop-style — shared properties shown, conflicting values display `(mixed)`. Lets bulk-edit while preserving uniqueness signal.

3. **Subgraphs / encapsulated groups.** Useful for reuse — a
   "wood-grain" subgraph could be inserted into multiple recipes.
   Implementation: a `subgraph` op that references an external
   recipe id; the compiler inlines the subgraph's GLSL at compile
   time. Bigger question: a Recipe Library of reusable subgraphs.
   Defer to IL6. Schema reserves `op: "subgraph"` for forward-
   compat.

4. **Q4**: Maximum nodes per recipe. Suggested: 50 nodes warn, 200
   error. Reasoning: GLSL function-count blowup, compile time,
   editor performance with the workspace. We're not GPU-bound on
   per-recipe complexity (single recipes compile in ms) so 200 is
   conservative. Plus a per-pack ceiling: 200 recipes warn, 500
   error. Confirm at IL6.

   **RESOLVED**: 50-node warn, 200-node error. Both thresholds per-pack configurable in manifest. Defaults catch runaway-graphs early.

5. **Q5**: Determinism across browsers. GLSL `sin()`-based hash
   varies in low-bit positions across drivers. Mitigation:
   IL2 hand-rolls noise via integer hashes (`pcg32`-style) so the
   output is bit-exact across drivers. The `hash-noise` op's
   current `sin`-based formulation is a known liability —
   replaces with integer-hash in IL6. Recommend IL2 ships with a
   single noise impl and per-browser fuzzy compare in CI for
   safety.

   **RESOLVED**: Hand-rolled integer hash in GLSL. `sin()`-based noise varies across GPU drivers and breaks pixel-identical determinism across machines.

6. **Materials interaction.** The materials plan (shipped)
   shaders apply hooks to entities. Procedural recipes generate
   textures. They compose: a material can sample a procedural
   texture via the standard sampler. No conflict, no special
   plumbing.

7. **Community recipe sharing.** [STORE.md](./STORE.md) currently
   covers full pack publishing. Recipe-only packs (a manifest
   with `recipes` + no scenes / sprites / sounds) are a legitimate
   sub-form — lean Yes, future, IL7. The license + attribution
   block in recipe JSON ships in IL7. Open: do we whitelist
   recipe ids to prevent collisions, or rely on pack-id-prefix
   like sprite ids?

8. **Q8**: Animated recipe frame rate. Match ANIMATIONS.md's effective
   default (1 / `frameDuration` = whatever the animation declares)
   or expose a recipe-level fps field? Recommend: recipe declares
   `frames` + `duration` per §3.1 — the implied fps = frames /
   duration. Sprite-manifest output uses that as `frameDuration =
   duration / frames`. Author can override per-animation in the
   manifest. Animation editor shows the implied fps as a stat.

   **RESOLVED**: Default 12 fps to match `ANIMATIONS.md` §5. Per-recipe `frameRate` override field allowed.

9. **Q9**: Per-instance bakes / atlas exhaustion. A recipe using `$instance.seed`
   generates unique pixels per instance — but each unique-pixel
   instance needs its own atlas slot. With 200 instances on a
   map, atlas exhaustion looms. Mitigation: per-instance bakes
   use a separate "instance atlas" with LRU eviction; or
   per-instance recipes are rare and capped at compile-time (e.g.
   max 32 unique instances per recipe). Defer concrete decision
   to IL5; capture as engineering risk.

   **RESOLVED**: Shared texture atlas with LRU eviction under memory pressure. Pack-authors get warned at recipe-count thresholds.

10. **Q10**: Editor preview vs runtime parity. The editor's
    Live Preview re-bakes at every parameter change — fast bake
    in main-thread WebGL. Is that byte-identical to the worker-
    baked output? **Yes** — same compiler, same uniforms, same
    render-target format. The Live Preview is not a "rough"
    preview; it's the same pixels the engine will use. (Contrast
    with [ANIMATION_EDITOR.md § 10 Q13](./ANIMATION_EDITOR.md)
    where preview is best-effort.)

    **RESOLVED**: Pixel-exact. Editor and engine compile recipes through the same WebGL fragment-shader generator.

11. **Q11**: Recipe IDs vs sprite IDs. A recipe is referenced from
    `manifest.sprites.<id>.recipe = "<recipe-id>"`. Should we
    allow `recipe-id == sprite-id`? Recommended yes — convention
    in default-pack is matching ids when there's a 1:1
    relationship. Helps users mental-model "this sprite IS this
    recipe." Forbidding it would force ergonomic awkwardness.

    **RESOLVED**: Shared namespace. Engine resolves IDs by checking recipe registry first, then sprites. Pack-authors can promote a recipe to a sprite without breaking references.

12. **Q12**: Shader uniforms forward-compat. A future extension —
    expose a recipe parameter as a runtime uniform rather than
    baking. Useful for "instance-color" recipes that vary per
    spawn without re-baking. Schema-reserve `param.uniform:
    true` flag; not implemented in IL2-IL5. Captures interest in
    bridging procedural recipes with the materials-plan per-variant
    uniform extension flagged in materials § 14 Q1 (see git log).

    **RESOLVED**: Reserve `uniforms?: Record<string, ShaderUniform>` field on the recipe schema now. Empty in MVP; populated when custom-shader support lands later.

13. **Editor's RecipeStore vs the engine's IDB cache.** The
    editor writes recipe JSON + baked PNGs to IDB at recipe-save
    time. The engine at pack-load reads from the same IDB cache
    (in same-origin contexts). Coordinated: yes. In `apps/game`
    (a different origin), the engine sees a cold cache and bakes
    fresh. Same trade-off as lightmaps; documented as expected.

14. **Q14**: On-disk location. Two
    options: `recipes/<id>.recipe.json` (alongside `images/`,
    `audio/`, etc.) or embedded inside the manifest as a field.
    Recommend separate files — keeps the manifest small, scales
    to 500-recipe packs, lets each recipe be edited in isolation.
    Manifest's `recipes:` map declares the file path; engine
    fetches each file at pack-load. Same convention as sprites
    referencing `image:` paths.

    **RESOLVED**: Separate files at `pack/recipes/*.recipe.json`, one recipe per file. Mirrors `prefabs/*.json` pattern; makes pack-chain overrides granular.

15. **Q15**: Undo/redo granularity. Each parameter
    change = one undo step? Each wire add/remove = one undo step?
    Recommend command-batch model: every distinct user gesture
    (drop a node, drag a wire, edit a parameter — debounced
    300 ms for sliders) is one command. IL3 ships a simple
    command stack; IL6 polishes.

    **RESOLVED**: Per-keystroke for property edits (slider drags coalesce); atomic per graph-topology change (add-node, delete-node, wire connect/disconnect).

16. **Q16**: Cross-pack recipe references. Can pack B's sprite
    reference pack A's recipe (when B depends on A)? Yes — recipes
    resolve through the pack chain like every other asset id.
    Per [PACK_CHAIN.md](./PACK_CHAIN.md) last-pack-wins, an
    override of pack A's recipe in pack B is just a
    `recipes/<same-id>.recipe.json` in pack B. Engine reports
    conflicts the same way it reports sprite-id overrides.

    **RESOLVED**: Yes — pack chain resolves recipe IDs identically to sprite IDs. Pack B can reference Pack A's recipes.

17. **Q17**: GPU memory budget for animated recipes. A pack with 50 16-frame 64×64 animated
    recipes generates 50 spritesheets at 1024×64 each = ~12 MB
    GPU memory. With the engine atlas ceiling at 1024 per side,
    each spritesheet may need its own atlas layer. The renderer
    today caps total atlas layers; we may need a soft limit
    warning at >100 atlas-resident animated recipes. Capture for
    IL5.

    **RESOLVED**: 32MB per-pack default, configurable in manifest. Upload-time warning if a pack exceeds budget.

---

## 13. Cross-references

- [IDEAS.md](../IDEAS.md) — origin entry "Procedural assets (image
  + audio recipe DSL)" (2026-05-16).
- The materials plan (shipped; see git log) — texture-sampling
  integration; recipes are texture sources; materials are
  sampler-side. §14 Q1 (per-variant uniforms) may eventually
  expose recipe-parameters as runtime uniforms.
- [ANIMATIONS.md](./ANIMATIONS.md) — animated recipes export to a
  spritesheet matching §5's atlas layout. §5 may benefit from a
  one-line note that procedural recipes are a frame source.
- [ANIMATION_EDITOR.md](./ANIMATION_EDITOR.md) — FBX-baker
  pipeline; Image Lab mirrors the editor-side baking +
  IDB-sidecar pattern from §6 and §7. Animation tab gains a
  fourth source type (procedural-recipe; per §8.4).
- [EDITOR_REDESIGN.md](./EDITOR_REDESIGN.md) — Image Lab is a top-
  level tab in the canonical 10-tab list; the shared shell in §7.1
  here aligns with §6 (shell architecture) of EDITOR_REDESIGN. The
  10-tab list should include "Image Lab" + "Sound Lab" — verify
  alignment.
- [AUDIO.md](./AUDIO.md) — sibling area; Sound Lab is the audio
  analog. The §3 manifest schema parallels AUDIO.md's
  `manifest.sounds` block.
- [PACK_CHAIN.md](./PACK_CHAIN.md) — recipes ride the same
  last-pack-wins override semantics as sprites / items / sounds.
  Conflicts surface in the existing chain-conflict report.
- [STORE.md](./STORE.md) — IL7 — community recipe sharing,
  recipe-only sub-packs.
- [TILE_PRESETS.md](./TILE_PRESETS.md) — tile-preset `image:`
  field gains a `recipe: "<id>"` alternative (per §8.2).
- [SOUND_LAB.md](./SOUND_LAB.md) — sibling lab; references §7.1
  here for the canonical shared shell.
- `apps/editor/src/views/AnimationEditor.tsx` — pattern for
  editor-side asset authoring with IDB persistence + Live preview.
- `apps/editor/src/views/BakedSpritePreview.tsx` — canvas-based
  side-by-side preview pattern (the Live preview pane mirrors
  this).
- `apps/editor/src/views/FbxImporter.tsx` — IDB caching pattern.
- `apps/editor/src/lib/lightmapBaker.ts` — worker-based bake
  pipeline + IDB cache invalidation pattern.
- `apps/editor/src/workers/bake-lightmap.worker.ts` — worker
  scaffolding template for `bake-recipe.worker.ts`.
- `packages/engine/src/AssetPack/index.ts` — pack-loading entry
  point; `loadAssetPack` extends with the recipe-resolution step
  (§6.5).

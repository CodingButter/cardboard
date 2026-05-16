# Engine / Pack split — R4: pack-shipped shaders with auto-injected uniforms

Optional, opt-in pack fragment shaders with a strict uniform
contract owned by the engine. A pack that ships **zero** shaders
works with the engine's defaults; a pack that ships custom shaders
either **replaces** engine roles, **decorates** engine roles via
hook functions, or **adds post-process passes** — never has to
author the whole pipeline.

Source-of-truth for implementation. Supersedes the R4 stub in
[ENGINE_PACK_SPLIT.md](./ENGINE_PACK_SPLIT.md#r4--pack-shipped-shaders-with-uniform-auto-injection).
Cross-refs: [PACK_CHAIN.md](./PACK_CHAIN.md),
[LIGHTING_OVERHAUL.md](./LIGHTING_OVERHAUL.md),
[ENGINE_PACK_SPLIT.md](./ENGINE_PACK_SPLIT.md),
[EDITOR.md](./EDITOR.md).

Last revised: 2026-05-15.

---

## 1. Goals & non-goals

### Goals

- **Defaults always work.** Engine ships a complete fragment
  shader set covering every render role. A pack with no `shaders`
  field renders identically to today.
- **Three composable modes**, picked per role:
  - **Mode 1 — Role replacement.** Pack ships a whole-shader body
    for any role; engine compiles it against the auto-injected
    header. Right when the pack wants a fundamentally different
    look (neon wireframe, PSX-jitter).
  - **Mode 3 — Shader hooks.** Pack overrides specific named
    functions in a Unity-surface-shader-style hook prelude;
    engine `main()` calls them at fixed extension points. Right
    for tweaks (wet floors, bluish fog, hit-flash sprites).
  - **Mode 2 — Post-process passes.** Pack adds fullscreen
    passes after the world is rendered (CRT, vignette, palette
    quantize). Right for screen-space effects.
- **Auto-injected uniforms.** Authors write only the body; the
  engine prepends `#version`, precision, every uniform, every
  varying, and a small helper library. Authors never redeclare
  what the engine provides.
- **Compile errors caught at build time.** `apps/pack-builder`
  compiles each pack shader against the engine's header before
  the `.apg` ships. Bad GLSL never reaches a player's browser.
- **Pack-chain aware.** When chained ([PACK_CHAIN.md](./PACK_CHAIN.md))
  packs each ship shaders, role replacement / hooks are last-wins
  per role/hook; post-passes append in chain order. Conflicts
  surface in the existing soft-override report.
- **Backwards compatible.** Existing packs without `shaders` /
  `postPasses` keep loading. No migration step.

### Non-goals

- **Custom vertex shaders.** Wall / sprite vertex geometry comes
  from engine-internal column textures + projected sprite quads.
  Exposing the vertex stage couples packs to internals we want to
  keep refactorable. Engine owns all vertex code. Mentioned again
  as deferred in §14.
- **Compute / SSBO / MRT / GBuffers.** Single-pass forward; one
  `vec4 outColor` per role.
- **Pack-supplied lightmap baking.** Bake
  (`packages/engine/src/Lighting/Bake.ts`, invoked from
  `apps/pack-builder/src/build-packs.ts`) stays engine-side.
  Packs can sample the
  baked lightmap; cannot replace the bake.
- **WGSL / WebGPU.** WebGL2 only.
- **Hot reload of pack shaders.** Editing a pack `.frag` requires
  `bun run build-packs` + page reload, same as content edits.
- **Mixing Mode 1 + Mode 3 on the same role in the same pack.**
  Hooks decorate the engine's `main()`; once the pack replaces
  `main()` (Mode 1) the engine has no idea where its hook call
  sites would be. The two modes are mutually exclusive per role
  per pack (§5.5).

---

## 2. Backend scope

**WebGL2 only.** Pack shaders are a WebGL feature. The canvas2d
backend (CPU pixel pusher) is unaffected.

| Pack ships | `backend = "webgl"` | `backend = "canvas2d"` |
|---|---|---|
| No shaders | engine defaults | CPU path, unchanged |
| `shaders.{role}Frag` (Mode 1) | pack shader replaces engine default | **graceful no-op** + one boot log line |
| `shaders.{role}Hooks` (Mode 3) | hook prelude rewritten + recompiled | **graceful no-op** + one boot log line |
| `postPasses[]` (Mode 2) | wired into FBO chain | **graceful no-op** + one boot log line |

The graceful-no-op rule is deliberate: a player on canvas2d
shouldn't have a pack refuse to load because of optional shader
content. Pack authors who consider their shader load-bearing set
`shadersRequiresBackend: "webgl"` (§11), which converts the no-op
into a hard error.

Boot log on canvas2d when one or more packs ship shaders:

```
[two_5_d] 4 pack(s) ship WebGL shaders ignored on canvas2d backend:
  - wet-walls.worldFrag (Mode 1)
  - shiny-floors.worldHooks (Mode 3)
  - crt-mod.postPasses[crt] (Mode 2)
  - dark-mod.postPasses[vignette] (Mode 2)
Set rendering.backend to "webgl" to enable.
```

---

## 3. Mode 1 — Role replacement

### 3.1 Manifest

```jsonc
{
  "shaders": {
    "worldFrag":  "shaders/wet-world.frag",
    "spriteFrag": "shaders/glow-sprite.frag"
    // skyFrag omitted — engine default renders the sky
  }
}
```

Each value is a path inside the pack root.

### 3.2 Role catalog

Role names match the engine's existing fragment-shader constants
in
[packages/engine/src/Renderers/WebGLRenderer.ts](../../packages/engine/src/Renderers/WebGLRenderer.ts).
The engine ships exactly three fragment roles today.

| Role | What it does in the engine today | Source | Why override |
|---|---|---|---|
| `skyFrag` | Two-color vertical gradient sky drawn first; fullscreen quad. | `FRAG_SKY_SRC` in WebGLRenderer.ts | Stars, scrolling clouds, animated nebulae, lightning, day/night cycle. |
| `worldFrag` | Entire forward-shaded world pass: walls (all 4 slabs), floors, ceilings, top/bottom caps, AO bands, reflections, static lightmap multiply, dynamic-light DDA-LOS accumulator, emissive add. Fullscreen quad — one invocation per pixel per frame. | `FRAG_WORLD_SRC` in WebGLRenderer.ts | Wet/glossy floors with custom Fresnel, neon outlines, palette quantization, animated water, custom fog. |
| `spriteFrag` | Per-pixel billboard pass: slab z-clip + lightmap sample + dynamic-light. One invocation per visible sprite quad. | `FRAG_SPRITE_SRC` in WebGLRenderer.ts | Sprite glow / outline / hit-flash / dissolve, alpha-tested rim light. |

**Why three roles, not five.** The engine's world pass doesn't
separate wall / floor / ceiling — they're all decided per-pixel
inside `FRAG_WORLD_SRC`. Splitting them is a renderer refactor,
not a pack-shader feature. The catalog mirrors the engine's actual
pipeline. If the engine later splits the world pass, `wallFrag` /
`floorFrag` roles can be added additively without breaking
existing `worldFrag` overrides.

**Registry.** A `ShaderRoleRegistry` in
`packages/engine/src/Renderers/ShaderRoleRegistry.ts` maps role →
default GLSL body + uniform contract (§6). Single source of truth
— the engine's own defaults are registry entries, identical in
shape to a pack override.

### 3.3 Resolution at load time

When a pack chain is resolved (boot):

1. For each role, pick the **last** pack in the chain that
   declares a Mode 1 override; fall back to the engine default.
2. Compile the chosen body (prepending the auto-injected header,
   §6).
3. Link with the engine's pass-through vertex shader.
4. Store the linked program in the renderer's role slot.

Chain `[default, A, B]` where B overrides `worldFrag` and C is
absent: active programs are `skyFrag = engine`, `worldFrag = B`,
`spriteFrag = engine`.

When a pack ships **both** `worldFrag` (Mode 1) and `worldHooks`
(Mode 3) for the same role, manifest validation rejects the pack
at build time (§5.5).

---

## 4. Mode 2 — Post-process passes

### 4.1 Manifest

```jsonc
{
  "postPasses": [
    { "name": "crt",      "frag": "shaders/crt.frag" },
    { "name": "vignette", "frag": "shaders/vignette.frag" }
  ]
}
```

- **`name`** — unique within the pack; used for chain
  reporting (§9.3).
- **`frag`** — path inside the pack.

### 4.2 Pipeline

Without post-passes:

```
[skyFrag] → [worldFrag] → [spriteFrag] → screen
```

With post-passes:

```
[skyFrag] → [worldFrag] → [spriteFrag] → FBO_A
                                          ↓
                                       [crt] → FBO_B
                                          ↓
                                    [vignette] → screen
```

Two ping-pong FBOs at full render resolution, swapped each pass.
The last pass writes to the default framebuffer.

Each post-pass program:
- Receives the previous color buffer as `uColor` (`sampler2D`).
- Receives the standard frame uniforms (§6.5).
- Renders to the next FBO, or to the screen on the final pass.

Single fullscreen-quad VAO, reused — same one the sky / world
passes use today.

### 4.3 Ordering

Passes run in **manifest order** within a pack. Across the chain,
passes append in chain load-order: all of pack A's passes, then
all of pack B's, etc. (§9.2).

### 4.4 HUD

The HUD canvas is a separate stacked DOM element (existing WebGL
backend behaviour). HUD composites over the final WebGL frame, so
post-passes run BEFORE the HUD — gun overlay, minimap, stats,
reticle, and inventory bar are untouched by world-space distortion.
A future `hudPostPass` role can land additively if needed; out of
scope for R4.

---

## 5. Mode 3 — Shader hooks

### 5.1 Motivation — the missing middle

Mode 1 and Mode 2 leave a gap. The gap is the **80% case**:
modders who don't want to rewrite the renderer and don't want a
screen-space filter — they want to tweak one specific behaviour
of the engine's render. Example: "make floors more reflective so
they look wet."

| Mode | What "wet floors" costs |
|---|---|
| Mode 1 | Copy the 500-line `FRAG_WORLD_SRC` + tweak one line + maintain a fork. Every engine fix has to be re-merged downstream. |
| Mode 2 | Cannot do it. The post-pass sees the final color the engine wrote; reflection is already baked in. Adding reflection requires re-running the floor math, but post-passes don't have scene textures or column data. |
| Mode 3 | Three lines. See §13.1. |

Mode 3 is the **Unity surface-shader pattern**: engine `main()`
stays engine-owned; intermediate values flow through named hook
functions with identity defaults; packs override the functions
they care about. Inlined to zero cost when unmodified.

### 5.2 Mechanism

1. Engine declares every meaningful intermediate value passes
   through a **hook function** with an identity default. The
   default just returns its input unchanged, e.g.

   ```glsl
   vec3 hook_modifyAlbedo(vec3 base, vec2 uv, int surface) { return base; }
   float hook_modifyReflectivity(float base, vec2 cellCoord, int surface) { return base; }
   // ... ~40 hooks total across the three roles
   ```

2. Engine prepends the **hook prelude** (the block of identity
   defaults) to the auto-injected header. The engine's own
   `main()` calls the hook functions at fixed call sites; an
   identity-default hook reduces to a no-op the GLSL compiler
   inlines away.

3. When a pack ships `shaders.worldHooks` (or `spriteHooks` /
   `skyHooks`), the engine:
   - Reads the pack's hook file (plain GLSL).
   - Tokenises it to extract each `hook_*` function definition.
   - **Replaces** the matching identity default in the prelude
     with the pack's version (by function name).
   - Compiles the assembled program (header + prelude + engine
     body).

4. The pack's hook file is just GLSL function definitions — no
   `main()`, no boilerplate:

   ```glsl
   // packages/my-pack/shaders/world-hooks.glsl
   float hook_modifyReflectivity(float base, vec2 cellCoord, int surface) {
     if (surface == 0) return clamp(base * 4.0, 0.0, 0.95);
     return base;
   }
   vec3 hook_modifyFogColor(vec3 base, float depth) {
     return mix(base, vec3(0.1, 0.3, 0.7), 0.6);  // bluish fog
   }
   ```

5. Engine calls hooks at fixed points inside its shader. `main()`
   is engine-controlled, hook bodies are pack-controlled. The
   shape of the algorithm (which intermediates flow into which
   composites) belongs to the engine; the values themselves are
   negotiable.

### 5.3 Manifest

```jsonc
{
  "shaders": {
    "worldHooks":  "shaders/world-hooks.glsl",
    "spriteHooks": "shaders/sprite-hooks.glsl",
    "skyHooks":    "shaders/sky-hooks.glsl"
  }
}
```

A pack can ship any subset (zero, one, two, or three hook files).
Roles not mentioned use the engine default.

### 5.4 Cross-role shared GLSL

Some effects (heat shimmer, ripples, palette tables) want
consistent logic across world + sprite. Packs can ship reusable
GLSL fragments:

```
my-pack/
└── shaders/
    ├── _shared.glsl
    ├── world-hooks.glsl
    └── sprite-hooks.glsl
```

```glsl
// shaders/_shared.glsl
float rippleAmount(vec2 worldPos, float t) {
  return sin(worldPos.x * 4.0 + t) * sin(worldPos.y * 4.0 + t) * 0.05;
}
```

Hook files reference shared code with a simple `#include`
directive:

```glsl
// shaders/world-hooks.glsl
#include "_shared.glsl"

vec3 hook_modifyFinalSurface(vec3 base, vec2 worldPos) {
  return base + vec3(rippleAmount(worldPos, /* uTime */ 0.0));
}
```

`#include` is resolved by a text-substitution preprocessor in the
engine's shader loader (and mirrored in the pack-builder
validator, §8). Rules:

- Paths are pack-root relative (no `..`, no absolute).
- Cyclic includes are rejected at load time with a clear error.
- Each file may be included at most once per assembly — duplicate
  `#include` of the same path silently dedupes (GLSL guard).

### 5.5 Mode 1 / Mode 3 exclusion per role

A pack cannot ship both `worldFrag` and `worldHooks` (and likewise
for sprite / sky). Reasoning:

- Hooks decorate the engine's `main()`. Once the pack ships its
  own `main()` via Mode 1, the engine has no idea where its hook
  call sites would land — applying the hook prelude on top of a
  pack-authored body is undefined behaviour.
- Pack-builder validation (§8) rejects the manifest with:

  ```
  shiny-walls: shaders.worldFrag and shaders.worldHooks both set.
    Mode 1 (worldFrag) and Mode 3 (worldHooks) are mutually
    exclusive for the same role. Drop one.
  ```

Across packs in a chain the rule is per-pack only: pack A may
ship `worldFrag` (full replacement) while pack B ships
`worldHooks` (hooks). In that case the hooks are dropped for that
role — they target the engine default, which pack A has replaced.
A soft warning surfaces in the conflict report (§9.4).

### 5.6 Linking model

The engine compiles a fresh role program at boot whenever any
pack contributes hooks. The assembly steps live in
`ShaderInjection.ts` (§7.2) and are roughly:

1. `headerFor(role)` — auto-injected uniforms / varyings.
2. `hookPreludeFor(role)` — identity-default hook block (§6).
3. Walk the chain front→back. For each pack with
   `shaders[${role}Hooks]` set, parse out `hook_*` definitions
   and merge into the prelude (later overrides replace earlier
   ones, per-hook).
4. Engine body (the default role's GLSL `main()` plus its
   helpers).

Final source = `1 + assembled_2 + 4`, compiled and linked.

Per-frame cost: zero net change for "no pack hooks." A pack that
overrides 5 of 38 hooks pays the cost only of those 5 function
bodies (and only at the call sites — the GLSL compiler inlines
both default and override). No dynamic dispatch.

---

## 6. Uniform contract — per role

For each role the engine guarantees a fixed set of uniforms,
varyings, and helpers. Authors don't redeclare them — the
auto-injected header (§7) provides them. The contract is
versioned with `manifest.engine` (`two_5_d@0.1`).

### 6.1 Common (all roles + post-passes)

| Type & name | Meaning |
|---|---|
| `uniform vec2 uResolution` | Render-target size in pixels. |
| `uniform float uTime` | Seconds since boot. Monotonic. |
| `uniform float uFrame` | Integer frame counter as float. |
| `uniform float uFogInv` | 1 / fog-distance. |
| `varying vec2 vUV` | Fullscreen-quad UV in `[0,1]`. `y=0` is bottom. |

### 6.2 `skyFrag`

Adds:

| Type & name | Meaning |
|---|---|
| `uniform vec3 uSkyTop` | Engine-config sky top color. |
| `uniform vec3 uSkyBottom` | Engine-config sky bottom color. |
| `uniform vec2 uCameraForward` | XY direction camera faces. Lets sky shaders rotate gradients with heading. |

Writes `vec4 outColor` (alpha=1).

### 6.3 `worldFrag`

**Camera + scene**:

| Type & name | Meaning |
|---|---|
| `uniform vec2 uSceneSize` | Scene (W, H) in cells. |
| `uniform vec2 uCamPos / uCamForward / uCamRight` | Camera world basis. |
| `uniform float uCameraZ` | Eye height `[0,1]`. |
| `uniform float uPlaneScale` | `tan(fov/2)`. |
| `uniform float uHorizonOffset` | Pitch offset in pixels. |

**Per-column DDA result textures** (col index = floor of
`gl_FragCoord.x`):

| Sampler | Format | Packing |
|---|---|---|
| `uColumns` | RGBA32F | `(perpDist, wallU, sideMul, wallTile)` per slab across Y. |
| `uColumnsSeg` | RGBA32F | `(startZ, height, segOffsetX, segOffsetY)`. |
| `uColumnsCap` | RGBA32F | `(backPerpDist, topCapTile, bottomCapTile, _)`. |
| `uColumnsCell` | RGBA32F | `(cellCenterX, cellCenterY, 0, 0)` — exact DDA hit cell. |
| `uColumnsEmissive` | RGBA32F | `(emR, emG, emB, 0)` per slab. |

**Scene grid textures**:

| Sampler | Format | Packing |
|---|---|---|
| `uSceneTiles` | RGBA32F SW×SH | `(wallTile, floorTile, ceilTile, ceilOccluder)`. |
| `uSceneRefl` | RGBA32F SW×SH | `(floorRefl, floorTrans, ceilRefl, ceilTrans)`. |
| `uSceneEmissiveFloor` | RGBA32F SW×SH | Per-cell floor emissive (premultiplied). |
| `uSceneEmissiveCeil` | RGBA32F SW×SH | Per-cell ceiling emissive (premultiplied). |
| `uTiles` | RGBA8 sampler2DArray | Tile atlas, layer = tile id. |

**Lighting** (see [LIGHTING_OVERHAUL.md](./LIGHTING_OVERHAUL.md)
§5):

| Type & name | Meaning |
|---|---|
| `uLightmapFloor` / `uLightmapCeiling` | `(W*K+1)×(H*K+1)` RGBA32F, bilinear. Separate grids — knee walls block floor but not ceiling. |
| `uniform float uLightmapResolution` | K-factor. |
| `uniform int uLightCount` | Active dynamic lights this frame. |
| `uniform vec4 uLightPos[MAX_LIGHTS]` | `(x, y, z, intensity)`. |
| `uniform vec4 uLightCol[MAX_LIGHTS]` | `(r, g, b, radius)`. |
| `#define MAX_LIGHTS 8` | Header-defined; do not hardcode. |
| `#define MAX_SLABS 4 / MAX_LOS_STEPS 16` | Header-defined. |

**Engine helper functions** (promoted to the header in S2 — see
§12; today they live inline in the default body):

| Signature | Returns |
|---|---|
| `vec3 sampleTile(int tile, vec2 uv)` | Texture-array sample. |
| `bool inBounds(ivec2 c)` | Cell in scene? |
| `bool isFloorOccluderC(ivec2 c)` / `isCeilingOccluderC(ivec2 c)` | Per-surface occluder neighbour test. |
| `vec3 sampleLightmap(vec2 worldPos, bool ceiling)` | Bilinear lookup at world pos (matches engine's per-fragment math). |
| `vec3 accumulateDynamicLight(vec2 worldPos)` | In-shader DDA-LOS + jitter dynamic-light sum (matches Phase 5 implementation). |
| `float surfaceAo(ivec2 cellCoord, vec2 frac, bool useCeiling)` | World-space AO at cell-type boundaries. |
| `float wallAo(float y, float wallTop, float wallHeight)` | Vertical AO band inside a wall slab. |

These let custom shaders correctly participate in the bake-driven
lighting pipeline without re-deriving the math. A shader that
calls `sampleLightmap(worldPos, isCeiling) +
accumulateDynamicLight(worldPos)` matches the default world frag's
lighting exactly.

**Tuning knobs** (mirror today's `u_wallAo*` etc.):

`uWallAoBotDarken / uWallAoBotBand / uWallAoTopDarken / uWallAoTopBand`,
`uFloorAoBand / uFloorAoDarken`,
`uReflTileScale / uWallReflStrength / uWallReflBand`,
`uFallbackFloor / uFallbackCeiling` (vec3).

Writes `vec4 outColor`.

### 6.4 `spriteFrag`

Extra varyings:

| Type & name | Meaning |
|---|---|
| `flat varying float vLayer` | Sprite atlas layer. |
| `flat varying float vCamY` | Camera-space depth. |
| `flat varying vec2 vWorldPos` | Sprite's world (x,y). |

Additions on top of common (and reuses `uColumns`, `uColumnsSeg`,
`uSceneTiles`, `uLightmapFloor`, `uLightmapResolution`,
`uCameraZ`, `uHorizonOffset`, `uPlaneScale`, `uSceneSize`,
`uLightCount`, `uLightPos[]`, `uLightCol[]`):

| Sampler | Format |
|---|---|
| `uSprites` | RGBA8 sampler2DArray (256×256×SPRITE_LAYERS), layer = `vLayer`. |

Helpers:

| Signature | Returns |
|---|---|
| `bool isSpriteHiddenBySlab()` | True if any closer wall slab covers this fragment (the z-clip the engine does today). Pattern: `if (isSpriteHiddenBySlab()) discard;`. |
| `vec3 sampleLightmap(vec2 worldPos, bool ceiling)` | Same as worldFrag. |
| `vec3 accumulateDynamicLightSprite(vec2 worldPos)` | One sample per sprite (matches the CPU model — LIGHTING §5.4). |

Writes `vec4 outColor` with alpha; engine's blend mode composites.

### 6.5 Post-pass uniforms

| Type & name | Meaning |
|---|---|
| `sampler2D uColor` | Previous pass's color buffer. |
| Common set | `uResolution / uTime / uFrame / uFogInv / vUV`. |
| `uniform vec2 uCamPos / uCamForward` | For view-dependent distortion. |

Post-passes are **not** given the world textures, lightmaps, or
column textures. A pass that wants scene-aware post (e.g. SSAO)
needs role replacement on `worldFrag`. Post-passes stay 2D and
cheap.

---

## 7. Hook catalog (Mode 3)

The hook catalog is the **observable surface** of Mode 3. Every
hook is a named function with an identity default; engine `main()`
routes a specific intermediate through it; a pack override
replaces the default.

**Editorial filter.** Only intermediates with clear semantic
meaning get hooks. Scratch math (the `frac` variable, unnamed
inner-loop `vec3`s, the slab-loop's `tStartZ` etc.) is omitted —
exposing those would freeze the engine's algorithm shape, not its
inputs/outputs.

The catalog totals **27 worldFrag + 8 spriteFrag + 3 skyFrag = 38
hooks**.

### 7.1 Conventions

- All hook names start with `hook_`.
- Identity defaults are inlined to zero cost. A hook returning
  `base` (its first argument) is the no-op shape.
- `surface` parameters: `0 = floor`, `1 = ceiling`, `2 = wall`,
  `3 = top cap`, `4 = bottom cap`. Lets a single hook
  discriminate between surface types without N copies.
- `int channel` parameters: `0 = floor refl`, `2 = ceiling refl`,
  matches `u_sceneRefl.r/.b`.
- `bool isCeiling` parameters: `true` when sampling ceiling
  lightmap / ceiling AO; `false` otherwise.

### 7.2 worldFrag hooks (27)

#### 7.2.1 Surface color hooks (6)

| Hook signature | What it does | Use case |
|---|---|---|
| `vec3 hook_modifyAlbedo(vec3 base, vec2 uv, int tile, int surface)` | Last chance to alter a tile sample. Called after `sampleTile`, before AO / fog. | Palette quantize, sepia tone, per-tile recolor. |
| `vec3 hook_modifyFallbackFloor(vec3 base)` | Override `uFallbackFloor` per-pixel — used when `floorTile == 0`. | Procedural floor checkerboard for untextured cells. |
| `vec3 hook_modifyFallbackCeiling(vec3 base)` | Same for `uFallbackCeiling`. | Procedural sky-substitute when ceiling tile is missing. |
| `vec3 hook_modifyWallColor(vec3 base, int wallTile, float wallU, float sideMul, float perpDist)` | Tweak the wall-only color produced by `wallPixelAt` before AO / fog / reflective fade. | Wall outline, neon edges, wallU-driven scrolling tint. |
| `vec3 hook_modifyCapColor(vec3 base, int capTile, vec2 capWorld, bool isTop)` | Tweak top-cap / bottom-cap color before fog. | Wet-edge highlight on parapets, color caps differently from walls. |
| `vec3 hook_modifySurfaceColor(vec3 base, int surface, vec2 worldPos)` | Last surface-color hook BEFORE static + dynamic light multiply. Single chokepoint regardless of which surface won. | Global desaturate, color filter without changing lighting. |

#### 7.2.2 Reflection hooks (4)

| Hook signature | What it does | Use case |
|---|---|---|
| `float hook_modifyReflectivity(float base, vec2 cellCoord, int surface)` | Per-pixel reflectivity scalar fed into the `mix` between surface and reflection. Called after `effectiveReflectiveness` blend. | **Wet floors** (§13.1). Animated puddles via `sin(time)`. |
| `vec3 hook_modifyReflectionColor(vec3 base, int surface, vec2 worldPos)` | Tint the reflected color (wall mirror or tiled cross-reflection) before mixing. | Greenish cracked-mirror look; haunted-house red. |
| `vec3 hook_modifyTiledReflection(vec3 base, vec2 tiledUv, int sampledTile)` | Tweak the tiled cross-reflection fallback (when no wall mirror brackets the mirrored y). | Swirly stylised reflection. |
| `float hook_modifyWallReflFade(float base, float fadeT, int slabIndex)` | Modify the reflective-wall fade near the top/bottom of the nearest slab. `fadeT` is the band-distance in [0,1]. | Sharper or wider wet-edge fade. |

#### 7.2.3 Lighting hooks (5)

| Hook signature | What it does | Use case |
|---|---|---|
| `vec3 hook_modifyStaticLight(vec3 base, vec2 worldPos, bool isCeiling)` | Tweak the static-lightmap sample before adding dynamic. | Boost lightmap contrast, posterise. |
| `vec3 hook_modifyDynamicLight(vec3 base, vec2 worldPos)` | Tweak the accumulated dynamic-light sum. | Tinted torch flicker, scary red-only nightvision. |
| `float hook_modifyLightAttenuation(float base, vec3 lightPos, vec2 worldPos, float radius, float intensity)` | Per-light attenuation override — called once per active dynamic light. `base` is `t*t*intensity*coverage` from the engine. | Linear falloff instead of quadratic; sharper hot spot. |
| `float hook_modifyLightCoverage(float base, vec3 lightPos, vec2 worldPos)` | Soft-shadow coverage scalar in [0,1]. Engine computes 3-sample average; this is the last word. | Hard-shadowed lights (`return base > 0.5 ? 1.0 : 0.0;`). |
| `vec3 hook_modifyLightColor(vec3 base, int lightIndex)` | Modify a light's color before attenuation multiplies. | Red-on-alert effect, light-by-id colour swap. |

#### 7.2.4 AO hooks (4)

| Hook signature | What it does | Use case |
|---|---|---|
| `float hook_modifyWallAo(float base, float y, float wallTop, float wallHeight)` | Adjust the wall AO band multiplier. | Disable wall AO, invert top/bottom emphasis. |
| `float hook_modifySurfaceAo(float base, ivec2 cellCoord, vec2 frac, bool useCeiling)` | Adjust the world-space floor/ceiling boundary AO. | Soften contact shadows in lit areas. |
| `bool hook_isOccluder(bool base, ivec2 cellCoord, bool useCeiling)` | Override the occluder predicate used by AO neighbour tests. | Mark certain tiles as transparent for AO. |
| `float hook_modifyAoCombined(float base, int surface, vec2 worldPos)` | Final AO scalar after surface AO + wall AO merged. | Global AO strength dial keyed to time of day. |

#### 7.2.5 Fog hooks (3)

| Hook signature | What it does | Use case |
|---|---|---|
| `float hook_modifyFogMul(float base, float depth)` | Override the fog multiplier (engine default: `clamp(1 - depth*uFogInv, 0, 1)`). | Cubic falloff, exponential fog, height-fog. |
| `vec3 hook_modifyFogColor(vec3 base, float depth)` | Tint the fog. Engine default returns `base` unchanged (fog is a multiplier, not a color blend). Modders can switch to additive fog by returning a non-zero color and lerping in `hook_modifyFinalSurface`. | Bluish underwater fog (§13.1.2). |
| `float hook_modifyDepth(float base, vec2 worldPos)` | Last chance to alter the depth scalar fed into fog. | Height-fog (cheaper than per-pixel z reconstruction): blend in `worldPos.y`. |

#### 7.2.6 Emissive hooks (2)

| Hook signature | What it does | Use case |
|---|---|---|
| `vec3 hook_modifyEmissive(vec3 base, int surface, vec2 worldPos)` | Tweak the per-surface emissive add (from `uSceneEmissiveFloor` / `Ceil` / `Columns`). | Pulse glow, time-of-day brightness, color-shift emissive. |
| `vec3 hook_addEmissive(vec3 base, vec2 worldPos, int surface)` | ADD an additional emissive contribution on top of the engine's. Useful for procedural glows that aren't in the bake. | Animated firefly trails; player-position halo. |

#### 7.2.7 Final composite hooks (3)

| Hook signature | What it does | Use case |
|---|---|---|
| `vec3 hook_modifyFinalSurface(vec3 base, vec2 worldPos, int surface)` | Last hook BEFORE the lightmap multiply. (vs `_modifyAlbedo` which is per-sample.) | Apply global colour grade, dithered banding. |
| `vec3 hook_modifyFinalColor(vec3 base, vec2 worldPos, int surface)` | Absolute final color hook. Called on the engine's `surfaceColor * (static + dynamic) + emissive` result. | Vignette, tonemap, palette quantize as a hook instead of post-pass. |
| `float hook_modifyFinalAlpha(float base, int surface)` | Override `outColor.a`. Engine default is 1.0 for opaque world. | Translucent world for ghost-mode overlay. |

### 7.3 spriteFrag hooks (8)

#### 7.3.1 Surface + alpha hooks (3)

| Hook signature | What it does | Use case |
|---|---|---|
| `vec4 hook_modifySpriteSample(vec4 base, vec2 uv, int layer)` | Tweak the raw `texture(u_sprites, ...)` result. Includes alpha. | Per-layer recolor, alpha-test bias, channel swap. |
| `float hook_modifySpriteAlpha(float base, vec2 uv, int layer)` | Alpha-only convenience hook for fades. | Dissolve effect (`base * smoothstep(...)`), hit-flash flicker. |
| `vec3 hook_modifySpriteColor(vec3 base, vec2 uv, int layer, vec2 worldPos)` | Pre-lighting sprite color. | Layer-specific tint (enemy = red), per-sprite outline. |

#### 7.3.2 Lighting + composite hooks (3)

| Hook signature | What it does | Use case |
|---|---|---|
| `vec3 hook_modifySpriteStaticLight(vec3 base, vec2 worldPos)` | Adjust sprite's static-lightmap contribution. | Sprites always rendered brighter than floors (gameplay clarity). |
| `vec3 hook_modifySpriteDynamicLight(vec3 base, vec2 worldPos)` | Adjust sprite's dynamic-light contribution. | Glowing sprites: add self-light independent of dynamic-light list. |
| `vec3 hook_modifySpriteFinalColor(vec3 base, int layer, vec2 worldPos)` | Last RGB hook before alpha composite. | Hit-flash white-out, rim light, additive outline. |

#### 7.3.3 Discard / clip hooks (2)

| Hook signature | What it does | Use case |
|---|---|---|
| `bool hook_shouldDiscardSprite(bool base, vec2 uv, int layer, vec2 worldPos)` | Override discard logic (engine default: `tex.a <= 0.001 \|\| isSpriteHiddenBySlab()`). | Stencil-style dithered transparency, alpha-test threshold. |
| `float hook_modifySpriteFog(float base, float camDepth)` | Per-sprite fog multiplier. | Sprites less fog-affected than world (gameplay readability). |

### 7.4 skyFrag hooks (3)

| Hook signature | What it does | Use case |
|---|---|---|
| `vec3 hook_modifySkyTop(vec3 base, vec2 uv)` | Override `uSkyTop` per-pixel. | Stars, animated nebulae, time-of-day shift. |
| `vec3 hook_modifySkyBottom(vec3 base, vec2 uv)` | Override `uSkyBottom` per-pixel. | Horizon glow, sunrise gradient. |
| `float hook_modifySkyGradient(float base, vec2 uv)` | Override the top/bottom blend factor. Engine default is `step(0.5, uv.y)` (hard split); a hook can return `smoothstep(0.4, 0.6, uv.y)` for a soft horizon. | Smooth gradient sky, animated horizon line. |

### 7.5 Hook catalog summary

| Category | World | Sprite | Sky | Total |
|---|---:|---:|---:|---:|
| Surface color | 6 | 3 | — | 9 |
| Reflection | 4 | — | — | 4 |
| Lighting | 5 | 3 | — | 8 |
| AO | 4 | — | — | 4 |
| Fog | 3 | 1 | — | 4 |
| Emissive | 2 | — | — | 2 |
| Discard / clip | — | 1 | — | 1 |
| Final composite | 3 | — | — | 3 |
| Sky gradient | — | — | 3 | 3 |
| **Total** | **27** | **8** | **3** | **38** |

### 7.6 Engine call-site map (informative)

The engine `main()` calls hooks at fixed points. This map is
informative — packs don't see it directly — but documents the
order so the catalog's semantics are reproducible.

**worldFrag pseudocode** (engine-owned, hook calls shown):

```
albedo = sampleTile(...);
albedo = hook_modifyAlbedo(albedo, uv, tile, surface);
if (fallback) albedo = hook_modifyFallbackFloor(albedo) | _modifyFallbackCeiling(...);

wallColor = wallPixelAt(...);
wallColor = hook_modifyWallColor(wallColor, ...);

capColor = sampleTile(capTile, ...);
capColor = hook_modifyCapColor(capColor, ...);

surfaceColor = (depends on which surface won);
surfaceColor = hook_modifySurfaceColor(surfaceColor, surface, worldPos);

refl = effectiveReflectiveness(...);
refl = hook_modifyReflectivity(refl, cellCoord, surface);
reflColor = hook_modifyReflectionColor(reflColor, surface, worldPos);
// inside tiled-reflection fallback:
tiledRefl = hook_modifyTiledReflection(tiledRefl, tiledUv, sampledTile);
// inside wall reflective fade:
fadeT = hook_modifyWallReflFade(fadeT, ..., slabIndex);
surfaceColor = mix(surfaceColor, reflColor, refl);

aoWall = wallAo(...);  aoWall = hook_modifyWallAo(aoWall, ...);
aoSurf = surfaceAo(...); aoSurf = hook_modifySurfaceAo(aoSurf, ...);
aoFinal = hook_modifyAoCombined(aoSurf * aoWall, surface, worldPos);
surfaceColor *= aoFinal;

depth = hook_modifyDepth(perpDist, worldPos);
fogMul = clamp(1 - depth * uFogInv, 0, 1);
fogMul = hook_modifyFogMul(fogMul, depth);
fogColor = hook_modifyFogColor(vec3(0), depth);  // identity default = no additive fog
surfaceColor = mix(surfaceColor, fogColor, 1.0 - fogMul) * fogMul;  // or just *= when default

surfaceColor = hook_modifyFinalSurface(surfaceColor, worldPos, surface);

staticL = sampleLightmap(...);   staticL = hook_modifyStaticLight(staticL, worldPos, isCeiling);
dynL    = accumulateDynamicLight(...); dynL = hook_modifyDynamicLight(dynL, worldPos);
// (per-light hooks _modifyLightColor / _modifyLightCoverage / _modifyLightAttenuation
//  are called inside accumulateDynamicLight)

emissive = sampleEmissive(...);  emissive = hook_modifyEmissive(emissive, surface, worldPos);
emissive += hook_addEmissive(vec3(0), worldPos, surface);

final = surfaceColor * (staticL + dynL) + emissive;
final = hook_modifyFinalColor(final, worldPos, surface);
alpha = hook_modifyFinalAlpha(1.0, surface);
outColor = vec4(final, alpha);
```

`hook_isOccluder` is called inside `surfaceAo` and the AO
neighbour predicate; not strictly main() but listed for
completeness.

The implementer of S3 may move a hook call site by one or two
lines to match the actual engine source as long as the documented
semantics hold (e.g. "modify fog before lightmap multiply"
remains true). Major restructuring of the call-site map (e.g.
moving `_modifyFinalSurface` to after the lightmap multiply)
needs a doc update.

---

## 8. Auto-injected header

### 8.1 Mechanics

Per role, the engine prepends a generated header to each
pack-shipped shader before compilation. Authors write only the
body — `main()` (Mode 1), helpers (Mode 1), or hook overrides
(Mode 3).

```
finalSrc =
  "#version 300 es\n" +
  "precision highp float;\n" +
  "precision highp sampler2DArray;\n" +
  generateDefines(role) +     // MAX_LIGHTS, MAX_SLABS, etc.
  generateUniformBlock(role) +
  generateVaryingBlock(role) +
  "out vec4 outColor;\n" +    // role + post-pass both
  generateHelperBlock(role) +
  hookPrelude(role, hookOverrides) +   // Mode 3 (S3+)
  "// ==== user body begins ====\n" +
  userBodyOrEngineDefault
```

`generate*` read from the `ShaderRoleRegistry` (§3.2).
`hookPrelude` is the assembled hook block from §5.6.

### 8.2 Module

A new module
`packages/engine/src/Renderers/ShaderInjection.ts` exports:

```ts
// Header + helpers — S1 (today's shaderHeaders.ts moves here).
export function headerFor(role: ShaderRole): string;

// Hook prelude — S3. Identity defaults for every catalogued hook.
export function hookPreludeFor(role: ShaderRole): string;

// Final assembly — S3. Reads pack hooks, substitutes into prelude,
// produces compile-ready source.
export function assembleShaderSource(
  role: ShaderRole,
  pack: AssetPack | undefined,
  engineBody: string,
): Promise<string>;

// Mode 1 only — S1.
export function buildFragmentSource(
  role: ShaderRole | "postPass",
  userBody: string,
): string;
```

`WebGLRenderer` calls these for every role at boot. The engine's
own default bodies flow through the same functions — there's no
separate path for engine vs. pack. Default `worldFrag` becomes
"the default `engineBody` for role `worldFrag`". Keeps the
contract honest.

### 8.3 Hook-substitution algorithm

Pseudocode for `assembleShaderSource` Mode 3 path:

```ts
const prelude = hookPreludeFor(role);             // identity defaults
const overrides = new Map<string, string>();      // hookName -> body
for (const pack of chain) {
  const hooksPath = pack.manifest.shaders?.[`${role}Hooks`];
  if (!hooksPath) continue;
  let body = await pack.textBody(hooksPath);
  body = resolveIncludes(body, pack);            // §5.4
  for (const fn of parseHookFunctions(body)) {
    overrides.set(fn.name, fn.source);           // last pack wins per-hook
  }
}
const assembledPrelude = substituteHooks(prelude, overrides);
return header + assembledPrelude + engineBody;
```

`parseHookFunctions` matches function definitions whose name
starts with `hook_`:

```
^\s*\w+\s+(hook_\w+)\s*\([^)]*\)\s*\{
```

then balances braces to find the closing `}`. For v1 this is a
hand-rolled brace counter over a single pass through the source;
it tolerates GLSL comments (`//` and `/* */`) and string-free
GLSL. Edge cases (preprocessor `#define` of a hook name) are
rejected at validation (§8) with a clear error.

`substituteHooks` finds the identity-default definition in the
prelude by name and replaces its `{ … }` body with the override's
body. Signatures must match exactly — mismatched signatures are
rejected at validation.

### 8.4 What the author CANNOT write

- `#version` or `precision` qualifiers (header).
- `out vec4 outColor;` (header).
- Any uniform / varying / `#define` in the role's contract — GLSL
  "duplicate declaration" error. The build-time validator (§9)
  catches this and rewrites the error to the author's source
  line.
- A `main()` function in a `*Hooks.glsl` file (Mode 3) — rejected
  with the message "hook files contain only `hook_*` function
  definitions and `#include` directives."

---

## 9. Build-time validation

### 9.1 Where

`apps/pack-builder/src/validate-shaders.ts` (new), invoked from
`build-packs.ts` after manifest parse, before zipping.

### 9.2 What

For each path in `manifest.shaders` and `manifest.postPasses`:

1. Read the user body. For Mode 3, resolve `#include` directives
   (§5.4).
2. Resolve the role's header + hook prelude from
   `ShaderRoleRegistry` (imported from
   `packages/engine/src/Renderers/ShaderRoleRegistry.ts`).
3. Validate Mode 1 / Mode 3 exclusion per role (§5.5).
4. For Mode 3: parse hook function definitions; check every
   `hook_*` name exists in the role's catalog (§7) and the
   signature matches exactly. Reject unknown hook names with a
   "did you mean" suggestion against the catalog.
5. Run `assembleShaderSource()` — same function used at runtime.
6. Compile the combined source in a headless WebGL2 context.
7. On compile failure, parse the GLSL error log, subtract the
   header's line count, and emit:

   ```
   wet-walls: shaders/wet-world.frag: line 14
     error: undeclared identifier 'baldwin'
        outColor = vec4(baldwin, 1.0);
                        ^
   ```

8. Build refuses to zip the pack on any failure. Exit code 1.

### 9.3 Headless GL choice

| Option | Pros | Cons |
|---|---|---|
| `headless-gl` (native bindings, node-gyp) | Real GLSL compiler — exact runtime parity. | Native build; tricky on Bun + ARM (dev box is a Pi). |
| Pure-JS GLSL parser (e.g. `glsl-parser`) | No native deps. | Syntax only — misses semantic errors like undeclared identifiers. |
| Headless Chromium via Puppeteer | Real GL. | Heavy, slow CI. Reject. |

**Decision**: try `headless-gl` first. If `bun add` fails on the
target, fall back to the pure-JS parser and log a one-time
warning that semantic errors won't be caught at build time. The
runtime WebGL compile is the final safety net — worst case, the
player sees the error instead of the modder.

### 9.4 Manifest validation

- Every key in `shaders` must be a catalog role-variant
  (`{role}Frag` or `{role}Hooks`). Unknown → hard error with a
  "did you mean" suggestion.
- Mode 1 + Mode 3 same role same pack → hard error (§5.5).
- Every `postPasses[].name` is unique within the pack.
- Every path exists inside the pack tree.
- Hook file's `#include` paths resolve inside the pack.

---

## 10. Pack-chain interaction

Cross-ref: [PACK_CHAIN.md](./PACK_CHAIN.md) §6 (conflict
detection), §7 (override rules).

### 10.1 Role replacement (Mode 1) — last-wins

Chain `[default, A, B]` where both A and B declare
`shaders.worldFrag`: B wins. Conflict report (added in PACK_CHAIN
P2) records:

```ts
{ asset: "shaders.worldFrag", winnerPack: "B", overriddenPacks: ["A"] }
```

Surfaced in Settings → Packs panel's Overrides column.

### 10.2 Shader hooks (Mode 3) — last-wins per hook

Chain `[default, A, B]` where both A and B declare
`shaders.worldHooks`. The packs are combined hook-by-hook:

- Pack A overrides `hook_modifyReflectivity` and
  `hook_modifyFogColor`.
- Pack B overrides `hook_modifyReflectivity` and
  `hook_modifyStaticLight`.
- Result: pack B's `hook_modifyReflectivity` wins (last wins for
  same hook); pack A's `hook_modifyFogColor` is kept; pack B's
  `hook_modifyStaticLight` is kept.

**No chaining of hooks.** When two packs override the same hook,
the later one fully replaces the earlier — there's no "call
super" mechanism. Matches Mode 1's simplicity rule. Avoids
implicit ordering semantics that confuse modders.

Conflict report per-hook collision:

```ts
{
  asset: "shaders.worldHooks::hook_modifyReflectivity",
  winnerPack: "B",
  overriddenPacks: ["A"]
}
```

A pack ships Mode 1 `worldFrag` and another pack ships Mode 3
`worldHooks` for the same role:

- If Mode 1 is at a higher (later) chain position than Mode 3,
  the hooks are silently dropped (target shader doesn't exist).
- If Mode 3 is later than Mode 1 in the chain, the hooks still
  do not apply — they target the engine default, which Mode 1 is
  replacing. The conflict reporter surfaces a **warning**:

  ```
  shaders.worldHooks (pack: shiny-floors) ignored because
  pack 'neon-mod' overrides worldFrag (Mode 1) earlier in the
  chain. Drop one or reorder.
  ```

This is the only chain-resolution rule that needs to flag
cross-mode interactions. It surfaces in console + Settings →
Packs (per PACK_CHAIN.md).

### 10.3 Post-passes (Mode 2) — append in load order

```
main render → [A.pass1] → [A.pass2] → [B.pass1] → [B.pass2] → screen
```

This is the only override rule that ISN'T last-wins. Extends
PACK_CHAIN §7's table with new rows (parent will edit when this
lands):

| Asset | Identity | Merge |
|---|---|---|
| `shaders.<role>Frag` | role | **replace** (last wins) |
| `shaders.<role>Hooks` | role + hook name | **replace per hook** (last wins) |
| `postPasses[]` | chain order | **concatenate** |

### 10.4 Post-pass name collision

If `crt-mod` and `extra-fx` both ship `postPasses: [{ name: "crt" }]`,
both run; the chain has two passes named `crt`. A soft warning is
emitted so the modder can rename if unintentional. We don't dedupe
by name — two CRT passes is a valid stylistic choice. A future
"override post-pass by name" feature is out of scope here.

### 10.5 Backend mismatch in a chain

If any pack in the chain ships shaders/hooks AND the resolved
backend is canvas2d, all shader / hook / post-pass entries from
every pack are ignored with the consolidated log shown in §2.

---

## 11. Engine implementation sketch

```
packages/engine/src/Renderers/
├── ShaderRoleRegistry.ts        EXISTS — role catalog (S1)
├── shaderHeaders.ts             EXISTS — auto-injected header (S1)
├── ShaderInjection.ts           NEW — assembleShaderSource() (S3),
│                                       buildFragmentSource() (S1)
├── HookPrelude.ts               NEW (S3) — identity defaults per role
├── HookParser.ts                NEW (S3) — parse / substitute hook bodies
├── PostPassChain.ts             NEW (S4) — FBO ping-pong runner
├── WebGLRenderer.ts             MODIFIED — load programs from registry;
│                                            FRAG_* constants become registry
│                                            defaults
└── SceneRenderer.ts             unchanged (interface)

packages/engine/src/AssetPack/
└── types.ts                     MODIFIED — PackManifest gains
                                   shaders?: Partial<Record<ShaderRole | `${ShaderRole}Hooks`, string>>
                                   postPasses?: PostPassDef[]
                                   shadersRequiresBackend?: "webgl"

apps/pack-builder/src/
├── validate-shaders.ts          NEW — build-time compile pass
└── build-packs.ts               MODIFIED — invokes validate-shaders before zip

apps/game/setup-plugins.ts       UNCHANGED — its GLSL bundler plugin still
                                   bundles ENGINE shader strings into the TS
                                   build. Pack shaders are runtime assets,
                                   loaded via AssetPack.textBody(path) — the
                                   same way scenes and configs are loaded.
                                   Two separate codepaths; neither cares about
                                   the other.
```

**Boot sequence** (additions in **bold**):

1. `loadPackChain(urls)` — fetch + index every pack.
2. `applyConfigOverride` — merge configs.
3. Render backend chosen.
4. **If WebGL: for each role in `ShaderRoleRegistry`, walk chain
   last→first; first pack with `shaders[${role}Frag]` declared
   wins; else use engine default body. Read body via
   `pack.textBody`.**
5. **For the same role, walk the chain front→back collecting
   `shaders[${role}Hooks]`; merge per-hook into the prelude
   (last wins per hook).**
6. **`assembleShaderSource(role, hookOverrides, body)` →
   compile → link.**
7. **Collect `postPasses[]` from every pack in chain order. Build
   FBO chain via `PostPassChain.build()`.**
8. Renderer ready; scene loads; first frame.

Per-frame cost: zero net change for "no pack shaders." One
program switch + FBO swap per active post-pass. Hook overrides
inline at compile time — no runtime cost beyond the override's
own work.

---

## 12. Manifest schema additions

Adds to `PackManifest` (existing type at
[packages/engine/src/AssetPack/types.ts:176](../../packages/engine/src/AssetPack/types.ts)):

```jsonc
{
  // ...existing fields...
  "shaders": {
    // Mode 1 — role replacement.
    "skyFrag":     "shaders/aurora-sky.frag",
    "worldFrag":   "shaders/wet-world.frag",
    "spriteFrag":  "shaders/glow-sprite.frag",

    // Mode 3 — shader hooks. Mutually exclusive per-pack with the
    // matching Frag entry.
    "worldHooks":  "shaders/world-hooks.glsl",
    "spriteHooks": "shaders/sprite-hooks.glsl",
    "skyHooks":    "shaders/sky-hooks.glsl"
  },
  "postPasses": [
    { "name": "crt",      "frag": "shaders/crt.frag" },
    { "name": "vignette", "frag": "shaders/vignette.frag" }
  ],
  // OPTIONAL: when present, refuse to load on canvas2d instead of
  // gracefully ignoring shader content. Default: omitted (graceful).
  "shadersRequiresBackend": "webgl"
}
```

TypeScript:

```ts
export type ShaderRole = "skyFrag" | "worldFrag" | "spriteFrag";
export type ShaderHookRole = "skyHooks" | "worldHooks" | "spriteHooks";
export type ShaderEntry = ShaderRole | ShaderHookRole;

export interface PostPassDef {
  name: string;   // unique within pack
  frag: string;   // path inside pack
}

export interface PackManifest {
  // ...existing fields...
  shaders?: Partial<Record<ShaderEntry, string>>;
  postPasses?: PostPassDef[];
  shadersRequiresBackend?: "webgl";
}
```

`ShaderRole` and `ShaderHookRole` live in `ShaderRoleRegistry.ts`
and are re-exported from `AssetPack/types.ts` for manifest typing.

---

## 13. Worked examples

Two examples that show the modes side by side. Together they
illustrate that Mode 1 and Mode 3 are complementary, not
redundant — Mode 3 lands the 80% case in three lines; Mode 1
exists for the long tail of fundamentally different looks.

### 13.1 Wet floor via hooks (Mode 3)

The motivating case: "make floors more reflective so they look
wet." Three lines of GLSL.

```
shiny-floors.apg/
├── manifest.json
└── shaders/
    └── world-hooks.glsl
```

**manifest.json**

```jsonc
{
  "id": "shiny-floors",
  "name": "shiny-floors",
  "version": "0.1.0",
  "engine": "two_5_d@0.1",
  "requires": [{ "id": "default", "version": "^0.2.0" }],
  "shaders": { "worldHooks": "shaders/world-hooks.glsl" }
}
```

**shaders/world-hooks.glsl** — the entire pack-supplied GLSL:

```glsl
float hook_modifyReflectivity(float base, vec2 cellCoord, int surface) {
  if (surface == 0) return clamp(base * 4.0, 0.0, 0.95);
  return base;
}
```

The pack ships ~150 bytes of GLSL + a 200-byte manifest. The
engine inlines the override into its world shader; floors with
nonzero reflectivity bake (any scene the level designer marked as
"a little shiny") now look soaking wet, capped at 0.95 so the
reflection doesn't blow out completely opaque mirrored. Ceilings,
walls, and caps are untouched.

#### 13.1.2 Bluish underwater fog (Mode 3, optional combine)

Adding a second hook to the same file — still Mode 3, still no
boilerplate:

```glsl
float hook_modifyReflectivity(float base, vec2 cellCoord, int surface) {
  if (surface == 0) return clamp(base * 4.0, 0.0, 0.95);
  return base;
}
vec3 hook_modifyFogColor(vec3 base, float depth) {
  return vec3(0.1, 0.3, 0.7);   // bluish additive fog
}
```

The engine's default `hook_modifyFogColor` returns its input
unchanged (engine fog is a multiplier). A pack overriding it
toggles fog into an additive blend at the engine's call site —
without touching anything else.

### 13.2 Neon wireframe walls via role replacement (Mode 1)

When a pack wants a fundamentally different look — neon outlines
on every wall edge, glow bleeding into floors, palette
quantization on the whole frame — the algorithm shape itself
needs to change. No collection of hook overrides will do it,
because the engine's `main()` doesn't know about edge detection
or palette quantization at all.

```
neon-mod.apg/
├── manifest.json
└── shaders/
    └── neon-world.frag
```

**manifest.json**

```jsonc
{
  "id": "neon-mod",
  "name": "neon-mod",
  "version": "0.1.0",
  "engine": "two_5_d@0.1",
  "requires": [{ "id": "default", "version": "^0.2.0" }],
  "shaders": { "worldFrag": "shaders/neon-world.frag" }
}
```

**shaders/neon-world.frag** (conceptual sketch, ~300 lines in
practice):

```glsl
// Header injects every uniform / varying / helper from §6.3.

void main() {
  // 1. Per-pixel cell + frac (same as engine).
  // 2. Run an edge-detector against u_sceneTiles neighbors.
  // 3. Composite wall body as flat black; edges glow uSkyTop.
  // 4. Quantize result to a 16-color palette.
  outColor = vec4(/* edge-glow + palette-quantized */, 1.0);
}
```

This is the long-tail case Mode 1 owns: the modder is replacing
the whole forward-shading model. Hooks couldn't express it
because the engine's call sites (modify-albedo, modify-fog, etc.)
assume a recognisable forward-shaded structure that the neon
look discards.

### 13.3 Why the two modes coexist

| | Mode 3 (hooks) | Mode 1 (role replacement) |
|---|---|---|
| Pack-supplied GLSL size | ~3 lines per override | ~300+ lines per role |
| Engine-update resilience | Hooks survive engine refactors; identity defaults mean a removed hook degrades to "no effect" | Pack maintains a fork; every engine bug-fix has to be re-merged downstream |
| Right for | Tweaks, parameter changes, additive effects | Fundamentally different rendering models |

---

## 14. Phases

R4 splits into six shippable steps. Each leaves the engine
working on its own. **S1, S2, S3, and S4 have shipped** (commits
`0a7fe16`, `c02d280`, `c02d280`, `dd2063c` respectively). S5
(validation) and S6 (pack-chain conflict resolution) remain.

### S1 — Role replacement, no validation, single pack (DONE)

- Add `ShaderRoleRegistry.ts` (registry seeded with engine
  defaults).
- Add `shaderHeaders.ts` (auto-injected header per role).
- Refactor `WebGLRenderer` to load each role from the registry —
  default bodies stay byte-identical to today.
- Add `manifest.shaders` to `PackManifest`.
- Boot: if WebGL backend AND pack declares `shaders[role]`, read
  via `pack.textBody`, compile, link.
- Console-log + graceful no-op on canvas2d.
- Smoke test: ship a tiny `worldFrag` override behind a flag in
  the default pack; verify it renders.

Deliverable: single-pack Mode 1 role override works.
Status: shipped (commit `5907c21` + follow-ups).

### S2 — Promote engine helpers + defines to the auto-injected header — ✅ Shipped (commit `c02d280`)

Prerequisite for both Mode 1 ergonomics and Mode 3 hook bodies
(hooks want to call helpers like `sampleTile` and
`sampleLightmap`).

- Move `sampleTile`, `inBounds`, `isFloorOccluderC`,
  `isCeilingOccluderC`, `sampleLightmap`, `accumulateDynamicLight`,
  `wallAo`, `surfaceAo` out of the inline default world body into
  the header.
- Likewise sprite helpers (`losClearSprite`, dynamic-light loop
  factored as `accumulateDynamicLightSprite`).
- Header gets `#define MAX_LIGHTS / MAX_SLABS / MAX_LOS_STEPS /
  LIGHT_JITTER_SAMPLES` consistently across all roles.
- Engine default body becomes ~150 lines shorter, since shared
  helpers are now in the header.
- Visual-regression: rendered frames byte-identical to S1.
- Smoke test: a Mode 1 `worldFrag` body that JUST calls
  `accumulateDynamicLight(uCamPos)` renders a glowing dot at the
  camera.

Deliverable: helpers usable from any pack body.
Estimate: 0.5 session.

### S3 — Shader hooks (Mode 3) — ✅ Shipped (commit `c02d280`)

The headline new feature.

- Add `HookPrelude.ts` — identity defaults for all 38 hooks from
  §7.
- Add `HookParser.ts` — parse hook function definitions, balance
  braces, validate signatures.
- Extend `ShaderInjection.ts` with `hookPreludeFor(role)` and
  `assembleShaderSource(role, pack, engineBody)`.
- Refactor engine default world / sprite / sky bodies to call
  every catalogued hook at its documented call site (§7.6). All
  hooks resolve to identity defaults pre-pack, so visual output
  is byte-identical.
- Add `shaders.{role}Hooks` keys to `PackManifest`.
- Implement `#include` text-substitution for cross-role shared
  GLSL (§5.4).
- Smoke tests:
  - Empty hook file → byte-identical render.
  - Wet-floor pack (§13.1) → floor reflectivity visibly bumped.
  - Bluish-fog pack → fog visibly tinted.
  - A pack overriding `hook_modifyFinalColor` with a grayscale
    transform produces a monochrome game.
- Manifest validation: reject Mode 1 + Mode 3 same-role-same-pack.

Deliverable: any of the 38 cataloged hooks can be overridden by
a single pack, with the documented semantics.
Estimate: 2–3 sessions (catalog is the bulk).

### S4 — Post-process passes (Mode 2) — ✅ Shipped (commit `dd2063c`)

Was previously planned earlier; reordered to after S3 because
hooks deliver more modder value first.

- Add `PostPassChain.ts` — FBO ping-pong allocator + frame pump.
- Add `manifest.postPasses` to `PackManifest`.
- Wire after the sprite pass in `WebGLRenderer`.
- HUD canvas continues compositing over the final FBO.
- Land the §13 CRT post-pass as a visual-regression fixture in
  `apps/game/src/test-packs/`.

Deliverable: Mode 1 + Mode 2 + Mode 3 all work for a single pack.
Estimate: 1 session.

### S5 — Build-time validation — ⏳ Pending

Applies to all three modes.

- Add `apps/pack-builder/src/validate-shaders.ts`.
- Try `headless-gl`; on failure fall back to syntactic parser +
  a one-time warning.
- Wire into `build-packs.ts` before the zip step.
- Exit code 1 on shader compile error.
- Error format: `<pack>:<file>:<line> <message>`.
- Hook-specific validation: unknown hook names rejected with
  "did you mean" suggestion; signature mismatches rejected with
  the expected signature shown; Mode 1 + Mode 3 exclusion (§5.5).
- Fixtures: a deliberately broken `.frag`, a misspelled hook
  name, and a Mode 1+3 collision in test packs; CI confirms
  builder rejects each.

Deliverable: bad shaders / hooks never ship in a `.apg`.
Estimate: 1 session.

### S6 — Pack-chain resolution + conflict reporting — ⏳ Pending (PACK_CHAIN P1 dependency landed)

- Extend `resolveChain` (lands as part of
  [PACK_CHAIN.md](./PACK_CHAIN.md) P1) to walk packs for
  `shaders.{role}Frag`, `shaders.{role}Hooks`, and `postPasses`.
- Last-wins for Mode 1 roles, last-wins **per hook** for Mode 3
  (§10.2), append for Mode 2.
- Emit `ConflictReport` entries:
  - role-override conflicts (Mode 1 same role across packs)
  - per-hook conflicts (Mode 3 same hook name across packs)
  - Mode 1 / Mode 3 cross-mode collision warning (§10.2)
  - post-pass name collisions
- Settings UI (PACK_CHAIN P2) renders new entries — table-cell
  change, no new components.

Deliverable: multi-pack chains compose shaders + hooks +
post-passes and surface conflicts.
Estimate: 1 session. Depends on PACK_CHAIN P1 (strict).

S2, S3, S4, S5 are deliverable independent of PACK_CHAIN progress
(each works for a single pack on its own).

---

## 15. Open questions

1. **`renderEngineWorld()` escape hatch — RESOLVED by Mode 3.**
   The earlier draft asked whether to inject a helper that lets a
   `worldFrag` override CALL the engine's default world body. The
   driving use case ("decorate the engine's output without
   authoring the whole pipeline") is exactly what Mode 3 hooks
   solve. We can ship Mode 1 + Mode 3 + Mode 2 without ever
   needing a `renderEngineWorld()` helper. Closing this question.

2. **MAX_LIGHTS in pack contract.** Engine hardcodes 8 today. To
   stay upgrade-safe, the header injects `#define MAX_LIGHTS 8`
   and authors write `for (int i = 0; i < MAX_LIGHTS; i++)`.
   Confirm during S2.

3. **Hook signature drift across engine versions.** If the engine
   adds a new parameter to a hook (e.g.
   `hook_modifyReflectivity(base, cellCoord, surface)` gains a
   `float wetness`), older packs' overrides will fail signature
   validation at boot. Options for S3 / later:
   - Strict matching: older packs break, must republish. Honest
     versioning, painful UX.
   - Signature widening: engine permits an override with a
     **shorter** parameter list, ignoring trailing params it
     declared but the pack didn't accept. Lenient, but means the
     engine can never RENAME or REORDER parameters, only append.
   - Pack manifest pins `engine: "two_5_d@0.1"`; engine compares
     versions and warns on minor drift, hard-fails on major.
   - **Recommend the third option, deferred to S5 validation**:
     for now, hooks are versioned with the engine and break with
     the engine.

4. **Headless GL on the dev box.** CLAUDE.md indicates the user
   dev-builds on a Raspberry Pi. `headless-gl` native build may
   not work there. Validate during S5; if not, syntactic-parser
   fallback locally, real validator in x86 CI.

5. **Reload-on-shader-edit.** Bun's dev server has HMR for
   `.frag` files in `apps/game/src` via the existing plugin, but
   pack shaders and hook files inside an `.apg` need `bun run
   build-packs`. Should the dev server watch pack `.frag` /
   `.glsl` files and auto-rebuild? Recommend YES as a follow-up
   parallel to "auto-rebake on scene change"
   ([LIGHTING_OVERHAUL.md](./LIGHTING_OVERHAUL.md) §7).

6. **Vertex shaders.** Deferred. When the engine eventually
   splits the world pass into sub-passes (a post-R5 idea), the
   catalog can grow `wallVert` etc. Exposing the vert stage today
   would also expose engine-internal attribute layouts. Out of
   scope for R4.

7. **Hook-prelude bloat in the compiled shader.** 38 identity
   defaults inflate the source the GLSL compiler sees by ~200
   lines. Drivers we've tested inline trivially, but worst case
   we could split the prelude into per-role files and only emit
   defaults for hooks the engine actually calls in that role (no
   sky hooks in the world prelude). Optimisation for after S3
   ships; not a correctness concern.

8. **Hook ergonomics for cross-pack composition.** §10.2 documents
   "last-wins per hook, no chaining." A more elaborate model
   (`super.hook_modifyReflectivity(base)` calls the previous
   pack's version) is technically feasible but introduces
   ordering surprises that match neither Unity nor most modding
   patterns. Re-evaluate only if community feedback after the S3
   ship cycle indicates demand.

Decisions on (2), (3), and (7) can be deferred until S2 / S3
implementation lands. (4)–(6) and (8) are notes for the
implementer's discretion.

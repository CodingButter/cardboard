# Engine / Pack split — R4: pack-shipped shaders with auto-injected uniforms

Optional, opt-in pack fragment shaders with a strict uniform
contract owned by the engine. A pack that ships **zero** shaders
works with the engine's defaults; a pack that ships custom shaders
either **replaces** engine roles or **adds post-process passes** —
never has to author the whole pipeline.

Source-of-truth for implementation. Supersedes the R4 stub in
[ENGINE_PACK_SPLIT.md](./ENGINE_PACK_SPLIT.md#r4--pack-shipped-shaders-with-uniform-auto-injection).
Cross-refs: [PACK_CHAIN.md](./PACK_CHAIN.md),
[LIGHTING_OVERHAUL.md](./LIGHTING_OVERHAUL.md),
[ENGINE_PACK_SPLIT.md](./ENGINE_PACK_SPLIT.md),
[EDITOR.md](./EDITOR.md).

---

## 1. Goals & non-goals

### Goals

- **Defaults always work.** Engine ships a complete fragment
  shader set covering every render role. A pack with no `shaders`
  field renders identically to today.
- **Opt-in role replacement.** A pack replaces any single role
  (e.g. only `worldFrag`); engine defaults fill the rest.
- **Opt-in post-process.** A pack ADDs post-passes (CRT, vignette,
  palette quantize, …) without touching the main render shaders.
- **Auto-injected uniforms.** Authors write only the body; the
  engine prepends `#version`, precision, every uniform, every
  varying, and a small helper library. Authors never redeclare
  what the engine provides.
- **Compile errors caught at build time.** `apps/pack-builder`
  compiles each pack shader against the engine's header before
  the `.apg` ships. Bad GLSL never reaches a player's browser.
- **Pack-chain aware.** When chained ([PACK_CHAIN.md](./PACK_CHAIN.md))
  packs each ship shaders, role replacement is last-wins;
  post-passes append in chain order. Conflicts surface in the
  existing soft-override report.
- **Backwards compatible.** Existing packs without `shaders` /
  `postPasses` keep loading. No migration step.

### Non-goals

- **Custom vertex shaders.** Wall / sprite vertex geometry comes
  from engine-internal column textures + projected sprite quads.
  Exposing the vertex stage couples packs to internals we want to
  keep refactorable. Engine owns all vertex code. Mentioned again
  as deferred in §13.
- **Compute / SSBO / MRT / GBuffers.** Single-pass forward; one
  `vec4 outColor` per role.
- **Pack-supplied lightmap baking.** Bake (`apps/pack-builder/
  src/bake-lights.ts`) stays engine-side. Packs can sample the
  baked lightmap; cannot replace the bake.
- **WGSL / WebGPU.** WebGL2 only.
- **Hot reload of pack shaders.** Editing a pack `.frag` requires
  `bun run build-packs` + page reload, same as content edits.

---

## 2. Backend scope

**WebGL2 only.** Pack shaders are a WebGL feature. The canvas2d
backend (CPU pixel pusher) is unaffected.

| Pack ships | `backend = "webgl"` | `backend = "canvas2d"` |
|---|---|---|
| No shaders | engine defaults | CPU path, unchanged |
| `shaders.{role}` | pack shader replaces engine default | **graceful no-op** + one boot log line |
| `postPasses[]` | wired into FBO chain | **graceful no-op** + one boot log line |

The graceful-no-op rule is deliberate: a player on canvas2d
shouldn't have a pack refuse to load because of optional shader
content. Pack authors who consider their shader load-bearing set
`shadersRequiresBackend: "webgl"` (§10), which converts the no-op
into a hard error.

Boot log on canvas2d when one or more packs ship shaders:

```
[two_5_d] 3 pack(s) ship WebGL shaders ignored on canvas2d backend:
  - wet-walls.worldFrag
  - crt-mod.postPasses[crt]
  - dark-mod.postPasses[vignette]
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
`packages/engine/src/Renderers/ShaderRoles.ts` maps role → default
GLSL body + uniform contract (§5). Single source of truth — the
engine's own defaults are registry entries, identical in shape to
a pack override.

### 3.3 Resolution at load time

When a pack chain is resolved (boot):

1. For each role, pick the **last** pack in the chain that
   declares an override; fall back to the engine default.
2. Compile the chosen body (prepending the auto-injected header,
   §6).
3. Link with the engine's pass-through vertex shader.
4. Store the linked program in the renderer's role slot.

Chain `[default, A, B]` where B overrides `worldFrag` and C is
absent: active programs are `skyFrag = engine`, `worldFrag = B`,
`spriteFrag = engine`.

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
  reporting (§8.3).
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
- Receives the standard frame uniforms (§5.5).
- Renders to the next FBO, or to the screen on the final pass.

Single fullscreen-quad VAO, reused — same one the sky / world
passes use today.

### 4.3 Ordering

Passes run in **manifest order** within a pack. Across the chain,
passes append in chain load-order: all of pack A's passes, then
all of pack B's, etc. (§8.2).

### 4.4 HUD

The HUD canvas is a separate stacked DOM element (existing WebGL
backend behaviour). HUD composites over the final WebGL frame, so
post-passes run BEFORE the HUD — gun overlay, minimap, stats,
reticle, and inventory bar are untouched by world-space distortion.
A future `hudPostPass` role can land additively if needed; out of
scope for R4.

---

## 5. Uniform contract — per role

For each role the engine guarantees a fixed set of uniforms,
varyings, and helpers. Authors don't redeclare them — the
auto-injected header (§6) provides them. The contract is versioned
with `manifest.engine` (`two_5_d@0.1`).

### 5.1 Common (all roles + post-passes)

| Type & name | Meaning |
|---|---|
| `uniform vec2 uResolution` | Render-target size in pixels. |
| `uniform float uTime` | Seconds since boot. Monotonic. |
| `uniform float uFrame` | Integer frame counter as float. |
| `uniform float uFogInv` | 1 / fog-distance. |
| `varying vec2 vUV` | Fullscreen-quad UV in `[0,1]`. `y=0` is bottom. |

### 5.2 `skyFrag`

Adds:

| Type & name | Meaning |
|---|---|
| `uniform vec3 uSkyTop` | Engine-config sky top color. |
| `uniform vec3 uSkyBottom` | Engine-config sky bottom color. |
| `uniform vec2 uCameraForward` | XY direction camera faces. Lets sky shaders rotate gradients with heading. |

Writes `vec4 outColor` (alpha=1).

### 5.3 `worldFrag`

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

**Engine helper functions** (injected with the header):

| Signature | Returns |
|---|---|
| `vec3 sampleTile(int tile, vec2 uv)` | Texture-array sample. |
| `bool inBounds(ivec2 c)` | Cell in scene? |
| `bool isFloorOccluderC(ivec2 c)` / `isCeilingOccluderC(ivec2 c)` | Per-surface occluder neighbour test. |
| `vec3 sampleLightmap(vec2 worldPos, bool ceiling)` | Bilinear lookup at world pos (matches engine's per-fragment math). |
| `vec3 accumulateDynamicLight(vec2 worldPos)` | In-shader DDA-LOS + jitter dynamic-light sum (matches Phase 5 implementation). |

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

### 5.4 `spriteFrag`

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

### 5.5 Post-pass uniforms

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

## 6. Auto-injected header

### 6.1 Mechanics

Per role, the engine prepends a generated header to each
pack-shipped shader before compilation. Authors write only the
body — `main()` plus any helpers they need.

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
  "// ==== user body begins ====\n" +
  userSrc
```

`generate*` read from the `ShaderRoleRegistry` (§3.2).

### 6.2 Module

A new module
`packages/engine/src/Renderers/ShaderInjection.ts` exports:

```ts
export function buildFragmentSource(
  role: ShaderRole | "postPass",
  userBody: string,
): string;
```

`WebGLRenderer` calls this for every role at boot. The engine's
own default bodies flow through the same function — there's no
separate path for engine vs. pack. Default `worldFrag` becomes
"the default `userBody` for role `worldFrag`". Keeps the contract
honest.

### 6.3 What the author CANNOT write

- `#version` or `precision` qualifiers (header).
- `out vec4 outColor;` (header).
- Any uniform / varying / `#define` in the role's contract — GLSL
  "duplicate declaration" error. The build-time validator (§7)
  catches this and rewrites the error to the author's source
  line.

---

## 7. Build-time validation

### 7.1 Where

`apps/pack-builder/src/validate-shaders.ts` (new), invoked from
`build-packs.ts` after manifest parse, before zipping.

### 7.2 What

For each path in `manifest.shaders` and `manifest.postPasses`:

1. Read the user body.
2. Resolve the role's header from `ShaderRoleRegistry` (imported
   from `packages/engine/src/Renderers/ShaderRoles.ts`).
3. Run `buildFragmentSource()` — same function used at runtime.
4. Compile the combined source in a headless WebGL2 context.
5. On compile failure, parse the GLSL error log, subtract the
   header's line count, and emit:

   ```
   wet-walls: shaders/wet-world.frag: line 14
     error: undeclared identifier 'baldwin'
        outColor = vec4(baldwin, 1.0);
                        ^
   ```

6. Build refuses to zip the pack on any failure. Exit code 1.

### 7.3 Headless GL choice

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

### 7.4 Manifest validation

- Every key in `shaders` must be a catalog role. Unknown → hard
  error with a "did you mean" suggestion.
- Every `postPasses[].name` is unique within the pack.
- Every path exists inside the pack tree.

---

## 8. Pack-chain interaction

Cross-ref: [PACK_CHAIN.md](./PACK_CHAIN.md) §6 (conflict
detection), §7 (override rules).

### 8.1 Role replacement — last-wins

Chain `[default, A, B]` where both A and B declare
`shaders.worldFrag`: B wins. Conflict report (added in PACK_CHAIN
P2) records:

```ts
{ asset: "shaders.worldFrag", winnerPack: "B", overriddenPacks: ["A"] }
```

Surfaced in Settings → Packs panel's Overrides column.

### 8.2 Post-passes — append in load order

```
main render → [A.pass1] → [A.pass2] → [B.pass1] → [B.pass2] → screen
```

This is the only override rule that ISN'T last-wins. Extends
PACK_CHAIN §7's table with two new rows (parent will edit when
this lands):

| Asset | Identity | Merge |
|---|---|---|
| `shaders.<role>` | role | **replace** (last wins) |
| `postPasses[]` | chain order | **concatenate** |

### 8.3 Post-pass name collision

If `crt-mod` and `extra-fx` both ship `postPasses: [{ name: "crt" }]`,
both run; the chain has two passes named `crt`. A soft warning is
emitted so the modder can rename if unintentional. We don't dedupe
by name — two CRT passes is a valid stylistic choice. A future
"override post-pass by name" feature is out of scope here.

### 8.4 Backend mismatch in a chain

If any pack in the chain ships shaders AND the resolved backend is
canvas2d, all shader / post-pass entries from every pack are
ignored with the consolidated log shown in §2.

---

## 9. Engine implementation sketch

```
packages/engine/src/Renderers/
├── ShaderRoles.ts            NEW — role registry + default bodies
├── ShaderInjection.ts        NEW — buildFragmentSource()
├── PostPassChain.ts          NEW — FBO ping-pong runner
├── WebGLRenderer.ts          MODIFIED — load programs from registry;
│                                         FRAG_* constants become registry
│                                         defaults
└── SceneRenderer.ts          unchanged (interface)

packages/engine/src/AssetPack/
└── types.ts                  MODIFIED — PackManifest gains
                                  shaders?: Partial<Record<ShaderRole, string>>
                                  postPasses?: PostPassDef[]
                                  shadersRequiresBackend?: "webgl"

apps/pack-builder/src/
├── validate-shaders.ts       NEW — build-time compile pass
└── build-packs.ts            MODIFIED — invokes validate-shaders before zip

apps/game/setup-plugins.ts    UNCHANGED — its GLSL bundler plugin still
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
   last→first; first pack with `shaders[role]` declared wins;
   else use engine default body. Read body via `pack.textBody`.**
5. **`buildFragmentSource(role, body)` → compile → link.**
6. **Collect `postPasses[]` from every pack in chain order. Build
   FBO chain via `PostPassChain.build()`.**
7. Renderer ready; scene loads; first frame.

Per-frame cost: zero net change for "no pack shaders." One
program switch + FBO swap per active post-pass.

---

## 10. Manifest schema additions

Adds to `PackManifest` (existing type at
[packages/engine/src/AssetPack/types.ts:176](../../packages/engine/src/AssetPack/types.ts)):

```jsonc
{
  // ...existing fields...
  "shaders": {
    "skyFrag":    "shaders/aurora-sky.frag",
    "worldFrag":  "shaders/wet-world.frag",
    "spriteFrag": "shaders/glow-sprite.frag"
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

export interface PostPassDef {
  name: string;   // unique within pack
  frag: string;   // path inside pack
}

export interface PackManifest {
  // ...existing fields...
  shaders?: Partial<Record<ShaderRole, string>>;
  postPasses?: PostPassDef[];
  shadersRequiresBackend?: "webgl";
}
```

`ShaderRole` lives in `ShaderRoles.ts` and is re-exported from
`AssetPack/types.ts` for manifest typing.

---

## 11. Worked example — wet walls + CRT

A complete pack that adds an animated puddle highlight to floors
and a CRT post-pass. No images, no scenes, no scripts — modder
ships only what they're customising (~3 KB total).

```
wet-crt.apg/
├── manifest.json
└── shaders/
    ├── wet-world.frag
    └── crt.frag
```

**manifest.json**

```jsonc
{
  "id": "wet-crt",
  "name": "wet-crt",
  "version": "0.1.0",
  "engine": "two_5_d@0.1",
  "requires": [{ "id": "default", "version": "^0.2.0" }],
  "shaders": { "worldFrag": "shaders/wet-world.frag" },
  "postPasses": [{ "name": "crt", "frag": "shaders/crt.frag" }]
}
```

**shaders/wet-world.frag** — see §13 open question 1 for the
`renderEngineWorld()` helper; if implementation picks "no such
helper," the modder duplicates the engine's world body.

```glsl
// Header injects every uniform / varying / helper from §5.3.

void main() {
  vec4 base = renderEngineWorld();  // see §13.1
  // Wobbly puddle highlight on floor pixels only.
  float p = abs((vUV.y * uResolution.y) - (uResolution.y * 0.5 + uHorizonOffset));
  if (p < 0.5) { outColor = base; return; }
  bool isFloor = (vUV.y * uResolution.y) > (uResolution.y * 0.5 + uHorizonOffset);
  if (!isFloor) { outColor = base; return; }
  float rowDistance = (uCameraZ * (uResolution.x / (2.0 * uPlaneScale))) / p;
  vec2 worldPos = uCamPos + rowDistance *
                  (uCamForward + uCamRight * uPlaneScale * (2.0 * vUV.x - 1.0));
  float w = sin(worldPos.x * 6.28 + uTime) * sin(worldPos.y * 6.28 + uTime * 0.7);
  outColor = vec4(base.rgb + vec3(0.15) * max(0.0, w), 1.0);
}
```

**shaders/crt.frag** — barrel distortion + scanlines:

```glsl
// Header injects uColor, uResolution, uTime, vUV, outColor.

void main() {
  vec2 uv = vUV * 2.0 - 1.0;
  vec2 offset = uv * 0.02 * dot(uv, uv);
  vec2 sampleUV = (uv - offset) * 0.5 + 0.5;
  vec3 col = texture(uColor, sampleUV).rgb;
  float scan = sin(sampleUV.y * uResolution.y * 3.14159) * 0.04;
  outColor = vec4(col * (1.0 - scan), 1.0);
}
```

**Runtime pipeline** with default pack + this pack chained:

```
skyFrag    = default
worldFrag  = wet-crt's wet-world.frag
spriteFrag = default
postPasses = [ wet-crt.crt ]

frame: [sky] → [wet-world] → [default-sprite] → FBO_A
                                                  ↓
                                              [crt] → screen
```

---

## 12. Phases

R4 splits into four shippable steps. Each leaves the engine
working on its own.

### S1 — Role replacement, no validation, single pack

- Add `ShaderRoles.ts` (registry seeded with engine defaults).
- Add `ShaderInjection.ts` (`buildFragmentSource`).
- Refactor `WebGLRenderer` to load each role from the registry —
  default bodies stay byte-identical to today.
- Add `manifest.shaders` to `PackManifest`.
- Boot: if WebGL backend AND pack declares `shaders[role]`, read
  via `pack.textBody`, compile, link.
- Console-log + graceful no-op on canvas2d.
- Smoke test: ship a tiny `worldFrag` override behind a flag in
  the default pack; verify it renders.

Deliverable: single-pack role override works.
Estimate: 1 session.

### S2 — Post-process passes

- Add `PostPassChain.ts` — FBO ping-pong allocator + frame pump.
- Add `manifest.postPasses` to `PackManifest`.
- Wire after the sprite pass in `WebGLRenderer`.
- HUD canvas continues compositing over the final FBO.
- Land the §11 wet-crt example as a visual-regression fixture in
  `apps/game/src/test-packs/`.

Deliverable: Mode 1 + Mode 2 work for a single pack.
Estimate: 1 session.

### S3 — Build-time validation

- Add `apps/pack-builder/src/validate-shaders.ts`.
- Try `headless-gl`; on failure fall back to syntactic parser + a
  one-time warning.
- Wire into `build-packs.ts` before the zip step.
- Exit code 1 on shader compile error.
- Error format: `<pack>:<file>:<line> <message>`.
- Fixture: a deliberately broken `.frag` in a test pack; CI
  confirms builder rejects.

Deliverable: bad shaders never ship in a `.apg`.
Estimate: 0.5–1 session.

### S4 — Pack-chain resolution + conflict reporting

- Extend `resolveChain` (lands as part of [PACK_CHAIN.md](./PACK_CHAIN.md)
  P1; this step adds shader-specific handling) to walk packs for
  `shaders` and `postPasses`.
- Emit `ConflictReport` entries for role-override conflicts and
  post-pass name collisions.
- Settings UI (PACK_CHAIN P2) renders new entries — table-cell
  change, no new components.

Deliverable: multi-pack chains compose shaders and surface
conflicts.
Estimate: 0.5 session. Depends on PACK_CHAIN P1 (strict).

S1 + S2 are deliverable independent of PACK_CHAIN progress.

---

## 13. Open questions

1. **`renderEngineWorld()` escape hatch?** Should the engine
   inject a helper that lets a `worldFrag` override CALL the
   engine's default world body and decorate its output? Pros:
   modders can "post-effect-on-world" without authoring the full
   pipeline. Cons: the engine's world frag is 300+ lines; packaging
   as a callable function is complicated by GLSL's restricted
   `discard` semantics. Safer alternative: make post-passes the
   only way to decorate the world output; reserve role replacement
   for complete rewrites. **Recommend deferring — ship without it,
   add later if modders ask.** §11 worked example assumes it but
   works fine if the modder duplicates the world body.

2. **MAX_LIGHTS in pack contract.** Engine hardcodes 8 today. To
   stay upgrade-safe, the header injects `#define MAX_LIGHTS 8`
   and authors write `for (int i = 0; i < MAX_LIGHTS; i++)`.
   Confirm during S1.

3. **Headless GL on the dev box.** CLAUDE.md indicates the user
   dev-builds on a Raspberry Pi. `headless-gl` native build may
   not work there. Validate during S3; if not, syntactic-parser
   fallback locally, real validator in x86 CI.

4. **Reload-on-shader-edit.** Bun's dev server has HMR for
   `.frag` files in `apps/game/src` via the existing plugin, but
   pack shaders inside an `.apg` need `bun run build-packs`.
   Should the dev server watch pack `.frag`s and auto-rebuild?
   Recommend YES as a follow-up parallel to "auto-rebake on scene
   change" ([LIGHTING_OVERHAUL.md](./LIGHTING_OVERHAUL.md) §7).

5. **Vertex shaders.** Deferred. When the engine eventually
   splits the world pass into sub-passes (a post-R5 idea), the
   catalog can grow `wallVert` etc. Exposing the vert stage today
   would also expose engine-internal attribute layouts. Out of
   scope for R4.

Decisions on (1) and (2) can be deferred until S1 implementation
lands. (3)–(5) are notes for the implementer's discretion.

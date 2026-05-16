# Per-entity shader attachment — MATERIALS plan

Three-tier shader hierarchy with **per-entity GLSL hook overrides**.
Modders attach a `Shader` ECS component to any entity to ride a
different fragment-shader behaviour for *that* entity, while every
un-overridden hook inherits from the scene-level → pack-level →
engine-default cascade.

**Status: All phases shipped.** M1+M2+M3+M5 in commit `bdab12a`; M4
(pack-chain cascade) in commit `be31fea`. This doc is now the
historical record + reference for the shipped surface.

Source-of-truth for implementation. Phases M1–M5 below. Cross-refs:
[ENGINE_PACK_SHADERS.md](./ENGINE_PACK_SHADERS.md) (R4 pack-level
shaders — the substrate this builds on),
[PACK_CHAIN.md](./PACK_CHAIN.md) (M4 pulls in multi-pack semantics),
[TILE_PRESETS.md](./TILE_PRESETS.md) (M2 attaches shaders to tile
presets), [LIGHTING_OVERHAUL.md](./LIGHTING_OVERHAUL.md).

Last revised: 2026-05-15.

---

## 1. Goals & non-goals

### Goals

- **Per-entity shader attachment.** Each entity can carry a `Shader`
  ECS component that names one or more pack-supplied `.glsl` hook
  files (sprite / world / sky). That entity's pixels go through
  those hook bodies; other entities continue to use the pack default.
- **Three-tier cascade.** Engine identity defaults → pack-level hooks
  (R4 / [ENGINE_PACK_SHADERS.md](./ENGINE_PACK_SHADERS.md) §5) →
  scene-level hooks (M3) → per-entity hooks (M1). Most specific
  wins, per individual hook name. Sparse overrides allowed — a
  variant that only redefines `hook_modifySpriteAlpha` inherits all
  37 other sprite hooks from the next tier up.
- **Identical surface to pack hooks.** A `.glsl` file authored as a
  pack-level `spriteHooks` is byte-for-byte legal as a `Shader`
  component `spriteHooks` target. Same parser (`HookParser.ts`),
  same identity-default semantics, same diagnostics.
- **Zero overhead when unused.** A pack with no `Shader` components
  compiles + draws byte-identically to today. The sprite VBO grows
  by one float per vertex, but a fragment-shader switch with one
  case is the same as no switch — the GLSL compiler folds it.
- **Zero new ModAPI surface.** The component is the surface. Modders
  use the existing `api.world.add(e, api.components.Shader, {...})`
  pattern; the engine quietly recompiles its sprite program at
  scene-load time.

### Non-goals

- **Unity-style materials.** Not implementing a `Material` asset
  class with shadow casters / lit BRDFs / per-channel binding /
  inspector UI. This is GLSL hook overrides, per entity, period.
- **Custom shader uniforms per entity.** A per-variant uniform block
  is a future extension; today every variant reads the same uniform
  set (`uTime`, lights, lightmap, etc.) the pack-level frag does.
  See §13 — open.
- **World cells with per-entity shaders.** Cells aren't entities;
  they live in scene grid textures. M2 ships their analog
  (preset-attached shaders + per-cell variant id).
- **Compute / SSBO / vertex stage.** Same constraints as R4 §1 —
  fragment hooks only, WebGL2 only.
- **Hot-reload of `.glsl` files.** Same as R4 — edit, `bun run
  build-packs`, refresh.
- **Render-order changes.** A `Shader` component does NOT change
  sprite sort order or batching strategy beyond a one-integer
  vertex attribute. Sprites still back-to-front sort by camera
  depth; the dispatcher switch inside the frag program handles
  the variant divergence at fragment-shader granularity.

---

## 2. Why "Shader" not "Material"

Modders coming from Unity / Unreal / Godot expect a "Material" asset
that bundles a shader with parameter values. "Shader" is the lower
abstraction — and lower is what we're shipping today.

| Term | What it implies | What we ship |
|---|---|---|
| `Material` | Asset wrapping a shader + per-material uniforms / textures | Out of scope (per-variant uniforms = future). |
| `Shader` | GLSL bodies that run on a thing | Exactly what we ship — `.glsl` hook files attached to entities. |

The user's mental model: "this entity has a shader on it" maps 1:1
to "this entity carries a `Shader` component pointing at a `.glsl`
file." Promoting to "Material" later (when we have uniforms) is
additive — `Material` would *contain* a `Shader` reference plus a
uniform table; existing `Shader` components keep working.

The name `Shader` is also disambiguated from `ShaderRole` and
`ShaderRoleRegistry` by context — those are engine internals,
exposed only as types. The component name (registered with
`new Component<ShaderData>("Shader")`) is the only `Shader` in the
ModAPI surface, and the lookup path is
`api.components.Shader`.

---

## 3. Three-tier hierarchy

### 3.1 Resolution rules

```
Engine identity defaults              tier 0 — every hook returns base unchanged
       ↑ overridden by
Pack-level hooks (manifest.shaders)   tier 1 — R4 / ENGINE_PACK_SHADERS §5
       ↑ overridden by
Scene-level hooks (scene.shaders)     tier 2 — NEW (M3)
       ↑ overridden by
Per-entity hooks (Shader component)   tier 3 — NEW (M1)
```

Most-specific wins per hook name. Two important consequences:

1. **Sparse overrides allowed.** A variant that defines only
   `hook_modifySpriteFinalColor` inherits the other 7 sprite hooks
   from the next tier up. The engine's hook merger walks the cascade
   bottom-up (tier 3 first, then 2, 1, 0), and `parseHookOverrides`
   already returns a `Map<name, body>` — we just merge maps.

2. **Tiers don't conflict — they layer.** A pack ships an underwater
   tint via `spriteHooks: "shaders/underwater.glsl"`; a scene later
   says "this room is dry" via `scene.shaders.spriteHooks:
   "shaders/no-tint.glsl"`; an entity inside that scene says "but
   I'm a ghost" via `Shader { spriteHooks: "shaders/ghost.glsl" }`.
   All three coexist — each entity's pixels execute the
   *most-specific* override of every hook the cascade reaches.

### 3.2 Inheritance semantics

Each `.glsl` file in the cascade is parsed once at scene-load via
`HookParser.parseHookOverrides`. The result is a `Map<hookName,
glslBody>`. The engine merges these maps bottom-up:

```ts
// Pseudocode — see Renderers/ShaderVariants.ts for the real impl.
function resolveVariant(
  entityShader: ShaderData | undefined,
  sceneShader: ShaderData | undefined,
  packShader: PackShaderManifest,
): Map<string, string> {
  const out = new Map<string, string>();
  // tier 1: pack hooks (lowest precedence among non-identity tiers)
  mergeFile(out, packShader.spriteHooks);
  // tier 2: scene hooks
  mergeFile(out, sceneShader?.spriteHooks);
  // tier 3: entity hooks
  mergeFile(out, entityShader?.spriteHooks);
  // Tier 0 (identity defaults) come from HookPrelude.ts and are
  // resolved by HookParser.substituteHooks during assembly.
  return out;
}
```

`mergeFile()` overwrites existing entries — last-write-wins inside a
single tier maintains the existing R4 semantics for a single hook
file. A `.glsl` file declaring the same hook twice keeps the second
definition.

### 3.3 What about Mode 1 (full role replacement)?

Per-entity shaders are **Mode 3 hooks only**. A modder who needs a
fundamentally different `main()` for one entity can't use this
system — Mode 1 is whole-pipeline replacement, and you can't have
two `main()`s in one program. Acknowledge as a limitation in §13.

Practically: 38 hook call sites cover the 80% case
([ENGINE_PACK_SHADERS.md §5.1](./ENGINE_PACK_SHADERS.md#51--motivation--the-missing-middle)).
A pack that ships Mode 1 sprite replacement *and* per-entity shaders
gets a build-time warning: the per-entity hooks would have nowhere
to splice into (the pack's `main()` doesn't contain the engine's
hook call sites). M5 validates this.

---

## 4. The `Shader` ECS component

### 4.1 Schema

```ts
// packages/engine/src/Components/Shader.ts
export interface ShaderData {
  /**
   * Pack-relative path to a `.glsl` file containing
   * `hook_modify*` definitions for worldFrag's 27 hooks.
   * Inherits pack-level worldHooks if absent.
   */
  worldHooks?: string;
  /**
   * Same for the spriteFrag's 8 hooks. M1 implements ONLY this.
   */
  spriteHooks?: string;
  /**
   * Same for the skyFrag's 3 hooks. Sky has no per-entity
   * semantics (the sky pass is one fullscreen quad), so this
   * field is reserved but unused in M1-M3. M4 may attach
   * sky shaders to scene-level "weather" entities.
   */
  skyHooks?: string;
}

export const Shader = new Component<ShaderData>("Shader");
```

All three fields optional. A `Shader` component with all fields
undefined behaves identically to no component (= variant 0 = pack
default).

### 4.2 Lifecycle

- **Authored.** Modders attach the component in prefab factories or
  in `onWorldReady` handlers. Pack-side `.tsx` modal screens don't
  manipulate it.
- **Read.** Engine reads the component at **scene load** (variant
  collection — §5) and **per-sprite-quad emission** (§6 — vertex
  buffer fill).
- **Mutated mid-game.** Possible but expensive — see §7 (recompile
  triggers). The engine logs a warning if it detects a Shader
  component value not registered as a variant; the entity falls
  back to variant 0 for that frame.

### 4.3 ModAPI exposure

`api.components.Shader` returns the component handle. Existing
`api.world.add(entity, Shader, { spriteHooks: "..." })` works
without further surface changes. `defineComponent` continues to
work — `Shader` lives in the `builtIns` set.

```ts
// In a prefab factory:
api.registerPrefab("ghost_zombie", (x, y) => {
  const e = api.world.spawn();
  api.world
    .add(e, api.components.Position, new api.Vec2(x, y))
    .add(e, api.components.Sprite, {
      imageId: "zombie",
      worldHeight: 0.7,
      yOffset: 0.15,
    })
    .add(e, api.components.Shader, {
      spriteHooks: "shaders/ghost-sprite.glsl",
    });
  return e;
});
```

---

## 5. Shader-assembly pipeline

### 5.1 Variant collection

At scene-load time (`game.spawnInitialEntities()` after pack scripts
have run), the engine:

1. Walks every entity with both `Sprite` and `Shader` components
   (M1 scope is sprites only).
2. For each unique combination of `(worldHooks, spriteHooks,
   skyHooks)` string-triple (excluding `undefined` fields), assigns
   a non-zero integer variant id. The pack default = variant 0.
3. Loads each variant's hook files via `pack.textBody(path)`,
   parses with `parseHookOverrides`, caches the result.

`ShaderVariants.collect(world, pack)` returns a
`Map<variantId, {sprite?: ParsedHooks}>`. The map is keyed by a
canonical stable string `${worldHooks||''}|${spriteHooks||''}|
${skyHooks||''}` so two entities with the same Shader component
share variant id.

Zero variants (no `Shader` components at all in the scene) skips the
recompile step — the renderer keeps its pack-default program.

### 5.2 Dispatcher generation

For each hook the engine generates a renamed copy per variant, then
a top-level dispatcher that switches on `v_variant`:

```glsl
// === Variant 0: pack default (already in the prelude) =====
vec3 hook_modifySpriteFinalColor__v0(vec3 base, int layer, vec2 wp) {
  return base; // identity OR pack override after substituteHooks
}

// === Variant 1: ghost-sprite.glsl =========================
vec3 hook_modifySpriteFinalColor__v1(vec3 base, int layer, vec2 wp) {
  return base * vec3(0.4, 1.5, 0.4); // green tint
}

// === Variant 2: hit-flash.glsl ============================
vec3 hook_modifySpriteFinalColor__v2(vec3 base, int layer, vec2 wp) {
  return vec3(1.0); // pure white
}

// === Top-level dispatcher (replaces the prelude identity) =
vec3 hook_modifySpriteFinalColor(vec3 base, int layer, vec2 wp) {
  switch (v_variant) {
    case 1: return hook_modifySpriteFinalColor__v1(base, layer, wp);
    case 2: return hook_modifySpriteFinalColor__v2(base, layer, wp);
  }
  return hook_modifySpriteFinalColor__v0(base, layer, wp);
}
```

The dispatcher's `default` falls through to variant 0. Variants that
don't override this particular hook simply don't appear in the
switch — they hit `default` and inherit the pack default. The
parser's existing per-hook map makes this lookup trivial.

### 5.3 Where it lives

New module `packages/engine/src/Renderers/ShaderVariants.ts`:

```ts
export interface SpriteVariant {
  id: number;
  /** Canonical key — Map<key, id> for entity-side lookups. */
  key: string;
  /** Parsed hook bodies for THIS variant's sprite-hook file. */
  spriteHooks: Map<string, string>;
}

export class ShaderVariantSet {
  readonly variants: ReadonlyArray<SpriteVariant>;
  /** Lookup: Shader component → variant id. */
  variantIdForShaderData(data: ShaderData | undefined): number;
  /**
   * Assemble a sprite-frag source with N variants merged + dispatched.
   * Pass through to `assembleSpriteSource` in ShaderInjection.ts.
   */
  toAssembledSource(packShaderSrc: string | undefined): Promise<string>;
}

export async function collectSpriteVariants(
  world: World,
  pack: AssetPack,
): Promise<ShaderVariantSet>;
```

Assembly delegates to a new function in `ShaderInjection.ts`:

```ts
export async function assembleSpriteSource(
  pack: AssetPack | undefined,
  variants: ShaderVariantSet,
): Promise<string>;
```

The non-variant case (`variants.variants.length === 0`) calls the
existing `assembleShaderSource(role="spriteFrag", pack, engineBody)`
verbatim — no dispatcher, no variant attribute referenced. Byte-
identical to today.

---

## 6. Per-vertex variant id (sprites)

### 6.1 Vertex format change

The sprite VBO's per-vertex layout grows by one float:

| Field | Before | After |
|---|---|---|
| `a_position` (vec2) | 0..7 bytes | 0..7 bytes |
| `a_uv` (vec2) | 8..15 | 8..15 |
| `a_layer` (float) | 16..19 | 16..19 |
| `a_camY` (float) | 20..23 | 20..23 |
| `a_worldPos` (vec2) | 24..31 | 24..31 |
| `a_variant` (float, **NEW**) | — | 32..35 |
| **Stride** | 32 bytes | 36 bytes |

We store the integer as a `float` to keep all-FLOAT attributes and
not split into a second VBO. The vertex shader reads it as
`int(a_variant + 0.5)` and forwards it as `flat int v_variant`. With
`MAX_SPRITES_PER_FRAME = 1024` and 6 verts/sprite, the new VBO
size grows from 192 KB to 216 KB — negligible.

Variant id is per-quad (constant across the 6 verts of a sprite
quad) — the `flat` qualifier ensures the fragment shader sees the
integer unchanged, no interpolation.

### 6.2 Why not a uniform?

A uniform-per-draw would require one `drawArrays` call per variant
— breaking the current single-batch model. With per-vertex variant
id, we keep the single back-to-front batched draw and let the GLSL
compiler pick per-fragment.

### 6.3 Batching strategy

Sprites with different variants batch together — they're sorted
back-to-front by `camY` for alpha compositing (today's behaviour),
and the dispatcher in the frag shader handles the divergence. We
do NOT re-sort by variant. Modern GPUs handle the switch cheaply
when most fragments hit the same case (the typical case: variant
0 dominates), and if a future scene has visible perf cost we can
investigate variant-sub-sorting then.

### 6.4 SpriteDrawRequest schema

`SpriteDrawRequest` (in `SceneRenderer.ts`) gains one optional
field:

```ts
export interface SpriteDrawRequest {
  // ...existing fields...
  /** Variant id from the entity's Shader component. Defaults to 0. */
  shaderVariant?: number;
}
```

`SpriteRenderSystem` reads the entity's `Shader` component (via
the variant set, which the renderer exposes) and populates this
field. Undefined → 0.

---

## 7. Recompilation triggers

### 7.1 Scene load (the main trigger)

After `runPackScripts` + `spawnInitialEntities` populates the world,
the engine:

1. Calls `collectSpriteVariants(world, pack)`.
2. If the result has 0 variants, skips the recompile path entirely
   — the renderer stays on its pack-default sprite program.
3. If 1+ variants, calls `renderer.rebuildSpriteProgram(variants)`
   which:
   - Assembles a new fragment source via `assembleSpriteSource`.
   - Recompiles + relinks the sprite program.
   - Re-queries `gl.getAttribLocation` for the variant attribute.

One-time cost per scene. The recompile is a fragment-shader build
of ~5-15 KB of GLSL — typically <100 ms in production browsers,
under the player-perceptible boot threshold. Worst case a scene
with 30 unique variants would push it to perhaps 250 ms.

### 7.2 Per-frame component edits

The engine does **not** recompile mid-frame. If a script adds a
`Shader` component to an existing entity after scene load:

- If the new `(worldHooks, spriteHooks, skyHooks)` triple matches
  an existing variant, the sprite renders with that variant
  immediately.
- If it doesn't match any registered variant, the engine logs:

  ```
  [two_5_d] entity 42 carries a Shader component not registered as
  a variant at scene-load time. Falling back to variant 0 (pack
  default). Reload the scene to compile this shader.
  ```

  and the sprite renders with variant 0. Acceptable for v1 — moving
  to live-edit requires either a shader recompile queue or a
  generous over-allocation of "spare" variant slots. Defer.

### 7.3 HMR + pack edits

When the user edits a `.glsl` file in `packages/default-pack/
shaders/` and runs `bun run build-packs`, the pack is rebuilt and
the browser reloads — same path as today's pack-shipped shader
edits. Mid-session HMR of GLSL is out of scope.

### 7.4 Editor live-edit

Out of scope until E-phase. When the editor lets a user pick a
shader for an entity in the inspector, the editor (which already
owns its own engine instance and forces full-rebuild on edits)
calls the same `collectSpriteVariants` path. No new machinery.

---

## 8. M2 — Cell materials

### 8.1 Authoring

`TILE_PRESETS.md`-style preset entries gain an optional `shader`
field:

```jsonc
{
  "wet_floor": {
    "extends": "floor_base",
    "image": "images/tiles/tile_floor.jpg",
    "shader": "shaders/wet-floor-cell.glsl"
  }
}
```

The `.glsl` body is parsed identically to entity-side hooks — it's
just `hook_modify*` definitions. Worldfrag hooks (27 of them) apply.

### 8.2 Engine integration

`u_sceneTiles` (RGBA32F SW×SH, currently packed `(wallTile,
floorTile, ceilTile, ceilOccluder)`) gets a fifth value via either:

- (a) Promoting one channel to encode `floorVariantId` in the high
  bits of `floorTile` (cheap, breaks at >256 tiles per variant).
- (b) Adding a new sampler `u_sceneShaderVariants` (RGBA32F SW×SH:
  `floorVariantId, ceilVariantId, wallVariantId, _`). Clean,
  scalable, +4 bytes per cell.

Decision deferred to M2 design — likely (b) for cleanliness; (a)
is the squeeze-it path if texture-unit pressure becomes a problem.

### 8.3 World fragment shader branches

The world frag's hook calls become switches on the per-cell variant
id — `vec3 wallVariantId = texelFetch(u_sceneShaderVariants,
cellCoord, 0).rgb`. Same dispatcher pattern as sprites.

M2 work splits into: preset-resolver picks up `shader` field
(P-side), `u_sceneShaderVariants` texture upload, dispatcher
generation across worldFrag's 27 hooks (much larger surface than
sprite's 8), and a smoke test (the existing `wet-world-hooks.glsl`
becomes a per-cell shader instead of a pack-wide one).

---

## 9. M3 — Scene-level overrides

### 9.1 Manifest

Scene JSON gains a `shaders` field, structurally identical to
manifest.shaders:

```jsonc
{
  "size": { "x": 16, "y": 16 },
  "spawn": { "x": 1.5, "y": 1.5, "facing": 0 },
  "shaders": {
    "worldHooks": "shaders/scene-underwater-world.glsl",
    "spriteHooks": "shaders/scene-underwater-sprite.glsl"
  },
  // ...
}
```

Paths are pack-relative (the scene is inside the pack).

### 9.2 Implementation

Scene-level hooks merge into the pack-default variant — i.e. the
scene's hook map is layered on top of the pack-level hook map
before any per-entity variant is generated:

```
variant 0 source = pack hooks + scene hooks (last-wins per name)
variant N source = pack hooks + scene hooks + entity N's hooks
```

Existing pack-level Mode-1 (full role replacement) at the scene
level is **not** supported in M3 — same reasoning as the per-entity
limitation (§3.3). Logged as a build warning.

### 9.3 Scene reload

Switching scenes calls `loadScene` → `collectSpriteVariants` →
`rebuildSpriteProgram`. Same cost as M1's initial compile.

---

## 10. M4 — Pack-chain cascade

Once [PACK_CHAIN.md](./PACK_CHAIN.md) lands, multiple packs can
each contribute hooks. The cascade extends:

```
Engine identity defaults
  ↑ pack[0] hooks (base pack)
  ↑ pack[1] hooks (extension)
  ↑ pack[2] hooks (...)
  ↑ scene hooks
  ↑ entity hooks
```

Per-pack hooks are last-pack-wins per hook name, then layered
underneath scene + entity tiers as in M3. PACK_CHAIN's existing
soft-override report surfaces conflicting hook names across packs,
same shape as the existing R4 chain conflict logging
([ENGINE_PACK_SHADERS.md §9.3](./ENGINE_PACK_SHADERS.md#93--cross-pack-conflict-detection-soft)).

No new manifest fields — packs continue to ship `shaders.worldHooks`
/ `shaders.spriteHooks`. The cascade is purely a load-time merge.

---

## 11. M5 — Build-time validation

Pack-builder (`apps/pack-builder/src/build-packs.ts`) gains a
validation pass for `Shader` component references:

- Walks `scripts/prefabs/*` and `scripts/systems/*` for
  `api.components.Shader` calls (best-effort regex / AST — same
  approach as PACK_CHAIN's prefab-call audit).
- Every referenced `.glsl` path resolves to a real file in the pack.
- Every referenced file parses cleanly via `parseHookOverrides`.
- Hook names are valid for their declared role (uses the existing
  `hookNamesFor(role)` registry).
- Mode-1 + per-entity conflict: if the pack ships `spriteFrag` (Mode
  1) AND any prefab references a `Shader.spriteHooks`, warns that
  the entity hooks will be silently dropped at runtime (the pack's
  `main()` has no hook call sites).

Failures are warnings, not errors — same severity as existing pack-
builder shader checks. The pack still ships.

---

## 12. Worked examples

### 12.1 Ghost enemy with phasing sprite shader

A modder wants a translucent green wave-y "ghost" zombie variant.

**1. Hook file** — `packages/my-pack/shaders/ghost-sprite.glsl`:

```glsl
// Override 2 of the 8 sprite hooks. Other 6 inherit pack default.
float hook_modifySpriteAlpha(float base, vec2 uv, int layer) {
  // Sin-wave alpha pulse, [0.3, 0.7], 1.5s period.
  float t = sin(/*uTime*/ 0.0 * 4.19) * 0.2 + 0.5;
  return base * t;
}
vec3 hook_modifySpriteFinalColor(vec3 base, int layer, vec2 wp) {
  // Ghostly green tint.
  return base * vec3(0.4, 1.3, 0.5);
}
```

**2. Prefab** — register a "ghost_zombie" variant of an existing
sprite:

```js
api.registerPrefab("ghost_zombie", (x, y) => {
  const e = api.world.spawn();
  api.world
    .add(e, api.components.Position, new api.Vec2(x, y))
    .add(e, api.components.Sprite, {
      imageId: "zombie",
      worldHeight: 0.7,
      yOffset: 0.15,
    })
    .add(e, api.components.Shader, {
      spriteHooks: "shaders/ghost-sprite.glsl",
    });
  return e;
});
```

**3. Spawn it** — `api.spawn("ghost_zombie", 5, 7)` from a script
or `hello.js`. Engine collects the unique Shader value, assigns it
variant id 1 (or wherever), the sprite renders with the wavy green
look while regular zombies stay opaque grey.

### 12.2 Wet-floor cell with reflection bump (M2 preview)

A "wet floor" preset:

```jsonc
// presets/floors.jsonc
{
  "wet_tile_floor": {
    "extends": "tile_floor",
    "shader": "shaders/wet-floor.glsl"
  }
}
```

```glsl
// shaders/wet-floor.glsl
float hook_modifyReflectivity(float base, vec2 cellCoord, int surface) {
  if (surface == 0) return clamp(base * 4.0, 0.0, 0.95);
  return base;
}
```

Authored as a normal preset; only those cells get bumped
reflectivity. (Implementation: M2.)

### 12.3 Underwater scene with global tint (M3 preview)

A scene that's underwater for *every* entity inside it:

```jsonc
{
  "shaders": {
    "spriteHooks": "shaders/underwater-sprite.glsl",
    "worldHooks": "shaders/underwater-world.glsl"
  }
}
```

Two `.glsl` files override `hook_modifySpriteFinalColor` and
`hook_modifyFinalColor` to apply a blue tint and ripple distortion.
Entities can still wear their own `Shader` component on top — a
ghost zombie *underwater* gets green-blue tinting + alpha pulse.

---

## 13. Phases

| Phase | Scope | Where it lives | State |
|---|---|---|---|
| **M1** | **Sprite-only per-entity hooks.** New `Shader` component, variant collection at scene-load, dispatcher in sprite-frag, per-vertex variant id. Default-pack ghost-sprite smoke test (disabled by default). | engine/src/Components/Shader.ts, engine/src/Renderers/ShaderVariants.ts, default-pack/shaders/ghost-sprite.glsl | ✅ Shipped (commit `bdab12a`). |
| **M2** | **Cell materials.** Tile presets gain a `shader` field. `u_sceneShaderVariants` texture. World-frag dispatcher across 27 hooks. | TILE_PRESETS interaction, WebGLRenderer scene textures, HookPrelude/ShaderInjection extension | ✅ Shipped (commit `bdab12a`). |
| **M3** | **Scene-level overrides.** `scene.shaders` field merged into variant 0 hooks. | Scene loader, ShaderVariants merge order | ✅ Shipped (commit `bdab12a`). |
| **M4** | **Pack-chain cascade.** Multi-pack hook layering. Depends on PACK_CHAIN. | ShaderVariants chain walk | ✅ Shipped (commit `be31fea`). Uses `packages/engine/src/Renderers/ShaderChainCascade.ts`. |
| **M5** | **Build-time validation.** Pack-builder verifies every `Shader.spriteHooks` reference. | apps/pack-builder/build-packs.ts | ✅ Shipped (commit `bdab12a`). |

---

## 14. Open questions

1. **Per-variant uniforms.** Today every variant reads the same
   uniform set. Mods that want a per-instance scalar (e.g. "fade
   percent") will overload `a_variant` to encode it, or hardcode it
   per `.glsl`. A `Material` follow-up (with a uniform table) is
   the long-term fix.
2. **Sky-hook entities.** `Shader.skyHooks` is in the schema for
   symmetry but never read by M1. Sensible semantic: a single
   "weather entity" in the scene drives sky overrides? Or scene-
   only? Defer to M2/M3.
3. **MAX_VARIANTS cap.** Each variant is +1 case in N switches +
   N renamed functions. 64 variants per scene seems safe; the
   GLSL compiler / driver-level limits would let us go to 256+.
   For now we don't enforce a cap, just monitor compile times.
4. **Static-light bake interaction.** A per-entity translucent
   sprite doesn't *cast* light differently — the bake doesn't see
   the `Shader` component. Confirming this is fine for v1 since
   sprites don't cast static light anyway; would matter if M2
   introduces emissive-cell shaders that should affect the bake.
5. **Live-edit during dev.** §7.2's warning works for now; future
   editor work likely wants "reserve N spare variant slots" or a
   shadow recompile pipeline.

---

## 15. Implementation summary (M1)

Files touched / added:

- `packages/engine/src/Components/Shader.ts` — **NEW.** `ShaderData`
  interface + `Shader` component singleton.
- `packages/engine/src/Components/index.ts` — re-export.
- `packages/engine/src/ModAPI/ComponentRegistry.ts` — register
  `Shader` in `builtIns`.
- `packages/engine/src/ModAPI/types.ts` — extend
  `BuiltInComponents`.
- `packages/engine/src/Renderers/ShaderVariants.ts` — **NEW.**
  Variant collection + key generation + ParsedHook bundling.
- `packages/engine/src/Renderers/ShaderInjection.ts` — extended
  with `assembleSpriteSource(pack, variants)`.
- `packages/engine/src/Renderers/WebGLRenderer.ts` — vertex format
  +1 attribute (`a_variant`), sprite-program rebuild method,
  variant-aware `drawSprites`.
- `packages/engine/src/Renderers/SceneRenderer.ts` —
  `SpriteDrawRequest.shaderVariant?` field.
- `packages/engine/src/Systems/SpriteRenderSystem.ts` — pass
  variant id per request.
- `packages/engine/src/Game.ts` — post-prefab-spawn variant
  collection + recompile.
- `packages/default-pack/shaders/ghost-sprite.glsl` — **NEW.** Smoke
  test override.
- `packages/default-pack/scripts/hello.js` — opt-in ghost-pack
  variant when a manifest flag is on (and a default-pack
  manifest.json hook).

No new ModAPI methods. No new modules in TwoDRenderer (canvas2d
gracefully ignores per-entity shaders — same shape as today's
ignore-on-canvas2d for Mode 3).

# Engine / Pack split — long-term architectural plan

**Status (2026-05-16):** R0 (monorepo restructure) + R1 (scene
`entities[]` + baked flag + named lookup) + R2 (prefabs in pack) +
R3 (game-specific systems in pack) + R3 follow-up (`api.ui` + pack
`.tsx` pipeline) all shipped. R4 + R5 have been split off to their
own canonical docs — see the dedicated sections below for the
redirect notes. The "phased rollout" subsections below remain for
historical record.

The end-state target: `packages/engine/src/` becomes a **pure
ECS-raycaster engine** with
zero game-specific content. Everything that is "this specific game" —
prefabs, gameplay systems, shaders, the player definition, weapons,
inventory UX — lives in **asset packs**. The default pack
(`packages/default-pack/`) is the standard library; URL-loaded packs
load on top and override piece-by-piece.

The honest test for "done": someone forks the repo, replaces only the
default pack folder, and ships a turn-based dungeon crawler — without
ever touching `packages/engine/src/`. If yes, the architecture is
correct.

This is multi-session refactor work — bigger than the lighting
overhaul. Plan it phased so each step is independently shippable and
the demo keeps rendering between phases.

---

## Architecture at the end

```
packages/engine/src/         ← pure engine
├── ECS/                     World, Component<T>, Entity (already engine)
├── Engine.ts                rAF loop (already engine)
├── Renderers/               Two backends (already engine, content-agnostic)
├── Libs/                    Math + raycast helpers (already engine)
├── Controllers/             Keyboard / Mouse devices (already engine)
├── AssetPack/               Pack loader (already engine)
├── ModAPI/                  The contract for packs (engine surface)
├── Game.ts                  Wires renderer + world + pack-script load
├── Scene/                   Scene loader (grids + entities[])
└── main.ts                  Bootstrap

packages/default-pack/     ← standard library content
├── manifest.json
├── config.json
├── images/                  textures
├── shaders/                 OPTIONAL — overrides engine defaults
├── scripts/
│   ├── prefabs/             player, ammo_pack, torch, ...
│   ├── systems/             PlayerInput, GunRender, Inventory...
│   ├── components/          (most live in engine — see "core API" below)
│   └── boot.js              registers everything above
└── scenes/

packages/<your-mod>/  ← overrides only what you want to change
└── manifest.json
   ↳ "extends": "default"
```

## Core API contract — what stays in `packages/engine/src/`

These are non-negotiable engine concerns:

- **ECS world** — entity creation/deletion, component add/remove,
  query iteration. `World`, `Component<T>`, `Entity`.
- **Frame loop** — `Engine` (rAF), `update` / `render` dispatch.
- **Renderer interface** — `SceneRenderer` (drawSky, drawWorld,
  drawSprites, setDynamicLights, resize, etc.). Two concrete backends
  (CPU + WebGL) ship as engine implementations of the interface.
- **Asset pack loader** — fetch + unzip + index `.apg` files, expose
  `textureBlob`, `textBody`, `has`.
- **Input devices** — `KeyboardController`, `MouseController`. These
  use raw browser APIs and can't live in a pack.
- **Scene loader** — parses `walls/floors/ceilings/entities` from
  JSON, applies the lightmap, spawns entities.
- **Bake script** — `bake-lights.ts` runs at build time on scene
  files, walks `entities[]`, produces the lightmap.
- **ModAPI** — the stable surface every pack consumes. Versioned via
  `manifest.engine`.

Some components MUST stay declared in `packages/engine/src/` because the engine reads
them by name: `Position`, `Facing`, `Camera`, `Light`. The renderer
queries them every frame. Other components — `Inventory`, `Weapon`,
`Pickup`, `Aim`, `Movement`, `PlayerInput` — are game-specific and
move to the default pack.

## ModAPI grows to support engine extension

Pack scripts gain new methods to register engine-side things:

```ts
api.defineComponent(name, schema)        // already supported
api.registerPrefab(name, factory)        // already supported
api.registerSystem(fn)                    // already supported
api.registerRendererSystem(fn, "before-world" | "after-sprites" | ...)
api.registerShader(name, src)            // NEW — pack-shipped shaders
api.overrideShader(name, src)            // NEW — replace engine default
api.findByName(name)                      // NEW — entity lookup
api.onWorldReady(fn)                      // NEW — fires after scene entities spawn
```

Pack scripts get an explicit lifecycle:

1. **Register phase** — synchronous setup. `defineComponent`,
   `registerPrefab`, `registerSystem`, `registerShader`,
   `overrideShader`. No entities spawned yet.
2. **Scene-load phase** — engine instantiates `scene.entities[]`
   using registered prefabs.
3. **World-ready phase** — `onWorldReady(fn)` callbacks fire. Now
   safe to `findByName` and attach extra components, spawn dynamic
   things.

This explicit ordering lets mods reliably extend scene entities by
name without "if entity exists yet" guards.

## Light component gains a `baked` flag

Single `Light` component. Explicit `baked: true | false` field:

```ts
interface LightData {
  color: [number, number, number];
  intensity: number;
  radius: number;
  z?: number;
  /**
   * `true` = include in the bake; engine renders it via the lightmap
   * at zero per-frame cost. Must be on an entity in `scene.entities[]`
   * (NOT mod-spawned) so the build-time bake can see it.
   * `false` = runtime dynamic light; iterated per-frame, supports
   * motion / pulse / spawn-and-despawn.
   */
  baked: boolean;
}
```

Bake script processes `baked: true` entities only. Runtime light
collection iterates `baked: false` entities only. Mod-spawned lights
default to `baked: false` (can't bake what didn't exist at build
time).

## Phased rollout

### R1 — Scene `entities[]` + baked flag + named lookup — ✅ Shipped
**Goal**: scenes describe initial world state via entities. Drop
`scene.spawn` and `scene.lights[]`. Player becomes a `{ prefab:
"player", components: { Position, Facing } }` entry. Bake reads from
entities. Light component gets the `baked` flag.

**Subtasks:**
- Add `SceneJSON.entities[]` typed as `{ name?, prefab?, components }`.
- Add `Scene.entities` runtime array + `world.findByName(name)` helper.
- Move `createPlayer` to a built-in prefab in `packages/engine/src/` (still engine for
  now — moves to default pack in R2).
- Loader walks `entities[]` and spawns each, applying prefab then
  overriding with `components` block.
- Bake reads `entities` for Light components instead of `lights[]`.
- Add `Light.baked` field, default `false` for mod-spawned, `true`
  for scene-declared (or explicit on the entry).
- Migrate the 3 scene JSON files: player as entity, lights as
  entities.
- `onWorldReady` hook in ModAPI for "find after spawn".

**Files**: `packages/engine/src/Scene.ts`, `packages/engine/src/ECS/`,
`packages/engine/src/Components/Light.ts`,
`packages/engine/src/ModAPI/`,
`packages/engine/src/Lighting/Bake.ts` (callsite:
`apps/pack-builder/src/build-packs.ts`), all scene JSONs in
`packages/default-pack/scenes/`,
`packages/default-pack/scripts/hello.js`.

**Estimate**: 1 session.

### R2 — Prefabs move to the default pack — ✅ Shipped
**Goal**: `createPlayer` and any other prefab is content. Engine has
zero hardcoded gameplay.

**Subtasks:**
- Create `packages/default-pack/scripts/prefabs/` directory.
- Move `createPlayer` logic into `player.js` mod prefab.
- Engine bootstrap: load default pack, run its register-phase
  scripts before scene-load so prefabs are available.
- Delete `packages/engine/src/Prefabs/`.

**Files**: `packages/engine/src/Prefabs/` (deleted),
`packages/engine/src/Game.ts`,
`packages/default-pack/scripts/prefabs/`,
`packages/default-pack/manifest.json` (add scripts entries).

**Estimate**: 1 session.

### R3 — Game-specific systems move to packs — ✅ Shipped (incl. R3 follow-up: `api.ui` + pack `.tsx` build, commit `aa069dd`)
**Goal**: gameplay loops live in packs. Engine ships only "pure
infrastructure" systems (renderer, sprite collection, light
collection, modal runner).

**Migrate to default pack:**
- `PlayerInputSystem` — reads input devices via a stable handle the
  ModAPI exposes (`api.input.keyboard.isAnyPressed(codes)`,
  `api.input.mouse.consumeMovement()`, etc.).
- `GunRenderSystem`.
- `PickupSystem`.
- `InventoryScreenSystem`.
- `SettingsScreenSystem`.
- `MinimapRenderSystem`, `ReticleRenderSystem`, `StatsRenderSystem`,
  `InventoryBarRenderSystem` — all HUD overlays.

**ModAPI growth needed:**
- `api.input` exposing `keyboard` + `mouse` (read-only views).
- `api.registerRendererSystem(fn, phase)` so HUD systems can run after
  the world pass.
- `api.modals` — modal registry surface.
- `api.config` — already exists; widen as needed.

**Engine keeps:**
- `SpriteRenderSystem`, `LightCollectionSystem` — they're engine
  bridges from ECS to renderer, not gameplay.

**Files**: `packages/engine/src/Systems/`,
`packages/engine/src/ModAPI/`,
`packages/default-pack/scripts/systems/`.

**Estimate**: 2-3 sessions. The biggest piece because it forces the
ModAPI to grow up.

### R4 — Pack-shipped shaders → see ENGINE_PACK_SHADERS.md

R4's original 17-line stub has been **superseded by
[ENGINE_PACK_SHADERS.md](./ENGINE_PACK_SHADERS.md)** — a six-phase
plan (S1–S6) covering role replacement (Mode 1), post-process
passes (Mode 2), and 38-hook shader hooks (Mode 3), with build-time
validation and pack-chain conflict resolution.

S1–S4 have shipped (commits `0a7fe16`, `c02d280`, `dd2063c`). S5
(validation) and S6 (chain) remain. All new shader work tracks
under that document.

### R5 — Pack override semantics → see PACK_CHAIN.md

R5's original one-page sketch has been **subsumed by
[PACK_CHAIN.md](./PACK_CHAIN.md)** — a full multi-pack design
covering declared dependencies, URL chains, override semantics per
asset type, conflict detection, trust modal, settings UI, and an
optional community store. The asset-type override matrix
(scenes / scripts / shaders / manifest / config) lives in
PACK_CHAIN §7.

P1 has shipped (commit `2edb94a`) — schema additions +
`ChainResolver` + multi-pack `?pack=A&pack=B` chains + trust modal.
P2–P5 (settings UI, SRI tooling, community store, publishing) are
the remaining work.

## Open questions before R1

1. **`findByName` semantics** — unique names (registration error on
   duplicate, returns one entity or undefined) or allow duplicates
   (returns array). Default: unique. Mods need to know which one
   they're attaching to.
2. **Mod-spawned entities + bake** — confirmed never participate in
   the bake. Documented as the contract.
3. **Emissive surfaces** — stay as cell-grid fields (`WallSegment.
   emissive`, `FloorData.emissive`). They're cell-locked, not free
   entities. Different from free-positioned lights. Consistent with
   the "cell data vs free entity" rule.

## Risks & open concerns

- **Cyclic risk**: a pack's scripts register prefabs / systems before
  scene-load, but a pack's SCENES are themselves part of the pack.
  Loader order matters. Cleanest: every pack has a `boot.js` that
  runs first and does all the registration; scenes load after. The
  loader is responsible for the ordering, not the pack author.
- **ModAPI versioning**: once packs depend on it, breaking changes
  require bumps. `manifest.engine: "two_5_d@0.1"` becomes
  load-bearing. Worth adding now.
- **Performance**: pack scripts loaded as Blob URL + dynamic import
  is fine for a handful, would be slow for hundreds. Out of scope
  for our size.
- **Pack-as-source-of-truth means more rebuilds**: edits to default
  pack content require `bun run build-packs` for the dev loop. Today
  the bake auto-runs on `bun run dev`. Confirm same pattern for prefab
  / system source edits.
- **R3 is the biggest jump**: ModAPI has to grow to expose input
  devices, modal registry, renderer hooks, config in a clean,
  stable way. If we do this too early, we end up with churn. Plan a
  ModAPI design pass at the start of R3.

## Bootstrap commands for the fresh session

```sh
cat PLAN.md
cat LIGHTING_OVERHAUL.md
cat LIGHTING_ENTITIES_REFACTOR.md
cat ENGINE_PACK_SPLIT.md           # this file
```

R1 is the prerequisite for everything else AND unblocks the
entities-first lighting refactor. Start there.

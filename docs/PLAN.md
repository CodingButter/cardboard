# two_5_d — project plan & state

A Wolfenstein-style raycaster engine in TypeScript + Bun with two
render backends (canvas2d + WebGL2), a small ECS, a Doom-WAD-style
asset pack pipeline (`.apg` zips), bake-time emissive lighting, and a
HMR-friendly dev server. The game uses the engine; modders ship asset
packs that load on top.

This doc is the **index + current state**. Architectural detail lives
in `docs/plans/*` per topic. Latest session-state snapshot lives at
`docs/SESSION_STATE.md`.

---

## 1. Plan docs (read these when referenced)

| File | Topic | State |
|---|---|---|
| `docs/plans/MONOREPO_PLAN.md` | Workspace restructure — `packages/*` + `apps/*`. Prerequisite for the engine/pack split. | In progress (R0). |
| `docs/plans/ENGINE_PACK_SPLIT.md` | Long-term: `src/` becomes pure engine; all game content lives in packs. | Pending; phases R1–R5. |
| `docs/plans/WALL_OVERHAUL.md` | Variable wall heights, partial walls, top/bottom caps. | Phase 1 + caps shipped; Phase 2 (per-cell floor/ceiling heights) + Phase 3 (partial-width walls) pending. |
| `docs/plans/LIGHTING_OVERHAUL.md` | Bake-heavy emissive lighting model with dynamic-light overlay. | Phases 1, 2, 4, 5 shipped + split-lightmap polish + jittered LOS. Phase 3 (per-wall samples) pending. |
| `docs/plans/LIGHTING_ENTITIES_REFACTOR.md` | Audit + plan for making static lights first-class entities, not scene-data records. | Designed, not yet started; folds into ENGINE_PACK_SPLIT R1. |
| `docs/plans/MULTIPLAYER_PLAN.md` | Networked multiplayer as a drop-in pack. WebSocket-first → WebRTC when needed. Three-repo architecture. | Pending; phases M1–M6; depends on ENGINE_PACK_SPLIT R3. |
| `docs/plans/PACK_CHAIN.md` | Multi-pack loading with declared dependencies, override semantics, optional community store, per-pack user controls in settings, untrusted-source trust modal. Subsumes ENGINE_PACK_SPLIT R5. | Designed; phases P1–P5. |
| `docs/plans/EDITOR.md` | In-browser level + pack editor. Live-mode engine, IndexedDB-backed `EditorAssetPack`, manual bake, `.apg` import/export. | Designed; phases E1–E5. |
| `docs/plans/TILE_PRESETS.md` | Preset-driven tile authoring + tiny scene files. JSONC format with extends + defaults, per-scene idMap + compact grid, build-merge dedupe via content hashes, `PresetResolver`, default-pack migration. | Designed; phases T1–T5. |
| `docs/plans/ENGINE_PACK_SHADERS.md` | R4: optional pack-shipped shaders with auto-injected uniforms. Role replacement + post-process passes + build-time validation + pack-chain conflict resolution. | Designed; phases S1–S4. |
| `docs/plans/STORE.md` | Hosted store website + iframe game runner + per-pack PWA + embed-anywhere widget. Save data namespaced by pack-id. | Designed; phases ST1–ST5. |

When the user names a phase ("R3", "Phase 4 lighting", "M1") look up
the corresponding doc before acting. When they reference "the plan"
generically, read this file first.

---

## 2. Architecture summary (post-monorepo target)

```
packages/engine        @two_5_d/engine — pure ECS + renderer + pack loader
packages/default-pack  @two_5_d/default-pack — standard library content
packages/shared        @two_5_d/shared — protocol/math types client+server agree on
apps/game              the playable build — bootstraps engine + default-pack
apps/pack-builder      build-time scripts (bake-lights, build-packs)
apps/editor            future: in-browser level editor (React + shadcn-ui)
apps/multiplayer-server future: WebSocket/WebRTC game server
docs/                  all plans + session state
```

**Engine concerns** (stay in `packages/engine/`): ECS world, frame
loop, renderer interface, asset pack loader, input devices, scene
loader, bake script. These touch raw browser/Bun APIs and can't
live in a pack.

**Content concerns** (move to packs over R2–R3): prefabs (player,
weapons, items), game-specific systems (PlayerInput, GunRender,
Inventory UX), gameplay components.

**Render flow per frame**:
1. `Engine` rAF → `Game.update` → systems mutate world.
2. `Game.render` → renderer.beginFrame → drawSky → drawWorld →
   drawSprites → endFrame → HUD layers on `renderer.ctx`.

**Renderer backends** implement `SceneRenderer`. Backend chosen at
startup via `CONFIG.rendering.backend` (canvas2d or webgl). Settings
toggle persists and auto-reloads (canvas context type is fixed once
set). WebGL appends a stacked HUD canvas for the 2D overlay.

---

## 3. Asset pack format (`.apg`)

Zip with `.apg` extension. Layout:

```
mypack.apg
├── manifest.json          required at root
├── config.json            optional — deep-merged over baseline
├── scenes/*.json          SceneJSON (walls + floors + ceilings + entities + lightmap)
├── images/*               textures
├── shaders/*              future — pack-shipped fragment/vertex sources
└── scripts/*.js           ES modules; default export receives ModAPI
```

URL params for the running game:
- `?pack=URL` — load a different `.apg`
- `?scene=path` — override start scene

Multi-image item variants discovered by filename suffix:
`name.icon.png` / `name.held.png` / `name.world.png` / `name.png`.
Fallback chain: `icon → held → world → bare`. World variants
auto-register as sprite atlas entries.

---

## 4. ModAPI surface (current)

Pack scripts default-export `(api) => { ... }`:

```ts
api.world: World
api.scene: Scene
api.config: GameConfig
api.components: { Position, Facing, Movement, PlayerInput, Aim,
                  Camera, MinimapMarker, Weapon, Inventory, Pickup,
                  Sprite, Light, ... }
api.Vec2, api.Component

api.defineComponent<T>(name): Component<T>
api.getComponent(name): Component | undefined
api.registerSystem(fn): () => void
api.registerPrefab(name, factory): void
api.spawn(name, ...args): Entity
```

Surfaces still pending (per `ENGINE_PACK_SPLIT.md` R3):
`api.input`, `api.modals`, `api.onWorldReady`, `api.network`,
`api.registerShader`, `api.findByName`.

---

## 5. Build + dev commands

```sh
bun install                     # workspace resolution
bunx tsc -b                     # composite typecheck across all packages
bun run build-packs             # bake + zip → apps/game/public/packs/default.apg
bun --cwd apps/game run dev     # dev server with HMR
bun --cwd apps/game build       # production bundle
```

**Do not** background the dev server from inside the agent shell —
the user runs it in their own terminal. Lingering port-3000 processes
have knocked out VS Code before. Use `bun run kill` (the safe pgrep
killer) to stop a stale dev server.

---

## 6. Operational gotchas worth remembering

- **HMR + pack**: `index.ts` snapshots `world + keyboard + mouse`
  across reloads via `import.meta.hot.data`. Player position survives
  module edits. Pack swaps require a page reload.
- **CONFIG capture timing**: renderer modules dynamically import
  AFTER `applyConfigOverride` so they see merged pack config. Don't
  switch to static imports there.
- **The character/player_idle.fbx (24 MB)** in `default-pack/` is
  unused content the user added. Inflates pack size but doesn't
  affect runtime. Move out or `.gitignore` when ready.
- **Tailwind `@theme`/`@tailwind` warnings on `bun build`** are
  cosmetic — `bun-plugin-tailwind` uses `onBeforeParse` which the
  `bun build` CLI doesn't support. Dev server (`bun --hot`)
  processes Tailwind correctly via `[serve.static]`.
- **WebGL context limits**: one HTMLCanvasElement can only have one
  context type. Renderer backend switching = page reload. HUD lives
  on a stacked 2D canvas overlay in WebGL mode.

---

## 7. Phase status (rolled up)

| Phase | Status |
|---|---|
| Pack format + asset routing | ✅ Done |
| ModAPI + script loading | ✅ Done |
| Defaults moved to default pack | ✅ Done |
| Weapons + Inventory + Pickups + Inventory UX | ✅ Done |
| Sprite billboards (both backends) | ✅ Done |
| Jump + crouch + height-aware collision | ✅ Done |
| Settings menu (Esc) + localStorage + URL profiles + LIVE knobs | ✅ Done |
| Multi-image item variants (filename suffix convention) | ✅ Done |
| Resolution scale + full-window canvas + aspect-correct projection | ✅ Done |
| Mouse-button bindings + conflict warnings | ✅ Done |
| PWA installable + service worker | ✅ Done |
| Wall overhaul Phase 1 (variable heights + caps + multi-slab + per-cell-corner LOS) | ✅ Done |
| Wall overhaul Phase 2 (per-cell floor/ceiling) | ⏳ See `docs/plans/WALL_OVERHAUL.md` |
| Wall overhaul Phase 3 (partial-width walls + true DDA) | ⏳ See `docs/plans/WALL_OVERHAUL.md` |
| Lighting Phases 1, 2, 4, 5 + split-lightmap + K=4 N=4 jitter | ✅ Done |
| Lighting Phase 3 (per-wall samples) | ⏳ See `docs/plans/LIGHTING_OVERHAUL.md` |
| Monorepo restructure (R0) | 🔄 In progress |
| Engine/pack split — R1: scene `entities[]` + named lookup + baked-light flag | ⏳ See `docs/plans/ENGINE_PACK_SPLIT.md` |
| Engine/pack split — R2: prefabs move to pack | ⏳ |
| Engine/pack split — R3: game-specific systems move to pack | ✅ Done — 9 systems moved to `packages/default-pack/scripts/systems/`; modal systems (InventoryScreen/SettingsScreen) deferred pending `api.ui` surface. |
| Engine/pack split — R4: pack-shipped shaders with auto-injected uniforms | 🎨 Designed — see `docs/plans/ENGINE_PACK_SHADERS.md`; impl pending. |
| Engine/pack split — R5: pack override semantics (default pack + URL override) | ⏳ |
| Multiplayer M1: net primitives (NetworkId, Replicate, api.network) | ⏳ See `docs/plans/MULTIPLAYER_PLAN.md` |
| Editor app (apps/editor — React + Tailwind + shadcn-ui) | ⏳ Scaffold-only after monorepo lands |

---

## 8. Where state goes when context compacts

- **`docs/SESSION_STATE.md`** — open tasks, recent decisions, file map
  for whatever was just shipped. Rewrite after substantial work.
- **This file** — table of plan docs + phase status. Update the table
  when phases ship or new plans land.
- **Per-plan docs** in `docs/plans/` — capture design rationale and
  phased rollouts. Update inside the doc as phases ship.

The smoke test recipe (`bunx tsc -b` + `bun run build-packs` + `bun
--cwd apps/game build`) should pass at the end of every session.

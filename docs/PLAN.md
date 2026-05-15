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
| `docs/plans/MONOREPO_PLAN.md` | Workspace restructure — `packages/*` + `apps/*`. Prerequisite for the engine/pack split. | ✅ Landed. |
| `docs/plans/ENGINE_PACK_SPLIT.md` | Long-term: `src/` becomes pure engine; all game content lives in packs. | R0–R3 + R3-followup landed; R5 pending. R4 split off into ENGINE_PACK_SHADERS.md. |
| `docs/plans/WALL_OVERHAUL.md` | Variable wall heights, partial walls, top/bottom caps. | Phase 1 + caps shipped; Phase 2 (per-cell floor/ceiling heights) + Phase 3 (partial-width walls) pending. |
| `docs/plans/LIGHTING_OVERHAUL.md` | Bake-heavy emissive lighting model with dynamic-light overlay. | Phases 1, 2, 4, 5 shipped + split-lightmap polish + jittered LOS. Phase 3 (per-wall samples) pending. |
| `docs/plans/LIGHTING_ENTITIES_REFACTOR.md` | Audit + plan for making static lights first-class entities, not scene-data records. | Designed, not yet started; folds into ENGINE_PACK_SPLIT R1. |
| `docs/plans/MULTIPLAYER_PLAN.md` | Networked multiplayer as a drop-in pack. WebSocket-first → WebRTC when needed. Three-repo architecture. | Pending; phases M1–M6; depends on ENGINE_PACK_SPLIT R3. |
| `docs/plans/PACK_CHAIN.md` | Multi-pack loading with declared dependencies, override semantics, optional community store, per-pack user controls in settings, untrusted-source trust modal. Subsumes ENGINE_PACK_SPLIT R5. | Designed; phases P1–P5. |
| `docs/plans/EDITOR.md` | In-browser level + pack editor. Live-mode engine, IndexedDB-backed `EditorAssetPack`, manual bake, `.apg` import/export. | Designed; phases E1–E5. |
| `docs/plans/TILE_PRESETS.md` | Preset-driven tile authoring + tiny scene files. JSONC format with extends + defaults, per-scene idMap + compact grid, build-merge dedupe via content hashes, `PresetResolver`, default-pack migration. | T1 + T2 shipped (resolver + migration + build-merge); T3–T5 pending. |
| `docs/plans/ENGINE_PACK_SHADERS.md` | R4: optional pack-shipped shaders with auto-injected uniforms. Three modes — role replacement, shader hooks (38), post-process passes — build-time validation + pack-chain conflict resolution. | S1–S3 shipped (role replacement + helper promotion + 38-hook system); S4 (post-passes), S5 (validation), S6 (chain) pending. |
| `docs/plans/STORE.md` | Hosted store website + iframe game runner + per-pack PWA + embed-anywhere widget. Save data namespaced by pack-id. | Designed; phases ST1–ST5. Game-embed iframe live on docs landing as a proof-of-concept (https://codingbutter.github.io/cardboard/). |

When the user names a phase ("R3", "Phase 4 lighting", "M1") look up
the corresponding doc before acting. When they reference "the plan"
generically, read this file first.

---

## 2. Architecture summary

```
packages/engine         @two_5_d/engine — pure ECS + renderer + pack loader
packages/default-pack   @two_5_d/default-pack — standard library content
packages/shared         @two_5_d/shared — protocol/math types client+server agree on
apps/game               the playable build — bootstraps engine + default-pack
apps/pack-builder       build-time scripts (bake-lights, build-packs, .tsx pack-script bundling)
apps/editor             in-browser level editor (React + Tailwind + shadcn — scaffold)
apps/docs               documentation site (Fumadocs + Next + MDX → GitHub Pages)
apps/multiplayer-server (future) — WebSocket/WebRTC game server
docs/                   all plans + session state
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
// World + scene + config
api.world: World
api.scene: { size, isWall, canPlayerPass, maxHeadroom, ... }
api.config: GameConfig
api.pack.manifest: PackManifest

// Components + ECS
api.components: { Position, Facing, Movement, PlayerInput, Aim,
                  Camera, MinimapMarker, Weapon, Inventory, Pickup,
                  Sprite, Light, ... }
api.Vec2
api.defineComponent<T>(name): Component<T>
api.getComponent(name): Component | undefined

// Systems + prefabs
api.registerSystem(fn): () => void
api.registerRendererSystem(fn, phase): void   // phase = before-world|after-world|after-sprites|hud
api.registerPrefab(name, factory): void
api.spawn(name, opts?): Entity
api.onWorldReady(fn): void

// Input
api.input.keyboard            // KeyboardInputAPI — raw key state
api.input.mouse               // MouseInputAPI — raw button/position
api.input.isBindingPressed(action): boolean

// Modal coordination
api.modals.setOpen(name, open): void
api.modals.isOpen(name): boolean
api.modals.any(): boolean
api.modals.anyOther(name): boolean

// Pack-side UI (R3 follow-up)
api.ui.registerModal(name, Component, propsFn?): void
api.ui.unregisterModal(name): void

// Inventory + items
api.inventory.{ BAG_SIZE, HOTBAR_SIZE, EQUIP_SLOTS, defaultStackMax,
                emptyEquipment, seedInventory, addItem, removeItem,
                countItem, getActiveItem, quickTransfer }

// Item-image cache
api.itemImages.get(itemId, variant?)   // "icon" | "held" | "world"

// Settings (live config + persistence + import/export)
api.settings.{ load, save, export, import }
api.bindings.label(code): string

// Raycaster utilities (for pack-side minimap, AI sight checks, etc.)
api.raycast.castRayToWall(origin, dir): WallHit | null
```

Pending (not yet implemented): `api.network` (multiplayer M1),
`api.registerShader` (S4 post-passes — shader hooks already ship
via manifest, not ModAPI).

---

## 5. Build + dev commands

```sh
bun install                     # workspace resolution
bun run typecheck               # workspace-wide typecheck
bun run build-packs             # bake + zip → apps/game/public/packs/default.apg
bun run dev                     # dev server with HMR (game runner)
bun run build                   # production bundle (game runner)
bun run docs:dev                # docs site dev (next dev on apps/docs)
bun run docs:build              # docs static export → out/ for GH Pages
bun run build:game-for-docs     # stage built game into apps/docs/public/play/
```

Note: `bun --cwd <dir> ...` has been historically flaky in this
repo's Bun version — the root `bun run <script>` shorthands above
all wrap `cd apps/<X> && bun run <script>` instead.

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
| Monorepo restructure (R0) | ✅ Done — `packages/*` + `apps/*` Bun workspaces |
| Engine/pack split — R1: scene `entities[]` + named lookup + baked-light flag | ✅ Done |
| Engine/pack split — R2: prefabs move to pack | ✅ Done — player prefab in `packages/default-pack/scripts/prefabs/` |
| Engine/pack split — R3: game-specific systems move to pack | ✅ Done — all 11 systems (incl. modal screens via `api.ui`) in `packages/default-pack/scripts/systems/` |
| Engine/pack split — R3 follow-up: `api.ui` + pack-script .tsx pipeline | ✅ Done — `Bun.build` compiles pack `.tsx`; Preact externalized via `installPreactRuntime` |
| Engine/pack split — R4 (S1–S3): pack-shipped shaders w/ role replacement + 38 hooks | ✅ Done — see `docs/plans/ENGINE_PACK_SHADERS.md`; S4 (post-passes), S5 (validation), S6 (chain) pending |
| Engine/pack split — R5: pack override semantics (default pack + URL override) | ⏳ |
| Tile presets — T1+T2: PresetResolver + JSONC + idMap scenes + build-merge dedupe | ✅ Done — default-pack migrated; legacy bare-int scenes still parse via shim |
| Tile presets — T3+: validation, editor authoring, preset-library packs | ⏳ See `docs/plans/TILE_PRESETS.md` |
| Multiplayer M1: net primitives (NetworkId, Replicate, api.network) | ⏳ See `docs/plans/MULTIPLAYER_PLAN.md` |
| Editor app (apps/editor — React + Tailwind + shadcn) | ⏳ Scaffold landed; design in `docs/plans/EDITOR.md` |
| Docs site (apps/docs — Fumadocs + GH Pages) | ✅ Live at https://codingbutter.github.io/cardboard/ — guides, plan-doc mirror, API ref, playable iframe |

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

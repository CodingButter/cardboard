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
| `docs/plans/ENGINE_PACK_SPLIT.md` | Long-term: `src/` becomes pure engine; all game content lives in packs. | R0–R3 + R3-followup landed. R4 split off into ENGINE_PACK_SHADERS.md. R5 subsumed by PACK_CHAIN.md. |
| `docs/plans/WALL_OVERHAUL.md` | Variable wall heights, partial walls, top/bottom caps. | Phase 1 + caps shipped; Phase 2 (per-cell floor/ceiling heights) + Phase 3 (partial-width walls) pending. |
| `docs/plans/LIGHTING_OVERHAUL.md` | Bake-heavy emissive lighting model with dynamic-light overlay. | Phases 1, 2, 4, 5 shipped + split-lightmap polish + jittered LOS. Phase 3 (per-wall samples) pending. |
| `docs/plans/LIGHTING_ENTITIES_REFACTOR.md` | Audit + plan for making static lights first-class entities, not scene-data records. | Designed, not yet started; folds into ENGINE_PACK_SPLIT R1. |
| `docs/plans/MULTIPLAYER_PLAN.md` | Networked multiplayer as a drop-in pack. WebSocket-first → WebRTC when needed. Three-repo architecture. | Pending; phases M1–M6; depends on ENGINE_PACK_SPLIT R3. |
| `docs/plans/PACK_CHAIN.md` | Multi-pack loading with declared dependencies, override semantics, optional community store, per-pack user controls in settings, untrusted-source trust modal. Subsumes ENGINE_PACK_SPLIT R5. | Designed; phases P1–P5. |
| `docs/plans/EDITOR.md` | In-browser level + pack editor. Live-mode engine, IndexedDB-backed `EditorAssetPack`, manual bake, `.apg` import/export. | Designed; phases E1–E5. |
| `docs/plans/TILE_PRESETS.md` | Preset-driven tile authoring + tiny scene files. JSONC format with extends + defaults, per-scene idMap + compact grid, build-merge dedupe via content hashes, `PresetResolver`, default-pack migration. | T1 + T2 shipped (resolver + migration + build-merge); T3–T5 pending. |
| `docs/plans/ENGINE_PACK_SHADERS.md` | R4: optional pack-shipped shaders with auto-injected uniforms. Three modes — role replacement, shader hooks (38), post-process passes — build-time validation + pack-chain conflict resolution. | S1–S3 shipped (role replacement + helper promotion + 38-hook system); S4 (post-passes), S5 (validation), S6 (chain) pending. |
| `docs/plans/STORE.md` | Hosted store website + iframe game runner + per-pack PWA + embed-anywhere widget. Save data namespaced by pack-id. | Designed; phases ST1–ST5. Game-embed iframe live on docs landing as a proof-of-concept (https://codingbutter.github.io/cardboard/). |
| `docs/plans/MATERIALS.md` | Per-entity shader attachment (three-tier cascade: pack → scene → material). `Shader` ECS component holding sprite/world/sky hook paths; engine assembles one program with per-pixel branching by variant id. | M1+M2+M3+M5 shipped (commit `bdab12a`), M4 pack-chain cascade shipped (commit `be31fea`). All five phases done. |
| `docs/plans/ANIMATIONS.md` | Frame-based sprite animation + Doom-style multi-angle (1/2/4/5/8/16) view-dependent sprites. `Animation` component + `AnimationSystem` + `api.anim`. | A1 shipped (commit `ab9dbee`). A2 (mirror + crossfade + events), A3 (editor authoring), A4 (hierarchical) pending. |
| `docs/plans/ANIMATION_EDITOR.md` | In-editor animation authoring. Path A (bring-your-own spritesheet / loose frames) + Path B (FBX auto-render via Three.js + FBXLoader) → canonical multi-angle sheet. | AE1 shipped (commit `52d8e27`). AE2 (FBX importer) in progress (agent #200). AE3 polish pending. |
| `docs/plans/AUDIO.md` | Web Audio gain graph + `api.audio.{play,playLoop,playReplace,stop,stopAll}` + 5-group mixer + spatial audio. Sounds declared in `manifest.sounds`. | Au1 shipped (commit `52d8e27`); Au2 (spatial + music + ducking), Au3 (editor authoring), Au4 (reverb) pending. |
| `docs/plans/EVENTS.md` | Synchronous pub/sub pack interop bus. `api.events.{on,once,off,emit}` + 25 canonical engine topics + auto-cleanup on pack reload. | Ev1 shipped (commit `52d8e27`). Ev2 (wildcards + manifest declarations), Ev3 (editor event log) pending. |
| `docs/plans/EDITOR_IFRAME.md` | Editor runs the engine via iframe (`?source=editor`) instead of in-process. Same-origin IDB sharing + postMessage protocol for live invalidation. | I1 shipped (commit `ab9dbee`). I2 (player-state telemetry + edit-camera), I3 (script + manifest hot-reload) pending. |
| `docs/plans/EDITOR_REDESIGN.md` | Full editor visual overhaul. R1 shell + sidebar + tab strip; R2 theme; R3 view switcher; R4 per-view migrations (Map / Entities / Animation / Image Lab / Sound Lab / Project / Viewport / UI Builder); R5 polish. | R1–R3 + R4a–R4h shipped (most R4 views recovered via transcript replay after the 2026-05-17 reset incident). R4i (UI Builder view stub, #223) + R5 pending. |
| `docs/plans/IMAGE_LAB.md` | In-editor procedural image authoring + texture pipeline. | IL1 plan + IL2 runtime shipped. IL3–IL7 pending (#229–#233). |
| `docs/plans/SOUND_LAB.md` | In-editor sound authoring + envelope/effect graph. | SL1 plan shipped. SL2 runtime in progress (#236). SL3–SL7 pending (#237–#241). |
| `docs/plans/WORLD_STATE.md` | Data-first engine overhaul — scene state as a single document, observable mutations, editor as the canonical authoring surface. | #294 landed (scaffolding + initial migration). Next phase tracked as #293. |
| `docs/plans/PREFABS_EDITOR_ONLY.md` | Prefabs are pure component bundles authored in the editor — no `initScript`. Dynamic behavior belongs in systems. | PE1–PE3 landed. |
| `docs/plans/UI_BUILDER.md` | Visual UI authoring inside the editor — drag-arrange Preact components, bind to `api.ui` modals. | Planned. R4i editor view stub pending (#223). |
| `docs/plans/TUTORIALS.md` | In-editor guided tutorials — step-by-step overlays driven by pack-declared lessons. | Planned. |
| `docs/plans/RESPONSIVE_DESIGN.md` | Editor + game layout adapt to viewport size (mobile, tablet, desktop, ultrawide). | Planned (#244). |
| `docs/plans/CLOUD_SYNC.md` | Optional Supabase-backed pack sync — projects, assets, collaboration. | Planned (#251). |

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
apps/editor             in-browser level editor (React + Tailwind + shadcn — functional; iframe engine runner, Map/Entities/Animation modes, Project Settings modal)
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

// Audio (Au1)
api.audio.play(soundId, opts?): AudioHandle
api.audio.playLoop(soundId, opts?): AudioHandle
api.audio.playReplace(soundId, opts?): AudioHandle
api.audio.stop(handle): void
api.audio.stopAll(group?): void

// Animation (A1)
api.anim.play(entity, animName, opts?): void
api.anim.pause(entity): void
api.anim.resume(entity): void
api.anim.stop(entity): void
api.anim.onComplete(entity, fn): void

// Events (Ev1) — 25 canonical engine topics + pack-defined
api.events.on(name, fn): EventSubscription
api.events.once(name, fn): EventSubscription
api.events.off(name, fn): void
api.events.emit(name, payload?): void

// Entity lookup (R2)
api.world.findByName(name): Entity | undefined

// Declarative prefabs (commit d8fcbe7)
api.registerDeclarativePrefab(name, decl): void   // static component list + optional initScript

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
`api.console` (CONSOLE plan — not yet written; agent #199).
`api.registerShader` lives in manifest (not ModAPI) — Mode 1 + Mode
3 ship via `manifest.shaders.{role}Frag` and `.{role}Hooks`.

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
  the load-bearing acceptance fixture for ANIMATION_EDITOR AE2 —
  the FBX importer re-bakes it and bytewise-compares the output
  against a checked-in expected sheet. Keep it in the pack until
  AE2 lands and the fixture moves to a test-only location.
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
| Engine/pack split — R4 (S1–S4): pack-shipped shaders w/ role replacement + 38 hooks + post-process passes | ✅ Done — S1 (`0a7fe16`), S2+S3 (`c02d280`), S4 (`dd2063c`); see `docs/plans/ENGINE_PACK_SHADERS.md`. S5 (validation), S6 (chain) pending |
| Engine/pack split — R4: split into ENGINE_PACK_SHADERS.md | ✅ See ENGINE_PACK_SHADERS row |
| Engine/pack split — R5: pack override semantics | ✅ Subsumed by PACK_CHAIN — see `docs/plans/PACK_CHAIN.md` |
| Tile presets — T1+T2: PresetResolver + JSONC + idMap scenes + build-merge dedupe | ✅ Done — default-pack migrated; legacy bare-int scenes still parse via shim |
| Tile presets — T3+: validation, editor authoring, preset-library packs | ⏳ See `docs/plans/TILE_PRESETS.md` |
| Materials M1+M2+M3+M5: per-entity Shader component + cell materials + scene overrides + build-time validation | ✅ Done (commit `bdab12a`) — see `docs/plans/MATERIALS.md` |
| Materials M4: pack-chain shader cascade | ✅ Done (commit `be31fea`) |
| Animations A1: `Animation` component + `AnimationSystem` + `api.anim` + multi-angle snap selection + canonical atlas | ✅ Done (commit `ab9dbee`) — see `docs/plans/ANIMATIONS.md`; A2 (mirror + crossfade + events), A3 (editor), A4 (hierarchical) pending |
| Animation editor AE1: Path A (bring-your-own spritesheet / loose frames) | ✅ Done (commit `52d8e27`) — see `docs/plans/ANIMATION_EDITOR.md`; AE2 (FBX importer) staged (smoke-fbx-bake 90/90; lazy-loaded Three.js code-split + FbxImporter modal + planFbxBake/buildFbxSpriteState reuse AE1 compositor math), AE3 (polish) pending |
| Audio Au1: Web Audio gain graph + `api.audio.*` + 5-group mixer + Settings sliders | ✅ Done (commit `52d8e27`) — see `docs/plans/AUDIO.md`; Au2 (spatial + music), Au3 (editor), Au4 (reverb) pending |
| Events Ev1: synchronous pub/sub bus + canonical engine topics + pack-tagged auto-cleanup | ✅ Done (commit `52d8e27`) — see `docs/plans/EVENTS.md`; Ev2 (wildcards), Ev3 (editor event log) pending |
| Editor iframe pivot I1: `?source=editor` iframe runner + IdbAssetPack engine-side + postMessage bridge | ✅ Done (commit `ab9dbee`) — see `docs/plans/EDITOR_IFRAME.md`; I2 (telemetry + edit-camera), I3 (script hot-reload) pending |
| PACK_CHAIN P1: schema additions + ChainResolver + multi-pack `?pack=URL` chains + trust modal | ✅ Done (commit `2edb94a`) — see `docs/plans/PACK_CHAIN.md`; P2–P5 pending |
| Multiplayer M1: net primitives (NetworkId, Replicate, api.network) | ⏳ Unblocked (R3 + Ev1 + Au1 + A1 all landed). See `docs/plans/MULTIPLAYER_PLAN.md` |
| Editor app (apps/editor — React + Tailwind + shadcn) | ✅ E1–E4 + AE1 + Entities workflow tab + Project Settings modal + dependency manager shipped. See `docs/plans/EDITOR.md` + `docs/plans/EDITOR_IFRAME.md` |
| Editor redesign — R1–R3 + R4a–R4h | ✅ Shipped. R4 views (Map / Entities / Animation / Image Lab / Sound Lab / Project / Viewport / FbxImporter) recovered via transcript replay 2026-05-17. R4i (UI Builder, #223) + R5 pending |
| Image Lab IL1 + IL2 | ✅ Plan + runtime shipped. IL3–IL7 pending (#229–#233) |
| Sound Lab SL1 | ✅ Plan shipped. SL2 runtime in progress (#236). SL3–SL7 pending (#237–#241) |
| WORLD_STATE — data-first engine overhaul (#294) | ✅ Scaffolding + initial migration landed. Next phase #293 |
| WORLD_STATE — `world.json` full-scope (entities + scripts) | ✅ 2026-05-17 — `world.json` is now the authoritative world-scope authoring surface: singletons + persistent entities + scripts. The default-pack player is a persistent world entity declared in `world.json.entities[]`; entity-attach script (`scripts/setup/player-init.js`) wires runtime-dependent components, and `scripts/systems/scene-transition.js` repositions the player on every `scene:loaded` from the controller's `SpawnerList.points[0]`. `manifest.scripts[]` retired; pack-builder walks `world.json.scripts[]` + `Scripts.refs[]` from world entities + scene controllers. `Scene.spawn` / `SceneSpawn` / `synthesiseControllerFromSpawn` / `DEFAULT_SPAWN` / `api.scene.spawn` all removed — no back-compat. Engine adds `world.findByName(name)` + `_worldPersistent` skip-despawn machinery + `pack.readScripts(paths)`. |
| Prefabs editor-only (PE1–PE3) | ✅ Shipped — declarative-only prefabs; no `initScript`. Re-implemented 2026-05-17 after the recovery wipe; see `PREFABS_EDITOR_ONLY.md` §17 |
| Engine unopinionated — game-specific components moved to pack | ✅ 2026-05-17 — `PlayerInput` / `Movement` / `Weapon` / `Inventory` / `MinimapMarker` / `Pickup` deleted from engine built-ins, instantiated from `manifest.components[]`. `api.components` is a proxy that resolves through the full registry. Engine built-ins slimmed to render/lifecycle infra only (Position/Facing/Aim/Camera/Sprite/Animation/Light/Shader). Scene-entity load loop in `Game.spawnSceneEntities`. `player:moved` emission moved pack-side. See `PREFABS_EDITOR_ONLY.md` §17 + `WORLD_STATE.md` §11.6 |
| Docs site (apps/docs — Fumadocs + GH Pages) | ✅ Live at https://codingbutter.github.io/cardboard/ — guides, plan-doc mirror, API ref, playable iframe |
| Recovery 2026-05-17 | ✅ ~60 files reconstructed via transcript-replay engine across commits `4d3c1e9` → `93fb93d` (+ dedup) after sandbox reset incident wiped tracked-file modifications |

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

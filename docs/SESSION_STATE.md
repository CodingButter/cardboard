# Session state — context-survival snapshot

Pair this with `PLAN.md` and the phase-specific docs under
`docs/plans/`. Fresh session? Read `docs/PLAN.md` first, this
second, then the phase doc for whatever you're working on.

Date of last update: **2026-05-17**.

---

## 1. What just shipped

Chronological since 2026-05-15:

-1. **(uncommitted, 2026-05-17)** — WORLD_STATE "world.json
   full-scope" pass. `world.json` is now the authoritative
   world-scope authoring surface — singletons + persistent
   entities + scripts. The default-pack player is a persistent
   world entity declared in `world.json.entities[]` (Position /
   Facing / Aim / `Scripts.refs: ["scripts/setup/player-init.js"]`).
   The engine spawns it ONCE at boot, flags it `_worldPersistent`,
   and the `Game.loadScene` despawn pass skips persistent ids.
   `scripts/setup/player-init.js` (entity-attach script) wires
   Movement / PlayerInput / Weapon / Camera / MinimapMarker /
   Inventory at attach time so they can read live `api.config` /
   `api.pack.manifest`. `scripts/systems/scene-transition.js`
   (world-scope script) subscribes to `scene:loaded` and
   repositions the player at the new scene's
   `controller.components.SpawnerList.points[0]`. Every
   `Scene.spawn` back-compat surface ripped: `SceneSpawn`,
   `DEFAULT_SPAWN`, `synthesiseControllerFromSpawn`,
   `api.scene.spawn`, `SceneJSON.spawn`, the spawn-reset logic in
   `Game.loadScene`. `manifest.scripts[]` retired; world.json
   scripts list now drives everything. Pack-builder walks
   `world.json.scripts[]` + `Scripts.refs[]` to discover compilable
   pack scripts. World gains `setName(id, name)` /
   `findByName(name)` / `liveEntities()`. Default-pack scenes
   stripped of top-level `spawn` fields; manifest.json no longer
   ships `scripts`. Engine's `pack.scripts()` replaced with
   `pack.readScripts(paths)`. New `WorldJson` interface on
   `Game`. Editor MutableScene gains `controller`; GridEditor
   spawn handle reads from SpawnerList; smoke tests migrated.
0. **(uncommitted earlier 2026-05-17)** — engine maximally-unopinionated
   pass + PE2/PE3 re-implementation after the recovery wipe.
   Engine built-ins slimmed to render/lifecycle infrastructure
   (Position/Facing/Aim/Camera/Sprite/Animation/Light/Shader);
   PlayerInput/Movement/Weapon/Inventory/MinimapMarker/Pickup
   moved to `manifest.components[]` (instantiated as
   `Component<unknown>` at boot, resolved through `api.components`
   proxy under their string name). Prefab runtime deleted —
   `registerDeclarativePrefabs`, `PrefabRegistry`,
   `api.registerPrefab/spawn/spawnPrefab`, `DeclarativePrefab.initScript`
   all gone. `Game.spawnInitialEntities` now walks
   `scene.entities[]` (PREFABS_EDITOR_ONLY.md §4.2);
   default-pack ships `scripts/systems/player-spawn.js` wired
   into `manifest.scripts[]`. `player:moved` emission moved
   pack-side (player-input.js owns the throttled emit).
   `KeyBindings` type relocated to `Controllers/Bindings.ts`.
1. **`0b3118f`** — EDITOR_REDESIGN R1 plan doc (full editor visual
   overhaul).
2. **`af30aa7`** — editor-redesign decisions resolved (Q1–Q4) +
   UI Builder + engine/pack UI split.
3. **`4d3c1e9`** — *Checkpoint commit* after sandbox reset incident.
   Captures untracked work: R3 EditorShell, R4 view stubs, plan docs
   for IMAGE_LAB / SOUND_LAB / UI_BUILDER / PREFABS_EDITOR_ONLY /
   TUTORIALS / RESPONSIVE_DESIGN / CLOUD_SYNC / WORLD_STATE, plus
   the data-first engine overhaul scaffolding (#294) and pack icon
   pipeline (#295).
4. **`3beee7e`** — fix: mount `EditorShell` in `App.tsx`
   (the sandbox reset had reverted the mount).
5. **`47103e1`** — *Recovery batch 1*: 35 files reconstructed from
   agent transcripts via the replay engine.
6. **`4504547`** — *Recovery batch 2*: 24 more files reconstructed
   (only kept when bigger than the legacy version).
7. **`2391f5b`** — recover: `FbxImporter` dedup + partial edits.
8. **`740369d`** — recover: scene-view chain (`MapView`,
   `ProjectView`, `EditorViewport`, `GridEditor`) partial edits.
9. **`93fb93d`** — recover: `ModAPIImpl` + `AudioRegistry` partial
   edits.
10. **`<dedup>`** (landing now) — engine `ShaderVariants.ts`
    duplications removed; `WebGLRenderer.embedHud` field restored.

### Major plan-doc landings this window

`IMAGE_LAB.md`, `SOUND_LAB.md`, `WORLD_STATE.md`,
`PREFABS_EDITOR_ONLY.md`, `UI_BUILDER.md`, `TUTORIALS.md`,
`RESPONSIVE_DESIGN.md`, `CLOUD_SYNC.md`.

---

## 2. The recovery incident

**What happened.** A multi-hour session inside a sandbox worktree
ran with a `git reset --hard HEAD` hook on shell exit. The hook
kept wiping modifications to tracked files between agent dispatches
while leaving untracked-new files intact. Result: most R-phase
edits to existing files vanished as soon as the dispatching agent
returned.

**Diagnosis.** The worktree was a sandbox copy of `HEAD` with no
intermediate commits; every reset rolled back to the snapshot the
worktree had been spawned from. Untracked files survived because
`reset --hard` only touches tracked paths.

**Fix.** Commit early (the `4d3c1e9` checkpoint) to convert
untracked work into the new `HEAD`, then run an automated
transcript-replay engine over the agent transcripts to reconstruct
modifications to tracked files from the diffs the agents had
authored.

**Scope.** ~60 files restored across `47103e1`, `4504547`,
`2391f5b`, `740369d`, `93fb93d` (+ the dedup commit). ~66
smaller-recovered candidates were skipped because their replayed
size was less than the legacy version (would have been a
regression). A few R4 prop chains — notably `GridEditor`'s
`layer`/`tool` as props — didn't survive because the latest
agent's edits referenced state that no longer matched the
checkpointed shell.

**Confirmed-recovered.** EditorShell mount; R4 view bodies for
Map / Entities / Animation / Image Lab / Sound Lab views;
`AnimationEditor` chain; `FbxImporter`; engine `ShaderVariants` /
`ShaderInjection` / `PostPassChain` / `WebGLRenderer` rewires;
`ModAPIImpl` audio wiring; `IdbAssetPack` + declarative prefab
registrar.

**Known-partial.** GridEditor prop wiring (re-do likely needed);
some IL2 / SL2 secondary surfaces; anything depending on the R4
state shape post-checkpoint.

---

## 3. Open tasks

### In progress

- **#225** — Image Lab IL2 runtime polish
- **#236** — Sound Lab SL2 runtime stub
- **#260** — Pack icon pipeline (#295 follow-on)
- **#288** — R4 editor view migrations (Map / Entities etc.)
- **#293** — Data-first engine overhaul follow-up (#294)

### Queued — engine

- **#192** — Pack export modes (BUILD FULL vs EXTEND)
- **#247** — Engine surface for data-first scene refactor
- **#248** — Pack icon pipeline finishing touches
- **#294** — WORLD_STATE data-first overhaul next phase
- **#295** — Pack icon pipeline next phase

### Queued — editor

- **#223** — UI Builder view stub (R4i)
- **#224** — Editor R5 polish pass
- **#278** — R4 GridEditor prop re-wire (recovery follow-on)
- **#285** — R4 view re-verification post-recovery
- **#289** — Editor shell HMR survival
- **#292** — R4 view migration QA

### Queued — plan-only

- **#229** — IMAGE_LAB IL3
- **#230** — IMAGE_LAB IL4
- **#231** — IMAGE_LAB IL5
- **#232** — IMAGE_LAB IL6
- **#233** — IMAGE_LAB IL7
- **#237** — SOUND_LAB SL3
- **#238** — SOUND_LAB SL4
- **#239** — SOUND_LAB SL5
- **#240** — SOUND_LAB SL6
- **#241** — SOUND_LAB SL7

---

## 4. File-touched map

| File | Role now |
|------|----------|
| `apps/editor/src/EditorShell.tsx` | R3 shell — top-level layout, view switcher |
| `apps/editor/src/App.tsx` | Mounts `EditorShell` (re-fixed in `3beee7e`) |
| `apps/editor/src/views/MapView.tsx` | R4a — map view container (delegates to GridEditor) |
| `apps/editor/src/views/GridEditor.tsx` | R4 grid editor — recovered, prop chain partial |
| `apps/editor/src/views/EntitiesEditor.tsx` | R4b — entities workflow tab |
| `apps/editor/src/views/AnimationEditor.tsx` | R4c — AE1 + AE2 host |
| `apps/editor/src/views/FbxImporter.tsx` | R4c — Three.js FBX modal (dedup'd) |
| `apps/editor/src/views/ImageLabView.tsx` | R4d — IL2 runtime |
| `apps/editor/src/views/SoundLabView.tsx` | R4e — SL2 runtime stub |
| `apps/editor/src/views/ProjectView.tsx` | R4f — project root view |
| `apps/editor/src/views/EditorViewport.tsx` | iframe runner host (I1) |
| `packages/engine/src/Renderers/ShaderVariants.ts` | Variant table — dedup'd post-recovery |
| `packages/engine/src/Renderers/WebGLRenderer.ts` | `embedHud` field restored |
| `packages/engine/src/Renderers/ShaderInjection.ts` | Hook injection — recovered |
| `packages/engine/src/Renderers/PostPassChain.ts` | Post-pass driver — recovered |
| `packages/engine/src/ModAPI/ModAPIImpl.ts` | Audio wiring — partial recovery |
| `packages/engine/src/ModAPI/AudioRegistry.ts` | Au1 — partial recovery |
| `packages/engine/src/AssetPack/IdbAssetPack.ts` | Editor IDB pack — recovered |
| `packages/engine/src/AssetPack/registerDeclarativePrefabs.ts` | Hybrid prefab registrar — recovered |
| `docs/plans/{IMAGE_LAB,SOUND_LAB,WORLD_STATE,...}.md` | New plan docs (this window) |

---

## 5. Decisions still pending

- None acute. Flag: some recovered R4 GridEditor work may still
  need a redo pass once the user verifies which prop chains broke
  in practice. Track as #278 / #285.
- The replay engine is a one-shot — don't re-run it without a fresh
  reset incident; the transcripts have been consumed.

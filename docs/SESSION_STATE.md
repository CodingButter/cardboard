# Session state — context-survival snapshot

Written just before a context compaction so nothing important
disappears. Pair this with `PLAN.md` and the phase-specific docs
under `docs/plans/`.

If you're a fresh session: read `docs/PLAN.md` first, then this
doc, then the specific phase doc for whatever you're working on.

Date of last update: **2026-05-16**.

---

## 1. What just shipped (since 2026-05-15)

Twelve commits since the previous session-state snapshot, in date
order:

1. **`0a7fe16`** — R4 S1 pack shaders + Fumadocs site + plan docs
   (tile presets, store, shader hooks).
2. **`c02d280`** — R4 S2+S3 (helper promotion + 38-hook shader hooks)
   + docs landing page.
3. **`e786c3d`** — Tile presets T1+T2 (resolver + JSONC + idMap
   scenes + build-merge dedupe) + shader-hooks docs + playable game
   embed on docs site.
4. **`aa069dd`** — `api.ui` modal-systems migration → pack
   (R3 follow-up complete; `InventoryScreenSystem.tsx` and
   `SettingsScreenSystem.tsx` now live in
   `packages/default-pack/scripts/systems/`).
5. **`bdab12a`** — Full materials system (M1+M2+M3+M5: per-entity
   `Shader` ECS component, cell materials, scene-level overrides,
   build-time validation) + editor E1 + docs scene picker.
6. **`dd2063c`** — Editor E2 (live engine viewport) + R4 S4
   (post-process passes).
7. **`2edb94a`** — PACK_CHAIN P1 (`ChainResolver`, multi-pack
   `?pack=URL` chains, trust modal) + Editor E3 + new plan docs
   (ANIMATIONS, AUDIO, EVENTS) + CRT smoke pack.
8. **`be31fea`** — Materials M4 (pack-chain shader cascade) +
   Editor E4 (bake move engine-side at
   `packages/engine/src/Lighting/Bake.ts` + entity/light placement
   UX) + editor hosted on GitHub Pages.
9. **`ab9dbee`** — Editor iframe pivot I1 (`?source=editor` runner,
   IdbAssetPack engine-side, postMessage bridge) + animation system
   A1 (`Animation` component, `AnimationSystem`, `api.anim`, snap
   angle selection) + scene4 anim demo + GitHub CORS URL rewrite.
10. **`52d8e27`** — Au1 audio (`AudioRegistry`, `api.audio`, 5-group
    gain graph, settings sliders) + Ev1 events (`EventsRegistry`,
    25 canonical topics, pack-tagged auto-cleanup) + AE1 animation
    editor (Path A — bring-your-own spritesheet/loose frames).
11. **`d8fcbe7`** — Entities workflow tab + declarative prefabs
    (static components + optional `initScript`) + UI scale +
    scrollbar polish + iframe-pivot dev-server fix.
12. **`1961fd3`** — Project Settings modal (Manifest / Dependencies /
    Export / Advanced tabs) + dependency manager with auto-integrity
    hash + scrollbar consistency.

---

## 2. Open tasks (current task list)

### In progress

- **#196 — Declarative prefab JS-to-hybrid converter (agent running).**
  `@babel/parser` AST walk over existing JS prefabs; static
  `world.add` calls extract to declarative entries, dynamic logic
  stays in `initScript`. Side-by-side diff before commit. Folds
  into Entities workflow tab + EDITOR.md §6.3.
- **#200 — ANIMATION_EDITOR AE2: FBX importer (agent running).**
  Three.js + FBXLoader lazy-load on Animation-mode entry; orbit
  controls, model preview, animation scrubber, forward-direction
  gizmo; ortho-camera per-angle bake → canonical spritesheet
  matching ANIMATIONS.md §5. Default-pack `character/player_idle.fbx`
  is the load-bearing acceptance fixture.
- **#193 — Semver enforcement on requires[].version (agent running).**
  ChainResolver extension. `requires.version: "^1.2.3"` checks
  parent's `manifest.version` satisfies the range; throws on
  mismatch with both versions shown. Supports exact/caret/tilde.

### Queued

- **#198 — Tile preset workflow in cell inspector.** Click preset
  path → edit in modal. Per-preset usage stats. Highlight-all-cells
  button. Unlink-to-anonymous flow. TILE_PRESETS T4 territory.
- **#199 — In-engine developer console.** Quake/Source-style with
  backtick toggle. `api.console` namespace. Built-in commands
  (help/spawn/tp/set/get/eval/scene), pack-registered commands,
  autocomplete + history, themable via
  `api.ui.registerModal("dev_console", …)`. Plan doc CONSOLE.md
  not yet written. Includes the command-policy / permissions
  system (commands.json + build-strip + role-based gating).
- **#202 — Procedural assets (multi-phase).** Image + audio recipe
  DSL. Tiny recipe files (~200 bytes) replace rasterized assets.
  Layered op library; deterministic WebGL fragments + Web Audio
  node graphs; IDB cache after first generate; seeded per-instance
  variation. Editor exposes node-graph or layer-stack UI. Plan
  doc PROCEDURAL_ASSETS.md not yet written. Phases PROC1–PROC5.
- **#192 — Pack export modes (BUILD FULL vs EXTEND).** Folds into
  EDITOR E5 export pipeline.

### Captured but no task yet

- PACK_PROXY: Supabase Edge Function pack proxy for CORS-hostile
  hosts. Backstop layered with the GitHub URL rewrite. Plan doc
  PACK_PROXY.md not yet written.

---

## 3. Recent design decisions worth preserving

- **Editor iframe pivot.** Editor embeds the game runner via iframe
  (`?source=editor`) rather than mounting the engine in-process.
  Same-origin IDB sharing + postMessage protocol. Eliminated whole
  bug classes (HUD overlay leak, modal positioning, Tailwind
  isolation, ResizeObserver plumbing). See EDITOR_IFRAME.md.
- **R3 follow-up closed.** `api.ui` ships; pack `.tsx` build via
  `Bun.build` with Preact externalized through `installPreactRuntime`;
  `InventoryScreenSystem` + `SettingsScreenSystem` live pack-side.
- **Materials = three-tier cascade.** pack → scene → material;
  per-entity `Shader` ECS component; engine assembles one program
  with per-pixel branching by variant id. M4 chain cascade ships
  the `ShaderChainCascade.ts` resolver.
- **Bake moved engine-side.** `packages/engine/src/Lighting/Bake.ts`
  is the canonical bake module — both `apps/pack-builder/src/build-packs.ts`
  and the editor's bake button hit the same code path.
- **Hybrid prefabs.** Declarative prefabs reference an optional
  `initScript` that runs after static components attach, with
  `(entity, opts, api)`. The editor's JS-prefab→hybrid converter
  preserves dynamic logic while extracting static `world.add` calls.
- **Pack-chain dependency manager UI is editor-side.** Auto-fetch
  → SHA-256 → parse parent manifest → populate integrity / version
  / id. Per-dep enable toggle, drag-to-reorder for priority.
  Game-side Settings Packs panel is PACK_CHAIN P2 (queued).

---

## 4. File-touched map (since 2026-05-15)

| Area | Files |
|------|-------|
| **R3 follow-up — `api.ui` + pack .tsx** | `packages/default-pack/scripts/systems/inventory-screen.tsx`, `settings-screen.tsx`; `packages/engine/src/ModAPI/UIRegistry.ts` + `installPreactRuntime`; pack-builder `.tsx` compile path |
| **Materials (M1–M5)** | `packages/engine/src/Components/Shader.ts`; `packages/engine/src/Renderers/{ShaderVariants,ShaderChainCascade,ShaderInjection,HookParser,HookPrelude,ShaderRoleRegistry,ShaderValidator,shaderHeaders,shaderHelpers}.ts`; manifest schema additions; default-pack ghost-sprite + scene-material smoke tests |
| **Animations (A1)** | `packages/engine/src/Components/Animation.ts`; `packages/engine/src/Systems/AnimationSystem.ts`; `packages/engine/src/Libs/SpriteAtlas.ts`; `packages/engine/src/ModAPI/AnimRegistry.ts` + `api.anim`; renderer per-vertex `a_uvOffset` / `a_uvScale`; `packages/default-pack/scenes/scene4.json` anim demo |
| **Audio (Au1)** | `packages/engine/src/ModAPI/AudioRegistry.ts`; `api.audio.{play,playLoop,playReplace,stop,stopAll}`; Web Audio gain graph (master + 5 groups); `GameConfig.audio` + Settings sliders; default-pack gunshot + pickup chime |
| **Events (Ev1)** | `packages/engine/src/ModAPI/EventsRegistry.ts`; `packages/engine/src/ModAPI/canonical-events.ts`; pack-tagged auto-cleanup; default-pack pickup + gun-render emit canonical topics |
| **Animation editor (AE1)** | `apps/editor/src/views/AnimationEditor.tsx`; loose-frame import + cell-grid picker; canvas2d composite → canonical spritesheet PNG; manifest writer; IDB `spriteSources` store |
| **Editor iframe pivot (I1)** | `apps/game/src/editor-bridge.ts`; `apps/game/src/boot-editor.ts`; `packages/engine/src/AssetPack/IdbAssetPack.ts` (promoted engine-side); `apps/editor/src/views/EditorViewport.tsx` rewrite (iframe + postMessage) |
| **Shader chain (R4 S1–S4)** | `packages/engine/src/Renderers/{PostPassChain,ShaderChainCascade,ShaderInjection,HookParser,HookPrelude,ShaderValidator,ShaderVariants,shaderHeaders,shaderHelpers}.ts`; `packages/engine/src/Renderers/WebGLRenderer.ts` rewires |
| **Pack chain (P1)** | `packages/engine/src/AssetPack/ChainResolver.ts`; `packages/engine/src/AssetPack/semver.ts`; `packages/engine/src/AssetPack/loadAssetPack.ts`; multi-pack `?pack=A&pack=B` runtime; trust modal |
| **Tile presets (T1+T2)** | `packages/engine/src/AssetPack/PresetResolver.ts`; `apps/pack-builder/src/{build-presets,migrate-to-presets}.ts`; default-pack migrated to `tilePresets` + `idMap` scenes |
| **Editor (E1–E4 + Entities + Project Settings)** | `apps/editor/src/views/{HomeScreen,ProjectView,EditorViewport,GridEditor,EntitiesEditor,AnimationEditor,ProjectSettingsModal}.tsx`; declarative prefab Entities workflow tab; manifest editor + dependency manager moved to Project Settings modal |
| **Bake moved engine-side** | `packages/engine/src/Lighting/Bake.ts` (new home); `apps/pack-builder/src/build-packs.ts` callsite |
| **PLAN updates** | `docs/PLAN.md` (rewritten — adds 6 new plan-doc index rows, 10+ new phase-status rows); `docs/SESSION_STATE.md` (this file) |
| **New plan docs landed** | `docs/plans/{MATERIALS,ANIMATIONS,ANIMATION_EDITOR,AUDIO,EVENTS,EDITOR_IFRAME,PACK_CHAIN,ENGINE_PACK_SHADERS,TILE_PRESETS,STORE}.md` |

---

## 5. Recommended next implementation work

- **MULTIPLAYER M1 (unblocked).** R3 + Ev1 + Au1 + A1 all landed —
  `api.network` is the only remaining engine surface. Start with
  the M1 primitives (`NetworkId` + `Replicate` components +
  `api.network.{connect,send,onMessage}`).
- **LIGHTING_ENTITIES_REFACTOR R3/R4.** Emissive surfaces still
  bypass the ECS — make them entities with `Emissive` + `Anchored`
  components. R4 adds `Path` + `AnimateEmissive` systems with the
  demo scene torch.
- **WALL_OVERHAUL Phase 2.** Per-cell floor + ceiling heights.
  Phase 1 + caps shipped; Phase 2 is the natural follow-on.
- **PACK_CHAIN P2.** Game-side Settings Packs panel (the editor
  already has its dependency manager).
- **TILE_PRESETS T3** — manifest validation + Levenshtein typo
  detection. Cheap; high error-message ROI.
- **ENGINE_PACK_SHADERS S5** — build-time GLSL validation (try
  `headless-gl`; fall back to syntactic parse).

Plus the three in-flight agents (#196, #200, #193) and the queued
tasks above (#198, #199, #202, #192).

---

## 6. User preferences + standing rules

### Process / safety
- **Don't background the dev server from an agent shell.** User runs
  `bun run dev` in their own terminal.
- **Never kill by port.** Use `scripts/kill-server.ts` (pgrep by
  literal command line).
- **Don't commit unless asked.**

### Code style
- Bun primitives over Node (`Bun.serve`, `Bun.file`, `bun:sqlite`).
- Edit existing files in preference to creating new ones.
- Comments only when WHY is non-obvious.
- Don't add error handling for impossible scenarios.

### Doc conventions
- Plan-doc index in `docs/PLAN.md` table — keep one row per
  `docs/plans/*` file. Match column structure.
- After significant work, append/update phase status table at the
  bottom of `docs/PLAN.md`.
- This file (`SESSION_STATE.md`) is rewrite-on-update — keep it
  short, focused on what next session needs.

---

## 7. Smoke-test recipe

```sh
bun install                          # workspace resolution
bunx tsc -b                          # composite typecheck
bun run build-packs                  # bakes + zips default.apg
bun run build                        # production game bundle
bun run build:editor                 # editor static build
```

All should pass cleanly. Cosmetic `@theme` / `@tailwind` warnings
from `bun build` are expected (plugin uses `onBeforeParse`, which
the `bun build` CLI doesn't run).

---

## 8. Next-session bootstrap

```sh
cat docs/PLAN.md
cat docs/SESSION_STATE.md
cat docs/IDEAS.md                   # if user references a recent idea
cat docs/plans/<topic>.md           # for the phase being worked
```

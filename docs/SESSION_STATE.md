# Session State — 2026-05-20 (post-Visual-Builder) handoff

A handoff snapshot for the next Claude instance picking up this work.
**Read this file, then `.claude/memory/MEMORY.md`, then
`docs/plans/CORE_EDITOR_PACK.md`, `docs/plans/JSON_VISUAL_BUILDER.md`,
and `docs/plans/EDITOR_ENGINE.md` in that order.**

The previous SESSION_STATE was written at commit `7509593` immediately
after the Core Editor Pack endpoint. Since then six follow-up arcs
landed: live unregister, pack-side HMR, cross-window command
broadcast, the FINAL shell-view migration (views down to 2 files),
the PreviewPanel engine toggle, and the entire Visual Builder
(VB1 → VB6, six commits). This rewrite reflects all of that.

## 1. Where main is right now

Branch `main` at commit **`683259a`** — Visual Builder VB6
(JSON mode + error boundary + polish). Tree is dirty (this snapshot's
work in progress: `.apg` rebuilds + the matching shellSdkRuntime /
bridge edits not yet committed); no force-push has happened.

Most recent 20 commits (chronological, oldest first):

```
2b05e66  docs: CORE_EDITOR_PACK — implementation plan for Phase 4 extraction
40af88d  editor+sidecar: device-chip drag target + Pair modal polish
6e23bf7  editor+packs: core editor pack P1 — React externalization spike
205f1f6  editor+packs: core editor pack P2 — registerPanel API + NotesPanel
10ed2ac  editor+packs: core editor pack P3 batch A — Output/Problems/History/Lighting
8c747da  editor+packs: core editor pack P3 batch B — Layers/TilePreset/QuickTools/SelectionInfo
72d5b1c  editor+packs: core editor pack P3 batch C — MapCanvasPanel (the painter)
692890c  editor+packs: core editor pack P3 batch D-light — SceneSettings/AssetRefs/Brush/ToolPalette
0a006f5  editor+packs: core editor pack P3 batch D-final — Minimap/CellInspector/PrefabBrowser/Preview
5b4742f  editor+packs: core editor pack P3 final — Prefabs view 6 panels (24 total)
70fc96b  editor+packs: core editor pack P4 — view shells + registerView/Layout/Tab APIs
70cd29d  editor+packs: core editor pack P5 — final cleanup (the endpoint is reached)
7509593  docs: SESSION_STATE — late-late 2026-05-20 snapshot (Core Editor Pack endpoint reached)
61e627c  editor: Extensions tab — live unregister-without-reload (task #34)
1675577  editor: HMR for pack-side panel editing — approach (c) in-process pack source (task #36)
512455e  editor: cross-window command dispatch broadcast layer (task #9)
f82a470  editor+packs: shell view migration — apps/editor/src/views/ down to EditorSettingsModal + ExtensionsTab (task #35)
c4d0344  editor+packs: PreviewPanel — engine-rendered toggle + fly/god controls + modal expand (task #17)
c7a0794  docs: JSON_VISUAL_BUILDER — implementation plan for editor-panel visual builder (Phase 3)
d28e917  editor+packs: Visual Builder VB1 — workspace skeleton + Panel Builder tab + 3-pane placeholder
2566d12  editor+packs: Visual Builder VB2 — palette + canvas + RenderSpec node (recursive PanelRenderer verified)
6e1b12f  editor+packs: Visual Builder VB3 — selection + property inspector
819f49b  editor+packs: Visual Builder VB4 — undo/redo + save/export/import + Panel Library
19591ec  editor+packs: Visual Builder VB5 — Custom node + store-path/script-ref pickers
683259a  editor+packs: Visual Builder VB6 — JSON mode + error boundary + polish (VB COMPLETE)
```

## 2. What just landed today (post-endpoint)

Two large arcs, six commits each (roughly). The first arc is
infrastructure cleanup the endpoint exposed as priorities: live
unregister, pack-side HMR, cross-window dispatch, the final view
migration, the Preview engine toggle. The second arc is the entire
Visual Builder pack — VB1 through VB6.

### Arc 1 — Post-endpoint infrastructure follow-ups

| Sub-milestone | Commit | What it proved / wired |
|---|---|---|
| **Live unregister-without-reload** (task #34) | `61e627c` | Extensions toggle now runs `disposeEditorPackScripts(packId)` + drops the pack's panels / views / layouts / tabs out of the registries immediately. No reload required to disable a misbehaving pack. New helpers: `activeDockApis.ts` (cross-window dock cleanup hooks). Pack loader grew to 1148 lines. |
| **Pack-side HMR (in-process pack source)** (task #36) | `1675577` | `apps/editor/dev/dev-pack-server.ts` (414 lines) + `apps/editor/src/packs/devHmrClient.ts` (95 lines). Watches `packages/core-editor-pack/` source on disk; pushes pack rebuilds to the editor over SSE; client re-imports the setup script in-process. Approach (c) from `CORE_EDITOR_PACK.md` §11 risk #2. Editor-scope packs only — game packs still go through `bun run build-packs`. |
| **Cross-window command dispatch** (task #9) | `512455e` | `useCommandStore` gained a `BroadcastChannel("cardboard.commands")` layer + new `CommandScope = "origin-only" \| "broadcast"`. Default is `"broadcast"`: every paired same-project window runs the command. UUID `broadcastId` + loop-prevention `visited` set keep N-fire from happening. 199-line test file lives at `useCommandStore.test.ts`. |
| **Shell view migration FINAL CUTOVER** (task #35) | `f82a470` | `apps/editor/src/views/` is now **TWO files** — `EditorSettingsModal.tsx` and `settings/ExtensionsTab.tsx`. HomeScreen, ProjectView, ProjectTabView, AssetsView, ScriptsView, ComponentsView all moved to `packages/core-editor-pack/views/`. New shell-event surface: `apps/editor/src/packs/shellEvents.ts` (60 lines) exporting `SET_TAB_EVENT`, `SetTabEventDetail`, `WorkflowMode`. EditorShell.tsx slimmed from ~282 lines (delta) to mostly registry-driven `useRegisteredView(tab)`. |
| **PreviewPanel engine-rendered toggle** (task #17) | `c4d0344` | `PreviewPanel.tsx` gained a toggle between inline three.js preview and a real engine iframe pointed at `<GAME_RUNNER_URL>?source=editor&projectId=…`. Adds fly + god camera controls and a Modal-portaled Expand mode. `apps/game/src/editor-bridge.ts` (+52 lines) wires the iframe → editor postMessage channel; `default-pack/scripts/systems/player-input.js` grew fly/god controls. |

### Arc 2 — Visual Builder pack (VB1 → VB6)

`docs/plans/JSON_VISUAL_BUILDER.md` (911 lines, commit `c7a0794`)
was the design doc. The implementation rode through six commits
landing the Visual Builder as a **third-party pack** —
`packages/cardboard-visual-builder-pack/` — proving the panel
authoring story end-to-end through the public SDK.

| Sub-milestone | Commit | What it built |
|---|---|---|
| **VB1 — workspace skeleton** | `d28e917` | New pack created. Registers the `panelBuilder` view + the Panel Builder primary tab. Three-pane placeholder UI. Default-enabled set in `useEditorPacksStore` gains `cardboard-visual-builder-pack`. |
| **VB2 — palette + canvas + RenderSpec node** | `2566d12` | `paletteCatalog.ts` (212 lines) lists every NodeSpec kind. Canvas renders a recursive `<PanelRenderer>` of the current draft spec — proving the recursive renderer composes correctly. `usePanelBuilderStore.ts` (191 lines) carries the draft tree + selection. PanelRenderer +59 lines (intrinsic-children rules). `panel` SemanticAssetKind added to the DnD payload union. |
| **VB3 — selection + property inspector** | `6e1b12f` | `NodeInspector.tsx` (838 lines) — the property pane. Editing a property on the inspector mutates the selected node in the store; the canvas re-renders. PanelRenderer gained a `NodeIdProvider` Context that injects `data-cardboard-node-id` attributes on rendered nodes; clicks on rendered DOM map back to spec-tree ids for selection. `NodeIdProvider` exposed via `shellSdkRuntime`. |
| **VB4 — undo/redo + save/export/import + Panel Library** | `819f49b` | `draftsStore.ts` (173 lines) — IDB-backed pack-author draft library. `PanelLibraryPanel.tsx` (300 lines) — saved drafts UI. `usePanelBuilderHooks.ts` adds the undo/redo command bindings. Save + export `.cbpanel.json` + import wired. |
| **VB5 — Custom node + store-path/script-ref pickers** | `19591ec` | `Custom` NodeSpec kind — a pack can render any registered React component via id, opening the door for pack-authored component palettes. `StorePathPicker.tsx` (292 lines) + `ScriptRefPicker.tsx` (195 lines) — autocompletes `bind:` paths against `STORE_REGISTRY` + `listDynamicStores()`; resolves script refs against pack script ids. `STORE_REGISTRY` + `listDynamicStores` exposed via `shellSdkRuntime`. Pack loader +43 lines (script id enumeration API). |
| **VB6 — JSON mode + error boundary + polish (VB COMPLETE)** | `683259a` | `PanelBuilderCanvasErrorBoundary.tsx` (97 lines) — a malformed draft no longer crashes the editor; the canvas shows a recovery card. NodeInspector gained a JSON-mode toggle (edit the spec as raw JSON; round-trips with the visual editor). PanelBuilderView grew an export/clipboard/preview-fullscreen toolbar. **VB plan complete.** |

The VB pack is BOTH proof-by-construction (the pack model works for
a tool this complex) AND the canonical example for any third-party
pack author looking to write a complex multi-pane interactive tool.

## 3. The endpoint reached + reinforced

The editor is a shell + a chain of packs. The shell `apps/editor/`
contains primitives, sync, loader, and exactly two view files. All
content ships in packs registered through the public SDK at load
time.

- **`apps/editor/`** — the shell. Contains:
  - UI primitives (`components/ui/`, `components/dock/`).
  - Wave-3 stores (`src/state/`) — scene, brush, tool, layer,
    history, selection, diagnostics, tile-preset, command (now with
    cross-window broadcast), editor-packs, layout-registry,
    view-registry, etc.
  - Cross-window sync (BroadcastChannel-backed synced-store
    factory).
  - IDB-backed project persistence (`src/idb/`,
    `src/lib/EditorProjectStore.ts`).
  - The pack loader (`src/packs/editorPackLoader.ts`, 1148 lines).
  - The Extensions tab + EditorSettingsModal (recovery surface,
    intentionally stays shell-side per CORE_EDITOR_PACK.md §3.3).
  - The JSON renderer (`src/panel-renderer/`).
  - The shell SDK runtime (`src/packs/shellSdkRuntime.ts`) +
    `src/packs/shellEvents.ts` (cross-pack event names + types).
  - Dev-only pack HMR: `dev/dev-pack-server.ts` +
    `src/packs/devHmrClient.ts`.
- **`packages/core-editor-pack/`** ships the editor's content:
  - **25 panels** (`panels/*.tsx` + `panels/prefabs/*.tsx` + JSON
    specs rendered via PanelRenderer). The +1 vs the previous
    snapshot is a panel registration added during the view-migration
    arc.
  - **9 view shells registered via `ctx.registerView(...)`** —
    scene (MapView), prefabs (PrefabsView), home (HomeScreen),
    assets (AssetsView), project (ProjectTabView), scripts
    (ScriptsView), components (ComponentsView), animation
    (ProjectView). Lives at
    `packages/core-editor-pack/views/`.
  - **11 primary tabs** registered via `ctx.registerTab(...)`.
  - **2 default layouts** (`registerLayout`).
  - **2 predefined layouts** (`registerPredefinedLayout`) plus the
    other Scene presets registered from `layouts/predefined.ts`.
- **`packages/cardboard-visual-builder-pack/`** — the Visual Builder
  pack (entire JSON_VISUAL_BUILDER plan). Default-enabled.
- **3 demo packs** prove the model from the OUTSIDE:
  - `cardboard-editor-pack-demo` — original Phase-0 spike.
  - `demo-performance-profiler` — chart.js + Canvas node + dynamic
    store + live FPS chart.
  - `demo-scene-stats` — second chart.js consumer, dedup proof.
- **Default-enabled set** at
  `apps/editor/src/state/useEditorPacksStore.ts` includes
  `cardboard-core-editor`, `cardboard-visual-builder-pack`, and
  the three demo packs.

**The toggle dance still works.** Disable `cardboard-core-editor`
in Extensions → no reload required (task #34) → primary-tab strip
empties, no Scene view exists. Re-enable → editor restored.

## 4. What's still in the shell (truly minimal now)

`apps/editor/src/views/` contains exactly:

| File | Lines | Why still shell-side |
|---|---:|---|
| `EditorSettingsModal.tsx` | 473 | **By design — recovery surface per §3.3** |
| `settings/ExtensionsTab.tsx` | 332 | **By design — recovery surface per §3.3** |

That's it. HomeScreen, ProjectView, ProjectTabView, AssetsView,
ScriptsView, ComponentsView all moved into the core editor pack in
`f82a470`. The `SET_TAB_EVENT` + `SetTabEventDetail` + `WorkflowMode`
contract was extracted into `apps/editor/src/packs/shellEvents.ts`
so pack code (or third-party packs) can dispatch tab-switch intents
without reaching into a view file.

EditorSettingsModal + ExtensionsTab stay shell-side permanently —
recovery UI a user reaches for when a misbehaving pack needs
disabling. Putting them in a pack would create a chicken-and-egg
deadlock per CORE_EDITOR_PACK.md §3.3.

## 5. Shell SDK surface (current)

The contract third-party packs consume, exposed at
`globalThis.__cardboard_editor_shell` and populated by
`apps/editor/src/packs/shellSdkRuntime.ts` (lines 170-335 are the
`shellSdk` object; types re-exported at lines 343-349). The
pack-builder rewrites `import ... from "@cardboard/editor-shell"`
into a virtual module reading from this slot.

Current exports (verbatim — verified against
`shellSdkRuntime.ts` HEAD):

**Command + UI**
- `registerCommand`, `useCommandStore` (with cross-window
  broadcast — task #9)
- `EmptyState`
- `Modal`, `Button`, `Tooltip` (task #17 additions)

**Active scene context**
- `useActiveScene`

**Wave-3 stores** (all singleton-bound, BroadcastChannel-synced)
- `useDiagnosticsStore`, `useHistoryStore`, `useLayerStore`
- `useTilePresetStore`, `useTilePresetRegistryStore`
- `useSceneStore`, `useSelectionStore`
- `useBrushStore`, `useToolStore`

**Scene helpers**
- `cellKey`, `undoOnce`, `redoOnce`

**Tile texture cache**
- `loadTileTexture`, `getTileTextureSync`

**P4 view-shell primitives**
- `DockShell`, `WorkspaceRail`
- `useTabContextSlot`, `useTabContextSlotValue`
- `useRoute`, `buildHash`
- `useEditorPackPanels`, `useEditorPacksLoaded`

**P5b view-migration surface (post-endpoint follow-ups)**
- `SET_TAB_EVENT` constant + `SetTabEventDetail`, `WorkflowMode` types
- `EditorProjectStore` singleton + `ProjectMeta`, `AssetMeta` types
- `importPackFromBlob`, `importPackFromUrl`
- `assetUrl`, `useStatusBar`, `StatusBarSection` type

**Task #17 — engine renderer**
- `GAME_RUNNER_URL`

**Visual Builder additions (VB2 + VB3 + VB5)**
- `PanelRenderer`, `NodeIdProvider` (the panel-renderer surface +
  the click-mapping Context provider)
- `STORE_REGISTRY`, `listDynamicStores` (for store-path picker
  autocomplete)

Companion: `globalThis.__cardboard_editor_react` (from
`apps/editor/src/packs/reactRuntime.ts`) — shared React instance so
pack TSX panels render with the same React the shell uses.

The `EditorPackContext` (the runtime object the pack's setup
function receives) carries the registration APIs on top of the SDK:
`registerPanel`, `registerView`, `registerLayout`,
`registerPredefinedLayout`, `registerTab`, plus `createStore`,
`importLibrary`, `getCanvasRef`, `onPanelMount`, `share`, `consume`.
See `apps/editor/src/packs/editorPackLoader.ts` (the file's
significantly larger now — 1148 lines — most of the growth is the
dispose / unregister / live-toggle wiring landed in `61e627c`).

## 6. Dev workflow (with the new HMR layer)

Before task #36 every pack-side panel edit required
`bun run build-packs` + reload. That gap is closed:

- `bun --hot apps/editor/server.ts` (port 3001) — same as before.
- Edit a file under `packages/core-editor-pack/` (or any other
  editor-scope pack workspace). The dev pack server watches +
  rebuilds + pushes the new module bytes to the editor via SSE on
  `/__dev/pack-hmr`. The client (`devHmrClient.ts`) re-imports the
  setup script in-process: `disposeEditorPackScripts(packId)` +
  re-run setup against a fresh disposer list.
- No reload. Panel re-mounts; state in non-disposed stores persists.

Game packs (`packages/default-pack/`) still build via the usual
`bun run build-packs` — HMR is editor-scope only. See
`docs/plans/CORE_EDITOR_PACK.md` §11 risk #2 for the rationale.

## 7. What's next

Priority queue for the next session (refreshed):

1. **#11 — Plan + scope the remote dock + Supabase Realtime
   alternative.** Plan refreshed in this turn — see
   `docs/plans/REMOTE_DOCK_QR.md` §0 (status) and §6.5 (Supabase
   Realtime as second transport). Implementation: the transport-
   interface lift (`D10c`) is the next concrete step before adding
   the second transport.
2. **Sidecar `mountPanel` consumer.** The WireMessage kind exists
   and the desktop sends it on device-chip drop, but the sidecar
   PWA still needs to handle it and mount the requested panel kind.
   See `apps/editor/src/sidecar/` (the desktop side) +
   `desktopPairingSingleton.ts`.
3. **Pack-chain integration.** `requires[]` for editor packs,
   mirroring the game-pack chain (`docs/plans/PACK_CHAIN.md`).
   Visual Builder is now a real third-party pack so the chain
   model has a non-toy customer.
4. **Sandbox tightening on pack load.** SRI hash, untrusted-source
   warning, CSP. Today any `.apg` is trusted on import.
5. **HMR for the Visual Builder pack itself.** Today the VB pack is
   in `packages/cardboard-visual-builder-pack/` — the dev HMR
   server watches `packages/core-editor-pack/` only. Extending the
   watch list is a small follow-up.
6. **Game-side cross-window dispatch.** Task #9 wired the editor's
   `useCommandStore`. The game runtime has its own command bus; if
   we want pack-registered game commands to fan out across game
   windows, the same broadcast layer needs porting (or unifying).

Lower priority:
- Pack-author icon refs (today every pack-loaded JSON panel gets
  `FileJson`; TSX panels supply their own icons).
- Touch-friendly panel variants (`D11`).
- Initial IDB mirror on pair (`D11b`).

## 8. How to verify state on pickup

```bash
git pull origin main
git log --oneline -5
# expected: 683259a at HEAD (or higher)

git status
# expected: clean (or known WIP files: apg rebuilds + shellSdkRuntime delta)

cd apps/editor && bunx tsc --noEmit --skipLibCheck
# expected: exit 0

bun test
# expected: green (or known-failing pre-existing tests only)

# Verify the FIVE .apg files exist:
ls apps/editor/public/packs/
# expected:
#   cardboard-core-editor.apg
#   cardboard-editor-pack-demo.apg
#   cardboard-visual-builder-pack.apg
#   demo-performance-profiler.apg
#   demo-scene-stats.apg

# Verify shell views are down to the recovery surface:
ls apps/editor/src/views/
# expected:
#   EditorSettingsModal.tsx
#   settings/  (contains only ExtensionsTab.tsx)

# Verify all 25 panels registered (was 24 before the post-endpoint arc):
grep -c "ctx.registerPanel" packages/core-editor-pack/scripts/setup.tsx
# expected: 25

# Verify the 9 view registrations:
grep -c "ctx.registerView" packages/core-editor-pack/scripts/setup.tsx
# expected: 9

# Verify the live-unregister toggle dance (NO reload required now):
# 1. Start dev server (`bun --hot apps/editor/server.ts` on :3001).
# 2. Open Editor Settings → Extensions.
# 3. Disable `cardboard-core-editor`.
# 4. Expected: primary-tab strip empties IMMEDIATELY, no reload prompt.
# 5. Re-enable — editor restored, again no reload required.
```

## 9. Dev server

`bun --hot apps/editor/server.ts` from `apps/editor/`. Listens on
port **3001**.

New: the server now also exposes:
- `/__dev/pack-hmr` (SSE) — pack-source watch + rebuild push
  pipeline introduced in `1675577`.

The CLAUDE.md rule about not starting dev servers from the agent
shell still applies. User starts it; agents read state only.

## 10. Memory rules currently active

`.claude/memory/MEMORY.md` is the index. Highest-priority rules
this session was governed by — unchanged from the previous snapshot:

- `feedback_verify_before_asserting.md` — verify cheap claims by
  grep / read before asserting; hedge expensive ones.
- `feedback_audits_parallel.md` — audits are read-only; dispatch
  in parallel with implementation streams, never sit idle.
- `feedback_never_idle_protocol.md` — CRITICAL operational rule.
- `feedback_voice_carries_content.md` — voice + text both carry
  content.
- `project_dogfooding_principle.md` — non-negotiable. Visual
  Builder shipped as a third-party pack precisely to keep this
  contract honest.
- `project_editor_package_injection.md` — the bridge model
  pack-bundled scripts implement.

## 11. What NOT to do

- Don't add TSX wrappers that secretly register commands /
  panels / views on behalf of packs. Closed in `39a210c`.
- Don't move EditorSettingsModal or ExtensionsTab into a pack.
  Recovery surface — CORE_EDITOR_PACK.md §3.3.
- Don't bypass the new dev HMR for editor-scope packs by manually
  running `bun run build-packs` during development — you'll fight
  the SSE pipeline. Let the watcher do its job; only build for
  releasable `.apg` snapshots.
- Don't broadcast every command — some are inherently
  origin-local (open-modal, focus-input). Use
  `scope: "origin-only"` on the `registerCommand` call. Default is
  `"broadcast"` per the §1 hardening rationale in
  `useCommandStore.ts`.
- Don't grind through speculative migrations as "practice". The
  views migration is DONE; the next migrations are SDK extractions
  (event buses, type contracts) driven by real third-party-pack
  demand.
- Don't quote facts about project state without grepping. The
  shell-SDK surface, the panel count, the view count, the
  registered-tab count — all are concrete and verifiable.
- Don't `git push --force` to main. Don't skip pre-commit hooks.
- Don't use `isolation: "worktree"` on Agent dispatches —
  VHDX corruption risk per `.claude/memory/MEMORY.md`.

## 12. The deploy

GH Pages deploys via `.github/workflows/docs.yml` only. The
editor + docs + game all stage into `apps/docs/public/` via
build scripts. `bun run build-packs` produces every `.apg`,
including all 5 editor packs into `apps/editor/public/packs/`.

The PreviewPanel engine-render branch (task #17) points its iframe
at `<GAME_RUNNER_URL>?source=editor&projectId=…`. In dev that's
`/play/`; under GitHub Pages it's `/cardboard/play/`.
`GAME_RUNNER_URL` resolution lives in `apps/editor/src/lib/
gameRunnerUrl.ts` and is exposed via the shell SDK so the
pack-shipped PreviewPanel can read it without hard-coding.

CSS verified healthy on Pages (Tailwind v4.3.0). Same recovery
recipe as before if a user reports "no styling" again.

---

## Errata vs the previous SESSION_STATE snapshot

Fixed during this rewrite:

1. The previous "What's still in shell" table listed eight files;
   six of those moved into the pack in `f82a470`. Now down to 2.
2. The shell SDK listing in the previous file omitted the additions
   from `c4d0344` (`Modal`, `Button`, `Tooltip`, `GAME_RUNNER_URL`),
   the additions from VB3 / VB5 (`NodeIdProvider`, `STORE_REGISTRY`,
   `listDynamicStores`), and the additions from `f82a470`
   (`SET_TAB_EVENT`, `EditorProjectStore`, `importPackFromBlob`,
   `importPackFromUrl`, `assetUrl`, `useStatusBar`).
3. The panel count moved from 24 to 25 over the post-endpoint arc.
4. Pack count moved from 4 to 5 (`cardboard-visual-builder-pack`
   added).

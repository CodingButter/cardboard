# Session State — 2026-05-20 (late-late) handoff

A handoff snapshot for the next Claude instance picking up this work.
**Read this file, then `.claude/memory/MEMORY.md`, then
`docs/plans/CORE_EDITOR_PACK.md` (the plan whose endpoint just
shipped), then `docs/plans/EDITOR_ENGINE.md` (architectural north
star).**

The Core Editor Pack extraction (issue #19) is **functionally done**.
The Cardboard editor now lives in a pack — `packages/core-editor-pack/`.
The shell at `apps/editor/` is a primitives + sync + loader frame
that knows nothing about scenes, prefabs, painting, or layers. All
of that ships as pack content registered through the public SDK at
load time.

## 1. Where main is right now

Branch `main` at commit **`70cd29d`** — pushed to origin, tree
clean (`.envrc` is the only untracked file, intentional).

Last ~20 commits (chronological, oldest first):

```
0c5519b  editor+packs: Performance Profiler demo pack — proof by construction COMPLETE
fe792b1  docs: EDITOR_ENGINE — flip Phase 5 to shipped, rebaseline phase table
da959d7  editor+packs: demo-scene-stats — second pack proves library dedup
2765faa  memory: feedback — never-idle protocol (CRITICAL operational rule)
74d3f17  editor: PreviewPanel — WebGL graceful degradation
e91a4b8  editor+packs: pack-loader audit fixes — hash-verify-first, hook stability
fc6d0c7  packs: remove LIBRARY_ENTRIES allowlist gatekeeper
2b05e66  docs: CORE_EDITOR_PACK — implementation plan for Phase 4 extraction
40af88d  editor+sidecar: device-chip drag target + Pair modal polish
6e23bf7  editor+packs: core editor pack P1 — React externalization spike
205f1f6  editor+packs: core editor pack P2 — registerPanel API + NotesPanel
10ed2ac  editor+packs: core editor pack P3 batch A — Output/Problems/History/Lighting
8c747da  editor+packs: core editor pack P3 batch B — Layers/TilePreset/QuickTools/SelectionInfo
692890c  editor+packs: core editor pack P3 batch D-light — SceneSettings/AssetRefs/Brush/ToolPalette
72d5b1c  editor+packs: core editor pack P3 batch C — MapCanvasPanel (the painter)
0a006f5  editor+packs: core editor pack P3 batch D-final — Minimap/CellInspector/PrefabBrowser/Preview
5b4742f  editor+packs: core editor pack P3 final — Prefabs view 6 panels (24 total)
70fc96b  editor+packs: core editor pack P4 — view shells + registerView/Layout/Tab APIs
70cd29d  editor+packs: core editor pack P5 — final cleanup (the endpoint is reached)
```

## 2. What just landed today

Two arcs woven together over the day. The first arc (Performance
Profiler) was the proof-by-construction milestone — confirm a
third-party pack can ship arbitrary npm libraries + scripts +
panels and have them register through the editor SDK with no
shell-side accommodation. Once that proof landed, the second arc
(Core Editor Pack extraction) ran the same path in reverse: move
the editor's OWN content out of the shell and into a pack until
the shell knows nothing about scenes.

### Editor-pack architectural arc (this week's multi-day push)

The Profiler-completion + dedup-proof commits closed out the
extension model. Then the core-pack extraction (#19) ran P1 → P5:

| Sub-milestone | Commit | What it proved |
|---|---|---|
| Performance Profiler demo pack | `0c5519b` | Third-party pack ships chart.js (library bundling) + scripts that register a command + a live FPS chart panel |
| demo-scene-stats dedup proof | `da959d7` | Two packs declaring the same chart.js@4.4.0 bytes share one Blob URL via SHA-256 content-hash cache (caught a race bug in the same commit) |
| Pack-loader audit + fixes | `e91a4b8` | Hash-verify-first, hook stability, TS cleanup |
| LIBRARY_ENTRIES allowlist removed | `fc6d0c7` | Any npm library shippable; no shell-side gatekeeper |
| PreviewPanel WebGL graceful degrade | `74d3f17` | Unblocks CI Playwright multi-panel smoke |
| Sidecar device-chip drag target | `40af88d` | Pair-modal polish (task #16) |
| **P1 — React externalization spike** | `6e23bf7` | `globalThis.__cardboard_editor_react` shared between shell + pack; pack TSX bundles use one React instance |
| **P2 — `registerPanel` API + NotesPanel** | `205f1f6` | First real shell → pack panel move |
| **P3A — Output/Problems/History/Lighting** | `10ed2ac` | Diagnostics + lighting panels in pack |
| **P3B — Layers/TilePreset/QuickTools/SelectionInfo** | `8c747da` | Store-writer panels in pack |
| **P3 D-light — SceneSettings/AssetRefs/Brush/ToolPalette** | `692890c` | Small Scene panels in pack |
| **P3 C — MapCanvasPanel** | `72d5b1c` | The painter itself (the centerpiece) in pack |
| **P3 D-final — Minimap/CellInspector/PrefabBrowser/Preview** | `0a006f5` | Last four Scene panels in pack |
| **P3 Prefabs — 6 Prefabs view panels** | `5b4742f` | All 24 panels now in pack |
| **P4 — view shells + registerView/Layout/Tab APIs** | `70fc96b` | MapView + PrefabsView in pack; tab strip pack-owned |
| **P5 — final cleanup** | `70cd29d` | Predefined Scene layouts in pack; the endpoint is reached |

Memory rule captured this week: `feedback_never_idle_protocol.md`
(`2765faa`).

## 3. The endpoint reached

The editor is now a shell + a pack. Plainly:

- **`apps/editor/`** is the shell. Contains:
  - UI primitives (`components/ui/`, `components/dock/`).
  - Wave-3 stores (`src/state/`) — scene, brush, tool, layer,
    history, selection, diagnostics, tile-preset, command,
    editor-packs, layout-registry, etc.
  - Cross-window sync (BroadcastChannel-backed synced-store
    factory).
  - IDB-backed project persistence (`src/idb/`).
  - The pack loader (`src/packs/editorPackLoader.ts`).
  - The Extensions tab + EditorSettingsModal (recovery surface,
    intentionally stays shell-side per CORE_EDITOR_PACK.md §3.3).
  - The JSON renderer (`src/panel-renderer/`).
  - The shell SDK runtime (`src/packs/shellSdkRuntime.ts`) — the
    `globalThis.__cardboard_editor_shell` surface third-party packs
    consume.
- **`packages/core-editor-pack/`** ships the editor's content:
  - **24 panels** (`panels/*.tsx` + `panels/prefabs/*.tsx` +
    5 JSON specs that get rendered via PanelRenderer).
  - **2 view shells** (`views/MapView.tsx`,
    `views/PrefabsView.tsx`).
  - **11 primary tabs** registered via `ctx.registerTab(...)` in
    `scripts/setup.tsx:307-391` — home, scene, prefabs, components,
    assets, scripts, animation, imageLab, soundLab, uiBuilder,
    project.
  - **4 predefined Scene layouts** registered via
    `ctx.registerPredefinedLayout(...)` from
    `layouts/predefined.ts:331-359` — Default, Map Focus, Inspect,
    Debug.
  - **2 default layouts** (`layouts/scene-default.ts`,
    `layouts/prefabs-default.ts`) registered via
    `ctx.registerLayout(...)`.
  - Single setup script: `scripts/setup.tsx` (397 lines).
- **3 demo packs** prove the pack model from the OUTSIDE:
  - `cardboard-editor-pack-demo` — the original Phase-0 spike
    pack, JSON SelectionInfo + a setup script.
  - `demo-performance-profiler` — chart.js library bundling +
    Canvas node + dynamic store + scripts that drive a live FPS
    chart.
  - `demo-scene-stats` — second chart.js consumer, proves
    SHA-256 content-hash dedup across packs.
- **Default-enabled set** lives at
  `apps/editor/src/state/useEditorPacksStore.ts:89-118`.

**The toggle dance** — proof the extraction is honest. Disable
`cardboard-core-editor` in Extensions → reload. Result: the
PrimaryTabs strip is empty, no Scene view exists, the editor
renders the bare shell + HomeScreen fallback. Re-enable + reload
restores everything.

## 4. What's still in the shell (deferred)

Eight view files remain at `apps/editor/src/views/`:

| File | Lines | Why still shell-side |
|---|---:|---|
| `HomeScreen.tsx` | 1221 | Recent projects + import/create — coupled to project IDB + SET_TAB_EVENT |
| `ProjectView.tsx` | 41 | Exports `WorkflowMode` type that EditorShell imports |
| `project/ProjectTabView.tsx` | 39 | The non-scene-non-prefab project workspace |
| `AssetsView.tsx` | 52 | Exports `SET_TAB_EVENT` + `SetTabEventDetail` — wired into EditorShell event bus |
| `ScriptsView.tsx` | 35 | Monaco-backed editor view |
| `ComponentsView.tsx` | 34 | Reusable-components surface |
| `EditorSettingsModal.tsx` | 473 | **By design — recovery surface per §3.3** |
| `settings/ExtensionsTab.tsx` | 299 | **By design — recovery surface per §3.3** |

The non-Settings views are deferred because they're coupled to
`SET_TAB_EVENT` (the cross-view "switch to tab + select X" event
the shell dispatches) and the `WorkflowMode` type
(`apps/editor/src/views/ProjectView.tsx:21`). Migrating them
requires extracting that event bus + workflow-mode contract into
the SDK first. The 11 tab registrations in
`packages/core-editor-pack/scripts/setup.tsx:307-391` already
declare ids for all of these — the shell looks up the view by id
and falls back to its shell-side component when no `registerView`
hit. So the pack already OWNS the tabs; the shell still SUPPLIES
the view body for the un-migrated tabs.

EditorSettingsModal + ExtensionsTab stay shell-side permanently —
they're the recovery UI a user reaches for when a misbehaving pack
needs to be disabled. Putting them in a pack would create a
chicken-and-egg deadlock per CORE_EDITOR_PACK.md §3.3.

## 5. Shell SDK surface

The contract third-party packs consume, exposed at
`globalThis.__cardboard_editor_shell` and populated by
`apps/editor/src/packs/shellSdkRuntime.ts:119-230`. The pack-builder
rewrites `import ... from "@cardboard/editor-shell"` into a virtual
module reading from this slot.

Current exports:

- **Command + UI**: `registerCommand`, `useCommandStore`,
  `EmptyState`, `PanelRenderer`.
- **Active scene context**: `useActiveScene`.
- **Wave-3 stores** (all singleton-bound, BroadcastChannel-synced):
  `useDiagnosticsStore`, `useHistoryStore`, `useLayerStore`,
  `useTilePresetStore`, `useTilePresetRegistryStore`,
  `useSceneStore`, `useSelectionStore`, `useBrushStore`,
  `useToolStore`.
- **Scene helpers**: `cellKey(x, y)`, `undoOnce`, `redoOnce`.
- **Tile texture cache**: `loadTileTexture(packId, presetId, path)`,
  `getTileTextureSync(presetId, path)`.
- **P4 view shells**: `DockShell`, `WorkspaceRail`,
  `useTabContextSlot`, `useTabContextSlotValue`, `useRoute`,
  `buildHash`, `useEditorPackPanels`, `useEditorPacksLoaded`.

Companion is `globalThis.__cardboard_editor_react` (from
`apps/editor/src/packs/reactRuntime.ts`) — shared React instance so
pack TSX panels render with the same React the shell uses.

The `EditorPackContext` (the runtime object the pack's setup
function receives) carries the registration APIs on top of the SDK:
`registerPanel`, `registerView`, `registerLayout`,
`registerPredefinedLayout`, `registerTab`, plus `createStore`,
`importLibrary`, `getCanvasRef`, `onPanelMount`, `share`,
`consume`. See `apps/editor/src/packs/editorPackLoader.ts:109-251`.

## 6. Pack-author authoring shape

A third-party pack lives in its own workspace under `packages/`
and ships as an `.apg` zip. The minimum shape:

```
packages/my-pack/
  manifest.json
  scripts/setup.tsx
```

`manifest.json`:

```json
{
  "id": "my-pack",
  "name": "My Pack",
  "version": "0.1.0",
  "engine": "two_5_d@0.1",
  "scope": ["editor"],
  "scripts": ["scripts/setup.tsx"],
  "editorPanels": []
}
```

`scripts/setup.tsx`:

```tsx
import type { EditorPackContext } from "../../../apps/editor/src/packs/editorPackLoader";
import { registerCommand } from "@cardboard/editor-shell";  // routes through globalThis SDK
import { MyPanel, MANIFEST } from "../panels/MyPanel";

export default function setup(ctx: EditorPackContext): () => void {
  const disposers = [
    ctx.registerPanel({ ...MANIFEST, component: MyPanel }),
    ctx.registerCommand({ id: "my-pack.do-thing", run: () => { /* ... */ } }),
  ];
  return () => disposers.forEach((d) => d());
}
```

Build via the existing pack-builder (TSX compiles with React
externalised + shell imports rewritten). Drop the `.apg` into
`apps/editor/public/packs/` and register the id in
`useEditorPacksStore`'s INITIAL_STATE (or have the user install via
the Extensions tab once the install flow lands).

## 7. What's next

Priority queue for the next session:

1. **#9 — Cross-window command dispatch.** Today
   `useCommandStore` is per-window. Pop-out panels can read the
   command id but the registered handler lives in the window that
   registered it. Needed before serious multi-window pack work.
2. **#11 — Plan + scope the remote dock.** Companion to #9 —
   when commands cross windows, the dock chrome needs a contract
   for which window owns which panel session.
3. **#17 — Preview engine-rendered toggle.** Replace the inline
   three.js with the real engine renderer for true WYSIWYG.
4. **#23 — JSON visual builder.** Phase 3 of the JSON composition
   plan. Today JSON specs are hand-authored; the builder lets a
   pack author drag a spec together in the editor.
5. **HomeScreen + shell-stub views migration.** Extract
   `SET_TAB_EVENT` + `WorkflowMode` into the SDK, then move
   HomeScreen + ProjectView + AssetsView + ScriptsView +
   ComponentsView + ProjectTabView into the core-editor-pack
   `views/` directory. After this the shell holds only
   EditorSettingsModal + ExtensionsTab + primitives.
6. **HMR strategy for pack-side panel work.** Today every
   pack-side panel edit requires `bun run build-packs` + reload.
   A dev-mode passthrough that watches `packages/core-editor-pack/`
   would close the inner-loop gap.

Lower priority:
- Live unregister-without-reload on Extensions toggle
  (`disposeEditorPackScripts` is exported but unwired).
- Pack-chain integration (requires[] for editor packs, mirroring
  game-pack chain).
- Sandbox tightening (SRI hash, untrusted-source warning, CSP).
- Pack-author icon refs (today every pack-loaded JSON panel gets
  FileJson; TSX panels supply their own icons).

## 8. How to verify state on pickup

```bash
git pull origin main
git log --oneline -5
# expected: 70cd29d at HEAD (or higher)

git status
# expected: clean (.envrc untracked is fine)

cd apps/editor && bunx tsc --noEmit --skipLibCheck
# expected: exit 0

bun test
# expected: green (or known-failing pre-existing tests only)

# Verify the four .apg files exist:
ls apps/editor/public/packs/
# expected:
#   cardboard-core-editor.apg
#   cardboard-editor-pack-demo.apg
#   demo-performance-profiler.apg
#   demo-scene-stats.apg

# Verify the dogfooding toggle dance:
# 1. Start dev server (`bun --hot apps/editor/server.ts` on :3001).
# 2. Open Editor Settings → Extensions.
# 3. Disable `cardboard-core-editor`, reload.
# 4. Expected: empty primary-tab strip, no Scene view, bare shell + HomeScreen.
# 5. Re-enable, reload — editor restored.

# Verify all 24 panels registered:
grep -c "ctx.registerPanel" packages/core-editor-pack/scripts/setup.tsx
# expected: 24
```

## 9. Dev server

`bun --hot apps/editor/server.ts` from `apps/editor/`. Listens on
port **3001**.

The CLAUDE.md rule about not starting dev servers from the agent
shell still applies. User starts it; agents read state only.

## 10. Memory rules currently active

`.claude/memory/MEMORY.md` is the index. The highest-priority rules
this session was governed by:

- `feedback_verify_before_asserting.md` — verify cheap claims by
  grep / read before asserting; hedge expensive ones. The user
  caught two hallucinations earlier in the arc; this rule was the
  response.
- `feedback_audits_parallel.md` — audits are read-only; dispatch
  in parallel with implementation streams, never sit idle.
- `feedback_never_idle_protocol.md` (`2765faa`) — CRITICAL
  operational rule. While an agent is working, the main loop
  works too (further audits, planning, follow-up dispatches).
  Never sit and wait for an in-flight agent.
- `feedback_voice_carries_content.md` — voice + text both carry
  content; voice plays on desktop, phone reads text. Don't TTS
  trivia.
- `project_dogfooding_principle.md` — non-negotiable. The
  core-editor-pack extraction is the maximal expression of this
  rule. Any pack the editor itself ships uses the same surface a
  third-party pack would.
- `project_editor_package_injection.md` — the bridge model
  pack-bundled scripts implement. P1's React externalization was
  the first physical realisation.

## 11. What NOT to do

- Don't add TSX wrappers that secretly register commands /
  panels / views on behalf of packs. That's the dogfooding
  violation we closed in `39a210c`. If the shell needs to do
  something for a pack, the right answer is to expose an SDK
  symbol, not to bake a pack-specific shim into the shell.
- Don't move EditorSettingsModal or ExtensionsTab into a pack.
  They're the recovery surface — see CORE_EDITOR_PACK.md §3.3.
  A user with a broken pack must be able to disable it without
  loading the broken pack first.
- Don't use `isolation: "worktree"` on Agent dispatches —
  VHDX corruption risk per `.claude/memory/MEMORY.md`.
- Don't grind through speculative migrations as "practice". The
  next migration after this (HomeScreen + shell stubs) needs
  `SET_TAB_EVENT` + `WorkflowMode` extracted into the SDK FIRST.
- Don't quote facts about project state without grepping. The
  shell-SDK surface, the panel count, the tab count, the
  predefined-layout count — all are concrete and verifiable.
- Don't `git push --force` to main. Don't skip pre-commit hooks.

## 12. The deploy

GH Pages deploys via `.github/workflows/docs.yml` only. The
editor + docs + game all stage into `apps/docs/public/` via
build scripts. `bun run build-packs` produces every `.apg`,
including all 4 editor packs into `apps/editor/public/packs/`.

CSS verified healthy on Pages (Tailwind v4.3.0). If user
reports "no styling" again, hard-refresh → unregister SW → clear
site data; root cause was the missing `@source` directive in
`apps/editor/index.css`, fixed days ago in `31828b1`.

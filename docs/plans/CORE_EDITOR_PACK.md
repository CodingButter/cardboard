# Core editor-pack extraction — the endpoint

> Task #19 / `EDITOR_ENGINE.md` §8 Phase 4. The architectural endpoint:
> `apps/editor/` shrinks to the shell, and "the Cardboard editor" itself
> becomes `packages/core-editor-pack/` — a pack on top of the same shell
> a third party would build against. Proof-by-construction of the
> dogfooding principle.

This is a planning doc. **No code edits land in this commit.** The plan
itself is the deliverable; an implementation agent executes it in
sequenced sub-phases (P1–P5 below).

---

## 1. Goal + scope

After this phase ships:

- `apps/editor/src/views/` does **not exist** — every file currently
  rooted there is owned by `packages/core-editor-pack/`.
- `apps/editor/` ships only the shell: primitives (`components/ui/`),
  dock plumbing (`components/dock/`), Zustand sync layer + the eight
  Wave-3 stores (`state/`), IDB (`lib/EditorProjectStore.ts`),
  pack-chain loader (`packs/`), JSON panel renderer
  (`panel-renderer/`), extension manager, the editor shell chrome
  (`shell/`) that mounts the active view contributed by the pack chain.
- `apps/editor/src/main.tsx` becomes a ~50-line bootstrap: load the
  enabled pack-chain via `loadEditorPacks()`, mount `<EditorShell/>`
  with whatever views/panels/layouts the chain contributed.
- The core editor pack is **not special**. It uses the exact same
  manifest shape, the exact same `EditorPackContext` surface, the exact
  same `.apg` pipeline as `demo-performance-profiler/` (`EDITOR_ENGINE.md`
  §9). The only difference is that it ships pre-installed and enabled
  by default.

What "dogfooding proven" looks like, per
`.claude/memory/project_dogfooding_principle.md`:

> If we can build the entire editor on top of the shell's API surface,
> anyone else can build something on top of it too. Anything we use
> that a third party CAN'T use is a leak in the abstraction.

After this phase, the disable toggle in Editor Settings → Extensions
flipping the core-editor pack OFF + reload leaves the user with a bare
shell — chrome + primitives + a "no editor pack loaded" empty state.
That is the proof.

---

## 2. What stays in the shell

The shell is enumerated in `EDITOR_ENGINE.md` §2 ("Shell ships ONLY")
and locked in by the dogfooding memory ("What the shell ships",
`.claude/memory/project_dogfooding_principle.md:13`). Concrete file
inventory that does NOT move out of `apps/editor/`:

### `apps/editor/src/components/ui/` — primitives (whole tree)

51 files. Confirmed via `find apps/editor/src/components/ui -type f`:
`Button.tsx`, `Card.tsx`, `Modal.tsx`, `Tooltip.tsx`, `TabStrip.tsx`,
`Input.tsx`, `Select.tsx`, `Slider`, `NumberInput.tsx`,
`PropertyRow.tsx`, `ScrollRow.tsx`, `KeyValueList.tsx`, `controls.tsx`,
`charts.tsx`, `Layout`, `EmptyState.tsx`, … (full list inline in
"What moves" §3 by exclusion).

These are exposed via `components/ui/index.ts` and ARE the shell
design system. Packs (core or third-party) import from these — the
import path stays `from "@cardboard/editor-shell"` once we publish the
shell SDK, but for the in-monorepo path it stays as the editor's own
`components/ui/`.

### `apps/editor/src/components/dock/` — dockview plumbing

7 files: `DockShell.tsx`, `DockPanel.tsx`, `DockPanelHeader.tsx`,
`DocksModal.tsx`, `LayoutSkeleton.tsx`, `LayoutsModal.tsx`,
`useDockLayoutPersistence.ts`, `WorkspacePanel.tsx`. Confirmed at
`apps/editor/src/components/dock/DockShell.tsx:74` exposing
`DockPanelDef` — the type packs contribute against.

`WorkspaceRail` (`WorkspacePanel.tsx`) is shell — it owns the
predefined-layouts modal, the docks-modal, the rail buttons. Packs
contribute panel defs + layouts; the rail renders them. Verified at
`apps/editor/src/components/dock/WorkspacePanel.tsx:1-23` — imports
shell stores + ui primitives, has no panel-specific TSX.

### `apps/editor/src/state/` — Wave-3 stores + IDB hydration

19 files. The eight Wave-3 stores
(`useToolStore`, `useBrushStore`, `useTilePresetStore`,
`useTilePresetRegistryStore`, `useLayerStore`, `useSelectionStore`,
`useSceneStore`, `useHistoryStore`, `useDiagnosticsStore`), the
command + settings registries (`useCommandStore`, `useSettingsStore`),
the editor-pack-registry (`useEditorPacksStore`), the workspace store
(`useWorkspaceStore`), `useFileIndex`, `useDragStore`, the synced-store
factory (`sync.ts`), the `hydration.ts` + `historyDispatcher.ts`
plumbing, plus DnD payload typing and desktop-pairing singleton.

The dogfooding memory pins this: "Zustand sync layer — `createSyncedStore`
+ the eight Wave-3 stores" is shell. Schema lives in the shell; packs
read + write through these stores via the `EditorPackContext` exposed
hooks (per `editorPackLoader.ts:104-107` and the createStore primitive
at `:133-141`).

### `apps/editor/src/packs/` — pack-chain loader + context

4 files: `editorPackLoader.ts`, `libraryCache.ts`,
`PackContextProvider.tsx`, plus their tests. This is the shell's
universal contribution mechanism — the same loader pattern
`apps/game/` uses, scoped to `editor` panels/scripts/libraries.

### `apps/editor/src/panel-renderer/` — JSON panel renderer

7 files: `PanelRenderer.tsx`, `resolveBinding.ts`, `invokeScript.ts`,
`types.ts`, plus the specs directory (currently
`panel-renderer/specs/*.json` holds the legacy Phase-1b migrated
specs). Specs MOVE (see §3); the renderer + binding resolver + types
stay in shell. The renderer is what makes JSON-authored panels work
identically whether contributed by the core pack or a third-party pack.

### `apps/editor/src/shell/` — editor chrome

8 files: `EditorShell.tsx`, `TopBar.tsx`, `StatusBar.tsx`,
`StatusBarContext.tsx`, `EditorActionsContext.tsx`,
`ActiveSceneContext.tsx`, `PrimaryTabs.tsx`, `UserAvatar.tsx`. The
shell mounts the TopBar + tab strip + active-view container, owns the
URL-hash router (`lib/router.ts`), threads the
`<ActiveSceneProvider>`/`<EditorActionsProvider>`/
`<StatusBarProvider>`/`<TabContextSlotProvider>` providers, and
delegates the actual per-tab body to whatever the pack chain
contributes. The shell does NOT know about specific panels — it knows
about views the pack chain registers (see §9 — new
`registerView(viewId, component)` API).

### `apps/editor/src/lib/` — shared utilities

24 files. `EditorProjectStore.ts` (IDB), `router.ts`,
`tabContextSlot.tsx`, `dependencyManager.ts`, `iconPipeline.ts`,
`importPack.ts`, `keybinding.ts`, `resolveDepChain.ts`,
`sceneSerde.ts`, `sceneLabel.ts`, `useLocalStorage.ts`, `assetUrl.ts`,
`cn.ts`, `utils.ts`, `fuzzyMatch.ts`, `chainConflictDetector.ts`,
`presetCrud.ts`, `prefabConverter.ts`, `prefabAnimationWiring.ts`,
`gameRunnerUrl.ts`, `lightmapBaker.ts`, `fbxBaker.ts`,
`animationBaker.ts`, `componentSchemas.ts`. Some of these (the bakers)
are arguably engine-side, but they sit in the editor's `lib/` today
and run in the editor process. Phase 4 leaves them in shell —
re-evaluation happens in a later split (`ENGINE_PACK_SPLIT.md`).

### `apps/editor/src/components/palette/` + `pairing/` + `dnd/`

Command palette, pairing modal, DnD primitives. Shell.

### `apps/editor/src/workers/`, `assets/`, `styles/`

Shell. Style tokens stay in the shell per the dogfooding memory
("Default styles — Tailwind config + design tokens").

### `apps/editor/src/App.tsx`, `main.tsx`, `index.html`, `server.ts`

The bootstrap. Shrinks dramatically (see §8) — but stays in
`apps/editor/`.

---

## 3. What moves to `packages/core-editor-pack/`

Every file under `apps/editor/src/views/` except `EditorSettingsModal.tsx`
and `settings/ExtensionsTab.tsx` (see §3.3 for why those are
defensible-either-way and the recommendation).

### 3.1. The views/ tree — full inventory and target paths

`apps/editor/src/views/` currently holds 41 files. Map source → target
exhaustively:

| Source (under `apps/editor/src/views/`) | Target (under `packages/core-editor-pack/`) | Notes |
|---|---|---|
| `HomeScreen.tsx` | `views/HomeScreen.tsx` | Top-level view. Listed in pack manifest as a `views[]` contribution. |
| `MapView.tsx` | `views/MapView.tsx` | The Scene workspace shell — registers Scene's 18 panels + default layout via the pack's setup script. |
| `PrefabsView.tsx` | `views/PrefabsView.tsx` | Prefabs workspace shell — registers 6 panels + default layout. |
| `ProjectView.tsx` | `views/ProjectView.tsx` | Legacy project workflow surface. Still consumed for `animation` / non-scene tabs. |
| `EditorViewport.tsx` | `views/EditorViewport.tsx` | Cross-view viewport host. |
| `AssetsView.tsx` | `views/AssetsView.tsx` | Asset browser. |
| `ComponentsView.tsx` | `views/ComponentsView.tsx` | Component builder stub. |
| `ScriptsView.tsx` | `views/ScriptsView.tsx` | Monaco-backed script editor. Lazy-loaded today; stays lazy-loaded inside the pack via dynamic import in the pack's setup script. |
| `AnimationEditor.tsx` | `views/AnimationEditor.tsx` | Animation timeline view. |
| `ImageLabView.tsx` | `views/ImageLabView.tsx` | Image Lab stub. |
| `SoundLabView.tsx` | `views/SoundLabView.tsx` | Sound Lab stub. |
| `GridEditor.tsx` | `views/GridEditor.tsx` | Legacy grid editor used by ProjectView. |
| `EntitiesEditor.tsx` | `views/EntitiesEditor.tsx` | Legacy entities editor used by ProjectView. |
| `PlaytestOverlay.tsx` | `views/PlaytestOverlay.tsx` | Playtest HUD. |
| `MapPalette.tsx` | `views/MapPalette.tsx` | Legacy map-palette helper. |
| `ProjectSettingsModal.tsx` | `views/ProjectSettingsModal.tsx` | Project-scope settings modal. |
| `EditorSettingsModal.tsx` | **STAYS in shell** | See §3.3. |
| `settings/ExtensionsTab.tsx` | **STAYS in shell** | See §3.3. |
| `project/ProjectTabView.tsx` | `views/project/ProjectTabView.tsx` | Project tab — manifest + dependencies + advanced. |
| `scripts/modApiTypes.ts` | `views/scripts/modApiTypes.ts` | Type defs the Scripts view loads. |
| `scene/SceneTopBarSlot.tsx` | `views/scene/SceneTopBarSlot.tsx` | Per-tab tab-row right slot for Scene. |
| `scene/SceneTabContextPicker.tsx` | `views/scene/SceneTabContextPicker.tsx` | Used by `MapCanvasPanel`. |
| `scene/scene-fixtures.ts` | `views/scene/scene-fixtures.ts` | MOCK_LAYERS + MOCK_SCENE_SETTINGS. Core pack content. |
| `scene/panels/AssetReferencesPanel.tsx` | `panels/scene/AssetReferencesPanel.tsx` | Scene panel. |
| `scene/panels/BrushPanel.tsx` | `panels/scene/BrushPanel.tsx` | Scene panel (already mirrored as a JSON spec, see §6). |
| `scene/panels/CellInspectorPanel.tsx` | `panels/scene/CellInspectorPanel.tsx` | Hybrid TSX+JSON (see §6). |
| `scene/panels/HistoryPanel.tsx` | `panels/scene/HistoryPanel.tsx` | Scene panel. |
| `scene/panels/LayersPanel.tsx` | `panels/scene/LayersPanel.tsx` | Scene panel. |
| `scene/panels/LightingPanel.tsx` | `panels/scene/LightingPanel.tsx` | Scene panel. |
| `scene/panels/MapCanvasPanel.tsx` | `panels/scene/MapCanvasPanel.tsx` | The painter — biggest TSX surface (18 imports, full Wave-3 store consumption). |
| `scene/panels/MinimapPanel.tsx` | `panels/scene/MinimapPanel.tsx` | Scene panel. |
| `scene/panels/NotesPanel.tsx` | `panels/scene/NotesPanel.tsx` | Scene panel (least-deps — see P2 in §10). |
| `scene/panels/OutputPanel.tsx` | `panels/scene/OutputPanel.tsx` | Scene panel. |
| `scene/panels/PrefabBrowserPanel.tsx` | `panels/scene/PrefabBrowserPanel.tsx` | Scene panel. |
| `scene/panels/PreviewPanel.tsx` | `panels/scene/PreviewPanel.tsx` | 3D preview panel. |
| `scene/panels/ProblemsPanel.tsx` | `panels/scene/ProblemsPanel.tsx` | Scene panel. |
| `scene/panels/QuickToolsPanel.tsx` | `panels/scene/QuickToolsPanel.tsx` | Scene panel (already migrated to JSON). |
| `scene/panels/SceneSettingsPanel.tsx` | `panels/scene/SceneSettingsPanel.tsx` | Scene panel. |
| `scene/panels/SelectionInfoPanel.tsx` | `panels/scene/SelectionInfoPanel.tsx` | Scene panel (already migrated to JSON). |
| `scene/panels/TilePresetPanel.tsx` | `panels/scene/TilePresetPanel.tsx` | Scene panel. |
| `scene/panels/ToolPalettePanel.tsx` | `panels/scene/ToolPalettePanel.tsx` | Scene panel (already migrated to JSON). |
| `prefabs/panels/ComponentEditorPanel.tsx` | `panels/prefabs/ComponentEditorPanel.tsx` | Prefab panel. |
| `prefabs/panels/EntityDropZonePanel.tsx` | `panels/prefabs/EntityDropZonePanel.tsx` | Prefab panel. |
| `prefabs/panels/EntityHeaderPanel.tsx` | `panels/prefabs/EntityHeaderPanel.tsx` | Prefab panel. |
| `prefabs/panels/EntityListPanel.tsx` | `panels/prefabs/EntityListPanel.tsx` | Prefab panel. |
| `prefabs/panels/EntityPreviewPanel.tsx` | `panels/prefabs/EntityPreviewPanel.tsx` | Prefab panel. |
| `prefabs/panels/JsonPreviewPanel.tsx` | `panels/prefabs/JsonPreviewPanel.tsx` | Prefab panel. |
| `prefabs/prefabs-fixtures.ts` | `panels/prefabs/prefabs-fixtures.ts` | MOCK_ENTITIES — core pack content. |

### 3.2. JSON panel specs

The existing Phase-1b migrated specs at
`apps/editor/src/panel-renderer/specs/*.json` (5 specs: `brush.json`,
`cell-inspector.json`, `quick-tools.json`, `selection-info.json`,
`tool-palette.json`) are core-editor-pack content. Move:

| Source | Target |
|---|---|
| `apps/editor/src/panel-renderer/specs/brush.json` | `packages/core-editor-pack/panels/scene/brush.json` |
| `apps/editor/src/panel-renderer/specs/cell-inspector.json` | `packages/core-editor-pack/panels/scene/cell-inspector.json` |
| `apps/editor/src/panel-renderer/specs/quick-tools.json` | `packages/core-editor-pack/panels/scene/quick-tools.json` |
| `apps/editor/src/panel-renderer/specs/selection-info.json` | `packages/core-editor-pack/panels/scene/selection-info.json` |
| `apps/editor/src/panel-renderer/specs/tool-palette.json` | `packages/core-editor-pack/panels/scene/tool-palette.json` |

The renderer fixture
`apps/editor/src/panel-renderer/test-fixtures/demo-selection-info.json`
stays — it's a test artefact, not content.

The migrated specs currently shipped by `cardboard-editor-pack-demo`
(`panels/*-migrated.json`) are demoware that proves the loader works.
Decision: when the core pack ships its OWN migrated specs, the demo
pack's `*-migrated.json` specs become noise — delete them in P5 to
keep the demo pack a focused "look, third-party panels work" example.

### 3.3. Borderline cases — defensible recommendations

**`EditorSettingsModal.tsx` + `settings/ExtensionsTab.tsx` —
recommendation: stay in shell.**

Rationale:

- The Extensions tab IS the mechanism by which a user
  enables/disables packs. If the Extensions tab itself lived in the
  core pack, disabling the core pack would orphan the user with no UI
  to re-enable it. Recovery would require editing localStorage by
  hand. That's a shell concern, not a pack concern.
- The General tab is a registry-driven view over `useSettingsStore`
  (the settings registry). The settings registry is shell. Adding new
  settings from a pack is already a one-line `registerSetting(...)`
  call inside the pack's setup script (per the existing API at
  `apps/editor/src/state/useSettingsStore.ts`). The tab renders
  whatever the registry contains — no pack-specific TSX needed for
  pack settings to surface.
- A third party can already ship settings without owning the modal.

If a future plan splits these out anyway, it should be a follow-on,
not part of Phase 4.

**`shell/EditorShell.tsx` — recommendation: stay in shell, but slim
down.**

Today it owns:

1. Router reconciliation (hash → tab → view). Shell.
2. Project + manifest + assets loading. Shell (uses
   `EditorProjectStore`).
3. Wave-3 store hydration. Shell.
4. Cross-tab navigation events. Shell.
5. Direct imports of every per-tab view from `../views/`. **PACK** —
   this is what changes. After Phase 4 the shell pulls per-tab view
   components from a `useEditorPackViews()` registry instead of static
   imports.

The shell stays where it is; the static imports become a runtime
lookup (see §9 — `registerView(viewId, component)`).

### 3.4. The TopBar "demo command" entries inside `EditorShell.tsx`

`EditorShell.tsx:553-617` registers home commands
(`homescreen.newProject`, `homescreen.openUrlPack`,
`homescreen.openProject.<id>`) and registers the
`editor.userInitials` setting. These are core-editor-pack content
(they're tied to specific views — HomeScreen). Move them into the core
pack's `scripts/setup.ts`. The shell keeps:

- Navigation tab commands (`navigation.openX` for each PRIMARY_TAB)
  IFF the primary tabs themselves stay in shell. They don't — see
  §3.5. Conclusion: move these to the core pack too.
- The keyboard global handler (`EditorShell.tsx:670-716`) stays — it's
  a shell concern that walks the live command registry.

### 3.5. `PRIMARY_TABS` + tab definitions

`shell/PrimaryTabs.tsx` defines `PRIMARY_TABS` (the 10-tab strip). Are
tabs shell or pack? **They are pack.** Different editor packs would
ship different tab strips (e.g. an "audio-only DAW pack" would have no
Map/Prefabs tabs and would add a "Tracks" tab).

The shell ships `<PrimaryTabs/>` as a primitive that renders whatever
tab list it's handed. The list itself is contributed by packs via a
new `registerTab({id, label, icon, order})` API (see §9).

Today's `PRIMARY_TABS` constant + `PRIMARY_TAB_ORDER` move into the
core-editor-pack `scripts/setup.ts`. The shell's `<PrimaryTabs/>`
component reads from `useTabsStore` (new — see §9).

### 3.6. Default layouts

`MapView.tsx:179-378` (`buildDefaultLayout()`) and
`PrefabsView.tsx` (similar function inside) — these JSON literals
encode the Scene + Prefabs default layouts. They move with the views.
But the shell needs a way for packs to contribute these without
hardcoding their location. See §7.

The shared catalogue at
`apps/editor/src/state/predefinedLayouts.ts` (which the
`LayoutsModal` renders) is mostly content — the "Default" /
"Compact" / "Painter Focus" presets are core-editor-pack content.
Decision: move `predefinedLayouts.ts` to the core pack as well, and
expose a `registerPredefinedLayout()` API. The shell's `LayoutsModal`
reads from `useLayoutCatalogStore` (new — see §9).

---

## 4. New core pack manifest

Mirrors the `demo-performance-profiler/manifest.json` shape (verified
at `packages/demo-performance-profiler/manifest.json:1-23` — see also
`EDITOR_ENGINE.md` §5 example). The core pack is just another editor
pack — same fields, just bigger.

```jsonc
// packages/core-editor-pack/manifest.json
{
  "id": "cardboard-core-editor",
  "name": "Cardboard Editor",
  "version": "0.1.0",
  "engine": "two_5_d@0.1",
  "scope": ["editor"],
  "scripts": [
    "scripts/setup.ts",          // registers tabs + global commands
    "scripts/scene-workspace.ts",// registers MapView panels + layout
    "scripts/prefabs-workspace.ts",
    "scripts/views.ts"           // registers each top-level view component
  ],
  "editorPanels": [
    "panels/scene/brush.json",
    "panels/scene/cell-inspector.json",
    "panels/scene/quick-tools.json",
    "panels/scene/selection-info.json",
    "panels/scene/tool-palette.json"
    // JSON-only specs. TSX-backed panels register via `scene-workspace.ts`
    // through the new `registerPanel({component})` API (§9).
  ],
  "defaultLayouts": [
    { "viewId": "scene",   "path": "layouts/scene-default.json"   },
    { "viewId": "prefabs", "path": "layouts/prefabs-default.json" }
  ]
}
```

`defaultLayouts` is a NEW manifest field (see §7). The pack-builder
must teach it to the manifest schema in
`packages/engine/src/AssetPack/types.ts` (the
`manifest.libraries` field was added there at line 527 — same
pattern).

### How is the core pack distinguished from third-party packs?

**It isn't.** The loader treats it identically. The only difference:

1. The seed in `useEditorPacksStore`
   (`apps/editor/src/state/useEditorPacksStore.ts:89-107`) includes
   `cardboard-core-editor` with `enabled: true` so a fresh install
   gets an editor.
2. The Extensions tab MAY surface a "core" badge that warns about
   disabling it (UX nicety — does not change loader behaviour).

The pack's `.apg` is produced by the same `bun run build-packs`
pipeline (`apps/pack-builder/src/build-packs.ts`) — verified at
`build-packs.ts:130-136` (`pickOutDir`), the editor-scope packs land
in `apps/editor/public/packs/<id>.apg`. The shell fetches the core
pack at `/packs/cardboard-core-editor.apg` (per
`editorPackLoader.ts:195` — `EDITOR_PACKS_BASE = "/packs"`).

---

## 5. New core pack scripts

The pack ships JS that the loader executes at startup via
`runEditorPackScript()` (verified at `editorPackLoader.ts:519-586`).
Three responsibilities:

### 5.1. `scripts/setup.ts` — global wiring

- Register every primary tab via `ctx.registerTab(...)` (new API §9).
- Register global commands previously in `EditorShell.tsx:553-617`
  (`homescreen.*`, `navigation.openX`).
- Register the global `editor.userInitials` setting (currently at
  `EditorShell.tsx:570-578`).
- Hydrate any LS-mirrored shell mirror state the views need.

### 5.2. `scripts/scene-workspace.ts` — Scene workspace contributions

- Register each TSX-backed panel via
  `ctx.registerPanel({ id, title, category, component, icon, surface,
  headerless })` (new API §9). Inputs are the existing `MANIFEST`
  exports from each panel file — verified at
  `MapView.tsx:14-84` where 18 panels are imported with their
  `MANIFEST` objects.
- Register the Scene default layout via
  `ctx.registerLayout("scene", sceneDefaultLayout)` (new API §9).
- Register the Scene-page predefined-layout catalogue via
  `ctx.registerPredefinedLayout("scene", { id, name, layout })` once
  per preset.
- Register the Scene view component itself via
  `ctx.registerView("scene", MapView)` (new API §9).

### 5.3. `scripts/prefabs-workspace.ts` — Prefabs workspace

Same pattern as `scene-workspace.ts` for the 6 prefab panels +
PrefabsView default layout.

### 5.4. `scripts/views.ts` — every other top-level view

Register the remaining view components:

```ts
ctx.registerView("home", HomeScreen);
ctx.registerView("project", ProjectTabView);
ctx.registerView("assets", AssetsView);
ctx.registerView("scripts", ScriptsView);
ctx.registerView("components", ComponentsView);
ctx.registerView("animation", AnimationEditor);
// + the placeholder views (imageLab, soundLab, uiBuilder)
```

Plus any cross-view commands the views previously registered in their
own mount effects (see `grep -rn registerCommand views/` — verified
output: 21 view files register commands; each panel's commands move
with the panel TSX file itself, since the registration is colocated
inside the React component's `useEffect`).

### 5.5. The current `cardboard-editor-pack-demo` script pattern

Verified at `packages/cardboard-editor-pack-demo/scripts/setup.ts:43-63`.
The pattern works as-is for the core pack — type-only import of
`EditorPackContext` from the editor source, default-exported setup
function that takes `ctx` and returns a cleanup. The pack-builder
transpiles `.ts` → `.js` (per `build-packs.ts:932-970` — the
"Pack-script TSX compile step" — `manifest.scripts[]` paths are
included in `referencedScripts` at `:922-926`). Type-only imports
erase to nothing at runtime, so the emitted JS has no editor-side
dependency.

---

## 6. JSON panel specs vs TSX panel hosts

### Current state — verified

Phase 1b shipped 5 JSON panel specs (SelectionInfo, ToolPalette,
Brush, QuickTools, CellInspector hybrid). The renderer surface
(`apps/editor/src/panel-renderer/types.ts:524-540`) supports 15 node
types. Phase 1b halted after CellInspector landed as a hybrid (4 rows
JSON, 3 rows inline TSX) per `EDITOR_ENGINE.md` §8 Phase 1b row.

The remaining 13 panels under `views/scene/panels/` + 6 under
`views/prefabs/panels/` are TSX — they all import Wave-3 stores, use
shell primitives, and register commands. Verified `MapCanvasPanel.tsx`
imports 18 modules (a typical heavy panel).

### Decision: pack-shipped TSX is fine.

The dogfooding principle ("use what we ship") is satisfied two ways
when a third party can also ship TSX panels via the same mechanism the
core pack uses. The renderer surface does NOT need to grow large
enough to express every panel — that would be a years-long expansion
project that bloats the renderer and slows shell evolution.

Add `registerPanel(def: DockPanelDef)` to `EditorPackContext` (§9).
The def carries a `component: React.FunctionComponent` field — exactly
the shape `DockPanelDef` already has at
`apps/editor/src/components/dock/DockShell.tsx:74`. The loader
already wraps panel renderers in `<PackContextProvider>` for the JSON
path (`editorPackLoader.ts:208-232`); the TSX path reuses the same
wrapper.

A third-party pack ships TSX through the SAME API. The pack's
TSX-compiled `.js` registers components against the shell — same trust
boundary as VS Code extensions (per `EDITOR_ENGINE.md` §10 "Sandbox /
security" risk row, this is by design).

### How TSX panels reach the editor process

The pack-builder already compiles `.tsx` scripts via
`build-pack-script.ts` (verified at `build-packs.ts:941-970`). The
emitted `.js` bundles React + the panel's imports. The loader
dynamic-imports it via Blob URL.

**Gotcha #1 — React identity.** Two React instances in one tree (one
in the editor, one in the pack's bundle) break hooks. Solution: mark
React as `external` in the pack-builder's `Bun.build` config for pack
scripts so the pack imports the same React instance the editor
provides. This means the editor must export React on a global the
pack can resolve — `window.React = React` in the shell bootstrap, and
the pack-builder's transform rewrites `import React from "react"` →
`const React = window.React`. Same trick the Performance Profiler
already needs (it imports `chart.js` via `ctx.importLibrary` rather
than bare import — verified at `demo-performance-profiler/scripts/setup.ts:196`).

**Gotcha #2 — shell primitives.** Panels import from
`../../components/ui/Tooltip` etc. After the move the import path
becomes `from "@cardboard/editor-shell"` (a published SDK) OR — for
in-monorepo packs — a relative path
`from "../../../apps/editor/src/components/ui/Tooltip"` that the
pack-builder resolves at compile time and rewrites to a runtime lookup
against a shell-exported registry. Specifically: the shell publishes
`window.CardboardEditorShell = { Tooltip, Button, ... }` at boot and
the pack-builder rewrites `from "@cardboard/editor-shell"` imports to
`const { Tooltip } = window.CardboardEditorShell`. This is the
mechanism that makes the same panel TSX byte-identical whether shipped
by the core pack or by a third party.

This adds a real new line of work to the pack-builder. See risks
(§11).

### Recommendation regression — the renderer still grows on demand

When migrating a TSX panel reveals a generally-useful primitive (a
KeyValueList row, a virtualized list), prefer extending the JSON
renderer FIRST so the JSON path absorbs the capability. The renderer
is the simpler dogfooding surface. The TSX escape hatch exists, but is
not the default.

---

## 7. Default layouts

`MapView.tsx:179-378` ships `buildDefaultLayout(): SerializedDockview`
inline. `PrefabsView.tsx` does the same. These layouts:

1. Move into the pack as JSON files
   (`packages/core-editor-pack/layouts/scene-default.json`,
   `layouts/prefabs-default.json`).
2. The manifest declares them via a new `defaultLayouts[]` field
   (§4).
3. At pack-load time the loader walks `defaultLayouts`, reads each
   JSON, and calls `ctx.registerLayout(viewId, layout)` (new API §9).
4. The shell's workspace-mount logic (today in `MapView.tsx:421`
   `buildDefaultLayout()`) becomes a lookup against
   `useLayoutCatalogStore.getState().defaults[viewId]`. When the user
   hasn't customized a layout, that default applies.

The predefined-layouts modal catalogue (today
`apps/editor/src/state/predefinedLayouts.ts`) migrates into the pack
as JSON files under `packages/core-editor-pack/layouts/presets/*.json`
and registers via `ctx.registerPredefinedLayout(viewId, preset)`.

Merge semantics: pack-chain order matters. If two packs register a
default layout for the same `viewId`, last-write-wins per the
pack-chain's standard contribution semantics
(`docs/plans/PACK_CHAIN.md` — last-write-wins per asset kind). Same
for `registerView` (a later pack can override the core pack's `MapView`
with a custom Scene workspace).

---

## 8. Editor app shrinks to shell

The bootstrap after Phase 4:

```tsx
// apps/editor/src/main.tsx (final form, ~30 lines)
import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { loadEditorPacks } from "./packs/editorPackLoader";

// Expose the shell's React + primitives on globals so pack-shipped
// TSX bundles can resolve them at runtime (see §6 gotcha #1, #2).
import * as ShellExports from "./shell-sdk";
declare global {
  interface Window {
    React: typeof React;
    CardboardEditorShell: typeof ShellExports;
  }
}
window.React = React;
window.CardboardEditorShell = ShellExports;

async function boot() {
  // Load every enabled editor pack BEFORE first render so contributed
  // views/panels/layouts are available the moment <App/> mounts.
  await loadEditorPacks();
  const root = createRoot(document.getElementById("root")!);
  root.render(<App />);
}

void boot();
```

`App.tsx` stays a one-liner mount of `<EditorShell/>`. `EditorShell`
is the same component conceptually — its imports of `../views/*`
become lookups against the new registries:

```tsx
// inside EditorShell's ShellBody
const View = useView(tab);              // useEditorPackViews().get(tab)
if (!View) return <EmptyStateNoView/>;  // shell fallback
return <View projectId={projectId}/>;
```

The shell-only directory tree after Phase 4:

```
apps/editor/
├── public/packs/                  // .apg cache (gitignored)
│   ├── cardboard-core-editor.apg
│   ├── demo-performance-profiler.apg
│   └── …
├── src/
│   ├── App.tsx                    // 1-liner
│   ├── main.tsx                   // ~30 lines (bootstrap)
│   ├── shell-sdk.ts               // re-export of shell primitives
│   ├── components/                // ui/ + dock/ + dnd/ + palette/ + pairing/
│   ├── lib/                       // IDB + utilities
│   ├── packs/                     // loader + library cache
│   ├── panel-renderer/            // JSON renderer + types
│   ├── shell/                     // EditorShell + TopBar + StatusBar + …
│   ├── state/                     // Wave-3 stores + new registries
│   ├── styles/                    // tokens
│   └── workers/                   // bake workers
└── server.ts                      // Bun dev server
```

The `views/` directory is **gone**. That's the acceptance check.

---

## 9. New `EditorPackContext` APIs needed

The current context surface
(`apps/editor/src/packs/editorPackLoader.ts:92-180`) exposes:
`registerCommand`, `stores.selection`, `importLibrary`, `createStore`,
`getCanvasRef`, `onPanelMount`, `share`, `consume`. Phase 4 adds:

### 9.1. `registerPanel(def: DockPanelDef): () => void`

```ts
registerPanel: (def: {
  id: string;
  title: string;
  category: string;
  component: React.FunctionComponent;
  icon?: React.ReactNode;
  surface?: boolean;        // default true
  headerless?: boolean;     // default false
}) => () => void;
```

Mirrors `DockPanelDef` exactly (`DockShell.tsx:74`). Today
`useEditorPackPanels()` (`editorPackLoader.ts:641-654`) is the only
contribution path and only handles JSON specs. This new API lets the
pack's TSX-backed scripts register components — closes the gap between
"core pack" and "third party that wants to ship TSX".

The implementation writes into a new shell store
`useDockPanelRegistryStore` (one entry per registered panel, keyed by
id). The Scene `<MapView/>` reads via `useDockPanelRegistry("scene")`
(category filter). Cleanup unregisters on pack disable.

### 9.2. `registerView(viewId, component)`

```ts
registerView: (viewId: string, component: React.FunctionComponent) =>
  () => void;
```

Lets a pack contribute a top-level workspace view. `<EditorShell/>`'s
ShellBody (`EditorShell.tsx:779-936`) becomes a lookup against this
registry — the static imports of MapView/PrefabsView/etc. go away.

Backed by `useViewRegistryStore`. Pack-chain last-write-wins (a later
pack can override the core pack's `scene` view with a custom Scene
workspace).

### 9.3. `registerLayout(viewId, layout)`

```ts
registerLayout: (viewId: string, layout: SerializedDockview) =>
  () => void;
```

Contributes the default `<DockShell/>` layout for a view. The shell
reads via `useDefaultLayout(viewId)`.

Backed by `useLayoutCatalogStore.defaults`.

### 9.4. `registerPredefinedLayout(viewId, preset)`

```ts
registerPredefinedLayout: (
  viewId: string,
  preset: { id: string; name: string; description?: string;
            layout: SerializedDockview }
) => () => void;
```

Adds an entry to the LayoutsModal's predefined-layout catalogue
(today `apps/editor/src/state/predefinedLayouts.ts`).

Backed by `useLayoutCatalogStore.presets[viewId]`.

### 9.5. `registerTab(tab)`

```ts
registerTab: (tab: {
  id: string;
  label: string;
  icon: React.ReactNode;
  order?: number;          // smaller renders earlier; default 100
  enableOutsideProject?: boolean; // home tab opts in; others stay false
}) => () => void;
```

Lets the pack contribute primary tabs. Today
`shell/PrimaryTabs.tsx:PRIMARY_TABS` is a hardcoded constant. After
Phase 4 the shell's `<PrimaryTabs/>` reads from a `useTabsStore`.

### 9.6. `registerSetting` — already exists but re-export

The shell's `registerSetting` (per
`apps/editor/src/state/useSettingsStore.ts`) needs to be on the pack
context so a pack's `setup.ts` can register settings the same way.
One-line addition.

### 9.7. `stores: { all 8 Wave-3 stores }`

Today the context only exposes
`stores.selection` (`editorPackLoader.ts:104`). Widen to the full eight
so pack TSX components can `import { useSceneStore } from ctx.stores`-
equivalent — or, more idiomatically, the pack-builder rewrites
`import { useSceneStore } from "@cardboard/editor-shell"` to a runtime
lookup against `window.CardboardEditorShell.useSceneStore`. Either
path works; the latter is simpler for authoring.

For the context-handed-to-scripts surface, the field becomes:

```ts
stores: {
  selection: typeof useSelectionStore;
  scene:     typeof useSceneStore;
  layer:     typeof useLayerStore;
  tool:      typeof useToolStore;
  brush:     typeof useBrushStore;
  tilePreset: typeof useTilePresetStore;
  history:   typeof useHistoryStore;
  diagnostics: typeof useDiagnosticsStore;
  workspace: typeof useWorkspaceStore;
  // The settings + commands + packs registries are addressed via
  // their own typed accessors (registerCommand / registerSetting /
  // useEditorPacksStore).
};
```

### 9.8. Anti-API — `getInternalEditorHook` or similar

DO NOT add an escape-hatch API that lets the core pack reach
non-public shell surfaces. The whole point of this phase is to prove
the core pack has parity with third-party packs. If the core pack
needs something the context doesn't expose, that's a real shell gap
and gets filled by adding a properly designed API for everyone.

---

## 10. Phased build order

Each phase is independently shippable. Smallest possible commits.

### P1 — Skeleton + manifest + loader smoke (low-risk, high-information)

- Create `packages/core-editor-pack/` with `package.json`,
  `manifest.json` (just `id`/`name`/`version`/`scope`/empty
  `editorPanels`/empty `scripts`), `tsconfig.json`,
  `scripts/setup.ts` (a no-op default export that logs
  "core-editor-pack: hello").
- Add `"cardboard-core-editor"` to
  `useEditorPacksStore` INITIAL_STATE (it'll merge in for new installs;
  existing installs pick it up on next reload per the seed-pass at
  `apps/editor/src/state/useEditorPacksStore.ts:155-168`).
- Run `bun run build-packs`. Verify
  `apps/editor/public/packs/cardboard-core-editor.apg` exists.
- Visit the editor. Verify the console logs "core-editor-pack: hello"
  but nothing else changes. Editor still renders normally because the
  views/panels still come from the static imports inside `MapView.tsx`
  etc.

Ships: ~50 LoC + 1 small `.apg`. Validates the build pipeline knows
about the pack.

### P2 — One panel migration — NotesPanel

NotesPanel is the smallest panel (one feature, LS-backed text,
3 commands, no Wave-3 store reads beyond `useActiveScene` — verified
at `apps/editor/src/views/scene/panels/NotesPanel.tsx:11`).

- Add `registerPanel` API to `EditorPackContext` (the
  `editorPackLoader.ts` ~ 30 LoC change).
- Add `useDockPanelRegistryStore` to `state/`.
- Make MapView's panel registry read core-pack contributions via the
  store, MERGING with the static `PANELS` array. (Bridge state — every
  panel still has a static fallback.)
- Move `NotesPanel.tsx` → `packages/core-editor-pack/panels/scene/NotesPanel.tsx`.
- The core pack's `scripts/setup.ts` imports NotesPanel + registers
  via `ctx.registerPanel(NOTES_MANIFEST_PLUS_COMPONENT)`.
- Delete the static import + registry entry in `MapView.tsx`.
- Run editor. Verify Notes panel still appears in DocksModal under
  Diagnostics, still works (textarea, copy/export/clear commands).

Ships: the registerPanel API + one panel. The pattern is established
for P3.

### P3 — Migrate remaining panels in dependency-ordered batches

Sort panels by store-import count + cross-panel coupling. Cheapest
first.

**Batch A — leaf panels (no Wave-3 writes, only reads):**

- `ProblemsPanel`, `OutputPanel`, `HistoryPanel`, `MinimapPanel`,
  `LightingPanel`, `AssetReferencesPanel`, `PrefabBrowserPanel`,
  `SceneSettingsPanel`, `PreviewPanel`. ~ 9 panels.

**Batch B — store-write panels:**

- `LayersPanel`, `TilePresetPanel`, `BrushPanel` (already JSON; just
  move the spec), `SelectionInfoPanel` (already JSON), `ToolPalettePanel`
  (already JSON), `QuickToolsPanel` (already JSON), `CellInspectorPanel`
  (hybrid — both the JSON spec and TSX component file move). ~ 7
  panels.

**Batch C — the painter:**

- `MapCanvasPanel`. Largest TSX surface (18 imports including all of
  Wave-3 stores, the historyDispatcher, the texture cache). This is
  the deep-end migration — when this works, every panel works.

**Batch D — Prefabs panels:**

- All 6 prefabs panels.

Each batch is a separate commit. Inside a batch, panels move in any
order — they're independent. Each panel migration is:

1. Copy file into the pack at its target path.
2. Edit the pack's `scripts/scene-workspace.ts` (or
   `prefabs-workspace.ts`) to import + register.
3. Rebuild `.apg`.
4. Delete the static import + registry entry in `MapView.tsx` /
   `PrefabsView.tsx`.
5. Verify the editor still renders identically.

### P4 — View shells move

After all panels are in the core pack, the views themselves move.
This is the biggest single commit in the phase.

- Add `registerView`, `registerLayout`, `registerPredefinedLayout`,
  `registerTab` to `EditorPackContext`.
- Add `useViewRegistryStore`, `useLayoutCatalogStore`, `useTabsStore`
  to `state/`.
- Move `MapView.tsx` → `packages/core-editor-pack/views/MapView.tsx`.
  Same for `PrefabsView`, `HomeScreen`, `ProjectView`, `AssetsView`,
  `ScriptsView`, `ComponentsView`, `AnimationEditor`,
  `ProjectTabView`, `EditorViewport`, `PlaytestOverlay`,
  `ProjectSettingsModal`, `EditorViewport`, the labs placeholders.
- Move `predefinedLayouts.ts` → `packages/core-editor-pack/layouts/
  presets/*.json` (one JSON per preset).
- Move `MapView.tsx`'s `buildDefaultLayout()` JSON literal →
  `packages/core-editor-pack/layouts/scene-default.json`.
- The pack's `scripts/views.ts` + `scene-workspace.ts` register them
  all.
- The shell's `EditorShell.tsx:ShellBody` (lines 779-936) is rewritten
  to use `useViewRegistry().get(tab)` instead of the static if/else.
- Move `MOCK_*` fixtures (`scene-fixtures.ts`, `prefabs-fixtures.ts`)
  into the pack.

### P5 — Delete `apps/editor/src/views/` + shrink bootstrap

- Verify `apps/editor/src/views/` is empty (every file moved in
  P3+P4).
- `rm -rf apps/editor/src/views/` — verify the typechecker passes.
- Shrink `main.tsx` to the ~30-line shape in §8.
- Add the `shell-sdk.ts` re-export module.
- Update the pack-builder to mark `react` + `@cardboard/editor-shell`
  as `external` when bundling pack scripts; emit the runtime-rewrite
  shim that resolves them via `window.React` / `window.CardboardEditorShell`.
  This is the biggest new line item — see §11 risk row.
- Delete the demo pack's `*-migrated.json` specs (now duplicated by
  the core pack's own specs).
- Final acceptance test: disable the core pack via Extensions tab →
  reload → editor shows bare shell + empty-state.

---

## 11. Risks + open questions

### Risk: pack-builder must externalize React + shell SDK (real new work)

After P4, the panel TSX files compile inside the core pack. The
pack-builder runs `Bun.build` on each script entrypoint with
`packages: "bundle"` (verified at `build-packs.ts:794-806` —
`packages: "bundle"`). This bundles EVERYTHING including React, which
gives you two React instances in one DOM and hooks break.

Mitigation: change the pack-builder's `Bun.build` call (or add a
post-processing pass) to mark `react`, `react-dom`,
`@cardboard/editor-shell`, and `zustand` as external. The emitted
bundle then references them via `globalThis.React` etc. The shell
bootstrap exposes them.

This is a real refactor of `apps/pack-builder/src/build-pack-script.ts`
and is the SINGLE biggest non-mechanical change in Phase 4. Spike it
in P1 — if it doesn't work, the whole plan is off the rails.

**Verification probe to run before P2:** make
`cardboard-editor-pack-demo` ship a tiny TSX-backed React component
via `ctx.registerPanel`. If that component renders without a hook
error, the externalization works. If it produces "Invalid hook call
— hooks can only be called inside the body of a function component",
fix this BEFORE proceeding.

### Risk: HMR loss for pack-side panel work

Today, editing `apps/editor/src/views/scene/panels/NotesPanel.tsx`
triggers a Bun `--hot` reload in 100-200ms. After the move, the file
lives in the pack and editing it requires `bun run build-packs` (~few
seconds) + a browser reload + a fresh pack-load. That's a major DX
regression.

Mitigation options (pick one in P1 and validate):

1. **Dev-mode static-import path.** When `NODE_ENV=development`, the
   editor falls back to a hardcoded import of the in-monorepo pack's
   source files. Pack-builder only runs for production / when the
   user explicitly invokes it. **Cheap, restores HMR fully, but
   means dev-mode is not exercising the dogfooded loader path —
   the very thing we're trying to dogfood.**
2. **File-watch + auto-rebuild + auto-reload.** Add a watcher to
   `bun run dev` that re-runs `build-packs` on any change under
   `packages/core-editor-pack/` and pings the dev server to reload.
   Slower iteration (~1-2s per save) but preserves the dogfooded
   path.
3. **In-process pack-source resolution.** Teach the editor's dev
   server to serve pack contents directly out of
   `packages/core-editor-pack/` rather than out of `.apg`. The
   loader fetches `/_pack-source/cardboard-core-editor/manifest.json`
   etc. instead of `/packs/cardboard-core-editor.apg`. Best of both
   worlds — true HMR over the loader code path. More implementation
   work.

Recommendation: ship option (2) for P1 (just to keep moving) and
upgrade to (3) in P5 once the pipeline is stable. Option (1) is the
fallback if (2)/(3) take too long.

### Open question: where does the workspace rail register?

The rail (`apps/editor/src/components/dock/WorkspacePanel.tsx`) is
shell — it renders the Layouts + Docks modals. But the modals' content
(predefined layouts, panel list) is pack-contributed. Verified the
rail imports the registry via props (`WorkspaceRail({ registry })` at
`WorkspacePanel.tsx:147`). So the rail stays in shell and reads from
the new `useDockPanelRegistry()` + `useLayoutCatalogStore` rather than
the prop. Same component, different data source.

### Open question: tab-strip ordering and contribution timing

`MapView.tsx:387-388` calls `useTabContextSlot(<SceneTopBarSlot/>)` to
inject content into the tab strip's per-tab right slot. That hook is
shell — `apps/editor/src/lib/tabContextSlot.tsx` exports a
`TabContextSlotProvider` + `useTabContextSlot()` consumer.

The pattern survives the move unchanged: the moved `MapView` (now in
the pack) keeps calling `useTabContextSlot` because the shell exports
it via the SDK. The shell continues to own the slot provider mounted
above the tab strip.

### Open question: `useEditorPackPanels` merging vs registration

Today's hook (`editorPackLoader.ts:641-654`) returns a list of
DockPanelDefs the loader produced from JSON specs. MapView merges them
with its static `PANELS` array (`MapView.tsx:395-398`). After Phase
4, the static array is empty (or doesn't exist), and ALL panels are
registered via `registerPanel`. The hook becomes a thin wrapper around
`useDockPanelRegistryStore(category)`. Clean — same shape, different
fan-in.

### Open question: how does the legacy editor-pack-demo coexist?

It still works post-Phase-4 because the loader is unchanged from its
perspective — same manifest shape, same scripts pipeline. The
demo pack stops being a "proof-of-concept" and starts being an
"example third-party pack" — its README updates to say "this is what
your editor pack looks like". The `*-migrated.json` specs become
redundant with the core pack's specs and are deleted (P5).

### Open question: bake workers + IDB schemas

Bake workers (`apps/editor/src/workers/`) and the IDB schema
(`apps/editor/src/lib/EditorProjectStore.ts`) are shell. They don't
move. But the things that CALL into them (lightmap bake from
`SceneSettingsPanel`, asset CRUD from `AssetsView`) live in the pack
after Phase 4. The pack-script imports the shell's exported APIs
through the SDK — no new mechanism needed.

### Open question: third-party pack manifest extensions

Today's pack `cardboard-editor-pack-demo` declares `editorPanels[]` +
`scripts[]`. The core pack also needs `defaultLayouts[]`. We're adding
that field — the engine's `PackManifest` type
(`packages/engine/src/AssetPack/types.ts`) needs an additive change
mirroring how `libraries` was added. Confirm with the engine's tests
that the additive change doesn't break game-pack manifests.

### Open question: scripts/setup.ts pattern at scale

The cardboard-editor-pack-demo's `setup.ts` is 64 lines for one
command registration. The core pack's setup-equivalent will register
~24 panels + ~10 views + ~50 commands. Splitting across multiple
scripts (per §5: `setup.ts`, `scene-workspace.ts`, `prefabs-workspace.ts`,
`views.ts`) keeps each file readable. The loader runs scripts in
declaration order (verified at
`editorPackLoader.ts:508-510`), so cross-script ordering is
deterministic.

---

## 12. Acceptance criteria

The implementation agent verifies these before declaring Phase 4
green:

1. **`apps/editor/src/views/` does not exist.** Verified by
   `ls apps/editor/src/` not listing `views/`. (`P5` deliverable.)
2. **Editor renders identically with the core pack enabled.** Open
   the editor → Scene tab loads → all 18 Scene panels present in the
   DocksModal → drag/drop layout still works → undo/redo still works
   → all keyboard shortcuts still fire.
3. **Performance Profiler + Scene Stats packs still work alongside
   the core pack.** All three packs co-exist in the Extensions list;
   the Profiler panel still renders a live chart; chart.js dedup
   still produces one shared module across the two consumer packs.
4. **Disable + reload yields a bare shell.** Editor Settings →
   Extensions → toggle `cardboard-core-editor` OFF → reload → editor
   renders TopBar + a "no editor view loaded" empty state body. No
   panels, no tabs (except Home, which the shell could surface as a
   built-in fallback OR which goes away entirely — TBD in
   implementation; both are acceptable).
5. **Re-enable + reload returns the editor.** Toggling back ON +
   reload brings everything back identically.
6. **Typecheck clean.** `bun run typecheck` at the monorepo root
   passes — verifies the pack-builder externalization didn't introduce
   any cross-package type drift.
7. **Pack-builder produces a deterministic core-pack `.apg`.** Two
   consecutive `bun run build-packs` runs produce byte-identical
   `cardboard-core-editor.apg` files (modulo the chart.js hash drift
   already accommodated). Verify via `shasum`.
8. **No editor-source references inside the core pack except type-
   only imports.** `grep -rn "from \"\\.\\./apps/editor" packages/core-editor-pack/`
   returns ONLY `import type { ... }` lines — the same constraint the
   demo packs already meet (`cardboard-editor-pack-demo/scripts/setup.ts:35`
   "Type-only import — Bun's bundler erases it during pack-build").

---

## 13. Cross-references

Source-of-truth docs:

- `docs/plans/EDITOR_ENGINE.md` — §2 (shell vs pack), §8 Phase 4
  (this work), §11 (endpoint statement).
- `docs/plans/PACK_CHAIN.md` — the loader semantics.
- `docs/plans/PERFORMANCE_PROFILER.md` — the same manifest shape +
  `EditorPackContext` API surface the core pack will share.
- `docs/plans/ENGINE_PACK_SPLIT.md` — the parallel split on the game
  side; same dogfooding principle applied to runtime.

Memories:

- `.claude/memory/project_dogfooding_principle.md` — the operating
  principle this phase is the proof of.
- `.claude/memory/project_editor_package_injection.md` — the dev-mode
  injection pattern that runs against the same shell APIs.
- `.claude/memory/feedback_command_registry_required.md` — every
  interactive editor action registers via `registerCommand`. This
  contract is preserved verbatim through the pack context's
  `registerCommand` re-export.

Verified current code surfaces this plan touches:

- `apps/editor/src/packs/editorPackLoader.ts:92-180` — current
  `EditorPackContext` surface (widens here).
- `apps/editor/src/components/dock/DockShell.tsx:74-120` —
  `DockPanelDef` shape; `registerPanel` mirrors this exactly.
- `apps/editor/src/state/useEditorPacksStore.ts:89-107` — seed
  modification for adding `cardboard-core-editor`.
- `apps/editor/src/views/MapView.tsx:14-84, 125-155, 179-378` —
  static panel imports + registry + default layout JSON literal
  (all move).
- `apps/editor/src/shell/EditorShell.tsx:779-936` — `ShellBody`'s
  static view dispatch (becomes a registry lookup).
- `apps/pack-builder/src/build-packs.ts:794-846` — current library
  bundling step (the React-externalization sibling lives here).
- `apps/pack-builder/src/build-pack-script.ts` — TSX compile step
  the React-externalization change actually goes in.
- `packages/cardboard-editor-pack-demo/scripts/setup.ts:35` —
  type-only-import pattern the core pack inherits.
- `packages/demo-performance-profiler/manifest.json:1-23` — manifest
  shape the core pack mirrors.

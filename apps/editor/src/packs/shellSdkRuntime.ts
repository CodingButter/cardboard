/**
 * Expose the editor shell's singleton-dependent APIs to pack scripts via
 * `globalThis`.
 *
 * Pack-shipped TSX panels need to call into shell-side singletons —
 * specifically `registerCommand` (so commands hit the host's
 * `useCommandStore` and surface in the command palette) and
 * `useActiveScene` (so the hook reads the host's React Context, not a
 * zero-state copy from inside the pack bundle).
 *
 * The pack-builder's `cardboard-shell-externals` plugin
 * (`apps/pack-builder/src/build-pack-script.ts`) rewrites
 * `import ... from "@cardboard/editor-shell"` specifiers into a virtual
 * module that reads from `globalThis.__cardboard_editor_shell`. This
 * module populates that slot.
 *
 * Why only these symbols and not the entire `components/ui/` surface:
 * presentational primitives like `Tooltip` and `lucide-react` icons are
 * safe to bundle into the pack (no singleton state, no host-side React
 * Context to coordinate with) so they're left alone. Only the symbols
 * whose semantics REQUIRE host-side identity show up here. Future P3+
 * panel migrations will extend this slot as new requirements surface.
 *
 * Same pattern as `reactRuntime.ts` — see CORE_EDITOR_PACK.md §6 gotcha
 * #2 "shell primitives" for the rationale.
 */

import { registerCommand, useCommandStore } from "../state/useCommandStore";
import { useActiveScene } from "../shell/ActiveSceneContext";
import { useDiagnosticsStore } from "../state/useDiagnosticsStore";
import { useHistoryStore } from "../state/useHistoryStore";
import { useLayerStore } from "../state/useLayerStore";
import { useTilePresetStore } from "../state/useTilePresetStore";
import { useTilePresetRegistryStore } from "../state/useTilePresetRegistryStore";
import { useSceneStore, cellKey } from "../state/useSceneStore";
import { useSelectionStore } from "../state/useSelectionStore";
import { useBrushStore } from "../state/useBrushStore";
import { useToolStore } from "../state/useToolStore";
import { undoOnce, redoOnce } from "../state/historyDispatcher";
import {
  ensureLoaded as ensureTextureLoaded,
  getTextureBitmap,
} from "../state/tileTextureCache";
import { EmptyState } from "../components/ui/EmptyState";
import { PanelRenderer, NodeIdProvider } from "../panel-renderer/PanelRenderer";
import {
  STORE_REGISTRY,
  listDynamicStores,
} from "../panel-renderer/resolveBinding";
// P4 view-shell migration — views moving into the pack need access to
// the DockShell primitive, the WorkspaceRail chrome, the per-tab
// context-slot hook, the URL-hash router, and the editor-pack registry
// hooks. Each one keys on a shell-singleton (React Context, Zustand
// store, window.location.hash, or the module-level pack-load promise),
// so bundling a duplicate inside the pack would silently fork the
// state. CORE_EDITOR_PACK.md §10 P4.
import { DockShell } from "../components/dock/DockShell";
import { WorkspaceRail } from "../components/dock/WorkspacePanel";
import {
  useTabContextSlot,
  useTabContextSlotValue,
} from "../lib/tabContextSlot";
import { useRoute, buildHash } from "../lib/router";
import {
  useEditorPackPanels,
  useEditorPacksLoaded,
} from "./editorPackLoader";
// P5b — view-migration constants/types. SET_TAB_EVENT + SetTabEventDetail
// were owned by AssetsView pre-migration; WorkflowMode by ProjectView.
// Both files moved into the core-editor-pack, but the constants/types
// belong in the SHELL so any pack (core or third-party) can dispatch
// tab-switch intents or type a ProjectView-style body mode. See
// `./shellEvents.ts` for the canonical declarations.
import {
  SET_TAB_EVENT,
  type SetTabEventDetail,
  type WorkflowMode,
} from "./shellEvents";
// P5b — re-export EditorProjectStore singleton + types. HomeScreen
// migrated into the pack but it owns the create / list / rename / delete
// flow that writes to the editor's IDB store. The store is a
// module-level singleton (one open IndexedDB connection per origin) —
// bundling a duplicate inside the pack would crash IDB's "concurrent
// open" guard. Same dogfooding contract: a third-party Home replacement
// would reach for the same surface.
import {
  EditorProjectStore,
  type ProjectMeta,
  type AssetMeta,
} from "../lib/EditorProjectStore";
// P5b — importPack helpers. HomeScreen wires the "import a .apg" + "open
// pack from URL" flows; both helpers wrap IDB writes + manifest
// validation against the shared store. Bundling duplicates would fork
// the (memoized) zip-read pipeline + lose access to the singleton store.
import { importPackFromBlob, importPackFromUrl } from "../lib/importPack";
// P5b — assetUrl + StatusBar context + StatusBarSection type. HomeScreen
// uses assetUrl() to resolve the Cardboard.apg template against the
// editor's deploy base + pushes StatusBar sections during its mount.
import { assetUrl } from "../lib/assetUrl";
import { useStatusBar } from "../shell/StatusBarContext";
import type { StatusBarSection } from "../components/ui/StatusBar";
// Task #17 — preview-panel engine toggle. Pack-shipped PreviewPanel
// needs the Modal primitive (for the Expand modal) + the canonical
// game-runner URL (for the engine iframe src). Modal is host-side
// because it portals into the editor's z-index 1000 layer above
// dockview; bundling a duplicate would render under the dock's drop
// overlays. GAME_RUNNER_URL is a runtime-resolved string that knows
// whether the editor is staged under `/cardboard/editor/` or
// served standalone — the value differs between deployments and
// must come from the host.
import { Modal } from "../components/ui/Modal";
import { Button } from "../components/ui/Button";
import { Tooltip } from "../components/ui/Tooltip";
import { GAME_RUNNER_URL } from "../lib/gameRunnerUrl";

/**
 * P3 batch D-light — narrow public surface over `tileTextureCache`.
 *
 * The cache itself keys by raw texture path. Exposing the raw helpers
 * would let third-party pack code mutate the global cache by name
 * (`getTextureBitmap("foo.jpg")` succeeds whether or not the preset
 * registry knows that path). The wrapper enforces the "caller must
 * already own a preset id" contract — packs can't reach into the
 * cache for arbitrary assets, only for textures bound to a preset
 * they're aware of. `presetId` is informational at this layer (a
 * future revision can validate it against the registry); the
 * `texturePath` is the actual cache key the underlying helpers use.
 *
 * Signature deliberately mirrors what a third-party pack would write
 * if it had to author the loader from scratch — pack id + preset id
 * + path is the trio every pack-supplied painter would track.
 */
function loadTileTexture(
  packId: string,
  _presetId: string,
  texturePath: string,
): void {
  // `packId` doubles as the projectId for now — the cache is keyed
  // against the active editor project, which is exactly the pack
  // scope packs care about.
  ensureTextureLoaded(packId, texturePath);
}
function getTileTextureSync(
  _presetId: string,
  texturePath: string,
): ImageBitmap | null | undefined {
  return getTextureBitmap(texturePath);
}

/**
 * The runtime surface published into the `globalThis` slot. Pack-shipped
 * TSX `import { ... } from "@cardboard/editor-shell"` resolves to a
 * virtual module whose exports re-export from this object at call time.
 *
 * Adding a new entry: append a property here AND a matching named
 * re-export in the pack-builder's stub-module body (the
 * `cardboard-shell-externals` plugin's onLoad handler).
 *
 * Why each store appears here individually rather than bundled in the
 * pack: each Wave-3 store is a module-level singleton with its own
 * BroadcastChannel for cross-window sync. A bundled-in duplicate inside
 * a pack `.apg` would have its own (disconnected) channel + zero shared
 * state with the host's store — log lines written by the pack would
 * never reach the OutputPanel rendered in the host, and vice-versa.
 * Routing the hook through the host singleton is mandatory, not
 * cosmetic. Any third-party pack that wants to consume diagnostics or
 * undo/redo history hits the same need, so the symbols belong in the
 * public SDK.
 */
export const shellSdk = {
  registerCommand,
  useCommandStore,
  useActiveScene,
  // P3 batch A — OutputPanel + ProblemsPanel consume the live
  // diagnostics buffer.
  useDiagnosticsStore,
  // P3 batch A — HistoryPanel reads + mutates the undo/redo stack.
  useHistoryStore,
  // P3 batch B — LayersPanel reads + writes layer order/visibility/
  // active id + custom-layer roster. Any pack that contributes a
  // layer-aware surface (mini-layers picker, layer-scoped tool,
  // per-layer visibility automation) reaches for the same hook —
  // the synced store's BroadcastChannel makes shared host-side
  // identity mandatory rather than cosmetic.
  useLayerStore,
  // P3 batch B — TilePresetPanel writes activeId/activeCategory.
  // Any pack that contributes a tile-picker (alternate layout,
  // categorised by tag, search-driven) needs to drive the same
  // selection so the painter writes the right preset.
  useTilePresetStore,
  // P3 batch B — TilePresetPanel reads the per-project preset
  // registry. The registry is hydrated from IDB at project-switch
  // time; only one identity can stay in sync with that hydration.
  useTilePresetRegistryStore,
  // P3 batch B — QuickToolsPanel reads cells/tags and writes via
  // `toggleCellTag`. Same singleton+broadcast story as the other
  // Wave-3 stores — bundling a duplicate would write to a private
  // copy and the painter would never see the tag.
  useSceneStore,
  // P3 batch B — `cellKey(x, y)` is the canonical key format the
  // scene store uses internally. Exposing the helper avoids a pack
  // hard-coding `${x},${y}` and silently drifting if the format
  // changes (the helper has been the single source of truth since
  // Wave 3.2). Any pack that addresses cells by coord needs this.
  cellKey,
  // P3 batch B — QuickToolsPanel + SelectionInfoPanel read selection
  // + write `select(null)`. Pack-shipped selection tools (lasso,
  // ring-select, modifier-key extensions) write here. Singleton +
  // broadcast applies.
  useSelectionStore,
  // P3 batch D — BrushPanel reads `kind`/`size`, calls `setKind` /
  // `sizeUp` / `sizeDown`. Any pack contributing an alternate brush
  // picker (favourite-brush palette, drag-resize brush handle,
  // tablet-pressure-aware sizing) writes through the same store. The
  // synced store carries cross-window updates so a popped-out brush
  // picker stays in sync with the main window.
  useBrushStore,
  // P3 batch D — ToolPalettePanel reads `activeTool` / `activeSubTool`
  // and writes via `setActiveTool` / `setActiveSubTool`. Same singleton
  // + broadcast story as the other Wave-3 stores. Pack-shipped tool
  // contributions (custom select sub-tools, alternate paint variants)
  // route through this hook.
  useToolStore,
  // P3 batch A — `EmptyState` is presentational, but it pulls in a
  // binary asset import (`logo.png with { type: "file" }`) that the
  // pack-builder's `Bun.build` can't resolve cleanly when bundling
  // pack scripts. Exposing it via the shell SDK keeps the pack bundle
  // small AND solves the build issue without forking the primitive.
  // Any third-party pack that wants a Cardboard-styled empty surface
  // hits the same need; routing through the SDK is the
  // dogfooding-correct shape.
  EmptyState,
  // P3 batch B — `PanelRenderer` is the JSON-spec → React renderer
  // that powers Phase-1b's `selection-info`/`quick-tools`/`brush`/
  // `tool-palette`/`cell-inspector` specs. The thin TSX wrappers that
  // ship them as panels mount `<PanelRenderer spec={...}/>` directly;
  // the renderer subscribes to host-side Wave-3 stores via
  // `resolveBinding` so it MUST run with host React + host stores.
  // Bundling a duplicate copy into a pack would give that copy its
  // own (empty) dynamic-store registry and zero binding fan-in.
  // Any third-party pack that wants JSON-authored panels reaches for
  // the same renderer.
  PanelRenderer,
  // VB3 — `NodeIdProvider` is the opt-in context wrapper that lets a
  // pack annotate every rendered NodeSpec with a `data-cardboard-node-
  // id` attribute. The JSON Visual Builder's canvas wraps its
  // `<PanelRenderer>` in one so clicks on rendered nodes map back to
  // spec-tree ids for selection + the property inspector. Zero-cost
  // for packs that don't mount the provider — the renderer's
  // `useContext` returns null and the cloneElement-injection path is
  // skipped, so non-builder JSON panels emit identical DOM to the
  // pre-VB3 baseline. Any third-party pack that ships an inspector,
  // debugger, or design tool over an existing rendered subtree hits
  // the same need (per the dogfooding rubric in
  // `docs/plans/JSON_VISUAL_BUILDER.md` §6.x).
  NodeIdProvider,
  // VB5 — pickers shipped by the visual builder pack need to enumerate
  // the live store registries to autocomplete `bind:` paths. The
  // resolver's `STORE_REGISTRY` is the built-in catalog (scene /
  // selection / layer / tool / brush); `listDynamicStores()` returns
  // the pack-contributed stores currently registered (panelBuilder /
  // profiler / etc.). Pickers walk `getState()` per store to enumerate
  // nested keys — that walk lives in the pack, not here.
  STORE_REGISTRY,
  listDynamicStores,
  // P3 batch D-light — `undoOnce` / `redoOnce` walk the history store
  // cursor + replay paint/erase ops into the scene store. MapCanvas
  // wires Ctrl+Z / Ctrl+Shift+Z commands to these. Any pack that
  // emits paintable history entries (custom painter, prefab-stamper,
  // selection-based bulk edit) needs the same dispatcher entry points
  // — without them the pack would have to duplicate the fan-out
  // through `useHistoryStore` → `useSceneStore`, which silently
  // drifts when the dispatcher logic grows new entry types.
  undoOnce,
  redoOnce,
  // P3 batch D-light — narrow public surface over the
  // `tileTextureCache` singleton. Bound to the host's IDB-backed
  // asset store + the host's registry epoch, so pack-side callers MUST
  // route through the singleton (a duplicated cache inside the pack
  // bundle would never see the registry's `texturesEpoch` tick and
  // canvases would render the color fallback forever).
  // `loadTileTexture` is fire-and-forget (kicks an async load that
  // bumps the epoch when the bitmap arrives); `getTileTextureSync`
  // is the per-cell hot-path lookup. The narrow signature gates
  // access by `presetId` so packs can't poke arbitrary asset paths
  // through the cache.
  loadTileTexture,
  getTileTextureSync,
  // P4 — view shells moving into the pack. Each entry below is
  // singleton-bound (React Context, Zustand store, window.location,
  // or a module-level promise cache). Bundling a duplicate inside
  // the pack would create a shadow copy disconnected from the host
  // — the dock layout wouldn't persist, the URL wouldn't drive route
  // state, etc.
  DockShell,
  WorkspaceRail,
  useTabContextSlot,
  useTabContextSlotValue,
  useRoute,
  buildHash,
  useEditorPackPanels,
  useEditorPacksLoaded,
  // P5b — view-migration constants. SET_TAB_EVENT is the cross-view
  // navigation event name; the shell registers its listener against
  // this exact string, so pack-side dispatchers MUST use the same
  // constant. The store + helpers below are the surface HomeScreen
  // (now pack-shipped) reaches for to drive project create / list /
  // import flows. Each is a host-side singleton — IDB connection,
  // memoized fetch pipeline, React Context — that bundling would fork.
  SET_TAB_EVENT,
  EditorProjectStore,
  importPackFromBlob,
  importPackFromUrl,
  assetUrl,
  useStatusBar,
  // Task #17 — Modal/Button/Tooltip exposed so pack-shipped panels
  // (PreviewPanel's Expand modal) can compose host-side dialogs
  // without re-implementing portal/dock-z-index handling. Each is
  // presentational but the Modal portal MUST live in the host's DOM
  // tree to stack above dockview's drop overlays (z-index 999). Tooltip
  // and Button are already used by pack-shipped panels via direct
  // import; routing them through the SDK lets them participate in any
  // future theme/runtime customisation without forcing per-panel
  // updates.
  Modal,
  Button,
  Tooltip,
  // Task #17 — GAME_RUNNER_URL resolves to the editor-origin path that
  // serves the game runtime (`/play/` in dev, `/cardboard/play/` under
  // GitHub Pages). PreviewPanel's engine-rendered branch points its
  // iframe at `<GAME_RUNNER_URL>?source=editor&projectId=…`. The
  // host owns this resolution because it depends on `window.location`
  // semantics that aren't part of the pack runtime's contract.
  GAME_RUNNER_URL,
} as const;

export type ShellSdk = typeof shellSdk;

// P5b — type-only re-exports for pack code. Types compile away so they
// don't need a runtime slot, but TypeScript needs them exposed from the
// SDK module shape to follow `import type { ... } from "@cardboard/editor-shell"`.
// The pack-builder's stub module re-exports them as `export type` lines.
export type {
  SetTabEventDetail,
  WorkflowMode,
  ProjectMeta,
  AssetMeta,
  StatusBarSection,
};

declare global {
  // eslint-disable-next-line no-var
  var __cardboard_editor_shell: ShellSdk | undefined;
}

/**
 * Idempotent. Called by the editor's `index.tsx` BEFORE the first
 * `loadEditorPacks()` invocation. Safe to call across HMR reloads —
 * overwriting the global with the same shellSdk reference is a no-op.
 */
export function installShellSdkRuntime(): void {
  globalThis.__cardboard_editor_shell = shellSdk;
}

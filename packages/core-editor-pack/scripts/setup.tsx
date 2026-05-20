/**
 * core-editor-pack — P2 + P3 batches A/B setup script.
 *
 * P2 migrated `NotesPanel` out of the editor shell into this pack via
 * the `ctx.registerPanel(...)` API on `EditorPackContext`. P3 batch A
 * extended the pattern to four more leaf panels:
 *
 *   - `OutputPanel`     (Diagnostics — bottom strip log surface)
 *   - `ProblemsPanel`   (Diagnostics — warn/error subset)
 *   - `HistoryPanel`    (Diagnostics — undo/redo stack visualisation)
 *   - `LightingPanel`   (Scene — opt-in light list)
 *
 * P3 batch B (this commit) migrates the next four panels — the
 * store-WRITER set:
 *
 *   - `LayersPanel`        (writes `useLayerStore` — order /
 *                           visibility / active / custom-layer roster)
 *   - `TilePresetPanel`    (writes `useTilePresetStore` activeId +
 *                           activeCategory; reads the IDB-hydrated
 *                           `useTilePresetRegistryStore`)
 *   - `QuickToolsPanel`    (JSON-driven; commands write
 *                           `useSceneStore.toggleCellTag`)
 *   - `SelectionInfoPanel` (JSON-driven; commands write
 *                           `useSelectionStore.select`)
 *
 * Surface flags (`surface`, `headerless`) preserve the registration
 * semantics MapView previously used in its static `PANELS` array.
 *
 * Why a `.tsx` setup script: the panels are TSX components imported
 * here as JSX expressions. The pack-builder's TSX compile step
 * (`apps/pack-builder/src/build-pack-script.ts`) handles `.tsx`
 * entries identically to `.ts`, with React + ReactDOM externalised so
 * the pack-shipped panels share one React instance with the host.
 *
 * Returns a cleanup that fires every per-contribution unregister so
 * a future Extensions-tab live-disable can drop the pack's panels
 * out of the DocksModal without a reload. See
 * `docs/plans/CORE_EDITOR_PACK.md` §10 P2 / P3 batches A & B.
 */

// Type-only — Bun erases this. Runtime `ctx` is constructed by the
// editor's pack loader (`apps/editor/src/packs/editorPackLoader.ts`).
import type { EditorPackContext } from "../../../apps/editor/src/packs/editorPackLoader";

// P4 view-shell + tab-strip + default-layout contributions. The
// view components depend on `@cardboard/editor-shell` for the DockShell
// primitive + the URL-hash router; the pack-builder rewrites those
// imports into the host-populated `globalThis.__cardboard_editor_shell`
// slot at bundle time (see `apps/editor/src/packs/shellSdkRuntime.ts`).
import React from "react";
import {
  Home,
  Grid3x3,
  Boxes,
  Blocks,
  Image as ImageIcon,
  Code2,
  Film,
  Palette,
  AudioLines,
  LayoutPanelTop,
  Package,
} from "lucide-react";
import { MapView } from "../views/MapView";
import { PrefabsView } from "../views/PrefabsView";
import { SCENE_DEFAULT_LAYOUT } from "../layouts/scene-default";
import { PREFABS_DEFAULT_LAYOUT } from "../layouts/prefabs-default";

import { NotesPanel, MANIFEST as NOTES_MANIFEST } from "../panels/NotesPanel";
import { OutputPanel, MANIFEST as OUTPUT_MANIFEST } from "../panels/OutputPanel";
import { ProblemsPanel, MANIFEST as PROBLEMS_MANIFEST } from "../panels/ProblemsPanel";
import { HistoryPanel, MANIFEST as HISTORY_MANIFEST } from "../panels/HistoryPanel";
import { LightingPanel, MANIFEST as LIGHTING_MANIFEST } from "../panels/LightingPanel";
// P3 batch B — store-writer panels.
import { LayersPanel, MANIFEST as LAYERS_MANIFEST } from "../panels/LayersPanel";
import { TilePresetPanel, MANIFEST as TILE_PRESET_MANIFEST } from "../panels/TilePresetPanel";
import { QuickToolsPanel, MANIFEST as QUICK_TOOLS_MANIFEST } from "../panels/QuickToolsPanel";
import { SelectionInfoPanel, MANIFEST as SELECTION_INFO_MANIFEST } from "../panels/SelectionInfoPanel";
// P3 batch D — the remaining small Scene panels.
import { SceneSettingsPanel, MANIFEST as SCENE_SETTINGS_MANIFEST } from "../panels/SceneSettingsPanel";
import { AssetReferencesPanel, MANIFEST as ASSET_REFERENCES_MANIFEST } from "../panels/AssetReferencesPanel";
import { BrushPanel, MANIFEST as BRUSH_MANIFEST } from "../panels/BrushPanel";
import { ToolPalettePanel, MANIFEST as TOOL_PALETTE_MANIFEST } from "../panels/ToolPalettePanel";
// P3 batch D-light — the Scene workspace's centerpiece painter.
import { MapCanvasPanel, MANIFEST as MAP_CANVAS_MANIFEST } from "../panels/MapCanvasPanel";
// P3 batch D-final — the last four Scene panels migrate together.
// MinimapPanel (cells overview), CellInspectorPanel (hybrid TSX+JSON),
// PrefabBrowserPanel (placeable-prefab grid), PreviewPanel (THREE.js
// 3D preview with WebGL graceful-degradation).
import { MinimapPanel, MANIFEST as MINIMAP_MANIFEST } from "../panels/MinimapPanel";
import { CellInspectorPanel, MANIFEST as CELL_INSPECTOR_MANIFEST } from "../panels/CellInspectorPanel";
import { PrefabBrowserPanel, MANIFEST as PREFAB_BROWSER_MANIFEST } from "../panels/PrefabBrowserPanel";
import { PreviewPanel, MANIFEST as PREVIEW_MANIFEST } from "../panels/PreviewPanel";
// P3 prefabs batch — the six Prefabs-view panels migrate together as
// the final view-panel sweep before P4 absorbs the view shells
// themselves. ComponentEditor + EntityHeader + EntityList feed off
// the mock entity fixtures; EntityDropZone is the file-import target;
// EntityPreview is a THREE.js mini-stage that derives its scene from
// the active entity's components; JsonPreview is the live serialised-
// definition readout with Save & Test / Copy JSON affordances.
import {
  ComponentEditorPanel,
  MANIFEST as COMPONENT_EDITOR_MANIFEST,
} from "../panels/prefabs/ComponentEditorPanel";
import {
  EntityDropZonePanel,
  MANIFEST as ENTITY_DROP_ZONE_MANIFEST,
} from "../panels/prefabs/EntityDropZonePanel";
import {
  EntityHeaderPanel,
  MANIFEST as ENTITY_HEADER_MANIFEST,
} from "../panels/prefabs/EntityHeaderPanel";
import {
  EntityListPanel,
  MANIFEST as ENTITY_LIST_MANIFEST,
} from "../panels/prefabs/EntityListPanel";
import {
  EntityPreviewPanel,
  MANIFEST as ENTITY_PREVIEW_MANIFEST,
} from "../panels/prefabs/EntityPreviewPanel";
import {
  JsonPreviewPanel,
  MANIFEST as JSON_PREVIEW_MANIFEST,
} from "../panels/prefabs/JsonPreviewPanel";

export default function setup(ctx: EditorPackContext): () => void {
  // Compose each panel def the same way MapView's old static `PANELS`
  // array did — spread the MANIFEST (id/title/category/icon) and
  // attach the component plus any surface/headerless flags. The
  // shell-side `DockPanelDef` shape accepts both halves verbatim;
  // nothing about a pack-shipped TSX panel differs from a hand-written
  // one from the dock's POV.
  const disposers: Array<() => void> = [
    // P2 — NotesPanel.
    ctx.registerPanel({
      ...NOTES_MANIFEST,
      component: NotesPanel,
    }),
    // P3 batch A — Output + Problems were registered in MapView with
    // `surface: false` so the log/diagnostic body sits flush against
    // the dock area. Preserve that flag here.
    ctx.registerPanel({
      ...OUTPUT_MANIFEST,
      component: OutputPanel,
      surface: false,
    }),
    ctx.registerPanel({
      ...PROBLEMS_MANIFEST,
      component: ProblemsPanel,
      surface: false,
    }),
    // P3 batch A — History was a default-surface panel in MapView.
    ctx.registerPanel({
      ...HISTORY_MANIFEST,
      component: HistoryPanel,
    }),
    // P3 batch A — Lighting was a default-surface panel in MapView.
    ctx.registerPanel({
      ...LIGHTING_MANIFEST,
      component: LightingPanel,
    }),
    // P3 batch B — LayersPanel was a default-surface panel in MapView.
    ctx.registerPanel({
      ...LAYERS_MANIFEST,
      component: LayersPanel,
    }),
    // P3 batch B — TilePresetPanel was a default-surface panel.
    ctx.registerPanel({
      ...TILE_PRESET_MANIFEST,
      component: TilePresetPanel,
    }),
    // P3 batch B — QuickToolsPanel was registered with default
    // surface flags in MapView; the JSON spec controls its own
    // chrome.
    ctx.registerPanel({
      ...QUICK_TOOLS_MANIFEST,
      component: QuickToolsPanel,
    }),
    // P3 batch B — SelectionInfoPanel was the only `surface: false,
    // headerless: true` panel besides MapCanvas. The status-bar
    // tile look depends on those flags, so they're preserved here.
    ctx.registerPanel({
      ...SELECTION_INFO_MANIFEST,
      component: SelectionInfoPanel,
      surface: false,
      headerless: true,
    }),
    // P3 batch D — default-surface panels in MapView.
    ctx.registerPanel({
      ...SCENE_SETTINGS_MANIFEST,
      component: SceneSettingsPanel,
    }),
    ctx.registerPanel({
      ...ASSET_REFERENCES_MANIFEST,
      component: AssetReferencesPanel,
    }),
    ctx.registerPanel({
      ...BRUSH_MANIFEST,
      component: BrushPanel,
    }),
    ctx.registerPanel({
      ...TOOL_PALETTE_MANIFEST,
      component: ToolPalettePanel,
    }),
    // P3 batch D-light — MapCanvasPanel registered with `surface: false`
    // + `headerless: true` (matches the flags MapView previously
    // used). The painter fills the dock area flush — no card chrome
    // around the canvas, no panel header bar stealing pixels.
    ctx.registerPanel({
      ...MAP_CANVAS_MANIFEST,
      component: MapCanvasPanel,
      surface: false,
      headerless: true,
    }),
    // P3 batch D-final — the remaining four Scene panels. All four
    // were registered with default surface flags in MapView (no
    // `surface: false`, no `headerless: true`), so the default
    // PanelSurface card chrome applies to each.
    ctx.registerPanel({
      ...MINIMAP_MANIFEST,
      component: MinimapPanel,
    }),
    ctx.registerPanel({
      ...CELL_INSPECTOR_MANIFEST,
      component: CellInspectorPanel,
    }),
    ctx.registerPanel({
      ...PREFAB_BROWSER_MANIFEST,
      component: PrefabBrowserPanel,
    }),
    ctx.registerPanel({
      ...PREVIEW_MANIFEST,
      component: PreviewPanel,
    }),
    // P3 prefabs batch — Prefabs-view panels. EntityHeader was the
    // only one PrefabsView previously registered with an explicit
    // `surface: true` flag (the form strip card chrome differentiates
    // it from the larger ComponentEditor body below); JsonPreview was
    // explicitly `surface: false` (the monospace block fills the dock
    // group flush, no card chrome). Preserve both flags verbatim. The
    // remaining four use default surface flags.
    ctx.registerPanel({
      ...ENTITY_PREVIEW_MANIFEST,
      component: EntityPreviewPanel,
    }),
    ctx.registerPanel({
      ...ENTITY_LIST_MANIFEST,
      component: EntityListPanel,
    }),
    ctx.registerPanel({
      ...ENTITY_DROP_ZONE_MANIFEST,
      component: EntityDropZonePanel,
    }),
    ctx.registerPanel({
      ...ENTITY_HEADER_MANIFEST,
      component: EntityHeaderPanel,
      surface: true,
    }),
    ctx.registerPanel({
      ...COMPONENT_EDITOR_MANIFEST,
      component: ComponentEditorPanel,
    }),
    ctx.registerPanel({
      ...JSON_PREVIEW_MANIFEST,
      component: JsonPreviewPanel,
      surface: false,
    }),
    // P4 — view-shell migration. MapView + PrefabsView are now
    // pack-contributed; the editor shell reads the view registry to
    // route the active primary tab.
    ctx.registerView("scene", MapView),
    ctx.registerView("prefabs", PrefabsView),
    // P4 — default-layout contributions. Each view shell reads
    // `useDefaultLayout(viewId)` to find these.
    ctx.registerLayout("scene", SCENE_DEFAULT_LAYOUT),
    ctx.registerLayout("prefabs", PREFABS_DEFAULT_LAYOUT),
    // P4 — primary-tab contributions. Tabs render in registration
    // order, so this ordering mirrors the legacy hardcoded
    // PRIMARY_TABS array exactly. The shell-side `PrimaryTabs` strip
    // reads `useRegisteredTabs()` — a fully disabled core pack leaves
    // the strip empty + the editor renders the bare shell per the
    // CORE_EDITOR_PACK.md §1 endpoint.
    //
    // Views for `scene` + `prefabs` are pack-contributed (registerView
    // above). The remaining tabs still resolve to shell-rendered
    // views (HomeScreen, ComponentsView, AssetsView, …) — those view
    // migrations land in subsequent commits. The TAB STRIP itself is
    // P4-complete: every tab descriptor is pack-owned.
    ctx.registerTab({
      id: "home",
      label: "Home",
      icon: <Home size={16} />,
      requiresProject: false,
      description: "Recent projects, import / create new.",
    }),
    ctx.registerTab({
      id: "scene",
      label: "Scene",
      icon: <Grid3x3 size={16} />,
      requiresProject: true,
      description:
        "Top-down 2D editor for cell layout, tiles, lighting.",
    }),
    ctx.registerTab({
      id: "prefabs",
      label: "Prefabs",
      icon: <Boxes size={16} />,
      requiresProject: true,
      description:
        "Entity prefab library — enemies, items, triggers, decor.",
    }),
    ctx.registerTab({
      id: "components",
      label: "Components",
      icon: <Blocks size={16} />,
      requiresProject: true,
      description: "Reusable scene-graph components.",
      // Visual divider matches the pre-P4 PrimaryTabs grouping:
      // [home, scene, prefabs, components] | [assets, …] | [project]
      dividerAfter: true,
    }),
    ctx.registerTab({
      id: "assets",
      label: "Assets",
      icon: <ImageIcon size={16} />,
      requiresProject: true,
      description:
        "Project asset browser — textures, sounds, music, scripts.",
    }),
    ctx.registerTab({
      id: "scripts",
      label: "Scripts",
      icon: <Code2 size={16} />,
      requiresProject: true,
      description: "Game scripting editor — TypeScript / Lua / JS.",
    }),
    ctx.registerTab({
      id: "animation",
      label: "Animation",
      icon: <Film size={16} />,
      requiresProject: true,
      description: "Sprite + entity animation timeline.",
    }),
    ctx.registerTab({
      id: "imageLab",
      label: "Image Lab",
      icon: <Palette size={16} />,
      requiresProject: true,
      description: "Built-in pixel painter / image utility.",
    }),
    ctx.registerTab({
      id: "soundLab",
      label: "Sound Lab",
      icon: <AudioLines size={16} />,
      requiresProject: true,
      description: "Built-in audio editor / chiptune utility.",
    }),
    ctx.registerTab({
      id: "uiBuilder",
      label: "UI Builder",
      icon: <LayoutPanelTop size={16} />,
      requiresProject: true,
      description: "Game HUD + menu layout editor.",
      dividerAfter: true,
    }),
    ctx.registerTab({
      id: "project",
      label: "Project",
      icon: <Package size={16} />,
      requiresProject: true,
      description:
        "Project-level settings — manifest, pack chain, build targets.",
    }),
  ];

  return () => {
    for (const dispose of disposers) dispose();
  };
}

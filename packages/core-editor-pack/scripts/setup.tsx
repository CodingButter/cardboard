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
  ];

  return () => {
    for (const dispose of disposers) dispose();
  };
}

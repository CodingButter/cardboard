import React from "react";
import { Construction } from "lucide-react";
import type { DockviewApi, SerializedDockview } from "dockview";
import { EmptyState } from "../components/ui/EmptyState";
import { useTabContextSlot } from "../lib/tabContextSlot";
import { SceneTabContextPicker } from "./scene/SceneTabContextPicker";
import { useRoute } from "../lib/router";
import {
  DockShell,
  type DockPanelDef,
} from "../components/dock/DockShell";
import { WorkspaceRail } from "../components/dock/WorkspacePanel";
import {
  ToolPalettePanel,
  MANIFEST as TOOL_PALETTE_MANIFEST,
} from "./scene/panels/ToolPalettePanel";
import {
  BrushPanel,
  MANIFEST as BRUSH_MANIFEST,
} from "./scene/panels/BrushPanel";
import {
  TilePresetPanel,
  MANIFEST as TILE_PRESET_MANIFEST,
} from "./scene/panels/TilePresetPanel";
import {
  MapCanvasPanel,
  MANIFEST as MAP_CANVAS_MANIFEST,
} from "./scene/panels/MapCanvasPanel";
import {
  PreviewPanel,
  MANIFEST as PREVIEW_MANIFEST,
} from "./scene/panels/PreviewPanel";
import {
  LayersPanel,
  MANIFEST as LAYERS_MANIFEST,
} from "./scene/panels/LayersPanel";
import {
  CellInspectorPanel,
  MANIFEST as CELL_INSPECTOR_MANIFEST,
} from "./scene/panels/CellInspectorPanel";
import {
  QuickTagsPanel,
  MANIFEST as QUICK_TAGS_MANIFEST,
} from "./scene/panels/QuickTagsPanel";
import {
  OutputPanel,
  MANIFEST as OUTPUT_MANIFEST,
} from "./scene/panels/OutputPanel";
import {
  ProblemsPanel,
  MANIFEST as PROBLEMS_MANIFEST,
} from "./scene/panels/ProblemsPanel";
import {
  SelectionInfoPanel,
  MANIFEST as SELECTION_INFO_MANIFEST,
} from "./scene/panels/SelectionInfoPanel";
import {
  SceneSettingsPanel,
  MANIFEST as SCENE_SETTINGS_MANIFEST,
} from "./scene/panels/SceneSettingsPanel";
import {
  MinimapPanel,
  MANIFEST as MINIMAP_MANIFEST,
} from "./scene/panels/MinimapPanel";
import {
  HistoryPanel,
  MANIFEST as HISTORY_MANIFEST,
} from "./scene/panels/HistoryPanel";
import {
  PrefabBrowserPanel,
  MANIFEST as PREFAB_BROWSER_MANIFEST,
} from "./scene/panels/PrefabBrowserPanel";
import {
  LightingPanel,
  MANIFEST as LIGHTING_MANIFEST,
} from "./scene/panels/LightingPanel";
import {
  NotesPanel,
  MANIFEST as NOTES_MANIFEST,
} from "./scene/panels/NotesPanel";
import {
  AssetReferencesPanel,
  MANIFEST as ASSET_REFERENCES_MANIFEST,
} from "./scene/panels/AssetReferencesPanel";

/**
 * MapView — Scene page shell.
 *
 * The Scene page opts into the dockview-driven internal layout
 * primitives (see apps/editor/src/components/dock/DockShell.tsx). The
 * shell hosts every Scene panel per `Editor Design/Map.png` and the
 * "Architecture decisions (2026-05-18)" subsection of
 * `docs/EDITOR_DESIGN_INVENTORY.md` §1.2. Users can drag, retile, or
 * pop out any panel; layout JSON persists per-project under
 * `cardboard_workspace.dockLayouts[scene::<projectId>]`.
 *
 * Each panel body is a Wave-1 empty stub today. Wave 2 fills the
 * bodies with real interactive content. The legacy combined
 * `ToolsPanel` was removed — its concerns now split across
 * `ToolPalettePanel` + `BrushPanel` + `TilePresetPanel` + the
 * existing `LayersPanel`.
 *
 * Tab-row contextual slot:
 *   MapView registers the Scene picker (`<SceneTabContextPicker/>`)
 *   into the tab strip's per-tab right slot on mount. The hook's
 *   cleanup clears the slot when the view unmounts.
 */
export interface MapViewProps {
  /** Widened — kept for compatibility with the EditorShell call site,
   *  but no required props for now. */
  [key: string]: unknown;
}

/** Stable panel registry — declared at module scope so each MapView
 *  mount reuses the same component identities. dockview keys panels
 *  by their `contentComponent` string at layout-time, so flipping the
 *  identity of the component would force a full remount.
 *
 *  Each panel's MANIFEST (id + title + icon) is co-located with its
 *  component file so adding a new panel is a one-import operation
 *  here. */
const PANELS: readonly DockPanelDef[] = [
  { ...TOOL_PALETTE_MANIFEST, component: ToolPalettePanel },
  { ...BRUSH_MANIFEST, component: BrushPanel },
  { ...TILE_PRESET_MANIFEST, component: TilePresetPanel },
  { ...MAP_CANVAS_MANIFEST, component: MapCanvasPanel },
  { ...PREVIEW_MANIFEST, component: PreviewPanel },
  { ...LAYERS_MANIFEST, component: LayersPanel },
  { ...CELL_INSPECTOR_MANIFEST, component: CellInspectorPanel },
  { ...QUICK_TAGS_MANIFEST, component: QuickTagsPanel },
  { ...OUTPUT_MANIFEST, component: OutputPanel },
  { ...PROBLEMS_MANIFEST, component: ProblemsPanel },
  { ...SELECTION_INFO_MANIFEST, component: SelectionInfoPanel },
  { ...SCENE_SETTINGS_MANIFEST, component: SceneSettingsPanel },
  // Opt-in Wave-2 panels — discoverable via the DocksModal but
  // intentionally absent from the default layout below.
  { ...MINIMAP_MANIFEST, component: MinimapPanel },
  { ...HISTORY_MANIFEST, component: HistoryPanel },
  { ...PREFAB_BROWSER_MANIFEST, component: PrefabBrowserPanel },
  { ...LIGHTING_MANIFEST, component: LightingPanel },
  { ...NOTES_MANIFEST, component: NotesPanel },
  { ...ASSET_REFERENCES_MANIFEST, component: AssetReferencesPanel },
];

/** Initial layout JSON — laid out to evoke `Editor Design/Map.png`:
 *
 *    [ Left col | Centre col | Right col ]
 *
 *  Left column (top→bottom):   Tool Palette / Brush / Tile Presets / Layers.
 *  Centre column (top→bottom): Map Canvas /
 *                              [Output+Problems (tabbed) + Selection Info side-by-side].
 *  Right column (top→bottom):  3D Preview / Cell Inspector / Quick Tags /
 *                              Scene Settings.
 *
 *  Sizes are relative weights normalised by dockview; the actual
 *  pixel widths flex with the viewport. The user can drag any
 *  splitter to rebalance, and every panel id below is also present
 *  in the `panels` dict so dockview can reconstruct the layout.
 *
 *  Persisted via the workspace store under
 *  `cardboard_workspace.dockLayouts[scene::<projectId>]`. */
function buildDefaultLayout(): SerializedDockview {
  return {
    grid: {
      root: {
        type: "branch",
        data: [
          // Left column — Tool Palette / Brush / Tile Presets / Layers
          {
            type: "branch",
            data: [
              {
                type: "leaf",
                data: {
                  views: ["tool-palette"],
                  activeView: "tool-palette",
                  id: "tool-palette-group",
                },
                size: 200,
              },
              {
                type: "leaf",
                data: {
                  views: ["brush"],
                  activeView: "brush",
                  id: "brush-group",
                },
                size: 180,
              },
              {
                type: "leaf",
                data: {
                  views: ["tile-preset"],
                  activeView: "tile-preset",
                  id: "tile-preset-group",
                },
                size: 240,
              },
              {
                type: "leaf",
                data: {
                  views: ["layers"],
                  activeView: "layers",
                  id: "layers-group",
                },
                size: 180,
              },
            ],
            size: 240,
          },
          // Centre column — Canvas / [Output+Problems (tabbed) + Selection]
          {
            type: "branch",
            data: [
              {
                type: "leaf",
                data: {
                  views: ["map-canvas"],
                  activeView: "map-canvas",
                  id: "map-canvas-group",
                },
                size: 600,
              },
              {
                type: "branch",
                data: [
                  {
                    type: "leaf",
                    data: {
                      views: ["output", "problems"],
                      activeView: "output",
                      id: "output-group",
                    },
                    size: 400,
                  },
                  {
                    type: "leaf",
                    data: {
                      views: ["selection-info"],
                      activeView: "selection-info",
                      id: "selection-info-group",
                    },
                    size: 240,
                  },
                ],
                size: 160,
              },
            ],
            size: 780,
          },
          // Right column — 3D Preview / Cell Inspector / Quick Tags / Scene Settings
          {
            type: "branch",
            data: [
              {
                type: "leaf",
                data: {
                  views: ["preview"],
                  activeView: "preview",
                  id: "preview-group",
                },
                size: 220,
              },
              {
                type: "leaf",
                data: {
                  views: ["cell-inspector"],
                  activeView: "cell-inspector",
                  id: "cell-inspector-group",
                },
                size: 300,
              },
              {
                type: "leaf",
                data: {
                  views: ["quick-tags"],
                  activeView: "quick-tags",
                  id: "quick-tags-group",
                },
                size: 120,
              },
              {
                type: "leaf",
                data: {
                  views: ["scene-settings"],
                  activeView: "scene-settings",
                  id: "scene-settings-group",
                },
                size: 160,
              },
            ],
            size: 340,
          },
        ],
        size: 1360,
      },
      height: 800,
      width: 1360,
      orientation: "HORIZONTAL",
    },
    panels: {
      "tool-palette": {
        id: "tool-palette",
        contentComponent: "tool-palette",
        title: "Tools",
      },
      brush: { id: "brush", contentComponent: "brush", title: "Brush" },
      "tile-preset": {
        id: "tile-preset",
        contentComponent: "tile-preset",
        title: "Tile Presets",
      },
      "map-canvas": {
        id: "map-canvas",
        contentComponent: "map-canvas",
        title: "Map",
      },
      preview: {
        id: "preview",
        contentComponent: "preview",
        title: "3D Preview",
      },
      layers: { id: "layers", contentComponent: "layers", title: "Layers" },
      "cell-inspector": {
        id: "cell-inspector",
        contentComponent: "cell-inspector",
        title: "Cell Inspector",
      },
      "quick-tags": {
        id: "quick-tags",
        contentComponent: "quick-tags",
        title: "Quick Tags",
      },
      output: {
        id: "output",
        contentComponent: "output",
        title: "Output",
      },
      problems: {
        id: "problems",
        contentComponent: "problems",
        title: "Problems",
      },
      "selection-info": {
        id: "selection-info",
        contentComponent: "selection-info",
        title: "Selection Info",
      },
      "scene-settings": {
        id: "scene-settings",
        contentComponent: "scene-settings",
        title: "Scene Settings",
      },
    },
  } as unknown as SerializedDockview;
}

export function MapView(_props: MapViewProps = {}): React.JSX.Element {
  const [route] = useRoute();
  const projectId = route.projectId ?? "no-project";

  // Stable reference — passing a new JSX element each render would
  // thrash the slot effect's deps. The picker reads everything it
  // needs from `<ActiveSceneProvider/>`.
  const picker = React.useMemo(() => <SceneTabContextPicker />, []);
  useTabContextSlot(picker);

  // Guard rail: if for some reason there's no project (e.g. someone
  // navigates here without one), render a polite empty state rather
  // than mount a dock shell with no persistence key.
  if (!route.projectId) {
    return (
      <div className="h-full w-full p-6 flex items-center justify-center">
        <EmptyState
          icon={<Construction size={28} />}
          title="No project open"
          description="Open a project from the Home tab to use the Scene page."
        />
      </div>
    );
  }

  const storageKey = `scene::${projectId}`;
  const defaultLayout = React.useMemo(() => buildDefaultLayout(), []);

  // Shared dockview api ref — Workspace rail's Layouts + Docks modals
  // call api.fromJSON / api.toJSON / api.addPanel against the same
  // instance DockShell creates.
  const apiRef = React.useRef<DockviewApi | null>(null);

  return (
    <div className="h-full w-full min-h-0 flex">
      <WorkspaceRail
        pageId="scene"
        storageKey={storageKey}
        apiRef={apiRef}
        registry={PANELS}
      />
      <div className="flex-1 min-w-0 h-full">
        <DockShell
          storageKey={storageKey}
          panels={PANELS}
          defaultLayout={defaultLayout}
          apiRef={apiRef}
        />
      </div>
    </div>
  );
}

export default MapView;

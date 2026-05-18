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
  ToolsPanel,
  MANIFEST as TOOLS_MANIFEST,
} from "./scene/panels/ToolsPanel";
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

/**
 * MapView — Scene page shell.
 *
 * The Scene page opts into the dockview-driven internal layout
 * primitives (see apps/editor/src/components/dock/DockShell.tsx). The
 * shell hosts five Scene panels per `Editor Design/Map.png`: Tools,
 * Map Canvas, 3D Preview, Layers, and Cell Inspector. Users can
 * drag, retile, or pop out any panel; layout JSON persists per-
 * project under `cardboard_workspace.dockLayouts[scene::<projectId>]`.
 *
 * Each panel's bodies are stubs today (Wave 1). Wave 2 fills them
 * with the real interactive content driven from `Editor Design/Map.png`.
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
  { ...TOOLS_MANIFEST, component: ToolsPanel },
  { ...MAP_CANVAS_MANIFEST, component: MapCanvasPanel },
  { ...PREVIEW_MANIFEST, component: PreviewPanel },
  { ...LAYERS_MANIFEST, component: LayersPanel },
  { ...CELL_INSPECTOR_MANIFEST, component: CellInspectorPanel },
];

/** Initial layout JSON — laid out per `Editor Design/Map.png`:
 *
 *    [ Tools | [Map Canvas / Preview-Layers-Inspector stack] ]
 *
 *  Left column: Tools.
 *  Centre: Map Canvas.
 *  Right column (top→bottom): 3D Preview, Layers, Cell Inspector.
 *
 *  Sizes are relative weights normalised by dockview; the actual
 *  pixel widths flex with the viewport. The user can drag any
 *  splitter to rebalance.
 *
 *  Persisted via the workspace store under
 *  `cardboard_workspace.dockLayouts[scene::<projectId>]`. */
function buildDefaultLayout(): SerializedDockview {
  return {
    grid: {
      root: {
        type: "branch",
        data: [
          // Left: Tools
          {
            type: "leaf",
            data: {
              views: ["tools"],
              activeView: "tools",
              id: "tools-group",
            },
            size: 220,
          },
          // Centre: Map Canvas
          {
            type: "leaf",
            data: {
              views: ["map-canvas"],
              activeView: "map-canvas",
              id: "map-canvas-group",
            },
            size: 800,
          },
          // Right column: 3D Preview / Layers / Cell Inspector stacked
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
                size: 240,
              },
              {
                type: "leaf",
                data: {
                  views: ["layers"],
                  activeView: "layers",
                  id: "layers-group",
                },
                size: 200,
              },
              {
                type: "leaf",
                data: {
                  views: ["cell-inspector"],
                  activeView: "cell-inspector",
                  id: "cell-inspector-group",
                },
                size: 360,
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
      tools: { id: "tools", contentComponent: "tools", title: "Tools" },
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

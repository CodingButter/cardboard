import React from "react";
import { Construction } from "lucide-react";
import type { DockviewApi, SerializedDockview } from "dockview";
import { EmptyState } from "../components/ui/EmptyState";
import { useTabContextSlot } from "../lib/tabContextSlot";
import { SceneTopBarSlot } from "./scene/SceneTopBarSlot";
import { useRoute } from "../lib/router";
import {
  DockShell,
  type DockPanelDef,
} from "../components/dock/DockShell";
import { WorkspaceRail } from "../components/dock/WorkspacePanel";
// ToolPalettePanel migrated to the core-editor-pack (P3 batch D).
// BrushPanel migrated to the core-editor-pack (P3 batch D).
// TilePresetPanel migrated to the core-editor-pack (P3 batch B).
import {
  MapCanvasPanel,
  MANIFEST as MAP_CANVAS_MANIFEST,
} from "./scene/panels/MapCanvasPanel";
import {
  PreviewPanel,
  MANIFEST as PREVIEW_MANIFEST,
} from "./scene/panels/PreviewPanel";
// LayersPanel migrated to the core-editor-pack (P3 batch B).
import {
  CellInspectorPanel,
  MANIFEST as CELL_INSPECTOR_MANIFEST,
} from "./scene/panels/CellInspectorPanel";
// QuickToolsPanel migrated to the core-editor-pack (P3 batch B).
// OutputPanel + ProblemsPanel migrated to the core-editor-pack
// (CORE_EDITOR_PACK.md §10 P3 batch A). Registered via the pack's
// `scripts/setup.tsx` with `surface: false`.
// SelectionInfoPanel migrated to the core-editor-pack (P3 batch B).
// SceneSettingsPanel migrated to the core-editor-pack (P3 batch D).
import {
  MinimapPanel,
  MANIFEST as MINIMAP_MANIFEST,
} from "./scene/panels/MinimapPanel";
// HistoryPanel migrated to the core-editor-pack (P3 batch A).
import {
  PrefabBrowserPanel,
  MANIFEST as PREFAB_BROWSER_MANIFEST,
} from "./scene/panels/PrefabBrowserPanel";
// LightingPanel migrated to the core-editor-pack (P3 batch A).
// NotesPanel migrated to `packages/core-editor-pack/panels/NotesPanel.tsx`
// (CORE_EDITOR_PACK.md §10 P2). The pack's `scripts/setup.tsx` calls
// `ctx.registerPanel({...NOTES_MANIFEST, component: NotesPanel})` at
// load time; the def merges into the live registry via
// `useEditorPackPanels()` below.
// AssetReferencesPanel migrated to the core-editor-pack (P3 batch D).
import {
  useEditorPackPanels,
  useEditorPacksLoaded,
} from "../packs/editorPackLoader";

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
 *   MapView registers the SceneTopBarSlot (saved-state pip + scene
 *   dimensions + painted-cell count) into the tab strip's per-tab
 *   right slot on mount. The Scene picker itself has been relocated
 *   under the MapCanvas panel (see `MapCanvasPanel`). The hook's
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
  // `surface` defaults to true — every panel gets a raised
  // PanelSurface card unless it explicitly opts out. MapCanvas opts
  // out so the painter fills the dock content area flush (no card
  // chrome around the canvas).
  // ToolPalettePanel — contributed via the core-editor-pack (P3 batch D).
  // BrushPanel — contributed via the core-editor-pack (P3 batch D).
  // TilePresetPanel — contributed via the core-editor-pack (P3 batch B).
  { ...MAP_CANVAS_MANIFEST, component: MapCanvasPanel, surface: false, headerless: true },
  { ...PREVIEW_MANIFEST, component: PreviewPanel },
  // LayersPanel — contributed via the core-editor-pack (P3 batch B).
  { ...CELL_INSPECTOR_MANIFEST, component: CellInspectorPanel },
  // QuickToolsPanel — contributed via the core-editor-pack (P3 batch B).
  // OutputPanel + ProblemsPanel — contributed via the core-editor-pack
  // at runtime (P3 batch A; registered with `surface: false`).
  // SelectionInfoPanel — contributed via the core-editor-pack (P3 batch
  // B; registered with `surface: false, headerless: true`).
  // SceneSettingsPanel — contributed via the core-editor-pack (P3 batch D).
  // Opt-in Wave-2 panels — discoverable via the DocksModal but
  // intentionally absent from the default layout below.
  { ...MINIMAP_MANIFEST, component: MinimapPanel },
  // HistoryPanel — contributed via the core-editor-pack (P3 batch A).
  { ...PREFAB_BROWSER_MANIFEST, component: PrefabBrowserPanel },
  // LightingPanel — contributed via the core-editor-pack (P3 batch A).
  // NotesPanel — contributed via the core-editor-pack at runtime.
  // AssetReferencesPanel — contributed via the core-editor-pack (P3 batch D).
  // Editor packs (loaded asynchronously via `useEditorPackPanels`)
  // are MERGED into this list at runtime — see the MapView component
  // body below. The dogfooding proof point: the JSON-authored
  // "Editor Pack: Selection Info" panel is contributed by an
  // editor-scoped pack, not by a hardcoded entry here.
];

/** Initial layout JSON — captured from the maintainer's working
 *  layout (exported from `cardboard_workspace.dockLayouts[scene::*]`).
 *
 *  Structure (root orientation VERTICAL — top half + bottom strip):
 *
 *    Top half (size 623, HORIZONTAL — 4 columns):
 *      ├─ Col 1 (size 279, VERTICAL): Tool Palette / Brush / Tile Presets
 *      ├─ Col 2 (size 1063):          Map Canvas
 *      ├─ Col 3 (size 283, VERTICAL): 3D Preview / Layers
 *      └─ Col 4 (size 255, VERTICAL): Cell Inspector / Scene Settings / Quick Tools
 *
 *    Bottom strip (size 144, HORIZONTAL — 2 leaves):
 *      ├─ Output+Problems (tabbed, size 1334)
 *      └─ Selection Info (size 546)
 *
 *  Sizes are relative weights; the actual pixel widths flex with the
 *  viewport. The user can drag any splitter to rebalance, and every
 *  panel id below is also present in the `panels` dict so dockview can
 *  reconstruct the layout.
 *
 *  Persisted via the workspace store under
 *  `cardboard_workspace.dockLayouts[scene::<projectId>]`. */
function buildDefaultLayout(): SerializedDockview {
  return {
    grid: {
      root: {
        type: "branch",
        data: [
          // Top half — 4 columns
          {
            type: "branch",
            data: [
              // Col 1: Tool Palette / Brush / Tile Presets
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
                    size: 220,
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
                    size: 223,
                  },
                ],
                size: 279,
              },
              // Col 2: Map Canvas
              {
                type: "leaf",
                data: {
                  views: ["map-canvas"],
                  activeView: "map-canvas",
                  id: "map-canvas-group",
                },
                size: 1063,
              },
              // Col 3: 3D Preview / Layers
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
                    size: 388,
                  },
                  {
                    type: "leaf",
                    data: {
                      views: ["layers"],
                      activeView: "layers",
                      id: "layers-group",
                    },
                    size: 235,
                  },
                ],
                size: 283,
              },
              // Col 4: Cell Inspector / Scene Settings / Quick Tools
              {
                type: "branch",
                data: [
                  {
                    type: "leaf",
                    data: {
                      views: ["cell-inspector"],
                      activeView: "cell-inspector",
                      id: "cell-inspector-group",
                    },
                    size: 274,
                  },
                  {
                    type: "leaf",
                    data: {
                      views: ["scene-settings"],
                      activeView: "scene-settings",
                      id: "scene-settings-group",
                    },
                    size: 199,
                  },
                  {
                    type: "leaf",
                    data: {
                      views: ["quick-tools"],
                      activeView: "quick-tools",
                      id: "quick-tools-group",
                    },
                    size: 150,
                  },
                ],
                size: 255,
              },
            ],
            size: 623,
          },
          // Bottom strip — Output+Problems tabbed + Selection Info
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
                size: 1334,
              },
              {
                type: "leaf",
                data: {
                  views: ["selection-info"],
                  activeView: "selection-info",
                  id: "selection-info-group",
                },
                size: 546,
              },
            ],
            size: 144,
          },
        ],
        size: 1880,
      },
      height: 767,
      width: 1880,
      orientation: "VERTICAL",
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
      layers: { id: "layers", contentComponent: "layers", title: "Layers" },
      "map-canvas": {
        id: "map-canvas",
        contentComponent: "map-canvas",
        title: "Map",
      },
      "selection-info": {
        id: "selection-info",
        contentComponent: "selection-info",
        title: "Selection Info",
      },
      preview: {
        id: "preview",
        contentComponent: "preview",
        title: "3D Preview",
      },
      "cell-inspector": {
        id: "cell-inspector",
        contentComponent: "cell-inspector",
        title: "Cell Inspector",
      },
      "quick-tools": {
        id: "quick-tools",
        contentComponent: "quick-tools",
        title: "Quick Tools",
      },
      "scene-settings": {
        id: "scene-settings",
        contentComponent: "scene-settings",
        title: "Scene Settings",
      },
      output: { id: "output", contentComponent: "output", title: "Output" },
      problems: {
        id: "problems",
        contentComponent: "problems",
        title: "Problems",
      },
    },
  } as unknown as SerializedDockview;
}

export function MapView(_props: MapViewProps = {}): React.JSX.Element {
  const [route] = useRoute();
  const projectId = route.projectId ?? "no-project";

  // Stable reference — passing a new JSX element each render would
  // thrash the slot effect's deps. The slot content reads everything
  // it needs from `<ActiveSceneProvider/>` + fixtures.
  const topBarSlot = React.useMemo(() => <SceneTopBarSlot />, []);
  useTabContextSlot(topBarSlot);

  // Editor-pack contributions — fetched async on mount, merged into
  // the live panel registry once loaded. Empty array until the load
  // resolves (so the layout works without them). See
  // `apps/editor/src/packs/editorPackLoader.ts`.
  const editorPackPanels = useEditorPackPanels();
  const panels = React.useMemo<readonly DockPanelDef[]>(
    () => [...PANELS, ...editorPackPanels],
    [editorPackPanels],
  );

  // Gate the DockShell mount on the editor-pack load. The default
  // scene layout references panel ids (`output`, `problems`, …) whose
  // components are CONTRIBUTED by the core-editor-pack (P3 batch A).
  // Mounting the dockview before the pack registers them would crash
  // dockview's deserializer with "Only React.memo / ForwardRef /
  // functional components are accepted as components" — the saved
  // layout names an id whose `components[id]` is still `undefined`.
  //
  // The load is module-cached (see `loadEditorPacks()`), so this
  // splash typically appears for <100ms on a warm reload. After
  // Phase 4 every panel in the default layout will be pack-contributed,
  // so there is no useful intermediate render to show anyway.
  const packsLoaded = useEditorPacksLoaded();

  // `demo.selection.clear` is now owned by the editor-pack-demo's
  // pack-bundled `scripts/setup.ts` (Phase 2a, task #30). The editor
  // app no longer holds any first-party registration on a third-party
  // pack's behalf — the dogfooding loop is honest.

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

  // Pre-load splash — see `packsLoaded` note above.
  if (!packsLoaded) {
    return (
      <div className="h-full w-full p-6 flex items-center justify-center">
        <EmptyState
          icon={<Construction size={28} />}
          title="Loading editor packs…"
          description="Resolving panels contributed by enabled editor packs."
        />
      </div>
    );
  }

  return (
    <div className="h-full w-full min-h-0 flex">
      <WorkspaceRail
        pageId="scene"
        storageKey={storageKey}
        apiRef={apiRef}
        registry={panels}
      />
      <div className="flex-1 min-w-0 h-full">
        <DockShell
          storageKey={storageKey}
          panels={panels}
          defaultLayout={defaultLayout}
          apiRef={apiRef}
        />
      </div>
    </div>
  );
}

export default MapView;

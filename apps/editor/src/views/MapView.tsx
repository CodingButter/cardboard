import React from "react";
import { Construction, MapIcon, SlidersHorizontal } from "lucide-react";
import type { SerializedDockview } from "dockview";
import { EmptyState } from "../components/ui/EmptyState";
import { useTabContextSlot } from "../lib/tabContextSlot";
import { SceneTabContextPicker } from "./scene/SceneTabContextPicker";
import { useRoute } from "../lib/router";
import {
  DockShell,
  type DockPanelDef,
} from "../components/dock/DockShell";
import { DockPanel } from "../components/dock/DockPanel";
import {
  WorkspacePanel,
  WorkspacePanelIcon,
  WORKSPACE_PANEL_ID,
} from "../components/dock/WorkspacePanel";

/**
 * MapView — Scene page shell.
 *
 * Scene is the first editor page to opt into the dockview-driven
 * internal layout primitives (see
 * apps/editor/src/components/dock/DockShell.tsx). The shell hosts two
 * starter panels — Map (the eventual canvas) and Inspector — that the
 * user can drag, retile, or pop out into a separate window. The
 * layout JSON persists per-project under
 * `cardboard_editor_dock_layout_scene::<projectId>` so the next
 * session lands on the same layout.
 *
 * Each panel renders an `EmptyState` for now; subsequent waves rebuild
 * them against `Editor Design/Map.png` (see
 * docs/EDITOR_DESIGN_INVENTORY.md §1.2).
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

function MapBody() {
  return (
    <DockPanel padded scroll={false}>
      <div className="h-full w-full flex items-center justify-center">
        <EmptyState
          icon={<MapIcon size={28} />}
          title="Map canvas — coming soon"
          description="The Scene canvas is being rebuilt. Drag this panel by its tab to reorganise, or pop it out into a new window."
        />
      </div>
    </DockPanel>
  );
}

function InspectorBody() {
  return (
    <DockPanel padded scroll>
      <div className="flex flex-col gap-4 text-sm text-zinc-400">
        <EmptyState
          icon={<SlidersHorizontal size={24} />}
          title="Inspector — coming soon"
          description="Per-entity properties will live here. Drag this panel by its tab to reorganise, or pop it out into a new window."
        />
      </div>
    </DockPanel>
  );
}

/** Stable panel registry — declared at module scope so each MapView
 *  mount reuses the same component identities. dockview keys panels
 *  by their `contentComponent` string at layout-time, so flipping the
 *  identity of the component would force a full remount.
 *
 *  Each panel carries an optional `icon` rendered left of the title
 *  in the DockPanelHeader (matches the iconography in
 *  Editor Design/Entities.png). The `controls` slot is left empty
 *  here so the header paints a chevron placeholder — sub-pages will
 *  wire real controls later. */
const PANELS: readonly DockPanelDef[] = [
  {
    id: WORKSPACE_PANEL_ID,
    title: "Workspace",
    component: WorkspacePanel,
    icon: <WorkspacePanelIcon size={12} />,
  },
  {
    id: "map",
    title: "Map",
    component: MapBody,
    icon: <MapIcon size={12} />,
  },
  {
    id: "inspector",
    title: "Inspector",
    component: InspectorBody,
    icon: <SlidersHorizontal size={12} />,
  },
];

/** Initial layout JSON — Map (60%) + Inspector (40%) side by side.
 *  The Workspace rail is NOT included in the default JSON; DockShell's
 *  `ensureWorkspace` safety net adds it via `addPanel({ initialWidth: 48 })`
 *  after `fromJSON` completes. addPanel honours `initialWidth` in
 *  absolute pixels, whereas grid `size` fields in `fromJSON` are
 *  relative weights normalised to the viewport — making it impossible
 *  to declare an exact 48px column in JSON form.
 *
 *  Result is persisted via the workspace store under
 *  `cardboard_workspace.dockLayouts[scene::<projectId>]`. The
 *  Workspace panel always survives in the persisted snapshot because
 *  the safety net runs on every onReady, so dock layouts re-load with
 *  the rail present even if it was somehow removed. */
function buildDefaultLayout(): SerializedDockview {
  return {
    grid: {
      root: {
        type: "branch",
        data: [
          {
            type: "leaf",
            data: {
              views: ["map"],
              activeView: "map",
              id: "map-group",
            },
            size: 600,
          },
          {
            type: "leaf",
            data: {
              views: ["inspector"],
              activeView: "inspector",
              id: "inspector-group",
            },
            size: 400,
          },
        ],
        size: 1000,
      },
      height: 1000,
      width: 1000,
      orientation: "HORIZONTAL",
    },
    panels: {
      map: {
        id: "map",
        contentComponent: "map",
        title: "Map",
      },
      inspector: {
        id: "inspector",
        contentComponent: "inspector",
        title: "Inspector",
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
  // Memoize so we don't rebuild the JSON every render (DockShell uses
  // referential equality on `defaultLayout` in the onReady callback
  // dep array). The default layout shape doesn't depend on the
  // project — Workspace is added separately by DockShell's safety
  // net using addPanel with absolute initialWidth.
  const defaultLayout = React.useMemo(() => buildDefaultLayout(), []);

  return (
    <div className="h-full w-full min-h-0">
      <DockShell
        storageKey={storageKey}
        panels={PANELS}
        defaultLayout={defaultLayout}
      />
    </div>
  );
}

export default MapView;

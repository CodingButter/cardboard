import React from "react";
import { Construction, MapIcon, SlidersHorizontal } from "lucide-react";
import { EmptyState } from "../components/ui/EmptyState";
import { useTabContextSlot } from "../lib/tabContextSlot";
import { SceneTabContextPicker } from "./scene/SceneTabContextPicker";
import { useRoute } from "../lib/router";
import {
  DockShell,
  buildSideBySideLayout,
  type DockPanelDef,
} from "../components/dock/DockShell";
import { DockPanel } from "../components/dock/DockPanel";

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
 *  identity of the component would force a full remount. */
const PANELS: readonly DockPanelDef[] = [
  { id: "map", title: "Map", component: MapBody },
  { id: "inspector", title: "Inspector", component: InspectorBody },
];

/** Initial layout JSON — Map on the left (60%), Inspector on the
 *  right (40%). The user can re-tile, tab-group, or pop out at will;
 *  the result lands in localStorage under
 *  `cardboard_editor_dock_layout_scene::<projectId>`. */
const DEFAULT_LAYOUT = buildSideBySideLayout(PANELS);

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

  return (
    <div className="h-full w-full min-h-0">
      <DockShell
        storageKey={`scene::${projectId}`}
        panels={PANELS}
        defaultLayout={DEFAULT_LAYOUT}
      />
    </div>
  );
}

export default MapView;

import type { SerializedDockview } from "dockview";

/**
 * predefinedLayouts — the built-in, read-only layout catalogue surfaced
 * inside the Workspace v1.5 Layouts modal.
 *
 * Built-in layouts always include the Workspace rail in their JSON so
 * applying a preset preserves the rail. The rail lives on the left
 * edge with an `initialWidth` ~ 48px; dockview only stores a relative
 * `size` in the grid JSON (the workspace group's flex weight), so we
 * give it a small weight (40) and let the panel splitter constraint
 * (minimum 40) handle the live width — the rail will naturally render
 * narrow, and the user can drag the splitter wider if they want.
 *
 * Catalogue is keyed by pageId (e.g. `"scene"`); each page registers
 * its own list. Pages without registered layouts get an empty array.
 *
 * The layout shape mirrors dockview's `SerializedDockview` exactly; we
 * paint each `panels` entry's `id` / `contentComponent` / `title` and
 * a leaf node referencing the view in the grid. DockShell handles
 * `fromJSON` and re-injects icon/controls ornaments via context (those
 * are React nodes, not JSON-safe — see DockShell.tsx).
 */

export interface PredefinedLayout {
  /** Stable id; used as the `lastAppliedPresetId` marker in the store
   *  + as the React key in the modal grid. */
  readonly id: string;
  /** Human-facing label rendered under the thumbnail. */
  readonly name: string;
  /** Optional short description (kept in the registry for future
   *  tooltip use; not currently rendered in the card surface). */
  readonly description?: string;
  /** Optional iconography hint — a lucide icon name. Reserved for
   *  future use; the LayoutsModal renders the skeleton thumbnail. */
  readonly iconHint?: string;
  /** dockview JSON applied via `api.fromJSON(layout)`. */
  readonly layout: SerializedDockview;
}

const WORKSPACE_GRID_WEIGHT = 40;

/** Helper — produce the Workspace rail leaf used by every Scene
 *  predefined layout. The grid is HORIZONTAL at root so this leaf
 *  becomes a thin left column. */
const workspaceLeaf = () => ({
  type: "leaf" as const,
  data: {
    views: ["workspace"],
    activeView: "workspace",
    id: "workspace-group",
  },
  size: WORKSPACE_GRID_WEIGHT,
});

const workspacePanelEntry = () => ({
  workspace: {
    id: "workspace",
    contentComponent: "workspace",
    title: "Workspace",
  },
});

/** "Default" — Map + Inspector side-by-side with the Workspace rail on
 *  the far left. Mirrors `MapView.buildDefaultLayout` but explicitly
 *  includes the workspace leaf so the preset is self-contained. */
function defaultLayout(): SerializedDockview {
  return {
    grid: {
      root: {
        type: "branch",
        data: [
          workspaceLeaf(),
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
      ...workspacePanelEntry(),
      map: { id: "map", contentComponent: "map", title: "Map" },
      inspector: {
        id: "inspector",
        contentComponent: "inspector",
        title: "Inspector",
      },
    },
  } as unknown as SerializedDockview;
}

/** "Map Focus" — Map takes ~80% width with Inspector reduced to a
 *  narrow right column. Useful when working primarily on the canvas. */
function mapFocusLayout(): SerializedDockview {
  return {
    grid: {
      root: {
        type: "branch",
        data: [
          workspaceLeaf(),
          {
            type: "leaf",
            data: {
              views: ["map"],
              activeView: "map",
              id: "map-group",
            },
            size: 800,
          },
          {
            type: "leaf",
            data: {
              views: ["inspector"],
              activeView: "inspector",
              id: "inspector-group",
            },
            size: 200,
          },
        ],
        size: 1000,
      },
      height: 1000,
      width: 1000,
      orientation: "HORIZONTAL",
    },
    panels: {
      ...workspacePanelEntry(),
      map: { id: "map", contentComponent: "map", title: "Map" },
      inspector: {
        id: "inspector",
        contentComponent: "inspector",
        title: "Inspector",
      },
    },
  } as unknown as SerializedDockview;
}

/** "Split Horizontal" — Map on the top half of the content area,
 *  Inspector on the bottom. The Workspace rail stays on the left. */
function splitHorizontalLayout(): SerializedDockview {
  // Root is HORIZONTAL: workspace rail on the left + a VERTICAL
  // branch on the right that contains Map (top) and Inspector
  // (bottom). dockview encodes nested branches as `{type:"branch"}`
  // entries inside the parent branch's `data` array.
  return {
    grid: {
      root: {
        type: "branch",
        data: [
          workspaceLeaf(),
          {
            type: "branch",
            data: [
              {
                type: "leaf",
                data: {
                  views: ["map"],
                  activeView: "map",
                  id: "map-group",
                },
                size: 500,
              },
              {
                type: "leaf",
                data: {
                  views: ["inspector"],
                  activeView: "inspector",
                  id: "inspector-group",
                },
                size: 500,
              },
            ],
            size: 960,
          },
        ],
        size: 1000,
      },
      height: 1000,
      width: 1000,
      orientation: "HORIZONTAL",
    },
    panels: {
      ...workspacePanelEntry(),
      map: { id: "map", contentComponent: "map", title: "Map" },
      inspector: {
        id: "inspector",
        contentComponent: "inspector",
        title: "Inspector",
      },
    },
  } as unknown as SerializedDockview;
}

/** "Inspector Wide" — Map narrowed, Inspector takes the larger column.
 *  Useful when editing entity properties with the canvas as reference. */
function inspectorWideLayout(): SerializedDockview {
  return {
    grid: {
      root: {
        type: "branch",
        data: [
          workspaceLeaf(),
          {
            type: "leaf",
            data: {
              views: ["map"],
              activeView: "map",
              id: "map-group",
            },
            size: 400,
          },
          {
            type: "leaf",
            data: {
              views: ["inspector"],
              activeView: "inspector",
              id: "inspector-group",
            },
            size: 600,
          },
        ],
        size: 1000,
      },
      height: 1000,
      width: 1000,
      orientation: "HORIZONTAL",
    },
    panels: {
      ...workspacePanelEntry(),
      map: { id: "map", contentComponent: "map", title: "Map" },
      inspector: {
        id: "inspector",
        contentComponent: "inspector",
        title: "Inspector",
      },
    },
  } as unknown as SerializedDockview;
}

export const PREDEFINED_LAYOUTS: Record<string, readonly PredefinedLayout[]> = {
  scene: [
    {
      id: "scene/default",
      name: "Default",
      description: "Map and Inspector side-by-side.",
      layout: defaultLayout(),
    },
    {
      id: "scene/map-focus",
      name: "Map Focus",
      description: "Map takes ~80% width.",
      layout: mapFocusLayout(),
    },
    {
      id: "scene/split-horizontal",
      name: "Split Horizontal",
      description: "Map above Inspector.",
      layout: splitHorizontalLayout(),
    },
    {
      id: "scene/inspector-wide",
      name: "Inspector Wide",
      description: "Inspector takes the larger column.",
      layout: inspectorWideLayout(),
    },
  ],
};

/** Selector helper for a page's predefined layouts. Returns an empty
 *  array (NOT undefined) if the page has no entries. */
export function getPredefinedLayouts(pageId: string): readonly PredefinedLayout[] {
  return PREDEFINED_LAYOUTS[pageId] ?? [];
}

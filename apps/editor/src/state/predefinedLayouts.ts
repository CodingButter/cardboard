import type { SerializedDockview } from "dockview";

/**
 * predefinedLayouts — the built-in, read-only layout catalogue surfaced
 * inside the Workspace Layouts modal.
 *
 * These describe dockview's internal panel layout only. The Workspace
 * rail is page chrome, not a dockview panel, so it never appears in
 * these JSON snapshots. Each entry's `panels` map MUST reference only
 * panel ids registered on the page's DockShell (e.g. `map`,
 * `inspector` for the Scene page). Referencing a panel that isn't in
 * the registry causes `api.fromJSON` to drop the whole layout silently.
 *
 * Catalogue is keyed by pageId (e.g. `"scene"`); each page registers
 * its own list. Pages without registered layouts get an empty array.
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

/** "Default" — Map + Inspector side-by-side. */
function defaultLayout(): SerializedDockview {
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
 *  Inspector on the bottom. */
function splitHorizontalLayout(): SerializedDockview {
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
        size: 1000,
      },
      height: 1000,
      width: 1000,
      orientation: "VERTICAL",
    },
    panels: {
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

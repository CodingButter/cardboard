import type { SerializedDockview } from "dockview";

/**
 * predefinedLayouts — the built-in, read-only layout catalogue surfaced
 * inside the Workspace Layouts modal.
 *
 * These describe dockview's internal panel layout only. The Workspace
 * rail is page chrome, not a dockview panel, so it never appears in
 * these JSON snapshots. Each entry's `panels` map MUST reference only
 * panel ids registered on the page's DockShell. Referencing a panel
 * that isn't in the registry causes `api.fromJSON` to drop the whole
 * layout silently.
 *
 * Catalogue is keyed by pageId (e.g. `"scene"`); each page registers
 * its own list. Pages without registered layouts get an empty array.
 *
 * The Scene-page registry (`PANELS` in `apps/editor/src/views/MapView.tsx`)
 * defines the canonical 12 panel ids used here:
 *   tool-palette, brush, tile-preset, layers, map-canvas,
 *   preview, cell-inspector, quick-tools, output, problems,
 *   selection-info, scene-settings.
 *
 * The "Default" preset replicates `buildDefaultLayout()` in
 * `MapView.tsx`. We inline it here (rather than importing) to avoid a
 * MapView ↔ WorkspacePanel ↔ predefinedLayouts module cycle that
 * would evaluate at init time. If the canonical default layout
 * shape changes in MapView, mirror the change in `defaultLayout()`
 * below.
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

/**
 * "Default" — the full editor surface, captured from the maintainer's
 * working layout snapshot.
 *
 *   Top half (HORIZONTAL — 4 columns):
 *     ├─ Col 1: Tool Palette / Brush / Tile Presets
 *     ├─ Col 2: Map Canvas
 *     ├─ Col 3: 3D Preview / Layers
 *     └─ Col 4: Cell Inspector / Scene Settings / Quick Tools
 *
 *   Bottom strip (HORIZONTAL):
 *     ├─ Output+Problems (tabbed group)
 *     └─ Selection Info
 *
 * Kept in lock-step with `buildDefaultLayout()` in
 * `apps/editor/src/views/MapView.tsx`.
 */
function defaultLayout(): SerializedDockview {
  return {
    grid: {
      root: {
        type: "branch",
        data: [
          // Top half — 4 columns
          {
            type: "branch",
            data: [
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
                    size: 207,
                  },
                  {
                    type: "leaf",
                    data: {
                      views: ["brush"],
                      activeView: "brush",
                      id: "brush-group",
                    },
                    size: 207,
                  },
                  {
                    type: "leaf",
                    data: {
                      views: ["tile-preset"],
                      activeView: "tile-preset",
                      id: "tile-preset-group",
                    },
                    size: 209,
                  },
                ],
                size: 279,
              },
              {
                type: "leaf",
                data: {
                  views: ["map-canvas"],
                  activeView: "map-canvas",
                  id: "map-canvas-group",
                },
                size: 1063,
              },
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
          // Bottom strip
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

/**
 * "Map Focus" — wide canvas, slim left rail.
 *
 *   [ Tools / Tile Presets (narrow) | Canvas (wide) ]
 *
 * For paint-heavy work where the inspector/preview stack is noise.
 */
function mapFocusLayout(): SerializedDockview {
  return {
    grid: {
      root: {
        type: "branch",
        data: [
          // Left column — Tool Palette + Tile Presets only
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
                size: 240,
              },
              {
                type: "leaf",
                data: {
                  views: ["tile-preset"],
                  activeView: "tile-preset",
                  id: "tile-preset-group",
                },
                size: 360,
              },
            ],
            size: 220,
          },
          // Centre column — wide Map Canvas
          {
            type: "leaf",
            data: {
              views: ["map-canvas"],
              activeView: "map-canvas",
              id: "map-canvas-group",
            },
            size: 780,
          },
        ],
        size: 1000,
      },
      height: 800,
      width: 1000,
      orientation: "HORIZONTAL",
    },
    panels: {
      "tool-palette": {
        id: "tool-palette",
        contentComponent: "tool-palette",
        title: "Tools",
      },
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
    },
  } as unknown as SerializedDockview;
}

/**
 * "Inspect" — canvas + right-side inspector stack.
 *
 *   [ Map Canvas (wide) | Cell Inspector / 3D Preview / Quick Tools / Selection Info ]
 *
 * No left palette panels — the focus is on inspecting + verifying the
 * current selection, not painting.
 */
function inspectLayout(): SerializedDockview {
  return {
    grid: {
      root: {
        type: "branch",
        data: [
          {
            type: "leaf",
            data: {
              views: ["map-canvas"],
              activeView: "map-canvas",
              id: "map-canvas-group",
            },
            size: 620,
          },
          // Right inspector stack
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
                size: 290,
              },
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
                  views: ["quick-tools"],
                  activeView: "quick-tools",
                  id: "quick-tools-group",
                },
                size: 150,
              },
              {
                type: "leaf",
                data: {
                  views: ["selection-info"],
                  activeView: "selection-info",
                  id: "selection-info-group",
                },
                size: 160,
              },
            ],
            size: 380,
          },
        ],
        size: 1000,
      },
      height: 840,
      width: 1000,
      orientation: "HORIZONTAL",
    },
    panels: {
      "map-canvas": {
        id: "map-canvas",
        contentComponent: "map-canvas",
        title: "Map",
      },
      "cell-inspector": {
        id: "cell-inspector",
        contentComponent: "cell-inspector",
        title: "Cell Inspector",
      },
      preview: {
        id: "preview",
        contentComponent: "preview",
        title: "3D Preview",
      },
      "quick-tools": {
        id: "quick-tools",
        contentComponent: "quick-tools",
        title: "Quick Tools",
      },
      "selection-info": {
        id: "selection-info",
        contentComponent: "selection-info",
        title: "Selection Info",
      },
    },
  } as unknown as SerializedDockview;
}

/**
 * "Debug" — canvas + bottom debugging stack.
 *
 *   [ Layers (narrow left) | Canvas (top) / Output+Problems + Selection Info (bottom row) ]
 *
 * Useful when chasing down "why doesn't paint apply here?" issues —
 * the Output/Problems tabbed group catches diagnostics, the
 * selection-info readout confirms what's actually under the cursor,
 * and Layers lets you isolate which layer is on top.
 */
function debugLayout(): SerializedDockview {
  return {
    grid: {
      root: {
        type: "branch",
        data: [
          // Left column — Layers only
          {
            type: "leaf",
            data: {
              views: ["layers"],
              activeView: "layers",
              id: "layers-group",
            },
            size: 180,
          },
          // Centre+right column — Canvas on top, status row below
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
                size: 540,
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
                    size: 560,
                  },
                  {
                    type: "leaf",
                    data: {
                      views: ["selection-info"],
                      activeView: "selection-info",
                      id: "selection-info-group",
                    },
                    size: 260,
                  },
                ],
                size: 260,
              },
            ],
            size: 820,
          },
        ],
        size: 1000,
      },
      height: 800,
      width: 1000,
      orientation: "HORIZONTAL",
    },
    panels: {
      layers: { id: "layers", contentComponent: "layers", title: "Layers" },
      "map-canvas": {
        id: "map-canvas",
        contentComponent: "map-canvas",
        title: "Map",
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
    },
  } as unknown as SerializedDockview;
}

export const PREDEFINED_LAYOUTS: Record<string, readonly PredefinedLayout[]> = {
  scene: [
    {
      id: "scene/default",
      name: "Default",
      description: "All panels visible — full editing surface per Map.png.",
      layout: defaultLayout(),
    },
    {
      id: "scene/map-focus",
      name: "Map Focus",
      description:
        "Wide canvas with just Tools + Tile Presets for paint-heavy work.",
      layout: mapFocusLayout(),
    },
    {
      id: "scene/inspect",
      name: "Inspect",
      description:
        "Canvas + Cell Inspector + Preview for selection-focused work.",
      layout: inspectLayout(),
    },
    {
      id: "scene/debug",
      name: "Debug",
      description:
        "Canvas + Output/Problems + layers for debugging painting issues.",
      layout: debugLayout(),
    },
  ],
};

/** Selector helper for a page's predefined layouts. Returns an empty
 *  array (NOT undefined) if the page has no entries. */
export function getPredefinedLayouts(pageId: string): readonly PredefinedLayout[] {
  return PREDEFINED_LAYOUTS[pageId] ?? [];
}

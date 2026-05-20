import type { SerializedDockview } from "dockview";

/**
 * SCENE_DEFAULT_LAYOUT — the Scene page's default dockview layout.
 *
 * Moved out of `apps/editor/src/views/MapView.tsx` into the core-editor-pack
 * during P4. The pack's `scripts/setup.tsx` registers this via
 * `ctx.registerLayout("scene", SCENE_DEFAULT_LAYOUT)` so the view shell
 * picks it up through `useDefaultLayout("scene")`.
 *
 * Structure (root orientation VERTICAL — top half + bottom strip):
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
 * Sizes are relative weights; the actual pixel widths flex with the
 * viewport. The user can drag any splitter to rebalance, and every
 * panel id below is registered as a pack-contributed DockPanelDef
 * (see `scripts/setup.tsx`).
 *
 * Persisted via the workspace store under
 * `cardboard_workspace.dockLayouts[scene::<projectId>]`.
 */
export const SCENE_DEFAULT_LAYOUT: SerializedDockview = {
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

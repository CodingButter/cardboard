import type { SerializedDockview } from "dockview";

/**
 * predefined — the built-in Scene-page layout catalogue.
 *
 * P5 migrated this content out of
 * `apps/editor/src/state/predefinedLayouts.ts` into the core-editor-pack.
 * The pack's `scripts/setup.tsx` registers each entry via
 * `ctx.registerPredefinedLayout("scene", name, { id, description,
 * layout })` so the shell's `useLayoutRegistryStore` becomes the SINGLE
 * source of truth — both default + predefined layouts now flow through
 * the registry contributed by the pack.
 *
 * Catalogue is currently scoped to the Scene workspace. Adding Prefabs
 * presets (or third-party pack presets) is a one-line
 * `ctx.registerPredefinedLayout(...)` call in the pack's setup script.
 *
 * Each entry's `panels` map MUST reference only panel ids registered on
 * the page's DockShell. Referencing a panel that isn't in the registry
 * causes `api.fromJSON` to drop the whole layout silently. The Scene
 * page registers 12 panel ids (see `scripts/setup.tsx`):
 *   tool-palette, brush, tile-preset, layers, map-canvas,
 *   preview, cell-inspector, quick-tools, output, problems,
 *   selection-info, scene-settings.
 *
 * The "Default" preset replicates `SCENE_DEFAULT_LAYOUT` exactly — they
 * share a single source of truth in `layouts/scene-default.ts` and this
 * file re-uses it to expose the same layout through the preset
 * catalogue as well.
 */

import { SCENE_DEFAULT_LAYOUT } from "./scene-default";

export interface PredefinedLayoutEntry {
  /** Stable id; used as the `lastAppliedPresetId` marker in the store
   *  + as the React key in the modal grid. */
  readonly id: string;
  /** Human-facing label rendered under the thumbnail. */
  readonly name: string;
  /** Optional short description (rendered in the LayoutsModal hover
   *  tooltip body). */
  readonly description?: string;
  /** dockview JSON applied via `api.fromJSON(layout)`. */
  readonly layout: SerializedDockview;
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

/**
 * Predefined Scene-page layouts. Registered with the shell's layout
 * registry by `scripts/setup.tsx` via
 * `ctx.registerPredefinedLayout("scene", name, { id, description,
 * layout })`. Order here is the order they appear in the LayoutsModal
 * grid (post the "Default" tile which is registered separately).
 */
export const SCENE_PREDEFINED_LAYOUTS: readonly PredefinedLayoutEntry[] = [
  {
    id: "scene/default",
    name: "Default",
    description: "All panels visible — full editing surface per Map.png.",
    layout: SCENE_DEFAULT_LAYOUT,
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
];

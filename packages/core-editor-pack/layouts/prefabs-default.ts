import type { SerializedDockview } from "dockview";

/**
 * PREFABS_DEFAULT_LAYOUT — the Prefabs page's default dockview layout.
 *
 * Moved out of `apps/editor/src/views/PrefabsView.tsx` into the
 * core-editor-pack during P4. The pack's `scripts/setup.tsx`
 * registers this via `ctx.registerLayout("prefabs", PREFABS_DEFAULT_LAYOUT)`.
 *
 * Structure (root orientation HORIZONTAL — three columns):
 *
 *    ├─ Col 1 (size 300, VERTICAL):
 *    │     Entity Preview (size 280)
 *    │   / Entity List    (size 280)
 *    │   / Drop Zone      (size 80)
 *    ├─ Col 2 (size 700, VERTICAL):
 *    │     Entity Header   (size 100)
 *    │   / Component Editor (size 540)
 *    └─ Col 3 (size 280):
 *          JSON Preview (full column height)
 *
 * Sizes are relative weights; the user can drag any splitter to
 * rebalance. Persisted via the workspace store under
 * `cardboard_workspace.dockLayouts[prefabs::<projectId>]`.
 */
export const PREFABS_DEFAULT_LAYOUT: SerializedDockview = {
  grid: {
    root: {
      type: "branch",
      data: [
        // Col 1 — Entity Preview / Entity List / Drop Zone
        {
          type: "branch",
          data: [
            {
              type: "leaf",
              data: {
                views: ["entity-preview"],
                activeView: "entity-preview",
                id: "entity-preview-group",
              },
              size: 280,
            },
            {
              type: "leaf",
              data: {
                views: ["entity-list"],
                activeView: "entity-list",
                id: "entity-list-group",
              },
              size: 280,
            },
            {
              type: "leaf",
              data: {
                views: ["entity-drop-zone"],
                activeView: "entity-drop-zone",
                id: "entity-drop-zone-group",
              },
              size: 80,
            },
          ],
          size: 300,
        },
        // Col 2 — Entity Header (top strip) / Component Editor (body)
        {
          type: "branch",
          data: [
            {
              type: "leaf",
              data: {
                views: ["entity-header"],
                activeView: "entity-header",
                id: "entity-header-group",
              },
              size: 100,
            },
            {
              type: "leaf",
              data: {
                views: ["component-editor"],
                activeView: "component-editor",
                id: "component-editor-group",
              },
              size: 540,
            },
          ],
          size: 700,
        },
        // Col 3 — JSON Preview (full column height)
        {
          type: "leaf",
          data: {
            views: ["json-preview"],
            activeView: "json-preview",
            id: "json-preview-group",
          },
          size: 280,
        },
      ],
      size: 640,
    },
    height: 640,
    width: 1280,
    orientation: "HORIZONTAL",
  },
  panels: {
    "entity-preview": {
      id: "entity-preview",
      contentComponent: "entity-preview",
      title: "Preview",
    },
    "entity-list": {
      id: "entity-list",
      contentComponent: "entity-list",
      title: "Entities",
    },
    "entity-drop-zone": {
      id: "entity-drop-zone",
      contentComponent: "entity-drop-zone",
      title: "Drop Zone",
    },
    "entity-header": {
      id: "entity-header",
      contentComponent: "entity-header",
      title: "Entity Header",
    },
    "component-editor": {
      id: "component-editor",
      contentComponent: "component-editor",
      title: "Components",
    },
    "json-preview": {
      id: "json-preview",
      contentComponent: "json-preview",
      title: "JSON",
    },
  },
} as unknown as SerializedDockview;

import React from "react";
import { Construction } from "lucide-react";
import type { DockviewApi, SerializedDockview } from "dockview";
import { EmptyState } from "../components/ui/EmptyState";
import { useTabContextSlot } from "../lib/tabContextSlot";
import { useRoute } from "../lib/router";
import { registerCommand } from "../state/useCommandStore";
import {
  DockShell,
  type DockPanelDef,
} from "../components/dock/DockShell";
import { WorkspaceRail } from "../components/dock/WorkspacePanel";
import {
  EntityPreviewPanel,
  MANIFEST as ENTITY_PREVIEW_MANIFEST,
} from "./prefabs/panels/EntityPreviewPanel";
import {
  EntityListPanel,
  MANIFEST as ENTITY_LIST_MANIFEST,
} from "./prefabs/panels/EntityListPanel";
import {
  EntityDropZonePanel,
  MANIFEST as ENTITY_DROP_ZONE_MANIFEST,
} from "./prefabs/panels/EntityDropZonePanel";
import {
  EntityHeaderPanel,
  MANIFEST as ENTITY_HEADER_MANIFEST,
} from "./prefabs/panels/EntityHeaderPanel";
import {
  ComponentEditorPanel,
  MANIFEST as COMPONENT_EDITOR_MANIFEST,
} from "./prefabs/panels/ComponentEditorPanel";
import {
  JsonPreviewPanel,
  MANIFEST as JSON_PREVIEW_MANIFEST,
} from "./prefabs/panels/JsonPreviewPanel";
import { MOCK_ENTITIES } from "./prefabs/prefabs-fixtures";

/**
 * PrefabsView — Prefabs page shell.
 *
 * The Prefabs page is the form-heavy ENTITY DEFINITION editor: users
 * pick an entity from the left-column library, edit its components in
 * the center editor, and see the serialized definition live-update in
 * the right column. Engine context: entities are pack-defined
 * templates (think Wolfenstein-style enemies / items / triggers /
 * lights) that the Scene canvas instantiates by reference.
 *
 * The page mirrors the Scene page's dockview-driven layout (see
 * `MapView.tsx`) so users can drag, retile, or pop out any panel.
 * Layout JSON persists per-project under
 * `cardboard_workspace.dockLayouts[prefabs::<projectId>]`.
 *
 * Visual target: `Editor Design/Entities.png` — three columns:
 *   - Col 1 (vertical split): Entity Preview / Entity List / Drop Zone.
 *   - Col 2 (vertical split): Entity Header (top strip) / Component
 *     Editor (large body).
 *   - Col 3: JSON Preview (full height).
 *
 * Wave 1 panel bodies are empty stubs; Wave 2 fills them in.
 *
 * Tab-row contextual slot:
 *   PrefabsView registers a minimal "Prefabs" context label into the
 *   tab strip's per-tab right slot on mount. The hook's cleanup
 *   clears the slot when the view unmounts.
 *
 * Command registry:
 *   One `prefabs.openEntity.<id>` command per MOCK_ENTITIES entry,
 *   registered in a mount-once effect. Each command's stub `run`
 *   handler logs the entity id; Wave 2 wires the real "select this
 *   entity" action.
 */
export interface PrefabsViewProps {
  /** Widened — kept for compatibility with the EditorShell call site,
   *  but no required props for now. */
  [key: string]: unknown;
}

/** Stable panel registry — declared at module scope so each PrefabsView
 *  mount reuses the same component identities. dockview keys panels by
 *  their `contentComponent` string at layout-time, so flipping the
 *  identity of the component would force a full remount. */
const PANELS: readonly DockPanelDef[] = [
  // Left column
  { ...ENTITY_PREVIEW_MANIFEST, component: EntityPreviewPanel },
  { ...ENTITY_LIST_MANIFEST, component: EntityListPanel },
  { ...ENTITY_DROP_ZONE_MANIFEST, component: EntityDropZonePanel },
  // Center column
  // Entity Header gets a surface card so it reads as a distinct form
  // strip above the larger Component editor body.
  { ...ENTITY_HEADER_MANIFEST, component: EntityHeaderPanel, surface: true },
  { ...COMPONENT_EDITOR_MANIFEST, component: ComponentEditorPanel },
  // Right column — JSON preview renders flush so the monospace code
  // area can fill the dock group without a competing card chrome.
  { ...JSON_PREVIEW_MANIFEST, component: JsonPreviewPanel, surface: false },
];

/** Initial layout JSON — three-column layout matching Entities.png.
 *
 *  Structure (root orientation HORIZONTAL — three columns):
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
 *  Sizes are relative weights; the actual pixel widths flex with the
 *  viewport. The user can drag any splitter to rebalance, and every
 *  panel id below is also present in the `panels` dict so dockview
 *  can reconstruct the layout.
 *
 *  Persisted via the workspace store under
 *  `cardboard_workspace.dockLayouts[prefabs::<projectId>]`. */
function buildDefaultLayout(): SerializedDockview {
  return {
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
}

/** Tab-row right-slot content for the Prefabs view. Mirrors the Scene
 *  page's `SceneTopBarSlot` but minimal — just the page label + a
 *  live count of entities in the pack. Wave 2 will swap the fixture
 *  count for the real `EditorProjectStore.entities.length`. */
function PrefabsTopBarSlot(): React.JSX.Element {
  const count = MOCK_ENTITIES.length;
  const label = `${count} entities`;
  return (
    <div
      className="flex items-center gap-3 px-2 text-[10px] text-(--color-fg-secondary)"
      data-slot="prefabs-top-bar"
      aria-label="Prefabs context readouts"
    >
      <span className="font-mono text-(--color-fg-primary)">Prefabs</span>
      <span
        aria-hidden="true"
        className="text-(--color-border-strong) select-none"
      >
        ·
      </span>
      <span className="font-mono tabular-nums" aria-label={label}>
        {label}
      </span>
    </div>
  );
}

export function PrefabsView(_props: PrefabsViewProps = {}): React.JSX.Element {
  const [route] = useRoute();
  const projectId = route.projectId ?? "no-project";

  // Stable reference — passing a new JSX element each render would
  // thrash the slot effect's deps.
  const topBarSlot = React.useMemo(() => <PrefabsTopBarSlot />, []);
  useTabContextSlot(topBarSlot);

  // Mount-once registration of per-entity "open" commands. Wave 2
  // replaces the console.log stub with the real selection action.
  React.useEffect(() => {
    const unregs = MOCK_ENTITIES.map((entity) =>
      registerCommand({
        id: `prefabs.openEntity.${entity.id}`,
        title: `Open Entity: ${entity.name}`,
        category: "Prefabs",
        keywords: ["prefab", "entity", "open", entity.name, entity.id],
        description: entity.description,
        run: () => {
          // eslint-disable-next-line no-console
          console.log("[prefabs] open entity", entity.id);
        },
      }),
    );
    return () => {
      for (const u of unregs) u();
    };
  }, []);

  // Guard rail: if for some reason there's no project (e.g. someone
  // navigates here without one), render a polite empty state rather
  // than mount a dock shell with no persistence key.
  if (!route.projectId) {
    return (
      <div className="h-full w-full p-6 flex items-center justify-center">
        <EmptyState
          icon={<Construction size={28} />}
          title="No project open"
          description="Open a project from the Home tab to use the Prefabs page."
        />
      </div>
    );
  }

  const storageKey = `prefabs::${projectId}`;
  const defaultLayout = React.useMemo(() => buildDefaultLayout(), []);

  // Shared dockview api ref — Workspace rail's Layouts + Docks modals
  // call api.fromJSON / api.toJSON / api.addPanel against the same
  // instance DockShell creates.
  const apiRef = React.useRef<DockviewApi | null>(null);

  return (
    <div className="h-full w-full min-h-0 flex">
      <WorkspaceRail
        pageId="prefabs"
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

export default PrefabsView;

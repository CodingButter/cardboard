import React from "react";
import { Construction } from "lucide-react";
import type { DockviewApi } from "dockview";
import {
  DockShell,
  WorkspaceRail,
  EmptyState,
  useTabContextSlot,
  useRoute,
  useEditorPackPanels,
  useEditorPacksLoaded,
  registerCommand,
} from "@cardboard/editor-shell";
import { MOCK_ENTITIES } from "../panels/prefabs/prefabs-fixtures";
import { PREFABS_DEFAULT_LAYOUT } from "../layouts/prefabs-default";

/**
 * PrefabsView — Prefabs page shell.
 *
 * Moved into the core-editor-pack during P4 of the editor-pack
 * extraction (CORE_EDITOR_PACK.md §10 P4). The pack's
 * `scripts/setup.tsx` registers this component via
 * `ctx.registerView("prefabs", PrefabsView)`.
 *
 * The page mirrors the Scene page's dockview-driven layout so users
 * can drag, retile, or pop out any panel. Layout JSON persists
 * per-project under
 * `cardboard_workspace.dockLayouts[prefabs::<projectId>]`.
 *
 * Tab-row contextual slot
 * ───────────────────────
 *
 * PrefabsView registers a minimal "Prefabs" context label into the
 * tab strip's per-tab right slot on mount. The hook's cleanup clears
 * the slot when the view unmounts.
 *
 * Command registry
 * ────────────────
 *
 * One `prefabs.openEntity.<id>` command per MOCK_ENTITIES entry,
 * registered in a mount-once effect. Wave 2 wires the real
 * "select this entity" action.
 */
export interface PrefabsViewProps {
  /** Widened — kept for compatibility with the shell-side
   *  ViewComponent signature. */
  [key: string]: unknown;
}

/** Tab-row right-slot content for the Prefabs view. Mirrors the
 *  Scene page's `SceneTopBarSlot` but minimal — just the page label
 *  + a live count of entities in the pack. */
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

  // Mount-once registration of per-entity "open" commands.
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

  // Editor-pack contributions — fetched async on mount, merged into
  // the live panel registry once loaded.
  const editorPackPanels = useEditorPackPanels();

  // Gate the DockShell mount on the editor-pack load. The default
  // prefabs layout references panel ids contributed by this pack;
  // mounting dockview before the pack scripts have run would crash
  // the deserializer.
  const packsLoaded = useEditorPacksLoaded();

  // Guard rail: if for some reason there's no project, render a polite
  // empty state rather than mount a dock shell with no persistence key.
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

  // Shared dockview api ref.
  const apiRef = React.useRef<DockviewApi | null>(null);

  // Pre-load splash.
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
        pageId="prefabs"
        storageKey={storageKey}
        apiRef={apiRef}
        registry={editorPackPanels}
      />
      <div className="flex-1 min-w-0 h-full">
        <DockShell
          storageKey={storageKey}
          panels={editorPackPanels}
          defaultLayout={PREFABS_DEFAULT_LAYOUT}
          apiRef={apiRef}
        />
      </div>
    </div>
  );
}

export default PrefabsView;

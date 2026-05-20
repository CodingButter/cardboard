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
} from "@cardboard/editor-shell";
import { SceneTopBarSlot } from "./scene/SceneTopBarSlot";
import { SCENE_DEFAULT_LAYOUT } from "../layouts/scene-default";

/**
 * MapView — the Scene page shell.
 *
 * Moved into the core-editor-pack during P4 of the editor-pack
 * extraction (CORE_EDITOR_PACK.md §10 P4). The pack's `scripts/setup.tsx`
 * registers this component via `ctx.registerView("scene", MapView)`
 * and the editor shell's `<ShellBody/>` reads the registry to render
 * the active view.
 *
 * Pack-side imports
 * ─────────────────
 *
 * Every host-singleton-dependent symbol below (`DockShell`,
 * `WorkspaceRail`, `EmptyState`, `useTabContextSlot`, `useRoute`,
 * `useEditorPackPanels`, `useEditorPacksLoaded`) flows through the
 * pack-builder's `@cardboard/editor-shell` virtual module. Bundling
 * a duplicate inside the pack would fork the underlying state
 * (synced stores' BroadcastChannels, the URL-hash router's
 * window.location reads, the editor-pack registry's promise cache).
 *
 * The `Construction` lucide icon is bundled into the pack — it's
 * presentational with no singleton dependency.
 *
 * View lifecycle
 * ──────────────
 *
 * Identical to the pre-P4 behaviour:
 *   1. Register the SceneTopBarSlot into the tab-row right slot.
 *   2. Wait for `useEditorPacksLoaded()` to flip true — the default
 *      layout references pack-contributed panel ids; mounting
 *      dockview before the pack scripts have run would crash the
 *      deserializer.
 *   3. Mount the WorkspaceRail + DockShell with the pack-contributed
 *      default layout + the merged panel registry.
 *
 * Default layout JSON lives in `../layouts/scene-default.ts` — split
 * from this file so the JSON can be inspected / unit-tested separately
 * from the view component itself.
 */
export interface MapViewProps {
  /** Widened — kept for compatibility with the shell-side ViewComponent
   *  signature, but no required props for now. */
  [key: string]: unknown;
}

export function MapView(_props: MapViewProps = {}): React.JSX.Element {
  const [route] = useRoute();
  const projectId = route.projectId ?? "no-project";

  // Stable reference — passing a new JSX element each render would
  // thrash the slot effect's deps.
  const topBarSlot = React.useMemo(() => <SceneTopBarSlot />, []);
  useTabContextSlot(topBarSlot);

  // Editor-pack contributions — fetched async on mount, merged into
  // the live panel registry once loaded. The view itself is contributed
  // by a pack now, but the panels still flow through this hook so a
  // third-party pack can add panels alongside the core pack's.
  const editorPackPanels = useEditorPackPanels();

  // Gate the DockShell mount on the editor-pack load.
  const packsLoaded = useEditorPacksLoaded();

  // Guard rail: if for some reason there's no project, render an
  // empty state rather than mount a dock shell with no persistence key.
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

  // Shared dockview api ref — Workspace rail's Layouts + Docks modals
  // call api.fromJSON / api.toJSON / api.addPanel against the same
  // instance DockShell creates.
  const apiRef = React.useRef<DockviewApi | null>(null);

  // Pre-load splash — the default layout's panel ids resolve to
  // pack-contributed components that aren't in the registry until
  // `loadEditorPacks()` resolves.
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
        pageId="scene"
        storageKey={storageKey}
        apiRef={apiRef}
        registry={editorPackPanels}
      />
      <div className="flex-1 min-w-0 h-full">
        <DockShell
          storageKey={storageKey}
          panels={editorPackPanels}
          defaultLayout={SCENE_DEFAULT_LAYOUT}
          apiRef={apiRef}
        />
      </div>
    </div>
  );
}

export default MapView;

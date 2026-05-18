import React from "react";
import {
  FolderOpen,
  Palette,
  AudioLines,
  LayoutPanelTop,
} from "lucide-react";
import { useRoute, buildHash } from "../lib/router";
import {
  EditorProjectStore,
  type ProjectMeta,
  type AssetMeta,
} from "../lib/EditorProjectStore";
import type { PackManifest } from "@two_5_d/engine";
import { HomeScreen } from "../views/HomeScreen";
import { ProjectView, type WorkflowMode } from "../views/ProjectView";
import { MapView } from "../views/MapView";
import { ProjectTabView } from "../views/project/ProjectTabView";
import { AssetsView } from "../views/AssetsView";
import { SET_TAB_EVENT, type SetTabEventDetail } from "../views/AssetsView";
import { ScriptsView } from "../views/ScriptsView";
import { ComponentsView } from "../views/ComponentsView";
import { EditorSettingsModal } from "../views/EditorSettingsModal";
import { EmptyState } from "../components/ui/EmptyState";
import { StatusBarProvider } from "./StatusBarContext";
import { StatusBar } from "./StatusBar";
import { TopBar } from "./TopBar";
import {
  EditorActionsProvider,
  useEditorActions,
  useEditorActionsState,
} from "./EditorActionsContext";
import { ActiveSceneProvider } from "./ActiveSceneContext";
import {
  PrimaryTabs,
  PRIMARY_TAB_ORDER,
  readPersistedTab,
  writePersistedTab,
  type PrimaryTabId,
} from "./PrimaryTabs";
import { TabContextSlotProvider } from "../lib/tabContextSlot";

/**
 * localStorage mirror of the current project id, used as a fallback
 * when the URL has no `#/p/<id>` segment. The URL hash is the source
 * of truth — this exists purely so a fresh load with a bare `#/`
 * doesn't lose the project the user was last working on. When set we
 * rewrite the hash to `#/p/<id>` on mount, which then drives the rest
 * of the state.
 */
const CURRENT_PROJECT_KEY = "editor.currentProjectId";

function readPersistedProject(): string | null {
  try {
    return localStorage.getItem(CURRENT_PROJECT_KEY);
  } catch {
    return null;
  }
}

function writePersistedProject(projectId: string | null): void {
  try {
    if (projectId) localStorage.setItem(CURRENT_PROJECT_KEY, projectId);
    else localStorage.removeItem(CURRENT_PROJECT_KEY);
  } catch {
    // ignore
  }
}

function isPrimaryTabId(value: string | null): value is PrimaryTabId {
  return (
    value !== null &&
    (PRIMARY_TAB_ORDER as ReadonlyArray<string>).includes(value)
  );
}

/**
 * EditorShell — the chrome that wraps every editor view.
 *
 * Composition (top → bottom):
 *
 *     <TopBar/>            // brand + actions (scene picker moved to tab strip)
 *     <PrimaryTabs/>       // 10-tab strip (Home / Scene / … / Project)
 *     <body>               // flex-1 region — current tab's view
 *     <StatusBar/>          // per-view status sections
 *
 * R3 ships the chrome; the body regions for Scene / Prefabs / Animation
 * / Scripts / Project still render the existing `ProjectView`
 * unchanged. R4 sub-phases re-skin those views and remove ProjectView's
 * internal workflow tab strip (which currently visually duplicates the
 * shell's PrimaryTabs — accepted R3 state per the brief).
 *
 * Tab semantics:
 *   - `home`: renders HomeScreen, regardless of whether a project is
 *     open. Selecting it from a project view navigates back to `#/`.
 *   - `assets`, `imageLab`, `soundLab`, `uiBuilder`: render an
 *     EmptyState — content lands in R4.
 *   - all other tabs: render ProjectView. The shell writes the inner
 *     `cardboard_editor_workflow_mode_<projectId>` localStorage key so
 *     ProjectView mounts in the matching internal mode, then uses
 *     `key={mode}` to force a remount whenever the shell flips a tab.
 */

const PROJECT_WORKFLOW_TABS: ReadonlyArray<PrimaryTabId> = [
  "scene",
  "prefabs",
  "animation",
  // R4e promoted `scripts` out — it renders its own top-level
  // ScriptsView with a Monaco-backed editor (lazy-loaded).
];

/** Tabs that have an actual implementation today. Other project-
 *  scoped tabs render an EmptyState. R4f promoted `project` out of
 *  this list — see `ProjectTabView`. R4g promoted `assets` out — see
 *  `AssetsView`. */
const PROJECT_PLACEHOLDER_TABS: ReadonlyArray<PrimaryTabId> = [
  "imageLab",
  "soundLab",
  "uiBuilder",
];

export function EditorShell() {
  const [route, navigate] = useRoute();

  // Track whether we've finished the first-mount hydration so the
  // mirror effect below doesn't clobber the persisted value before
  // hydration has had a chance to run.
  const hydratedRef = React.useRef(false);

  // Hydrate the URL hash from the localStorage mirror on first mount
  // if the user landed on a bare `#/` but we have a previously
  // remembered project. This lets the back-to-home action carry the
  // current project across reloads even when the user manually clears
  // the hash. Hash → state is the source of truth from here on.
  React.useEffect(() => {
    if (typeof window === "undefined") {
      hydratedRef.current = true;
      return;
    }
    if (!route.projectId) {
      const persisted = readPersistedProject();
      if (persisted) {
        navigate(buildHash(persisted, null));
      }
    }
    hydratedRef.current = true;
    // Only run on initial mount — the hash-driven effects below
    // handle every subsequent reconciliation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Mirror the route's projectId into localStorage so a stripped hash
  // can re-hydrate on reload. Skipped until after first-mount
  // hydration so we never wipe the persisted value before reading it.
  React.useEffect(() => {
    if (!hydratedRef.current) return;
    writePersistedProject(route.projectId);
  }, [route.projectId]);

  // Derive the active tab from the route. A null tab segment means
  // we're on Home — either project-less (`#/`) or project-scoped
  // (`#/p/<id>`). Both render HomeScreen. Otherwise the tab segment
  // is narrowed to `PrimaryTabId`; invalid values collapse to "scene"
  // (the workflow default) when a project is open, or "home" when not.
  const tab: PrimaryTabId = React.useMemo(() => {
    if (route.tab === null) return "home";
    if (isPrimaryTabId(route.tab)) return route.tab;
    return route.projectId ? "scene" : "home";
  }, [route.projectId, route.tab]);

  // Whenever the resolved tab changes, mirror it to the legacy
  // workflow-mode localStorage key so a fresh-tab open with no hash
  // can still rehydrate to the user's last view (via the hash-
  // hydration effect above + the persisted project + this tab cache).
  React.useEffect(() => {
    writePersistedTab(tab);
  }, [tab]);

  const setTab = React.useCallback(
    (next: PrimaryTabId) => {
      // Home tab clicked from anywhere → drop the tab segment but
      // keep the project segment so Home shows the current project
      // highlighted and subsequent tab clicks re-enter it.
      if (next === "home") {
        navigate(buildHash(route.projectId, null));
        return;
      }
      // Non-Home tabs only make sense with an open project. Without
      // one we no-op — PrimaryTabs already disables them via its
      // `hasProject` prop, this guard is defence in depth.
      if (!route.projectId) return;
      navigate(buildHash(route.projectId, next));
    },
    [navigate, route.projectId],
  );

  // If the hash ever points at a non-Home tab without a project id
  // (impossible via PrimaryTabs but reachable via manual URL editing)
  // strip the tab so the shell falls back to the project-less Home.
  React.useEffect(() => {
    if (!route.projectId && route.tab !== null) {
      navigate("#/");
    }
  }, [route.projectId, route.tab, navigate]);

  // Cross-tab navigation event. Any view can dispatch
  // `cardboard:set-tab` to ask the shell to switch tabs (and
  // optionally surface an `assetId` the new view can pick up).
  // Used by AssetsView's click flow (R4g) and reserved for future
  // deep-link patterns.
  React.useEffect(() => {
    function onSetTab(e: Event) {
      const ce = e as CustomEvent<SetTabEventDetail>;
      const detail = ce.detail;
      if (!detail || !detail.tab) return;
      setTab(detail.tab);
      // WIRING: when the destination view exists (R4d/R4e/labs) it
      // should consume `detail.assetId` to auto-open the target.
      // For now we stash it on a globally-readable property so
      // late-mounting views can find it on next render.
      if (detail.assetId) {
        try {
          (window as unknown as { __cardboardPendingAssetId?: string })
            .__cardboardPendingAssetId = detail.assetId;
        } catch {
          // ignore
        }
      }
    }
    window.addEventListener(SET_TAB_EVENT, onSetTab);
    return () => window.removeEventListener(SET_TAB_EVENT, onSetTab);
  }, [setTab]);

  // ── Project metadata + manifest. Surfaced to views via the
  // ActiveSceneProvider (scene list + fallbackScene) so the per-tab
  // contextual right slot (where the Scene picker now lives) can build
  // itself from a single source of truth. The TopBar's project
  // dropdown was removed (§12 Q9 reversed) — the Home tab is the only
  // project switcher — so the shell no longer needs a `projects` list.
  const projectId = route.projectId;
  const [meta, setMeta] = React.useState<ProjectMeta | null>(null);
  const [manifest, setManifest] = React.useState<PackManifest | null>(null);
  const [assets, setAssets] = React.useState<AssetMeta[]>([]);
  const [refreshTick, setRefreshTick] = React.useState(0);

  React.useEffect(() => {
    if (!projectId) {
      setMeta(null);
      setManifest(null);
      setAssets([]);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const [m, mf, as] = await Promise.all([
          EditorProjectStore.getProject(projectId),
          EditorProjectStore.loadManifest(projectId),
          EditorProjectStore.listAssets(projectId),
        ]);
        if (cancelled) return;
        setMeta(m);
        setManifest(mf);
        setAssets(as);
      } catch {
        // ignore
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [projectId, refreshTick]);

  // Scene picker derived from the project's `scenes/*.json` assets.
  const scenes = React.useMemo(
    () =>
      assets
        .filter((a) => a.path.startsWith("scenes/"))
        .map((a) => ({
          path: a.path,
          label: a.path.replace(/^scenes\//, ""),
        })),
    [assets],
  );

  // Active scene state lives in `<ActiveSceneProvider/>` (mounted
  // below). The provider persists per-project under
  // `cardboard_editor_active_scene_<projectId>` and exposes a setter
  // any view (or the Scene picker registered into the tab-row right
  // slot) calls. The fallback when no scene has been pinned is
  // `manifest?.startScene` — surfaced to consumers via the provider's
  // `fallbackScene` value.
  const fallbackScene = manifest?.startScene ?? null;

  // Persist the active workflow tab per-project so the next session
  // lands on the same view. ProjectView no longer reads this key
  // directly — the shell now passes `workflowMode` as a controlled
  // prop (see ShellBody). This write is purely a preference cache.
  React.useEffect(() => {
    if (!projectId) return;
    if (!PROJECT_WORKFLOW_TABS.includes(tab)) return;
    try {
      localStorage.setItem(
        `cardboard_editor_workflow_mode_${projectId}`,
        tab,
      );
    } catch {
      // ignore
    }
  }, [projectId, tab]);

  // One-time migration of the per-project workflow-mode localStorage
  // value when the project loads. The Map → Scene + Entities → Prefabs
  // tab renames changed the persisted vocabulary; existing user state
  // still contains the old strings. We rewrite stale values in place
  // so the next read (and the persisted-tab default after a reload)
  // picks up the new identifiers. Idempotent — once migrated the
  // stored value matches the new vocab and this is a no-op.
  React.useEffect(() => {
    if (!projectId) return;
    try {
      const key = `cardboard_editor_workflow_mode_${projectId}`;
      const raw = localStorage.getItem(key);
      if (raw === "map") localStorage.setItem(key, "scene");
      else if (raw === "entities") localStorage.setItem(key, "prefabs");
    } catch {
      // ignore
    }
  }, [projectId]);

  // Settings modal (cog).
  const [settingsOpen, setSettingsOpen] = React.useState(false);

  const projectName = meta?.name ?? "";
  const hasProject = projectId !== null && meta !== null;

  return (
    <StatusBarProvider>
      <EditorActionsProvider>
        <ActiveSceneProvider
          projectId={projectId}
          scenes={scenes}
          fallbackScene={fallbackScene}
        >
          {/* TabContextSlotProvider mounts above BOTH PrimaryTabs (which
              reads the slot) and the active view (which writes to it
              via `useTabContextSlot`). The Scene picker used to sit in
              the TopBar; now MapView registers it here so it lives in
              the right edge of the tab strip with whatever tab is
              active driving its visibility. */}
          <TabContextSlotProvider>
            <ShellChrome
              projectName={projectName}
              tab={tab}
              setTab={setTab}
              hasProject={hasProject}
              projectId={projectId}
              onOpenProject={(id) => {
                // Picking a project from Home lands the user on Scene
                // (the canonical workflow entry) and stamps the hash
                // with both segments so reload/back/forward all work.
                navigate(buildHash(id, "scene"));
                setRefreshTick((n) => n + 1);
              }}
              onProjectMutated={() => setRefreshTick((n) => n + 1)}
              // "Back to Home" preserves the current project segment so
              // Home highlights it and subsequent tab clicks re-enter
              // the same project without re-picking.
              onNavigateHome={() => navigate(buildHash(projectId, null))}
              onOpenSettings={() => setSettingsOpen(true)}
            />
          </TabContextSlotProvider>
          <EditorSettingsModal
            open={settingsOpen}
            onClose={() => setSettingsOpen(false)}
          />
        </ActiveSceneProvider>
      </EditorActionsProvider>
    </StatusBarProvider>
  );
}

interface ShellChromeProps {
  projectName: string;
  tab: PrimaryTabId;
  setTab: (next: PrimaryTabId) => void;
  hasProject: boolean;
  projectId: string | null;
  onOpenProject: (id: string) => void;
  onProjectMutated: () => void;
  onNavigateHome: () => void;
  onOpenSettings: () => void;
}

/**
 * ShellChrome — the visible shell (TopBar + Tabs + body + StatusBar).
 *
 * Split out from `EditorShell` so it can read the action registry
 * (`useEditorActionsState`) and register the default Save handler
 * (`useEditorActions`) — both require being inside the provider.
 */
function ShellChrome({
  projectName,
  tab,
  setTab,
  hasProject,
  projectId,
  onOpenProject,
  onProjectMutated,
  onNavigateHome,
  onOpenSettings,
}: ShellChromeProps) {
  // Scene picker no longer lives in the TopBar — views read the scene
  // list + active scene from `<ActiveSceneProvider/>` and register a
  // picker into the tab-row right slot via `useTabContextSlot`.
  // Register a default Save handler at the shell level so the legacy
  // ProjectView path (which binds Ctrl+S internally for the GridEditor
  // auto-save loop and EntitiesEditor) keeps working until R4f
  // migrates ProjectView to register its own real Save handler.
  // R4f removes this shim.
  const { register } = useEditorActions();
  React.useEffect(() => {
    return register({
      save: () => {
        const event = new KeyboardEvent("keydown", {
          key: "s",
          code: "KeyS",
          keyCode: 83,
          ctrlKey: true,
          metaKey: true,
          bubbles: true,
          cancelable: true,
        });
        window.dispatchEvent(event);
      },
    });
  }, [register]);

  const actions = useEditorActionsState();

  // Wrap the raw handlers so TopBar's onSave/onExport are non-optional
  // functions; when no handler is registered, TopBar disables the
  // button via the `*Available` flags below and these wrappers are
  // never invoked.
  const handleSave = React.useCallback(() => {
    void actions.save?.();
  }, [actions]);
  const handleExport = React.useCallback(() => {
    void actions.export?.();
  }, [actions]);
  const handleTogglePlaytest = React.useCallback(() => {
    if (actions.playtestStop) actions.playtestStop();
    else if (actions.playtestStart) actions.playtestStart();
  }, [actions]);

  return (
    <div className="flex flex-col h-screen min-h-screen bg-(--color-bg-app) text-zinc-100">
      <TopBar
        saveState="saved"
        onSave={handleSave}
        saveAvailable={typeof actions.save === "function"}
        onExport={handleExport}
        exportAvailable={typeof actions.export === "function"}
        onTogglePlaytest={handleTogglePlaytest}
        playtestDisabled={
          !actions.playtestStart && !actions.playtestStop
        }
        // MapView registers `playtestStop` while playtest is active
        // and `playtestStart` when inactive — exactly one is present
        // at any time. The TopBar uses this to flip the button's
        // visual state (Play → Stop, amber → red).
        playtestActive={typeof actions.playtestStop === "function"}
        onOpenSettings={onOpenSettings}
      />
      <PrimaryTabs value={tab} onChange={setTab} hasProject={hasProject} />
      <main className="flex-1 min-h-0 overflow-hidden bg-(--color-bg-panel)">
        <ShellBody
          tab={tab}
          projectId={projectId}
          onOpenProject={onOpenProject}
          onProjectMutated={onProjectMutated}
          onNavigateHome={onNavigateHome}
        />
      </main>
      {/* `projectId` is intentionally threaded through ShellBody so
          HomeScreen can read it as `currentProjectId` and highlight
          the active project even when rendered without a tab segment. */}
      <StatusBar projectName={projectName || undefined} />
    </div>
  );
}

interface ShellBodyProps {
  tab: PrimaryTabId;
  projectId: string | null;
  onOpenProject: (id: string) => void;
  onProjectMutated: () => void;
  onNavigateHome: () => void;
}

function ShellBody({
  tab,
  projectId,
  onOpenProject,
  onNavigateHome,
}: ShellBodyProps) {
  // Home: always rendered as-is. HomeScreen lists every project and
  // lets the user open one. When `projectId` is set (route is
  // `#/p/<id>` with no tab segment) Home highlights that project so
  // the user can see which one they'll re-enter when picking a
  // workflow tab.
  if (tab === "home") {
    return (
      <div className="h-full overflow-auto">
        <HomeScreen
          onOpenProject={onOpenProject}
          currentProjectId={projectId}
        />
      </div>
    );
  }

  // Every other tab needs an open project. If none, render an empty
  // state that nudges the user back to Home.
  if (!projectId) {
    return (
      <div className="h-full flex items-center justify-center">
        <EmptyState
          icon={<FolderOpen size={28} />}
          title="No project open"
          description="Choose a project from the Home tab to work in this view."
          action={
            <button
              onClick={onNavigateHome}
              className="inline-flex items-center justify-center rounded-md bg-amber-500 text-zinc-950 hover:bg-amber-400 h-8 px-3 text-xs font-medium"
            >
              Go to Home
            </button>
          }
        />
      </div>
    );
  }

  if (PROJECT_PLACEHOLDER_TABS.includes(tab)) {
    const meta = PLACEHOLDER_COPY[tab as keyof typeof PLACEHOLDER_COPY];
    return (
      <div className="h-full flex items-center justify-center">
        <EmptyState
          icon={meta.icon}
          title={meta.title}
          description={meta.description}
        />
      </div>
    );
  }

  // R4f: Project tab renders the new top-level surface, not ProjectView.
  if (tab === "project") {
    return (
      <div className="h-full overflow-hidden">
        <ProjectTabView key={`project::${projectId}`} projectId={projectId} />
      </div>
    );
  }

  // R4g: Assets tab renders the new asset browser.
  if (tab === "assets") {
    return (
      <div className="h-full overflow-hidden">
        <AssetsView key={`assets::${projectId}`} projectId={projectId} />
      </div>
    );
  }

  // R4e: Scripts tab renders the Monaco-backed script editor.
  // The Monaco bundle itself lazy-loads on first mount; this thin
  // wrapper is in the main bundle.
  if (tab === "scripts") {
    return (
      <div className="h-full overflow-hidden">
        <ScriptsView key={`scripts::${projectId}`} projectId={projectId} />
      </div>
    );
  }

  // Components tab — the Component Builder where users author
  // manifest.components[] schemas. Stubbed for now; see
  // docs/EDITOR_DESIGN_INVENTORY.md §1 (Component Builder).
  if (tab === "components") {
    return (
      <div className="h-full overflow-hidden">
        <ComponentsView
          key={`components::${projectId}`}
          projectId={projectId}
        />
      </div>
    );
  }

  // Scene tab routes to MapView so the view can register the Scene
  // picker into the tab strip's per-tab right slot. MapView is a stub
  // today; subsequent waves rebuild it from the Map.png mockup.
  if (tab === "scene") {
    return (
      <div className="h-full overflow-hidden">
        <MapView key={`scene::${projectId}`} />
      </div>
    );
  }

  // Real project-workflow tabs: Prefabs / Animation.
  // ProjectView is the existing monolith that switches its body based
  // on the `workflowMode` prop we feed in here. We keep `key={projectId}`
  // so opening a different project still cleanly remounts the view
  // (and its iframe/asset state), but the workflow-mode tab change no
  // longer triggers a remount — the prop simply updates.
  return (
    <div className="h-full overflow-hidden">
      <ProjectView
        key={projectId}
        projectId={projectId}
        workflowMode={tab as WorkflowMode}
        onBackHome={onNavigateHome}
      />
    </div>
  );
}

const PLACEHOLDER_COPY: Record<
  "imageLab" | "soundLab" | "uiBuilder",
  {
    icon: React.ReactNode;
    title: string;
    description: string;
  }
> = {
  imageLab: {
    icon: <Palette size={28} />,
    title: "Image Lab — coming soon",
    description:
      "Procedural image generation for tiles, sprites, and skyboxes. See docs/plans/IMAGE_LAB.md (in design now).",
  },
  soundLab: {
    icon: <AudioLines size={28} />,
    title: "Sound Lab — coming soon",
    description:
      "Procedural sound and music generation: SFX synthesis, music patterns, ambient beds. See docs/plans/SOUND_LAB.md (in design now).",
  },
  uiBuilder: {
    icon: <LayoutPanelTop size={28} />,
    title: "UI Builder — coming soon",
    description:
      "Visual editor for pack UI. Drag-drop builder outputs structured JSON trees that the engine renders at runtime. See #212.",
  },
};

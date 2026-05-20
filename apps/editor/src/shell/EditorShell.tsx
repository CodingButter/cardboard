import React from "react";
import { FolderOpen } from "lucide-react";
import { useRoute, buildHash } from "../lib/router";
import { resolveSceneLabel } from "../lib/sceneLabel";
import {
  EditorProjectStore,
  type ProjectMeta,
  type AssetMeta,
} from "../lib/EditorProjectStore";
import type { PackManifest } from "@two_5_d/engine";
// P5b — every shell-side view migrated into the core-editor-pack. The
// shell-side imports for HomeScreen / ProjectView / ProjectTabView /
// AssetsView / ScriptsView / ComponentsView are gone; their views are
// now resolved through the pack-contributed view registry. SET_TAB_EVENT
// + SetTabEventDetail (formerly defined inside AssetsView) moved into
// the shell SDK at `../packs/shellEvents.ts` so any pack can dispatch
// a tab-switch.
import { SET_TAB_EVENT, type SetTabEventDetail } from "../packs/shellEvents";
import { EditorSettingsModal } from "../views/EditorSettingsModal";
import { EmptyState } from "../components/ui/EmptyState";
import { Tooltip } from "../components/ui/Tooltip";
import { StatusBarProvider } from "./StatusBarContext";
import { TopBar } from "./TopBar";
import {
  EditorActionsProvider,
  useEditorActions,
  useEditorActionsState,
} from "./EditorActionsContext";
import { ActiveSceneProvider } from "./ActiveSceneContext";
import {
  PrimaryTabs,
  readPersistedTab,
  writePersistedTab,
  type PrimaryTabId,
} from "./PrimaryTabs";
import { TabContextSlotProvider } from "../lib/tabContextSlot";
import { CommandPalette, usePaletteUI } from "../components/palette/CommandPalette";
import {
  useCommandStore,
  registerCommand,
} from "../state/useCommandStore";
import { registerSetting } from "../state/useSettingsStore";
import { useFileIndex, classifyAssetPath } from "../state/useFileIndex";
import { hydrateStoresFromIdb } from "../state/hydration";
import { matchKeybinding } from "../lib/keybinding";
import {
  useRegisteredTabs,
  useTabRegistryStore,
} from "../state/useTabRegistryStore";
import { useRegisteredView } from "../state/useViewRegistryStore";
import { loadEditorPacks } from "../packs/editorPackLoader";

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

/** Narrow a hash-segment string to a registered tab id. Reads the
 *  live tab registry so a pack disabling itself collapses unknown
 *  segments to the appropriate fallback (home / scene). */
function isRegisteredTabId(value: string | null): value is PrimaryTabId {
  if (value === null) return false;
  const tabs = useTabRegistryStore.getState().tabs;
  return value in tabs;
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

/** Tabs that persist a `cardboard_editor_workflow_mode_<projectId>`
 *  localStorage key so a fresh-tab open with no hash can rehydrate to
 *  the user's last workflow tab. Strictly a preference cache — the
 *  shell no longer renders a ProjectView body off this list (every
 *  workflow view comes from the pack-contributed view registry). */
const PROJECT_WORKFLOW_TABS: ReadonlyArray<PrimaryTabId> = [
  "scene",
  "prefabs",
  "animation",
  "scripts",
];

export function EditorShell() {
  const [route, navigate] = useRoute();

  // P4 — kick off the editor-pack load at shell mount. Post-P4 the
  // top-level tab strip, every view, and every panel is pack-
  // contributed; the shell renders an empty strip + an empty body
  // until `loadEditorPacks()` resolves. Triggering the load here
  // (rather than inside individual views like the pre-P4 shell did)
  // is mandatory — there are no shell-side views left that could
  // trigger it before the registry-driven routing decides what to
  // render.
  React.useEffect(() => {
    void loadEditorPacks();
  }, []);

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

  // Subscribe to the tab registry so the active-tab fallback
  // re-resolves when packs (re)register their tab contributions on
  // mount. Without this, the very first render after pack load would
  // still see the empty registry from before the script ran.
  const registeredTabs = useRegisteredTabs();
  const registeredTabIds = React.useMemo(
    () => new Set(registeredTabs.map((t) => t.id)),
    [registeredTabs],
  );

  // Derive the active tab from the route. A null tab segment means
  // we're on Home — either project-less (`#/`) or project-scoped
  // (`#/p/<id>`). Both render HomeScreen. Otherwise the tab segment
  // is narrowed to a registered tab id; unrecognised segments collapse
  // to "scene" when a project is open, "home" when not.
  const tab: PrimaryTabId = React.useMemo(() => {
    if (route.tab === null) return "home";
    if (registeredTabIds.has(route.tab)) return route.tab as PrimaryTabId;
    return route.projectId ? "scene" : "home";
  }, [route.projectId, route.tab, registeredTabIds]);

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

  // Sync the file index store as assets change so the command palette
  // can drive its file-mode search off a single in-memory source. The
  // palette doesn't re-fetch from IDB on every keystroke — we mirror
  // the list once per project change here.
  const setFileIndex = useFileIndex((s) => s.setFiles);
  React.useEffect(() => {
    setFileIndex(
      assets.map((a) => ({
        id: a.path,
        path: a.path,
        type: classifyAssetPath(a.path),
      })),
    );
  }, [assets, setFileIndex]);

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

  // P0 fix: pull scene + layer + tile-preset slices out of IDB into
  // the wave-3 Zustand stores whenever the project changes (or the
  // shell's refresh tick advances after an import). Without this,
  // panels that migrated off MOCK_ fixtures (MapCanvas, LayersPanel,
  // TilePresetPanel, SceneSettingsPanel, MinimapPanel, PreviewPanel)
  // render empty because pack-load writes only to IDB and nothing
  // bridges back. See `apps/editor/src/state/hydration.ts` for the
  // helper's responsibilities + deferred items (IDB write-back is NOT
  // part of this pass).
  React.useEffect(() => {
    if (!projectId) return;
    let cancelled = false;
    (async () => {
      try {
        await hydrateStoresFromIdb(projectId);
        if (cancelled) return;
      } catch (err) {
        // Log and swallow — a single bad scene shouldn't poison the
        // shell. Panels fall back to their initial Zustand state.
        // eslint-disable-next-line no-console
        console.error("[EditorShell] hydrateStoresFromIdb failed", err);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [projectId, refreshTick]);

  // Scene picker derived from the project's `scenes/*.json` assets.
  // The display label resolves from two sources, checked in order:
  //   1. The scene JSON's `name` field, if present and non-empty.
  //   2. The filename, derived via resolveSceneLabel (strips
  //      `scenes/` + `.json`, splits on `_`/`-`, title-cases each
  //      word). Loaded lazily in the effect below.
  const [sceneNames, setSceneNames] = React.useState<Record<string, string>>(
    {},
  );

  // Paths of scene assets currently in the project — stable reference
  // we feed into the JSON-loading effect's deps without triggering on
  // unrelated `assets` changes.
  const scenePaths = React.useMemo(
    () =>
      assets.filter((a) => a.path.startsWith("scenes/")).map((a) => a.path),
    [assets],
  );

  // Read each scene's JSON, extract `.name`, cache it. Re-runs only
  // when the list of scene paths changes (not on unrelated asset
  // mutations). Cancellation flag guards against late writes after
  // the project / scene list changed mid-load.
  React.useEffect(() => {
    if (!projectId || scenePaths.length === 0) {
      setSceneNames({});
      return;
    }
    let cancelled = false;
    (async () => {
      const next: Record<string, string> = {};
      for (const path of scenePaths) {
        try {
          const body = await EditorProjectStore.loadAsset(projectId, path);
          if (typeof body !== "string") continue;
          const parsed = JSON.parse(body);
          const name = parsed?.name;
          if (typeof name === "string" && name.trim()) {
            next[path] = name.trim();
          }
        } catch {
          // Malformed JSON or missing — fall through to filename
          // derivation in `scenes` below.
        }
      }
      if (!cancelled) setSceneNames(next);
    })();
    return () => {
      cancelled = true;
    };
  }, [projectId, scenePaths]);

  const scenes = React.useMemo(
    () =>
      scenePaths.map((path) => ({
        path,
        label: resolveSceneLabel(path, sceneNames[path]),
      })),
    [scenePaths, sceneNames],
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

  // `hasProject` gates the tab strip (non-Home tabs are disabled when
  // no project is open). The TopBar no longer reads the project name —
  // any pack-shipped chrome that wants the project label reads `meta`
  // directly through `EditorProjectStore`.
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
            <CommandPalette />
            <ShellChrome
              tab={tab}
              setTab={setTab}
              hasProject={hasProject}
              projectId={projectId}
              onOpenProject={(id) => {
                // Picking a project from Home (or via the palette's
                // dynamic `homescreen.openProject.<id>` entries) lands
                // the user on Scene (the canonical workflow entry) and
                // stamps the hash with both segments so reload/back/
                // forward all work. Also nudges the project-metadata
                // refresh tick so the new project's manifest +
                // scene list reload promptly.
                navigate(buildHash(id, "scene"));
                setRefreshTick((n) => n + 1);
              }}
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
  tab: PrimaryTabId;
  setTab: (next: PrimaryTabId) => void;
  hasProject: boolean;
  projectId: string | null;
  /** Closes over a `navigate(buildHash(id, "scene"))` call — surfaced
   *  through ShellChrome so the dynamic `homescreen.openProject.<id>`
   *  palette commands stay reachable from any tab. */
  onOpenProject: (id: string) => void;
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
  tab,
  setTab,
  hasProject,
  projectId,
  onOpenProject,
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

  // ── Navigation commands. One per primary tab; their `run` handlers
  // close over the live `setTab` setter. Disabled tabs (no open
  // project) still register so the palette can SHOW them.
  //
  // P4 sources the tab list from `useRegisteredTabs()` (pack-contributed)
  // rather than the legacy static PRIMARY_TABS array. Re-registers
  // whenever the registry changes so a pack toggling its tabs in/out
  // flips the navigation commands too.
  const tabs = useRegisteredTabs();
  const setTabRef = React.useRef(setTab);
  React.useEffect(() => {
    setTabRef.current = setTab;
  }, [setTab]);
  React.useEffect(() => {
    const unregs = tabs.map((t) =>
      registerCommand({
        id: `navigation.open${t.id.charAt(0).toUpperCase()}${t.id.slice(1)}`,
        title: `Go to ${t.label}`,
        category: "Navigation",
        keywords: [t.id, t.label, "tab", "open"],
        run: () => setTabRef.current(t.id),
      }),
    );
    return () => unregs.forEach((u) => u());
  }, [tabs]);

  // ── Demo setting registration. `editor.userInitials` already flows
  // through TopBar as a prop; register it here so the settings store
  // owns the canonical default + scope.
  React.useEffect(() => {
    return registerSetting<string>({
      id: "editor.userInitials",
      title: "User initials",
      category: "Account",
      description: "Two-letter monogram shown in the user avatar chip.",
      type: "string",
      default: "JD",
      scope: "global",
    });
  }, []);

  // ── Shell-level Home commands. These are always discoverable in the
  // palette (regardless of which tab is active) because the shell is
  // mounted for the entire session. Each `run` first navigates to Home
  // and then triggers the corresponding action via a custom event the
  // HomeScreen subscribes to. This pattern works for any "open this
  // modal that lives in a particular view" command — the shell does
  // the navigation, the view handles the action.
  const navigateHomeRef = React.useRef(() => {
    if (typeof window !== "undefined") {
      window.location.hash = "#/";
    }
  });
  React.useEffect(() => {
    const fireOnHome = (eventName: string) => {
      navigateHomeRef.current();
      // Defer one frame so HomeScreen has mounted (and registered its
      // listener) by the time we dispatch.
      requestAnimationFrame(() => {
        window.dispatchEvent(new CustomEvent(eventName));
      });
    };
    const unregs = [
      registerCommand({
        id: "homescreen.newProject",
        title: "New Project",
        category: "File",
        keywords: ["new", "create", "project", "scaffold", "start"],
        run: () => fireOnHome("cardboard:home-new-project"),
      }),
      registerCommand({
        id: "homescreen.openUrlPack",
        title: "Open Pack from URL",
        category: "File",
        keywords: ["open", "url", "import", "pack", "fetch", "remote"],
        run: () => fireOnHome("cardboard:home-open-url-pack"),
      }),
    ];
    return () => unregs.forEach((u) => u());
  }, []);

  // ── Shell-level dynamic project-list commands. We load the project
  // list once at the shell so `homescreen.openProject.<id>` palette
  // entries are available from any tab — not just Home. The list
  // refreshes whenever the shell hears a `cardboard:projects-changed`
  // event (HomeScreen dispatches this on create/rename/delete).
  const [allProjects, setAllProjects] = React.useState<ProjectMeta[]>([]);
  const onOpenProjectRef = React.useRef(onOpenProject);
  React.useEffect(() => {
    onOpenProjectRef.current = onOpenProject;
  }, [onOpenProject]);

  React.useEffect(() => {
    let cancelled = false;
    const refresh = async () => {
      try {
        const list = await EditorProjectStore.listProjects();
        if (!cancelled) setAllProjects(list);
      } catch {
        // ignore — empty list is a fine fallback
      }
    };
    void refresh();
    const onChanged = () => void refresh();
    window.addEventListener("cardboard:projects-changed", onChanged);
    return () => {
      cancelled = true;
      window.removeEventListener("cardboard:projects-changed", onChanged);
    };
  }, []);

  React.useEffect(() => {
    const unregs = allProjects.map((p) =>
      registerCommand({
        id: `homescreen.openProject.${p.id}`,
        title: `Open Project: ${p.name}`,
        category: "File",
        keywords: ["open", "project", p.name, p.id],
        run: () => onOpenProjectRef.current(p.id),
      }),
    );
    return () => unregs.forEach((u) => u());
  }, [allProjects]);

  // ── Global keyboard handler. Mounts at the window level so a focus
  // anywhere in the editor can still reach the palette. Keybindings
  // attached to registered commands are wired automatically — each
  // command's `keybinding` string is parsed and matched against every
  // keydown.
  const openPalette = usePaletteUI((s) => s.openPalette);
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Don't swallow keys while the user is typing in a real input
      // EXCEPT for the palette keybindings themselves and any
      // explicitly-registered command keybindings that include a
      // modifier (Ctrl/Cmd/Alt) — those are intentional global
      // shortcuts and should still fire from inside an input.
      const target = e.target as HTMLElement | null;
      const inEditable =
        !!target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          (target as HTMLElement).isContentEditable);

      // Palette open shortcuts.
      if (matchKeybinding(e, "Ctrl+Shift+P")) {
        e.preventDefault();
        e.stopPropagation();
        openPalette("command");
        return;
      }
      if (matchKeybinding(e, "Ctrl+P")) {
        e.preventDefault();
        e.stopPropagation();
        openPalette("file");
        return;
      }

      // Walk registered commands' keybindings. A modifier is required
      // when firing from inside an editable element to avoid hijacking
      // plain letter keys mid-typing.
      const commands = useCommandStore.getState().commands;
      for (const cmd of Object.values(commands)) {
        if (!cmd.keybinding) continue;
        if (!matchKeybinding(e, cmd.keybinding)) continue;
        const hasModifier =
          e.ctrlKey || e.metaKey || e.altKey || e.shiftKey;
        if (inEditable && !hasModifier) continue;
        e.preventDefault();
        e.stopPropagation();
        void useCommandStore.getState().runById(cmd.id);
        return;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [openPalette]);

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
          onNavigateHome={onNavigateHome}
        />
      </main>
      {/* The pack-contributed Home view reads `route.projectId` from
          the shell SDK's `useRoute()` hook — no shell-supplied prop
          required. Same for every other view in the registry. */}
    </div>
  );
}

interface ShellBodyProps {
  tab: PrimaryTabId;
  projectId: string | null;
  onNavigateHome: () => void;
}

function ShellBody({ tab, projectId, onNavigateHome }: ShellBodyProps) {
  // P5b — view-registry-driven body. Every primary tab resolves through
  // the pack-contributed view registry. The shell no longer hardcodes a
  // branch per tab; it asks the registry for `tab` (and falls back to
  // `home` for the bare `#/` route + the per-tab "no project open"
  // empty state when needed).
  //
  // Disable the core-editor-pack and the registry returns null for every
  // tab — the shell renders the "no editor pack" empty state, which is
  // the dogfooding proof: the shell does not depend on any specific
  // pack to boot.
  const PackView = useRegisteredView(tab);

  // Home is the only tab that may render without an open project (it IS
  // the project picker). Every other tab requires a projectId before
  // the registry's view can do meaningful work.
  if (tab === "home") {
    if (PackView === null) {
      return (
        <NoEditorPackEmptyState onNavigateHome={onNavigateHome} />
      );
    }
    return (
      <div className="h-full overflow-auto">
        <PackView />
      </div>
    );
  }

  // Every non-Home tab needs an open project.
  if (!projectId) {
    return (
      <div className="h-full flex items-center justify-center">
        <EmptyState
          icon={<FolderOpen size={28} />}
          title="No project open"
          description="Choose a project from the Home tab to work in this view."
          action={
            <Tooltip
              stages={[
                { delay: 1000, content: <span>Go to Home</span> },
                {
                  delay: 3000,
                  content: (
                    <div>
                      <div className="font-semibold">Go to Home</div>
                      <div className="text-[10px] text-(--color-fg-muted) mt-1 max-w-[400px] whitespace-normal">
                        Switches to the Home tab where you can open or
                        create a project. The rest of the editor needs an
                        open project to render meaningful content.
                      </div>
                    </div>
                  ),
                },
              ]}
            >
              <button
                onClick={onNavigateHome}
                className="inline-flex items-center justify-center rounded-md bg-amber-500 text-zinc-950 hover:bg-amber-400 h-8 px-3 text-xs font-medium"
              >
                Go to Home
              </button>
            </Tooltip>
          }
        />
      </div>
    );
  }

  // Registry hit — render the pack-contributed view. `key` carries
  // projectId so opening a different project cleanly remounts the view
  // (and its IDB-backed state); the tab change itself reuses the same
  // mount when possible.
  if (PackView !== null) {
    return (
      <div className="h-full overflow-hidden">
        <PackView key={`${tab}::${projectId}`} />
      </div>
    );
  }

  // Registry miss — a tab descriptor exists but no view was contributed
  // (or every pack contributing views is disabled). Render the no-pack
  // empty state with a hint at the missing view id.
  return (
    <NoEditorPackEmptyState
      onNavigateHome={onNavigateHome}
      hint={`No view registered for "${tab}". Enable a pack that contributes one.`}
    />
  );
}

/** Empty state shown when the shell has no view to render — either
 *  because no editor pack is enabled, or because the active tab id
 *  doesn't resolve to a registry entry. Dogfooding proof: the shell is
 *  fully functional without any pack; it just renders this. */
function NoEditorPackEmptyState({
  onNavigateHome,
  hint,
}: {
  onNavigateHome: () => void;
  hint?: string;
}): React.JSX.Element {
  return (
    <div className="h-full flex items-center justify-center">
      <EmptyState
        icon={<FolderOpen size={28} />}
        title="No editor extensions enabled"
        description={
          hint ??
          "Enable an editor pack from Editor Settings → Extensions to see views, tabs, and panels here."
        }
        action={
          <Tooltip
            stages={[
              { delay: 1000, content: <span>Go to Home</span> },
              {
                delay: 3000,
                content: (
                  <div>
                    <div className="font-semibold">Go to Home</div>
                    <div className="text-[10px] text-(--color-fg-muted) mt-1 max-w-[400px] whitespace-normal">
                      Drops the URL hash so the shell falls back to the
                      registered Home view (when any pack contributes one).
                    </div>
                  </div>
                ),
              },
            ]}
          >
            <button
              onClick={onNavigateHome}
              className="inline-flex items-center justify-center rounded-md bg-amber-500 text-zinc-950 hover:bg-amber-400 h-8 px-3 text-xs font-medium"
            >
              Go to Home
            </button>
          </Tooltip>
        }
      />
    </div>
  );
}

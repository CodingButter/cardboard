import React from "react";
import {
  Code2,
  Eye,
  FileCode2,
  Loader2,
  Puzzle,
  Save as SaveIcon,
  Terminal,
  Wand2,
} from "lucide-react";
import {
  EditorProjectStore,
  type AssetMeta,
} from "../lib/EditorProjectStore";
import { useStatusBar } from "../shell/StatusBarContext";
import { useEditorActions } from "../shell/EditorActionsContext";
import {
  Badge,
  CollapsibleSection,
  EmptyState,
  IconButton,
  KeyValueList,
  PanelHeader,
  ScrollArea,
  ToggleSwitch,
  Toolbar,
  Tooltip,
  type KeyValueRow,
} from "../components/ui/index";
import { Button } from "../components/ui";
import { cn } from "../lib/cn";
import { ScriptsFileTree } from "./scripts/ScriptsFileTree";
import type {
  CursorPos,
  OpenFile,
  ScriptsMonacoHandle,
} from "./scripts/ScriptsMonaco";

/**
 * ScriptsView — top-level Scripts tab view.
 *
 * Per EDITOR_REDESIGN.md §7.5 + the `Editor Design/Scripting.png`
 * mockup, the Scripts view uses a **3-column** body grammar:
 *
 *     [ScriptsFileTree (left rail)]
 *     [Toolbar + Tabstrip + Monaco + Problems (fluid centre)]
 *     [Script inspector (right rail)]
 *
 * R2 primitives used here:
 *   - `PanelHeader` + `ScrollArea` + `IconButton` — owned by
 *     `ScriptsFileTree` (left rail).
 *   - `Toolbar` — above the editor, Save / Format / Open Console.
 *   - `Button` + `IconButton` — Toolbar actions.
 *   - `EmptyState` — when no file selected (R2 §4.24).
 *   - `Badge` — unsaved-files counter.
 *   - `Tooltip` — hover hints over Toolbar buttons.
 *   - `CollapsibleSection` + `KeyValueList` + `ToggleSwitch` —
 *     right-rail inspector sections.
 *
 * State ownership:
 *   - Project's `scripts/**` asset list → fetched here, passed to the
 *     file tree.
 *   - Open-file map (path → loaded value + dirty flag) → here. Persists
 *     to localStorage so a tab reload restores the session.
 *   - Cursor + file size → forwarded to the StatusBar via context.
 *   - Save handler → registered with EditorActions so the TopBar's
 *     Save button (and Ctrl+S) fires through to us.
 *
 * Inspector wiring is **read-only**: pulled from the active file's
 * text via lightweight regex parsing (`extractScriptOutline`). Once
 * an engine-side `parseComponentScript` helper lands, replace those
 * helpers with structured metadata. The Live Edit ToggleSwitch is
 * a placeholder (WIRING: hook into `EditorAssetPack.hotReloadScript`
 * once that flow exists; persists to localStorage in the meantime).
 */

// Lazy-loaded Monaco bundle. `import()` returns a Promise that resolves
// to the module's exports object; React's `lazy` wants the default
// export, so we wrap.
const ScriptsMonacoLazy = React.lazy(() =>
  import("./scripts/ScriptsMonaco").then((mod) => ({
    default: mod.ScriptsMonaco,
  })),
);

const OPEN_FILES_KEY_PREFIX = "cardboard_editor_scripts_open_files_";
const ACTIVE_FILE_KEY_PREFIX = "cardboard_editor_scripts_active_file_";
const LIVE_EDIT_KEY_PREFIX = "cardboard_editor_scripts_live_edit_";

export interface ScriptsViewProps {
  projectId: string;
}

type SaveState = "saved" | "saving" | "dirty" | "error";

export function ScriptsView({ projectId }: ScriptsViewProps) {
  // ── Asset list / file tree feed ───────────────────────────────────
  const [assets, setAssets] = React.useState<AssetMeta[]>([]);
  const [refreshTick, setRefreshTick] = React.useState(0);

  const refresh = React.useCallback(() => {
    setRefreshTick((n) => n + 1);
  }, []);

  React.useEffect(() => {
    let cancelled = false;
    void EditorProjectStore.listAssets(projectId).then((list) => {
      if (cancelled) return;
      setAssets(list);
    });
    return () => {
      cancelled = true;
    };
  }, [projectId, refreshTick]);

  const scriptFiles = React.useMemo(
    () =>
      assets
        .filter(
          (a) => a.path.startsWith("scripts/") && isScriptPath(a.path),
        )
        .map((a) => ({
          path: a.path,
          updatedAt: a.updatedAt,
        })),
    [assets],
  );

  // ── Open files + active file (persisted across reloads) ───────────
  const openKey = `${OPEN_FILES_KEY_PREFIX}${projectId}`;
  const activeKey = `${ACTIVE_FILE_KEY_PREFIX}${projectId}`;
  const liveEditKey = `${LIVE_EDIT_KEY_PREFIX}${projectId}`;

  const [openFiles, setOpenFiles] = React.useState<OpenFile[]>([]);
  const [activePath, setActivePath] = React.useState<string | null>(null);
  const [saveState, setSaveState] = React.useState<SaveState>("saved");
  const [cursor, setCursor] = React.useState<CursorPos | null>(null);
  const [liveEdit, setLiveEdit] = React.useState<boolean>(() => {
    try {
      return localStorage.getItem(liveEditKey) === "1";
    } catch {
      return false;
    }
  });

  React.useEffect(() => {
    try {
      localStorage.setItem(liveEditKey, liveEdit ? "1" : "0");
    } catch {
      // ignore quota / disabled storage
    }
  }, [liveEdit, liveEditKey]);

  // Hydrate persisted open-files set on mount. We load each path's
  // content from IDB; if a file no longer exists we silently drop it.
  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      let persistedPaths: string[] = [];
      let persistedActive: string | null = null;
      try {
        const raw = localStorage.getItem(openKey);
        if (raw) {
          const parsed = JSON.parse(raw);
          if (Array.isArray(parsed)) {
            persistedPaths = parsed.filter(
              (p) => typeof p === "string",
            ) as string[];
          }
        }
        persistedActive = localStorage.getItem(activeKey);
      } catch {
        // ignore — corrupted persisted state is non-fatal.
      }
      if (cancelled || persistedPaths.length === 0) return;
      const loaded: OpenFile[] = [];
      for (const p of persistedPaths) {
        try {
          const body = await EditorProjectStore.loadAsset(projectId, p);
          if (typeof body === "string") {
            loaded.push({ path: p, value: body, dirty: false });
          }
        } catch {
          // Skip missing/corrupt entries.
        }
      }
      if (cancelled) return;
      setOpenFiles(loaded);
      if (
        persistedActive &&
        loaded.some((f) => f.path === persistedActive)
      ) {
        setActivePath(persistedActive);
      } else if (loaded.length > 0) {
        setActivePath(loaded[0]!.path);
      }
    })();
    return () => {
      cancelled = true;
    };
    // openKey/activeKey are derived from projectId so projectId is the
    // canonical dep — re-running on every key change would be a loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  // Persist open-set when it changes.
  React.useEffect(() => {
    try {
      const paths = openFiles.map((f) => f.path);
      localStorage.setItem(openKey, JSON.stringify(paths));
      if (activePath) localStorage.setItem(activeKey, activePath);
      else localStorage.removeItem(activeKey);
    } catch {
      // ignore quota / disabled storage
    }
  }, [openFiles, activePath, openKey, activeKey]);

  // ── Open / close / change handlers ────────────────────────────────
  const openFile = React.useCallback(
    async (path: string) => {
      const existing = openFiles.find((f) => f.path === path);
      if (existing) {
        setActivePath(path);
        return;
      }
      let value = "";
      try {
        const body = await EditorProjectStore.loadAsset(projectId, path);
        if (typeof body === "string") value = body;
        else if (body instanceof Blob) value = await body.text();
      } catch {
        // Brand-new file (created from the tree's "New" affordance)
        // hasn't hit IDB yet — fall through with empty.
      }
      setOpenFiles((prev) => [
        ...prev,
        { path, value, dirty: false },
      ]);
      setActivePath(path);
    },
    [openFiles, projectId],
  );

  const closeFile = React.useCallback((path: string) => {
    setOpenFiles((prev) => {
      const next = prev.filter((f) => f.path !== path);
      // If we closed the active file, slide selection to the previous.
      if (activePath === path) {
        const idx = prev.findIndex((f) => f.path === path);
        const fallback = next[Math.max(0, idx - 1)] ?? next[0] ?? null;
        setActivePath(fallback?.path ?? null);
      }
      return next;
    });
  }, [activePath]);

  const handleChange = React.useCallback(
    (path: string, value: string) => {
      setOpenFiles((prev) =>
        prev.map((f) =>
          f.path === path ? { ...f, value, dirty: true } : f,
        ),
      );
      setSaveState("dirty");
    },
    [],
  );

  const handleCursorChange = React.useCallback(
    (path: string, pos: CursorPos) => {
      if (path !== activePath) return;
      setCursor(pos);
    },
    [activePath],
  );

  // ── Save handlers ─────────────────────────────────────────────────
  const dirtyPaths = React.useMemo(
    () => new Set(openFiles.filter((f) => f.dirty).map((f) => f.path)),
    [openFiles],
  );
  const dirtyCount = dirtyPaths.size;

  const saveOne = React.useCallback(
    async (path: string) => {
      const file = openFiles.find((f) => f.path === path);
      if (!file) return;
      setSaveState("saving");
      try {
        await EditorProjectStore.saveAsset(projectId, path, file.value);
        setOpenFiles((prev) =>
          prev.map((f) =>
            f.path === path ? { ...f, dirty: false } : f,
          ),
        );
        setSaveState((cur) => {
          // If other files are still dirty, stay in "dirty"; else "saved".
          const stillDirty = openFiles.some(
            (f) => f.path !== path && f.dirty,
          );
          void cur;
          return stillDirty ? "dirty" : "saved";
        });
        refresh();
      } catch (err) {
        console.error("Failed to save script:", err);
        setSaveState("error");
      }
    },
    [openFiles, projectId, refresh],
  );

  const saveAllDirty = React.useCallback(async () => {
    const dirty = openFiles.filter((f) => f.dirty);
    if (dirty.length === 0) {
      setSaveState("saved");
      return;
    }
    setSaveState("saving");
    try {
      for (const f of dirty) {
        await EditorProjectStore.saveAsset(projectId, f.path, f.value);
      }
      setOpenFiles((prev) => prev.map((f) => ({ ...f, dirty: false })));
      setSaveState("saved");
      refresh();
    } catch (err) {
      console.error("Failed to save scripts:", err);
      setSaveState("error");
    }
  }, [openFiles, projectId, refresh]);

  const onSaveActive = React.useCallback(() => {
    if (!activePath) return;
    void saveOne(activePath);
  }, [activePath, saveOne]);

  // ── Tree affordances ──────────────────────────────────────────────
  const onCreate = React.useCallback(
    async (folderPath: string) => {
      const name = window.prompt("New script filename (e.g. system.js):");
      if (!name) return;
      const safe = name.trim().replace(/[^a-zA-Z0-9._/-]+/g, "_");
      if (!safe) return;
      const path = `${folderPath.replace(/\/$/, "")}/${safe}`;
      await EditorProjectStore.saveAsset(projectId, path, "");
      refresh();
      await openFile(path);
    },
    [projectId, refresh, openFile],
  );

  const onRename = React.useCallback(
    async (oldPath: string, newPath: string) => {
      const body = await EditorProjectStore.loadAsset(projectId, oldPath);
      const text =
        typeof body === "string"
          ? body
          : body instanceof Blob
          ? await body.text()
          : "";
      await EditorProjectStore.saveAsset(projectId, newPath, text);
      await EditorProjectStore.deleteAsset(projectId, oldPath);
      setOpenFiles((prev) =>
        prev.map((f) =>
          f.path === oldPath
            ? { ...f, path: newPath }
            : f,
        ),
      );
      if (activePath === oldPath) setActivePath(newPath);
      refresh();
    },
    [activePath, projectId, refresh],
  );

  const onDelete = React.useCallback(
    async (path: string) => {
      const ok = window.confirm(`Delete ${path}? This cannot be undone.`);
      if (!ok) return;
      await EditorProjectStore.deleteAsset(projectId, path);
      setOpenFiles((prev) => prev.filter((f) => f.path !== path));
      if (activePath === path) setActivePath(null);
      refresh();
    },
    [activePath, projectId, refresh],
  );

  // ── Imperative ref into Monaco (Format / future affordances) ──────
  const monacoRef = React.useRef<ScriptsMonacoHandle | null>(null);
  const onFormat = React.useCallback(() => {
    monacoRef.current?.formatDocument();
  }, []);
  const onOpenConsole = React.useCallback(() => {
    // Future: surface the in-editor StatusConsole (R3 surface). Until
    // that wiring lands, the dev console is the practical fallback —
    // it's where Monaco worker errors and pack-script `console.log`
    // output already land.
    // eslint-disable-next-line no-console
    console.info(
      "[Scripts] Open Console — StatusConsole wiring deferred; use browser devtools for now.",
    );
  }, []);

  // ── StatusBar wiring ──────────────────────────────────────────────
  // Per §6.4: Scripts surfaces file path | cursor line/col | language
  // mode | indent (and we add file size since the task spec calls it
  // out explicitly).
  const { setSections } = useStatusBar();
  const activeFile = activePath
    ? openFiles.find((f) => f.path === activePath) ?? null
    : null;
  const activeBytes = activeFile
    ? new Blob([activeFile.value]).size
    : 0;

  React.useEffect(() => {
    const sections = [
      {
        id: "script-count",
        label: "Scripts",
        value: String(scriptFiles.length),
      },
      {
        id: "current-file",
        label: "File",
        value: activeFile
          ? `${activeFile.path}${activeFile.dirty ? " *" : ""}`
          : "—",
      },
      {
        id: "cursor-pos",
        label: "Cursor",
        value: cursor ? `Ln ${cursor.line}, Col ${cursor.column}` : "—",
      },
      {
        id: "lang-mode",
        label: "Lang",
        value: activeFile ? guessLangLabel(activeFile.path) : "—",
      },
      {
        id: "file-size",
        label: "Size",
        value: activeFile ? formatBytes(activeBytes) : "—",
      },
      {
        id: "save-state",
        label: "State",
        value: <SaveStateIndicator state={saveState} />,
        align: "right" as const,
      },
    ];
    setSections(sections);
    return () => setSections([]);
  }, [
    activeFile,
    activeBytes,
    cursor,
    saveState,
    scriptFiles.length,
    setSections,
  ]);

  // ── EditorActions wiring ──────────────────────────────────────────
  // Save (Ctrl+S) routes through the shell's TopBar handler. Multi-
  // dirty: save all dirty files at once — VSCode's "Save All" feel.
  const { register } = useEditorActions();
  React.useEffect(() => {
    return register({
      save: async () => {
        await saveAllDirty();
      },
    });
  }, [register, saveAllDirty]);

  // ── Inspector outline (parsed from active file body) ──────────────
  const outline = React.useMemo(
    () => (activeFile ? extractScriptOutline(activeFile.value) : null),
    [activeFile],
  );

  // ── Render ────────────────────────────────────────────────────────
  // 3-column body grammar (per §7.5 mockup):
  //   [ left rail (260px) ] [ centre fluid ] [ right rail (320px) ]
  const hasActive = activeFile != null;
  return (
    <div
      className="grid h-full min-h-0 min-w-0 bg-zinc-950 text-zinc-100"
      style={{ gridTemplateColumns: "260px minmax(0,1fr) 320px" }}
    >
      <ScriptsFileTree
        files={scriptFiles}
        activePath={activePath}
        dirtyPaths={dirtyPaths}
        onSelect={(p) => void openFile(p)}
        onCreate={onCreate}
        onRename={onRename}
        onDelete={onDelete}
        onRefresh={refresh}
      />

      <main className="flex flex-col min-w-0 min-h-0 bg-zinc-950/30">
        {/* Toolbar above editor (Save / Format / Open Console). */}
        <div className="px-3 pt-3 pb-2 border-b border-zinc-800/80 bg-zinc-900/40">
          <Toolbar
            groups={[
              {
                id: "file-actions",
                children: (
                  <>
                    <Tooltip content="Save (Ctrl/Cmd+S)">
                      <Button
                        variant="primary"
                        size="sm"
                        disabled={!hasActive && dirtyCount === 0}
                        onClick={() => void saveAllDirty()}
                        className="gap-1.5"
                      >
                        <SaveIcon size={13} />
                        Save
                        {dirtyCount > 0 && (
                          <Badge
                            variant="amber"
                            shape="pill"
                            className="ml-1 h-4 px-1.5"
                          >
                            {dirtyCount}
                          </Badge>
                        )}
                      </Button>
                    </Tooltip>
                    <Tooltip content="Format document (Monaco)">
                      <IconButton
                        icon={<Wand2 size={14} />}
                        tooltip="Format document"
                        disabled={!hasActive}
                        onClick={onFormat}
                      />
                    </Tooltip>
                  </>
                ),
              },
              {
                id: "diagnostics",
                children: (
                  <Tooltip content="Open console (browser devtools)">
                    <IconButton
                      icon={<Terminal size={14} />}
                      tooltip="Open Console"
                      onClick={onOpenConsole}
                    />
                  </Tooltip>
                ),
              },
            ]}
            tail={
              hasActive ? (
                <span
                  className={cn(
                    "text-[11px] font-mono text-zinc-500 truncate max-w-[260px]",
                  )}
                  title={activeFile!.path}
                >
                  {activeFile!.path}
                </span>
              ) : null
            }
          />
        </div>

        {/* Editor / EmptyState surface. */}
        <div className="flex-1 min-h-0 min-w-0 flex flex-col">
          <React.Suspense
            fallback={
              <div className="flex-1 flex flex-col items-center justify-center text-zinc-400">
                <Loader2
                  size={28}
                  className="animate-spin text-amber-400 mb-2"
                />
                <div className="text-xs">Loading Monaco editor…</div>
              </div>
            }
          >
            {openFiles.length === 0 && !activePath ? (
              <div className="flex-1 flex items-center justify-center">
                <EmptyState
                  icon={<Code2 size={28} />}
                  title="No script open"
                  description="Pick a script from the left to start editing, or right-click a folder to create one."
                  tutorial="scripts-intro"
                />
              </div>
            ) : (
              <ScriptsMonacoLazy
                ref={monacoRef}
                openFiles={openFiles}
                activePath={activePath}
                onActivate={(p) => setActivePath(p)}
                onClose={closeFile}
                onChange={handleChange}
                onCursorChange={handleCursorChange}
                onSaveActive={onSaveActive}
              />
            )}
          </React.Suspense>

          <ProblemsStrip
            saveState={saveState}
            activeFile={activeFile?.path ?? null}
          />
        </div>
      </main>

      {/* Right rail — SCRIPT INSPECTOR (per §7.5 / Scripting.png). */}
      <ScriptInspector
        activeFile={activeFile}
        outline={outline}
        liveEdit={liveEdit}
        onLiveEditChange={setLiveEdit}
        saveState={saveState}
        onSave={onSaveActive}
      />
    </div>
  );
}

/**
 * Bottom problems strip — diagnostics surface placeholder. Renders a
 * count of errors / warnings (currently always 0 — Monaco's TS worker
 * is stubbed; see ScriptsMonaco for the worker-factory note) and the
 * active file's save state so the eye doesn't have to travel down to
 * the StatusBar.
 *
 * WIRING: hook into `monaco.editor.onDidChangeMarkers` once the real
 * worker is wired so this strip becomes a live problem feed.
 */
function ProblemsStrip({
  saveState,
  activeFile,
}: {
  saveState: SaveState;
  activeFile: string | null;
}) {
  return (
    <div
      className={cn(
        "flex items-center gap-3 h-7 px-3 border-t border-zinc-800/80",
        "bg-zinc-950/70 text-[11px] text-zinc-500",
      )}
    >
      <span className="inline-flex items-center gap-1.5">
        <span className="inline-block w-2 h-2 rounded-full bg-red-500/60" />
        <span>0 errors</span>
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span className="inline-block w-2 h-2 rounded-full bg-amber-500/60" />
        <span>0 warnings</span>
      </span>
      <span className="text-zinc-700">·</span>
      <span className="opacity-70 truncate">
        {activeFile ?? "No file"}
      </span>
      <span className="ml-auto inline-flex items-center gap-1.5">
        <SaveStateIndicator state={saveState} />
      </span>
    </div>
  );
}

/**
 * Tailscale-style "save state" pill. Four states, distinct colors —
 * dirty (amber), saving (amber pulse), saved (green), error (red).
 */
function SaveStateIndicator({ state }: { state: SaveState }) {
  switch (state) {
    case "saving":
      return (
        <span className="inline-flex items-center gap-1.5">
          <Loader2 size={11} className="animate-spin text-amber-400" />
          <span className="text-amber-300">Saving…</span>
        </span>
      );
    case "dirty":
      return (
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block w-2 h-2 rounded-full bg-amber-400" />
          <span className="text-amber-200">Unsaved</span>
        </span>
      );
    case "error":
      return (
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block w-2 h-2 rounded-full bg-red-500" />
          <span className="text-red-300">Save failed</span>
        </span>
      );
    case "saved":
    default:
      return (
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block w-2 h-2 rounded-full bg-emerald-500" />
          <span className="text-emerald-300">Saved</span>
        </span>
      );
  }
}

// ─── Right rail — Script Inspector ──────────────────────────────────

interface ScriptOutline {
  /** Inferred component / module name (from `api.defineComponent(...)`,
   *  `class Name`, or the filename stem). */
  componentName: string | null;
  /** `api.defineComponent("Name")` keys found in the file. */
  definedComponents: string[];
  /** `api.registerSystem(...)` count — bare lines, no naming. */
  registeredSystems: number;
  /** `api.registerPrefab(...)` count. */
  registeredPrefabs: number;
  /** `@property {type} name [- description]` JSDoc fields. */
  properties: Array<{
    name: string;
    type: string | null;
    description: string | null;
  }>;
  /** Bare `export function Foo` / `export const Foo` keys. */
  exports: string[];
}

interface ScriptInspectorProps {
  activeFile: OpenFile | null;
  outline: ScriptOutline | null;
  liveEdit: boolean;
  onLiveEditChange: (v: boolean) => void;
  saveState: SaveState;
  onSave: () => void;
}

function ScriptInspector({
  activeFile,
  outline,
  liveEdit,
  onLiveEditChange,
  saveState,
  onSave,
}: ScriptInspectorProps) {
  return (
    <aside
      className={cn(
        "flex flex-col h-full min-h-0 border-l border-zinc-800",
        "bg-zinc-900/40 w-[320px] shrink-0",
      )}
    >
      <PanelHeader
        title="Script Inspector"
        action={
          activeFile ? (
            <Badge variant={activeFile.dirty ? "amber" : "zinc"}>
              {activeFile.dirty ? "modified" : "clean"}
            </Badge>
          ) : null
        }
      />

      {!activeFile || !outline ? (
        <div className="flex-1 flex items-center justify-center p-4">
          <EmptyState
            icon={<FileCode2 size={22} />}
            title="No script selected"
            description="Open a file from the left rail to inspect its exported components."
          />
        </div>
      ) : (
        <ScrollArea className="flex-1 min-h-0">
          <div className="p-3 space-y-3">
            {/* Component identity */}
            <CollapsibleSection
              title="Component"
              defaultOpen
              icon={<Puzzle size={12} />}
            >
              <KeyValueList
                density="dense"
                rows={
                  [
                    {
                      label: "Name",
                      value: (
                        <span className="text-amber-200">
                          {outline.componentName ??
                            stemFromPath(activeFile.path)}
                        </span>
                      ),
                    },
                    {
                      label: "File",
                      value: (
                        <span className="text-zinc-300 break-all">
                          {activeFile.path}
                        </span>
                      ),
                    },
                    {
                      label: "Language",
                      value: guessLangLabel(activeFile.path),
                    },
                    {
                      label: "Size",
                      value: formatBytes(
                        new Blob([activeFile.value]).size,
                      ),
                    },
                  ] satisfies KeyValueRow[]
                }
              />
            </CollapsibleSection>

            {/* Exported properties — parsed from @property JSDoc tags. */}
            <CollapsibleSection
              title={`Exported Properties (${outline.properties.length})`}
              defaultOpen
            >
              {outline.properties.length === 0 ? (
                <p className="text-xs text-zinc-500 py-1">
                  No <code>@property</code> JSDoc tags found. Add{" "}
                  <code className="text-amber-300">
                    @property &#123;number&#125; speed
                  </code>{" "}
                  to surface editable properties here.
                </p>
              ) : (
                <KeyValueList
                  density="dense"
                  rows={outline.properties.map((p) => ({
                    label: (
                      <span title={p.description ?? undefined}>
                        {p.name}
                      </span>
                    ),
                    value: (
                      <span className="text-zinc-300">
                        {p.type ?? "any"}
                      </span>
                    ),
                  }))}
                />
              )}
            </CollapsibleSection>

            {/* Usage — counts of side-effects + exports. */}
            <CollapsibleSection title="Symbols" defaultOpen>
              <KeyValueList
                density="dense"
                rows={[
                  {
                    label: "Components",
                    value: outline.definedComponents.length || "—",
                  },
                  {
                    label: "Systems",
                    value: outline.registeredSystems || "—",
                  },
                  {
                    label: "Prefabs",
                    value: outline.registeredPrefabs || "—",
                  },
                  {
                    label: "Exports",
                    value: outline.exports.length || "—",
                  },
                ]}
              />
              {outline.definedComponents.length > 0 ? (
                <div className="pt-2 flex flex-wrap gap-1">
                  {outline.definedComponents.map((c) => (
                    <Badge key={c} variant="amber" shape="pill">
                      {c}
                    </Badge>
                  ))}
                </div>
              ) : null}
              {outline.exports.length > 0 ? (
                <div className="pt-2 flex flex-wrap gap-1">
                  {outline.exports.map((e) => (
                    <Badge key={e} variant="zinc" shape="pill">
                      {e}
                    </Badge>
                  ))}
                </div>
              ) : null}
            </CollapsibleSection>

            {/* Live edit / runtime actions. */}
            <CollapsibleSection
              title="Runtime"
              defaultOpen
              icon={<Eye size={12} />}
            >
              <div className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <div className="text-xs text-zinc-200">Live Edit</div>
                    <div className="text-[11px] text-zinc-500">
                      Hot-reload this script in Playtest on save.
                    </div>
                  </div>
                  <ToggleSwitch
                    checked={liveEdit}
                    onChange={onLiveEditChange}
                    aria-label="Live edit"
                  />
                </div>
                <Tooltip content="Save (Ctrl/Cmd+S)" side="top">
                  <Button
                    variant="primary"
                    size="sm"
                    onClick={onSave}
                    disabled={!activeFile.dirty}
                    className="w-full justify-center gap-1.5"
                  >
                    <SaveIcon size={13} />
                    Save script
                  </Button>
                </Tooltip>
                <div className="flex items-center justify-between gap-2 pt-1">
                  <span className="text-[11px] text-zinc-500">
                    Current
                  </span>
                  <SaveStateIndicator state={saveState} />
                </div>
              </div>
            </CollapsibleSection>
          </div>
        </ScrollArea>
      )}
    </aside>
  );
}

// ─── Helpers ─────────────────────────────────────────────────────────

const SCRIPT_EXT = new Set(["js", "mjs", "cjs", "jsx", "ts", "tsx"]);

function isScriptPath(path: string): boolean {
  const dot = path.lastIndexOf(".");
  if (dot === -1) return false;
  return SCRIPT_EXT.has(path.slice(dot + 1).toLowerCase());
}

/** Lightweight lang label that doesn't pull the heavy Monaco helpers
 *  into the main bundle (the lazy chunk owns the full lookup). */
function guessLangLabel(path: string): string {
  const dot = path.lastIndexOf(".");
  if (dot === -1) return "Plain";
  const ext = path.slice(dot + 1).toLowerCase();
  switch (ext) {
    case "ts":
      return "TypeScript";
    case "tsx":
      return "TSX";
    case "js":
    case "mjs":
    case "cjs":
      return "JavaScript";
    case "jsx":
      return "JSX";
    case "json":
      return "JSON";
    default:
      return ext.toUpperCase();
  }
}

/** Friendly byte size: 812 B / 4.2 KB / 1.3 MB. */
function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function stemFromPath(path: string): string {
  const file = path.split("/").pop() ?? path;
  const dot = file.lastIndexOf(".");
  return dot === -1 ? file : file.slice(0, dot);
}

/**
 * Walk the active file's text with lightweight regexes and surface the
 * structural metadata the right-rail Inspector needs. Intentionally
 * forgiving — this is a glance-able summary, not a precise AST.
 *
 * Promote to a Babel/SWC pass (or wire to the engine's actual
 * `parseComponentScript` once it lands) when the parsing budget
 * grows past trivial regex.
 */
function extractScriptOutline(src: string): ScriptOutline {
  const definedComponents: string[] = [];
  // Match: api.defineComponent("Name"  OR  api.defineComponent('Name'
  const compRe = /\bapi\.defineComponent\s*\(\s*["'`]([A-Za-z_][\w$]*)["'`]/g;
  for (const m of src.matchAll(compRe)) {
    definedComponents.push(m[1]!);
  }

  const registeredSystems = (
    src.match(/\bapi\.registerSystem\s*\(/g) ?? []
  ).length;
  const registeredPrefabs = (
    src.match(/\bapi\.registerPrefab\s*\(/g) ?? []
  ).length;

  // Exported declarations — captures `export function X` /
  // `export const X` / `export class X` / `export default function X`.
  const exports: string[] = [];
  const exportRe =
    /\bexport\s+(?:default\s+)?(?:async\s+)?(?:function|const|let|var|class)\s+([A-Za-z_][\w$]*)/g;
  for (const m of src.matchAll(exportRe)) {
    exports.push(m[1]!);
  }

  // @property {type} name [- description]
  const properties: ScriptOutline["properties"] = [];
  const propRe =
    /@property\s+(?:\{([^}]+)\}\s+)?([A-Za-z_][\w$]*)\s*(?:-\s*([^\n*]+))?/g;
  for (const m of src.matchAll(propRe)) {
    properties.push({
      type: m[1]?.trim() ?? null,
      name: m[2]!.trim(),
      description: m[3]?.trim() ?? null,
    });
  }

  // Best-effort component name: first defineComponent, else first
  // export, else null (the caller falls back to filename stem).
  const componentName =
    definedComponents[0] ?? exports[0] ?? null;

  return {
    componentName,
    definedComponents,
    registeredSystems,
    registeredPrefabs,
    properties,
    exports,
  };
}

import React from "react";
import { Code2, Loader2 } from "lucide-react";
import {
  EditorProjectStore,
  type AssetMeta,
} from "../lib/EditorProjectStore";
import { useStatusBar } from "../shell/StatusBarContext";
import { useEditorActions } from "../shell/EditorActionsContext";
import { EmptyState } from "../components/ui/index";
import { cn } from "../lib/cn";
import type { PackManifest } from "@two_5_d/engine";
import { ScriptsFileTree } from "./scripts/ScriptsFileTree";
import { ScriptsAssetsRail } from "./scripts/ScriptsAssetsRail";
import type {
  CursorPos,
  OpenFile,
  ScriptsMonacoHandle,
} from "./scripts/ScriptsMonaco";

/**
 * ScriptsView — top-level Scripts tab view.
 *
 * Per EDITOR_REDESIGN.md §7.5 / §12 Q7: this module is a thin shell
 * that lazy-loads the Monaco-backed editor on first mount. Monaco is
 * ~1.2MB and irrelevant to Home / Map / Entities sessions, so we keep
 * it out of the main bundle.
 *
 * Layout (3-pane):
 *
 *     [ScriptsFileTree] [ScriptsMonaco] [ScriptsAssetsRail]
 *
 * State ownership:
 *   - Project's `scripts/**` asset list → fetched here, passed to the
 *     file tree.
 *   - Open-file map (path → loaded value + dirty flag) → here. Persists
 *     to localStorage so a tab reload restores the session.
 *   - Cursor + language mode → forwarded to the StatusBar via context.
 *   - Save handler → registered with EditorActions so the TopBar's
 *     Save button fires through to us.
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
        .map((a) => ({ path: a.path, updatedAt: a.updatedAt })),
    [assets],
  );

  // ── Pack manifest for the Assets rail ─────────────────────────────
  const [manifest, setManifest] = React.useState<PackManifest | null>(null);
  React.useEffect(() => {
    let cancelled = false;
    void EditorProjectStore.loadManifest(projectId).then((m) => {
      if (cancelled) return;
      setManifest(m);
    });
    return () => {
      cancelled = true;
    };
  }, [projectId, refreshTick]);

  // ── Open files + active file (persisted across reloads) ───────────
  const openKey = `${OPEN_FILES_KEY_PREFIX}${projectId}`;
  const activeKey = `${ACTIVE_FILE_KEY_PREFIX}${projectId}`;

  const [openFiles, setOpenFiles] = React.useState<OpenFile[]>([]);
  const [activePath, setActivePath] = React.useState<string | null>(null);
  const [saveState, setSaveState] = React.useState<SaveState>("saved");
  const [cursor, setCursor] = React.useState<CursorPos | null>(null);

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

  // ── Imperative ref into Monaco (for the rail's Insert action) ─────
  const monacoRef = React.useRef<ScriptsMonacoHandle | null>(null);
  const insertSnippet = React.useCallback((snippet: string) => {
    monacoRef.current?.insertAtCursor(snippet);
  }, []);

  // ── StatusBar wiring ──────────────────────────────────────────────
  const { setSections } = useStatusBar();
  React.useEffect(() => {
    const active = activePath
      ? openFiles.find((f) => f.path === activePath) ?? null
      : null;
    const sections = [
      {
        id: "script-count",
        label: "Scripts",
        value: String(scriptFiles.length),
      },
      {
        id: "current-file",
        label: "File",
        value: active
          ? `${active.path}${active.dirty ? " *" : ""}`
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
        value: active ? guessLangLabel(active.path) : "—",
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
    activePath,
    cursor,
    openFiles,
    saveState,
    scriptFiles.length,
    setSections,
  ]);

  // ── EditorActions wiring ──────────────────────────────────────────
  const { register } = useEditorActions();
  React.useEffect(() => {
    return register({
      save: async () => {
        // If multiple files dirty, save them all. The user-perceived
        // behaviour matches VSCode's Save All when you have unsaved
        // changes in several tabs.
        await saveAllDirty();
      },
    });
  }, [register, saveAllDirty]);

  // ── Render ────────────────────────────────────────────────────────
  return (
    <div className="flex h-full min-h-0 min-w-0">
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

      <main className="flex-1 min-w-0 min-h-0 flex flex-col">
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

        <ProblemsStrip />
      </main>

      <ScriptsAssetsRail
        manifest={manifest}
        onInsertSnippet={insertSnippet}
      />
    </div>
  );
}

/**
 * Bottom problems strip — placeholder for the diagnostics surface
 * (errors + warnings from Monaco's TS service). WIRING: hook into
 * `monaco.editor.onDidChangeMarkers` once we have a marker model per
 * open file. For now we render the chrome only.
 */
function ProblemsStrip() {
  return (
    <div
      className={cn(
        "flex items-center gap-3 h-7 px-3 border-t border-zinc-800",
        "bg-zinc-950/60 text-[11px] text-zinc-500",
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
      <span className="ml-auto opacity-60">Problems</span>
    </div>
  );
}

/**
 * Tailscale-style "save state" pill. Three states, distinct colors —
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


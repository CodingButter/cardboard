import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PackManifest } from "@two_5_d/engine";
import {
  EditorProjectStore,
  type AssetMeta,
  type ProjectMeta,
} from "../lib/EditorProjectStore";
import { Button, Input } from "../components/ui";
import { cn } from "../lib/cn";
import { EditorViewport, type ViewportMode } from "./EditorViewport";
import type { MutableScene } from "./GridEditor";
import { AnimationEditor } from "./AnimationEditor";
import { EntitiesEditor } from "./EntitiesEditor";
import { ProjectSettingsModal } from "./ProjectSettingsModal";

/**
 * Project view — workflow-mode tab strip + active surface.
 *
 * Per the iframe-pivot reorg (this PR):
 *   - **Scene mode** (legacy "map") is pure: viewport (Play) +
 *     GridEditor (Edit) + a scene-list right rail. Manifest editing
 *     has moved into the Project Settings modal opened via the ⚙
 *     button in the header. The component file is still
 *     `MapView.tsx` — only the user-facing tab name changed
 *     (Map → Scene).
 *   - Other modes (Prefabs (legacy "entities"), Animation,
 *     Scripts/Assets placeholders) are unchanged.
 *
 * The Project Settings modal is the home for occasional configuration
 * (manifest metadata, dependencies, export, advanced flags). It
 * doesn't unmount the iframe — closing the modal returns the user to
 * the same engine state. A "Reload running game" button at the bottom
 * of the modal broadcasts `{type:"reset"}` to the iframe so manifest
 * changes can be applied immediately without manual reload.
 */

interface ProjectViewProps {
  projectId: string;
  onBackHome: () => void;
}

export type WorkflowMode = "scene" | "prefabs" | "scripts" | "assets" | "animation";

const WORKFLOW_MODES: ReadonlyArray<{
  id: WorkflowMode;
  label: string;
  hint: string;
}> = [
  { id: "scene", label: "Scene", hint: "Top-down scene editor (grid + scene list)" },
  {
    id: "prefabs",
    label: "Prefabs",
    hint: "Declarative prefab authoring (EDITOR.md §6.3)",
  },
  {
    id: "scripts",
    label: "Scripts",
    hint: "Pack scripts (Monaco editor — future phase)",
  },
  {
    id: "assets",
    label: "Assets",
    hint: "Asset browser (future phase)",
  },
  {
    id: "animation",
    label: "Animation",
    hint: "Sprite-sheet animation editor (AE1)",
  },
];

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}

export function ProjectView({ projectId, onBackHome }: ProjectViewProps) {
  const [meta, setMeta] = useState<ProjectMeta | null>(null);
  const [manifest, setManifest] = useState<PackManifest | null>(null);
  const [assets, setAssets] = useState<AssetMeta[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState("");

  // Viewport state.
  const [viewportScene, setViewportScene] = useState<string | null>(null);
  const [mode, setMode] = useState<ViewportMode>("play");
  const [editScene, setEditScene] = useState<MutableScene | null>(null);
  const [editScenePath, setEditScenePath] = useState<string | null>(null);
  const [sceneDirty, setSceneDirty] = useState(false);
  const [sceneSaving, setSceneSaving] = useState(false);
  const [sceneSavedAt, setSceneSavedAt] = useState<number | null>(null);
  // Workflow mode is persisted per-project in localStorage so refreshing
  // the page lands you back on the tab you were just on. Different
  // projects can remember different last-active modes independently.
  const workflowModeKey = `cardboard_editor_workflow_mode_${projectId}`;
  const [workflowMode, setWorkflowModeState] = useState<WorkflowMode>(() => {
    try {
      const saved = localStorage.getItem(workflowModeKey);
      // Migrate legacy values (Map → Scene, Entities → Prefabs tab
      // renames). Rewrite in place so the next read finds the new
      // identifier directly.
      if (saved === "map") {
        try { localStorage.setItem(workflowModeKey, "scene"); } catch { /* ignore */ }
        return "scene";
      }
      if (saved === "entities") {
        try { localStorage.setItem(workflowModeKey, "prefabs"); } catch { /* ignore */ }
        return "prefabs";
      }
      if (saved === "scene" || saved === "prefabs" || saved === "scripts" ||
          saved === "assets" || saved === "animation") {
        return saved;
      }
    } catch {
      // localStorage may throw in private-browsing / sandboxed contexts.
    }
    return "scene";
  });
  const setWorkflowMode = useCallback(
    (next: WorkflowMode) => {
      setWorkflowModeState(next);
      try {
        localStorage.setItem(workflowModeKey, next);
      } catch {
        // ignore — UX still works, just doesn't persist this session
      }
    },
    [workflowModeKey],
  );

  // Project Settings modal.
  const [settingsOpen, setSettingsOpen] = useState(false);

  // Iframe ref handed to the modal so its "Reload running game"
  // button can broadcast a `{type:"reset"}` to the right frame.
  const viewportFrameRef = useRef<HTMLIFrameElement | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [m, mf, as] = await Promise.all([
        EditorProjectStore.getProject(projectId),
        EditorProjectStore.loadManifest(projectId),
        EditorProjectStore.listAssets(projectId),
      ]);
      setMeta(m);
      setManifest(mf);
      setAssets(as);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const activeScenePath =
    viewportScene ?? manifest?.startScene ?? null;

  // Load (or reload) the editable scene whenever the user enters edit
  // mode or switches scenes while in edit mode.
  useEffect(() => {
    if (mode !== "edit") return;
    if (!activeScenePath) return;
    if (editScenePath === activeScenePath && editScene) return;
    let cancelled = false;
    (async () => {
      const body = await EditorProjectStore.loadAsset(
        projectId,
        activeScenePath,
      );
      if (cancelled || typeof body !== "string") return;
      try {
        const parsed = JSON.parse(body) as MutableScene;
        setEditScene(parsed);
        setEditScenePath(activeScenePath);
        setSceneDirty(false);
      } catch (err) {
        setError(`Failed to parse ${activeScenePath}: ${(err as Error).message}`);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, activeScenePath, projectId]);

  const persistScene = useCallback(async (): Promise<void> => {
    if (!editScene || !editScenePath) return;
    if (!sceneDirty && sceneSavedAt !== null) return;
    setSceneSaving(true);
    try {
      const json = JSON.stringify(editScene, null, 2);
      await EditorProjectStore.saveAsset(projectId, editScenePath, json);
      setSceneDirty(false);
      setSceneSavedAt(Date.now());
      const fresh = await EditorProjectStore.listAssets(projectId);
      setAssets(fresh);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSceneSaving(false);
    }
  }, [editScene, editScenePath, projectId, sceneDirty, sceneSavedAt]);

  // Debounced auto-save.
  useEffect(() => {
    if (!sceneDirty) return;
    const handle = setTimeout(() => {
      persistScene();
    }, 750);
    return () => clearTimeout(handle);
  }, [sceneDirty, persistScene]);

  const sceneAssets = useMemo(
    () => assets.filter((a) => a.path.startsWith("scenes/")),
    [assets],
  );

  const handleNameSave = async () => {
    const next = nameDraft.trim();
    if (!next || !meta || next === meta.name) {
      setEditingName(false);
      return;
    }
    try {
      await EditorProjectStore.renameProject(meta.id, next);
      await refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setEditingName(false);
    }
  };

  const handleSelectScene = (path: string) => {
    setViewportScene(path);
  };

  if (loading && !meta) {
    return (
      <div className="min-h-screen bg-zinc-950 text-zinc-100 flex items-center justify-center">
        <div className="text-sm text-zinc-400">Loading project…</div>
      </div>
    );
  }

  if (!meta) {
    return (
      <div className="min-h-screen bg-zinc-950 text-zinc-100 flex flex-col items-center justify-center gap-4">
        <div className="text-sm text-zinc-300">
          No project found with id <code>{projectId}</code>.
        </div>
        <Button onClick={onBackHome}>Back to home</Button>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100">
      <header className="border-b border-zinc-800 px-8 py-4 flex items-center justify-between">
        <div className="flex items-center gap-4 min-w-0">
          <button
            onClick={onBackHome}
            className="text-sm text-zinc-400 hover:text-amber-400 transition-colors"
          >
            ← Home
          </button>
          <div className="min-w-0">
            {editingName ? (
              <Input
                autoFocus
                value={nameDraft}
                onChange={(e) => setNameDraft(e.target.value)}
                onBlur={handleNameSave}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleNameSave();
                  if (e.key === "Escape") setEditingName(false);
                }}
                className="h-8 text-base font-semibold"
              />
            ) : (
              <h1
                className="text-lg font-semibold truncate cursor-text hover:text-amber-300"
                title="Click to rename"
                onClick={() => {
                  setNameDraft(meta.name);
                  setEditingName(true);
                }}
              >
                {meta.name}
              </h1>
            )}
            <p className="text-xs text-zinc-500 mt-0.5">
              Updated {new Date(meta.modifiedAt).toLocaleString()}
              {meta.forkedFrom?.url ? (
                <>
                  {" · "}
                  <span title={meta.forkedFrom.url}>forked from URL</span>
                </>
              ) : null}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {workflowMode === "scene" && sceneDirty ? (
            <span className="text-xs text-amber-300">● Scene unsaved</span>
          ) : workflowMode === "scene" && sceneSavedAt ? (
            <span className="text-xs text-emerald-400">
              Scene saved {new Date(sceneSavedAt).toLocaleTimeString()}
            </span>
          ) : null}
          {workflowMode === "scene" && editScene && editScenePath ? (
            <Button
              variant="secondary"
              size="sm"
              onClick={persistScene}
              disabled={sceneSaving || !sceneDirty}
            >
              {sceneSaving ? "Saving…" : "Save scene"}
            </Button>
          ) : null}
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setSettingsOpen(true)}
            title="Project settings (manifest, dependencies, export, advanced)"
            aria-label="Project settings"
          >
            ⚙ Settings
          </Button>
        </div>
      </header>

      {/* Workflow-mode tab strip */}
      <nav className="border-b border-zinc-800 px-8 flex items-center gap-1 bg-zinc-950/60">
        {WORKFLOW_MODES.map((m) => {
          const isActive = workflowMode === m.id;
          return (
            <button
              key={m.id}
              onClick={() => setWorkflowMode(m.id)}
              title={m.hint}
              className={cn(
                "px-4 py-2 text-sm border-b-2 -mb-px transition-colors",
                isActive
                  ? "border-amber-400 text-amber-300"
                  : "border-transparent text-zinc-400 hover:text-zinc-100",
              )}
            >
              {m.label}
            </button>
          );
        })}
      </nav>

      {error ? (
        <div className="mx-8 mt-4 rounded-md border border-red-700 bg-red-900/30 px-4 py-3 text-sm text-red-200">
          <div className="font-medium">Something went wrong</div>
          <div className="mt-1 text-red-300/90">{error}</div>
          <button
            className="mt-2 text-xs text-red-200 hover:text-white underline underline-offset-2"
            onClick={() => setError(null)}
          >
            Dismiss
          </button>
        </div>
      ) : null}

      {workflowMode === "animation" ? (
        <main className="px-0 py-0">
          <div className="h-[calc(100vh-128px)] border-t border-zinc-800">
            <AnimationEditor
              projectId={projectId}
              onManifestChanged={() => refresh()}
            />
          </div>
        </main>
      ) : workflowMode === "prefabs" ? (
        <main className="px-0 py-0">
          <div className="h-[calc(100vh-128px)] border-t border-zinc-800">
            <EntitiesEditor
              projectId={projectId}
              onManifestChanged={() => refresh()}
            />
          </div>
        </main>
      ) : workflowMode === "scripts" || workflowMode === "assets" ? (
        <main className="px-8 py-8">
          <div className="rounded border border-dashed border-zinc-800 p-8 text-center text-zinc-500">
            <h2 className="text-sm font-semibold text-zinc-300 mb-1">
              {workflowMode === "scripts" ? "Scripts" : "Assets"} workspace
            </h2>
            <p className="text-xs">
              Coming in a later phase. The placeholder lives here so the
              tab strip is stable.
            </p>
          </div>
        </main>
      ) : (
        // ── Scene mode (legacy "map"): iframe + GridEditor + scene-list right rail.
        //     Manifest editing has moved to the Settings modal.
        <main className="grid grid-cols-[1fr_280px] gap-0 h-[calc(100vh-128px)] border-t border-zinc-800">
          {/* Center pane — viewport (Play) / GridEditor (Edit). */}
          <div className="border-r border-zinc-800 overflow-hidden">
            <EditorViewport
              projectId={projectId}
              sceneName={viewportScene ?? manifest?.startScene}
              onSceneResolved={(path) => {
                if (!viewportScene) setViewportScene(path);
              }}
              mode={mode}
              onModeChange={setMode}
              editScene={editScene}
              editScenePath={editScenePath}
              onEditSceneChange={(next) => {
                setEditScene(next);
                setSceneDirty(true);
              }}
              onPersistScene={persistScene}
              iframeRef={viewportFrameRef}
              onSceneRewrittenExternally={async (path) => {
                // The ⚡ Bake button rewrote IDB. Re-load the scene
                // JSON so the in-memory editScene picks up the new
                // `lightmap` field — without this, the next paint
                // would overwrite the bake on auto-save.
                if (path !== editScenePath) return;
                const fresh = await EditorProjectStore.loadAsset(
                  projectId,
                  path,
                );
                if (typeof fresh !== "string") return;
                try {
                  setEditScene(JSON.parse(fresh) as MutableScene);
                  setSceneDirty(false);
                  setSceneSavedAt(Date.now());
                } catch {
                  // ignore — the bake wrote valid JSON, but defensive
                }
              }}
              // Surface every prefab the engine will register at boot —
              // declarative ones (manifest.prefabs[name]) AND sprite IDs
              // — so the GridEditor entity tool's prefab picker stays in
              // sync with the Prefabs tab. JS-detected prefabs ride on
              // the fallback list inside GridEditor (player, marker).
              prefabNames={Object.keys(manifest?.prefabs ?? {})}
              spriteIds={Object.keys(manifest?.sprites ?? {})}
            />
          </div>

          {/* Right rail — scene list. */}
          <aside className="overflow-auto bg-zinc-950/30">
            <div className="px-4 py-3 border-b border-zinc-800">
              <h2 className="text-xs uppercase tracking-wide text-zinc-400">
                Scenes
              </h2>
              <p className="text-[11px] text-zinc-500 mt-0.5">
                {sceneAssets.length === 0
                  ? "No scenes/*.json assets."
                  : `${sceneAssets.length} scene file${sceneAssets.length === 1 ? "" : "s"}`}
              </p>
            </div>
            {sceneAssets.length > 0 ? (
              <ul className="divide-y divide-zinc-900/60">
                {sceneAssets.map((s) => (
                  <li
                    key={s.path}
                    className={cn(
                      "px-4 py-2 hover:bg-zinc-800/40 cursor-pointer flex items-center justify-between gap-2",
                      viewportScene === s.path && "bg-zinc-800/60",
                    )}
                    onClick={() => handleSelectScene(s.path)}
                  >
                    <div className="text-sm text-zinc-100 truncate flex items-center gap-2">
                      {s.path.replace(/^scenes\//, "")}
                      {viewportScene === s.path ? (
                        <span
                          className="text-[10px] text-amber-400 uppercase tracking-wide"
                          title="Pinned to viewport"
                        >
                          ▶ live
                        </span>
                      ) : null}
                    </div>
                    <div className="text-[10px] text-zinc-500 shrink-0">
                      {formatBytes(s.sizeBytes)}
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="px-4 py-6 text-xs text-zinc-500">
                Use the Settings modal to set <code>startScene</code> on the
                manifest, or add a scene through the Asset import flow.
              </div>
            )}
          </aside>
        </main>
      )}

      <ProjectSettingsModal
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        projectId={projectId}
        onManifestChanged={() => refresh()}
        getIframe={() => viewportFrameRef.current}
      />
    </div>
  );
}

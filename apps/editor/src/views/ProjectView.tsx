import React, { useCallback, useEffect, useMemo, useState } from "react";
import type { PackManifest } from "@two_5_d/engine";
import {
  EditorProjectStore,
  type AssetMeta,
  type ProjectMeta,
} from "../lib/EditorProjectStore";
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Input,
  Label,
  Textarea,
} from "../components/ui";
import { cn } from "../lib/cn";
import { EditorViewport, type ViewportMode } from "./EditorViewport";
import type { MutableScene } from "./GridEditor";
import { AnimationEditor } from "./AnimationEditor";

/**
 * Read-only-ish project view for E1.
 *
 * Per `docs/plans/EDITOR.md` §10 E1: "Empty project → manifest editor
 * + scene list (no engine yet)." This screen meets that bar. The
 * manifest editor surfaces the top-level fields and round-trips JSON
 * via the store; the scene list shows every `scenes/*.json` asset
 * with a click-to-view raw-JSON pane. Nested editing for tile presets
 * / items / sprites is deferred to E3-E4 (a JSON "advanced" textarea
 * keeps complex fields editable in the meantime).
 */

interface ProjectViewProps {
  projectId: string;
  onBackHome: () => void;
}

/**
 * Workflow modes per EDITOR.md §5.1 — Map / Entities / Scripts /
 * Assets / Animation. AE1 lights up the Animation mode; the other
 * four still share today's single combined viewport+manifest+scenes
 * surface (they'll split out as separate components in later phases,
 * see EDITOR.md §10 E5+).
 *
 * Picking "Animation" replaces the central viewport+scenes+manifest
 * panel with the `<AnimationEditor>` component. The iframe is kept
 * mounted on the project shell so swapping back to Map/Entities/etc.
 * doesn't lose engine state.
 */
type WorkflowMode = "map" | "entities" | "scripts" | "assets" | "animation";

const WORKFLOW_MODES: ReadonlyArray<{
  id: WorkflowMode;
  label: string;
  /** Short hint shown in a tooltip — Map/Entities/Scripts/Assets still
   *  share today's combined surface, the label clarifies. */
  hint: string;
}> = [
  { id: "map", label: "Map", hint: "Top-down scene editor (today's surface)" },
  {
    id: "entities",
    label: "Entities",
    hint: "Entity inspector (uses today's surface)",
  },
  {
    id: "scripts",
    label: "Scripts",
    hint: "Pack scripts (uses today's surface)",
  },
  {
    id: "assets",
    label: "Assets",
    hint: "Asset browser (uses today's surface)",
  },
  {
    id: "animation",
    label: "Animation",
    hint: "Sprite-sheet animation editor (AE1)",
  },
];

/** Top-level scalar fields surfaced by the simple form. */
interface ManifestFormFields {
  id: string;
  name: string;
  version: string;
  engine: string;
  startScene: string;
  description: string;
  author: string;
  homepage: string;
}

function pickFormFields(m: PackManifest): ManifestFormFields {
  // `id`, `description`, `author`, `homepage` aren't on the engine's
  // `PackManifest` type today (they land with PACK_CHAIN P2) but
  // packs in the wild already ship them, so we tolerate them as
  // free-form fields via an index-signature read.
  const extra = m as unknown as Record<string, unknown>;
  return {
    id: typeof extra.id === "string" ? extra.id : "",
    name: m.name ?? "",
    version: m.version ?? "",
    engine: m.engine ?? "",
    startScene: m.startScene ?? "",
    description:
      typeof extra.description === "string" ? extra.description : "",
    author: typeof extra.author === "string" ? extra.author : "",
    homepage: typeof extra.homepage === "string" ? extra.homepage : "",
  };
}

function applyFormFields(
  m: PackManifest,
  fields: ManifestFormFields,
): PackManifest {
  // Merge the scalar fields back, keeping everything else (tilePresets,
  // items, sprites, lighting, shaders, ...) intact.
  const out = { ...m } as PackManifest & Record<string, unknown>;
  out.name = fields.name;
  out.version = fields.version;
  out.engine = fields.engine;
  out.startScene = fields.startScene;
  if (fields.id) out.id = fields.id;
  else delete out.id;
  if (fields.description) out.description = fields.description;
  else delete out.description;
  if (fields.author) out.author = fields.author;
  else delete out.author;
  if (fields.homepage) out.homepage = fields.homepage;
  else delete out.homepage;
  return out;
}

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
  const [form, setForm] = useState<ManifestFormFields | null>(null);
  // "Advanced" JSON view of every field NOT covered by the scalar
  // form (tilePresets, items, sprites, lighting, shaders, ...).
  const [advancedJson, setAdvancedJson] = useState("");
  const [advancedDirty, setAdvancedDirty] = useState(false);
  const [advancedError, setAdvancedError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  // Scene preview state.
  const [selectedScene, setSelectedScene] = useState<string | null>(null);
  const [selectedSceneBody, setSelectedSceneBody] = useState<string | null>(
    null,
  );
  const [selectedSceneLoading, setSelectedSceneLoading] = useState(false);

  // Viewport state — which scene is the live engine pinned to. Falls
  // back to the manifest's `startScene` when nothing is explicitly
  // selected. Click a scene in the list → viewport remounts on it.
  const [viewportScene, setViewportScene] = useState<string | null>(null);
  /** Play vs Edit mode for the viewport pane. Lifted from
   *  EditorViewport in E3 so the project header can read the dirty
   *  flag + Save button stays valid across mode switches. */
  const [mode, setMode] = useState<ViewportMode>("play");
  /** In-memory editable copy of the scene currently loaded in the
   *  GridEditor. Set when we enter edit mode; cleared on scene change. */
  const [editScene, setEditScene] = useState<MutableScene | null>(null);
  const [editScenePath, setEditScenePath] = useState<string | null>(null);
  const [sceneDirty, setSceneDirty] = useState(false);
  const [sceneSaving, setSceneSaving] = useState(false);
  const [sceneSavedAt, setSceneSavedAt] = useState<number | null>(null);
  /** Workflow mode tab. AE1 adds Animation; the other four currently
   *  share the existing combined surface. */
  const [workflowMode, setWorkflowMode] = useState<WorkflowMode>("map");

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
      if (mf) {
        const f = pickFormFields(mf);
        setForm(f);
        // The advanced JSON view is whatever fields aren't in the
        // scalar form — split out so two editors don't clobber each
        // other on save.
        const remainder = { ...(mf as unknown as Record<string, unknown>) };
        for (const key of [
          "id",
          "name",
          "version",
          "engine",
          "startScene",
          "description",
          "author",
          "homepage",
        ]) {
          delete remainder[key];
        }
        setAdvancedJson(JSON.stringify(remainder, null, 2));
        setAdvancedDirty(false);
        setAdvancedError(null);
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Resolve which scene the editor should load — same fallback chain
  // as the viewport's `sceneName` prop.
  const activeScenePath =
    viewportScene ?? form?.startScene ?? manifest?.startScene ?? null;

  // Load (or reload) the editable scene whenever the user enters edit
  // mode or switches scenes while in edit mode. We keep the in-memory
  // copy detached from the viewport's read-only scene so the
  // GridEditor can mutate freely without competing with the engine.
  useEffect(() => {
    if (mode !== "edit") return;
    if (!activeScenePath) return;
    // Don't clobber unsaved edits — if we're already on this scene
    // and have pending mutations, keep them.
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
    // We deliberately don't include editScene/editScenePath in deps —
    // they're guards inside the body, and we want this to fire only on
    // mode/scene/project change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, activeScenePath, projectId]);

  /** Persist the current editable scene to IDB. Idempotent — skip
   *  when there are no pending edits or no loaded scene. */
  const persistScene = useCallback(async (): Promise<void> => {
    if (!editScene || !editScenePath) return;
    if (!sceneDirty && sceneSavedAt !== null) return;
    setSceneSaving(true);
    try {
      const json = JSON.stringify(editScene, null, 2);
      await EditorProjectStore.saveAsset(projectId, editScenePath, json);
      setSceneDirty(false);
      setSceneSavedAt(Date.now());
      // Pull a fresh `assets` listing so the size badge stays accurate.
      const fresh = await EditorProjectStore.listAssets(projectId);
      setAssets(fresh);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSceneSaving(false);
    }
  }, [editScene, editScenePath, projectId, sceneDirty, sceneSavedAt]);

  // Debounced auto-save — write to IDB 750ms after the last paint
  // mutation. Explicit Save button bypasses the timer for immediate
  // persistence (and for the Edit→Play handoff in EditorViewport).
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

  const handleSaveManifest = async () => {
    if (!manifest || !form) return;
    setSaving(true);
    setError(null);
    try {
      // Validate the advanced JSON first so a bad paste doesn't nuke
      // the scalar fields.
      let advancedParsed: Record<string, unknown> = {};
      if (advancedJson.trim()) {
        try {
          advancedParsed = JSON.parse(advancedJson);
          if (
            advancedParsed === null ||
            typeof advancedParsed !== "object" ||
            Array.isArray(advancedParsed)
          ) {
            throw new Error("Advanced JSON must be a top-level object");
          }
        } catch (err) {
          setAdvancedError((err as Error).message);
          setSaving(false);
          return;
        }
      }
      // Replace whole top-level non-form keys with whatever the
      // advanced JSON now contains (so deletions in the textarea
      // actually delete). Then layer the scalar form fields on top
      // so the form is authoritative for its own fields.
      const cleaned = applyFormFields(
        advancedParsed as unknown as PackManifest,
        form,
      );
      await EditorProjectStore.saveManifest(projectId, cleaned);
      setManifest(cleaned);
      setAdvancedDirty(false);
      setAdvancedError(null);
      setSavedAt(Date.now());
      // Pull a fresh meta so the modifiedAt + name sync is reflected.
      const fresh = await EditorProjectStore.getProject(projectId);
      if (fresh) setMeta(fresh);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const handleSelectScene = async (path: string) => {
    setSelectedScene(path);
    // Pin the live viewport to whatever scene the user just clicked
    // so the read-only JSON preview and the engine stay in sync.
    setViewportScene(path);
    setSelectedSceneBody(null);
    setSelectedSceneLoading(true);
    try {
      const body = await EditorProjectStore.loadAsset(projectId, path);
      if (typeof body === "string") {
        try {
          // Pretty-print if it's JSON; otherwise show raw text.
          setSelectedSceneBody(JSON.stringify(JSON.parse(body), null, 2));
        } catch {
          setSelectedSceneBody(body);
        }
      } else if (body instanceof Blob) {
        setSelectedSceneBody(await body.text());
      } else {
        setSelectedSceneBody(null);
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSelectedSceneLoading(false);
    }
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
          {sceneDirty ? (
            <span className="text-xs text-amber-300">● Scene unsaved</span>
          ) : sceneSavedAt ? (
            <span className="text-xs text-emerald-400">
              Scene saved {new Date(sceneSavedAt).toLocaleTimeString()}
            </span>
          ) : null}
          {editScene && editScenePath ? (
            <Button
              variant="secondary"
              size="sm"
              onClick={persistScene}
              disabled={sceneSaving || !sceneDirty}
            >
              {sceneSaving ? "Saving…" : "Save scene"}
            </Button>
          ) : null}
          {savedAt ? (
            <span className="text-xs text-emerald-400">
              Manifest saved {new Date(savedAt).toLocaleTimeString()}
            </span>
          ) : null}
          <Button
            variant="primary"
            size="sm"
            onClick={handleSaveManifest}
            disabled={saving}
          >
            {saving ? "Saving…" : "Save manifest"}
          </Button>
        </div>
      </header>

      {/* Workflow-mode tab strip — EDITOR.md §5.1 + ANIMATION_EDITOR.md §5.1.
          AE1 ships the Animation mode; the other four reuse today's
          combined viewport+manifest+scenes surface. */}
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
          {/* Animation mode — replaces the combined surface with a
              dedicated three-column shell per ANIMATION_EDITOR.md §5.2. */}
          <div className="h-[calc(100vh-128px)] border-t border-zinc-800">
            <AnimationEditor
              projectId={projectId}
              onManifestChanged={() => {
                // Refresh manifest + asset list so the other modes
                // pick up the new sprite without a remount.
                refresh();
              }}
            />
          </div>
        </main>
      ) : (
      <main className="px-8 py-6 max-w-7xl mx-auto space-y-6">
        {/* Viewport pane — live engine bound to the selected scene
            (or manifest.startScene). Tab swaps Play / Edit. E3 will
            replace the Edit-mode pass-through with the grid editor. */}
        <Card className="overflow-hidden">
          <CardHeader>
            <CardTitle>Viewport</CardTitle>
            <CardDescription>
              Live engine on the active scene. Click the canvas to
              capture pointer lock (Play mode). Press Tab to toggle
              Play / Edit.
            </CardDescription>
          </CardHeader>
          <div className="h-[560px] border-t border-zinc-800">
            <EditorViewport
              projectId={projectId}
              sceneName={
                viewportScene ?? form?.startScene ?? manifest?.startScene
              }
              onSceneResolved={(path) => {
                // Sync the right-pane scene-list highlight when the
                // viewport boots against `manifest.startScene` (no
                // explicit click happened yet).
                if (!viewportScene) setViewportScene(path);
                if (!selectedScene) setSelectedScene(path);
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
            />
          </div>
        </Card>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Manifest</CardTitle>
            <CardDescription>
              Edit the pack's top-level metadata. Round-trips with the
              imported <code>manifest.json</code>.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {form ? (
              <>
                <FormField label="id" htmlFor="m-id">
                  <Input
                    id="m-id"
                    value={form.id}
                    onChange={(e) =>
                      setForm({ ...form, id: e.target.value })
                    }
                    placeholder="my-pack"
                  />
                </FormField>
                <FormField label="name" htmlFor="m-name">
                  <Input
                    id="m-name"
                    value={form.name}
                    onChange={(e) =>
                      setForm({ ...form, name: e.target.value })
                    }
                  />
                </FormField>
                <div className="grid grid-cols-2 gap-3">
                  <FormField label="version" htmlFor="m-version">
                    <Input
                      id="m-version"
                      value={form.version}
                      onChange={(e) =>
                        setForm({ ...form, version: e.target.value })
                      }
                      placeholder="0.1.0"
                    />
                  </FormField>
                  <FormField label="engine" htmlFor="m-engine">
                    <Input
                      id="m-engine"
                      value={form.engine}
                      onChange={(e) =>
                        setForm({ ...form, engine: e.target.value })
                      }
                      placeholder="*"
                    />
                  </FormField>
                </div>
                <FormField label="startScene" htmlFor="m-start">
                  <select
                    id="m-start"
                    value={form.startScene}
                    onChange={(e) =>
                      setForm({ ...form, startScene: e.target.value })
                    }
                    className={cn(
                      "flex h-9 w-full rounded-md border border-zinc-700 bg-zinc-950 px-3 py-1 text-sm",
                      "text-zinc-100 focus-visible:outline-none focus-visible:ring-2",
                      "focus-visible:ring-amber-400",
                    )}
                  >
                    {/* Always include the current value so a custom
                        path stays visible even if no matching scene
                        asset exists yet. */}
                    {form.startScene &&
                    !sceneAssets.some((s) => s.path === form.startScene) ? (
                      <option value={form.startScene}>
                        {form.startScene} (not in pack)
                      </option>
                    ) : null}
                    {sceneAssets.length === 0 ? (
                      <option value="">(no scenes in pack)</option>
                    ) : null}
                    {sceneAssets.map((s) => (
                      <option key={s.path} value={s.path}>
                        {s.path}
                      </option>
                    ))}
                  </select>
                </FormField>
                <FormField label="description" htmlFor="m-desc">
                  <Textarea
                    id="m-desc"
                    value={form.description}
                    onChange={(e) =>
                      setForm({ ...form, description: e.target.value })
                    }
                    rows={2}
                  />
                </FormField>
                <div className="grid grid-cols-2 gap-3">
                  <FormField label="author" htmlFor="m-author">
                    <Input
                      id="m-author"
                      value={form.author}
                      onChange={(e) =>
                        setForm({ ...form, author: e.target.value })
                      }
                    />
                  </FormField>
                  <FormField label="homepage" htmlFor="m-home">
                    <Input
                      id="m-home"
                      value={form.homepage}
                      onChange={(e) =>
                        setForm({ ...form, homepage: e.target.value })
                      }
                      placeholder="https://…"
                    />
                  </FormField>
                </div>

                <details className="mt-2">
                  <summary className="text-xs uppercase tracking-wide text-zinc-400 cursor-pointer hover:text-zinc-200">
                    Advanced (raw JSON for everything else)
                  </summary>
                  <p className="text-xs text-zinc-500 mt-2 leading-relaxed">
                    tilePresets, items, sprites, lighting, shaders,
                    requires — round-trip as JSON here. Nested
                    inspectors land in E3-E4.
                  </p>
                  <Textarea
                    value={advancedJson}
                    onChange={(e) => {
                      setAdvancedJson(e.target.value);
                      setAdvancedDirty(true);
                      setAdvancedError(null);
                    }}
                    className="mt-2 min-h-[160px]"
                    spellCheck={false}
                  />
                  {advancedError ? (
                    <div className="mt-1 text-xs text-red-400">
                      {advancedError}
                    </div>
                  ) : null}
                  {advancedDirty && !advancedError ? (
                    <div className="mt-1 text-xs text-amber-400">
                      Unsaved changes — click "Save manifest" to apply.
                    </div>
                  ) : null}
                </details>
              </>
            ) : (
              <div className="text-sm text-zinc-500">
                Manifest not found for this project.
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Scenes</CardTitle>
            <CardDescription>
              {sceneAssets.length === 0
                ? "This pack has no scenes/*.json assets yet."
                : `${sceneAssets.length} scene file${sceneAssets.length === 1 ? "" : "s"}.`}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {sceneAssets.length > 0 ? (
              <ul className="divide-y divide-zinc-800 -mx-3">
                {sceneAssets.map((s) => (
                  <li
                    key={s.path}
                    className={cn(
                      "px-3 py-2 hover:bg-zinc-800/40 rounded-md cursor-pointer flex items-center justify-between",
                      selectedScene === s.path && "bg-zinc-800/60",
                    )}
                    onClick={() => handleSelectScene(s.path)}
                  >
                    <div className="text-sm text-zinc-100 flex items-center gap-2">
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
                    <div className="text-xs text-zinc-500">
                      {formatBytes(s.sizeBytes)}
                    </div>
                  </li>
                ))}
              </ul>
            ) : null}

            {selectedScene ? (
              <div className="mt-4">
                <div className="text-xs text-zinc-400 mb-2 font-mono">
                  {selectedScene}{" "}
                  <span className="text-zinc-600">(read-only in E1)</span>
                </div>
                <pre className="text-xs bg-zinc-950 border border-zinc-800 rounded-md p-3 overflow-auto max-h-[420px] font-mono text-zinc-300">
                  {selectedSceneLoading
                    ? "Loading…"
                    : (selectedSceneBody ?? "(empty)")}
                </pre>
              </div>
            ) : null}

            {assets.length > 0 ? (
              <details className="mt-6">
                <summary className="text-xs uppercase tracking-wide text-zinc-400 cursor-pointer hover:text-zinc-200">
                  All assets ({assets.length})
                </summary>
                <ul className="mt-2 text-xs text-zinc-400 font-mono space-y-0.5 max-h-48 overflow-auto">
                  {assets.map((a) => (
                    <li
                      key={a.path}
                      className="flex justify-between gap-3"
                    >
                      <span className="truncate">{a.path}</span>
                      <span className="text-zinc-600 shrink-0">
                        {a.kind} · {formatBytes(a.sizeBytes)}
                      </span>
                    </li>
                  ))}
                </ul>
              </details>
            ) : null}
          </CardContent>
        </Card>
        </div>
      </main>
      )}
    </div>
  );
}

function FormField({
  label,
  htmlFor,
  children,
}: {
  label: string;
  htmlFor: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <Label htmlFor={htmlFor}>{label}</Label>
      <div className="mt-1.5">{children}</div>
    </div>
  );
}

import React from "react";
import {
  Image as ImageIcon,
  Volume2,
  Code2,
  Boxes,
  Grid3x3,
  FileCode,
  Sun,
  Wand2,
  AudioWaveform,
  Filter,
  LayoutGrid,
  List as ListIcon,
  Trash2,
  Copy as CopyIcon,
  Pencil,
  Eye,
  Play,
  X,
  PackageOpen,
  Upload,
  Folder,
  FolderOpen,
  ChevronRight,
  ChevronDown,
  ExternalLink,
} from "lucide-react";
import {
  EditorProjectStore,
  type AssetMeta,
} from "../lib/EditorProjectStore";
import { Card, Button, Modal, Input } from "../components/ui";
import { Badge, type BadgeVariant } from "../components/ui/Badge";
import { SegmentedControl } from "../components/ui/controls";
import { PanelHeader } from "../components/ui/PanelHeader";
import { ScrollArea } from "../components/ui/ScrollArea";
import { CollapsibleSection } from "../components/ui/CollapsibleSection";
import { PropertyRow } from "../components/ui/PropertyRow";
import { IconButton } from "../components/ui/IconButton";
import { EmptyState } from "../components/ui/EmptyState";
import { Tooltip } from "../components/ui/Tooltip";
import { FilePicker } from "../components/ui/FilePicker";
import { useStatusBar } from "../shell/StatusBarContext";
import { useEditorActions } from "../shell/EditorActionsContext";
import type { PrimaryTabId } from "../shell/PrimaryTabs";
import { cn } from "../lib/cn";

/**
 * AssetsView — R4g, aligned with EDITOR_REDESIGN §7.7 spec restated by
 * the redesign agent: a 3-column workbench grid composed of cardboard
 * R2 primitives.
 *
 *   ┌───────────────┬──────────────────────┬───────────────────┐
 *   │ Folder tree   │  Asset grid (fluid)  │  Asset inspector  │
 *   │ (left rail)   │  + action toolbar    │  (right rail)     │
 *   └───────────────┴──────────────────────┴───────────────────┘
 *
 * The left rail combines a "type filter" section (all assets, sprites,
 * sounds, scripts, …) with a path-derived folder tree pulled from
 * `EditorProjectStore.listAssets()`. Selecting either filters the
 * center grid; the tree branches act as virtual folders driven by the
 * `/`-segmented asset path.
 *
 * The center grid renders one R2 `Card` per asset with hover Tooltip,
 * Badge chips for type + size, and drag-source wiring (text/plain ⇒
 * `cardboard://asset/<type>/<id>`). A `SegmentedControl` toggles
 * between icon and list view modes.
 *
 * The right rail is an asset inspector composed of `CollapsibleSection`
 * blocks: preview (image / audio audition), metadata (PropertyRow
 * fields), and usage (where-used placeholder). Upload, rename, and
 * delete actions live as `Button` / `IconButton`s. The upload flow
 * opens a `Modal` wrapping a `FilePicker` dropzone.
 *
 * Wiring with the rest of the editor:
 *   - Sprite + lightmap selections double-click into a fullscreen
 *     PreviewModal.
 *   - Script / shader rows dispatch a `cardboard:set-tab` ⇒ scripts.
 *   - Prefab rows dispatch ⇒ prefabs; presets ⇒ scene.
 *   - Recipe rows dispatch ⇒ imageLab / soundLab.
 *   - useStatusBar pushes asset count + total bytes per §6.4.
 *
 * Constraints honored:
 *   - All primitive imports come from `components/ui` (R2 surface).
 *   - The shell contexts (StatusBar, EditorActions) are read but never
 *     written to from this file.
 *   - No new fetch / IDB helpers — uses the existing store API.
 */

/* -------------------------------------------------------------------- */
/* Type classification                                                   */
/* -------------------------------------------------------------------- */

export type AssetType =
  | "sprite"
  | "sound"
  | "script"
  | "prefab"
  | "preset"
  | "shader"
  | "lightmap"
  | "imageRecipe"
  | "soundRecipe";

export interface ResolvedAsset {
  /** Stable identity within the project — typically the asset path. */
  id: string;
  /** Display name (last path segment, no extension). */
  name: string;
  type: AssetType;
  /** Pack-relative path; the IDB primary key. */
  path: string;
  /** Optional sub-classification (for sprite-source variants). */
  subKind?: "spritesheet" | "fbx" | "loose-frames";
  sizeBytes: number;
  updatedAt: number;
  /** True for procedural recipes (decorated with IL/SL badge). */
  procedural?: "image" | "sound";
}

const TYPE_LABELS: Record<AssetType, string> = {
  sprite: "Sprites",
  sound: "Sounds",
  script: "Scripts",
  prefab: "Prefabs",
  preset: "Tile Presets",
  shader: "Shaders",
  lightmap: "Lightmaps",
  imageRecipe: "Image Recipes",
  soundRecipe: "Sound Recipes",
};

const TYPE_ICONS: Record<AssetType, React.ReactNode> = {
  sprite: <ImageIcon size={14} />,
  sound: <Volume2 size={14} />,
  script: <Code2 size={14} />,
  prefab: <Boxes size={14} />,
  preset: <Grid3x3 size={14} />,
  shader: <FileCode size={14} />,
  lightmap: <Sun size={14} />,
  imageRecipe: <Wand2 size={14} />,
  soundRecipe: <AudioWaveform size={14} />,
};

const TYPE_ACCENT: Record<AssetType, BadgeVariant> = {
  sprite: "amber",
  sound: "sky",
  script: "emerald",
  prefab: "purple",
  preset: "yellow",
  shader: "red",
  lightmap: "yellow",
  imageRecipe: "amber",
  soundRecipe: "sky",
};

const TYPE_ORDER: ReadonlyArray<AssetType> = [
  "sprite",
  "sound",
  "script",
  "prefab",
  "preset",
  "shader",
  "lightmap",
  "imageRecipe",
  "soundRecipe",
];

const AUDIO_EXTS = new Set(["wav", "mp3", "ogg", "flac", "aac", "m4a"]);
const IMAGE_EXTS = new Set(["png", "jpg", "jpeg", "gif", "webp", "bmp"]);
const SCRIPT_EXTS = new Set(["js", "ts", "mjs", "jsx", "tsx"]);
const SHADER_EXTS = new Set(["glsl", "frag", "vert"]);

function getExt(path: string): string {
  const dot = path.lastIndexOf(".");
  if (dot === -1) return "";
  return path.slice(dot + 1).toLowerCase();
}

function classifyAsset(meta: AssetMeta): AssetType | null {
  const ext = getExt(meta.path);
  const p = meta.path.toLowerCase();

  // Recipes — prefer specificity over path prefix.
  if (p.endsWith(".sound.recipe.json")) return "soundRecipe";
  if (p.endsWith(".recipe.json")) return "imageRecipe";

  if (p.startsWith("lightmaps/") && IMAGE_EXTS.has(ext)) return "lightmap";
  if (p.startsWith("shaders/") || SHADER_EXTS.has(ext)) return "shader";
  if (p.startsWith("presets/")) return "preset";
  if (p.startsWith("prefabs/")) return "prefab";

  if (SCRIPT_EXTS.has(ext)) return "script";
  if (AUDIO_EXTS.has(ext)) return "sound";
  if (IMAGE_EXTS.has(ext)) return "sprite";

  return null;
}

function baseName(path: string): string {
  const slash = path.lastIndexOf("/");
  const tail = slash === -1 ? path : path.slice(slash + 1);
  const dot = tail.lastIndexOf(".");
  return dot === -1 ? tail : tail.slice(0, dot);
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}

function formatTimestamp(ms: number): string {
  try {
    return new Date(ms).toLocaleString();
  } catch {
    return "—";
  }
}

/* -------------------------------------------------------------------- */
/* Cross-tab navigation event                                            */
/* -------------------------------------------------------------------- */

export interface SetTabEventDetail {
  tab: PrimaryTabId;
  assetId?: string;
}
export const SET_TAB_EVENT = "cardboard:set-tab";

function navigateTab(tab: PrimaryTabId, assetId?: string) {
  try {
    window.dispatchEvent(
      new CustomEvent<SetTabEventDetail>(SET_TAB_EVENT, {
        detail: { tab, assetId },
      }),
    );
  } catch {
    // ignore — non-browser env (test runner)
  }
}

/* -------------------------------------------------------------------- */
/* Folder tree — built from asset paths                                  */
/* -------------------------------------------------------------------- */

interface FolderNode {
  name: string;
  /** Full prefix from project root (no leading slash, no trailing). */
  path: string;
  children: Map<string, FolderNode>;
  /** Direct file count (assets whose dirname == this node's path). */
  fileCount: number;
  /** Aggregate count (this + descendants). */
  totalCount: number;
}

function buildFolderTree(assets: ResolvedAsset[]): FolderNode {
  const root: FolderNode = {
    name: "All Folders",
    path: "",
    children: new Map(),
    fileCount: 0,
    totalCount: 0,
  };
  for (const a of assets) {
    const segs = a.path.split("/").slice(0, -1); // drop filename
    let node = root;
    root.totalCount++;
    if (segs.length === 0) {
      root.fileCount++;
      continue;
    }
    let acc = "";
    for (const seg of segs) {
      acc = acc ? `${acc}/${seg}` : seg;
      let child = node.children.get(seg);
      if (!child) {
        child = {
          name: seg,
          path: acc,
          children: new Map(),
          fileCount: 0,
          totalCount: 0,
        };
        node.children.set(seg, child);
      }
      child.totalCount++;
      node = child;
    }
    node.fileCount++;
  }
  return root;
}

/* -------------------------------------------------------------------- */
/* AssetsView                                                             */
/* -------------------------------------------------------------------- */

export interface AssetsViewProps {
  projectId: string;
}

export function AssetsView({ projectId }: AssetsViewProps) {
  const [rawAssets, setRawAssets] = React.useState<AssetMeta[]>([]);
  const [spriteSourceIds, setSpriteSourceIds] = React.useState<string[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [refreshTick, setRefreshTick] = React.useState(0);

  // UI state
  const [search, setSearch] = React.useState("");
  const [typeFilter, setTypeFilter] = React.useState<AssetType | null>(null);
  /** Selected folder prefix (e.g. `"images/sprites"`). `""` = root /
   *  all folders. */
  const [folderPath, setFolderPath] = React.useState<string>("");
  const [viewMode, setViewMode] = React.useState<"grid" | "list">("grid");
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const [uploadOpen, setUploadOpen] = React.useState(false);

  // Preview modal (sprites + lightmaps)
  const [previewAsset, setPreviewAsset] = React.useState<ResolvedAsset | null>(
    null,
  );

  // Rename modal state
  const [renameTarget, setRenameTarget] = React.useState<ResolvedAsset | null>(
    null,
  );
  const [renameValue, setRenameValue] = React.useState("");

  // Context menu state — anchored at clientX/clientY.
  const [contextMenu, setContextMenu] = React.useState<{
    asset: ResolvedAsset;
    x: number;
    y: number;
  } | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const [assets, spriteSources] = await Promise.all([
          EditorProjectStore.listAssets(projectId),
          EditorProjectStore.listSpriteSources(projectId).catch(() => []),
        ]);
        if (cancelled) return;
        setRawAssets(assets);
        setSpriteSourceIds(spriteSources.map((s) => s.spriteId));
        setError(null);
      } catch (err) {
        if (!cancelled) setError((err as Error).message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [projectId, refreshTick]);

  /* ---------------- Resolve raw assets → typed asset list ---------------- */

  const resolved = React.useMemo<ResolvedAsset[]>(() => {
    const out: ResolvedAsset[] = [];
    const seenSpritePaths = new Set<string>();

    for (const a of rawAssets) {
      const type = classifyAsset(a);
      if (!type) continue;
      const name = baseName(a.path);
      const procedural =
        type === "imageRecipe" ? "image"
          : type === "soundRecipe" ? "sound"
          : undefined;
      out.push({
        id: a.path,
        name,
        type,
        path: a.path,
        sizeBytes: a.sizeBytes,
        updatedAt: a.updatedAt,
        procedural,
      });
      if (type === "sprite") seenSpritePaths.add(a.path);
    }

    for (const sid of spriteSourceIds) {
      const expectedPath = `images/sprites/${sid}-sheet.png`;
      if (seenSpritePaths.has(expectedPath)) continue;
      out.push({
        id: `spriteSource:${sid}`,
        name: sid,
        type: "sprite",
        path: expectedPath,
        sizeBytes: 0,
        updatedAt: 0,
      });
    }

    out.sort((a, b) => a.name.localeCompare(b.name));
    return out;
  }, [rawAssets, spriteSourceIds]);

  /* ---------------- Folder tree ---------------- */

  const folderTree = React.useMemo(
    () => buildFolderTree(resolved),
    [resolved],
  );

  /* ---------------- Filter + search ---------------- */

  const visible = React.useMemo(() => {
    const q = search.trim().toLowerCase();
    return resolved.filter((a) => {
      if (typeFilter && a.type !== typeFilter) return false;
      if (folderPath) {
        const prefix = `${folderPath}/`;
        if (!a.path.startsWith(prefix)) return false;
      }
      if (q && !a.name.toLowerCase().includes(q) && !a.path.toLowerCase().includes(q)) {
        return false;
      }
      return true;
    });
  }, [resolved, typeFilter, folderPath, search]);

  const counts = React.useMemo(() => {
    const map: Record<AssetType, number> = {
      sprite: 0,
      sound: 0,
      script: 0,
      prefab: 0,
      preset: 0,
      shader: 0,
      lightmap: 0,
      imageRecipe: 0,
      soundRecipe: 0,
    };
    for (const a of resolved) map[a.type]++;
    return map;
  }, [resolved]);

  const totalBytes = React.useMemo(
    () => resolved.reduce((sum, a) => sum + a.sizeBytes, 0),
    [resolved],
  );

  const visibleBytes = React.useMemo(
    () => visible.reduce((sum, a) => sum + a.sizeBytes, 0),
    [visible],
  );

  const selected = React.useMemo(
    () => visible.find((a) => a.id === selectedId) ?? null,
    [visible, selectedId],
  );

  /* ---------------- StatusBar registration ---------------- */
  /* Per §6.4 the Assets status bar shows: count, total bytes, and the
   * active filter state. We register on mount and clear on unmount. */

  const { setSections } = useStatusBar();
  React.useEffect(() => {
    const filterValue = typeFilter
      ? `${TYPE_LABELS[typeFilter]}: ${counts[typeFilter]}`
      : folderPath
        ? folderPath
        : "All";
    setSections([
      {
        id: "asset-count",
        label: "Assets",
        value: `${visible.length} / ${resolved.length}`,
      },
      {
        id: "asset-bytes",
        label: "Size",
        value: `${formatBytes(visibleBytes)} / ${formatBytes(totalBytes)}`,
      },
      {
        id: "asset-filter",
        label: "Filter",
        value: filterValue,
      },
      {
        id: "asset-selected",
        label: "Selected",
        value: selected?.name ?? "—",
        align: "right",
      },
    ]);
    return () => setSections([]);
  }, [
    visible.length,
    resolved.length,
    visibleBytes,
    totalBytes,
    typeFilter,
    folderPath,
    counts,
    selected,
    setSections,
  ]);

  /* ---------------- EditorActions registration ---------------- */

  const { register } = useEditorActions();
  React.useEffect(() => {
    return register({
      save: async () => {
        // No uncommitted state in R4g — every asset mutation routes
        // straight through EditorProjectStore.{save,delete}Asset, which
        // persists synchronously. Reserved for future rename/tagging.
      },
    });
  }, [register]);

  /* ---------------- Asset actions ---------------- */

  const openAsset = React.useCallback((a: ResolvedAsset) => {
    setSelectedId(a.id);
    switch (a.type) {
      case "sprite":
      case "lightmap":
        setPreviewAsset(a);
        return;
      case "sound":
        return;
      case "script":
      case "shader":
        navigateTab("scripts", a.id);
        return;
      case "prefab":
        navigateTab("prefabs", a.id);
        return;
      case "preset":
        navigateTab("scene", a.id);
        return;
      case "imageRecipe":
        navigateTab("imageLab", a.id);
        return;
      case "soundRecipe":
        navigateTab("soundLab", a.id);
        return;
    }
  }, []);

  const handleContextMenu = React.useCallback(
    (e: React.MouseEvent, a: ResolvedAsset) => {
      e.preventDefault();
      setSelectedId(a.id);
      setContextMenu({ asset: a, x: e.clientX, y: e.clientY });
    },
    [],
  );

  const handleDelete = React.useCallback(
    async (a: ResolvedAsset) => {
      if (a.id.startsWith("spriteSource:")) return;
      // eslint-disable-next-line no-alert
      if (!confirm(`Delete asset "${a.name}"? This cannot be undone.`)) return;
      try {
        await EditorProjectStore.deleteAsset(projectId, a.path);
        setRefreshTick((n) => n + 1);
        if (selectedId === a.id) setSelectedId(null);
      } catch (err) {
        setError((err as Error).message);
      }
    },
    [projectId, selectedId],
  );

  const handleDuplicate = React.useCallback(
    async (a: ResolvedAsset) => {
      try {
        const body = await EditorProjectStore.loadAsset(projectId, a.path);
        if (body === null) return;
        const dot = a.path.lastIndexOf(".");
        const stem = dot === -1 ? a.path : a.path.slice(0, dot);
        const ext = dot === -1 ? "" : a.path.slice(dot);
        const newPath = `${stem}-copy${ext}`;
        await EditorProjectStore.saveAsset(projectId, newPath, body);
        setRefreshTick((n) => n + 1);
      } catch (err) {
        setError((err as Error).message);
      }
    },
    [projectId],
  );

  const handleRename = React.useCallback(
    async (a: ResolvedAsset, nextName: string) => {
      const trimmed = nextName.trim();
      if (!trimmed || trimmed === baseName(a.path)) return;
      try {
        const body = await EditorProjectStore.loadAsset(projectId, a.path);
        if (body === null) return;
        const slash = a.path.lastIndexOf("/");
        const dir = slash === -1 ? "" : a.path.slice(0, slash + 1);
        const ext = (() => {
          const dot = a.path.lastIndexOf(".");
          return dot === -1 ? "" : a.path.slice(dot);
        })();
        const newPath = `${dir}${trimmed}${ext}`;
        if (newPath === a.path) return;
        await EditorProjectStore.saveAsset(projectId, newPath, body);
        await EditorProjectStore.deleteAsset(projectId, a.path);
        setRefreshTick((n) => n + 1);
        if (selectedId === a.id) setSelectedId(newPath);
      } catch (err) {
        setError((err as Error).message);
      }
    },
    [projectId, selectedId],
  );

  const handleUploadFiles = React.useCallback(
    async (files: File[]) => {
      const dirPrefix = folderPath ? `${folderPath}/` : "images/";
      try {
        for (const file of files) {
          const path = `${dirPrefix}${file.name}`;
          await EditorProjectStore.saveAsset(projectId, path, file);
        }
        setRefreshTick((n) => n + 1);
        setUploadOpen(false);
      } catch (err) {
        setError((err as Error).message);
      }
    },
    [projectId, folderPath],
  );

  /* ---------------- Render ---------------- */

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center text-zinc-500 text-sm">
        Loading assets…
      </div>
    );
  }

  const projectEmpty = resolved.length === 0;

  return (
    <div
      className={cn(
        "h-full w-full overflow-hidden bg-zinc-950 text-zinc-100",
        // §6.5 Body layout grammar — 3-pane workbench.
        "grid grid-cols-[280px_1fr_360px] gap-0",
      )}
    >
      {/* ─── Left rail: folder tree ─── */}
      <FolderTreeRail
        tree={folderTree}
        counts={counts}
        totalAssets={resolved.length}
        typeFilter={typeFilter}
        onTypeFilter={setTypeFilter}
        folderPath={folderPath}
        onFolderPath={setFolderPath}
        search={search}
        onSearch={setSearch}
      />

      {/* ─── Center: asset grid ─── */}
      <section
        className={cn(
          "min-h-0 min-w-0 flex flex-col overflow-hidden",
          "border-x border-zinc-800/80 bg-zinc-950",
        )}
      >
        <PanelHeader
          title="Assets"
          action={
            <div className="flex items-center gap-2">
              <Badge variant="zinc" outlined>
                {visible.length}
              </Badge>
              <SegmentedControl<"grid" | "list">
                aria-label="View mode"
                size="sm"
                value={viewMode}
                onChange={(v) => v && setViewMode(v)}
                options={[
                  { id: "grid", icon: <LayoutGrid size={12} />, label: "Grid" },
                  { id: "list", icon: <ListIcon size={12} />, label: "List" },
                ]}
              />
              <Tooltip content="Upload files into the selected folder">
                <Button
                  variant="primary"
                  size="sm"
                  onClick={() => setUploadOpen(true)}
                  className="gap-1.5"
                >
                  <Upload size={12} />
                  Upload
                </Button>
              </Tooltip>
            </div>
          }
        />

        {error && (
          <div className="mx-4 mt-3 rounded-md border border-red-800 bg-red-950/50 px-3 py-2 text-xs text-red-200">
            {error}
          </div>
        )}

        <div className="flex-1 min-h-0 min-w-0 overflow-hidden">
          {projectEmpty ? (
            <div className="h-full flex items-center justify-center">
              <EmptyState
                tutorial="assets-intro"
                icon={<PackageOpen size={28} />}
                title="No assets in this project"
                description="Imported sprites, sounds, scripts, prefabs, and recipes will appear here. Use Upload to add files, or drag files into other views."
                action={
                  <Button
                    variant="primary"
                    size="sm"
                    onClick={() => setUploadOpen(true)}
                    className="gap-1.5"
                  >
                    <Upload size={12} />
                    Upload files
                  </Button>
                }
              />
            </div>
          ) : visible.length === 0 ? (
            <div className="h-full flex items-center justify-center">
              <EmptyState
                tutorial="assets-intro"
                icon={<Filter size={28} />}
                title="No matches"
                description="No assets match the current filter. Clear the folder or type filter, or adjust the search to see more."
                action={
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => {
                      setTypeFilter(null);
                      setFolderPath("");
                      setSearch("");
                    }}
                  >
                    Clear filters
                  </Button>
                }
              />
            </div>
          ) : viewMode === "grid" ? (
            <ScrollArea className="h-full" fade={false}>
              <div className="p-4 grid grid-cols-[repeat(auto-fill,minmax(160px,1fr))] gap-3">
                {visible.map((a) => (
                  <AssetTile
                    key={a.id}
                    asset={a}
                    selected={selectedId === a.id}
                    projectId={projectId}
                    onClick={() => {
                      setSelectedId(a.id);
                    }}
                    onDoubleClick={() => openAsset(a)}
                    onContextMenu={(e) => handleContextMenu(e, a)}
                  />
                ))}
              </div>
            </ScrollArea>
          ) : (
            <ScrollArea className="h-full" fade={false}>
              <div className="p-2">
                <div className="grid grid-cols-[40px_1fr_120px_100px_120px] items-center px-2 py-1 text-[10px] uppercase tracking-wider text-zinc-500 border-b border-zinc-800 sticky top-0 bg-zinc-950 z-10">
                  <div />
                  <div>Name</div>
                  <div>Type</div>
                  <div>Size</div>
                  <div>Modified</div>
                </div>
                {visible.map((a) => (
                  <AssetRow
                    key={a.id}
                    asset={a}
                    selected={selectedId === a.id}
                    projectId={projectId}
                    onClick={() => setSelectedId(a.id)}
                    onDoubleClick={() => openAsset(a)}
                    onContextMenu={(e) => handleContextMenu(e, a)}
                  />
                ))}
              </div>
            </ScrollArea>
          )}
        </div>
      </section>

      {/* ─── Right rail: inspector ─── */}
      <AssetInspectorRail
        asset={selected}
        projectId={projectId}
        onPreview={() => selected && setPreviewAsset(selected)}
        onOpen={() => selected && openAsset(selected)}
        onDelete={() => selected && handleDelete(selected)}
        onDuplicate={() => selected && handleDuplicate(selected)}
        onRename={() => {
          if (!selected) return;
          setRenameTarget(selected);
          setRenameValue(baseName(selected.path));
        }}
        totalCount={resolved.length}
        totalBytes={totalBytes}
      />

      {/* ─── Context menu ─── */}
      {contextMenu && (
        <ContextMenu
          asset={contextMenu.asset}
          x={contextMenu.x}
          y={contextMenu.y}
          onClose={() => setContextMenu(null)}
          onEdit={(a) => {
            setContextMenu(null);
            openAsset(a);
          }}
          onDuplicate={(a) => {
            setContextMenu(null);
            void handleDuplicate(a);
          }}
          onRename={(a) => {
            setContextMenu(null);
            setRenameTarget(a);
            setRenameValue(baseName(a.path));
          }}
          onDelete={(a) => {
            setContextMenu(null);
            void handleDelete(a);
          }}
        />
      )}

      {/* ─── Preview modal ─── */}
      {previewAsset && (
        <PreviewModal
          asset={previewAsset}
          projectId={projectId}
          onClose={() => setPreviewAsset(null)}
        />
      )}

      {/* ─── Upload modal ─── */}
      <Modal
        open={uploadOpen}
        onClose={() => setUploadOpen(false)}
        title="Upload assets"
        footer={
          <Button variant="secondary" onClick={() => setUploadOpen(false)}>
            Cancel
          </Button>
        }
      >
        <div className="space-y-3">
          <p className="text-xs text-zinc-400">
            Files will be saved under{" "}
            <span className="font-mono text-zinc-200">
              {folderPath ? `${folderPath}/` : "images/"}
            </span>
            . Drag and drop multiple files at once.
          </p>
          <FilePicker
            mode="dropzone"
            multiple
            onFiles={(files) => void handleUploadFiles(files)}
          />
        </div>
      </Modal>

      {/* ─── Rename modal ─── */}
      <Modal
        open={renameTarget !== null}
        onClose={() => setRenameTarget(null)}
        title="Rename asset"
        footer={
          <>
            <Button variant="secondary" onClick={() => setRenameTarget(null)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              onClick={() => {
                if (renameTarget) void handleRename(renameTarget, renameValue);
                setRenameTarget(null);
              }}
            >
              Rename
            </Button>
          </>
        }
      >
        <div className="space-y-2">
          <label className="text-[11px] uppercase tracking-wider text-zinc-400 font-medium">
            New name
          </label>
          <Input
            autoFocus
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            placeholder="filename (without extension)"
          />
          {renameTarget && (
            <p className="text-xs text-zinc-500 font-mono truncate">
              {renameTarget.path}
            </p>
          )}
        </div>
      </Modal>
    </div>
  );
}

/* -------------------------------------------------------------------- */
/* FolderTreeRail — left rail (PanelHeader + ScrollArea + tree)         */
/* -------------------------------------------------------------------- */

interface FolderTreeRailProps {
  tree: FolderNode;
  counts: Record<AssetType, number>;
  totalAssets: number;
  typeFilter: AssetType | null;
  onTypeFilter: (t: AssetType | null) => void;
  folderPath: string;
  onFolderPath: (p: string) => void;
  search: string;
  onSearch: (v: string) => void;
}

function FolderTreeRail({
  tree,
  counts,
  totalAssets,
  typeFilter,
  onTypeFilter,
  folderPath,
  onFolderPath,
  search,
  onSearch,
}: FolderTreeRailProps) {
  return (
    <aside
      className={cn(
        "min-h-0 flex flex-col overflow-hidden",
        "bg-zinc-950/60",
      )}
    >
      <PanelHeader
        title="Library"
        action={
          <Badge variant="zinc" outlined>
            {totalAssets}
          </Badge>
        }
      />
      <div className="px-3 pt-3 pb-2">
        <Input
          value={search}
          onChange={(e) => onSearch(e.target.value)}
          placeholder="Search assets…"
          className="h-8 text-xs"
        />
      </div>
      <ScrollArea className="flex-1" fade={false}>
        <div className="px-2 pb-4 space-y-1">
          <SectionLabel>Filter by type</SectionLabel>
          <FilterRow
            label="All assets"
            icon={<Filter size={12} />}
            count={totalAssets}
            active={typeFilter === null && folderPath === ""}
            accent="zinc"
            onClick={() => {
              onTypeFilter(null);
              onFolderPath("");
            }}
          />
          {TYPE_ORDER.map((t) => (
            <FilterRow
              key={t}
              label={TYPE_LABELS[t]}
              icon={TYPE_ICONS[t]}
              count={counts[t]}
              active={typeFilter === t}
              accent={TYPE_ACCENT[t]}
              onClick={() => onTypeFilter(typeFilter === t ? null : t)}
            />
          ))}

          <div className="h-2" />
          <SectionLabel>Folders</SectionLabel>
          <FolderRow
            label="All folders"
            icon={<FolderOpen size={12} />}
            count={tree.totalCount}
            depth={0}
            active={folderPath === ""}
            onClick={() => onFolderPath("")}
          />
          {Array.from(tree.children.values())
            .sort((a, b) => a.name.localeCompare(b.name))
            .map((child) => (
              <FolderTreeNode
                key={child.path}
                node={child}
                depth={1}
                selectedPath={folderPath}
                onSelect={onFolderPath}
              />
            ))}
        </div>
      </ScrollArea>
    </aside>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="px-2 pt-2 pb-1 text-[10px] uppercase tracking-wider text-zinc-500 font-semibold">
      {children}
    </div>
  );
}

interface FilterRowProps {
  label: string;
  icon: React.ReactNode;
  count: number;
  active: boolean;
  accent: BadgeVariant;
  onClick: () => void;
}

function FilterRow({
  label,
  icon,
  count,
  active,
  accent,
  onClick,
}: FilterRowProps) {
  return (
    <Tooltip content={`${label} — ${count}`} delay={500}>
      <button
        type="button"
        onClick={onClick}
        className={cn(
          "w-full flex items-center justify-between gap-2 h-7 px-2 rounded-md text-xs",
          "transition-colors border",
          active
            ? "bg-amber-500/10 border-amber-500/40 text-amber-200"
            : "bg-transparent border-transparent text-zinc-300 hover:bg-zinc-900/60 hover:text-zinc-100",
        )}
      >
        <span className="inline-flex items-center gap-2 min-w-0">
          <span className="text-zinc-400 shrink-0">{icon}</span>
          <span className="truncate">{label}</span>
        </span>
        <Badge variant={active ? "amber" : accent} outlined>
          {count}
        </Badge>
      </button>
    </Tooltip>
  );
}

interface FolderRowProps {
  label: string;
  icon: React.ReactNode;
  count: number;
  depth: number;
  active: boolean;
  expanded?: boolean;
  onToggleExpand?: () => void;
  hasChildren?: boolean;
  onClick: () => void;
}

function FolderRow({
  label,
  icon,
  count,
  depth,
  active,
  expanded,
  onToggleExpand,
  hasChildren,
  onClick,
}: FolderRowProps) {
  return (
    <div
      className={cn(
        "flex items-center gap-1 h-7 rounded-md text-xs",
        "transition-colors",
        active
          ? "bg-amber-500/10 text-amber-200"
          : "text-zinc-300 hover:bg-zinc-900/60 hover:text-zinc-100",
      )}
      style={{ paddingLeft: 4 + depth * 12 }}
    >
      {hasChildren ? (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onToggleExpand?.();
          }}
          className="shrink-0 inline-flex items-center justify-center w-4 h-4 text-zinc-500 hover:text-zinc-200"
          aria-label={expanded ? "Collapse folder" : "Expand folder"}
        >
          {expanded ? (
            <ChevronDown size={12} />
          ) : (
            <ChevronRight size={12} />
          )}
        </button>
      ) : (
        <span className="shrink-0 w-4" aria-hidden="true" />
      )}
      <button
        type="button"
        onClick={onClick}
        className={cn(
          "flex-1 min-w-0 flex items-center justify-between gap-2 pr-2 h-full",
          "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-amber-400 rounded-md",
        )}
      >
        <span className="inline-flex items-center gap-1.5 min-w-0">
          <span className="text-zinc-400 shrink-0">{icon}</span>
          <span className="truncate" title={label}>
            {label}
          </span>
        </span>
        <Badge variant={active ? "amber" : "zinc"} outlined>
          {count}
        </Badge>
      </button>
    </div>
  );
}

interface FolderTreeNodeProps {
  node: FolderNode;
  depth: number;
  selectedPath: string;
  onSelect: (p: string) => void;
}

function FolderTreeNode({
  node,
  depth,
  selectedPath,
  onSelect,
}: FolderTreeNodeProps) {
  const [expanded, setExpanded] = React.useState(depth <= 1);
  const hasChildren = node.children.size > 0;
  const active = selectedPath === node.path;
  return (
    <div>
      <FolderRow
        label={node.name}
        icon={
          expanded && hasChildren ? (
            <FolderOpen size={12} />
          ) : (
            <Folder size={12} />
          )
        }
        count={node.totalCount}
        depth={depth}
        active={active}
        expanded={expanded}
        hasChildren={hasChildren}
        onToggleExpand={() => setExpanded((v) => !v)}
        onClick={() => onSelect(node.path)}
      />
      {expanded && hasChildren && (
        <div>
          {Array.from(node.children.values())
            .sort((a, b) => a.name.localeCompare(b.name))
            .map((child) => (
              <FolderTreeNode
                key={child.path}
                node={child}
                depth={depth + 1}
                selectedPath={selectedPath}
                onSelect={onSelect}
              />
            ))}
        </div>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------- */
/* AssetTile (grid mode) — uses Card primitive                          */
/* -------------------------------------------------------------------- */

interface AssetItemCommonProps {
  asset: ResolvedAsset;
  selected: boolean;
  projectId: string;
  onClick: () => void;
  onDoubleClick: () => void;
  onContextMenu: (e: React.MouseEvent) => void;
}

function AssetTile({
  asset,
  selected,
  projectId,
  onClick,
  onDoubleClick,
  onContextMenu,
}: AssetItemCommonProps) {
  return (
    <Tooltip
      content={
        <span className="font-mono text-[10px]">
          {asset.path} · {formatBytes(asset.sizeBytes)}
        </span>
      }
      delay={600}
      side="bottom"
    >
      <Card
        role="button"
        tabIndex={0}
        draggable
        onDragStart={(e) => {
          e.dataTransfer.setData(
            "text/plain",
            `cardboard://asset/${asset.type}/${asset.id}`,
          );
          e.dataTransfer.effectAllowed = "copy";
        }}
        onClick={onClick}
        onDoubleClick={onDoubleClick}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            onDoubleClick();
          }
        }}
        onContextMenu={onContextMenu}
        className={cn(
          "group relative flex flex-col cursor-pointer overflow-hidden text-left w-full",
          "transition-colors p-0",
          selected
            ? "border-amber-500/60 ring-1 ring-amber-500/30 bg-zinc-900"
            : "border-zinc-800 hover:border-amber-400/40 bg-zinc-900/60",
        )}
      >
        <div className="aspect-video flex items-center justify-center bg-zinc-950 relative">
          <AssetPreview asset={asset} projectId={projectId} />
          {asset.procedural === "image" && (
            <Tooltip content="Procedural — Image Lab recipe. Right-click to edit.">
              <span className="absolute bottom-1 right-1 inline-flex items-center justify-center h-4 px-1 rounded text-[9px] font-semibold bg-amber-500/30 border border-amber-500/60 text-amber-100">
                IL
              </span>
            </Tooltip>
          )}
          {asset.procedural === "sound" && (
            <Tooltip content="Procedural — Sound Lab recipe. Right-click to edit.">
              <span className="absolute bottom-1 right-1 inline-flex items-center justify-center h-4 px-1 rounded text-[9px] font-semibold bg-sky-500/30 border border-sky-500/60 text-sky-100">
                SL
              </span>
            </Tooltip>
          )}
        </div>
        <div className="flex items-center gap-1.5 px-2 py-1.5 border-t border-zinc-800/80">
          <span className="text-zinc-400 shrink-0">{TYPE_ICONS[asset.type]}</span>
          <span className="text-xs truncate flex-1" title={asset.path}>
            {asset.name}
          </span>
        </div>
        <div className="flex items-center justify-between px-2 pb-2 gap-1">
          <Badge variant={TYPE_ACCENT[asset.type]} outlined>
            {TYPE_LABELS[asset.type]}
          </Badge>
          <Badge variant="zinc" outlined>
            {formatBytes(asset.sizeBytes)}
          </Badge>
        </div>
      </Card>
    </Tooltip>
  );
}

function AssetRow({
  asset,
  selected,
  projectId,
  onClick,
  onDoubleClick,
  onContextMenu,
}: AssetItemCommonProps) {
  return (
    <div
      role="button"
      tabIndex={0}
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData(
          "text/plain",
          `cardboard://asset/${asset.type}/${asset.id}`,
        );
        e.dataTransfer.effectAllowed = "copy";
      }}
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onDoubleClick();
        }
      }}
      onContextMenu={onContextMenu}
      className={cn(
        "grid grid-cols-[40px_1fr_120px_100px_120px] items-center px-2 py-1.5 gap-2 text-xs",
        "border-b border-zinc-800/60 cursor-pointer transition-colors",
        selected
          ? "bg-amber-500/10 text-amber-200"
          : "hover:bg-zinc-900/60 text-zinc-200",
      )}
    >
      <div className="w-8 h-8 rounded bg-zinc-950 border border-zinc-800 overflow-hidden flex items-center justify-center">
        <AssetPreview asset={asset} projectId={projectId} compact />
      </div>
      <div className="truncate flex items-center gap-1.5" title={asset.path}>
        <span className="text-zinc-500 shrink-0">{TYPE_ICONS[asset.type]}</span>
        <span className="truncate">{asset.name}</span>
        {asset.procedural === "image" && (
          <Badge variant="amber" className="ml-1">IL</Badge>
        )}
        {asset.procedural === "sound" && (
          <Badge variant="sky" className="ml-1">SL</Badge>
        )}
      </div>
      <div className="text-zinc-400">
        <Badge variant={TYPE_ACCENT[asset.type]} outlined>
          {TYPE_LABELS[asset.type]}
        </Badge>
      </div>
      <div className="text-zinc-400 font-mono">{formatBytes(asset.sizeBytes)}</div>
      <div className="text-zinc-500 truncate">
        {asset.updatedAt ? new Date(asset.updatedAt).toLocaleDateString() : "—"}
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------- */
/* AssetPreview — per-type thumbnail                                     */
/* -------------------------------------------------------------------- */

interface AssetPreviewProps {
  asset: ResolvedAsset;
  projectId: string;
  compact?: boolean;
}

function AssetPreview({ asset, projectId, compact }: AssetPreviewProps) {
  const [imgUrl, setImgUrl] = React.useState<string | null>(null);

  const needsImg =
    asset.type === "sprite" ||
    asset.type === "lightmap" ||
    asset.type === "imageRecipe";

  React.useEffect(() => {
    if (!needsImg) return;
    let cancelled = false;
    let createdUrl: string | null = null;
    (async () => {
      try {
        const body = await EditorProjectStore.loadAsset(projectId, asset.path);
        if (cancelled || !body) return;
        if (body instanceof Blob) {
          createdUrl = URL.createObjectURL(body);
          setImgUrl(createdUrl);
        }
      } catch {
        // ignore — fall back to icon
      }
    })();
    return () => {
      cancelled = true;
      if (createdUrl) URL.revokeObjectURL(createdUrl);
    };
  }, [asset.path, projectId, needsImg]);

  const iconSize = compact ? 16 : 32;

  if (needsImg && imgUrl) {
    return (
      <img
        src={imgUrl}
        alt={asset.name}
        className="max-w-full max-h-full object-contain"
        style={{ imageRendering: "pixelated" }}
        draggable={false}
      />
    );
  }

  const Glyph: Record<AssetType, React.ReactNode> = {
    sprite: <ImageIcon size={iconSize} className="text-amber-400/60" />,
    sound: <AudioWaveform size={iconSize} className="text-sky-400/60" />,
    script: <Code2 size={iconSize} className="text-emerald-400/60" />,
    prefab: <Boxes size={iconSize} className="text-purple-400/60" />,
    preset: <Grid3x3 size={iconSize} className="text-yellow-400/60" />,
    shader: <FileCode size={iconSize} className="text-red-400/60" />,
    lightmap: <Sun size={iconSize} className="text-yellow-400/60" />,
    imageRecipe: <Wand2 size={iconSize} className="text-amber-400/60" />,
    soundRecipe: <AudioWaveform size={iconSize} className="text-sky-400/60" />,
  };

  return <div className="opacity-80">{Glyph[asset.type]}</div>;
}

/* -------------------------------------------------------------------- */
/* AssetInspectorRail — right rail                                       */
/* -------------------------------------------------------------------- */

interface AssetInspectorRailProps {
  asset: ResolvedAsset | null;
  projectId: string;
  onPreview: () => void;
  onOpen: () => void;
  onDelete: () => void;
  onDuplicate: () => void;
  onRename: () => void;
  totalCount: number;
  totalBytes: number;
}

function AssetInspectorRail({
  asset,
  projectId,
  onPreview,
  onOpen,
  onDelete,
  onDuplicate,
  onRename,
  totalCount,
  totalBytes,
}: AssetInspectorRailProps) {
  if (!asset) {
    return (
      <aside className="min-h-0 flex flex-col overflow-hidden bg-zinc-950/60">
        <PanelHeader title="Inspector" />
        <ScrollArea className="flex-1" fade={false}>
          <div className="p-4 space-y-3">
            <p className="text-xs text-zinc-500 leading-relaxed">
              Select an asset to see its preview, metadata, and available
              actions.
            </p>
            <CollapsibleSection title="Project totals" defaultOpen>
              <PropertyRow label="Total assets">
                <span className="font-mono text-sm text-zinc-200">
                  {totalCount}
                </span>
              </PropertyRow>
              <PropertyRow label="Total size">
                <span className="font-mono text-sm text-zinc-200">
                  {formatBytes(totalBytes)}
                </span>
              </PropertyRow>
            </CollapsibleSection>
          </div>
        </ScrollArea>
      </aside>
    );
  }

  return (
    <aside className="min-h-0 flex flex-col overflow-hidden bg-zinc-950/60">
      <PanelHeader
        title="Inspector"
        action={
          <Badge variant={TYPE_ACCENT[asset.type]} outlined>
            {TYPE_LABELS[asset.type]}
          </Badge>
        }
      />
      <ScrollArea className="flex-1" fade={false}>
        <div className="p-3 space-y-3">
          {/* Asset name + quick actions row */}
          <div className="flex items-center justify-between gap-2">
            <div
              className="text-sm font-semibold text-zinc-100 truncate"
              title={asset.name}
            >
              {asset.name}
            </div>
            <div className="flex items-center gap-1 shrink-0">
              <Tooltip content="Rename">
                <IconButton
                  icon={<Pencil size={14} />}
                  tooltip="Rename"
                  onClick={onRename}
                />
              </Tooltip>
              <Tooltip content="Duplicate">
                <IconButton
                  icon={<CopyIcon size={14} />}
                  tooltip="Duplicate"
                  onClick={onDuplicate}
                />
              </Tooltip>
              <Tooltip content="Delete">
                <IconButton
                  icon={<Trash2 size={14} />}
                  tooltip="Delete"
                  variant="danger"
                  onClick={onDelete}
                />
              </Tooltip>
            </div>
          </div>

          {/* Preview section */}
          <CollapsibleSection
            title="Preview"
            icon={<Eye size={12} />}
            defaultOpen
          >
            <div className="aspect-video w-full rounded-md border border-zinc-800 bg-zinc-950 flex items-center justify-center overflow-hidden">
              <AssetPreview asset={asset} projectId={projectId} />
            </div>
            {asset.type === "sound" && (
              <div className="pt-2">
                <SoundAudition asset={asset} projectId={projectId} />
              </div>
            )}
            <div className="flex flex-wrap gap-2 pt-2">
              <Button
                variant="secondary"
                size="sm"
                onClick={onPreview}
                className="gap-1.5"
              >
                <Eye size={12} />
                Open preview
              </Button>
              <Button
                variant="secondary"
                size="sm"
                onClick={onOpen}
                className="gap-1.5"
              >
                <ExternalLink size={12} />
                Open in editor
              </Button>
            </div>
          </CollapsibleSection>

          {/* Metadata section */}
          <CollapsibleSection
            title="Metadata"
            icon={<Filter size={12} />}
            defaultOpen
          >
            <PropertyRow label="Path">
              <span
                className="font-mono text-xs text-zinc-200 truncate block"
                title={asset.path}
              >
                {asset.path}
              </span>
            </PropertyRow>
            <PropertyRow label="Type">
              <Badge variant={TYPE_ACCENT[asset.type]} outlined>
                {TYPE_LABELS[asset.type]}
              </Badge>
            </PropertyRow>
            <PropertyRow label="Size">
              <Badge variant="zinc" outlined>
                {formatBytes(asset.sizeBytes)}
              </Badge>
            </PropertyRow>
            <PropertyRow label="Modified">
              <span className="font-mono text-xs text-zinc-200">
                {formatTimestamp(asset.updatedAt)}
              </span>
            </PropertyRow>
            {asset.procedural && (
              <PropertyRow label="Source">
                <span className="text-xs text-zinc-200">
                  {asset.procedural === "image"
                    ? "Image Lab recipe"
                    : "Sound Lab recipe"}
                </span>
              </PropertyRow>
            )}
          </CollapsibleSection>

          {/* Usage section — placeholder; full where-used wiring is
              tracked in EDITOR.md §11. */}
          <CollapsibleSection
            title="Usage"
            icon={<ExternalLink size={12} />}
            defaultOpen={false}
          >
            <p className="text-xs text-zinc-500 leading-relaxed py-1">
              Where-used analysis will list prefabs, scenes, and scripts that
              reference this asset. Tracked in EDITOR.md §11.
            </p>
            <button
              type="button"
              onClick={() => {
                // eslint-disable-next-line no-console
                console.info(`[assets] show-in-chain: ${asset.path} (WIRING)`);
                navigateTab("project", asset.id);
              }}
              className="w-full text-left text-xs text-zinc-400 hover:text-amber-300 underline-offset-2 hover:underline px-1 py-1"
            >
              Show in pack chain →
            </button>
          </CollapsibleSection>
        </div>
      </ScrollArea>
    </aside>
  );
}

/* -------------------------------------------------------------------- */
/* SoundAudition — MVP audio playback                                    */
/* -------------------------------------------------------------------- */

function SoundAudition({
  asset,
  projectId,
}: {
  asset: ResolvedAsset;
  projectId: string;
}) {
  const [url, setUrl] = React.useState<string | null>(null);
  const audioRef = React.useRef<HTMLAudioElement | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    let created: string | null = null;
    (async () => {
      try {
        const body = await EditorProjectStore.loadAsset(projectId, asset.path);
        if (cancelled || !(body instanceof Blob)) return;
        created = URL.createObjectURL(body);
        setUrl(created);
      } catch {
        // ignore
      }
    })();
    return () => {
      cancelled = true;
      if (created) URL.revokeObjectURL(created);
    };
  }, [asset.path, projectId]);

  return (
    <div className="rounded-md border border-zinc-800 bg-zinc-950 p-2 flex items-center gap-2">
      <Play size={14} className="text-sky-400 shrink-0" />
      {url ? (
        <audio
          ref={audioRef}
          src={url}
          controls
          preload="metadata"
          className="flex-1 max-w-full h-8"
        />
      ) : (
        <span className="text-xs text-zinc-500">Loading audio…</span>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------- */
/* ContextMenu                                                            */
/* -------------------------------------------------------------------- */

interface ContextMenuProps {
  asset: ResolvedAsset;
  x: number;
  y: number;
  onClose: () => void;
  onEdit: (a: ResolvedAsset) => void;
  onDuplicate: (a: ResolvedAsset) => void;
  onRename: (a: ResolvedAsset) => void;
  onDelete: (a: ResolvedAsset) => void;
}

function ContextMenu({
  asset,
  x,
  y,
  onClose,
  onEdit,
  onDuplicate,
  onRename,
  onDelete,
}: ContextMenuProps) {
  React.useEffect(() => {
    function onDown(e: MouseEvent) {
      const target = e.target as HTMLElement | null;
      if (!target?.closest?.("[data-context-menu]")) onClose();
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  return (
    <div
      data-context-menu
      style={{ position: "fixed", top: y, left: x, zIndex: 100 }}
      className={cn(
        "min-w-[180px] rounded-md border border-zinc-700 bg-zinc-900 shadow-xl",
        "py-1 text-sm",
      )}
      role="menu"
    >
      <MenuItem icon={<Pencil size={12} />} onClick={() => onEdit(asset)}>
        Open
      </MenuItem>
      <MenuItem icon={<Pencil size={12} />} onClick={() => onRename(asset)}>
        Rename
      </MenuItem>
      <MenuItem icon={<CopyIcon size={12} />} onClick={() => onDuplicate(asset)}>
        Duplicate
      </MenuItem>
      <MenuItem
        icon={<ExternalLink size={12} />}
        onClick={() => {
          // eslint-disable-next-line no-console
          console.info(`[assets] show-in-chain: ${asset.path} (WIRING)`);
          onClose();
        }}
      >
        Show in pack chain
      </MenuItem>
      <div className="my-1 h-px bg-zinc-800" />
      <MenuItem
        icon={<Trash2 size={12} />}
        variant="danger"
        onClick={() => onDelete(asset)}
      >
        Delete
      </MenuItem>
    </div>
  );
}

function MenuItem({
  icon,
  children,
  onClick,
  variant = "default",
}: {
  icon: React.ReactNode;
  children: React.ReactNode;
  onClick: () => void;
  variant?: "default" | "danger";
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "w-full text-left flex items-center gap-2 px-3 py-1.5 text-xs",
        variant === "danger"
          ? "text-red-300 hover:bg-red-900/30"
          : "text-zinc-200 hover:bg-zinc-800",
      )}
    >
      <span className="text-zinc-400 w-4 inline-flex items-center justify-center">
        {icon}
      </span>
      <span className="flex-1 truncate">{children}</span>
    </button>
  );
}

/* -------------------------------------------------------------------- */
/* PreviewModal                                                           */
/* -------------------------------------------------------------------- */

interface PreviewModalProps {
  asset: ResolvedAsset;
  projectId: string;
  onClose: () => void;
}

function PreviewModal({ asset, projectId, onClose }: PreviewModalProps) {
  React.useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-[90] flex items-center justify-center bg-black/70 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="relative max-w-[80vw] max-h-[80vh] bg-zinc-950 border border-zinc-800 rounded-lg shadow-2xl overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-2 border-b border-zinc-800">
          <div className="flex items-center gap-2 text-sm text-zinc-100">
            <span className="text-zinc-500">{TYPE_ICONS[asset.type]}</span>
            <span className="font-semibold truncate max-w-[60vw]">{asset.name}</span>
            <Badge variant={TYPE_ACCENT[asset.type]} outlined>
              {TYPE_LABELS[asset.type]}
            </Badge>
          </div>
          <IconButton
            icon={<X size={14} />}
            tooltip="Close (Esc)"
            onClick={onClose}
          />
        </div>
        <div className="p-4 flex items-center justify-center bg-zinc-950 min-h-[200px] min-w-[400px]">
          <AssetPreview asset={asset} projectId={projectId} />
        </div>
        <div className="px-4 py-2 border-t border-zinc-800 text-[11px] text-zinc-500 font-mono truncate">
          {asset.path} · {formatBytes(asset.sizeBytes)}
        </div>
      </div>
    </div>
  );
}

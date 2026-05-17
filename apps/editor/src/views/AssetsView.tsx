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
  Search,
  Filter,
  LayoutGrid,
  List as ListIcon,
  MoreVertical,
  ExternalLink,
  Trash2,
  Copy as CopyIcon,
  Pencil,
  Eye,
  Play,
  X,
  PackageOpen,
} from "lucide-react";
import {
  EditorProjectStore,
  type AssetMeta,
} from "../lib/EditorProjectStore";
import { Toolbar } from "../components/ui/Toolbar";
import { Badge, type BadgeVariant } from "../components/ui/Badge";
import { SegmentedControl } from "../components/ui/controls";
import { PanelHeader } from "../components/ui/PanelHeader";
import { ScrollArea } from "../components/ui/ScrollArea";
import { KeyValueList } from "../components/ui/KeyValueList";
import { IconButton } from "../components/ui/IconButton";
import { EmptyState } from "../components/ui/EmptyState";
import { Tooltip } from "../components/ui/Tooltip";
import { useStatusBar } from "../shell/StatusBarContext";
import { useEditorActions } from "../shell/EditorActionsContext";
import type { PrimaryTabId } from "../shell/PrimaryTabs";
import { cn } from "../lib/cn";

/**
 * AssetsView — R4g.
 *
 * Browser for every pack asset, partitioned into nine logical types
 * derived from the IDB-backed `EditorProjectStore.listAssets()` plus
 * the animation sidecar (`listSpriteSources()`):
 *
 *   - sprite        (PNG under `images/`)
 *   - sound         (audio under `audio/` or `sounds/`)
 *   - script        (.js/.ts/.mjs/.jsx/.tsx)
 *   - prefab        (`prefabs/` JSON or compiled-prefab markers)
 *   - preset        (`presets/` JSONC — tile presets)
 *   - shader        (`shaders/`)
 *   - lightmap      (`lightmaps/` PNGs)
 *   - imageRecipe   (`recipes/*.recipe.json` for images; IL)
 *   - soundRecipe   (`recipes/*.sound.recipe.json` for sounds; SL)
 *
 * Layout (§7.4 + §6.5):
 *
 *     AssetFiltersBar     (top — type chips + search + view toggle)
 *     ┌────────────────────┬───────────────────────┐
 *     │  AssetGrid / List  │  AssetInspectorPanel  │
 *     │  (fluid, scrolls)  │  (320px right rail)   │
 *     └────────────────────┴───────────────────────┘
 *
 * Wiring conventions:
 *   - Click a sprite/lightmap row opens an inline preview modal.
 *   - Click a script row dispatches `cardboard:set-tab` → "scripts".
 *   - Click a prefab row dispatches `cardboard:set-tab` → "prefabs".
 *   - Click a recipe row dispatches `cardboard:set-tab` →
 *     "imageLab" / "soundLab" (WIRING: lab views aren't built yet —
 *     the user lands on their EmptyState placeholder).
 *   - Drag-and-drop: each tile sets `text/plain` to
 *     `cardboard://asset/<type>/<id>`. Other tabs (Entities sprite
 *     slot, Map texture slot…) implement the drop side. WIRING.
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
  // Compiled prefab init scripts (`scripts/prefabs/*-init.js`) — show
  // these in BOTH the prefab and script buckets? For now: keep them in
  // scripts only; the prefab JSON (if present) is the canonical face.

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

/**
 * Dispatched as a `window` CustomEvent so any view can request a tab
 * switch. The shell listens for it and pipes through to its `setTab`.
 * Detail payload optionally carries an `assetId` so the receiving view
 * can react (e.g. Scripts view auto-opens that file). WIRING.
 */
export interface SetTabEventDetail {
  tab: PrimaryTabId;
  assetId?: string;
}
export const SET_TAB_EVENT = "cardboard:set-tab";

function navigateTab(tab: PrimaryTabId, assetId?: string) {
  // WIRING: receivers (Scripts / Entities / Map / Image Lab / Sound
  // Lab) should also persist `assetId` somewhere their view can pick
  // up on mount. For R4g we only emit the event; once those views
  // exist they can subscribe and self-route.
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
  const [viewMode, setViewMode] = React.useState<"grid" | "list">("grid");
  const [selectedId, setSelectedId] = React.useState<string | null>(null);

  // Preview modal (sprites + lightmaps)
  const [previewAsset, setPreviewAsset] = React.useState<ResolvedAsset | null>(
    null,
  );

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

    // Layer in spriteSources that lack a backing PNG yet (FBX bakes in
    // progress, recipes-only, …). WIRING: when AE2 ships FBX paths,
    // sprite-source rows without a sheet PNG are still useful to surface.
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

  /* ---------------- Filter + search ---------------- */

  const visible = React.useMemo(() => {
    const q = search.trim().toLowerCase();
    return resolved.filter((a) => {
      if (typeFilter && a.type !== typeFilter) return false;
      if (q && !a.name.toLowerCase().includes(q) && !a.path.toLowerCase().includes(q)) {
        return false;
      }
      return true;
    });
  }, [resolved, typeFilter, search]);

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

  const selected = React.useMemo(
    () => visible.find((a) => a.id === selectedId) ?? null,
    [visible, selectedId],
  );

  /* ---------------- StatusBar registration ---------------- */

  const { setSections } = useStatusBar();
  React.useEffect(() => {
    const filterValue = typeFilter
      ? `${TYPE_LABELS[typeFilter]}: ${counts[typeFilter]}`
      : "All types";
    setSections([
      {
        id: "asset-count",
        label: "Assets",
        value: `${resolved.length}`,
      },
      {
        id: "selected-type",
        label: "Filter",
        value: filterValue,
      },
      {
        id: "selected-asset",
        label: "Selected",
        value: selected?.name ?? "—",
      },
    ]);
    return () => setSections([]);
  }, [resolved.length, typeFilter, counts, selected, setSections]);

  /* ---------------- EditorActions registration ---------------- */

  const { register } = useEditorActions();
  React.useEffect(() => {
    return register({
      save: async () => {
        // WIRING: asset metadata is read-only for R4g — there is
        // nothing in the inspector that produces uncommitted changes
        // yet. Once rename / tag editing lands the implementation
        // moves here.
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
        // Audition handled inline in the inspector — selecting is
        // enough. Double-click on a sound row could autoplay; WIRING.
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
      if (a.id.startsWith("spriteSource:")) return; // WIRING
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
    <div className="h-full flex flex-col bg-zinc-950 text-zinc-100">
      {/* ─── Filter bar ─── */}
      <AssetFiltersBar
        search={search}
        onSearch={setSearch}
        typeFilter={typeFilter}
        onTypeFilter={setTypeFilter}
        counts={counts}
        viewMode={viewMode}
        onViewMode={setViewMode}
      />

      {error && (
        <div className="mx-4 my-2 rounded-md border border-red-800 bg-red-950/50 px-3 py-2 text-xs text-red-200">
          {error}
        </div>
      )}

      {/* ─── Body: grid/list + inspector ─── */}
      <div className="flex-1 min-h-0 grid grid-cols-[1fr_320px] gap-3 px-3 pb-3 overflow-hidden">
        <div className="min-h-0 rounded-md border border-zinc-800 bg-zinc-950/40 flex flex-col overflow-hidden">
          {projectEmpty ? (
            <div className="flex-1 flex items-center justify-center">
              <EmptyState
                tutorial="assets-intro"
                icon={<PackageOpen size={28} />}
                title="No assets in this project"
                description="Imported sprites, sounds, scripts, prefabs, and recipes will appear here. Use the Home tab's import flow or drag files into other views to get started."
              />
            </div>
          ) : visible.length === 0 ? (
            <div className="flex-1 flex items-center justify-center">
              <EmptyState
                tutorial="assets-intro"
                icon={<Filter size={28} />}
                title="No matches"
                description="No assets match the current type filter or search query. Clear the filter to see everything."
              />
            </div>
          ) : viewMode === "grid" ? (
            <ScrollArea className="flex-1">
              <div className="p-3 grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-3">
                {visible.map((a) => (
                  <AssetTile
                    key={a.id}
                    asset={a}
                    selected={selectedId === a.id}
                    projectId={projectId}
                    onClick={() => openAsset(a)}
                    onContextMenu={(e) => handleContextMenu(e, a)}
                  />
                ))}
              </div>
            </ScrollArea>
          ) : (
            <ScrollArea className="flex-1">
              <div className="p-2">
                <div className="grid grid-cols-[40px_1fr_120px_100px_120px] items-center px-2 py-1 text-[10px] uppercase tracking-wider text-zinc-500 border-b border-zinc-800">
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
                    onClick={() => openAsset(a)}
                    onContextMenu={(e) => handleContextMenu(e, a)}
                  />
                ))}
              </div>
            </ScrollArea>
          )}
        </div>

        {/* Inspector */}
        <AssetInspectorPanel
          asset={selected}
          projectId={projectId}
          onPreview={() => selected && setPreviewAsset(selected)}
          onOpen={() => selected && openAsset(selected)}
          onDelete={() => selected && handleDelete(selected)}
          onDuplicate={() => selected && handleDuplicate(selected)}
          totalCount={resolved.length}
          totalBytes={totalBytes}
        />
      </div>

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
    </div>
  );
}

/* -------------------------------------------------------------------- */
/* AssetFiltersBar                                                       */
/* -------------------------------------------------------------------- */

interface AssetFiltersBarProps {
  search: string;
  onSearch: (v: string) => void;
  typeFilter: AssetType | null;
  onTypeFilter: (t: AssetType | null) => void;
  counts: Record<AssetType, number>;
  viewMode: "grid" | "list";
  onViewMode: (v: "grid" | "list") => void;
}

function AssetFiltersBar({
  search,
  onSearch,
  typeFilter,
  onTypeFilter,
  counts,
  viewMode,
  onViewMode,
}: AssetFiltersBarProps) {
  return (
    <Toolbar
      className="m-3"
      groups={[
        {
          id: "search",
          children: (
            <div className="relative">
              <Search
                size={14}
                className="absolute left-2 top-1/2 -translate-y-1/2 text-zinc-500 pointer-events-none"
                aria-hidden="true"
              />
              <input
                type="text"
                value={search}
                onChange={(e) => onSearch(e.target.value)}
                placeholder="Search assets…"
                className={cn(
                  "h-8 w-64 pl-7 pr-2 rounded-md text-xs",
                  "bg-zinc-900 border border-zinc-800 text-zinc-100",
                  "placeholder:text-zinc-500",
                  "focus:outline-none focus:border-amber-500/60",
                )}
              />
            </div>
          ),
        },
        {
          id: "types",
          children: (
            <div className="flex items-center gap-1 flex-wrap max-w-[760px]">
              <TypeChip
                label="All"
                icon={<Filter size={12} />}
                count={Object.values(counts).reduce((s, n) => s + n, 0)}
                active={typeFilter === null}
                accent="zinc"
                onClick={() => onTypeFilter(null)}
              />
              {TYPE_ORDER.map((t) => (
                <TypeChip
                  key={t}
                  label={TYPE_LABELS[t]}
                  icon={TYPE_ICONS[t]}
                  count={counts[t]}
                  active={typeFilter === t}
                  accent={TYPE_ACCENT[t]}
                  onClick={() => onTypeFilter(typeFilter === t ? null : t)}
                />
              ))}
            </div>
          ),
        },
      ]}
      tail={
        <SegmentedControl<"grid" | "list">
          aria-label="View mode"
          size="sm"
          value={viewMode}
          onChange={(v) => v && onViewMode(v)}
          options={[
            { id: "grid", icon: <LayoutGrid size={12} />, label: "Grid" },
            { id: "list", icon: <ListIcon size={12} />, label: "List" },
          ]}
        />
      }
    />
  );
}

interface TypeChipProps {
  label: string;
  icon: React.ReactNode;
  count: number;
  active: boolean;
  accent: BadgeVariant;
  onClick: () => void;
}

function TypeChip({ label, icon, count, active, accent, onClick }: TypeChipProps) {
  return (
    <Tooltip content={`${label} — ${count}`} delay={500}>
      <button
        type="button"
        onClick={onClick}
        className={cn(
          "inline-flex items-center gap-1.5 h-7 px-2 rounded-md text-xs",
          "transition-colors border",
          active
            ? "bg-amber-500/10 border-amber-500/40 text-amber-200"
            : "bg-zinc-900/40 border-zinc-800 text-zinc-300 hover:bg-zinc-800/60 hover:text-zinc-100",
        )}
      >
        <span className="text-zinc-400">{icon}</span>
        <span className="truncate max-w-[100px]">{label}</span>
        <Badge variant={active ? "amber" : accent} outlined>
          {count}
        </Badge>
      </button>
    </Tooltip>
  );
}

/* -------------------------------------------------------------------- */
/* AssetTile (grid mode) + AssetRow (list mode)                         */
/* -------------------------------------------------------------------- */

interface AssetItemCommonProps {
  asset: ResolvedAsset;
  selected: boolean;
  projectId: string;
  onClick: () => void;
  onContextMenu: (e: React.MouseEvent) => void;
}

function AssetTile({ asset, selected, projectId, onClick, onContextMenu }: AssetItemCommonProps) {
  return (
    <button
      type="button"
      draggable
      onDragStart={(e) => {
        // text/plain so any drop target can opt-in without a custom mime.
        e.dataTransfer.setData(
          "text/plain",
          `cardboard://asset/${asset.type}/${asset.id}`,
        );
        e.dataTransfer.effectAllowed = "copy";
      }}
      onClick={onClick}
      onContextMenu={onContextMenu}
      className={cn(
        "group relative flex flex-col rounded-md border text-left",
        "bg-zinc-900/40 transition-colors overflow-hidden",
        selected
          ? "border-amber-500/60 ring-1 ring-amber-500/30"
          : "border-zinc-800 hover:border-amber-400/40",
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
    </button>
  );
}

function AssetRow({ asset, selected, projectId, onClick, onContextMenu }: AssetItemCommonProps) {
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
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onClick();
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
      <div className="text-zinc-400">{TYPE_LABELS[asset.type]}</div>
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

  // For sprite + lightmap + image-recipe (when baked PNG exists) we
  // pull the blob and create an object URL.
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
        // Pixel-art friendly — most pack sprites are tiny.
        style={{ imageRendering: "pixelated" }}
        draggable={false}
      />
    );
  }

  // Fallback icon by type.
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

  // WIRING: Image Lab + Sound Lab bake outputs aren't implemented yet
  // — recipe thumbnails fall back to a stylized wand/waveform icon
  // until §9 of those plans lands.
  return <div className="opacity-80">{Glyph[asset.type]}</div>;
}

/* -------------------------------------------------------------------- */
/* AssetInspectorPanel                                                   */
/* -------------------------------------------------------------------- */

interface AssetInspectorPanelProps {
  asset: ResolvedAsset | null;
  projectId: string;
  onPreview: () => void;
  onOpen: () => void;
  onDelete: () => void;
  onDuplicate: () => void;
  totalCount: number;
  totalBytes: number;
}

function AssetInspectorPanel({
  asset,
  projectId,
  onPreview,
  onOpen,
  onDelete,
  onDuplicate,
  totalCount,
  totalBytes,
}: AssetInspectorPanelProps) {
  if (!asset) {
    return (
      <aside className="min-h-0 rounded-md border border-zinc-800 bg-zinc-950/40 flex flex-col overflow-hidden">
        <PanelHeader title="Inspector" />
        <div className="p-4 flex-1 flex flex-col gap-3">
          <p className="text-xs text-zinc-500">
            Select an asset to see its metadata, preview, and available actions.
          </p>
          <div className="mt-auto">
            <KeyValueList
              density="dense"
              rows={[
                { label: "Total assets", value: `${totalCount}` },
                { label: "Total size", value: formatBytes(totalBytes) },
              ]}
            />
          </div>
        </div>
      </aside>
    );
  }

  return (
    <aside className="min-h-0 rounded-md border border-zinc-800 bg-zinc-950/40 flex flex-col overflow-hidden">
      <PanelHeader
        title="Inspector"
        action={
          <Badge variant={TYPE_ACCENT[asset.type]} outlined>
            {TYPE_LABELS[asset.type]}
          </Badge>
        }
      />
      <ScrollArea className="flex-1">
        <div className="p-3 space-y-3">
          <div className="aspect-video w-full rounded-md border border-zinc-800 bg-zinc-950 flex items-center justify-center overflow-hidden">
            <AssetPreview asset={asset} projectId={projectId} />
          </div>

          <div className="text-sm font-semibold text-zinc-100 truncate" title={asset.name}>
            {asset.name}
          </div>

          {asset.type === "sound" && (
            <SoundAudition asset={asset} projectId={projectId} />
          )}

          <KeyValueList
            density="dense"
            rows={[
              { label: "Path", value: <span title={asset.path}>{asset.path}</span> },
              { label: "Type", value: TYPE_LABELS[asset.type] },
              { label: "Size", value: formatBytes(asset.sizeBytes) },
              { label: "Modified", value: formatTimestamp(asset.updatedAt) },
              ...(asset.procedural
                ? [{
                    label: "Source",
                    value: asset.procedural === "image"
                      ? "Image Lab recipe"
                      : "Sound Lab recipe",
                  }]
                : []),
            ]}
          />

          <div className="flex flex-wrap gap-2 pt-1">
            <ActionButton icon={<Eye size={12} />} onClick={onPreview}>
              Preview
            </ActionButton>
            <ActionButton icon={<ExternalLink size={12} />} onClick={onOpen}>
              Open
            </ActionButton>
            <ActionButton icon={<CopyIcon size={12} />} onClick={onDuplicate}>
              Duplicate
            </ActionButton>
            <ActionButton icon={<Trash2 size={12} />} onClick={onDelete} variant="danger">
              Delete
            </ActionButton>
          </div>

          {/* WIRING: "Show in pack chain" jumps to the Dependencies
              tab and highlights the layer that owns this asset path.
              The chain detector exists but doesn't currently accept
              a focused asset path — the inspector logs a stub. */}
          <button
            type="button"
            onClick={() => {
              // eslint-disable-next-line no-console
              console.info(`[assets] show-in-chain: ${asset.path} (WIRING)`);
              navigateTab("project", asset.id);
            }}
            className="w-full text-left text-xs text-zinc-400 hover:text-amber-300 underline-offset-2 hover:underline px-1"
          >
            Show in pack chain →
          </button>
        </div>
      </ScrollArea>
    </aside>
  );
}

function ActionButton({
  icon,
  children,
  onClick,
  variant = "secondary",
}: {
  icon: React.ReactNode;
  children: React.ReactNode;
  onClick: () => void;
  variant?: "secondary" | "danger";
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-1.5 h-7 px-2 rounded-md text-xs border transition-colors",
        variant === "danger"
          ? "bg-red-600/20 border-red-700 text-red-200 hover:bg-red-600/30"
          : "bg-zinc-900 border-zinc-800 text-zinc-200 hover:bg-zinc-800",
      )}
    >
      <span className="text-zinc-400">{icon}</span>
      {children}
    </button>
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

  // WIRING: full waveform rendering (e.g. WaveSurfer.js) is a future
  // polish. For R4g, a native <audio> element with controls suffices
  // and avoids new dependencies.
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
  onDelete: (a: ResolvedAsset) => void;
}

function ContextMenu({ asset, x, y, onClose, onEdit, onDuplicate, onDelete }: ContextMenuProps) {
  // Close on outside click or Escape.
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
        Edit
      </MenuItem>
      <MenuItem icon={<CopyIcon size={12} />} onClick={() => onDuplicate(asset)}>
        Duplicate
      </MenuItem>
      <MenuItem
        icon={<ExternalLink size={12} />}
        onClick={() => {
          // WIRING: see AssetInspectorPanel "Show in pack chain".
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

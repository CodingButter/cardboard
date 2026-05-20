// P3 batch D migration. Moved from
// `apps/editor/src/views/scene/panels/AssetReferencesPanel.tsx` into
// the core-editor-pack with no behavioural changes — only the import
// paths flipped to pack-local `scene-fixtures` and the shell-SDK
// externals (`EmptyState` + `registerCommand`).
import React from "react";
import {
  Box,
  FileCode,
  Image,
  Layers as LayersIcon,
  Link,
  Music,
  RefreshCw,
  TriangleAlert,
  Volume2,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
// Type-only — pack-builder erases at compile time.
import type { DockPanelDef } from "../../../apps/editor/src/components/dock/DockShell";
// Presentational primitive — safe to bundle (no singleton state).
import { Tooltip } from "../../../apps/editor/src/components/ui/Tooltip";
// Externalised — `EmptyState` ships via the shell SDK because it
// transitively imports a binary asset (`logo.png`) the pack-builder
// can't resolve; `registerCommand` routes into the host command
// store + palette.
import { EmptyState, registerCommand } from "@cardboard/editor-shell";
import {
  MOCK_ASSETS,
  type AssetKind,
  type AssetRefRow,
} from "./scene-fixtures";

/**
 * AssetReferencesPanel — table of every asset referenced by the
 * current scene.
 *
 * Visual target: the ASSET REFERENCES card from `Editor Design/Map.png` —
 * a kind-filterable list of asset rows. Each row shows a kind icon,
 * filename, subdued path, ref-count badge, and a red dot when the
 * asset is missing on disk. Filter chips across the top filter by
 * kind, plus a virtual "missing" filter that surfaces only red-dot
 * rows for triage.
 *
 * Opt-in panel — not in the default Map.png layout but registered so
 * it's add-able from the Docks modal. Wave 2 wires this to the real
 * pack asset resolver; for now we read from `MOCK_ASSETS`.
 *
 * Persistence contract (scoped to this panel):
 *   - `cardboard.scene.assets.filter`    AssetKind | "all" | "missing"
 *   - `cardboard.scene.assets.activeId`  string asset id
 *
 * Command registry contract — every interactive control here ALSO
 * registers a command via `registerCommand`. Per-asset focus + copy
 * commands are dynamic, re-registered whenever `MOCK_ASSETS` changes
 * shape (which it will when the real registry lands).
 */

// ---------------------------------------------------------------------------
// Persistence keys + helpers

const LS_FILTER = "cardboard.scene.assets.filter";
const LS_ACTIVE_ID = "cardboard.scene.assets.activeId";

type FilterId = AssetKind | "all" | "missing";

const DEFAULT_FILTER: FilterId = "all";
const DEFAULT_ACTIVE_ID = "";

function readLS(key: string): string | null {
  try {
    if (typeof window === "undefined") return null;
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeLS(key: string, value: string): void {
  try {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(key, value);
  } catch {
    /* ignore quota / private-mode failures */
  }
}

// ---------------------------------------------------------------------------
// Filter metadata

interface FilterMeta {
  id: FilterId;
  name: string;
  description: string;
  /**
   * Lucide icon — used for the per-row asset icons (NOT the chip
   * strip, which uses a coloured dot for parity with the canonical
   * filter pattern from PrefabBrowser / TilePresetPanel / Output /
   * Problems).
   */
  icon: LucideIcon;
  /** Tailwind colour utility for the chip's leading dot. */
  dotClass: string;
  /**
   * Empty-state description shown when the filter resolves to zero
   * assets. Keeps the empty-state copy filter-specific without forcing
   * the renderer to branch on the id.
   */
  emptyDescription: string;
}

const FILTER_META: readonly FilterMeta[] = [
  {
    id: "all",
    name: "All",
    description: "Every asset referenced by the scene, regardless of kind.",
    icon: LayersIcon,
    dotClass: "bg-zinc-500",
    emptyDescription: "No assets referenced by the scene yet.",
  },
  {
    id: "missing",
    name: "Missing",
    description:
      "Only assets that are referenced but not present on disk — fix these to avoid runtime errors.",
    icon: TriangleAlert,
    dotClass: "bg-red-500",
    emptyDescription:
      "No missing assets — every reference resolves on disk.",
  },
  {
    id: "texture",
    name: "Textures",
    description: "Image assets used for wall, floor, ceiling, and sprite faces.",
    icon: Image,
    dotClass: "bg-sky-400",
    emptyDescription: "No textures referenced.",
  },
  {
    id: "sound",
    name: "Sounds",
    description: "Sound effect clips triggered by entities, doors, weapons, etc.",
    icon: Volume2,
    dotClass: "bg-emerald-400",
    emptyDescription: "No sounds referenced.",
  },
  {
    id: "music",
    name: "Music",
    description: "Background music tracks looped during gameplay.",
    icon: Music,
    dotClass: "bg-violet-400",
    emptyDescription: "No musics referenced.",
  },
  {
    id: "prefab",
    name: "Prefabs",
    description: "Reusable entity templates instantiated by the scene.",
    icon: Box,
    dotClass: "bg-amber-500",
    emptyDescription: "No prefabs referenced.",
  },
  {
    id: "script",
    name: "Scripts",
    description: "Behaviour scripts attached to triggers, entities, and macros.",
    icon: FileCode,
    dotClass: "bg-zinc-400",
    emptyDescription: "No scripts referenced.",
  },
] as const;

const FILTER_IDS: ReadonlySet<string> = new Set(FILTER_META.map((f) => f.id));

function isFilterId(value: string | null): value is FilterId {
  return value != null && FILTER_IDS.has(value);
}

// Per-kind icon lookup for asset rows. Mirrors the icon used by the
// kind's filter chip so users build muscle memory across the two
// surfaces. `AssetKind` is now the full `SemanticAssetKind` superset
// (see `docs/plans/CROSS_WINDOW_DND.md` §4) — the additional kinds
// fall back to generic icons until this panel grows real chips for
// them.
const KIND_ICON: Record<AssetKind, LucideIcon> = {
  texture: Image,
  sound: Volume2,
  music: Music,
  prefab: Box,
  script: FileCode,
  sprite: Image,
  tilePreset: LayersIcon,
  scene: LayersIcon,
};

function findAsset(id: string): AssetRefRow | undefined {
  return (MOCK_ASSETS as readonly AssetRefRow[]).find((a) => a.id === id);
}

// ---------------------------------------------------------------------------
// Responsive breakpoints — measured against the panel root via a
// ResizeObserver. The asset rows shed columns as width shrinks:
//   ≥ COMPACT  — full row: icon + name + path + ref-count + missing dot
//   < COMPACT  — drop the subdued path
//   < TINY     — drop the ref count too: icon + name + missing dot
// Filter chip strip uses flex-wrap so chips spill onto a second row
// at narrow widths instead of horizontally scrolling — filter chips
// are primary navigation and must be visible at a glance.

const COMPACT_WIDTH_PX = 220;
const TINY_WIDTH_PX = 150;

/**
 * Per-filter counts (incl. the "all" + "missing" pseudo-filters). Memo
 * deps are empty because MOCK_ASSETS is a module-level const today; the
 * memo will need to depend on the real asset registry once that lands.
 */
function useFilterCounts(): Record<FilterId, number> {
  return React.useMemo(() => {
    const all = MOCK_ASSETS as readonly AssetRefRow[];
    const counts: Record<FilterId, number> = {
      all: all.length,
      missing: 0,
      texture: 0,
      sound: 0,
      music: 0,
      prefab: 0,
      script: 0,
      sprite: 0,
      tilePreset: 0,
      scene: 0,
    };
    for (const a of all) {
      counts[a.kind] += 1;
      if (a.missing) counts.missing += 1;
    }
    return counts;
  }, []);
}

// ---------------------------------------------------------------------------
// Panel

export function AssetReferencesPanel(): React.JSX.Element {
  // ---- State ------------------------------------------------------------

  const [filter, setFilter] = React.useState<FilterId>(() => {
    const stored = readLS(LS_FILTER);
    if (isFilterId(stored)) return stored;
    return DEFAULT_FILTER;
  });

  const [activeId, setActiveId] = React.useState<string>(() => {
    const stored = readLS(LS_ACTIVE_ID);
    if (stored && findAsset(stored)) return stored;
    return DEFAULT_ACTIVE_ID;
  });

  const rootRef = React.useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = React.useState<number>(0);

  React.useEffect(() => {
    const node = rootRef.current;
    if (!node || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width ?? 0;
      setWidth(w);
    });
    ro.observe(node);
    return () => ro.disconnect();
  }, []);

  const compact = width > 0 && width < COMPACT_WIDTH_PX;
  const tiny = width > 0 && width < TINY_WIDTH_PX;

  // ---- Persistence -------------------------------------------------------

  React.useEffect(() => {
    writeLS(LS_FILTER, filter);
  }, [filter]);

  React.useEffect(() => {
    writeLS(LS_ACTIVE_ID, activeId);
  }, [activeId]);

  // ---- Handlers ----------------------------------------------------------

  const handleFilterClick = React.useCallback((next: FilterId) => {
    setFilter(next);
  }, []);

  const handleFocus = React.useCallback((assetId: string) => {
    setActiveId(assetId);
    // Stub — Wave 3 will route this to the pack-asset resolver +
    // jump-to-source flow (e.g. open the texture in the texture
    // editor, scroll to a sound's row in the sound bank, etc.).
    // eslint-disable-next-line no-console
    console.log("[asset-references] focus", assetId);
  }, []);

  const handleCopyPath = React.useCallback((assetId: string) => {
    const asset = findAsset(assetId);
    if (!asset) return;
    try {
      void navigator.clipboard.writeText(asset.path);
    } catch {
      // Clipboard can be unavailable in non-secure contexts / when
      // the document isn't focused. Silent failure is fine — the
      // command palette will still register the action.
    }
  }, []);

  const handleRefresh = React.useCallback(() => {
    // Stub — Wave 3 rescans the pack asset registry. The button +
    // command exist now so muscle memory transfers when the real
    // implementation lands.
    // eslint-disable-next-line no-console
    console.log("[asset-references] refresh");
  }, []);

  // Stable refs for the registration effects — see state/README.md.
  const filterHandlerRef = React.useRef(handleFilterClick);
  const focusHandlerRef = React.useRef(handleFocus);
  const copyHandlerRef = React.useRef(handleCopyPath);
  const refreshHandlerRef = React.useRef(handleRefresh);
  React.useEffect(() => {
    filterHandlerRef.current = handleFilterClick;
    focusHandlerRef.current = handleFocus;
    copyHandlerRef.current = handleCopyPath;
    refreshHandlerRef.current = handleRefresh;
  }, [handleFilterClick, handleFocus, handleCopyPath, handleRefresh]);

  // ---- Command registry: per-filter --------------------------------------

  React.useEffect(() => {
    const unregs = FILTER_META.map((f) =>
      registerCommand({
        id: `scene.assets.filter.${f.id}`,
        title: `Filter Assets: ${f.name}`,
        category: "Assets",
        keywords: ["asset", "filter", f.id, f.name.toLowerCase()],
        description: f.description,
        run: () => filterHandlerRef.current(f.id),
      }),
    );
    return () => unregs.forEach((u) => u());
  }, []);

  // ---- Command registry: dynamic per-asset (focus + copy path) ----------

  React.useEffect(() => {
    const assets = MOCK_ASSETS as readonly AssetRefRow[];
    const unregs: Array<() => void> = [];
    for (const a of assets) {
      unregs.push(
        registerCommand({
          id: `scene.assets.focus.${a.id}`,
          title: `Focus Asset: ${a.name}`,
          category: "Assets",
          keywords: ["asset", "focus", a.kind, a.name.toLowerCase()],
          description: a.description,
          run: () => focusHandlerRef.current(a.id),
        }),
        registerCommand({
          id: `scene.assets.copyPath.${a.id}`,
          title: `Copy Path: ${a.name}`,
          category: "Assets",
          keywords: ["asset", "copy", "path", a.kind, a.name.toLowerCase()],
          description: `Copy "${a.path}" to the clipboard.`,
          run: () => copyHandlerRef.current(a.id),
        }),
      );
    }
    return () => unregs.forEach((u) => u());
  }, []);

  // ---- Command registry: refresh ----------------------------------------

  React.useEffect(
    () =>
      registerCommand({
        id: "scene.assets.refresh",
        title: "Refresh Asset References",
        category: "Assets",
        keywords: ["asset", "refresh", "rescan", "reload"],
        description: "Rescan the project's asset registry and update ref counts.",
        run: () => refreshHandlerRef.current(),
      }),
    [],
  );

  // ---- Filtered list ----------------------------------------------------

  const visibleAssets = React.useMemo(() => {
    const all = MOCK_ASSETS as readonly AssetRefRow[];
    if (filter === "all") return all;
    if (filter === "missing") return all.filter((a) => a.missing);
    return all.filter((a) => a.kind === filter);
  }, [filter]);

  const counts = useFilterCounts();

  // ---- Render ------------------------------------------------------------

  // Outer container is layout-only — DockShell wraps this in
  // <PanelSurface/>. We own:
  //   - header row: filter chip strip + refresh button
  //   - scrollable list region (vertical scroll on overflow only)
  return (
    <div
      ref={rootRef}
      data-panel="asset-references"
      className="h-full w-full flex flex-col gap-2 min-h-0"
    >
      <HeaderRow
        filter={filter}
        counts={counts}
        onFilterClick={handleFilterClick}
        onRefresh={handleRefresh}
      />

      <div className="flex-1 min-h-0 overflow-y-auto">
        <AssetList
          assets={visibleAssets}
          activeId={activeId}
          compact={compact}
          tiny={tiny}
          filter={filter}
          onFocus={handleFocus}
        />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Header row — filter chip strip + refresh button

interface HeaderRowProps {
  filter: FilterId;
  counts: Record<FilterId, number>;
  onFilterClick: (next: FilterId) => void;
  onRefresh: () => void;
}

/**
 * Wrapping filter chip strip + a trailing refresh button. Uses
 * `flex flex-wrap` so chips spill onto a second row at narrow panel
 * widths instead of horizontally scrolling — filter chips are primary
 * navigation and must be visible at a glance, per project convention.
 *
 * Mirrors the canonical PrefabBrowser / TilePresetPanel / Output /
 * Problems chip pattern: coloured dot + uppercase label + `(N)` count,
 * sized at `px-2 py-1 text-[10px]`. No icon prefix — the Lucide kind
 * icons still live on the asset row itself where they identify
 * content.
 */
function HeaderRow({
  filter,
  counts,
  onFilterClick,
  onRefresh,
}: HeaderRowProps): React.JSX.Element {
  return (
    <div className="shrink-0 flex items-start gap-1">
      <div className="flex-1 min-w-0 flex flex-wrap items-center gap-1">
        {FILTER_META.map((f) => {
          const active = f.id === filter;
          const count = counts[f.id];
          return (
            <Tooltip
              key={f.id}
              side="bottom"
              stages={[
                { delay: 1000, content: <span>{`Filter: ${f.name}`}</span> },
                {
                  delay: 3000,
                  content: (
                    <div>
                      <div className="font-semibold">{`Filter: ${f.name}`}</div>
                      <div className="text-[10px] text-(--color-fg-muted) mt-1 max-w-[400px] whitespace-normal">
                        {f.description}
                      </div>
                    </div>
                  ),
                },
              ]}
            >
              <button
                type="button"
                aria-label={`Filter ${f.name}`}
                aria-pressed={active}
                onClick={() => onFilterClick(f.id)}
                className={[
                  "shrink-0 inline-flex items-center gap-1",
                  "rounded-full px-2 py-1 text-[10px] uppercase tracking-wide",
                  "border transition-colors whitespace-nowrap",
                  active
                    ? "bg-amber-500 border-amber-500 text-zinc-950"
                    : "bg-transparent border-(--color-border-strong) text-(--color-fg-secondary) hover:border-amber-500/60 hover:text-(--color-fg-primary)",
                ].join(" ")}
              >
                <span
                  aria-hidden="true"
                  className={[
                    "inline-block w-1.5 h-1.5 rounded-full",
                    f.dotClass,
                  ].join(" ")}
                />
                <span>{f.name}</span>
                <span
                  className={[
                    "tabular-nums",
                    active ? "text-zinc-950/70" : "text-(--color-fg-muted)",
                  ].join(" ")}
                >
                  ({count})
                </span>
              </button>
            </Tooltip>
          );
        })}
      </div>

      <Tooltip
        side="bottom"
        stages={[
          { delay: 1000, content: <span>Refresh</span> },
          {
            delay: 3000,
            content: (
              <div>
                <div className="font-semibold">Refresh Asset References</div>
                <div className="text-[10px] text-(--color-fg-muted) mt-1 max-w-[400px] whitespace-normal">
                  Rescan the project&apos;s asset registry and update ref
                  counts.
                </div>
              </div>
            ),
          },
        ]}
      >
        <button
          type="button"
          aria-label="Refresh asset references"
          onClick={onRefresh}
          className={[
            "shrink-0 inline-flex items-center justify-center",
            "w-6 h-6 rounded",
            "border border-(--color-border-strong)",
            "text-(--color-fg-secondary)",
            "hover:border-amber-500/60 hover:text-(--color-fg-primary)",
            "transition-colors",
          ].join(" ")}
        >
          <RefreshCw size={11} aria-hidden="true" />
        </button>
      </Tooltip>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Asset list

interface AssetListProps {
  assets: readonly AssetRefRow[];
  activeId: string;
  compact: boolean;
  tiny: boolean;
  filter: FilterId;
  onFocus: (assetId: string) => void;
}

/**
 * Vertical list of asset rows. Empty state uses the shared
 * `<EmptyState/>` component so this panel scans identically to the
 * rest of the editor's empty surfaces, with a filter-specific
 * description so the user knows whether the list is empty because the
 * scene has no assets, or because the current filter excludes them
 * all.
 */
function AssetList({
  assets,
  activeId,
  compact,
  tiny,
  filter,
  onFocus,
}: AssetListProps): React.JSX.Element {
  if (assets.length === 0) {
    const meta =
      FILTER_META.find((f) => f.id === filter) ?? FILTER_META[0]!;
    return (
      <div className="h-full flex items-center justify-center">
        <EmptyState
          icon={<Link size={28} />}
          title="No assets match this filter"
          description={meta.emptyDescription}
        />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-0.5">
      {assets.map((a) => (
        <AssetRow
          key={a.id}
          asset={a}
          active={a.id === activeId}
          compact={compact}
          tiny={tiny}
          onClick={() => onFocus(a.id)}
        />
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Asset row

interface AssetRowProps {
  asset: AssetRefRow;
  active: boolean;
  compact: boolean;
  tiny: boolean;
  onClick: () => void;
}

function AssetRow({
  asset,
  active,
  compact,
  tiny,
  onClick,
}: AssetRowProps): React.JSX.Element {
  const Icon = KIND_ICON[asset.kind];
  const showPath = !compact;
  const showRefCount = !tiny;

  return (
    <Tooltip
      side="right"
      stages={[
        { delay: 1000, content: <span>{asset.name}</span> },
        {
          delay: 3000,
          content: (
            <div>
              <div className="font-semibold">{asset.name}</div>
              <div className="text-[10px] text-(--color-fg-muted) mt-1 max-w-[260px] whitespace-normal">
                {asset.description}
              </div>
              <div className="text-[10px] text-(--color-fg-muted) mt-1 break-all max-w-[260px]">
                {asset.path}
              </div>
              <div className="text-[10px] text-(--color-fg-muted) mt-1">
                {asset.refCount} reference{asset.refCount === 1 ? "" : "s"}
                {asset.missing ? " · MISSING on disk" : ""}
              </div>
            </div>
          ),
        },
      ]}
    >
      <button
        type="button"
        aria-label={`Focus asset: ${asset.name}`}
        aria-pressed={active}
        onClick={onClick}
        className={[
          "w-full flex items-center gap-1.5 min-h-[24px] px-1.5 rounded text-left",
          "border transition-colors",
          // Missing rows ALWAYS carry a thick red left edge so the
          // "missing on disk" signal survives both inactive and active
          // states. Top/right/bottom borders switch to amber on active
          // selection while `border-l-red-500` wins via the override.
          asset.missing
            ? active
              ? "bg-amber-500/15 border-amber-500 border-l-2 border-l-red-500"
              : "bg-red-500/[0.06] border-l-2 border-l-red-500/70 border-(--color-border-strong) hover:border-amber-500/60"
            : active
              ? "bg-amber-500/10 border-amber-500"
              : "bg-transparent border-(--color-border-strong) hover:border-amber-500/40",
        ].join(" ")}
      >
        {/* Kind icon — always present, fixed width so the name column
            aligns vertically across rows of mixed kinds. */}
        <Icon
          size={12}
          aria-hidden="true"
          className={[
            "shrink-0",
            active
              ? "text-(--color-fg-primary)"
              : "text-(--color-fg-secondary)",
          ].join(" ")}
        />

        {/* Name — flex-1 so it absorbs the row's free space, truncated
            with ellipsis at narrow widths. Full name + path live in
            the tooltip. */}
        <span
          className={[
            "flex-1 min-w-0 truncate text-[11px]",
            active
              ? "text-(--color-fg-primary) font-medium"
              : "text-(--color-fg-secondary)",
          ].join(" ")}
        >
          {asset.name}
        </span>

        {/* Subdued path — first column to drop in compact mode. */}
        {showPath ? (
          <span
            className={[
              "min-w-0 shrink truncate text-[10px]",
              "text-(--color-fg-muted) max-w-[55%]",
            ].join(" ")}
          >
            {asset.path}
          </span>
        ) : null}

        {/* Ref-count badge — drops next as the row tightens further. */}
        {showRefCount ? (
          <span
            className={[
              "shrink-0 inline-flex items-center justify-center",
              "min-w-[18px] h-4 px-1 rounded text-[9px] leading-none",
              "bg-(--color-bg-app)/60 border border-(--color-border-strong)",
              "text-(--color-fg-muted) tabular-nums",
            ].join(" ")}
            aria-label={`${asset.refCount} references`}
          >
            {asset.refCount}
          </span>
        ) : null}

        {/* Missing dot — the most important signal, always present. */}
        {asset.missing ? (
          <span
            className="shrink-0 w-1.5 h-1.5 rounded-full bg-red-500"
            aria-label="Missing on disk"
          />
        ) : null}
      </button>
    </Tooltip>
  );
}

export const MANIFEST: Pick<DockPanelDef, "id" | "title" | "icon" | "category"> = {
  id: "asset-references",
  title: "References",
  category: "Browse",
  icon: <Link size={12} />,
};

export default AssetReferencesPanel;

import React from "react";
import {
  Box,
  Boxes,
  BrickWall,
  Cloud,
  Grid3x3,
  Layers as LayersIcon,
  Package,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { DockPanelDef } from "../../../components/dock/DockShell";
import { Tooltip } from "../../../components/ui/Tooltip";
import { EmptyState } from "../../../components/ui";
import { registerCommand } from "../../../state/useCommandStore";
import {
  useTilePresetStore,
  type TilePresetCategoryFilter,
} from "../../../state/useTilePresetStore";
import {
  MOCK_TILE_PRESETS,
  type TilePresetRow,
} from "../scene-fixtures";

/**
 * TilePresetPanel — categorised tile preset picker (walls / floors /
 * ceilings / decor).
 *
 * Visual target: the TILE PRESETS section from `Editor Design/Map.png`
 * — a vertical scrolling list of rows where each row pairs a small
 * 32×32 thumbnail with a tight name label. Density matters: this is a
 * Wolfenstein-style raycaster and packs will ship dozens of textures,
 * so the picker has to surface 5–6 tiles at a glance at the default
 * panel size (~230×190px) and scroll the rest.
 *
 * Chips follow the same canonical pattern as OutputPanel and
 * ProblemsPanel: a small coloured dot prefix + uppercase label +
 * count badge, sized at `px-2 py-1` with `text-[10px]`. The category
 * strip uses `flex flex-wrap` (never a horizontal scroller) so chips
 * stay glanceable at any panel width — category filtering is primary
 * navigation, not a secondary control. Chips wrap to a second row
 * when the panel is narrow.
 *
 * State source: Wave 3.3 — reads / writes via `useTilePresetStore`.
 * The synced store handles persistence (`cardboard.sync.tile-preset`)
 * and cross-window propagation, so this panel owns no localStorage
 * logic of its own. The preset catalog itself (`MOCK_TILE_PRESETS`)
 * still lives in `scene-fixtures.ts` since the catalog is panel
 * presentation data, not synced runtime state.
 *
 * Command registry contract — every interactive control here ALSO
 * registers a command via `registerCommand`. Dynamic per-preset +
 * per-category registrations live in `useEffect`s keyed on the
 * underlying list so the palette stays in sync with whatever
 * `MOCK_TILE_PRESETS` resolves to. Each command body calls
 * `useTilePresetStore.getState()` directly — no closure-ref dance.
 */

// ---------------------------------------------------------------------------
// Category metadata

type CategoryFilter = TilePresetCategoryFilter;

interface CategoryMeta {
  id: CategoryFilter;
  name: string;
  description: string;
  /**
   * Lucide icon — used for the per-row thumbnail (NOT the chip strip,
   * which uses a coloured dot for parity with Output/Problems).
   */
  icon: LucideIcon;
  /** Tailwind colour utility for the chip's leading dot. */
  dotClass: string;
}

const CATEGORY_META: readonly CategoryMeta[] = [
  {
    id: "all",
    name: "All",
    description: "Show every tile preset across all categories.",
    icon: LayersIcon,
    dotClass: "bg-zinc-500",
  },
  {
    id: "walls",
    name: "Walls",
    description: "Vertical wall materials — brick, concrete, wood panel.",
    icon: BrickWall,
    dotClass: "bg-sky-400",
  },
  {
    id: "floors",
    name: "Floors",
    description: "Ground surfaces — stone, grass, and other floor materials.",
    icon: Grid3x3,
    dotClass: "bg-amber-500",
  },
  {
    id: "ceilings",
    name: "Ceilings",
    description: "Overhead surfaces — beamed roofs, open sky, and ceilings.",
    icon: Cloud,
    dotClass: "bg-violet-400",
  },
  {
    id: "decor",
    name: "Decor",
    description: "Placeable props and decorative cell-aligned objects.",
    icon: Package,
    dotClass: "bg-emerald-400",
  },
] as const;

function findCategoryMeta(id: CategoryFilter): CategoryMeta {
  // Falls back to "all" so a stale persisted value can never blow up
  // the render. Should be unreachable past hydration.
  return CATEGORY_META.find((c) => c.id === id) ?? CATEGORY_META[0]!;
}

/** Per-category counts (incl. the "all" pseudo-category). */
function useCategoryCounts(): Record<CategoryFilter, number> {
  return React.useMemo(() => {
    const all = MOCK_TILE_PRESETS as readonly TilePresetRow[];
    const counts: Record<CategoryFilter, number> = {
      all: all.length,
      walls: 0,
      floors: 0,
      ceilings: 0,
      decor: 0,
    };
    for (const p of all) counts[p.category] += 1;
    return counts;
  }, []);
}

// ---------------------------------------------------------------------------
// Panel

export function TilePresetPanel(): React.JSX.Element {
  // Subscribe to the synced tile-preset store. Each selector returns a
  // stable primitive so unrelated store changes don't re-render the
  // panel.
  const activeId = useTilePresetStore((s) => s.activeId);
  const activeCategory = useTilePresetStore((s) => s.activeCategory);

  // Canonical handlers (single source of truth). Both button onClicks
  // and command `run` delegate through `useTilePresetStore.getState()`
  // so no closure-ref dance is needed.
  const handlePresetClick = React.useCallback((presetId: string) => {
    useTilePresetStore.getState().setActiveId(presetId);
  }, []);

  const handleCategoryClick = React.useCallback((cat: CategoryFilter) => {
    useTilePresetStore.getState().setActiveCategory(cat);
  }, []);

  // Dynamic per-preset commands. Re-registers if MOCK_TILE_PRESETS
  // changes shape (which it will when the real store lands).
  // MOCK_TILE_PRESETS is a module-level constant so empty deps are
  // correct.
  React.useEffect(() => {
    const presets = MOCK_TILE_PRESETS as readonly TilePresetRow[];
    const unregs = presets.map((preset) =>
      registerCommand({
        id: `scene.tile.select.${preset.id}`,
        title: `Select Tile: ${preset.name}`,
        category: "Tile",
        keywords: ["tile", "preset", preset.category, preset.name],
        description: preset.description,
        run: () => useTilePresetStore.getState().setActiveId(preset.id),
      }),
    );
    return () => unregs.forEach((u) => u());
  }, []);

  // Per-category filter commands (incl. the "all" pseudo-category).
  React.useEffect(() => {
    const unregs = CATEGORY_META.map((cat) =>
      registerCommand({
        id: `scene.tile.filter.${cat.id}`,
        title: `Filter Tiles: ${cat.name}`,
        category: "Tile",
        keywords: ["tile", "filter", "category", cat.id, cat.name],
        description: cat.description,
        run: () => useTilePresetStore.getState().setActiveCategory(cat.id),
      }),
    );
    return () => unregs.forEach((u) => u());
  }, []);

  const counts = useCategoryCounts();

  const visiblePresets = React.useMemo(() => {
    const all = MOCK_TILE_PRESETS as readonly TilePresetRow[];
    if (activeCategory === "all") return all;
    return all.filter((p) => p.category === activeCategory);
  }, [activeCategory]);

  // Outer container is layout-only (no card chrome) — DockShell wraps
  // this in <PanelSurface/>. We own:
  //   - wrapping category strip (primary nav, never horizontally
  //     scrolled)
  //   - the vertical preset list below, which owns its own vertical
  //     scroll when content exceeds the available height
  return (
    <div
      data-panel="tile-preset"
      className="h-full w-full flex flex-col gap-1 min-h-0"
    >
      <CategoryFilterRow
        activeCategory={activeCategory}
        counts={counts}
        onCategoryClick={handleCategoryClick}
      />

      <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden">
        <PresetList
          presets={visiblePresets}
          activeId={activeId}
          onPresetClick={handlePresetClick}
        />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Category filter row

interface CategoryFilterRowProps {
  activeCategory: CategoryFilter;
  counts: Record<CategoryFilter, number>;
  onCategoryClick: (cat: CategoryFilter) => void;
}

/**
 * Wrapping category chip strip. Uses `flex flex-wrap` so chips spill
 * onto a second row at narrow panel widths instead of horizontally
 * scrolling — category filters are primary navigation and must be
 * visible at a glance, per project convention.
 *
 * Mirrors the canonical Output/Problems chip pattern: coloured dot +
 * uppercase label + `(N)` count, sized at `px-2 py-1 text-[10px]`. No
 * compact-mode measurer — chips simply wrap, keeping the DOM clean
 * (and screen readers happy: no duplicate hidden buttons).
 */
function CategoryFilterRow({
  activeCategory,
  counts,
  onCategoryClick,
}: CategoryFilterRowProps): React.JSX.Element {
  return (
    <div className="flex flex-wrap items-center gap-1">
      {CATEGORY_META.map((cat) => {
        const active = cat.id === activeCategory;
        const count = counts[cat.id];
        return (
          <Tooltip
            key={cat.id}
            side="bottom"
            stages={[
              { delay: 1000, content: <span>{`Filter: ${cat.name}`}</span> },
              {
                delay: 3000,
                content: (
                  <div>
                    <div className="font-semibold">{`Filter: ${cat.name}`}</div>
                    <div className="text-[10px] text-(--color-fg-muted) mt-1 max-w-[400px] whitespace-normal">
                      {cat.description}
                    </div>
                  </div>
                ),
              },
            ]}
          >
            <button
              type="button"
              aria-label={`Filter ${cat.name}`}
              aria-pressed={active}
              onClick={() => onCategoryClick(cat.id)}
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
                  cat.dotClass,
                ].join(" ")}
              />
              <span>{cat.name}</span>
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
  );
}

// ---------------------------------------------------------------------------
// Preset list

interface PresetListProps {
  presets: readonly TilePresetRow[];
  activeId: string;
  onPresetClick: (presetId: string) => void;
}

/**
 * Vertical list of preset rows. Each row is `[32×32 thumb] [name]`
 * with row height ~36px so 5+ rows fit in the default panel content
 * area (~190px) and the rest scroll. Matches the TILE PRESETS list
 * pattern in `Editor Design/Map.png`.
 *
 * Empty state uses the shared `<EmptyState/>` component so the panel
 * scans identically to Output's "no log entries" and Problems' "no
 * problems" surfaces.
 */
function PresetList({
  presets,
  activeId,
  onPresetClick,
}: PresetListProps): React.JSX.Element {
  if (presets.length === 0) {
    return (
      <div className="h-full flex items-center justify-center">
        <EmptyState
          icon={<Box size={28} />}
          title="No tile presets"
          description="No presets available for this category. Switch the filter to ALL to see every preset."
        />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-0.5 p-px">
      {presets.map((preset) => (
        <PresetRow
          key={preset.id}
          preset={preset}
          active={preset.id === activeId}
          onClick={() => onPresetClick(preset.id)}
        />
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Preset row

interface PresetRowProps {
  preset: TilePresetRow;
  active: boolean;
  onClick: () => void;
}

function PresetRow({
  preset,
  active,
  onClick,
}: PresetRowProps): React.JSX.Element {
  const meta = findCategoryMeta(preset.category);
  const Icon = meta.icon;

  return (
    <Tooltip
      side="right"
      stages={[
        { delay: 1000, content: <span>{preset.name}</span> },
        {
          delay: 3000,
          content: (
            <div>
              <div className="font-semibold">{preset.name}</div>
              <div className="text-[10px] text-(--color-fg-muted) mt-1 max-w-[400px] whitespace-normal">
                {preset.description}
              </div>
            </div>
          ),
        },
      ]}
    >
      <button
        type="button"
        aria-label={preset.name}
        aria-pressed={active}
        onClick={onClick}
        className={[
          "w-full flex items-center gap-2 px-1.5 py-1",
          "rounded transition-colors text-left",
          // Active rows get a strong amber wash + amber text + a
          // left-edge marker so the active preset reads unambiguously
          // against the dark panel surface. The thumbnail picks up
          // an amber ring below for redundancy.
          active
            ? "bg-amber-500/15 text-amber-300 border-l-2 border-amber-400"
            : "bg-transparent border-l-2 border-transparent text-(--color-fg-secondary) hover:bg-zinc-800/40 hover:text-(--color-fg-primary)",
        ].join(" ")}
      >
        {/* 32×32 thumbnail. Subtle zinc square with a centered category
            icon. Active state gets a thin amber ring (in addition to
            the row's amber wash + left border) for redundancy. Matches
            the TILE PRESETS list density in `Editor Design/Map.png` —
            5+ rows fit in the default panel height at ~36px row. */}
        <div
          className={[
            "shrink-0 w-8 h-8 rounded-sm",
            "flex items-center justify-center",
            "bg-zinc-800",
            active ? "ring-1 ring-amber-400" : "ring-1 ring-transparent",
          ].join(" ")}
        >
          <Icon
            size={14}
            aria-hidden="true"
            className={
              active
                ? "text-amber-300"
                : "text-(--color-fg-muted)"
            }
          />
        </div>
        <span
          className={[
            "min-w-0 flex-1 truncate",
            "text-[11px] leading-tight",
            "uppercase tracking-wide",
          ].join(" ")}
        >
          {preset.name}
        </span>
      </button>
    </Tooltip>
  );
}

export const MANIFEST: Pick<DockPanelDef, "id" | "title" | "icon" | "category"> = {
  id: "tile-preset",
  title: "Tile Presets",
  category: "Tools",
  icon: <Boxes size={12} />,
};

export default TilePresetPanel;

import React from "react";
import {
  Boxes,
  BrickWall,
  Grid3x3,
  Cloud,
  Package,
  Layers as LayersIcon,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { DockPanelDef } from "../../../components/dock/DockShell";
import { Tooltip } from "../../../components/ui/Tooltip";
import { registerCommand } from "../../../state/useCommandStore";
import {
  MOCK_TILE_PRESETS,
  type TilePresetCategory,
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
 * so the picker has to surface 6–8 tiles at a glance at the default
 * panel size (~230×190px) and scroll the rest.
 *
 * The category strip uses `flex flex-wrap` (never a horizontal
 * scroller) so chips stay glanceable at any panel width — category
 * filtering is primary navigation, not a secondary control. Chips
 * wrap to a second row when the panel is narrow.
 *
 * Persistence contract (scoped to this panel):
 *   - `cardboard.scene.tilePreset.activeId`        string
 *   - `cardboard.scene.tilePreset.activeCategory`  TilePresetCategory | "all"
 *
 * Command registry contract — every interactive control here ALSO
 * registers a command via `registerCommand`. Dynamic per-preset +
 * per-category registrations live in `useEffect`s keyed on the
 * underlying list so the palette stays in sync with whatever
 * `MOCK_TILE_PRESETS` resolves to.
 */

// ---------------------------------------------------------------------------
// Persistence keys + defaults

const LS_ACTIVE_ID = "cardboard.scene.tilePreset.activeId";
const LS_ACTIVE_CATEGORY = "cardboard.scene.tilePreset.activeCategory";

type CategoryFilter = TilePresetCategory | "all";

const DEFAULT_ACTIVE_ID: string = MOCK_TILE_PRESETS[0].id;
const DEFAULT_CATEGORY: CategoryFilter = "all";

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
// Category metadata

interface CategoryMeta {
  id: CategoryFilter;
  name: string;
  description: string;
  icon: LucideIcon;
  /** Tailwind colour utility for the placeholder thumbnail tint. */
  swatchClass: string;
}

const CATEGORY_META: readonly CategoryMeta[] = [
  {
    id: "all",
    name: "All",
    description: "Show every tile preset across all categories.",
    icon: LayersIcon,
    swatchClass: "bg-zinc-700/40",
  },
  {
    id: "walls",
    name: "Walls",
    description: "Vertical wall materials — brick, concrete, wood panel.",
    icon: BrickWall,
    swatchClass: "bg-rose-500/30",
  },
  {
    id: "floors",
    name: "Floors",
    description: "Ground surfaces — stone, grass, and other floor materials.",
    icon: Grid3x3,
    swatchClass: "bg-amber-500/30",
  },
  {
    id: "ceilings",
    name: "Ceilings",
    description: "Overhead surfaces — beamed roofs, open sky, and ceilings.",
    icon: Cloud,
    swatchClass: "bg-sky-500/30",
  },
  {
    id: "decor",
    name: "Decor",
    description: "Placeable props and decorative cell-aligned objects.",
    icon: Package,
    swatchClass: "bg-violet-500/30",
  },
] as const;

function findCategoryMeta(id: CategoryFilter): CategoryMeta {
  // Falls back to "all" so a stale persisted value can never blow up
  // the render. Should be unreachable past hydration.
  return CATEGORY_META.find((c) => c.id === id) ?? CATEGORY_META[0]!;
}

function findPreset(id: string): TilePresetRow | undefined {
  return (MOCK_TILE_PRESETS as readonly TilePresetRow[]).find(
    (p) => p.id === id,
  );
}

function isCategoryFilter(value: string | null): value is CategoryFilter {
  if (!value) return false;
  return CATEGORY_META.some((c) => c.id === value);
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
  const [activeId, setActiveId] = React.useState<string>(() => {
    const stored = readLS(LS_ACTIVE_ID);
    if (stored && findPreset(stored)) return stored;
    return DEFAULT_ACTIVE_ID;
  });

  const [activeCategory, setActiveCategory] = React.useState<CategoryFilter>(
    () => {
      const stored = readLS(LS_ACTIVE_CATEGORY);
      if (isCategoryFilter(stored)) return stored;
      return DEFAULT_CATEGORY;
    },
  );

  // Persist on change.
  React.useEffect(() => {
    writeLS(LS_ACTIVE_ID, activeId);
  }, [activeId]);

  React.useEffect(() => {
    writeLS(LS_ACTIVE_CATEGORY, activeCategory);
  }, [activeCategory]);

  // Click handlers — the registered commands delegate to these via a
  // ref so the registration effect doesn't need to re-run when the
  // closures change.
  const handlePresetClick = React.useCallback((presetId: string) => {
    setActiveId(presetId);
  }, []);

  const handleCategoryClick = React.useCallback((cat: CategoryFilter) => {
    setActiveCategory(cat);
  }, []);

  const presetHandlerRef = React.useRef(handlePresetClick);
  React.useEffect(() => {
    presetHandlerRef.current = handlePresetClick;
  }, [handlePresetClick]);

  const categoryHandlerRef = React.useRef(handleCategoryClick);
  React.useEffect(() => {
    categoryHandlerRef.current = handleCategoryClick;
  }, [handleCategoryClick]);

  // Dynamic per-preset commands. Re-registers if MOCK_TILE_PRESETS
  // changes shape (which it will when the real store lands).
  React.useEffect(() => {
    const presets = MOCK_TILE_PRESETS as readonly TilePresetRow[];
    const unregs = presets.map((preset) =>
      registerCommand({
        id: `scene.tile.select.${preset.id}`,
        title: `Select Tile: ${preset.name}`,
        category: "Tile",
        keywords: ["tile", "preset", preset.category, preset.name],
        description: preset.description,
        run: () => presetHandlerRef.current(preset.id),
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
        run: () => categoryHandlerRef.current(cat.id),
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
  //   - eyebrow label + wrapping category strip (primary nav, never
  //     horizontally scrolled)
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
 * When even the wrapped 2-row layout would dominate the panel, the
 * strip auto-collapses to icon-only chips (labels move to the
 * stage-1 tooltip). This keeps the strip readable while preserving
 * vertical real estate for the preset list below.
 */
function CategoryFilterRow({
  activeCategory,
  counts,
  onCategoryClick,
}: CategoryFilterRowProps): React.JSX.Element {
  const containerRef = React.useRef<HTMLDivElement | null>(null);
  const fullRowRef = React.useRef<HTMLDivElement | null>(null);
  const [compact, setCompact] = React.useState(false);

  // Measure the full-label layout's natural width against the
  // container width. If two rows of full labels would still overflow
  // (i.e. the natural width is > 2× container width), drop to
  // icon-only. We compute against the hidden "measurer" copy so the
  // visible row never thrashes layout.
  React.useEffect(() => {
    const container = containerRef.current;
    const measurer = fullRowRef.current;
    if (!container || !measurer) return;
    const update = () => {
      const cw = container.clientWidth;
      if (cw <= 0) return;
      // Sum up natural chip widths from the off-screen measurer.
      const chips = Array.from(measurer.children) as HTMLElement[];
      const totalWidth = chips.reduce(
        (s, c) => s + c.getBoundingClientRect().width,
        0,
      );
      const gapAllowance = Math.max(0, chips.length - 1) * 4;
      const needed = totalWidth + gapAllowance;
      // Collapse to icon-only when full labels would force a wrap.
      // Single-row icon chips preserve vertical real estate for the
      // preset list (the primary content) while still telegraphing
      // category at a glance via the icon + count.
      setCompact(needed > cw);
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(container);
    return () => ro.disconnect();
  }, []);

  return (
    <div ref={containerRef} className="relative">
      {/* Hidden full-label measurer — used only to compute natural
          widths. Position absolute so it never affects layout. */}
      <div
        ref={fullRowRef}
        aria-hidden="true"
        className="absolute -top-[9999px] -left-[9999px] flex flex-nowrap gap-1 pointer-events-none"
      >
        {CATEGORY_META.map((cat) => (
          <ChipButton
            key={`measure-${cat.id}`}
            cat={cat}
            count={counts[cat.id]}
            active={false}
            compact={false}
            onClick={() => {}}
            tabIndex={-1}
            asMeasurer
          />
        ))}
      </div>

      {/* Visible row — flex-wrap so chips spill to a second row at
          narrow panel widths instead of horizontally scrolling. */}
      <div className="flex flex-wrap gap-1">
        {CATEGORY_META.map((cat) => {
          const active = cat.id === activeCategory;
          const count = counts[cat.id];
          return (
            <ChipButton
              key={cat.id}
              cat={cat}
              count={count}
              active={active}
              compact={compact}
              onClick={() => onCategoryClick(cat.id)}
            />
          );
        })}
      </div>
    </div>
  );
}

interface ChipButtonProps {
  cat: CategoryMeta;
  count: number;
  active: boolean;
  compact: boolean;
  onClick: () => void;
  tabIndex?: number;
  asMeasurer?: boolean;
}

function ChipButton({
  cat,
  count,
  active,
  compact,
  onClick,
  tabIndex,
  asMeasurer,
}: ChipButtonProps): React.JSX.Element {
  const Icon = cat.icon;
  const button = (
    <button
      type="button"
      aria-label={`Filter ${cat.name}`}
      aria-pressed={active}
      onClick={onClick}
      tabIndex={tabIndex}
      className={[
        "inline-flex items-center gap-1",
        "rounded-full px-1.5 py-0.5 text-[10px] uppercase tracking-wide",
        "border transition-colors whitespace-nowrap",
        active
          ? "bg-amber-500 border-amber-500 text-zinc-950"
          : "bg-transparent border-(--color-border-strong) text-(--color-fg-secondary) hover:border-amber-500/60 hover:text-(--color-fg-primary)",
      ].join(" ")}
    >
      <Icon size={10} aria-hidden="true" />
      {!compact && (
        <>
          <span>{cat.name}</span>
          <span
            className={[
              "tabular-nums",
              active ? "text-zinc-950/70" : "text-(--color-fg-muted)",
            ].join(" ")}
          >
            ({count})
          </span>
        </>
      )}
      {compact && (
        <span className="tabular-nums text-[9px]">{count}</span>
      )}
    </button>
  );
  if (asMeasurer) return button;
  // Compact mode hides labels visually — surface them via the
  // progressive tooltip's stage-1 reveal so hover still tells you
  // exactly which category each chip is.
  return (
    <Tooltip
      side="bottom"
      stages={[
        { delay: 1000, content: <span>{cat.name}</span> },
        {
          delay: 3000,
          content: (
            <div>
              <div className="font-semibold">{cat.name}</div>
              <div className="text-[10px] text-(--color-fg-muted) mt-1 max-w-[400px] whitespace-normal">
                {cat.description}
              </div>
            </div>
          ),
        },
      ]}
    >
      {button}
    </Tooltip>
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
 */
function PresetList({
  presets,
  activeId,
  onPresetClick,
}: PresetListProps): React.JSX.Element {
  if (presets.length === 0) {
    return (
      <div className="text-[10px] text-(--color-fg-muted) px-1 py-2">
        No tile presets in this category.
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
          "w-full flex items-center gap-2 pr-2 py-px pl-0.5",
          "rounded transition-colors text-left",
          active
            ? "bg-amber-500/10 text-(--color-fg-primary)"
            : "bg-transparent text-(--color-fg-secondary) hover:bg-zinc-800/40 hover:text-(--color-fg-primary)",
        ].join(" ")}
      >
        {/* 24×24 thumbnail. Subtle zinc square with a centered category
            icon. Active state gets a thin amber ring rather than a full
            fill, so the row scans calmly even when active. Matches the
            TILE PRESETS list density in `Editor Design/Map.png` — small
            enough to show 5–6 rows in the default panel height. */}
        <div
          className={[
            "shrink-0 w-6 h-6 rounded-sm",
            "flex items-center justify-center",
            "bg-zinc-800",
            active ? "ring-1 ring-amber-400" : "ring-1 ring-transparent",
          ].join(" ")}
        >
          <Icon
            size={12}
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

export const MANIFEST: Pick<DockPanelDef, "id" | "title" | "icon"> = {
  id: "tile-preset",
  title: "Tile Presets",
  icon: <Boxes size={12} />,
};

export default TilePresetPanel;

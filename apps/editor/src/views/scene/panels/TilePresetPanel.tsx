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
import { ScrollRow } from "../../../components/ui/ScrollRow";
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
 * Visual target: the TILE PRESETS card from `Editor Design/Map.png`,
 * with a category tab strip across the top and a fluid thumbnail grid
 * below. Split off from the legacy `ToolsPanel`. Wave 2 wires this to
 * the pack's tile-preset registry.
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

  const visiblePresets = React.useMemo(() => {
    const all = MOCK_TILE_PRESETS as readonly TilePresetRow[];
    if (activeCategory === "all") return all;
    return all.filter((p) => p.category === activeCategory);
  }, [activeCategory]);

  // Outer container is layout-only (no card chrome) — DockShell wraps
  // this in <PanelSurface/>. We own:
  //   - vertical stack: category strip + scrollable grid region
  //   - the grid region itself owns vertical scroll when content
  //     exceeds the available height
  return (
    <div
      data-panel="tile-preset"
      className="h-full w-full flex flex-col gap-2 min-h-0"
    >
      <CategoryFilterRow
        activeCategory={activeCategory}
        onCategoryClick={handleCategoryClick}
      />

      <div className="flex-1 min-h-0 overflow-y-auto">
        <PresetGrid
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
  onCategoryClick: (cat: CategoryFilter) => void;
}

/**
 * Horizontal category chip strip. Uses `ScrollRow` so narrow panel
 * widths surface the themed hover-area affordance instead of a native
 * horizontal scrollbar (per project convention).
 */
function CategoryFilterRow({
  activeCategory,
  onCategoryClick,
}: CategoryFilterRowProps): React.JSX.Element {
  return (
    <div className="shrink-0 h-7">
      <ScrollRow contentClassName="flex items-center gap-1">
        {CATEGORY_META.map((cat) => {
          const Icon = cat.icon;
          const active = cat.id === activeCategory;
          return (
            <Tooltip
              key={cat.id}
              side="bottom"
              stages={[
                { delay: 2000, content: <span>{cat.name}</span> },
                {
                  delay: 5000,
                  content: (
                    <div>
                      <div className="font-semibold">{cat.name}</div>
                      <div className="text-[10px] text-(--color-fg-muted) mt-1 max-w-[200px] whitespace-normal">
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
                  "rounded-full px-2 py-0.5 text-[9px] uppercase tracking-wide",
                  "border transition-colors",
                  active
                    ? "bg-amber-500 border-amber-500 text-zinc-950"
                    : "bg-transparent border-(--color-border-strong) text-(--color-fg-secondary) hover:border-amber-500/60 hover:text-(--color-fg-primary)",
                ].join(" ")}
              >
                <Icon size={10} aria-hidden="true" />
                <span>{cat.name}</span>
              </button>
            </Tooltip>
          );
        })}
      </ScrollRow>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Preset grid

interface PresetGridProps {
  presets: readonly TilePresetRow[];
  activeId: string;
  onPresetClick: (presetId: string) => void;
}

/**
 * Fluid auto-fit grid of preset tiles. Column count adapts to
 * available width: each tile clamps between 56px (narrow rail) and
 * 96px (wider span) so thumbnails read at any panel size. Tile body
 * is a vertical stack: thumbnail square + tight name label.
 */
function PresetGrid({
  presets,
  activeId,
  onPresetClick,
}: PresetGridProps): React.JSX.Element {
  if (presets.length === 0) {
    return (
      <div className="text-[10px] text-(--color-fg-muted) px-1 py-2">
        No tile presets in this category.
      </div>
    );
  }

  return (
    <div
      className="grid gap-1.5 p-px"
      style={{
        gridTemplateColumns: "repeat(auto-fit, minmax(56px, 96px))",
      }}
    >
      {presets.map((preset) => (
        <PresetTile
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
// Preset tile

interface PresetTileProps {
  preset: TilePresetRow;
  active: boolean;
  onClick: () => void;
}

function PresetTile({
  preset,
  active,
  onClick,
}: PresetTileProps): React.JSX.Element {
  const meta = findCategoryMeta(preset.category);
  const Icon = meta.icon;

  return (
    <Tooltip
      side="top"
      stages={[
        { delay: 2000, content: <span>{preset.name}</span> },
        {
          delay: 5000,
          content: (
            <div>
              <div className="font-semibold">{preset.name}</div>
              <div className="text-[10px] text-(--color-fg-muted) mt-1 max-w-[220px] whitespace-normal">
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
          "w-full flex flex-col items-stretch gap-1 p-1 rounded",
          "border transition-colors text-left",
          active
            ? "bg-amber-500/10 border-amber-500 text-(--color-fg-primary)"
            : "bg-transparent border-(--color-border-strong) text-(--color-fg-secondary) hover:border-amber-500/60 hover:text-(--color-fg-primary)",
        ].join(" ")}
      >
        {/* Placeholder thumbnail — coloured swatch keyed off the
            category, with a small category icon glyph centred for
            readability at small sizes. Replace with real thumbnails
            when the pack registry lands. */}
        <div
          className={[
            "aspect-square w-full rounded-sm",
            "flex items-center justify-center",
            meta.swatchClass,
            active ? "ring-1 ring-amber-400/60" : "",
          ].join(" ")}
        >
          <Icon
            size={14}
            aria-hidden="true"
            className={active ? "text-zinc-100" : "text-(--color-fg-muted)"}
          />
        </div>
        <span
          className={[
            "block text-[9px] leading-tight truncate",
            "uppercase tracking-wide",
          ].join(" ")}
          title={preset.name}
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

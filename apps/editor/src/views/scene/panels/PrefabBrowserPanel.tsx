import React from "react";
import {
  Boxes,
  Flame,
  Layers as LayersIcon,
  MapPin,
  Package,
  Skull,
  Zap,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { DockPanelDef } from "../../../components/dock/DockShell";
import { Tooltip } from "../../../components/ui/Tooltip";
import { ScrollRow } from "../../../components/ui/ScrollRow";
import { registerCommand } from "../../../state/useCommandStore";
import {
  MOCK_PREFABS,
  type PrefabCategory,
  type PrefabRow,
} from "../scene-fixtures";

/**
 * PrefabBrowserPanel — browse + place prefab instances.
 *
 * Opt-in panel (not part of the default Map.png layout). Lists every
 * prefab defined in the active pack chain; filterable by category. In
 * Entity mode the user selects a prefab in this panel then drags or
 * clicks on the canvas to instantiate it. Wave 3 wires this to the
 * pack registry's prefab table and the canvas drop handler — Wave 2
 * is purely state-shaped against `MOCK_PREFABS` so the UX is real
 * while the data side comes together.
 *
 * Persistence contract (scoped to this panel):
 *   - `cardboard.scene.prefab.activeId`        string
 *   - `cardboard.scene.prefab.activeCategory`  PrefabCategory | "all"
 *
 * Command registry contract — every interactive control here ALSO
 * registers a command via `registerCommand`. Dynamic per-prefab +
 * per-category registrations live in `useEffect`s keyed on the
 * underlying list so the palette stays in sync with whatever
 * `MOCK_PREFABS` resolves to.
 */

// ---------------------------------------------------------------------------
// Persistence keys + defaults

const LS_ACTIVE_ID = "cardboard.scene.prefab.activeId";
const LS_ACTIVE_CATEGORY = "cardboard.scene.prefab.activeCategory";

type CategoryFilter = PrefabCategory | "all";

const DEFAULT_ACTIVE_ID: string = MOCK_PREFABS[0].id;
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
    description: "Show every prefab across all categories.",
    icon: LayersIcon,
    swatchClass: "bg-zinc-700/40",
  },
  {
    id: "enemy",
    name: "Enemy",
    description: "Hostile NPC prefabs — grunts, snipers, bosses.",
    icon: Skull,
    swatchClass: "bg-rose-500/30",
  },
  {
    id: "item",
    name: "Item",
    description: "Pickup prefabs — medkits, armor, keycards.",
    icon: Package,
    swatchClass: "bg-amber-500/30",
  },
  {
    id: "trigger",
    name: "Trigger",
    description: "Event-volume prefabs — door triggers, checkpoints, zones.",
    icon: Zap,
    swatchClass: "bg-sky-500/30",
  },
  {
    id: "spawn",
    name: "Spawn",
    description: "Spawn-point prefabs — player and enemy spawn markers.",
    icon: MapPin,
    swatchClass: "bg-emerald-500/30",
  },
  {
    id: "decor",
    name: "Decor",
    description: "Decorative non-interactive prefabs — torches, banners, dressing.",
    icon: Flame,
    swatchClass: "bg-violet-500/30",
  },
] as const;

function findCategoryMeta(id: CategoryFilter): CategoryMeta {
  // Falls back to "all" so a stale persisted value can never blow up
  // the render. Should be unreachable past hydration.
  return CATEGORY_META.find((c) => c.id === id) ?? CATEGORY_META[0]!;
}

function findPrefab(id: string): PrefabRow | undefined {
  return (MOCK_PREFABS as readonly PrefabRow[]).find((p) => p.id === id);
}

function isCategoryFilter(value: string | null): value is CategoryFilter {
  if (!value) return false;
  return CATEGORY_META.some((c) => c.id === value);
}

function capitalize(value: string): string {
  return value.length === 0 ? value : value[0]!.toUpperCase() + value.slice(1);
}

// ---------------------------------------------------------------------------
// Panel

export function PrefabBrowserPanel(): React.JSX.Element {
  const [activeId, setActiveId] = React.useState<string>(() => {
    const stored = readLS(LS_ACTIVE_ID);
    if (stored && findPrefab(stored)) return stored;
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
  const handlePrefabClick = React.useCallback((prefabId: string) => {
    setActiveId(prefabId);
  }, []);

  const handlePrefabPlace = React.useCallback(
    (prefab: PrefabRow) => {
      setActiveId(prefab.id);
      // Wave 3: flip canvas tool to entity-place + arm with this
      // prefab. Stub: log the intent so the command is observable in
      // dev tools.
      // eslint-disable-next-line no-console
      console.log("[prefab-browser] place intent", {
        id: prefab.id,
        name: prefab.name,
        category: prefab.category,
      });
    },
    [],
  );

  const handleCategoryClick = React.useCallback((cat: CategoryFilter) => {
    setActiveCategory(cat);
  }, []);

  const prefabHandlerRef = React.useRef(handlePrefabClick);
  React.useEffect(() => {
    prefabHandlerRef.current = handlePrefabClick;
  }, [handlePrefabClick]);

  const placeHandlerRef = React.useRef(handlePrefabPlace);
  React.useEffect(() => {
    placeHandlerRef.current = handlePrefabPlace;
  }, [handlePrefabPlace]);

  const categoryHandlerRef = React.useRef(handleCategoryClick);
  React.useEffect(() => {
    categoryHandlerRef.current = handleCategoryClick;
  }, [handleCategoryClick]);

  // Dynamic per-prefab commands — select + place. Re-registers if
  // MOCK_PREFABS changes shape (which it will when the real store
  // lands). Empty deps are intentional: MOCK_PREFABS is a
  // module-level const today.
  React.useEffect(() => {
    const prefabs = MOCK_PREFABS as readonly PrefabRow[];
    const unregs: Array<() => void> = [];
    for (const prefab of prefabs) {
      unregs.push(
        registerCommand({
          id: `scene.prefab.select.${prefab.id}`,
          title: `Select Prefab: ${prefab.name}`,
          category: "Prefab",
          keywords: ["prefab", "select", prefab.category, prefab.name],
          description: prefab.description,
          run: () => prefabHandlerRef.current(prefab.id),
        }),
      );
      unregs.push(
        registerCommand({
          id: `scene.prefab.place.${prefab.id}`,
          title: `Place Prefab: ${prefab.name}`,
          category: "Prefab",
          keywords: ["prefab", "place", "spawn", prefab.category, prefab.name],
          description: prefab.description,
          run: () => placeHandlerRef.current(prefab),
        }),
      );
    }
    return () => unregs.forEach((u) => u());
  }, []);

  // Per-category filter commands (incl. the "all" pseudo-category).
  React.useEffect(() => {
    const unregs = CATEGORY_META.map((cat) =>
      registerCommand({
        id: `scene.prefab.filter.${cat.id}`,
        title: `Filter Prefabs: ${capitalize(cat.name)}`,
        category: "Prefab",
        keywords: ["prefab", "filter", "category", cat.id, cat.name],
        description: cat.description,
        run: () => categoryHandlerRef.current(cat.id),
      }),
    );
    return () => unregs.forEach((u) => u());
  }, []);

  const visiblePrefabs = React.useMemo(() => {
    const all = MOCK_PREFABS as readonly PrefabRow[];
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
      data-panel="prefab-browser"
      className="h-full w-full flex flex-col gap-2 min-h-0"
    >
      <CategoryFilterRow
        activeCategory={activeCategory}
        onCategoryClick={handleCategoryClick}
      />

      <div className="flex-1 min-h-0 overflow-y-auto">
        <PrefabGrid
          prefabs={visiblePrefabs}
          activeId={activeId}
          onPrefabClick={handlePrefabClick}
          onPrefabPlace={handlePrefabPlace}
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
// Prefab grid

interface PrefabGridProps {
  prefabs: readonly PrefabRow[];
  activeId: string;
  onPrefabClick: (prefabId: string) => void;
  onPrefabPlace: (prefab: PrefabRow) => void;
}

/**
 * Fluid auto-fit grid of prefab tiles. Column count adapts to
 * available width: each tile clamps between 64px (narrow rail) and
 * 108px (wider span) so the thumbnail + truncated label remain
 * readable at any panel size. Tile body is a vertical stack:
 * category-tinted thumbnail square + tight name label.
 */
function PrefabGrid({
  prefabs,
  activeId,
  onPrefabClick,
  onPrefabPlace,
}: PrefabGridProps): React.JSX.Element {
  if (prefabs.length === 0) {
    return (
      <div className="text-[10px] text-(--color-fg-muted) px-1 py-2">
        No prefabs in this category.
      </div>
    );
  }

  return (
    <div
      className="grid gap-1.5 p-px"
      style={{
        gridTemplateColumns: "repeat(auto-fit, minmax(64px, 108px))",
      }}
    >
      {prefabs.map((prefab) => (
        <PrefabTile
          key={prefab.id}
          prefab={prefab}
          active={prefab.id === activeId}
          onClick={() => onPrefabClick(prefab.id)}
          onDoubleClick={() => onPrefabPlace(prefab)}
        />
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Prefab tile

interface PrefabTileProps {
  prefab: PrefabRow;
  active: boolean;
  onClick: () => void;
  onDoubleClick: () => void;
}

function PrefabTile({
  prefab,
  active,
  onClick,
  onDoubleClick,
}: PrefabTileProps): React.JSX.Element {
  const meta = findCategoryMeta(prefab.category);
  const Icon = meta.icon;

  return (
    <Tooltip
      side="top"
      stages={[
        { delay: 1000, content: <span>{prefab.name}</span> },
        {
          delay: 3000,
          content: (
            <div>
              <div className="font-semibold">{prefab.name}</div>
              <div className="text-[10px] text-(--color-fg-muted) mt-1 max-w-[400px] whitespace-normal">
                {prefab.description}
              </div>
              <div className="text-[9px] text-(--color-fg-muted) mt-1 uppercase tracking-wide">
                Double-click to place
              </div>
            </div>
          ),
        },
      ]}
    >
      <button
        type="button"
        aria-label={prefab.name}
        aria-pressed={active}
        onClick={onClick}
        onDoubleClick={onDoubleClick}
        className={[
          "w-full flex flex-col items-stretch gap-1 p-1 rounded",
          "border transition-colors text-left",
          active
            ? "bg-amber-500/10 border-amber-500 text-(--color-fg-primary)"
            : "bg-transparent border-(--color-border-strong) text-(--color-fg-secondary) hover:border-amber-500/60 hover:text-(--color-fg-primary)",
        ].join(" ")}
      >
        {/* Placeholder thumbnail — coloured swatch keyed off the
            category, with the category icon centred for readability
            at small sizes. Replace with real thumbnails when the pack
            registry lands. */}
        <div
          className={[
            "aspect-square w-full rounded-sm",
            "flex items-center justify-center",
            meta.swatchClass,
            active ? "ring-1 ring-amber-400/60" : "",
          ].join(" ")}
        >
          <Icon
            size={16}
            aria-hidden="true"
            className={active ? "text-zinc-100" : "text-(--color-fg-muted)"}
          />
        </div>
        <span
          className={[
            "block text-[9px] leading-tight truncate",
            "uppercase tracking-wide",
          ].join(" ")}
        >
          {prefab.name}
        </span>
      </button>
    </Tooltip>
  );
}

export const MANIFEST: Pick<DockPanelDef, "id" | "title" | "icon"> = {
  id: "prefab-browser",
  title: "Prefabs",
  icon: <Boxes size={12} />,
};

export default PrefabBrowserPanel;

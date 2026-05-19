import React from "react";
import {
  Box,
  Flame,
  Layers as LayersIcon,
  Lightbulb,
  List,
  Package,
  User,
  Zap,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { DockPanelDef } from "../../../components/dock/DockShell";
import { Tooltip } from "../../../components/ui/Tooltip";
import { EmptyState } from "../../../components/ui";
import { registerCommand } from "../../../state/useCommandStore";
import {
  MOCK_ENTITIES,
  type EntityCategory,
  type EntityRow,
} from "../prefabs-fixtures";

/**
 * EntityListPanel — vertical scrollable list of every entity (prefab)
 * defined in the pack.
 *
 * Visual target: the left column "ALL ENTITIES" region of
 * `Editor Design/Entities.png`. Each row renders
 * `[category icon] [name uppercase] [component count badge]` with the
 * active entity highlighted in a subtle amber accent; category filter
 * chips sit above the list and wrap to multiple rows at narrow widths.
 *
 * Pattern parity: this panel follows the canonical TilePresetPanel
 * vertical-list + wrapping-chip-strip pattern. Chip strip uses
 * `flex flex-wrap items-center gap-1` (NEVER a horizontal scroller —
 * category filtering is primary navigation and must stay glanceable at
 * any panel width).
 *
 * Persistence contract (scoped to this panel):
 *   - `cardboard.prefabs.list.activeId`        string
 *   - `cardboard.prefabs.list.activeCategory`  EntityCategory | "all"
 *
 * Command registry contract — every interactive control here ALSO
 * registers a command via `registerCommand`. Dynamic per-entity +
 * per-category registrations live in `useEffect`s keyed on the
 * underlying list so the palette stays in sync with whatever
 * `MOCK_ENTITIES` resolves to.
 *
 * Responsive contract: a `ResizeObserver` on the panel root drives a
 * "narrow" breakpoint flip. Below `NARROW_WIDTH_PX` (currently 200px)
 * the per-row component-count badge collapses out, leaving more room
 * for the entity name. The wrapping chip strip naturally flows to two
 * rows long before that threshold.
 */

// ---------------------------------------------------------------------------
// Persistence keys + defaults

const LS_ACTIVE_ID = "cardboard.prefabs.list.activeId";
const LS_ACTIVE_CATEGORY = "cardboard.prefabs.list.activeCategory";

type CategoryFilter = EntityCategory | "all";

const DEFAULT_ACTIVE_ID: string = MOCK_ENTITIES[0].id;
const DEFAULT_CATEGORY: CategoryFilter = "all";

/** Below this width, per-row component-count badges collapse out. */
const NARROW_WIDTH_PX = 200;

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
  /**
   * Lucide icon — used for the per-row thumbnail (NOT the chip strip,
   * which uses a coloured dot for parity with TilePresetPanel /
   * Output / Problems).
   */
  icon: LucideIcon;
  /** Tailwind colour utility for the chip's leading dot. */
  dotClass: string;
}

const CATEGORY_META: readonly CategoryMeta[] = [
  {
    id: "all",
    name: "All",
    description: "Show every entity across all categories.",
    icon: LayersIcon,
    dotClass: "bg-zinc-500",
  },
  {
    id: "light",
    name: "Light",
    description:
      "Illumination sources — point lights, spots, ambient fills. Drive scene atmosphere.",
    icon: Lightbulb,
    dotClass: "bg-amber-500",
  },
  {
    id: "actor",
    name: "Actor",
    description:
      "Moving NPCs and the player — anything that runs an AI brain or accepts input.",
    icon: User,
    dotClass: "bg-sky-400",
  },
  {
    id: "item",
    name: "Item",
    description:
      "Collectibles and pickups — health, ammo, weapons, keycards. Disappear on touch.",
    icon: Package,
    dotClass: "bg-emerald-400",
  },
  {
    id: "trigger",
    name: "Trigger",
    description:
      "Invisible event volumes — door triggers, exit zones, checkpoint markers.",
    icon: Zap,
    dotClass: "bg-violet-400",
  },
  {
    id: "decor",
    name: "Decor",
    description:
      "Decorative props that don't drive gameplay — torches, banners, set dressing.",
    icon: Flame,
    dotClass: "bg-rose-400",
  },
] as const;

function findCategoryMeta(id: CategoryFilter): CategoryMeta {
  // Falls back to "all" so a stale persisted value can never blow up
  // the render. Should be unreachable past hydration.
  return CATEGORY_META.find((c) => c.id === id) ?? CATEGORY_META[0]!;
}

function findEntity(id: string): EntityRow | undefined {
  return (MOCK_ENTITIES as readonly EntityRow[]).find((e) => e.id === id);
}

function isCategoryFilter(value: string | null): value is CategoryFilter {
  if (!value) return false;
  return CATEGORY_META.some((c) => c.id === value);
}

/** Per-category counts (incl. the "all" pseudo-category). */
function useCategoryCounts(): Record<CategoryFilter, number> {
  return React.useMemo(() => {
    const all = MOCK_ENTITIES as readonly EntityRow[];
    const counts: Record<CategoryFilter, number> = {
      all: all.length,
      light: 0,
      actor: 0,
      item: 0,
      trigger: 0,
      decor: 0,
    };
    for (const e of all) counts[e.category] += 1;
    return counts;
  }, []);
}

// ---------------------------------------------------------------------------
// Panel

export function EntityListPanel(): React.JSX.Element {
  const [activeId, setActiveId] = React.useState<string>(() => {
    const stored = readLS(LS_ACTIVE_ID);
    if (stored && findEntity(stored)) return stored;
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
  const handleEntityClick = React.useCallback((entityId: string) => {
    setActiveId(entityId);
  }, []);

  const handleCategoryClick = React.useCallback((cat: CategoryFilter) => {
    setActiveCategory(cat);
  }, []);

  const entityHandlerRef = React.useRef(handleEntityClick);
  React.useEffect(() => {
    entityHandlerRef.current = handleEntityClick;
  }, [handleEntityClick]);

  const categoryHandlerRef = React.useRef(handleCategoryClick);
  React.useEffect(() => {
    categoryHandlerRef.current = handleCategoryClick;
  }, [handleCategoryClick]);

  // Dynamic per-entity commands. Re-registers if MOCK_ENTITIES changes
  // shape (which it will when the real store lands). Empty deps are
  // intentional: MOCK_ENTITIES is a module-level const today.
  React.useEffect(() => {
    const entities = MOCK_ENTITIES as readonly EntityRow[];
    const unregs = entities.map((entity) =>
      registerCommand({
        id: `prefabs.entity.select.${entity.id}`,
        title: `Select Entity: ${entity.name}`,
        category: "Entity",
        keywords: ["entity", "prefab", "select", entity.category, entity.name],
        description: entity.description,
        run: () => entityHandlerRef.current(entity.id),
      }),
    );
    return () => unregs.forEach((u) => u());
  }, []);

  // Per-category filter commands (incl. the "all" pseudo-category).
  React.useEffect(() => {
    const unregs = CATEGORY_META.map((cat) =>
      registerCommand({
        id: `prefabs.list.filter.${cat.id}`,
        title: `Filter Entities: ${cat.name}`,
        category: "Entity",
        keywords: ["entity", "filter", "category", cat.id, cat.name],
        description: cat.description,
        run: () => categoryHandlerRef.current(cat.id),
      }),
    );
    return () => unregs.forEach((u) => u());
  }, []);

  const counts = useCategoryCounts();

  const visibleEntities = React.useMemo(() => {
    const all = MOCK_ENTITIES as readonly EntityRow[];
    if (activeCategory === "all") return all;
    return all.filter((e) => e.category === activeCategory);
  }, [activeCategory]);

  // ResizeObserver — at narrow widths the per-row component count
  // badge drops to reclaim space for the entity name. The wrapping
  // chip strip handles its own narrow-width behaviour via `flex-wrap`.
  const rootRef = React.useRef<HTMLDivElement | null>(null);
  const [narrow, setNarrow] = React.useState(false);

  React.useEffect(() => {
    const node = rootRef.current;
    if (!node || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width ?? 0;
      setNarrow(w > 0 && w < NARROW_WIDTH_PX);
    });
    ro.observe(node);
    return () => ro.disconnect();
  }, []);

  // Outer container is layout-only (no card chrome) — DockShell wraps
  // this in <PanelSurface/>. We own:
  //   - wrapping category strip (primary nav, never horizontally
  //     scrolled)
  //   - the vertical entity list below, which owns its own vertical
  //     scroll when content exceeds the available height
  return (
    <div
      ref={rootRef}
      data-panel="entity-list"
      className="h-full w-full flex flex-col gap-1 min-h-0 overflow-x-hidden"
    >
      <CategoryFilterRow
        activeCategory={activeCategory}
        counts={counts}
        onCategoryClick={handleCategoryClick}
      />

      <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden">
        <EntityList
          entities={visibleEntities}
          activeId={activeId}
          activeCategory={activeCategory}
          narrow={narrow}
          onEntityClick={handleEntityClick}
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
 * Mirrors the canonical TilePresetPanel / Output / Problems chip
 * pattern: coloured dot + uppercase label + `(N)` count, sized at
 * `px-2 py-1 text-[10px]`.
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
// Entity list

interface EntityListProps {
  entities: readonly EntityRow[];
  activeId: string;
  activeCategory: CategoryFilter;
  narrow: boolean;
  onEntityClick: (entityId: string) => void;
}

/**
 * Vertical list of entity rows. Each row is
 * `[icon-square] [name uppercase] [component count badge]` at row
 * height ~32px so 5+ rows fit comfortably in the default panel
 * content area and the rest scroll. Matches the ALL ENTITIES list
 * pattern in `Editor Design/Entities.png`.
 *
 * Empty state uses the shared `<EmptyState/>` component so the panel
 * scans identically to Output's "no log entries" and TilePresets' "no
 * tile presets" surfaces. Title + description vary by whether a
 * category filter is active.
 */
function EntityList({
  entities,
  activeId,
  activeCategory,
  narrow,
  onEntityClick,
}: EntityListProps): React.JSX.Element {
  if (entities.length === 0) {
    const filterName = findCategoryMeta(activeCategory).name;
    const isAllFilter = activeCategory === "all";
    return (
      <div className="h-full flex items-center justify-center">
        <EmptyState
          icon={<Box size={28} />}
          title={isAllFilter ? "No entities" : `No ${filterName} entities`}
          description={
            isAllFilter
              ? "No entities defined in the active pack yet. Add one to get started."
              : `No entities in the ${filterName} category. Switch the filter to ALL to see every entity.`
          }
        />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-0.5 p-px">
      {entities.map((entity) => (
        <EntityRowItem
          key={entity.id}
          entity={entity}
          active={entity.id === activeId}
          narrow={narrow}
          onClick={() => onEntityClick(entity.id)}
        />
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Entity row

interface EntityRowItemProps {
  entity: EntityRow;
  active: boolean;
  narrow: boolean;
  onClick: () => void;
}

function EntityRowItem({
  entity,
  active,
  narrow,
  onClick,
}: EntityRowItemProps): React.JSX.Element {
  const meta = findCategoryMeta(entity.category);
  const Icon = meta.icon;
  const componentCount = entity.components.length;

  return (
    <Tooltip
      side="right"
      stages={[
        { delay: 1000, content: <span>{entity.name}</span> },
        {
          delay: 3000,
          content: (
            <div>
              <div className="font-semibold">{entity.name}</div>
              <div className="text-[10px] text-(--color-fg-muted) mt-1 max-w-[400px] whitespace-normal">
                {entity.description}
              </div>
              <div className="text-[10px] text-(--color-fg-muted) mt-1">
                {componentCount} component{componentCount === 1 ? "" : "s"}
              </div>
            </div>
          ),
        },
      ]}
    >
      <button
        type="button"
        aria-label={entity.name}
        aria-pressed={active}
        onClick={onClick}
        className={[
          "w-full flex items-center gap-2 px-1.5 py-1",
          "rounded transition-colors text-left",
          // Calm active treatment — subtle amber wash + amber text + a
          // left-edge marker. Mirrors TilePresetPanel so the active
          // entity reads unambiguously without overpowering the row.
          active
            ? "bg-amber-500/15 text-amber-300 border-l-2 border-amber-400"
            : "bg-transparent border-l-2 border-transparent text-(--color-fg-secondary) hover:bg-zinc-800/40 hover:text-(--color-fg-primary)",
        ].join(" ")}
      >
        {/* 28×28 icon square. Subtle zinc square with a centered
            category icon. Active state gets a thin amber ring (in
            addition to the row's amber wash + left border) for
            redundancy. Matches the ALL ENTITIES list density in
            `Editor Design/Entities.png`. */}
        <div
          className={[
            "shrink-0 w-7 h-7 rounded-sm",
            "flex items-center justify-center",
            "bg-zinc-800",
            active ? "ring-1 ring-amber-400" : "ring-1 ring-transparent",
          ].join(" ")}
        >
          <Icon
            size={13}
            aria-hidden="true"
            className={active ? "text-amber-300" : "text-(--color-fg-muted)"}
          />
        </div>
        <span
          className={[
            "min-w-0 flex-1 truncate",
            "text-[11px] leading-tight",
            "uppercase tracking-wide",
          ].join(" ")}
        >
          {entity.name}
        </span>
        {/* Component-count badge. Drops out at narrow widths to
            reclaim space for the name. Uses the same calm muted
            styling as TilePresetPanel's secondary chips. */}
        {!narrow ? (
          <span
            aria-hidden="true"
            className={[
              "shrink-0 inline-flex items-center justify-center",
              "rounded-full px-1.5 py-0.5",
              "text-[9px] tabular-nums",
              "border",
              active
                ? "border-amber-400/40 text-amber-300/80 bg-amber-500/10"
                : "border-(--color-border-strong) text-(--color-fg-muted) bg-transparent",
            ].join(" ")}
          >
            {componentCount}
          </span>
        ) : null}
      </button>
    </Tooltip>
  );
}

export const MANIFEST: Pick<DockPanelDef, "id" | "title" | "icon"> = {
  id: "entity-list",
  title: "Entities",
  icon: <List size={12} />,
};

export default EntityListPanel;

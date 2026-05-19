// TODO: wire to selection store + cell store. For now the panel
// imports MOCK_CELL as if it were the currently-selected cell and
// keeps its edits in local state (no persistence; reset on remount).
import React from "react";
import { SlidersHorizontal, X, Plus, ChevronDown } from "lucide-react";
import type { DockPanelDef } from "../../../components/dock/DockShell";
import { Tooltip } from "../../../components/ui/Tooltip";
import { Chip } from "../../../components/ui/Chip";
import { ToggleSwitch } from "../../../components/ui/controls";
import { TextInput } from "../../../components/ui/TextInput";
import { NumberInput } from "../../../components/ui/NumberInput";
import { registerCommand } from "../../../state/useCommandStore";
import { MOCK_CELL, MOCK_LAYERS, type CellRow } from "../scene-fixtures";

/**
 * CellInspectorPanel — per-cell property editor.
 *
 * Visual target: the right column of `Editor Design/Map.png` — a
 * property-sheet for the selected cell. Header shows the cell coords
 * + type chip + a Deselect button. Body is a vertical list of:
 *   - Tags (flex-wrap pill row, each chip toggles on click, with a
 *     `+` button at the end that reveals an inline TextInput).
 *   - Properties (one row per `properties[k]`, control matches value
 *     type — boolean → ToggleSwitch, number → NumberInput, string →
 *     TextInput).
 *
 * Responsive behaviour: the panel watches its own size with a
 * `ResizeObserver`. Below `NARROW_WIDTH_PX` (currently 220px) the
 * property rows switch from a side-by-side `[label] [control]`
 * layout to a stacked `[label]\n[control]` two-row layout so labels
 * and inputs both stay readable on the narrow rail. Tag chips
 * naturally flex-wrap; no horizontal scroll is ever introduced.
 * Vertical overflow uses the themed scrollbar.
 *
 * Commands registered:
 *   - `scene.cell.deselect`
 *   - `scene.cell.addTag`
 *   - `scene.cell.tag.toggle.<tag>` (dynamic, one per current tag)
 *   - `scene.cell.property.toggle.<key>` (dynamic, per boolean prop)
 *   - `scene.cell.editProperty.<key>` (dynamic, per non-boolean prop;
 *     focuses the input)
 */

/** Width below which the panel collapses to a single-column stacked
 *  layout. Picked empirically — at 160px the side-by-side label/control
 *  grid is still readable for short labels + compact controls; below
 *  that, controls need their own row. Kept low so the default rail
 *  width (content ~172px after scrollbar) stays side-by-side. */
const NARROW_WIDTH_PX = 160;

/** Below this width the panel hides the "CELL" eyebrow label so the
 *  (x,y) coord + deselect button still fit without clipping. */
const COMPACT_HEADER_WIDTH_PX = 120;

/** Below this width the panel renders a minimal "resize me" fallback —
 *  the full property sheet is unusable in that little space. */
const TINY_WIDTH_PX = 120;

/** Format a camelCase property key as spaced uppercase for display.
 *  `blocksMovement` → `BLOCKS MOVEMENT`. The underlying `key` is
 *  preserved — this only affects the rendered label. */
function toLabel(key: string): string {
  return key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .toUpperCase();
}

/** Human-readable descriptions used by progressive tooltips on the
 *  tag chips. Unknown tags fall back to a generic blurb. */
const TAG_DESCRIPTIONS: Record<string, string> = {
  solid: "This cell blocks movement and line of sight.",
  "ambush-cover":
    "Marks a cell as a cover spot — AI prefers to take cover here.",
  door: "Cell can be opened or closed; affects pathfinding edges.",
  trigger: "Fires a scripted event when entered or interacted with.",
  spawn: "Spawn point for actors or entities.",
  exit: "Marks a level exit; transitions when the player steps in.",
  secret: "Hidden until discovered — typically a wall that reveals later.",
  decor: "Visual-only; does not affect gameplay.",
  lit: "Cell emits or receives strong light; included in light bake hints.",
  loot: "Marks a loot drop or container spawn.",
};

/** Descriptions for the well-known property keys on `MOCK_CELL`. New
 *  property keys created by `editProperty` fall back to a generic
 *  per-type blurb. */
const PROPERTY_DESCRIPTIONS: Record<string, string> = {
  blocksMovement: "Entities cannot pathfind through this cell.",
  blocksLight: "Light samples cannot pass through this cell.",
  material: "Surface material tag — affects footstep audio + decals.",
  health:
    "Destructible health pool. Reach zero to convert to rubble.",
};

function tagDescription(tag: string): string {
  return TAG_DESCRIPTIONS[tag] ?? "Tag attached to this cell.";
}

function propertyDescription(key: string, value: unknown): string {
  const explicit = PROPERTY_DESCRIPTIONS[key];
  if (explicit) return explicit;
  if (typeof value === "boolean") return `Boolean property: ${key}.`;
  if (typeof value === "number") return `Numeric property: ${key}.`;
  return `Property: ${key}.`;
}

export function CellInspectorPanel(): React.JSX.Element {
  // Local panel state — owns the mutable copy of MOCK_CELL.
  // `null` means "deselected" (the deselect command clears it).
  const [cell, setCell] = React.useState<CellRow | null>(() => ({
    ...MOCK_CELL,
    tags: [...MOCK_CELL.tags],
    properties: { ...MOCK_CELL.properties },
  }));

  const [addingTag, setAddingTag] = React.useState(false);
  const [tagDraft, setTagDraft] = React.useState("");
  const addTagInputRef = React.useRef<HTMLInputElement>(null);

  // refs for property inputs, keyed by property key, so the
  // `scene.cell.editProperty.<k>` commands can focus them.
  const propertyRefs = React.useRef<Record<string, HTMLInputElement | null>>(
    {},
  );

  // Container width tracking for responsive layout.
  const rootRef = React.useRef<HTMLDivElement>(null);
  const [width, setWidth] = React.useState<number>(NARROW_WIDTH_PX + 1);
  React.useEffect(() => {
    const el = rootRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver((entries) => {
      for (const e of entries) setWidth(e.contentRect.width);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const narrow = width > 0 && width < NARROW_WIDTH_PX;
  const compactHeader = width > 0 && width < COMPACT_HEADER_WIDTH_PX;
  const tiny = width > 0 && width < TINY_WIDTH_PX;

  // Focus the add-tag input when entering "adding tag" mode.
  React.useEffect(() => {
    if (addingTag) addTagInputRef.current?.focus();
  }, [addingTag]);

  // ────────────────────────────────────────────────────────────────
  // Mutators (used by both the UI and the registered commands).

  const toggleTag = React.useCallback((tag: string) => {
    setCell((prev) => {
      if (!prev) return prev;
      const has = prev.tags.includes(tag);
      return {
        ...prev,
        tags: has ? prev.tags.filter((t) => t !== tag) : [...prev.tags, tag],
      };
    });
  }, []);

  const commitNewTag = React.useCallback((raw: string) => {
    const tag = raw.trim();
    if (!tag) {
      setAddingTag(false);
      setTagDraft("");
      return;
    }
    setCell((prev) => {
      if (!prev) return prev;
      if (prev.tags.includes(tag)) return prev;
      return { ...prev, tags: [...prev.tags, tag] };
    });
    setTagDraft("");
    setAddingTag(false);
  }, []);

  const toggleProperty = React.useCallback((key: string) => {
    setCell((prev) => {
      if (!prev) return prev;
      const cur = prev.properties[key];
      if (typeof cur !== "boolean") return prev;
      return {
        ...prev,
        properties: { ...prev.properties, [key]: !cur },
      };
    });
  }, []);

  const setPropertyValue = React.useCallback(
    (key: string, value: unknown) => {
      setCell((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          properties: { ...prev.properties, [key]: value },
        };
      });
    },
    [],
  );

  const deselect = React.useCallback(() => {
    setCell(null);
    setAddingTag(false);
    setTagDraft("");
  }, []);

  // Stable refs so the command-registration effects don't have to
  // re-run on every keystroke / state change.
  const toggleTagRef = React.useRef(toggleTag);
  React.useEffect(() => {
    toggleTagRef.current = toggleTag;
  }, [toggleTag]);

  const togglePropertyRef = React.useRef(toggleProperty);
  React.useEffect(() => {
    togglePropertyRef.current = toggleProperty;
  }, [toggleProperty]);

  const deselectRef = React.useRef(deselect);
  React.useEffect(() => {
    deselectRef.current = deselect;
  }, [deselect]);

  // ────────────────────────────────────────────────────────────────
  // Static command registrations (deselect + addTag).

  React.useEffect(() => {
    const unregs = [
      registerCommand({
        id: "scene.cell.deselect",
        title: "Deselect Cell",
        category: "Cell",
        keywords: ["clear", "selection"],
        run: () => deselectRef.current(),
      }),
      registerCommand({
        id: "scene.cell.addTag",
        title: "Add Tag…",
        category: "Cell",
        keywords: ["tag", "new", "label"],
        run: () => {
          setAddingTag(true);
          // The focus effect (keyed on `addingTag`) takes it from here.
        },
      }),
    ];
    return () => unregs.forEach((u) => u());
  }, []);

  // ────────────────────────────────────────────────────────────────
  // Dynamic registrations: one toggle command per current tag.
  const currentTags = cell?.tags ?? [];
  React.useEffect(() => {
    if (!cell) return;
    const unregs = currentTags.map((tag) =>
      registerCommand({
        id: `scene.cell.tag.toggle.${tag}`,
        title: `Toggle Tag: ${tag}`,
        category: "Cell",
        keywords: ["tag", tag],
        run: () => toggleTagRef.current(tag),
      }),
    );
    return () => unregs.forEach((u) => u());
    // currentTags is a derived array — depending on its joined string
    // keeps the effect deps stable (re-runs when the set genuinely
    // changes, not just when React re-renders).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentTags.join("|"), cell !== null]);

  // ────────────────────────────────────────────────────────────────
  // Dynamic registrations: one command per property key — toggle for
  // booleans, edit-focus for non-booleans.
  const propertyEntries = React.useMemo<
    Array<{ key: string; value: unknown }>
  >(() => {
    if (!cell) return [];
    return Object.entries(cell.properties).map(([key, value]) => ({
      key,
      value,
    }));
  }, [cell]);

  const propertyKeysSig = propertyEntries
    .map((p) => `${p.key}:${typeof p.value}`)
    .join("|");

  React.useEffect(() => {
    if (!cell) return;
    const unregs: Array<() => void> = [];
    for (const { key, value } of propertyEntries) {
      if (typeof value === "boolean") {
        unregs.push(
          registerCommand({
            id: `scene.cell.property.toggle.${key}`,
            title: `Toggle Property: ${key}`,
            category: "Cell",
            keywords: ["property", key],
            run: () => togglePropertyRef.current(key),
          }),
        );
      } else {
        unregs.push(
          registerCommand({
            id: `scene.cell.editProperty.${key}`,
            title: `Edit Property: ${key}`,
            category: "Cell",
            keywords: ["property", "edit", key],
            run: () => propertyRefs.current[key]?.focus(),
          }),
        );
      }
    }
    return () => unregs.forEach((u) => u());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [propertyKeysSig, cell !== null]);

  // ────────────────────────────────────────────────────────────────
  // Render — deselected state first.

  if (!cell) {
    return (
      <div
        ref={rootRef}
        data-panel="cell-inspector"
        className="h-full w-full flex items-center justify-center text-center px-2"
      >
        <div className="text-[11px] uppercase tracking-wider text-(--color-fg-muted)">
          No cell selected
        </div>
      </div>
    );
  }

  // Sorted property list — booleans first, then numbers, then strings.
  const sortedProperties = [...propertyEntries].sort((a, b) => {
    const rank = (v: unknown) =>
      typeof v === "boolean" ? 0 : typeof v === "number" ? 1 : 2;
    const r = rank(a.value) - rank(b.value);
    return r !== 0 ? r : a.key.localeCompare(b.key);
  });

  // Tiny-width fallback — the full property sheet is unusable below
  // ~120px so render a minimal "resize me" prompt instead.
  if (tiny) {
    return (
      <div
        ref={rootRef}
        data-panel="cell-inspector"
        className="h-full w-full flex items-center justify-center text-[10px] text-(--color-fg-muted) text-center px-2"
      >
        Resize panel to inspect cell
      </div>
    );
  }

  return (
    <div
      ref={rootRef}
      data-panel="cell-inspector"
      className="h-full w-full flex flex-col gap-1 overflow-y-auto overflow-x-hidden text-(--color-fg-primary)"
    >
      {/* Row 1 — Compact coord inline with deselect button.
          Keeps the header to a single line so TYPE/TAGS can stay above
          the fold at default ~180×270 panel size. */}
      <header className="flex items-center gap-2">
        <div className="min-w-0 flex-1 flex items-baseline gap-1.5 truncate">
          {!compactHeader && (
            <span className="text-[10px] uppercase tracking-wider text-(--color-fg-muted) shrink-0">
              Cell
            </span>
          )}
          <Tooltip
            stages={[
              {
                delay: 1000,
                content: <span>{`x: ${cell.x}, y: ${cell.y}`}</span>,
              },
              {
                delay: 3000,
                content: (
                  <div className="max-w-[400px]">
                    <div className="font-semibold">
                      {`(${cell.x}, ${cell.y})`}
                    </div>
                    <div className="text-[10px] text-(--color-fg-muted) mt-1">
                      Coordinates of the selected cell in tile-space.
                    </div>
                  </div>
                ),
              },
            ]}
          >
            <span className="font-mono text-base text-(--color-fg-primary) tabular-nums truncate leading-none min-w-0">
              ({cell.x}, {cell.y})
            </span>
          </Tooltip>
        </div>

        <Tooltip
          stages={[
            { delay: 1000, content: <span>Deselect cell</span> },
            {
              delay: 3000,
              content: (
                <div className="max-w-[400px]">
                  <div className="font-semibold">Deselect</div>
                  <div className="text-[10px] text-(--color-fg-muted) mt-1">
                    Clear the current cell selection. Equivalent to
                    pressing Escape in the canvas.
                  </div>
                </div>
              ),
            },
          ]}
        >
          <button
            type="button"
            aria-label="Deselect cell"
            onClick={deselect}
            className={[
              "shrink-0 w-6 inline-flex items-center justify-center",
              "h-5 rounded border text-(--color-fg-secondary)",
              "border-(--color-border-strong) bg-transparent",
              "hover:text-(--color-fg-primary) hover:border-amber-500/60",
              "transition-colors",
            ].join(" ")}
          >
            <X size={11} aria-hidden="true" />
          </button>
        </Tooltip>
      </header>

      {/* Row 2 — Type. Single label:value row. */}
      <section className="flex flex-col">
        <Row
          label={
            <Tooltip
              stages={[
                { delay: 1000, content: <span>Type</span> },
                {
                  delay: 3000,
                  content: (
                    <div className="max-w-[400px]">
                      <div className="font-semibold">Type</div>
                      <div className="text-[10px] text-(--color-fg-muted) mt-1">
                        The tile preset stamped on this cell (e.g.
                        wall-brick, floor-stone).
                      </div>
                    </div>
                  ),
                },
              ]}
            >
              <span className="cursor-help">Type</span>
            </Tooltip>
          }
          stacked={narrow}
        >
          <Tooltip
            stages={[
              { delay: 1000, content: <span>Type</span> },
              {
                delay: 3000,
                content: (
                  <div className="max-w-[400px]">
                    <div className="font-semibold">Type</div>
                    <div className="text-[10px] text-(--color-fg-muted) mt-1">
                      The tile preset stamped on this cell (e.g.
                      wall-brick, floor-stone).
                    </div>
                  </div>
                ),
              },
            ]}
          >
            <TextInput
              value={cell.type}
              onChange={(e) =>
                setCell((prev) =>
                  prev ? { ...prev, type: e.target.value } : prev,
                )
              }
              aria-label="Cell type"
            />
          </Tooltip>
        </Row>
      </section>

      {/* Row 3 — TAGS. Promoted above height/layer so tag chips are
          visible without scrolling at default panel size. Tags drive
          engine behavior (solid/door/trigger/spawn) so they earn the
          prime real-estate. */}
      <section className="flex flex-col gap-0.5">
        <Tooltip
          stages={[
            { delay: 1000, content: <span>Tags</span> },
            {
              delay: 3000,
              content: (
                <div className="max-w-[400px]">
                  <div className="font-semibold">Tags</div>
                  <div className="text-[10px] text-(--color-fg-muted) mt-1">
                    Gameplay tags applied to this cell — drive engine
                    behavior (solid, door, trigger, etc.).
                  </div>
                </div>
              ),
            },
          ]}
        >
          <div className="text-[10px] uppercase tracking-wider text-(--color-fg-muted) cursor-help">
            Tags
          </div>
        </Tooltip>
        <div className="flex flex-wrap gap-1 items-center">
          {cell.tags.map((tag) => (
            <Tooltip
              key={tag}
              stages={[
                { delay: 1000, content: <span>{tag}</span> },
                {
                  delay: 3000,
                  content: (
                    <div className="max-w-[400px]">
                      <div className="font-semibold">{tag}</div>
                      <div className="text-[10px] text-(--color-fg-muted) mt-1 whitespace-normal">
                        {tagDescription(tag)}
                      </div>
                    </div>
                  ),
                },
              ]}
            >
              <Chip
                variant="accent"
                pill
                onClick={() => toggleTag(tag)}
              >
                {tag}
              </Chip>
            </Tooltip>
          ))}
          {addingTag ? (
            // Inline tag entry — Enter commits, Escape cancels.
            <input
              ref={addTagInputRef}
              type="text"
              value={tagDraft}
              placeholder="new tag…"
              onChange={(e) => setTagDraft(e.target.value)}
              onBlur={() => commitNewTag(tagDraft)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  commitNewTag(tagDraft);
                } else if (e.key === "Escape") {
                  e.preventDefault();
                  setTagDraft("");
                  setAddingTag(false);
                }
              }}
              className={[
                "min-w-0 max-w-[8rem] h-5 px-1.5",
                "rounded-full border text-[10px] leading-none",
                "border-amber-500/60 bg-(--color-bg-card) text-(--color-fg-primary)",
                "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-amber-400",
              ].join(" ")}
              aria-label="New tag"
            />
          ) : (
            <Tooltip
              stages={[
                { delay: 1000, content: <span>Add tag</span> },
                {
                  delay: 3000,
                  content: (
                    <div className="max-w-[400px]">
                      <div className="font-semibold">Add tag</div>
                      <div className="text-[10px] text-(--color-fg-muted) mt-1">
                        Append a new tag to this cell. Press Enter to
                        confirm, Escape to cancel.
                      </div>
                    </div>
                  ),
                },
              ]}
            >
              <button
                type="button"
                aria-label="Add tag"
                onClick={() => setAddingTag(true)}
                className={[
                  "inline-flex items-center justify-center gap-0.5",
                  "h-5 min-w-[20px] px-1.5 rounded-full border",
                  "border-dashed border-(--color-border-strong) text-(--color-fg-muted)",
                  "hover:border-amber-500/60 hover:text-(--color-fg-primary)",
                  "transition-colors text-[10px]",
                ].join(" ")}
              >
                <Plus size={10} aria-hidden="true" />
              </button>
            </Tooltip>
          )}
        </div>
      </section>

      {/* Row 4 — Height. Stacked as a full-row block — the panel rarely
          renders wider than 280px so the side-by-side layout was mostly
          noise. */}
      <section className="flex flex-col gap-0.5 min-w-0">
        <Tooltip
          stages={[
            { delay: 1000, content: <span>Height</span> },
            {
              delay: 3000,
              content: (
                <div className="max-w-[400px]">
                  <div className="font-semibold">Height</div>
                  <div className="text-[10px] text-(--color-fg-muted) mt-1">
                    Cell height in scene units. Used by the raycaster
                    for partial walls.
                  </div>
                </div>
              ),
            },
          ]}
        >
          <div className="text-[10px] uppercase tracking-wider text-(--color-fg-muted) cursor-help">
            Height
          </div>
        </Tooltip>
        <div className="flex items-center gap-1 min-w-0">
          <div className="flex-1 min-w-0">
            <NumberInput
              value={cell.height}
              onChange={(next) =>
                setCell((prev) => (prev ? { ...prev, height: next } : prev))
              }
              precision={2}
              step={0.1}
              min={0}
              max={8}
              showSteppers
            />
          </div>
          <span className="text-[10px] font-mono uppercase tracking-wider text-(--color-fg-muted) shrink-0">
            m
          </span>
        </div>
      </section>

      {/* Row 5 — Layer. Stacked full-row block; native chevron is hidden
          by `appearance-none` so we render our own. */}
      <section className="flex flex-col gap-0.5 min-w-0">
        <Tooltip
          stages={[
            { delay: 1000, content: <span>Layer</span> },
            {
              delay: 3000,
              content: (
                <div className="max-w-[400px]">
                  <div className="font-semibold">Layer</div>
                  <div className="text-[10px] text-(--color-fg-muted) mt-1">
                    The render layer this cell belongs to (Floors /
                    Walls / Doors / Sprites / Lights).
                  </div>
                </div>
              ),
            },
          ]}
        >
          <div className="text-[10px] uppercase tracking-wider text-(--color-fg-muted) cursor-help">
            Layer
          </div>
        </Tooltip>
        <Tooltip
          stages={[
            { delay: 1000, content: <span>Active Layer</span> },
            {
              delay: 3000,
              content: (
                <div className="max-w-[400px]">
                  <div className="font-semibold">Active Layer</div>
                  <div className="text-[10px] text-(--color-fg-muted) mt-1">
                    The render layer this cell's tile belongs to.
                    Changing this moves the cell between layers.
                  </div>
                </div>
              ),
            },
          ]}
        >
          <div className="relative">
            <select
              value={cell.layer}
              onChange={(e) =>
                setCell((prev) =>
                  prev ? { ...prev, layer: e.target.value } : prev,
                )
              }
              className={[
                "w-full appearance-none rounded-md border bg-(--color-bg-card)",
                "border-(--color-border-strong) text-(--color-fg-primary)",
                "pl-2 pr-5 h-6 text-xs leading-none",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400",
              ].join(" ")}
              aria-label="Cell layer"
            >
              {MOCK_LAYERS.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
              {/* If the cell references a layer not in MOCK_LAYERS, keep
                  it as an option so we don't silently lose it. */}
              {MOCK_LAYERS.every((l) => l.id !== cell.layer) && (
                <option value={cell.layer}>{cell.layer}</option>
              )}
            </select>
            <ChevronDown
              size={10}
              aria-hidden="true"
              className="absolute right-1.5 top-1/2 -translate-y-1/2 pointer-events-none text-(--color-fg-muted)"
            />
          </div>
        </Tooltip>
      </section>

      {/* Properties — bottom of the stack, scrolls when overflowing. */}
      <section className="flex flex-col gap-0.5">
        <Tooltip
          stages={[
            { delay: 1000, content: <span>Properties</span> },
            {
              delay: 3000,
              content: (
                <div className="max-w-[400px]">
                  <div className="font-semibold">Properties</div>
                  <div className="text-[10px] text-(--color-fg-muted) mt-1">
                    Per-cell key/value overrides — fine-grained behavior
                    tweaks beyond tags.
                  </div>
                </div>
              ),
            },
          ]}
        >
          <div className="text-[10px] uppercase tracking-wider text-(--color-fg-muted) cursor-help">
            Properties
          </div>
        </Tooltip>
        <div className="flex flex-col">
          {sortedProperties.map(({ key, value }) => (
            <PropertyControl
              key={key}
              propKey={key}
              value={value}
              narrow={narrow}
              onToggleBoolean={() => toggleProperty(key)}
              onChangeValue={(v) => setPropertyValue(key, v)}
              inputRef={(el) => {
                propertyRefs.current[key] = el;
              }}
            />
          ))}
        </div>
      </section>
    </div>
  );
}

/* -------------------------------------------------------------------- */
/* Helper components                                                     */
/* -------------------------------------------------------------------- */

/** Inline property row — uses CSS grid in side-by-side mode and a
 *  stacked flex layout in narrow mode. Kept local because the global
 *  `PropertyRow` primitive uses a 40/60 grid that's too narrow for
 *  the values here. */
function Row({
  label,
  children,
  stacked,
}: {
  label: React.ReactNode;
  children: React.ReactNode;
  stacked: boolean;
}) {
  if (stacked) {
    return (
      <div className="flex flex-col gap-1 py-px">
        <div className="text-[10px] uppercase tracking-wider text-(--color-fg-muted)">
          {label}
        </div>
        <div className="min-w-0">{children}</div>
      </div>
    );
  }
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)] items-center gap-2 py-px">
      <div className="text-[10px] uppercase tracking-wider text-(--color-fg-muted) truncate">
        {label}
      </div>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

interface PropertyControlProps {
  propKey: string;
  value: unknown;
  narrow: boolean;
  onToggleBoolean: () => void;
  onChangeValue: (next: unknown) => void;
  inputRef: (el: HTMLInputElement | null) => void;
}

function PropertyControl({
  propKey,
  value,
  narrow,
  onToggleBoolean,
  onChangeValue,
  inputRef,
}: PropertyControlProps) {
  const desc = propertyDescription(propKey, value);
  const displayLabel = toLabel(propKey);
  const labelNode = (
    <Tooltip
      stages={[
        { delay: 1000, content: <span>{propKey}</span> },
        {
          delay: 3000,
          content: (
            <div className="max-w-[400px]">
              <div className="font-semibold">{propKey}</div>
              <div className="text-[10px] text-(--color-fg-muted) mt-1 whitespace-normal">
                {desc}
              </div>
            </div>
          ),
        },
      ]}
    >
      <span
        className="text-[10px] uppercase tracking-wider text-(--color-fg-muted) truncate cursor-help"
      >
        {displayLabel}
      </span>
    </Tooltip>
  );

  let control: React.ReactNode;
  if (typeof value === "boolean") {
    control = (
      <Tooltip
        stages={[
          {
            delay: 1000,
            content: <span>{`Toggle ${propKey}`}</span>,
          },
          {
            delay: 3000,
            content: (
              <div className="max-w-[400px]">
                <div className="font-semibold">{propKey}</div>
                <div className="text-[10px] text-(--color-fg-muted) mt-1 whitespace-normal">
                  {desc}
                </div>
              </div>
            ),
          },
        ]}
      >
        <ToggleSwitch
          size="sm"
          checked={value}
          onChange={onToggleBoolean}
          aria-label={`Toggle ${propKey}`}
        />
      </Tooltip>
    );
  } else if (typeof value === "number") {
    control = (
      <Tooltip
        stages={[
          { delay: 1000, content: <span>{propKey}</span> },
          {
            delay: 3000,
            content: (
              <div className="max-w-[400px]">
                <div className="font-semibold">{propKey}</div>
                <div className="text-[10px] text-(--color-fg-muted) mt-1 whitespace-normal">
                  {desc}
                </div>
              </div>
            ),
          },
        ]}
      >
        <NumberInput
          value={value}
          onChange={(next) => onChangeValue(next)}
          aria-label={propKey}
        />
      </Tooltip>
    );
  } else {
    // strings + anything else are rendered as text. Long values
    // truncate via the `input-text` class's overflow handling; the
    // tooltip carries the full string for hover-inspection.
    const str = String(value);
    control = (
      <Tooltip
        stages={[
          { delay: 1000, content: <span>{propKey}</span> },
          {
            delay: 3000,
            content: (
              <div className="max-w-[260px]">
                <div className="font-semibold">{propKey}</div>
                <div className="text-[10px] text-(--color-fg-muted) mt-1 whitespace-normal break-all">
                  {desc}
                </div>
                <div className="text-[10px] mt-1 font-mono break-all">
                  {str}
                </div>
              </div>
            ),
          },
        ]}
      >
        <TextInput
          ref={inputRef}
          value={str}
          onChange={(e) => onChangeValue(e.target.value)}
          aria-label={propKey}
        />
      </Tooltip>
    );
  }

  // For numeric properties we still want `inputRef` to fire so the
  // `editProperty` command can focus the input. The NumberInput's
  // text node lives at a known offset; rather than fiddle with that,
  // we attach a ref to the wrapping container and reach the first
  // descendant input on focus.
  if (typeof value === "number") {
    const numberRefShim = (el: HTMLDivElement | null) => {
      const input = el?.querySelector("input");
      inputRef(input ?? null);
    };
    return (
      <div className={narrow ? "flex flex-col gap-1 py-px" : "py-px"}>
        {narrow ? (
          <>
            {labelNode}
            <div className="min-w-0" ref={numberRefShim}>
              {control}
            </div>
          </>
        ) : (
          <div className="grid grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)] items-center gap-2">
            {labelNode}
            <div className="min-w-0" ref={numberRefShim}>
              {control}
            </div>
          </div>
        )}
      </div>
    );
  }

  // Boolean + string rendering — boolean control is small so we keep
  // it right-aligned on the side-by-side layout.
  if (narrow) {
    return (
      <div className="flex flex-col gap-1 py-px">
        {labelNode}
        <div className="min-w-0 flex items-center">{control}</div>
      </div>
    );
  }
  return (
    <div className="grid grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)] items-center gap-2 py-px">
      {labelNode}
      <div className="min-w-0 flex items-center">{control}</div>
    </div>
  );
}

export const MANIFEST: Pick<DockPanelDef, "id" | "title" | "icon"> = {
  id: "cell-inspector",
  title: "Cell Inspector",
  icon: <SlidersHorizontal size={12} />,
};

export default CellInspectorPanel;

// P3 batch D-final migration. Moved from
// `apps/editor/src/views/scene/panels/CellInspectorPanel.tsx` into the
// core-editor-pack with no behavioural changes — only the import
// paths flipped to pack-local `cell-inspector.json` (the JSON spec
// rides along, same pattern as quick-tools / selection-info / brush /
// tool-palette) and the shell-SDK externals (`PanelRenderer`,
// `registerCommand`, Wave-3 stores, `cellKey`).
//
// Hybrid TSX+JSON shape:
//   - The JSON spec drives empty-state, header, Height, and Layer
//     rows via `<PanelRenderer/>`.
//   - The TSX tail still owns Type + Tags + Properties — those need
//     iteration / panel-local state primitives the renderer hasn't
//     grown yet.
//
// State source: Wave 3.3 — reads / writes via `useSceneStore`,
// `useSelectionStore`, `useLayerStore`. The JSON spec binds directly
// through the host renderer's resolver; the inline TSX continues to
// call the store actions imperatively for the un-migrated rows.
import React from "react";
import { SlidersHorizontal, Plus } from "lucide-react";
// Type-only — pack-builder erases at compile time.
import type { DockPanelDef } from "../../../apps/editor/src/components/dock/DockShell";
import type { PanelSpec } from "../../../apps/editor/src/panel-renderer/types";
// Presentational primitives — safe to bundle (no singleton state, no
// host-side React Context to coordinate with).
import { Tooltip } from "../../../apps/editor/src/components/ui/Tooltip";
import { Chip } from "../../../apps/editor/src/components/ui/Chip";
import { ToggleSwitch } from "../../../apps/editor/src/components/ui/controls";
import { TextInput } from "../../../apps/editor/src/components/ui/TextInput";
import { NumberInput } from "../../../apps/editor/src/components/ui/NumberInput";
// Externalised — `PanelRenderer` reads the renderer's dynamic-store
// registry which is host-side; Wave-3 stores carry BroadcastChannel
// sync; `cellKey` is the canonical coord-key helper. Bundling
// duplicates would silently disconnect the inspector from the painter.
import {
  PanelRenderer,
  cellKey,
  registerCommand,
  useLayerStore,
  useSceneStore,
  useSelectionStore,
} from "@cardboard/editor-shell";
// Bun bundles JSON imports inline — the spec ships as a literal in
// the compiled pack-script bundle.
import cellInspectorSpecJson from "./cell-inspector.json";

const CELL_INSPECTOR_SPEC = cellInspectorSpecJson as PanelSpec;

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

/** Descriptions for well-known property keys (kept from the original
 *  fixture set). New property keys created by `editProperty` fall back
 *  to a generic per-type blurb. */
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

/**
 * Hybrid CellInspector panel — JSON renderer for the header + Height +
 * Layer rows, inline TSX for Type + Tags + Properties (renderer gaps
 * documented at top of file). Both halves share the same scrolling
 * root via `<PanelRenderer>` first + the TSX-driven extension after.
 */
export function CellInspectorPanel(): React.JSX.Element {
  // Cross-panel store subscriptions for the un-migrated TSX rows. The
  // JSON spec subscribes through its own bindings — these hooks are
  // ONLY for the TSX-driven Type/Tags/Properties tail below.
  const selected = useSelectionStore((s) => s.selected);
  const activeLayer = useLayerStore((s) => s.activeId);
  const cellData = useSceneStore((s) =>
    selected ? s.cells[cellKey(selected.x, selected.y)] : undefined,
  );

  const [addingTag, setAddingTag] = React.useState(false);
  const [tagDraft, setTagDraft] = React.useState("");
  const addTagInputRef = React.useRef<HTMLInputElement>(null);

  // refs for property inputs, keyed by property key, so the
  // `scene.cell.editProperty.<k>` commands can focus them.
  const propertyRefs = React.useRef<Record<string, HTMLInputElement | null>>(
    {},
  );

  // Focus the add-tag input when entering "adding tag" mode.
  React.useEffect(() => {
    if (addingTag) addTagInputRef.current?.focus();
  }, [addingTag]);

  // ────────────────────────────────────────────────────────────────
  // Mutators — all writes go to the scene store (or the selection
  // store). Each mutator is a no-op when no cell is selected.

  const toggleTag = React.useCallback(
    (tag: string) => {
      if (!selected) return;
      useSceneStore.getState().toggleCellTag(selected.x, selected.y, tag);
    },
    [selected],
  );

  const commitNewTag = React.useCallback(
    (raw: string) => {
      const tag = raw.trim();
      if (!tag) {
        setAddingTag(false);
        setTagDraft("");
        return;
      }
      if (selected) {
        // Preserve the panel's no-dup guard — the store's toggle would
        // otherwise REMOVE the tag if it already exists.
        const existing = cellData?.tags ?? [];
        if (!existing.includes(tag)) {
          useSceneStore.getState().toggleCellTag(selected.x, selected.y, tag);
        }
      }
      setTagDraft("");
      setAddingTag(false);
    },
    [selected, cellData],
  );

  const toggleProperty = React.useCallback(
    (key: string) => {
      if (!selected) return;
      const cur = cellData?.properties[key];
      if (typeof cur !== "boolean") return;
      useSceneStore
        .getState()
        .setProperty(selected.x, selected.y, key, !cur);
    },
    [selected, cellData],
  );

  const setPropertyValue = React.useCallback(
    (key: string, value: unknown) => {
      if (!selected) return;
      useSceneStore
        .getState()
        .setProperty(selected.x, selected.y, key, value);
    },
    [selected],
  );

  const setType = React.useCallback(
    (next: string) => {
      if (!selected) return;
      const trimmed = next;
      if (trimmed === "") {
        useSceneStore
          .getState()
          .eraseCell(selected.x, selected.y, activeLayer);
      } else {
        useSceneStore
          .getState()
          .paintCell(selected.x, selected.y, activeLayer, trimmed);
      }
    },
    [selected, activeLayer],
  );

  const deselect = React.useCallback(() => {
    useSelectionStore.getState().select(null);
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
  // Static command registrations:
  //   - `scene.cell.deselect` — invoked by the JSON Deselect button.
  //   - `scene.cell.addTag` — invoked by the command palette /
  //     keybinding entry; the TSX "+" button calls setAddingTag
  //     directly because the JSON renderer can't toggle local state.

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
  const currentTags = cellData?.tags ?? [];
  React.useEffect(() => {
    if (!cellData || !selected) return;
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
  }, [currentTags.join("|"), cellData !== undefined, selected !== null]);

  // ────────────────────────────────────────────────────────────────
  // Dynamic registrations: one command per property key — toggle for
  // booleans, edit-focus for non-booleans.
  const propertyEntries = React.useMemo<
    Array<{ key: string; value: unknown }>
  >(() => {
    if (!cellData) return [];
    return Object.entries(cellData.properties).map(([key, value]) => ({
      key,
      value,
    }));
  }, [cellData]);

  const propertyKeysSig = propertyEntries
    .map((p) => `${p.key}:${typeof p.value}`)
    .join("|");

  React.useEffect(() => {
    if (!cellData || !selected) return;
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
  }, [propertyKeysSig, cellData !== undefined, selected !== null]);

  // ────────────────────────────────────────────────────────────────
  // Render — three states:
  //   1. No selection         → JSON spec renders "No cell selected".
  //   2. Selected but empty   → JSON header + height + layer rows; no
  //      tags / properties below (cellData is undefined).
  //   3. Selected + painted   → JSON spec + full TSX tail (Type / Tags
  //      / Properties).

  // Sorted property list — booleans first, then numbers, then strings.
  const sortedProperties = [...propertyEntries].sort((a, b) => {
    const rank = (v: unknown) =>
      typeof v === "boolean" ? 0 : typeof v === "number" ? 1 : 2;
    const r = rank(a.value) - rank(b.value);
    return r !== 0 ? r : a.key.localeCompare(b.key);
  });

  // Synthesised current "type" value (the cell's preset at the active
  // layer, or empty string). Read once per render because the JSON
  // spec already drives all other layer-dependent UI.
  const cellTypeValue = cellData?.layers[activeLayer] ?? "";

  return (
    <div
      data-panel="cell-inspector"
      className="h-full w-full flex flex-col gap-1 overflow-y-auto overflow-x-hidden text-(--color-fg-primary)"
    >
      <PanelRenderer spec={CELL_INSPECTOR_SPEC} />
      {/* TSX-driven tail — only renders when a cell is selected AND has
          painted content. The JSON spec above already handles the empty
          + selected-but-empty states. */}
      {selected && cellData ? (
        <>
          {/* Type — `cells[selected].layers[<activeId>]` is a double
              dynamic indexer the resolver doesn't support yet. */}
          <section className="flex flex-col gap-0.5 min-w-0 px-3">
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
              <span className="text-[10px] uppercase tracking-wider text-(--color-fg-muted) cursor-help">
                Type
              </span>
            </Tooltip>
            <TextInput
              value={cellTypeValue}
              onChange={(e) => setType(e.target.value)}
              aria-label="Cell type"
            />
          </section>

          {/* Tags — iteration node not yet in the renderer surface. */}
          <section className="flex flex-col gap-0.5 px-3">
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
              {cellData.tags.map((tag) => (
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

          {/* Properties — iteration over dynamic key set not in the
              renderer surface yet. */}
          <section className="flex flex-col gap-0.5 px-3">
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
                  onToggleBoolean={() => toggleProperty(key)}
                  onChangeValue={(v) => setPropertyValue(key, v)}
                  inputRef={(el) => {
                    propertyRefs.current[key] = el;
                  }}
                />
              ))}
            </div>
          </section>
        </>
      ) : null}
    </div>
  );
}

/* -------------------------------------------------------------------- */
/* Helper components                                                     */
/* -------------------------------------------------------------------- */

interface PropertyControlProps {
  propKey: string;
  value: unknown;
  onToggleBoolean: () => void;
  onChangeValue: (next: unknown) => void;
  inputRef: (el: HTMLInputElement | null) => void;
}

function PropertyControl({
  propKey,
  value,
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
      <div className="py-px">
        <div className="grid grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)] items-center gap-2">
          {labelNode}
          <div className="min-w-0" ref={numberRefShim}>
            {control}
          </div>
        </div>
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

export const MANIFEST: Pick<DockPanelDef, "id" | "title" | "icon" | "category"> = {
  id: "cell-inspector",
  title: "Cell Inspector",
  category: "Inspector",
  icon: <SlidersHorizontal size={12} />,
};

export default CellInspectorPanel;

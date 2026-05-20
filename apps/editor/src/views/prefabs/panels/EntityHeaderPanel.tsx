// TODO: wire to selection store + entity store. For now the panel
// imports MOCK_ENTITIES[0] as if it were the currently-edited
// entity and keeps its edits in local state (no persistence; reset
// on remount).
import React from "react";
import { FileText, Plus, Pencil } from "lucide-react";
import type { DockPanelDef } from "../../../components/dock/DockShell";
import { Tooltip } from "../../../components/ui/Tooltip";
import { Chip } from "../../../components/ui/Chip";
import { TextInput } from "../../../components/ui/TextInput";
import { Textarea } from "../../../components/ui/Textarea";
import { Button } from "../../../components/ui/Button";
import { registerCommand } from "../../../state/useCommandStore";
import { MOCK_ENTITIES, type EntityRow } from "../prefabs-fixtures";

/**
 * EntityHeaderPanel — top strip of the Prefabs center column.
 *
 * Visual target: top of the center column in `Editor Design/Entities.png`:
 *   - "EDIT ENTITY" eyebrow on the left, "Edit Entity" button on the right.
 *   - Large NAME TextInput.
 *   - DESCRIPTION Textarea (2-3 rows tall).
 *   - TAGS row — calm amber chips that toggle off on click, plus a
 *     dashed `+` button that reveals an inline tag-entry TextInput.
 *
 * Phase 2 sources its row from `MOCK_ENTITIES[0]` (the "light"
 * entity). Wave 3 will swap that for a selection-store read and wire
 * mutations back to the entity store.
 *
 * Responsive behaviour: the panel watches its own width with a
 * `ResizeObserver`. Below `NARROW_WIDTH_PX` (~180px) the top row
 * stacks (eyebrow above the "Edit Entity" button moves below the
 * name row). Below `TINY_WIDTH_PX` (~140px) the body collapses to
 * a "Resize panel" fallback — the form is unusable in that space.
 *
 * Commands registered:
 *   - `prefabs.entity.edit`              — stub action (console.log).
 *   - `prefabs.entity.editName`          — focuses the name input.
 *   - `prefabs.entity.editDescription`   — focuses the description.
 *   - `prefabs.entity.tag.add`           — opens the add-tag input.
 *   - `prefabs.entity.tag.toggle.<tag>`  — removes that tag.
 */

/** Width below which the "Edit Entity" button drops to its own row
 *  beneath the eyebrow header. Above this, the eyebrow + button share
 *  a row. */
const NARROW_WIDTH_PX = 180;

/** Below this width the full form is unusable so we render a minimal
 *  "Resize panel" fallback instead. */
const TINY_WIDTH_PX = 140;

/** Human-readable descriptions used by progressive tooltips on the
 *  tag chips. Unknown tags fall back to a generic blurb. */
const TAG_DESCRIPTIONS: Record<string, string> = {
  light: "Light-emitting entity. Contributes to scene illumination.",
  atmosphere: "Atmospheric / mood-setting entity. Mostly decorative.",
  dynamic: "Entity may move, animate, or change state at runtime.",
  player: "Entity is, or behaves as, the player.",
  actor: "Generic moving entity — actors run AI or input behaviour.",
  controllable: "Entity accepts player or scripted input.",
  item: "Pickup / collectable entity.",
  pickup: "Entity is collected on touch.",
  health: "Restores health when interacted with.",
  enemy: "Hostile AI actor.",
  ai: "Driven by AI behaviour scripts.",
  patrol: "Moves along a fixed patrol path.",
  weapon: "Weapon item — added to the player's inventory on pickup.",
  trigger: "Fires a scripted event when the player enters its volume.",
  door: "Door-like trigger volume — opens a tagged door on enter.",
  interactive: "Responds to player interaction (use / touch).",
  exit: "Marks the level-exit volume.",
  "level-end": "Ends the level when entered.",
  decor: "Visual-only entity; does not affect gameplay.",
};

function tagDescription(tag: string): string {
  return TAG_DESCRIPTIONS[tag] ?? "Tag attached to this entity.";
}

export function EntityHeaderPanel(): React.JSX.Element {
  // Local panel state — owns the mutable copy of the active entity.
  // Wave 3 swaps the initial value for a selection-store read.
  const initial = MOCK_ENTITIES[0];
  const [entity, setEntity] = React.useState<EntityRow>(() => ({
    ...initial,
    tags: [...initial.tags],
    components: [...initial.components],
  }));

  const [addingTag, setAddingTag] = React.useState(false);
  const [tagDraft, setTagDraft] = React.useState("");

  const nameInputRef = React.useRef<HTMLInputElement>(null);
  const descriptionRef = React.useRef<HTMLTextAreaElement>(null);
  const addTagInputRef = React.useRef<HTMLInputElement>(null);

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
  const tiny = width > 0 && width < TINY_WIDTH_PX;

  // Focus the add-tag input when entering "adding tag" mode.
  React.useEffect(() => {
    if (addingTag) addTagInputRef.current?.focus();
  }, [addingTag]);

  // ────────────────────────────────────────────────────────────────
  // Mutators (used by both the UI and the registered commands).

  const removeTag = React.useCallback((tag: string) => {
    setEntity((prev) => ({
      ...prev,
      tags: prev.tags.filter((t) => t !== tag),
    }));
  }, []);

  const commitNewTag = React.useCallback((raw: string) => {
    const tag = raw.trim();
    if (!tag) {
      setAddingTag(false);
      setTagDraft("");
      return;
    }
    setEntity((prev) => {
      if (prev.tags.includes(tag)) return prev;
      return { ...prev, tags: [...prev.tags, tag] };
    });
    setTagDraft("");
    setAddingTag(false);
  }, []);

  const editEntity = React.useCallback(() => {
    // eslint-disable-next-line no-console
    console.log(`[prefabs] edit entity: ${entity.id}`);
  }, [entity.id]);

  // Stable refs so the command-registration effects don't have to
  // re-run on every keystroke / state change.
  const removeTagRef = React.useRef(removeTag);
  React.useEffect(() => {
    removeTagRef.current = removeTag;
  }, [removeTag]);

  const editEntityRef = React.useRef(editEntity);
  React.useEffect(() => {
    editEntityRef.current = editEntity;
  }, [editEntity]);

  // ────────────────────────────────────────────────────────────────
  // Static command registrations.

  React.useEffect(() => {
    const unregs = [
      registerCommand({
        id: "prefabs.entity.edit",
        title: "Edit Entity",
        category: "Entity",
        keywords: ["edit", "entity", "open"],
        run: () => editEntityRef.current(),
      }),
      registerCommand({
        id: "prefabs.entity.editName",
        title: "Edit Entity Name",
        category: "Entity",
        keywords: ["edit", "name", "rename"],
        run: () => nameInputRef.current?.focus(),
      }),
      registerCommand({
        id: "prefabs.entity.editDescription",
        title: "Edit Entity Description",
        category: "Entity",
        keywords: ["edit", "description", "notes"],
        run: () => descriptionRef.current?.focus(),
      }),
      registerCommand({
        id: "prefabs.entity.tag.add",
        title: "Add Entity Tag",
        category: "Entity",
        keywords: ["tag", "add", "new"],
        run: () => {
          setAddingTag(true);
          // The focus effect (keyed on `addingTag`) takes it from here.
        },
      }),
    ];
    return () => unregs.forEach((u) => u());
  }, []);

  // ────────────────────────────────────────────────────────────────
  // Dynamic registrations: one remove command per current tag.
  const currentTags = entity.tags;
  React.useEffect(() => {
    const unregs = currentTags.map((tag) =>
      registerCommand({
        id: `prefabs.entity.tag.toggle.${tag}`,
        title: `Remove Tag: ${tag}`,
        category: "Entity",
        keywords: ["tag", "remove", tag],
        run: () => removeTagRef.current(tag),
      }),
    );
    return () => unregs.forEach((u) => u());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentTags.join("|")]);

  // ────────────────────────────────────────────────────────────────
  // Render — tiny fallback first.

  if (tiny) {
    return (
      <div
        ref={rootRef}
        data-panel="entity-header"
        className="h-full w-full flex items-center justify-center text-[10px] text-(--color-fg-muted) text-center px-2"
      >
        Resize panel to edit entity
      </div>
    );
  }

  // Eyebrow + Edit-Entity button — they share a row at normal width
  // and stack at narrow widths. The same `editEntityButton` node is
  // reused in both branches so the Tooltip / command wiring stays in
  // one place.
  const editEntityButton = (
    <Tooltip
      stages={[
        { delay: 1000, content: <span>Edit Entity</span> },
        {
          delay: 3000,
          content: (
            <div className="max-w-[400px]">
              <div className="font-semibold">Edit Entity</div>
              <div className="text-[10px] text-(--color-fg-muted) mt-1">
                Open this entity for full-screen editing. (Stub — wires
                to the entity editor in Wave 3.)
              </div>
            </div>
          ),
        },
      ]}
    >
      <Button
        variant="primary"
        size="sm"
        leadingIcon={<Pencil size={11} aria-hidden="true" />}
        onClick={editEntity}
        aria-label="Edit entity"
      >
        Edit Entity
      </Button>
    </Tooltip>
  );

  const eyebrow = (
    <Tooltip
      stages={[
        { delay: 1000, content: <span>Edit Entity</span> },
        {
          delay: 3000,
          content: (
            <div className="max-w-[400px]">
              <div className="font-semibold">Edit Entity</div>
              <div className="text-[10px] text-(--color-fg-muted) mt-1">
                Section header — the form below edits the currently
                selected entity's name, description, and tags.
              </div>
            </div>
          ),
        },
      ]}
    >
      <span className="text-[10px] uppercase tracking-wider text-(--color-fg-muted) cursor-help">
        Edit Entity
      </span>
    </Tooltip>
  );

  return (
    <div
      ref={rootRef}
      data-panel="entity-header"
      className="h-full w-full flex flex-col gap-2 overflow-y-auto overflow-x-hidden p-2 text-(--color-fg-primary)"
    >
      {/* Row 1 — eyebrow + Edit Entity button.
          At normal width they share a row (eyebrow left, button right);
          at narrow widths the button drops to its own row beneath the
          eyebrow so the button label stays readable. */}
      {narrow ? (
        <header className="flex flex-col gap-1">
          <div>{eyebrow}</div>
          <div className="flex">{editEntityButton}</div>
        </header>
      ) : (
        <header className="flex items-center justify-between gap-2">
          {eyebrow}
          {editEntityButton}
        </header>
      )}

      {/* Row 2 — NAME. Large TextInput so the entity name reads as
          the primary identifier in the form. */}
      <section className="flex flex-col gap-1 min-w-0">
        <Tooltip
          stages={[
            { delay: 1000, content: <span>Name</span> },
            {
              delay: 3000,
              content: (
                <div className="max-w-[400px]">
                  <div className="font-semibold">Name</div>
                  <div className="text-[10px] text-(--color-fg-muted) mt-1">
                    Display name of this entity. Engine code references
                    it via `id`, not `name`, so renaming is purely
                    cosmetic.
                  </div>
                </div>
              ),
            },
          ]}
        >
          <div className="text-[10px] uppercase tracking-wider text-(--color-fg-muted) cursor-help">
            Name
          </div>
        </Tooltip>
        <Tooltip
          stages={[
            { delay: 1000, content: <span>Entity name</span> },
            {
              delay: 3000,
              content: (
                <div className="max-w-[400px]">
                  <div className="font-semibold">Entity name</div>
                  <div className="text-[10px] text-(--color-fg-muted) mt-1">
                    Display name of this entity. Engine references the
                    `id`, not the name — renaming is cosmetic.
                  </div>
                </div>
              ),
            },
          ]}
        >
          <TextInput
            ref={nameInputRef}
            value={entity.name}
            onChange={(e) =>
              setEntity((prev) => ({ ...prev, name: e.target.value }))
            }
            aria-label="Entity name"
            className="text-base"
          />
        </Tooltip>
      </section>

      {/* Row 3 — DESCRIPTION. Multi-line, auto-wraps, no horizontal
          scroll. Doubles as the entity's tooltip body in the entity
          list and the JSON preview's `description` field. */}
      <section className="flex flex-col gap-1 min-w-0">
        <Tooltip
          stages={[
            { delay: 1000, content: <span>Description</span> },
            {
              delay: 3000,
              content: (
                <div className="max-w-[400px]">
                  <div className="font-semibold">Description</div>
                  <div className="text-[10px] text-(--color-fg-muted) mt-1">
                    Free-form description shown in entity tooltips and
                    the serialized entity manifest.
                  </div>
                </div>
              ),
            },
          ]}
        >
          <div className="text-[10px] uppercase tracking-wider text-(--color-fg-muted) cursor-help">
            Description
          </div>
        </Tooltip>
        <Tooltip
          stages={[
            { delay: 1000, content: <span>Entity description</span> },
            {
              delay: 3000,
              content: (
                <div className="max-w-[400px]">
                  <div className="font-semibold">Entity description</div>
                  <div className="text-[10px] text-(--color-fg-muted) mt-1">
                    Free-form description rendered in tooltips + the
                    serialized entity manifest.
                  </div>
                </div>
              ),
            },
          ]}
        >
          <Textarea
            ref={descriptionRef}
            value={entity.description}
            onChange={(e) =>
              setEntity((prev) => ({ ...prev, description: e.target.value }))
            }
            rows={3}
            aria-label="Entity description"
          />
        </Tooltip>
      </section>

      {/* Row 4 — TAGS. Flex-wrap calm-amber chips. Click a chip to
          remove the tag; click the dashed `+` button to reveal an
          inline TextInput for adding a new one. */}
      <section className="flex flex-col gap-1 min-w-0">
        <Tooltip
          stages={[
            { delay: 1000, content: <span>Tags</span> },
            {
              delay: 3000,
              content: (
                <div className="max-w-[400px]">
                  <div className="font-semibold">Tags</div>
                  <div className="text-[10px] text-(--color-fg-muted) mt-1">
                    Free-form tags attached to this entity. Used by the
                    entity list filter chips and by pack queries.
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
          {entity.tags.map((tag) => (
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
                      <div className="text-[10px] text-(--color-fg-muted) mt-1">
                        Click to remove.
                      </div>
                    </div>
                  ),
                },
              ]}
            >
              <Chip variant="accent" pill onClick={() => removeTag(tag)}>
                {tag}
              </Chip>
            </Tooltip>
          ))}
          {addingTag ? (
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
                { delay: 1000, content: <span>Add Element</span> },
                {
                  delay: 3000,
                  content: (
                    <div className="max-w-[400px]">
                      <div className="font-semibold">Add tag</div>
                      <div className="text-[10px] text-(--color-fg-muted) mt-1">
                        Append a new tag to this entity. Press Enter to
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
                  "h-5 px-2 rounded-full border",
                  "border-dashed border-(--color-border-strong) text-(--color-fg-muted)",
                  "hover:border-amber-500/60 hover:text-(--color-fg-primary)",
                  "transition-colors text-[10px]",
                ].join(" ")}
              >
                <Plus size={10} aria-hidden="true" />
                <span>Add Element</span>
              </button>
            </Tooltip>
          )}
        </div>
      </section>
    </div>
  );
}

export const MANIFEST: Pick<DockPanelDef, "id" | "title" | "icon" | "category"> = {
  id: "entity-header",
  title: "Entity Header",
  category: "Inspector",
  icon: <FileText size={12} />,
};

export default EntityHeaderPanel;

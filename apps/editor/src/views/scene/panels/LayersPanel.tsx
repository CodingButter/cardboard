import React from "react";
import {
  ChevronDown,
  ChevronUp,
  Eye,
  EyeOff,
  Layers,
  Plus,
  Trash2,
} from "lucide-react";
import type { DockPanelDef } from "../../../components/dock/DockShell";
import { Tooltip } from "../../../components/ui/Tooltip";
import { registerCommand } from "../../../state/useCommandStore";
import {
  useLayerStore,
  type CustomLayer,
} from "../../../state/useLayerStore";
import { MOCK_LAYERS, type LayerRow } from "../scene-fixtures";

/**
 * LayersPanel — scene-layer visibility + active-target + reorder
 * surface.
 *
 * Visual target: the LAYERS section in `Editor Design/Map.png` — a
 * vertical list of rows, each with an eye visibility toggle, a color
 * legend chip, the layer name, and a pair of reorder buttons. The
 * active painting layer (the one new paint strokes target) is shown
 * with an accent border + faint background tint.
 *
 * State source: Wave 3.3 — reads / writes via `useLayerStore`. The
 * synced store handles persistence (`cardboard.sync.layer`) and
 * cross-window propagation, so this panel owns no localStorage logic
 * of its own. The built-in layer catalog (`MOCK_LAYERS`) still lives
 * in `scene-fixtures.ts` since the built-in roster is panel
 * presentation data; user-added layers live in `customLayers` on the
 * store and are merged in at render time.
 *
 * Command-registry contract: every clickable affordance ALSO exists
 * as a runtime-registered command so the command palette + global
 * keybinding handler can drive the same actions. Per-layer commands
 * (toggle, activate, move up/down, delete) are registered dynamically
 * in a `useEffect` keyed on the resolved layer list so the up/down
 * command *titles* reflect each layer's current position. Each
 * command body calls `useLayerStore.getState()` directly — no
 * closure-ref dance.
 */

// ---------------------------------------------------------------------------
// Local LayerRow extension — fixtures hand us the bare shape; the
// panel wants a `description` for the multi-stage tooltip's stage-2
// body. Build a name→description map and merge on read so we don't
// fork the fixture interface.

const LAYER_DESCRIPTIONS: Record<string, string> = {
  floors: "Floor tiles — the base walkable surface.",
  walls: "Wall tiles — block movement and sight, define rooms.",
  doors: "Door entities — interactive openings that gate movement.",
  sprites: "Sprite entities — items, decor, NPCs placed in the world.",
  lights: "Light sources — emissive points that bake into the scene.",
};

interface LayerView extends LayerRow {
  description: string;
  /**
   * `true` if the layer is user-added (lives in `customLayers`) and
   * therefore deletable. Built-in fixture layers are not deletable.
   */
  isCustom: boolean;
}

// ---------------------------------------------------------------------------
// Container-query breakpoint. Below ~160px the row's reorder column is
// dropped (the commands are still reachable via the palette). We use a
// ResizeObserver on the panel root because container queries aren't
// available in this codebase's Tailwind setup yet, and a one-cell
// breakpoint is cheaper than wiring `@container`.
const COMPACT_WIDTH_PX = 160;

/**
 * Mint a fresh, collision-free id for a user-added layer. The pattern
 * is `custom-N` where N is the smallest positive integer not already
 * present in `order`. Idempotent enough for rapid clicks since the
 * store's `add` action is itself idempotent on id collisions.
 */
function mintCustomLayerId(existingIds: readonly string[]): string {
  const taken = new Set(existingIds);
  for (let i = 1; i < 10_000; i++) {
    const id = `custom-${i}`;
    if (!taken.has(id)) return id;
  }
  return `custom-${Date.now()}`;
}

/** Default color palette for newly-minted custom layers — cycles
 *  through a handful of pleasant tailwind hues so consecutive
 *  Add Layer clicks don't all look identical. */
const CUSTOM_LAYER_PALETTE = [
  "#f97316", // orange-500
  "#22d3ee", // cyan-400
  "#a3e635", // lime-400
  "#f472b6", // pink-400
  "#facc15", // yellow-400
  "#60a5fa", // blue-400
] as const;

export function LayersPanel(): React.JSX.Element {
  // ---- Store subscriptions ----------------------------------------------

  const activeId = useLayerStore((s) => s.activeId);
  const visibility = useLayerStore((s) => s.visibility);
  const order = useLayerStore((s) => s.order);
  const customLayers = useLayerStore((s) => s.customLayers);

  // ---- Compact mode -----------------------------------------------------

  const rootRef = React.useRef<HTMLDivElement | null>(null);
  const [compact, setCompact] = React.useState(false);

  React.useEffect(() => {
    const node = rootRef.current;
    if (!node || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width ?? 0;
      setCompact(w > 0 && w < COMPACT_WIDTH_PX);
    });
    ro.observe(node);
    return () => ro.disconnect();
  }, []);

  // ---- Canonical handlers (single source of truth) ----------------------
  // Both button onClicks and command `run` delegate through these by
  // calling `useLayerStore.getState()` directly — mirrors the
  // ToolPalette / Brush / TilePreset pattern.

  const handleActivate = React.useCallback((layerId: string) => {
    useLayerStore.getState().activate(layerId);
  }, []);

  const handleToggleVisibility = React.useCallback((layerId: string) => {
    useLayerStore.getState().toggleVisibility(layerId);
  }, []);

  const handleMoveUp = React.useCallback((layerId: string) => {
    useLayerStore.getState().moveUp(layerId);
  }, []);

  const handleMoveDown = React.useCallback((layerId: string) => {
    useLayerStore.getState().moveDown(layerId);
  }, []);

  const handleDelete = React.useCallback((layerId: string) => {
    useLayerStore.getState().delete(layerId);
  }, []);

  const handleAdd = React.useCallback(() => {
    const state = useLayerStore.getState();
    const id = mintCustomLayerId(state.order);
    // Derive a friendly default name like "Layer 1" from the custom
    // count; the user can rename later when a rename UI lands.
    const n = state.customLayers.length + 1;
    const color =
      CUSTOM_LAYER_PALETTE[
        state.customLayers.length % CUSTOM_LAYER_PALETTE.length
      ] ?? "#f59e0b";
    const layer: CustomLayer = { id, name: `Layer ${n}`, color };
    state.add(layer);
  }, []);

  // ---- Resolved layer list (ordered, built-ins + custom) ----------------

  const layers: LayerView[] = React.useMemo(() => {
    // Widen the fixture rows to LayerRow so the Map's value type isn't
    // narrowed by the `as const` literal union on MOCK_LAYERS.
    const builtin: LayerRow[] = MOCK_LAYERS.map((l) => ({ ...l }));
    const customSet = new Set(customLayers.map((c) => c.id));
    const byId = new Map<string, LayerRow>(builtin.map((l) => [l.id, l]));
    for (const c of customLayers) {
      byId.set(c.id, {
        id: c.id,
        name: c.name,
        color: c.color,
        // Custom layers default to visible until toggled — the
        // visibility map ultimately drives the eye icon, this only
        // matters if `byId` is consulted before the visibility map.
        visible: true,
      });
    }
    const out: LayerView[] = [];
    for (const id of order) {
      const row = byId.get(id);
      if (!row) continue;
      out.push({
        ...row,
        description: LAYER_DESCRIPTIONS[row.id] ?? `${row.name} layer.`,
        isCustom: customSet.has(row.id),
      });
    }
    return out;
  }, [order, customLayers]);

  // ---- Static command (Add Layer) — registered once on mount -----------

  React.useEffect(() => {
    return registerCommand({
      id: "scene.layer.add",
      title: "Add Layer",
      category: "Layer",
      keywords: ["layer", "add", "new", "create"],
      icon: <Plus size={14} />,
      run: () => {
        const state = useLayerStore.getState();
        const id = mintCustomLayerId(state.order);
        const n = state.customLayers.length + 1;
        const color =
          CUSTOM_LAYER_PALETTE[
            state.customLayers.length % CUSTOM_LAYER_PALETTE.length
          ] ?? "#f59e0b";
        state.add({ id, name: `Layer ${n}`, color });
      },
    });
  }, []);

  // ---- Dynamic per-layer commands ---------------------------------------
  //
  // Each layer contributes up to five commands: toggle visibility,
  // activate (select), move up (when not at top), move down (when not
  // at bottom), and delete (custom layers only). Re-registers when
  // `layers` (or `order`) changes so palette titles reflect the
  // current position + roster.

  React.useEffect(() => {
    const unregs: Array<() => void> = [];
    for (const l of layers) {
      const idx = order.indexOf(l.id);
      const canMoveUp = idx > 0;
      const canMoveDown = idx >= 0 && idx < order.length - 1;

      unregs.push(
        registerCommand({
          id: `scene.layer.toggleVisible.${l.id}`,
          title: `Toggle Visibility: ${l.name}`,
          category: "Layer",
          keywords: ["layer", "visibility", "toggle", l.name.toLowerCase()],
          run: () => useLayerStore.getState().toggleVisibility(l.id),
        }),
        registerCommand({
          id: `scene.layer.select.${l.id}`,
          title: `Activate Layer: ${l.name}`,
          category: "Layer",
          keywords: ["layer", "activate", "select", l.name.toLowerCase()],
          run: () => useLayerStore.getState().activate(l.id),
        }),
      );

      // Only register reorder commands when the move is actually
      // possible. The palette already filters disabled actions by
      // omission, which keeps the surface tidy on the top/bottom rows.
      if (canMoveUp) {
        unregs.push(
          registerCommand({
            id: `scene.layer.moveUp.${l.id}`,
            title: `Move Layer Up: ${l.name}`,
            category: "Layer",
            keywords: ["layer", "move", "up", "reorder", l.name.toLowerCase()],
            run: () => useLayerStore.getState().moveUp(l.id),
          }),
        );
      }
      if (canMoveDown) {
        unregs.push(
          registerCommand({
            id: `scene.layer.moveDown.${l.id}`,
            title: `Move Layer Down: ${l.name}`,
            category: "Layer",
            keywords: [
              "layer",
              "move",
              "down",
              "reorder",
              l.name.toLowerCase(),
            ],
            run: () => useLayerStore.getState().moveDown(l.id),
          }),
        );
      }

      // Delete is only meaningful for custom layers (the store's
      // delete is a no-op on built-ins, but registering a delete
      // command for an undeletable row is misleading in the palette).
      if (l.isCustom) {
        unregs.push(
          registerCommand({
            id: `scene.layer.delete.${l.id}`,
            title: `Delete Layer: ${l.name}`,
            category: "Layer",
            keywords: ["layer", "delete", "remove", l.name.toLowerCase()],
            run: () => useLayerStore.getState().delete(l.id),
          }),
        );
      }
    }
    return () => {
      for (const u of unregs) u();
    };
  }, [layers, order]);

  // ---- Render ------------------------------------------------------------

  return (
    <div
      ref={rootRef}
      data-panel="layers"
      className="h-full w-full flex flex-col gap-1 overflow-y-auto overflow-x-hidden"
    >
      {layers.map((l, idx) => {
        const isVisible = visibility[l.id] ?? true;
        const isActive = l.id === activeId;
        const canMoveUp = idx > 0;
        const canMoveDown = idx < layers.length - 1;

        return (
          <LayerRowView
            key={l.id}
            layer={l}
            isVisible={isVisible}
            isActive={isActive}
            canMoveUp={canMoveUp}
            canMoveDown={canMoveDown}
            compact={compact}
            onToggleVisibility={handleToggleVisibility}
            onActivate={handleActivate}
            onMoveUp={handleMoveUp}
            onMoveDown={handleMoveDown}
            onDelete={handleDelete}
          />
        );
      })}

      {/* Add Layer — Map.png shows a full-width ghost button below the
          list. The command (`scene.layer.add`) is registered above so
          the palette and any future keybindings can drive the same
          action. Mints a fresh `custom-N` id and delegates to the
          store's `add` action. */}
      <Tooltip
        side="top"
        stages={[
          { delay: 1000, content: <span>Add Layer</span> },
          {
            delay: 3000,
            content: (
              <div>
                <div className="font-semibold">Add Layer</div>
                <div className="text-[10px] text-(--color-fg-muted) mt-1 max-w-[400px] whitespace-normal">
                  Adds a new custom layer to the scene. The new layer
                  appears at the bottom of the stack and is visible by
                  default.
                </div>
              </div>
            ),
          },
        ]}
      >
        <button
          type="button"
          aria-label="Add Layer"
          onClick={handleAdd}
          className={[
            "flex items-center justify-center gap-1 w-full min-h-[22px] h-[22px]",
            "px-1.5 mt-0.5 rounded",
            "border border-dashed border-(--color-border-strong)",
            "text-[10px] text-(--color-fg-muted)",
            "hover:text-(--color-fg-primary) hover:border-amber-500/60 hover:bg-amber-500/5",
            "transition-colors",
          ].join(" ")}
        >
          <Plus size={11} aria-hidden="true" />
          <span>Add Layer</span>
        </button>
      </Tooltip>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Layer row — extracted so the body of the panel stays declarative.
// Each row is its own flex line so it composes cleanly when stacked.

interface LayerRowViewProps {
  layer: LayerView;
  isVisible: boolean;
  isActive: boolean;
  canMoveUp: boolean;
  canMoveDown: boolean;
  compact: boolean;
  onToggleVisibility: (id: string) => void;
  onActivate: (id: string) => void;
  onMoveUp: (id: string) => void;
  onMoveDown: (id: string) => void;
  onDelete: (id: string) => void;
}

function LayerRowView({
  layer,
  isVisible,
  isActive,
  canMoveUp,
  canMoveDown,
  compact,
  onToggleVisibility,
  onActivate,
  onMoveUp,
  onMoveDown,
  onDelete,
}: LayerRowViewProps): React.JSX.Element {
  const EyeIcon = isVisible ? Eye : EyeOff;

  return (
    <div
      className={[
        "flex items-center gap-1.5 min-h-[24px] h-6 px-1.5 rounded min-w-0",
        "border transition-colors",
        isActive
          ? "bg-amber-500/10 border-amber-500"
          : "bg-transparent border-(--color-border-strong) hover:border-amber-500/40",
      ].join(" ")}
    >
      {/* Eye toggle — always present. */}
      <Tooltip
        side="top"
        stages={[
          {
            delay: 1000,
            content: (
              <span>{isVisible ? "Hide" : "Show"} {layer.name}</span>
            ),
          },
          {
            delay: 3000,
            content: (
              <div>
                <div className="font-semibold">
                  {isVisible ? "Hide" : "Show"} {layer.name}
                </div>
                <div className="text-[10px] text-(--color-fg-muted) mt-1 max-w-[400px] whitespace-normal">
                  Toggles whether the {layer.name} layer is rendered.
                </div>
              </div>
            ),
          },
        ]}
      >
        <button
          type="button"
          aria-label={`Toggle visibility: ${layer.name}`}
          aria-pressed={isVisible}
          onClick={() => onToggleVisibility(layer.id)}
          className={[
            "flex items-center justify-center w-4 h-4 rounded",
            "transition-colors",
            isVisible
              ? "text-(--color-fg-secondary) hover:text-(--color-fg-primary)"
              : "text-(--color-fg-muted) hover:text-(--color-fg-secondary)",
          ].join(" ")}
        >
          <EyeIcon size={11} aria-hidden="true" />
        </button>
      </Tooltip>

      {/* Color chip — also doubles as a hint that the row is the
          active layer (with a subtle ring). Clicking it activates
          the layer too, since users tend to grab the swatch. */}
      <Tooltip
        side="top"
        stages={[
          { delay: 1000, content: <span>Activate {layer.name}</span> },
          {
            delay: 3000,
            content: (
              <div>
                <div className="font-semibold">Activate {layer.name}</div>
                <div className="text-[10px] text-(--color-fg-muted) mt-1 max-w-[400px] whitespace-normal">
                  {layer.description}
                </div>
              </div>
            ),
          },
        ]}
      >
        <button
          type="button"
          aria-label={`Activate layer: ${layer.name}`}
          aria-pressed={isActive}
          onClick={() => onActivate(layer.id)}
          className={[
            "w-2.5 h-2.5 rounded-sm border shrink-0",
            "transition-shadow",
            isActive
              ? "border-amber-500"
              : "border-(--color-border-strong) hover:border-amber-500/60",
          ].join(" ")}
          style={{ backgroundColor: layer.color }}
        />
      </Tooltip>

      {/* Name — click also activates. Truncates with ellipsis on
          narrow panels; the full name is in the hover tooltip.
          The outer flex-1 wrapper ensures the column actually grows to
          fill the row at wide widths — the Tooltip's wrapper span is
          `inline-flex` so without a sized parent the button collapses
          to intrinsic content width and leaves dead space to the right.
          The `[&>span]:flex-1` reaches through to the Tooltip's wrapper
          span itself so it inherits the column's full width. */}
      <div className="flex-1 min-w-0 flex [&>span]:flex-1 [&>span]:min-w-0">
        <Tooltip
          side="top"
          stages={[
            { delay: 1000, content: <span>{layer.name}</span> },
            {
              delay: 3000,
              content: (
                <div>
                  <div className="font-semibold">{layer.name}</div>
                  <div className="text-[10px] text-(--color-fg-muted) mt-1 max-w-[400px] whitespace-normal">
                    {layer.description}
                  </div>
                </div>
              ),
            },
          ]}
        >
          <button
            type="button"
            aria-label={`Activate layer: ${layer.name}`}
            aria-pressed={isActive}
            onClick={() => onActivate(layer.id)}
            className={[
              "w-full min-w-0 text-left text-[10px] leading-none truncate",
              "transition-colors",
              isActive
                ? "text-(--color-fg-primary) font-medium"
                : "text-(--color-fg-secondary) hover:text-(--color-fg-primary)",
            ].join(" ")}
          >
            {layer.name}
          </button>
        </Tooltip>
      </div>

      {/* Reorder buttons — hidden in compact mode (still command-palette
          reachable). Vertical stack of two micro-icons. */}
      {!compact ? (
        <div className="flex flex-col shrink-0">
          <Tooltip
            side="top"
            stages={[
              { delay: 1000, content: <span>Move Up</span> },
              {
                delay: 3000,
                content: (
                  <div>
                    <div className="font-semibold">Move {layer.name} Up</div>
                    <div className="text-[10px] text-(--color-fg-muted) mt-1 max-w-[400px] whitespace-normal">
                      Reorders this layer one slot higher in the stack.
                    </div>
                  </div>
                ),
              },
            ]}
          >
            <button
              type="button"
              aria-label={`Move layer up: ${layer.name}`}
              disabled={!canMoveUp}
              onClick={() => onMoveUp(layer.id)}
              className={[
                "flex items-center justify-center w-5 h-3.5 rounded-sm",
                "transition-colors",
                canMoveUp
                  ? "text-(--color-fg-secondary) hover:text-(--color-fg-primary) hover:bg-(--color-bg-hover)"
                  : "text-(--color-fg-muted) opacity-40 cursor-not-allowed",
              ].join(" ")}
            >
              <ChevronUp size={11} aria-hidden="true" />
            </button>
          </Tooltip>
          <Tooltip
            side="top"
            stages={[
              { delay: 1000, content: <span>Move Down</span> },
              {
                delay: 3000,
                content: (
                  <div>
                    <div className="font-semibold">
                      Move {layer.name} Down
                    </div>
                    <div className="text-[10px] text-(--color-fg-muted) mt-1 max-w-[400px] whitespace-normal">
                      Reorders this layer one slot lower in the stack.
                    </div>
                  </div>
                ),
              },
            ]}
          >
            <button
              type="button"
              aria-label={`Move layer down: ${layer.name}`}
              disabled={!canMoveDown}
              onClick={() => onMoveDown(layer.id)}
              className={[
                "flex items-center justify-center w-5 h-3.5 rounded-sm",
                "transition-colors",
                canMoveDown
                  ? "text-(--color-fg-secondary) hover:text-(--color-fg-primary) hover:bg-(--color-bg-hover)"
                  : "text-(--color-fg-muted) opacity-40 cursor-not-allowed",
              ].join(" ")}
            >
              <ChevronDown size={11} aria-hidden="true" />
            </button>
          </Tooltip>
        </div>
      ) : null}

      {/* Delete — only rendered for user-added custom layers. Built-in
          fixture layers are not deletable, so we omit the affordance
          entirely rather than disable it. Hidden in compact mode (still
          command-palette reachable via `scene.layer.delete.<id>`). */}
      {layer.isCustom && !compact ? (
        <Tooltip
          side="top"
          stages={[
            { delay: 1000, content: <span>Delete</span> },
            {
              delay: 3000,
              content: (
                <div>
                  <div className="font-semibold">Delete {layer.name}</div>
                  <div className="text-[10px] text-(--color-fg-muted) mt-1 max-w-[400px] whitespace-normal">
                    Removes this custom layer from the scene. Built-in
                    layers cannot be deleted.
                  </div>
                </div>
              ),
            },
          ]}
        >
          <button
            type="button"
            aria-label={`Delete layer: ${layer.name}`}
            onClick={() => onDelete(layer.id)}
            className={[
              "flex items-center justify-center w-4 h-4 rounded-sm shrink-0",
              "text-(--color-fg-muted) hover:text-rose-400 hover:bg-rose-500/10",
              "transition-colors",
            ].join(" ")}
          >
            <Trash2 size={11} aria-hidden="true" />
          </button>
        </Tooltip>
      ) : null}
    </div>
  );
}

export const MANIFEST: Pick<DockPanelDef, "id" | "title" | "icon"> = {
  id: "layers",
  title: "Layers",
  icon: <Layers size={12} />,
};

export default LayersPanel;

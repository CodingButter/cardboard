import React from "react";
import {
  ChevronDown,
  ChevronUp,
  Eye,
  EyeOff,
  Layers,
  Plus,
} from "lucide-react";
import type { DockPanelDef } from "../../../components/dock/DockShell";
import { Tooltip } from "../../../components/ui/Tooltip";
import { registerCommand } from "../../../state/useCommandStore";
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
 * Persistence contract (Wave 2 placeholder; replaced by the real
 * scene-layer store in a later wave):
 *   - `cardboard.scene.layers.activeId`    string layer id
 *   - `cardboard.scene.layers.visibility`  JSON Record<id, boolean>
 *   - `cardboard.scene.layers.order`       JSON string[] of layer ids
 *
 * Every interactive control is also registered as a command via
 * `registerCommand` so the command palette and any future
 * keybindings can drive the same actions. Per-layer commands are
 * dynamic — re-registered whenever the order array changes (because
 * the up/down command titles reflect the layer's *current* name).
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
}

// ---------------------------------------------------------------------------
// localStorage helpers (mirror ToolPalettePanel's pattern). The two
// JSON-shaped keys get safe parse/stringify wrappers; both swallow
// quota / private-mode / corrupt-value failures so the panel always
// renders something even if storage is wedged.

const LS_ACTIVE_ID = "cardboard.scene.layers.activeId";
const LS_VISIBILITY = "cardboard.scene.layers.visibility";
const LS_ORDER = "cardboard.scene.layers.order";

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

function readJSON<T>(key: string, fallback: T): T {
  const raw = readLS(key);
  if (raw == null) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function writeJSON(key: string, value: unknown): void {
  try {
    writeLS(key, JSON.stringify(value));
  } catch {
    /* JSON.stringify can throw on circular refs — defensive only */
  }
}

// ---------------------------------------------------------------------------
// Initial-state builders. Defaults are computed from MOCK_LAYERS so a
// future fixture edit (added/removed layer) flows through without
// touching this file.

function defaultVisibility(): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  for (const l of MOCK_LAYERS) out[l.id] = l.visible;
  return out;
}

function defaultOrder(): string[] {
  return MOCK_LAYERS.map((l) => l.id);
}

function defaultActiveId(): string {
  return MOCK_LAYERS[0]?.id ?? "";
}

// Sanitize a persisted order array: keep only ids that still exist in
// MOCK_LAYERS, then append any new layer ids that weren't in storage.
// This makes the panel resilient to fixture additions across reloads.
function reconcileOrder(stored: string[]): string[] {
  // Widen to string so `stored` (plain strings) can be tested against
  // the set without TS complaining that user-supplied ids aren't one
  // of MOCK_LAYERS' literal-union keys.
  const known = new Set<string>(MOCK_LAYERS.map((l) => l.id));
  const filtered = stored.filter((id) => known.has(id));
  for (const l of MOCK_LAYERS) {
    if (!filtered.includes(l.id)) filtered.push(l.id);
  }
  return filtered;
}

// ---------------------------------------------------------------------------
// Container-query breakpoint. Below ~160px the row's reorder column is
// dropped (the commands are still reachable via the palette). We use a
// ResizeObserver on the panel root because container queries aren't
// available in this codebase's Tailwind setup yet, and a one-cell
// breakpoint is cheaper than wiring `@container`.
const COMPACT_WIDTH_PX = 160;

export function LayersPanel(): React.JSX.Element {
  // ---- State -------------------------------------------------------------

  const [order, setOrder] = React.useState<string[]>(() =>
    reconcileOrder(readJSON<string[]>(LS_ORDER, defaultOrder())),
  );

  const [visibility, setVisibility] = React.useState<Record<string, boolean>>(
    () => {
      const stored = readJSON<Record<string, boolean>>(
        LS_VISIBILITY,
        defaultVisibility(),
      );
      // Merge stored values over defaults so newly-added fixture layers
      // pick up their initial `visible` flag without losing existing
      // user toggles.
      return { ...defaultVisibility(), ...stored };
    },
  );

  const [activeId, setActiveId] = React.useState<string>(() => {
    const stored = readLS(LS_ACTIVE_ID);
    if (stored && MOCK_LAYERS.some((l) => l.id === stored)) return stored;
    return defaultActiveId();
  });

  // Compact-mode flag driven by the panel root's measured width.
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

  // ---- Persistence -------------------------------------------------------

  React.useEffect(() => {
    writeLS(LS_ACTIVE_ID, activeId);
  }, [activeId]);

  React.useEffect(() => {
    writeJSON(LS_VISIBILITY, visibility);
  }, [visibility]);

  React.useEffect(() => {
    writeJSON(LS_ORDER, order);
  }, [order]);

  // ---- Handlers ----------------------------------------------------------

  const toggleVisibility = React.useCallback((layerId: string) => {
    setVisibility((prev) => ({
      ...prev,
      [layerId]: !(prev[layerId] ?? true),
    }));
  }, []);

  const activateLayer = React.useCallback((layerId: string) => {
    setActiveId(layerId);
  }, []);

  const moveLayer = React.useCallback(
    (layerId: string, direction: -1 | 1) => {
      setOrder((prev) => {
        const idx = prev.indexOf(layerId);
        if (idx < 0) return prev;
        const target = idx + direction;
        if (target < 0 || target >= prev.length) return prev;
        const next = prev.slice();
        const [removed] = next.splice(idx, 1);
        if (removed === undefined) return prev;
        next.splice(target, 0, removed);
        return next;
      });
    },
    [],
  );

  // Add-layer is a stub for now — wave 2 of the scene-layer store
  // will replace this with a real layer-creation flow (id minting,
  // default color, optional name prompt). Until then we just log so
  // the affordance is wired end-to-end and the command palette can
  // exercise the same code path the button does.
  const addLayer = React.useCallback(() => {
    // eslint-disable-next-line no-console
    console.log("[LayersPanel] scene.layer.add invoked (stub)");
  }, []);

  // Stable handler refs so the per-layer command registrations don't
  // need to re-run on every render — only when the layer list (order)
  // itself changes. Mirrors the README's canonical handler-ref pattern.
  const toggleRef = React.useRef(toggleVisibility);
  const activateRef = React.useRef(activateLayer);
  const moveRef = React.useRef(moveLayer);
  const addRef = React.useRef(addLayer);
  React.useEffect(() => {
    toggleRef.current = toggleVisibility;
    activateRef.current = activateLayer;
    moveRef.current = moveLayer;
    addRef.current = addLayer;
  }, [toggleVisibility, activateLayer, moveLayer, addLayer]);

  // Static command — registered once. The handler reads through the
  // ref so future state-aware iterations of `addLayer` flow through
  // without re-registering the command.
  React.useEffect(() => {
    return registerCommand({
      id: "scene.layer.add",
      title: "Add Layer",
      category: "Layer",
      keywords: ["layer", "add", "new", "create"],
      run: () => addRef.current(),
    });
  }, []);

  // ---- Resolved layer list (ordered) ------------------------------------

  const layers: LayerView[] = React.useMemo(() => {
    // Widen the fixture rows to LayerRow so the Map's value type isn't
    // narrowed by the `as const` literal union on MOCK_LAYERS.
    const rows: LayerRow[] = MOCK_LAYERS.map((l) => ({ ...l }));
    const byId = new Map<string, LayerRow>(rows.map((l) => [l.id, l]));
    const out: LayerView[] = [];
    for (const id of order) {
      const row = byId.get(id);
      if (!row) continue;
      out.push({
        ...row,
        description: LAYER_DESCRIPTIONS[row.id] ?? `${row.name} layer.`,
      });
    }
    return out;
  }, [order]);

  // ---- Command registry (dynamic per-layer) -----------------------------
  //
  // Each layer contributes four commands. We flatten the per-layer
  // unregister functions into a single array, then cleanup all of them
  // when the order list (or layer roster) changes. We intentionally
  // depend on `layers` so the up/down command *titles* reflect the
  // current position — palette users see "Move Layer Up: Walls" with
  // Walls in its real spot, not a stale snapshot.

  React.useEffect(() => {
    const unregs: Array<() => void> = [];
    for (const l of layers) {
      const idx = order.indexOf(l.id);
      const canMoveUp = idx > 0;
      const canMoveDown = idx >= 0 && idx < order.length - 1;

      unregs.push(
        registerCommand({
          id: `scene.layer.toggle.${l.id}`,
          title: `Toggle Visibility: ${l.name}`,
          category: "Layer",
          keywords: ["layer", "visibility", "toggle", l.name.toLowerCase()],
          run: () => toggleRef.current(l.id),
        }),
        registerCommand({
          id: `scene.layer.activate.${l.id}`,
          title: `Activate Layer: ${l.name}`,
          category: "Layer",
          keywords: ["layer", "activate", "select", l.name.toLowerCase()],
          run: () => activateRef.current(l.id),
        }),
      );

      // Only register reorder commands when the move is actually
      // possible. The palette already filters disabled actions by
      // omission, which keeps the surface tidy on the top/bottom rows.
      if (canMoveUp) {
        unregs.push(
          registerCommand({
            id: `scene.layer.up.${l.id}`,
            title: `Move Layer Up: ${l.name}`,
            category: "Layer",
            keywords: ["layer", "move", "up", "reorder", l.name.toLowerCase()],
            run: () => moveRef.current(l.id, -1),
          }),
        );
      }
      if (canMoveDown) {
        unregs.push(
          registerCommand({
            id: `scene.layer.down.${l.id}`,
            title: `Move Layer Down: ${l.name}`,
            category: "Layer",
            keywords: [
              "layer",
              "move",
              "down",
              "reorder",
              l.name.toLowerCase(),
            ],
            run: () => moveRef.current(l.id, 1),
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
            onToggleVisibility={toggleVisibility}
            onActivate={activateLayer}
            onMoveUp={(id) => moveLayer(id, -1)}
            onMoveDown={(id) => moveLayer(id, 1)}
          />
        );
      })}

      {/* Add Layer — Map.png shows a full-width ghost button below the
          list. The command (`scene.layer.add`) is registered above so
          the palette and any future keybindings can drive the same
          action. Stub `run` logs to the console for now. */}
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
                  Adds a new custom layer to the scene. (Coming soon —
                  currently a stub.)
                </div>
              </div>
            ),
          },
        ]}
      >
        <button
          type="button"
          aria-label="Add Layer"
          onClick={addLayer}
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
    </div>
  );
}

export const MANIFEST: Pick<DockPanelDef, "id" | "title" | "icon"> = {
  id: "layers",
  title: "Layers",
  icon: <Layers size={12} />,
};

export default LayersPanel;

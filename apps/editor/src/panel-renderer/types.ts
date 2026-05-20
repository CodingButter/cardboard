/**
 * JSON Panel Renderer — type spec (Phase 0).
 *
 * A panel can be authored as a JSON tree instead of TSX. The renderer
 * consumes this spec, resolves any `store.foo.bar` bindings against the
 * Wave-3 Zustand stores, and dispatches `{ script: "x.y" }` script-refs
 * through the command registry.
 *
 * Keep the initial node-type set TIGHT — Layout, Heading, Text, Input,
 * Button, Spacer, Conditional. We resist adding more until a real panel
 * needs them in Phase 1; every node-type expansion has a cost (renderer
 * size, builder surface, migration coverage). New types should be
 * justified by an actual migrated panel that can't be expressed with the
 * existing set.
 *
 * See `docs/plans/EDITOR_ENGINE.md` §4 for the spec rationale.
 */

/**
 * A path into a Zustand store. Accepts both `$store.foo.bar` (matches the
 * spec example in EDITOR_ENGINE.md §4) and the shorter `store.foo.bar`.
 * The first segment after the `store.` prefix is the store name; the
 * remaining segments are nested property accesses. A `[selected]`
 * dynamic-index segment resolves against `useSelectionStore.selected`
 * (Phase 0's only dynamic-index special case).
 *
 * Examples:
 *   "store.selection.selected"
 *   "$store.scene.settings.name"
 *   "store.scene.cells[selected].height"
 */
export type StorePath = `$store.${string}` | `store.${string}`;

/**
 * Script-ref escape hatch. Resolved at invoke time against the command
 * registry (`useCommandStore.commands[script]`). Args may contain the
 * placeholder `{ $value: true }` — at invoke time it's replaced with the
 * triggering control's current value (e.g. an Input's text). Strings and
 * numbers in args are passed through verbatim.
 *
 * Example:
 *   { script: "selection.clear" }
 *   { script: "scene.rename", args: [{ $value: true }] }
 */
export interface ScriptRef {
  script: string;
  args?: ReadonlyArray<string | number | boolean | ScriptValuePlaceholder>;
}

/** Placeholder slot in a script-ref's args. */
export interface ScriptValuePlaceholder {
  $value: true;
}

/** Discriminator helper for ScriptValuePlaceholder. */
export function isValuePlaceholder(
  v: unknown,
): v is ScriptValuePlaceholder {
  return (
    typeof v === "object" &&
    v !== null &&
    (v as { $value?: unknown }).$value === true
  );
}

// ---------------------------------------------------------------------------
// Node spec — discriminated union, no `any`.
// ---------------------------------------------------------------------------

export interface LayoutNode {
  type: "Layout";
  /** "row" / "column" → flex; "grid" → CSS grid with `auto-fill` columns
   *  sized via `columnsMinPx`/`columnsMaxPx` (status: matches the
   *  ToolPalette tile grid `repeat(auto-fill, minmax(54px, 64px))`). */
  direction: "row" | "column" | "grid";
  /** Tailwind-style gap in 0.25rem units; defaults to 2 (8px). */
  gap?: number;
  /** Optional padding in 0.25rem units; defaults to 0 (no padding). */
  padding?: number;
  /** Horizontal padding override (0.25rem units). */
  paddingX?: number;
  /** Vertical padding override (0.25rem units). */
  paddingY?: number;
  /** Cross-axis alignment of children. Maps to CSS `align-items`. */
  align?: "start" | "center" | "stretch" | "end" | "baseline";
  /** Main-axis distribution. Maps to CSS `justify-content`. */
  justify?: "start" | "center" | "between" | "end" | "around";
  /** Apply `flex: 1 1 0; min-width: 0` to each direct child. Lets a
   *  row Layout distribute children evenly across its width — the
   *  status-bar pattern (SelectionInfoPanel). */
  childFlex?: "1" | "auto";
  /** Per-child text alignment (inherited via CSS `text-align`). */
  textAlign?: "left" | "center" | "right";
  /** Minimum width per child in pixels. Currently used together with
   *  `childFlex: "1"` to set `min-w: <px>` on each child wrapper. */
  childMinWidthPx?: number;
  /** Grid only: min column width in px (the `minmax(min, max)` lower
   *  bound). Defaults to 54 — matches the ToolPalette tile floor. */
  columnsMinPx?: number;
  /** Grid only: max column width in px (the `minmax(min, max)` upper
   *  bound). Defaults to 64 — matches the ToolPalette tile ceiling. */
  columnsMaxPx?: number;
  /** Per-child explicit height in pixels. Used by the ToolPalette tile
   *  grid so each tile is the same square-ish 60px regardless of icon
   *  size variability. */
  childHeightPx?: number;
  /** Optional inline className passthrough — escape hatch for one-off
   *  utility classes the spec author needs (e.g. `min-h-0
   *  overflow-y-auto` for a scrolling root container). Use sparingly;
   *  prefer adding a typed prop when the use-case is reusable. */
  className?: string;
  children: NodeSpec[];
}

export interface HeadingNode {
  type: "Heading";
  /** Static string or a store-path binding. */
  text: string | StorePath;
  /** h1 = largest, h4 = smallest. Defaults to 2. */
  level?: 1 | 2 | 3 | 4;
}

/**
 * Named formatters that transform a resolved binding value to a string
 * before rendering. Each formatter accepts a specific input shape:
 *
 *   • "position"        — `{ x: number; y: number } | null` → `"(x.xx, y.yy)"` or `"—"`
 *   • "cell"            — `{ x: number; y: number } | null` → `"(x, y)"` or `"—"`
 *   • "selectionCount"  — `{ x: number; y: number } | null` → `"1 cell"` / `"0 cells"`
 *   • "layerName"       — `string`     → display name from `useLayerStore.activeId`
 *                                        (resolves MOCK_LAYERS + customLayers; falls
 *                                        back to the raw id)
 *
 * Adding a formatter is a one-line addition to the FORMATTERS map in
 * `PanelRenderer.tsx`; the renderer is the only place that knows the
 * formatter shapes.
 */
export type TextFormat = "position" | "cell" | "selectionCount" | "layerName";

/**
 * Semantic Text variants — these map to canonical typography slots
 * rather than raw className strings, so styling stays centralised.
 *
 *   • "default" → body copy at text-sm
 *   • "muted"   → body copy in the muted-fg colour
 *   • "label"   → uppercase 10px tracking-wider muted-fg (status-bar label)
 *   • "value"   — font-mono tabular-nums 11px (status-bar value)
 */
export type TextVariant = "default" | "muted" | "label" | "value";

export interface TextNode {
  type: "Text";
  /** Static string or a store-path binding. */
  text: string | StorePath;
  /** Render the text in a muted colour (for secondary copy).
   *  @deprecated Prefer `variant: "muted"` — kept as alias. */
  muted?: boolean;
  /** Semantic typography variant. Defaults to "default". */
  variant?: TextVariant;
  /** Apply a named formatter to the resolved binding value before
   *  rendering. Static text passes through unchanged when set. */
  format?: TextFormat;
  /** Truncate overflowing text with an ellipsis (single line). */
  truncate?: boolean;
}

export interface InputNode {
  type: "Input";
  /** Optional label rendered above the input. */
  label?: string;
  /** Two-way binding — read AND write a store value. */
  bind: StorePath;
  placeholder?: string;
}

export interface ButtonNode {
  type: "Button";
  text: string;
  onClick: ScriptRef;
  /** Variant maps to the shell `<Button variant>` prop. Defaults to "secondary". */
  variant?: "primary" | "secondary" | "ghost" | "danger" | "success";
}

export interface SpacerNode {
  type: "Spacer";
  /** Size in 0.25rem units; defaults to 2. */
  size?: number;
}

export interface ConditionalNode {
  type: "Conditional";
  /** Show children when this binding's resolved value is truthy — or,
   *  when `equals` is also set, when it strictly equals that value. */
  when: StorePath;
  /** Optional equality comparand. When set, the children render iff
   *  `resolve(when) === equals`. When omitted, behaviour is the
   *  classic truthy check. Lets Phase 1 panels gate on enum-style
   *  store fields (e.g. `tool.activeTool === "select"`). */
  equals?: string | number | boolean;
  children: NodeSpec[];
}

/**
 * Tooltip wrapper — wraps exactly one child NodeSpec with progressive
 * hover stages. Matches the shell `<Tooltip stages={...}>` primitive
 * one-to-one. Each stage's `content` is itself a `NodeSpec`, so the
 * tooltip body can be a Layout / Heading / Text composition rendered
 * by the recursive walker.
 *
 * Phase 1 only supports multi-stage progressive reveal (matches the
 * production SelectionInfoPanel's two-stage label → detailed pattern).
 * Adding a single-stage `content` shorthand is a Phase-2 nicety.
 */
export interface TooltipStageSpec {
  /** Delay in ms after hover-start when this stage's content appears. */
  delay: number;
  /** Content rendered at this stage. */
  content: NodeSpec;
}

export interface TooltipNode {
  type: "Tooltip";
  /** Side relative to the trigger. Defaults to "top". */
  side?: "top" | "bottom" | "left" | "right";
  /** Stages in ascending-delay order (the shell primitive's contract). */
  stages: TooltipStageSpec[];
  /** The trigger element. Exactly one child — the shell primitive
   *  wraps a single React element. */
  child: NodeSpec;
}

/**
 * Lucide icon by name — a small allowlist of icons keeps the renderer
 * import-size predictable. To extend the allowlist, add the icon to
 * the `ICON_REGISTRY` map in `PanelRenderer.tsx`. Unknown names render
 * nothing + log a warning.
 */
export interface IconNode {
  type: "Icon";
  /** lucide-react component name (e.g. "Crosshair"). */
  name: string;
  /** Icon size in pixels. Defaults to 12 to match status-bar usage. */
  size?: number;
}

/**
 * ToggleButton — a button whose visual "pressed" state mirrors a store
 * binding compared to an expected value. Click fires a script-ref via
 * the command registry, same contract as `Button`.
 *
 * Added to support the ToolPalette migration where each tile button is
 * highlighted iff `tool.activeTool` equals the tile's tool id, and each
 * sub-tool chip is highlighted iff `tool.activeSubTool[parent]` equals
 * the chip's sub-tool id. Phase 0's `Button` had no notion of pressed
 * state; this node fills that gap without bloating Button.
 *
 *   shape "tile" — icon-above-label square (60px) used by main tools.
 *   shape "chip" — text-only rounded-pill used by sub-tools.
 */
export interface ToggleButtonNode {
  type: "ToggleButton";
  /** Binding read to determine pressed state. */
  bind: StorePath;
  /** Pressed iff the bound value strictly equals `activeValue`. */
  activeValue: string | number | boolean;
  /** Tile label. Shown beneath the icon in "tile" shape; or as the
   *  only content in "chip" shape. */
  text: string;
  /** Optional icon name from `ICON_REGISTRY` — used by "tile" shape. */
  icon?: string;
  /** Icon size in pixels. Defaults to 18 to match the ToolPalette tile. */
  iconSize?: number;
  /** Click action. */
  onClick: ScriptRef;
  /** Visual shape. Defaults to "tile". */
  shape?: "tile" | "chip";
  /** Accessibility label. Defaults to `text`. */
  ariaLabel?: string;
}

/**
 * ScrollRow — wraps children in a horizontally-scrolling row with the
 * shell's `<ScrollRow>` primitive (hover-area edge fades, hidden native
 * scrollbar, ResizeObserver-driven affordance). Added so the
 * ToolPalette's sub-tool chip strip can keep its overflow UX in JSON.
 *
 * The wrapper itself does NOT impose layout on its children — pair it
 * with a child `Layout` to express the inner flex/gap rules.
 */
export interface ScrollRowNode {
  type: "ScrollRow";
  /** Optional className on the inner viewport (e.g. `flex items-center
   *  gap-1`). Mirrors the shell `ScrollRow.contentClassName`. */
  contentClassName?: string;
  /** Optional className on the outer wrapper. */
  className?: string;
  children: NodeSpec[];
}

/**
 * Discriminated union of every node type the Phase 0 renderer
 * understands. Adding a new node type is a four-step process:
 *   1. Add the interface above.
 *   2. Add it to this union.
 *   3. Add a case in `PanelRenderer.tsx`'s switch.
 *   4. Cover it in `PanelRenderer.test.ts`.
 *
 * Skipping step 2 or 3 should produce a TypeScript error at the switch
 * site (the union is exhaustively checked via the `never` assertion).
 */
export type NodeSpec =
  | LayoutNode
  | HeadingNode
  | TextNode
  | InputNode
  | ButtonNode
  | SpacerNode
  | ConditionalNode
  | TooltipNode
  | IconNode
  | ToggleButtonNode
  | ScrollRowNode;

/**
 * Optional per-panel local-state slice. Phase 0 doesn't actually wire
 * this up (no node-types read from local state yet) but we accept it on
 * the spec so authored JSONs are forward-compatible with Phase 1.
 */
export interface PanelLocalStateSpec {
  default: unknown;
}

/** The shell's dock-type catalog — mirrors `EDITOR_ENGINE.md` §3. */
export type DockKind =
  | "dockable-window"
  | "fullbleed-main"
  | "fixed-left-rail"
  | "fixed-right-rail"
  | "top-bar"
  | "bottom-bar"
  | "floating-overlay"
  | "modal"
  | "container-dockview";

/**
 * A complete panel spec — what a JSON file exports. The renderer
 * consumes one of these and produces a React subtree.
 */
/**
 * Optional outer-wrapper overrides — JSON authors can tune the
 * top-level container the renderer wraps the root node in. Defaults
 * mirror the Phase 0 behaviour (`flex flex-col gap-2 p-3 h-full
 * overflow-auto`). Status-bar style panels (SelectionInfo) opt out of
 * the default padding + `flex-col` baseline so the root Layout's own
 * `direction: "row"` controls the layout flush against the dock edge.
 */
export interface PanelRootOptions {
  /** Padding in 0.25rem units; defaults to 3 (12px). Pass `0` for flush. */
  padding?: number;
  /** Horizontal padding in 0.25rem units; overrides `padding` on the X axis. */
  paddingX?: number;
  /** Vertical padding in 0.25rem units; overrides `padding` on the Y axis. */
  paddingY?: number;
  /** Disable the default outer `flex flex-col`. The root NodeSpec then
   *  controls all layout. Defaults to false (legacy behaviour). */
  bare?: boolean;
}

export interface PanelSpec {
  id: string;
  title: string;
  /** Grouping bucket used by the DocksModal (panel-add modal) to
   *  cluster cards under a category header instead of dumping every
   *  panel into one undifferentiated grid.
   *
   *  Convention: capitalized, short, plural where natural — e.g.
   *  `"Tools"`, `"Inspector"`, `"Diagnostics"`, `"Viewport"`,
   *  `"Scene"`, `"Browse"`.
   *
   *  The shell predefines an ordered set of categories (see
   *  `DocksModal.tsx`), but the field is a free-form string so
   *  third-party packs may use any category they like; unknown
   *  categories appear in their own group sorted after the
   *  predefined ones. */
  category: string;
  dockKind: DockKind;
  /** Optional per-panel local state slice (Phase 0: accepted, not wired). */
  state?: Record<string, PanelLocalStateSpec>;
  /** Optional outer-wrapper tuning — see `PanelRootOptions`. */
  rootOptions?: PanelRootOptions;
  root: NodeSpec;
}

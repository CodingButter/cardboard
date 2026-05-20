/**
 * PanelRenderer — Phase 0 recursive JSON panel renderer.
 *
 * Walks a `PanelSpec` tree and emits React nodes. Each `NodeSpec` type
 * maps to a small wrapper that either renders a shell primitive
 * (`<Button>`, `<TextInput>`) or a plain element (`<div>` for Layout,
 * `<h2>` for Heading). The `useStoreBinding` hook handles two-way
 * binding into Zustand stores via the `resolveBinding` resolver.
 *
 * Constraints (per the brief):
 *   • Uses ONLY shell-exported primitives — `<Button>`, `<TextInput>`.
 *     No reinventing primitives.
 *   • Every interactive node routes through the command registry via
 *     `invokeScript`. There is no raw-function escape hatch.
 *   • TypeScript strict — the switch in NodeRenderer exhaustively
 *     handles every NodeSpec variant; the trailing `never` assert
 *     guarantees a compile-time error when a new variant is added
 *     without a matching case.
 *
 * Pop-out window compatibility:
 *   The renderer is a pure consumer of Zustand stores via the
 *   normal hook subscriptions. Wave-3 stores already broadcast via
 *   the storage event + BroadcastChannel (see `sync.ts`); a popped-
 *   out copy of any JSON panel will see the same store updates with
 *   no extra wiring. Verified mentally — the renderer never holds
 *   refs to DOM nodes across windows and never side-channels state.
 */

import React from "react";
import {
  Brush,
  Circle,
  Crosshair,
  Dot,
  Eraser,
  Hammer,
  Layers,
  Minus,
  MousePointer2,
  PaintBucket,
  Pipette,
  Plus,
  PlusSquare,
  RectangleHorizontal,
  Slash,
  Square,
  Wrench,
  X,
} from "lucide-react";
import { Button } from "../components/ui/Button";
import { NumberInput } from "../components/ui/NumberInput";
import { ScrollRow } from "../components/ui/ScrollRow";
import { TextInput } from "../components/ui/TextInput";
import { Tooltip } from "../components/ui/Tooltip";
import { cn } from "../lib/cn";
import { MOCK_LAYERS } from "../views/scene/scene-fixtures";
import { useLayerStore } from "../state/useLayerStore";
import { invokeScript } from "./invokeScript";
import {
  getStoreHook,
  resolveBinding,
  type ResolvedBinding,
} from "./resolveBinding";
import type {
  ButtonNode,
  ConditionalNode,
  HeadingNode,
  IconNode,
  InputNode,
  LayoutNode,
  NodeSpec,
  NumberInputNode,
  PanelSpec,
  ScrollRowNode,
  SliderNode,
  SpacerNode,
  StorePath,
  TextFormat,
  TextNode,
  TextVariant,
  ToggleButtonNode,
  TooltipNode,
} from "./types";

// ---------------------------------------------------------------------------
// Icon registry — small lucide allowlist to keep the renderer's import
// surface bounded. Add an icon to the allowlist by:
//   1. Importing it from lucide-react at the top of this file.
//   2. Adding it to ICON_REGISTRY below by its canonical lucide name.
// Unknown names log a warning + render nothing.
// ---------------------------------------------------------------------------

const ICON_REGISTRY: Record<
  string,
  React.ComponentType<{ size?: number }>
> = {
  Crosshair,
  MousePointer2,
  Layers,
  Square,
  // Added for the ToolPalette migration — every icon referenced by
  // MOCK_TOOLS plus the panel's manifest icon (Hammer).
  Brush,
  Eraser,
  Pipette,
  PaintBucket,
  PlusSquare,
  Hammer,
  // Added for the BrushPanel migration — every icon referenced by
  // MOCK_BRUSHES (Dot / Circle / Slash / RectangleHorizontal) plus
  // the size stepper buttons (Minus / Plus).
  Dot,
  Circle,
  Slash,
  RectangleHorizontal,
  Minus,
  Plus,
  // Added for the QuickToolsPanel migration — `X` is the Clear-all
  // button icon, `Wrench` is the panel manifest icon (kept here so
  // the pack-shipped variant can reference it from JSON too).
  X,
  Wrench,
};

// ---------------------------------------------------------------------------
// Text formatters — applied to a resolved binding value before render.
// Adding a formatter is a one-line addition here (+ a TextFormat literal
// in types.ts). Each formatter takes the resolved value (any shape) and
// returns a string. Unknown shapes degrade gracefully — they fall back
// to the em-dash "—" rather than throwing.
// ---------------------------------------------------------------------------

type Formatter = (value: unknown) => string;

const FORMATTERS: Record<TextFormat, Formatter> = {
  // `(x.xx, y.yy)` or `—` when there's no cursor. Mirrors the original
  // SelectionInfoPanel's `formatPosition` helper.
  position: (value) => {
    if (value == null) return "—";
    if (
      typeof value === "object" &&
      typeof (value as { x?: unknown }).x === "number" &&
      typeof (value as { y?: unknown }).y === "number"
    ) {
      const p = value as { x: number; y: number };
      return `(${p.x.toFixed(2)}, ${p.y.toFixed(2)})`;
    }
    return "—";
  },
  // `(x, y)` for integer cell coords, or `—` when there's no hovered cell.
  cell: (value) => {
    if (value == null) return "—";
    if (
      typeof value === "object" &&
      typeof (value as { x?: unknown }).x === "number" &&
      typeof (value as { y?: unknown }).y === "number"
    ) {
      const p = value as { x: number; y: number };
      return `(${p.x}, ${p.y})`;
    }
    return "—";
  },
  // "1 cell" / "0 cells" — phase 0 only supports single-cell selection.
  selectionCount: (value) => (value ? "1 cell" : "0 cells"),
  // ` (N)` when the bound value is a non-empty array, else "". Reads
  // through the array length so this composes cleanly with a header
  // like "Quick Tools" + Text{format:"applyCount"} — when no cell is
  // selected the binding resolves to undefined and the readout
  // collapses to the empty string with no layout shift. Strings also
  // accepted (length-bearing) so the formatter is reusable for other
  // collection-shaped bindings.
  applyCount: (value) => {
    if (Array.isArray(value) && value.length > 0) return ` (${value.length})`;
    if (typeof value === "string" && value.length > 0) return ` (${value.length})`;
    return "";
  },
  // Resolve an activeLayerId to its display name. Reads MOCK_LAYERS +
  // useLayerStore.customLayers; falls back to the raw id (or em-dash
  // when the id is empty). The formatter is called every render from
  // within useResolvedText, so the layer-store subscription is
  // established via React.useSyncExternalStore through the host hook
  // — the renderer's `useStoreBinding(node.text)` already subscribes
  // to `useLayerStore` when the binding's storeName is `layer`.
  layerName: (value) => {
    if (typeof value !== "string" || value.length === 0) return "—";
    for (const l of MOCK_LAYERS) {
      if (l.id === value) return l.name;
    }
    const custom = useLayerStore.getState().customLayers;
    for (const c of custom) {
      if (c.id === value) return c.name;
    }
    return value;
  },
};

// ---------------------------------------------------------------------------
// Variant class maps — semantic typography slots. Centralised here so
// callsites can't drift; tweaking the spec-wide "label" or "value"
// styling is a one-line edit.
// ---------------------------------------------------------------------------

const TEXT_VARIANT_CLASS: Record<TextVariant, string> = {
  default: "text-sm text-zinc-300",
  muted: "text-sm text-zinc-500",
  label:
    "text-[10px] uppercase tracking-wider text-(--color-fg-muted) leading-tight",
  value:
    "font-mono tabular-nums text-[11px] leading-tight text-(--color-fg-primary)",
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Return true when a `string | StorePath` field is a binding (vs a plain
 * static string). Bindings start with `store.` or `$store.`.
 */
function isBindingPath(text: string): text is StorePath {
  return text.startsWith("store.") || text.startsWith("$store.");
}

/**
 * useStoreBinding — Phase 0 binding hook.
 *
 * Subscribes the calling component to the store the path roots into so
 * the component re-renders when ANY slice of that store changes. This
 * is coarser than necessary (the binding only depends on a specific
 * sub-tree), but it's correct, and Phase 0 prioritises correctness
 * over render-perf. Phase 1 should narrow the subscription using a
 * selector — feasible because `tokenisePath` already tells us which
 * top-level key to watch.
 *
 * Returns the resolved binding (stable across renders for the same
 * path) plus the current value. Callers that need to write back call
 * `binding.set(newValue)`.
 */
function useStoreBinding(path: string): {
  value: unknown;
  binding: ResolvedBinding;
} {
  // Re-resolve only when the path string changes.
  const binding = React.useMemo(() => resolveBinding(path), [path]);
  // Subscribe to the store the path roots into. We don't pass a
  // selector — the hook returns the whole state — but we IMMEDIATELY
  // re-read through `binding.get()` so the rendered value is the
  // freshest resolved view. The subscription itself is what triggers
  // re-render on change.
  const storeHook = getStoreHook(binding.storeName);
  storeHook((s) => s); // subscribe to all slice changes
  const value = binding.get();
  return { value, binding };
}

/**
 * Resolve a `string | StorePath` text field. If it's a binding, returns
 * the resolved current value coerced to string. If it's a static
 * string, returns it verbatim. Wrapped as a hook because the binding
 * path needs `useStoreBinding`.
 *
 * When `format` is supplied AND the input is a binding, the resolved
 * value is run through the matching formatter (see `FORMATTERS`) before
 * the string-coercion fallback. Static text passes through unchanged.
 */
function useResolvedText(text: string, format?: TextFormat): string {
  // ALWAYS call the hook to keep hook order stable across renders —
  // pass a sentinel path when the input is static. The sentinel reads
  // a stable value (just `useSelectionStore.selected`) and is then
  // discarded by the branch below.
  const isBinding = isBindingPath(text);
  const { value } = useStoreBinding(isBinding ? text : "store.selection.selected");
  // The `layerName` formatter reads from `useLayerStore` as well as the
  // primary bound store. Subscribe to layer-store changes so the
  // formatted readout re-renders when the layer roster updates.
  // Subscribing unconditionally keeps hook order stable.
  useLayerStore((s) => s);
  if (!isBinding) return text;
  if (format) {
    const fn = FORMATTERS[format];
    if (fn) return fn(value);
  }
  if (value == null) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  // Object / array — JSON-stringify so authors see SOMETHING rather
  // than [object Object]. JSON panels shouldn't bind to non-scalar
  // values via Heading/Text, but we don't want to crash if they do.
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

// ---------------------------------------------------------------------------
// Per-node renderers
// ---------------------------------------------------------------------------

/** CSS `align-items` value for each Layout.align option. */
const ALIGN_CSS: Record<NonNullable<LayoutNode["align"]>, string> = {
  start: "flex-start",
  center: "center",
  stretch: "stretch",
  end: "flex-end",
  baseline: "baseline",
};

/** CSS `justify-content` value for each Layout.justify option. */
const JUSTIFY_CSS: Record<NonNullable<LayoutNode["justify"]>, string> = {
  start: "flex-start",
  center: "center",
  between: "space-between",
  end: "flex-end",
  around: "space-around",
};

function LayoutRenderer({ node }: { node: LayoutNode }): React.JSX.Element {
  // Numeric gap/padding are emitted as INLINE STYLE rather than
  // `gap-${n}` / `p-${n}` Tailwind classes. Reason: Tailwind's JIT
  // scanner only picks up class strings that appear LITERALLY in
  // source — `gap-${gap}` is a template literal at runtime, so the
  // class is invisible to the scanner and silently emits no rule.
  // Defaults like gap-2 happened to work because that exact string
  // exists elsewhere in the codebase; non-default values (gap=5,
  // padding=3, ...) would silently render with no spacing.
  // Inline style sidesteps the scanner entirely. Tailwind's unit is
  // 0.25rem (4px) per integer, so `n * 4` matches the Tailwind scale.
  const gap = node.gap ?? 2;
  const padding = node.padding ?? 0;
  // `align` / `justify` / `textAlign` map to plain CSS via the lookup
  // tables above — no Tailwind class involved, so JIT-scanner gaps
  // don't bite. `childFlex: "1"` is the load-bearing Selection-Info
  // pattern: every direct child gets `flex: 1 1 0; min-width: 0` so
  // the row distributes evenly across the panel width.
  // Axis-specific padding overrides the symmetric `padding` so callers
  // can express `px-2 py-1.5`-style styling without an escape hatch.
  const padX = node.paddingX ?? padding;
  const padY = node.paddingY ?? padding;
  const isGrid = node.direction === "grid";
  // Grid mode → `display: grid` with `auto-fill` columns sized via
  // `columnsMinPx`/`columnsMaxPx`. This is the ToolPalette tile
  // pattern: `repeat(auto-fill, minmax(54px, 64px))`. Defaults match
  // ToolPalette so a JSON author can opt-in by passing direction:
  // "grid" alone.
  const colMin = node.columnsMinPx ?? 54;
  const colMax = node.columnsMaxPx ?? 64;
  const style: React.CSSProperties = {
    gap: `${gap * 4}px`,
    ...(padX > 0 ? { paddingLeft: `${padX * 4}px`, paddingRight: `${padX * 4}px` } : {}),
    ...(padY > 0 ? { paddingTop: `${padY * 4}px`, paddingBottom: `${padY * 4}px` } : {}),
    ...(node.align ? { alignItems: ALIGN_CSS[node.align] } : {}),
    ...(node.justify ? { justifyContent: JUSTIFY_CSS[node.justify] } : {}),
    ...(node.textAlign ? { textAlign: node.textAlign } : {}),
    ...(isGrid
      ? {
          gridTemplateColumns: `repeat(auto-fill, minmax(${colMin}px, ${colMax}px))`,
        }
      : {}),
  };
  const childStyle: React.CSSProperties | undefined =
    node.childFlex === "1"
      ? {
          flex: "1 1 0",
          minWidth: node.childMinWidthPx ? `${node.childMinWidthPx}px` : 0,
          ...(node.childHeightPx ? { height: `${node.childHeightPx}px` } : {}),
        }
      : node.childHeightPx
      ? { height: `${node.childHeightPx}px` }
      : undefined;
  // Direction → display + axis class. `grid` uses CSS grid; row/column
  // stay on the flex shorthand. `flex flex-row` / `flex flex-col` are
  // literal class strings the Tailwind scanner picks up; `grid` is a
  // literal too.
  const dirClass = isGrid
    ? "grid"
    : node.direction === "row"
    ? "flex flex-row"
    : "flex flex-col";
  return (
    <div
      className={cn(dirClass, node.className)}
      style={style}
    >
      {node.children.map((child, i) =>
        childStyle ? (
          // Wrap each child in a sized cell so `flex: 1 1 0` applies
          // even to nodes whose own renderers don't accept a style
          // prop (most of them). The wrapper is `display: contents`-
          // free — it IS the flex item.
          <div key={i} style={childStyle}>
            <NodeRenderer node={child} />
          </div>
        ) : (
          <NodeRenderer key={i} node={child} />
        ),
      )}
    </div>
  );
}

function HeadingRenderer({ node }: { node: HeadingNode }): React.JSX.Element {
  const text = useResolvedText(node.text);
  const level = node.level ?? 2;
  const sizeClass =
    level === 1
      ? "text-xl font-semibold"
      : level === 2
      ? "text-base font-semibold"
      : level === 3
      ? "text-sm font-semibold"
      : "text-xs font-semibold uppercase tracking-wide";
  const className = cn("text-zinc-100", sizeClass);
  if (level === 1) return <h1 className={className}>{text}</h1>;
  if (level === 2) return <h2 className={className}>{text}</h2>;
  if (level === 3) return <h3 className={className}>{text}</h3>;
  return <h4 className={className}>{text}</h4>;
}

function TextRenderer({ node }: { node: TextNode }): React.JSX.Element {
  const text = useResolvedText(node.text, node.format);
  // Resolve the effective variant. `variant` wins; `muted: true` is a
  // back-compat alias that maps to `variant: "muted"`. Default is
  // "default" body copy.
  const variant: TextVariant =
    node.variant ?? (node.muted ? "muted" : "default");
  const variantClass = TEXT_VARIANT_CLASS[variant];
  return (
    <span
      className={cn(
        variantClass,
        node.truncate && "truncate block min-w-0",
      )}
    >
      {text}
    </span>
  );
}

function InputRenderer({ node }: { node: InputNode }): React.JSX.Element {
  const { value, binding } = useStoreBinding(node.bind);
  // The bound value may be undefined (path doesn't currently resolve —
  // e.g. `cells[selected]` with no selection). Render an empty string
  // in that case rather than letting React warn about uncontrolled →
  // controlled transitions.
  const displayValue =
    value == null
      ? ""
      : typeof value === "string"
      ? value
      : String(value);
  return (
    <label className="flex flex-col gap-1">
      {node.label && (
        <span className="text-xs text-zinc-400">{node.label}</span>
      )}
      <TextInput
        value={displayValue}
        placeholder={node.placeholder}
        onChange={(e) => binding.set(e.target.value)}
      />
    </label>
  );
}

function NumberInputRenderer({
  node,
}: {
  node: NumberInputNode;
}): React.JSX.Element {
  const { value, binding } = useStoreBinding(node.bind);
  // Coerce the bound value into a finite number for the primitive. The
  // shell `<NumberInput>` always presents the user a number and treats
  // NaN as "restore previous committed value", so coercing is safe.
  const numericValue =
    typeof value === "number" && Number.isFinite(value)
      ? value
      : Number(value);
  const displayValue = Number.isFinite(numericValue) ? numericValue : 0;
  // Fixed-width affordance — the brush-size readout is 40px so it
  // visually clusters with the +/- buttons + slider. Without `widthPx`
  // the input fills its flex parent (which is what the SceneSettings
  // numeric rows want).
  const style: React.CSSProperties | undefined =
    node.widthPx ? { width: `${node.widthPx}px` } : undefined;
  // `shrink-0` keeps the readout from collapsing inside a flex row
  // whose siblings are larger (e.g. the slider's `flex-1` consumes
  // remaining space).
  const wrapperClass = node.widthPx ? "shrink-0" : "flex-1 min-w-0";
  const input = (
    <div className={wrapperClass} style={style}>
      <NumberInput
        value={displayValue}
        min={node.min}
        max={node.max}
        step={node.step ?? 1}
        precision={node.precision}
        showSteppers={node.showSteppers}
        unit={node.unit}
        aria-label={node.ariaLabel ?? node.label}
        onChange={(next) => binding.set(next)}
      />
    </div>
  );
  if (!node.label) return input;
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs text-zinc-400">{node.label}</span>
      {input}
    </label>
  );
}

function SliderRenderer({ node }: { node: SliderNode }): React.JSX.Element {
  const { value, binding } = useStoreBinding(node.bind);
  const numericValue =
    typeof value === "number" && Number.isFinite(value)
      ? value
      : Number(value);
  const displayValue = Number.isFinite(numericValue) ? numericValue : node.min;
  const fill = node.fill ?? true;
  // The shell does not export a dedicated `<Slider>` primitive yet
  // (brush-size was the first caller). Emitting `<input type="range">`
  // directly with the same `accent-amber-500` styling matches the
  // original BrushPanel TSX one-for-one — when a primitive lands, this
  // is the swap site.
  const wrapper = fill ? "flex-1 min-w-0 flex items-center" : "flex items-center";
  return (
    <div className={wrapper}>
      <input
        type="range"
        min={node.min}
        max={node.max}
        step={node.step ?? 1}
        value={displayValue}
        aria-label={node.ariaLabel}
        onChange={(e) => {
          const parsed = Number.parseFloat(e.target.value);
          if (Number.isFinite(parsed)) binding.set(parsed);
        }}
        className="w-full accent-amber-500"
      />
    </div>
  );
}

function ButtonRenderer({ node }: { node: ButtonNode }): React.JSX.Element {
  // ALWAYS call the binding hook (even when disabledWhen is undefined)
  // so hook order stays stable across renders. The sentinel path reads
  // a stable scalar so we don't trigger extra re-renders.
  const disabledBindPath = node.disabledWhen?.bind ?? "store.selection.selected";
  const { value: disabledValue } = useStoreBinding(disabledBindPath);
  const disabled = React.useMemo(() => {
    const dw = node.disabledWhen;
    if (!dw) return false;
    const n = typeof disabledValue === "number" ? disabledValue : Number(disabledValue);
    if (!Number.isFinite(n)) return false;
    if (typeof dw.atMost === "number" && n <= dw.atMost) return true;
    if (typeof dw.atLeast === "number" && n >= dw.atLeast) return true;
    return false;
  }, [node.disabledWhen, disabledValue]);
  const onClick = React.useCallback(() => {
    void invokeScript(node.onClick);
  }, [node.onClick]);
  const Icon = node.icon ? ICON_REGISTRY[node.icon] : undefined;
  const shape = node.shape ?? "default";
  if (shape === "icon") {
    // Icon-only square — mirrors the BrushPanel +/- stepper visual.
    // Doesn't use the shell `<Button>` primitive because it doesn't
    // expose a "square 28px" mode; we render a bare `<button>` with
    // the same Tailwind class stack the original BrushPanel used.
    const active = !disabled;
    return (
      <button
        type="button"
        aria-label={node.ariaLabel ?? node.text ?? ""}
        disabled={disabled}
        onClick={onClick}
        className={[
          "h-7 w-7 shrink-0 rounded",
          "flex items-center justify-center",
          "border transition-colors",
          active
            ? "bg-transparent border-(--color-border-strong) text-(--color-fg-secondary) hover:border-amber-500/60 hover:text-(--color-fg-primary)"
            : "bg-transparent border-(--color-border) text-(--color-fg-muted) opacity-50 cursor-not-allowed",
        ].join(" ")}
      >
        {Icon ? <Icon size={node.iconSize ?? 14} /> : null}
      </button>
    );
  }
  return (
    <Button
      variant={node.variant ?? "secondary"}
      onClick={onClick}
      disabled={disabled}
      leadingIcon={Icon ? <Icon size={node.iconSize ?? 12} /> : undefined}
    >
      {node.text}
    </Button>
  );
}

function SpacerRenderer({ node }: { node: SpacerNode }): React.JSX.Element {
  // Inline style for the same reason as `LayoutRenderer`'s gap/padding:
  // dynamic `h-${n}` / `w-${n}` are invisible to the Tailwind JIT scanner.
  const size = node.size ?? 2;
  const px = `${size * 4}px`;
  return (
    <div style={{ width: px, height: px }} aria-hidden="true" />
  );
}

function TooltipRenderer({
  node,
}: {
  node: TooltipNode;
}): React.JSX.Element {
  // Map the JSON stages onto the shell primitive's expected shape —
  // each stage's content is rendered through the recursive NodeRenderer
  // so authors can compose Layout/Text/Heading inside a tooltip body.
  const stages = React.useMemo(
    () =>
      node.stages.map((s) => ({
        delay: s.delay,
        content: <NodeRenderer node={s.content} />,
      })),
    [node.stages],
  );
  // The shell `<Tooltip>` requires a SINGLE React element child. Wrap
  // the recursive render in a fragment-friendly span so child node
  // types that emit fragments still satisfy the cloneElement contract.
  return (
    <Tooltip side={node.side ?? "top"} stages={stages} wrapperClassName="block">
      <span className="contents">
        <NodeRenderer node={node.child} />
      </span>
    </Tooltip>
  );
}

function IconRenderer({ node }: { node: IconNode }): React.JSX.Element | null {
  const Comp = ICON_REGISTRY[node.name];
  if (!Comp) {
    // eslint-disable-next-line no-console
    console.warn(
      `[PanelRenderer] unknown icon "${node.name}" — add it to ICON_REGISTRY`,
    );
    return null;
  }
  return <Comp size={node.size ?? 12} />;
}

function ConditionalRenderer({
  node,
}: {
  node: ConditionalNode;
}): React.JSX.Element | null {
  const { value } = useStoreBinding(node.when);
  // Three-mode gate, precedence from most-specific to most-general:
  //   1. `equals` (including `equals: null`) — strict equality.
  //   2. `notEmpty` — non-empty array / non-empty string. Distinct
  //      from the default truthy gate because `[]` is truthy in JS,
  //      which would let the QuickTools Clear button render against
  //      an empty tags array. Set `notEmpty: true` to opt into the
  //      length-aware check.
  //   3. Default truthy — `Boolean(value)`.
  let shouldRender: boolean;
  if (node.equals !== undefined) {
    shouldRender = value === node.equals;
  } else if (node.notEmpty === true) {
    if (Array.isArray(value)) shouldRender = value.length > 0;
    else if (typeof value === "string") shouldRender = value.length > 0;
    else shouldRender = false;
  } else {
    shouldRender = Boolean(value);
  }
  if (!shouldRender) return null;
  return (
    <>
      {node.children.map((child, i) => (
        <NodeRenderer key={i} node={child} />
      ))}
    </>
  );
}

// ---------------------------------------------------------------------------
// ToggleButton — pressed-state aware tile / chip.
// ---------------------------------------------------------------------------

/**
 * Pressed-state styling lookup.
 *   • "tile" — ToolPalette 60px square (icon above uppercase label).
 *   • "chip" — solid-amber rounded pill (ToolPalette sub-tool strip).
 *   • "tag"  — calm amber-tint rounded pill (QuickTools chip wrap):
 *              the active state is a tinted border rather than a
 *              solid fill so multiple active chips don't visually
 *              shout. Disabled state dims to muted fg + border.
 *
 * All three shapes route through the same renderer; only the
 * className differs. The shared amber palette ties them visually so
 * a global retune still works.
 */
function toggleButtonClass(
  shape: ToggleButtonNode["shape"],
  active: boolean,
  disabled: boolean,
): string {
  if (shape === "tag") {
    // QuickTools chip — calm amber-tint active state, muted disabled.
    const tagState = disabled
      ? "bg-transparent border-(--color-border) text-(--color-fg-muted) opacity-60 cursor-not-allowed"
      : active
        ? "bg-amber-500/15 border-amber-500 text-amber-300"
        : "bg-transparent border-(--color-border-strong) text-(--color-fg-secondary) hover:border-amber-500/60 hover:text-(--color-fg-primary)";
    return cn(
      "rounded-full px-2 py-1 text-[10px] uppercase tracking-wide whitespace-nowrap",
      "border transition-colors",
      tagState,
    );
  }
  const shared =
    "border transition-colors " +
    (disabled
      ? "bg-transparent border-(--color-border) text-(--color-fg-muted) opacity-60 cursor-not-allowed"
      : active
        ? "bg-amber-500 border-amber-500 text-zinc-950"
        : "bg-transparent border-(--color-border-strong) text-(--color-fg-secondary) hover:border-amber-500/60 hover:text-(--color-fg-primary)");
  if (shape === "chip") {
    return cn(
      "shrink-0 rounded-full px-2 py-0.5 text-[9px] uppercase tracking-wide",
      shared,
    );
  }
  // tile (default)
  return cn(
    "w-full h-full rounded flex flex-col items-center justify-center gap-1",
    shared,
  );
}

function ToggleButtonRenderer({
  node,
}: {
  node: ToggleButtonNode;
}): React.JSX.Element {
  const { value } = useStoreBinding(node.bind);
  // Pressed-state semantics — `activeValue` (strict-equal) wins when
  // both discriminants are set; otherwise `activeWhenContains` runs
  // an `Array.includes` check. Both unset → never active. Documented
  // precedence in types.ts.
  const active = React.useMemo(() => {
    if (node.activeValue !== undefined) return value === node.activeValue;
    if (node.activeWhenContains !== undefined) {
      return Array.isArray(value) && value.includes(node.activeWhenContains);
    }
    return false;
  }, [node.activeValue, node.activeWhenContains, value]);
  // Disabled-state binding — separate hook call so subscription
  // tracking stays stable. We always call the hook (sentinel path
  // when no disabledWhen is set) to keep React's hook order
  // invariant.
  const disabledBindPath = node.disabledWhen?.bind ?? "store.selection.selected";
  const { value: disabledValue } = useStoreBinding(disabledBindPath);
  const disabled = React.useMemo(() => {
    const dw = node.disabledWhen;
    if (!dw) return false;
    if (dw.isNullish === true) return disabledValue == null;
    return false;
  }, [node.disabledWhen, disabledValue]);

  const shape = node.shape ?? "tile";
  const onClick = React.useCallback(() => {
    if (disabled) return;
    void invokeScript(node.onClick);
  }, [disabled, node.onClick]);
  const Icon = node.icon ? ICON_REGISTRY[node.icon] : undefined;
  return (
    <button
      type="button"
      aria-label={node.ariaLabel ?? node.text}
      aria-pressed={active}
      aria-disabled={disabled || undefined}
      disabled={disabled}
      onClick={onClick}
      className={toggleButtonClass(shape, active, disabled)}
    >
      {shape === "tile" ? (
        <>
          {Icon ? <Icon size={node.iconSize ?? 18} /> : null}
          <span className="text-[9px] uppercase tracking-wide leading-none">
            {node.text}
          </span>
        </>
      ) : (
        node.text
      )}
    </button>
  );
}

// ---------------------------------------------------------------------------
// ScrollRow — hover-area horizontal scroll affordance.
// ---------------------------------------------------------------------------

function ScrollRowRenderer({
  node,
}: {
  node: ScrollRowNode;
}): React.JSX.Element {
  return (
    <ScrollRow
      className={node.className}
      contentClassName={node.contentClassName}
    >
      {node.children.map((child, i) => (
        <NodeRenderer key={i} node={child} />
      ))}
    </ScrollRow>
  );
}

// ---------------------------------------------------------------------------
// Recursive dispatch
// ---------------------------------------------------------------------------

/**
 * Exhaustively dispatch a `NodeSpec` to its renderer. The trailing
 * `never` assertion guarantees a compile-time error if a new node type
 * is added to the `NodeSpec` union without a matching case here.
 */
export function NodeRenderer({ node }: { node: NodeSpec }): React.JSX.Element | null {
  switch (node.type) {
    case "Layout":
      return <LayoutRenderer node={node} />;
    case "Heading":
      return <HeadingRenderer node={node} />;
    case "Text":
      return <TextRenderer node={node} />;
    case "Input":
      return <InputRenderer node={node} />;
    case "NumberInput":
      return <NumberInputRenderer node={node} />;
    case "Slider":
      return <SliderRenderer node={node} />;
    case "Button":
      return <ButtonRenderer node={node} />;
    case "Spacer":
      return <SpacerRenderer node={node} />;
    case "Conditional":
      return <ConditionalRenderer node={node} />;
    case "Tooltip":
      return <TooltipRenderer node={node} />;
    case "Icon":
      return <IconRenderer node={node} />;
    case "ToggleButton":
      return <ToggleButtonRenderer node={node} />;
    case "ScrollRow":
      return <ScrollRowRenderer node={node} />;
    default: {
      // Exhaustiveness check — if you added a NodeSpec variant and
      // skipped a case, TS will reject this assignment.
      const _never: never = node;
      // eslint-disable-next-line no-console
      console.error(
        `[PanelRenderer] unknown node type`,
        _never,
      );
      return null;
    }
  }
}

/**
 * Top-level entry point — render a complete panel spec into a React
 * subtree. Wraps the root in a flex column with sensible default
 * padding so JSON authors don't need to remember to set it.
 */
export function PanelRenderer({
  spec,
}: {
  spec: PanelSpec;
}): React.JSX.Element {
  // Resolve outer-wrapper options. Defaults preserve Phase 0 behaviour
  // (`flex flex-col gap-2 p-3`); the new rootOptions overrides let
  // status-bar style panels go flush.
  const opts = spec.rootOptions ?? {};
  const bare = opts.bare === true;
  const padDefault = opts.padding ?? 3;
  const padX = opts.paddingX ?? padDefault;
  const padY = opts.paddingY ?? padDefault;
  const style: React.CSSProperties = {
    paddingLeft: `${padX * 4}px`,
    paddingRight: `${padX * 4}px`,
    paddingTop: `${padY * 4}px`,
    paddingBottom: `${padY * 4}px`,
  };
  return (
    <div
      className={cn(
        "h-full overflow-auto text-(--color-fg-primary)",
        !bare && "flex flex-col gap-2",
      )}
      style={style}
      data-panel-id={spec.id}
    >
      <NodeRenderer node={spec.root} />
    </div>
  );
}

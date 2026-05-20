// Wave 3.3 panel migration #7: SelectionInfoPanel is now read-only on
// `useSelectionStore` (selected + hover + cursor) plus `useLayerStore`
// (active layer name). The only mutator wired here is the existing
// `scene.selection.clear` command, which now actually deselects via
// `useSelectionStore.getState().select(null)`. Invert / Select-All stay
// as stubs — those are cross-cell selection ops that no store models
// today; their commands remain registered so the palette keeps the
// IDs reserved.
import React from "react";
import { Crosshair } from "lucide-react";
import type { DockPanelDef } from "../../../components/dock/DockShell";
import { Tooltip } from "../../../components/ui/Tooltip";
import { registerCommand } from "../../../state/useCommandStore";
import { useSelectionStore } from "../../../state/useSelectionStore";
import { useLayerStore } from "../../../state/useLayerStore";
import {
  MOCK_LAYERS,
  type SelectionInfoRow,
} from "../scene-fixtures";

/**
 * SelectionInfoPanel — compact status-bar readout of the current
 * cursor / cell / layer / selection state.
 *
 * Visual target: the small status block in the bottom-centre of
 * `Editor Design/Map.png`, sitting next to the Status Console — shows
 * cursor world position, hovered cell coords, active layer name, and
 * the current selection size.
 *
 * IMPORTANT: this panel is registered in MapView with `surface: false`,
 * so DockShell does NOT wrap us in a PanelSurface card. We render flush
 * and own our own padding. The aesthetic is "status bar": small text,
 * monospace numbers, subtle vertical dividers between sections.
 *
 * Responsive strategy (this panel owns it — see brief notes):
 *
 *   • Default (≥ NARROW_2COL_PX): horizontal flex row of 4 sections
 *     evenly distributed, vertical dividers between them.
 *   • Below NARROW_2COL_PX:        2x2 grid via grid-cols-2.
 *   • Below NARROW_STACK_PX:       single-column stacked label/value
 *     rows.
 *
 * Vertical overflow uses the themed scrollbar; horizontal scroll is
 * never introduced.
 *
 * Commands registered:
 *   - `scene.selection.copy`      Copy Selection Info
 *   - `scene.selection.clear`     Clear Selection
 *   - `scene.selection.invert`    Invert Selection
 *   - `scene.selection.selectAll` Select All (Ctrl+A)
 */

/** Width below which the panel switches from 4-up row to 2x2 grid. */
const NARROW_2COL_PX = 300;
/** Width below which the panel collapses to a single stacked column. */
const NARROW_STACK_PX = 150;

interface SectionDef {
  /** Key into SelectionInfoRow — used for both display + clipboard. */
  key: keyof SelectionInfoRow;
  /** Short status-bar label (UPPERCASE). */
  label: string;
  /** Human-readable label for stage-1 tooltip + clipboard prefix. */
  longLabel: string;
  /** Stage-2 tooltip body. */
  description: string;
}

const SECTIONS: readonly SectionDef[] = [
  {
    key: "position",
    label: "Position",
    longLabel: "Cursor Position",
    description:
      "Current mouse coordinates in scene-space units (continuous, sub-cell precision).",
  },
  {
    key: "cell",
    label: "Cell",
    longLabel: "Hovered Cell",
    description:
      "Integer grid coordinates of the cell under the cursor.",
  },
  {
    key: "layer",
    label: "Layer",
    longLabel: "Active Layer",
    description:
      "Layer that paint, erase, and selection operations currently target.",
  },
  {
    key: "selection",
    label: "Selection",
    longLabel: "Selection",
    description:
      "Summary of the current selection — count of selected cells or entities.",
  },
];

/** Build the multi-line clipboard string used by the copy command. */
function formatClipboard(info: SelectionInfoRow): string {
  return [
    `Position: ${info.position}`,
    `Cell: ${info.cell}`,
    `Layer: ${info.layer}`,
    `Selection: ${info.selection}`,
  ].join("\n");
}

/** Format a continuous cursor position as `(x.xx, y.xx)`. Falls back
 *  to an em-dash when no pointer is over the scene. Two decimals keeps
 *  the status-bar width steady (tabular-nums in the label means the
 *  string width depends only on character count). */
function formatPosition(pos: { x: number; y: number } | null): string {
  if (!pos) return "—";
  return `(${pos.x.toFixed(2)}, ${pos.y.toFixed(2)})`;
}

/** Format a hovered/selected cell as `(x, y)`. The cell coord lane is
 *  what the SelectionInfo readout means by "Cell" — i.e. the cell
 *  currently under the cursor, not the persisted selection. */
function formatCell(cell: { x: number; y: number } | null): string {
  if (!cell) return "—";
  return `(${cell.x}, ${cell.y})`;
}

/** Summarise the current selection as a count phrase. Today's store
 *  only models a single selected cell (`CellCoord | null`); the
 *  pluralised shape leaves room for multi-cell selections later
 *  without breaking the readout's column width. */
function formatSelection(selected: { x: number; y: number } | null): string {
  return selected ? "1 cell" : "0 cells";
}

export function SelectionInfoPanel(): React.JSX.Element {
  // Cross-panel store subscriptions. Each selector returns a primitive
  // or a stable object reference from the store, so React only
  // re-renders the panel when those individual slices change.
  //
  // `hover` + `cursor` are throttled at the store level to ~30 Hz
  // (see `useSelectionStore.setHover` / `setCursor`) so dragging the
  // mouse across the canvas does not flood this panel with renders.
  const selected = useSelectionStore((s) => s.selected);
  const hover = useSelectionStore((s) => s.hover);
  const cursor = useSelectionStore((s) => s.cursor);
  const activeLayerId = useLayerStore((s) => s.activeId);
  const customLayers = useLayerStore((s) => s.customLayers);

  // Resolve the active layer's display name from the fixture roster
  // plus any runtime-added custom layers. Falls back to the raw id so
  // the readout never goes blank if a layer record is missing.
  const activeLayerName = React.useMemo(() => {
    for (const l of MOCK_LAYERS) {
      if (l.id === activeLayerId) return l.name;
    }
    for (const c of customLayers) {
      if (c.id === activeLayerId) return c.name;
    }
    return activeLayerId || "—";
  }, [activeLayerId, customLayers]);

  // Synthesize the flat SelectionInfoRow that the section + clipboard
  // formatting code consumes. Memoised on the underlying primitives so
  // the SelectionSection children only re-render when a value actually
  // changes.
  const info = React.useMemo<SelectionInfoRow>(
    () => ({
      position: formatPosition(cursor),
      cell: formatCell(hover),
      layer: activeLayerName,
      selection: formatSelection(selected),
    }),
    [cursor, hover, activeLayerName, selected],
  );

  // --- Responsive width tracking -----------------------------------
  const rootRef = React.useRef<HTMLDivElement>(null);
  const [width, setWidth] = React.useState<number>(NARROW_2COL_PX + 1);
  React.useEffect(() => {
    const el = rootRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver((entries) => {
      for (const e of entries) setWidth(e.contentRect.width);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const layout: "row" | "grid" | "stack" =
    width > 0 && width < NARROW_STACK_PX
      ? "stack"
      : width > 0 && width < NARROW_2COL_PX
        ? "grid"
        : "row";

  // --- Action handlers (still call these on registered command run) ---
  const handleCopy = React.useCallback(() => {
    const text = formatClipboard(info);
    try {
      if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
        void navigator.clipboard.writeText(text);
        return;
      }
    } catch {
      /* fall through to log */
    }
    // Fallback — surface the payload for debugging when the clipboard
    // API isn't available (e.g. non-secure context, jsdom).
    console.log("[selection.copy]\n" + text);
  }, [info]);

  const handleClear = React.useCallback(() => {
    // Live: drop the persisted cell selection. Going through
    // `getState()` keeps this callback stable across renders — no
    // selector subscription is needed for a fire-and-forget mutation.
    useSelectionStore.getState().select(null);
  }, []);

  // Invert + Select-All are cross-cell selection ops that no store
  // currently models (the selection slice is `CellCoord | null`).
  // Registrations stay so the command IDs are reserved + discoverable
  // in the palette; the runtime hooks land in a later wave.
  const handleInvert = React.useCallback(() => {
    console.log("[selection.invert] (stub) invert current selection");
  }, []);

  const handleSelectAll = React.useCallback(() => {
    console.log("[selection.selectAll] (stub) select all cells on layer");
  }, []);

  // --- Command-registry refs (canonical handler-ref + useEffect) ----
  const copyRef = React.useRef(handleCopy);
  const clearRef = React.useRef(handleClear);
  const invertRef = React.useRef(handleInvert);
  const selectAllRef = React.useRef(handleSelectAll);

  React.useEffect(() => {
    copyRef.current = handleCopy;
  }, [handleCopy]);
  React.useEffect(() => {
    clearRef.current = handleClear;
  }, [handleClear]);
  React.useEffect(() => {
    invertRef.current = handleInvert;
  }, [handleInvert]);
  React.useEffect(() => {
    selectAllRef.current = handleSelectAll;
  }, [handleSelectAll]);

  React.useEffect(() => {
    const unregs = [
      registerCommand({
        id: "scene.selection.copy",
        title: "Copy Selection Info",
        category: "Selection",
        keywords: ["copy", "selection", "clipboard", "info", "position", "cell"],
        run: () => copyRef.current(),
      }),
      registerCommand({
        id: "scene.selection.clear",
        title: "Clear Selection",
        category: "Selection",
        keywords: ["clear", "deselect", "selection"],
        run: () => clearRef.current(),
      }),
      registerCommand({
        id: "scene.selection.invert",
        title: "Invert Selection",
        category: "Selection",
        keywords: ["invert", "flip", "selection"],
        run: () => invertRef.current(),
      }),
      registerCommand({
        id: "scene.selection.selectAll",
        title: "Select All",
        category: "Selection",
        keywords: ["select", "all", "everything"],
        keybinding: "Ctrl+A",
        run: () => selectAllRef.current(),
      }),
    ];
    return () => unregs.forEach((u) => u());
  }, []);

  // --- Render ------------------------------------------------------
  return (
    <div
      ref={rootRef}
      data-panel="selection-info"
      className={[
        "h-full w-full overflow-y-auto overflow-x-hidden",
        // Own our padding — DockShell does NOT wrap us in a card.
        "px-2 py-1.5",
        "text-(--color-fg-primary)",
        // Layout switches by container width (ResizeObserver above).
        layout === "row"
          ? "flex flex-row items-stretch"
          : layout === "grid"
            ? "grid grid-cols-2 gap-x-2 gap-y-1"
            : "flex flex-col gap-1",
      ].join(" ")}
    >
      {SECTIONS.map((section) => {
        const value = info[section.key];
        return (
          <SelectionSection
            key={section.key}
            section={section}
            value={value}
            layout={layout}
          />
        );
      })}
    </div>
  );
}

interface SelectionSectionProps {
  section: SectionDef;
  value: string;
  layout: "row" | "grid" | "stack";
}

function SelectionSection({
  section,
  value,
  layout,
}: SelectionSectionProps) {
  // Row mode: each section flex-1, content centred horizontally — Map.png
  // pattern. Sections are separated by the flex distribution alone, no
  // dividers. Grid + stack: gap handles separation.
  const containerClass =
    layout === "row"
      ? "flex-1 min-w-[100px] flex flex-col justify-center px-2 text-center"
      : layout === "grid"
        ? "min-w-0 flex flex-col"
        : // stack: single column of label/value rows
          "min-w-0 flex flex-row items-baseline gap-2";

  const labelClass =
    layout === "stack"
      ? "text-[10px] uppercase tracking-wider text-(--color-fg-muted) shrink-0 w-10"
      : "text-[10px] uppercase tracking-wider text-(--color-fg-muted)";

  const valueClass = [
    "font-mono tabular-nums text-[11px] leading-tight",
    "text-(--color-fg-primary) truncate",
  ].join(" ");

  return (
    <Tooltip
      side="top"
      stages={[
        { delay: 1000, content: <span>{section.longLabel}</span> },
        {
          delay: 3000,
          content: (
            <div className="max-w-[400px]">
              <div className="font-semibold">{section.longLabel}</div>
              <div className="text-[10px] text-(--color-fg-muted) mt-1 whitespace-normal">
                {section.description}
              </div>
              <div className="font-mono text-[10px] mt-1 break-all">
                {value}
              </div>
            </div>
          ),
        },
      ]}
    >
      <div className={containerClass} data-section={section.key}>
        <span className={labelClass}>{section.label}</span>
        <span className={valueClass}>
          {value}
        </span>
      </div>
    </Tooltip>
  );
}

export const MANIFEST: Pick<DockPanelDef, "id" | "title" | "icon" | "category"> = {
  id: "selection-info",
  title: "Selection Info",
  category: "Inspector",
  icon: <Crosshair size={12} />,
};

export default SelectionInfoPanel;

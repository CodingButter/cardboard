// TODO: wire to selection store. The readout below shows live
// cursor/cell/layer/selection state from the editor's pointer +
// selection stores once those land. For Wave 2 the panel simply
// renders MOCK_SELECTION_INFO so the layout + commands are exercised.
import React from "react";
import { Crosshair } from "lucide-react";
import type { DockPanelDef } from "../../../components/dock/DockShell";
import { Tooltip } from "../../../components/ui/Tooltip";
import { registerCommand } from "../../../state/useCommandStore";
import {
  MOCK_SELECTION_INFO,
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
    label: "Pos",
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
    label: "Sel",
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

export function SelectionInfoPanel(): React.JSX.Element {
  // TODO: wire to selection store — replace local fixture with live
  // pointer + selection state.
  const info: SelectionInfoRow = MOCK_SELECTION_INFO;

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
    // TODO: wire to selection store.
    console.log("[selection.clear] (stub) clear current selection");
  }, []);

  const handleInvert = React.useCallback(() => {
    // TODO: wire to selection store.
    console.log("[selection.invert] (stub) invert current selection");
  }, []);

  const handleSelectAll = React.useCallback(() => {
    // TODO: wire to selection store.
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
      {SECTIONS.map((section, idx) => {
        const value = info[section.key];
        const showDivider = layout === "row" && idx > 0;
        return (
          <SelectionSection
            key={section.key}
            section={section}
            value={value}
            layout={layout}
            withLeftDivider={showDivider}
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
  withLeftDivider: boolean;
}

function SelectionSection({
  section,
  value,
  layout,
  withLeftDivider,
}: SelectionSectionProps) {
  // Row mode: each section flex-1 with a subtle left border acting as
  // the section divider (border-l on every section except the first).
  // Grid + stack: no divider, the grid/flex gap handles separation.
  const containerClass =
    layout === "row"
      ? [
          "flex-1 min-w-[100px] flex flex-col justify-center px-2",
          withLeftDivider ? "border-l border-(--color-border-subtle)" : "",
        ].join(" ")
      : layout === "grid"
        ? "min-w-0 flex flex-col"
        : // stack: single column of label/value rows
          "min-w-0 flex flex-row items-baseline gap-2";

  const labelClass =
    layout === "stack"
      ? "text-[9px] uppercase tracking-wider text-(--color-fg-muted) shrink-0 w-10"
      : "text-[9px] uppercase tracking-wider text-(--color-fg-muted)";

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

export const MANIFEST: Pick<DockPanelDef, "id" | "title" | "icon"> = {
  id: "selection-info",
  title: "Selection Info",
  icon: <Crosshair size={12} />,
};

export default SelectionInfoPanel;

import React from "react";
import {
  Square,
  LayoutGrid,
  PanelTop,
  Lightbulb,
  Boxes,
  MousePointer2,
  Move,
  Paintbrush,
  Pipette,
  Eraser,
} from "lucide-react";
import { SegmentedControl, ToggleSwitch, Tooltip } from "../components/ui/index";
import { cn } from "../lib/cn";

/**
 * MapToolbar — R4b → #246 redesign of the Scene tab's tool palette.
 *
 * Two-row strip mounted directly below the shell PrimaryTabs and above
 * the Scene view body (the EditorViewport + right rail). Per
 * `docs/plans/EDITOR_REDESIGN.md` §7.2 + the #246 dispatch:
 *
 *     +-----------------------------------------------------------+
 *     | Row 1 — Layers  [Walls][Floors][Ceiling][Lighting][Entities]
 *     | Row 2 — Tools   [Select][Paint][Eyedropper][Erase]
 *     +-----------------------------------------------------------+
 *
 * The two rows are **mutually exclusive** — picking a layer scopes
 * everything below (which cells the user reads / edits, which preset
 * palette is active); picking a tool decides what the user *does* when
 * they click a cell.
 *
 * Default tool = `select` — clicking a cell pushes it into the right-
 * rail Cell Inspector WITHOUT mutating the scene. This is the core
 * unblock for cell inspection (#246) — the old editor only had a paint
 * tool, so the only way to inspect a cell was to paint over it.
 *
 * WIRING: layer + tool state lives on `MapView`, not in this component
 * (the GridEditor reads the same state so the canvas stays in lockstep
 * with the toolbar). This component is a controlled SegmentedControl
 * pair — the parent owns the values and onChange callbacks.
 */

export type MapLayer =
  | "walls"
  | "floors"
  | "ceiling"
  | "lighting"
  | "entities";

export type MapTool = "select" | "move" | "paint" | "eyedropper" | "erase";

export interface MapToolbarProps {
  layer: MapLayer;
  onLayerChange: (next: MapLayer) => void;
  tool: MapTool;
  onToolChange: (next: MapTool) => void;
  /**
   * Snap-to-grid toggle — controls drag behaviour for the `move` tool
   * (and future entity-drag affordances under the `select` tool). When
   * enabled, dragged entities / lights snap to the centre of the cell
   * under the cursor; when disabled, positions are continuous floats.
   *
   * Persisted at the MapView level via `useLocalStorage`. The toggle is
   * only rendered when the active tool is `move` OR `select` — paint /
   * eyedropper / erase always operate per-cell, so the snap concept is
   * meaningless there.
   */
  snapToGrid: boolean;
  onSnapToGridChange: (next: boolean) => void;
  className?: string;
}

interface SegmentDescriptor<T extends string> {
  id: T;
  label: string;
  icon: React.ReactNode;
  tooltip: string;
}

// Icon size matches the SegmentedControl `md` row height (h-9) and the
// shell PrimaryTabs icon scale. The 14px choice is shared with TabStrip
// for visual consistency.
const ICON_SIZE = 14;

const LAYER_OPTIONS: ReadonlyArray<SegmentDescriptor<MapLayer>> = [
  {
    id: "walls",
    label: "Walls",
    icon: <Square size={ICON_SIZE} />,
    tooltip: "Edit / inspect the walls layer (W)",
  },
  {
    id: "floors",
    label: "Floors",
    icon: <LayoutGrid size={ICON_SIZE} />,
    tooltip: "Edit / inspect the floors layer (F)",
  },
  {
    id: "ceiling",
    label: "Ceiling",
    icon: <PanelTop size={ICON_SIZE} />,
    tooltip: "Edit / inspect the ceiling layer (C)",
  },
  {
    id: "lighting",
    label: "Lighting",
    icon: <Lightbulb size={ICON_SIZE} />,
    tooltip: "Lighting layer — select existing lights or place new ones",
  },
  {
    id: "entities",
    label: "Entities",
    icon: <Boxes size={ICON_SIZE} />,
    tooltip: "Entities layer — select existing entities or place new ones",
  },
];

const TOOL_OPTIONS: ReadonlyArray<SegmentDescriptor<MapTool>> = [
  {
    id: "select",
    label: "Select",
    icon: <MousePointer2 size={ICON_SIZE} />,
    tooltip: "Select a cell (no mutation) — pipes it into the Cell Inspector",
  },
  {
    id: "move",
    label: "Move",
    icon: <Move size={ICON_SIZE} />,
    tooltip: "Click + drag to move entities or lights on the active layer",
  },
  {
    id: "paint",
    label: "Paint",
    icon: <Paintbrush size={ICON_SIZE} />,
    tooltip: "Paint the active preset onto clicked cells (P)",
  },
  {
    id: "eyedropper",
    label: "Eyedropper",
    icon: <Pipette size={ICON_SIZE} />,
    tooltip: "Adopt the clicked cell's preset as the active palette preset",
  },
  {
    id: "erase",
    label: "Erase",
    icon: <Eraser size={ICON_SIZE} />,
    tooltip: "Clear the clicked cell on the active layer",
  },
];

export function MapToolbar({
  layer,
  onLayerChange,
  tool,
  onToolChange,
  snapToGrid,
  onSnapToGridChange,
  className,
}: MapToolbarProps) {
  // Snap-to-grid is only meaningful for the drag-capable tools. Paint /
  // eyedropper / erase already operate per-cell, so the toggle would
  // be a no-op there.
  const snapVisible = tool === "move" || tool === "select";
  // Per user feedback (post-#284): collapse the two rows into a SINGLE
  // row with Tools on the left, Layers on the right. `justify-between`
  // pushes them to opposite edges; the segmented controls stay their
  // natural width.
  return (
    <div
      className={cn(
        "flex items-center justify-between gap-4 px-3 py-2",
        "border-b border-zinc-800 bg-zinc-950/60",
        className,
      )}
    >
      <div className="flex items-center gap-2">
        <span className="text-[10px] uppercase tracking-wide text-zinc-500 shrink-0">
          Tool
        </span>
        <SegmentedControl<MapTool>
          aria-label="Active map tool"
          size="md"
          value={tool}
          onChange={(next) => {
            if (next !== null) onToolChange(next);
          }}
          options={TOOL_OPTIONS.map((o) => ({
            id: o.id,
            label: (
              <span
                title={o.tooltip}
                aria-label={o.tooltip}
                className="inline-flex items-center gap-1.5"
              >
                {o.icon}
                <span>{o.label}</span>
              </span>
            ),
          }))}
        />
        {snapVisible ? (
          <Tooltip content="Snap to grid (entities + lights drag)">
            <span className="inline-flex items-center">
              <ToggleSwitch
                aria-label="Snap to grid"
                checked={snapToGrid}
                onChange={onSnapToGridChange}
                size="sm"
              />
              <span className="text-[10px] uppercase tracking-wide text-zinc-500 ml-1">
                Snap
              </span>
            </span>
          </Tooltip>
        ) : null}
      </div>
      <div className="flex items-center gap-2">
        <span className="text-[10px] uppercase tracking-wide text-zinc-500 shrink-0">
          Layer
        </span>
        <SegmentedControl<MapLayer>
          aria-label="Active map layer"
          size="md"
          value={layer}
          onChange={(next) => {
            if (next !== null) onLayerChange(next);
          }}
          options={LAYER_OPTIONS.map((o) => ({
            id: o.id,
            label: (
              <span
                title={o.tooltip}
                aria-label={o.tooltip}
                className="inline-flex items-center gap-1.5"
              >
                {o.icon}
                <span>{o.label}</span>
              </span>
            ),
          }))}
        />
      </div>
    </div>
  );
}

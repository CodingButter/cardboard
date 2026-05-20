// Phase-1b JSON-driven panel — TSX shell registers commands; the
// visible body is rendered by the host's `<PanelRenderer/>` against
// the bundled JSON spec.
//
// P3 batch B migration. Moved from
// `apps/editor/src/views/scene/panels/SelectionInfoPanel.tsx` into the
// core-editor-pack with no behavioural changes. The JSON spec
// (`selection-info.json`) moves alongside the TSX file.
import React from "react";
import { Crosshair } from "lucide-react";
// Type-only — pack-builder erases at compile time.
import type { DockPanelDef } from "../../../apps/editor/src/components/dock/DockShell";
import type { PanelSpec } from "../../../apps/editor/src/panel-renderer/types";
// Externalised — selection + layer stores are synced singletons with
// BroadcastChannel cross-window sync. Bundling duplicates would write
// to a private copy that never reaches the host's MapCanvas / palette.
import {
  PanelRenderer,
  registerCommand,
  useLayerStore,
  useSelectionStore,
} from "@cardboard/editor-shell";
import {
  MOCK_LAYERS,
  type SelectionInfoRow,
} from "./scene-fixtures";
// Bun bundles JSON imports inline — the spec ships as a literal in
// the compiled pack-script bundle.
import selectionInfoSpecJson from "./selection-info.json";

const SELECTION_INFO_SPEC = selectionInfoSpecJson as PanelSpec;

/** Format a continuous cursor position for the clipboard payload. */
function formatPositionForCopy(pos: { x: number; y: number } | null): string {
  if (!pos) return "—";
  return `(${pos.x.toFixed(2)}, ${pos.y.toFixed(2)})`;
}

/** Format a hovered cell for the clipboard payload. */
function formatCellForCopy(cell: { x: number; y: number } | null): string {
  if (!cell) return "—";
  return `(${cell.x}, ${cell.y})`;
}

/** Summary phrase for the current selection. */
function formatSelectionForCopy(
  selected: { x: number; y: number } | null,
): string {
  return selected ? "1 cell" : "0 cells";
}

/** Compute the multi-line clipboard payload from current store state. */
function snapshotInfo(): SelectionInfoRow {
  const sel = useSelectionStore.getState();
  const layer = useLayerStore.getState();
  let layerName = layer.activeId || "—";
  for (const l of MOCK_LAYERS) {
    if (l.id === layer.activeId) {
      layerName = l.name;
      break;
    }
  }
  for (const c of layer.customLayers) {
    if (c.id === layer.activeId) {
      layerName = c.name;
      break;
    }
  }
  return {
    position: formatPositionForCopy(sel.cursor),
    cell: formatCellForCopy(sel.hover),
    layer: layerName,
    selection: formatSelectionForCopy(sel.selected),
  };
}

function formatClipboard(info: SelectionInfoRow): string {
  return [
    `Position: ${info.position}`,
    `Cell: ${info.cell}`,
    `Layer: ${info.layer}`,
    `Selection: ${info.selection}`,
  ].join("\n");
}

/**
 * Status-bar Selection Info panel — JSON-driven body, TSX-driven
 * command registrations. The visible content is rendered through the
 * host's `<PanelRenderer/>` from the imported spec; the commands the
 * panel contributes to the registry stay in TSX until the editor
 * command model supports declarative registration from JSON.
 */
export function SelectionInfoPanel(): React.JSX.Element {
  // Each command's `run` is a small closure over the live store
  // state — no panel-local React state is involved, so the handlers
  // are stable for the lifetime of the panel and can register once.
  React.useEffect(() => {
    const unregs = [
      registerCommand({
        id: "scene.selection.copy",
        title: "Copy Selection Info",
        category: "Selection",
        keywords: [
          "copy",
          "selection",
          "clipboard",
          "info",
          "position",
          "cell",
        ],
        run: () => {
          const text = formatClipboard(snapshotInfo());
          try {
            if (
              typeof navigator !== "undefined" &&
              navigator.clipboard?.writeText
            ) {
              void navigator.clipboard.writeText(text);
              return;
            }
          } catch {
            /* fall through to log */
          }
          // Fallback — surface the payload for debugging when the
          // clipboard API isn't available (non-secure context, jsdom).
          console.log("[selection.copy]\n" + text);
        },
      }),
      registerCommand({
        id: "scene.selection.clear",
        title: "Clear Selection",
        category: "Selection",
        keywords: ["clear", "deselect", "selection"],
        run: () => {
          useSelectionStore.getState().select(null);
        },
      }),
      registerCommand({
        id: "scene.selection.invert",
        title: "Invert Selection",
        category: "Selection",
        keywords: ["invert", "flip", "selection"],
        run: () => {
          console.log("[selection.invert] (stub) invert current selection");
        },
      }),
      registerCommand({
        id: "scene.selection.selectAll",
        title: "Select All",
        category: "Selection",
        keywords: ["select", "all", "everything"],
        keybinding: "Ctrl+A",
        run: () => {
          console.log(
            "[selection.selectAll] (stub) select all cells on layer",
          );
        },
      }),
    ];
    return () => unregs.forEach((u) => u());
  }, []);

  return <PanelRenderer spec={SELECTION_INFO_SPEC} />;
}

export const MANIFEST: Pick<DockPanelDef, "id" | "title" | "icon" | "category"> = {
  id: "selection-info",
  title: "Selection Info",
  category: "Inspector",
  icon: <Crosshair size={12} />,
};

export default SelectionInfoPanel;

import React from "react";
import { Brush } from "lucide-react";
import type { DockPanelDef } from "../../../components/dock/DockShell";

/**
 * BrushPanel — brush kind + size / shape / falloff controls.
 *
 * Visual target: the BRUSH dropdown + slider stack that lived inside
 * the leftmost column of `Editor Design/Map.png`, right under the
 * TOOLS row. Split off from the legacy `ToolsPanel` so brush authoring
 * can dock independently. Wave 2 wires this to the editor's active
 * brush state.
 */
export function BrushPanel(): React.JSX.Element {
  return <div data-panel="brush" className="h-full w-full" />;
}

export const MANIFEST: Pick<DockPanelDef, "id" | "title" | "icon"> = {
  id: "brush",
  title: "Brush",
  icon: <Brush size={12} />,
};

export default BrushPanel;

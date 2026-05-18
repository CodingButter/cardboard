import React from "react";
import { Hammer } from "lucide-react";
import type { DockPanelDef } from "../../../components/dock/DockShell";

/**
 * ToolPalettePanel — primary tool picker (Select / Paint / Eraser /
 * Eye Dropper / Fill / Entity Place) plus per-tool sub-tool reveals.
 *
 * Visual target: the TOOLS eyebrow + edit-mode icon row that
 * dominated the top of the leftmost column in `Editor Design/Map.png`.
 * Split off from the legacy `ToolsPanel`; sub-categories Brush, Tile
 * Presets, and Layers each live in their own dock panel now. Wave 2
 * wires the active tool + per-tool sub-tool persistence into the
 * editor's tool store.
 */
export function ToolPalettePanel(): React.JSX.Element {
  return <div data-panel="tool-palette" className="h-full w-full" />;
}

export const MANIFEST: Pick<DockPanelDef, "id" | "title" | "icon"> = {
  id: "tool-palette",
  title: "Tools",
  icon: <Hammer size={12} />,
};

export default ToolPalettePanel;

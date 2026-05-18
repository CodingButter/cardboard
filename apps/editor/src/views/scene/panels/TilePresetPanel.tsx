import React from "react";
import { Boxes } from "lucide-react";
import type { DockPanelDef } from "../../../components/dock/DockShell";

/**
 * TilePresetPanel — categorised tile preset picker (walls / floors /
 * ceilings / decor).
 *
 * Visual target: the TILE TYPES grid card in the leftmost column of
 * `Editor Design/Map.png`, with a category tab strip across the top
 * and a scrollable thumbnail grid below. Split off from the legacy
 * `ToolsPanel`; see `docs/plans/TILE_PRESETS.md` for the long-form
 * spec. Wave 2 wires this to the pack's tile-preset registry.
 */
export function TilePresetPanel(): React.JSX.Element {
  return <div data-panel="tile-preset" className="h-full w-full" />;
}

export const MANIFEST: Pick<DockPanelDef, "id" | "title" | "icon"> = {
  id: "tile-preset",
  title: "Tile Presets",
  icon: <Boxes size={12} />,
};

export default TilePresetPanel;

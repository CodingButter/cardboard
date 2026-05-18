import React from "react";
import { Wrench } from "lucide-react";
import type { DockPanelDef } from "../../../components/dock/DockShell";

/**
 * ToolsPanel — Scene-page brush/palette/tags surface.
 *
 * Visual target: the leftmost column in `Editor Design/Map.png` —
 * TOOLS eyebrow + edit-mode icon row, BRUSH dropdown, TAGS chip
 * strip, LAYERS terrain checklist. Wave 2 fills the body; this stub
 * lets the orchestrator wire the panel into MapView's registry.
 */
export function ToolsPanel(): React.JSX.Element {
  return <div data-panel="tools" className="h-full w-full" />;
}

export const MANIFEST: Pick<DockPanelDef, "id" | "title" | "icon"> = {
  id: "tools",
  title: "Tools",
  icon: <Wrench size={12} />,
};

export default ToolsPanel;

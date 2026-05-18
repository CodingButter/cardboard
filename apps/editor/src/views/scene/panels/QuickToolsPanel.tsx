import React from "react";
import { Wrench } from "lucide-react";
import type { DockPanelDef } from "../../../components/dock/DockShell";

/**
 * QuickToolsPanel — chip strip of frequently / recently used scene
 * tools.
 *
 * Visual target: the QUICK TOOLS pill row in `Editor Design/Map.png`'s
 * left column. Wave 2 surfaces frequently-used tool shortcuts as
 * one-tap chips and lets the user pin favourites for the current
 * project.
 */
export function QuickToolsPanel(): React.JSX.Element {
  return <div data-panel="quick-tools" className="h-full w-full" />;
}

export const MANIFEST: Pick<DockPanelDef, "id" | "title" | "icon"> = {
  id: "quick-tools",
  title: "Quick Tools",
  icon: <Wrench size={12} />,
};

export default QuickToolsPanel;

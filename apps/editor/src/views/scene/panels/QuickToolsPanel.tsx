import React from "react";
import { Tags } from "lucide-react";
import type { DockPanelDef } from "../../../components/dock/DockShell";

/**
 * QuickTagsPanel — chip strip of recently / frequently used cell tags.
 *
 * Visual target: the TAGS pill row that ran horizontally under the
 * brush controls in `Editor Design/Map.png`'s left column. Wave 2
 * surfaces frequently-applied tags as one-tap chips and lets the user
 * star or pin favourites for the current project.
 */
export function QuickTagsPanel(): React.JSX.Element {
  return <div data-panel="quick-tags" className="h-full w-full" />;
}

export const MANIFEST: Pick<DockPanelDef, "id" | "title" | "icon"> = {
  id: "quick-tags",
  title: "Quick Tags",
  icon: <Tags size={12} />,
};

export default QuickTagsPanel;

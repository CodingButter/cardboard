import React from "react";
import { FileText } from "lucide-react";
import type { DockPanelDef } from "../../../components/dock/DockShell";

/**
 * EntityHeaderPanel — name + description + tag chips for the entity
 * currently being edited.
 *
 * Visual target: the top strip of the center column in
 * `Editor Design/Entities.png` — the "Name / Description / Tags" form
 * row plus the "Edit Entity" affordance. Wave 2 fills the body with
 * the real form inputs; this stub is a placeholder so the Prefabs
 * dock layout can mount the panel during Phase 1.
 */
export function EntityHeaderPanel(): React.JSX.Element {
  return <div data-panel="entity-header" className="h-full w-full" />;
}

export const MANIFEST: Pick<DockPanelDef, "id" | "title" | "icon"> = {
  id: "entity-header",
  title: "Entity Header",
  icon: <FileText size={12} />,
};

export default EntityHeaderPanel;

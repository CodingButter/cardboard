import React from "react";
import { List } from "lucide-react";
import type { DockPanelDef } from "../../../components/dock/DockShell";

/**
 * EntityListPanel — vertical scrollable list of every entity (prefab)
 * defined in the pack.
 *
 * Visual target: the left column "ALL ENTITIES" region of
 * `Editor Design/Entities.png`. Each row renders `[icon] [name]` with
 * the active entity highlighted; category filter chips sit above the
 * list. Wave 2 fills the body with the real list + filter UI; this
 * stub is a placeholder so the Prefabs dock layout can mount the
 * panel during Phase 1.
 */
export function EntityListPanel(): React.JSX.Element {
  return <div data-panel="entity-list" className="h-full w-full" />;
}

export const MANIFEST: Pick<DockPanelDef, "id" | "title" | "icon"> = {
  id: "entity-list",
  title: "Entities",
  icon: <List size={12} />,
};

export default EntityListPanel;

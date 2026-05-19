import React from "react";
import { Upload } from "lucide-react";
import type { DockPanelDef } from "../../../components/dock/DockShell";

/**
 * EntityDropZonePanel — dashed drop-target for importing entity
 * (prefab) definitions from external files.
 *
 * Visual target: the bottom-left "Drag and drop prefab here" region
 * of `Editor Design/Entities.png`. Wave 2 wires the real file-import
 * pipeline (parse + validate + register into the pack); this stub is
 * a placeholder so the Prefabs dock layout can mount the panel during
 * Phase 1.
 */
export function EntityDropZonePanel(): React.JSX.Element {
  return <div data-panel="entity-drop-zone" className="h-full w-full" />;
}

export const MANIFEST: Pick<DockPanelDef, "id" | "title" | "icon"> = {
  id: "entity-drop-zone",
  title: "Drop Zone",
  icon: <Upload size={12} />,
};

export default EntityDropZonePanel;

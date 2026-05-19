import React from "react";
import { Layers } from "lucide-react";
import type { DockPanelDef } from "../../../components/dock/DockShell";

/**
 * ComponentEditorPanel — vertical stack of collapsible component
 * cards for the active entity.
 *
 * Visual target: the main body of the center column in
 * `Editor Design/Entities.png` — one card per `ComponentInstance`
 * (Light / Sprite / Movement / Position / …), each with its own
 * header bar, enable toggle, delete affordance, and per-field
 * controls driven by `COMPONENT_SCHEMAS`. Wave 2 fills the body with
 * the real card stack; this stub is a placeholder so the Prefabs
 * dock layout can mount the panel during Phase 1.
 */
export function ComponentEditorPanel(): React.JSX.Element {
  return <div data-panel="component-editor" className="h-full w-full" />;
}

export const MANIFEST: Pick<DockPanelDef, "id" | "title" | "icon"> = {
  id: "component-editor",
  title: "Components",
  icon: <Layers size={12} />,
};

export default ComponentEditorPanel;

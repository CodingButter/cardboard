import React from "react";
import { Box } from "lucide-react";
import type { DockPanelDef } from "../../../components/dock/DockShell";

/**
 * EntityPreviewPanel — small 3D preview of the SELECTED entity.
 *
 * Visual target: the top-left "PREVIEW" region of
 * `Editor Design/Entities.png`. Mirrors the Scene page's `PreviewPanel`
 * pattern (Three.js scene with a hovering placeholder mesh + light)
 * but bound to the entity currently being edited rather than the
 * scene. Wave 2 fills the body with the real preview scene; this stub
 * is a placeholder so the Prefabs dock layout can mount the panel
 * during Phase 1.
 */
export function EntityPreviewPanel(): React.JSX.Element {
  return <div data-panel="entity-preview" className="h-full w-full" />;
}

export const MANIFEST: Pick<DockPanelDef, "id" | "title" | "icon"> = {
  id: "entity-preview",
  title: "Preview",
  icon: <Box size={12} />,
};

export default EntityPreviewPanel;

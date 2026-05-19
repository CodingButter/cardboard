import React from "react";
import { Braces } from "lucide-react";
import type { DockPanelDef } from "../../../components/dock/DockShell";

/**
 * JsonPreviewPanel — read-only monospace view of the active entity's
 * serialized definition, plus the "Save & Test" affordance.
 *
 * Visual target: the right column of `Editor Design/Entities.png` —
 * the syntax-highlighted JSON block topped by the page-prominent
 * "Save & Test" button. Wave 2 fills the body with the real preview
 * + action button; this stub is a placeholder so the Prefabs dock
 * layout can mount the panel during Phase 1.
 */
export function JsonPreviewPanel(): React.JSX.Element {
  return <div data-panel="json-preview" className="h-full w-full" />;
}

export const MANIFEST: Pick<DockPanelDef, "id" | "title" | "icon"> = {
  id: "json-preview",
  title: "JSON",
  icon: <Braces size={12} />,
};

export default JsonPreviewPanel;

import React from "react";
import { Box } from "lucide-react";
import type { DockPanelDef } from "../../../components/dock/DockShell";

/**
 * PreviewPanel — first-person 3D preview of the selected cell.
 *
 * Visual target: the top-right region in `Editor Design/Map.png` —
 * a small rendered viewport showing what the player would see
 * standing at the currently-selected cell. Wave 2 wires this to the
 * engine's preview renderer.
 */
export function PreviewPanel(): React.JSX.Element {
  return <div data-panel="preview" className="h-full w-full" />;
}

export const MANIFEST: Pick<DockPanelDef, "id" | "title" | "icon"> = {
  id: "preview",
  title: "3D Preview",
  icon: <Box size={12} />,
};

export default PreviewPanel;

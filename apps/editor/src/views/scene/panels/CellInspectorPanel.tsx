import React from "react";
import { SlidersHorizontal } from "lucide-react";
import type { DockPanelDef } from "../../../components/dock/DockShell";

/**
 * CellInspectorPanel — per-cell property editor.
 *
 * Visual target: the right column in `Editor Design/Map.png` —
 * Selected-cell name + tags, then Light / Sprite / Movement /
 * Position sections each with their own header + form fields
 * (sliders, toggles, vector inputs). Wave 2 wires this to the
 * scene's currently-selected cell.
 */
export function CellInspectorPanel(): React.JSX.Element {
  return <div data-panel="cell-inspector" className="h-full w-full" />;
}

export const MANIFEST: Pick<DockPanelDef, "id" | "title" | "icon"> = {
  id: "cell-inspector",
  title: "Cell Inspector",
  icon: <SlidersHorizontal size={12} />,
};

export default CellInspectorPanel;

import React from "react";
import { Layers } from "lucide-react";
import type { DockPanelDef } from "../../../components/dock/DockShell";

/**
 * LayersPanel — scene-layer visibility / ordering surface.
 *
 * Visual target: the middle-right card in `Editor Design/Map.png` —
 * a list of layers (Floors / Walls / Doors / Sprites / Lights / etc.)
 * with eye-icon visibility toggles and an "+ Add layer" trailing
 * button. Wave 2 wires this to the scene's layer model.
 */
export function LayersPanel(): React.JSX.Element {
  return <div data-panel="layers" className="h-full w-full" />;
}

export const MANIFEST: Pick<DockPanelDef, "id" | "title" | "icon"> = {
  id: "layers",
  title: "Layers",
  icon: <Layers size={12} />,
};

export default LayersPanel;

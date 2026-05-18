import React from "react";
import { Map as MapIcon } from "lucide-react";
import type { DockPanelDef } from "../../../components/dock/DockShell";

/**
 * MapCanvasPanel — the Scene page's primary canvas.
 *
 * Visual target: the centre region in `Editor Design/Map.png` — a
 * grid-rendered top-down map view with selectable cells. Wave 2 will
 * mount the actual raycaster grid canvas + selection handlers; this
 * stub gives the orchestrator a panel id to wire.
 */
export function MapCanvasPanel(): React.JSX.Element {
  return <div data-panel="map-canvas" className="h-full w-full" />;
}

export const MANIFEST: Pick<DockPanelDef, "id" | "title" | "icon"> = {
  id: "map-canvas",
  title: "Map",
  icon: <MapIcon size={12} />,
};

export default MapCanvasPanel;

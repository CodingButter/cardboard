import React from "react";
import { Map as MapIcon } from "lucide-react";
import type { DockPanelDef } from "../../../components/dock/DockShell";
import { MapCanvasOverlay } from "../MapCanvasOverlay";

/**
 * MapCanvasPanel — the Scene page's primary canvas.
 *
 * Visual target: the centre region in `Editor Design/Map.png` — a
 * grid-rendered top-down map view with selectable cells. Wave 2 will
 * mount the actual raycaster grid canvas + selection handlers; this
 * stub gives the orchestrator a panel id to wire.
 *
 * The canvas-overlay HUD (`MapCanvasOverlay`) is a *child* of this
 * panel, not a separate dock entry — see the "Canvas overlay HUD"
 * bullet in the Architecture decisions subsection of
 * `docs/EDITOR_DESIGN_INVENTORY.md` §1.2.
 */
export function MapCanvasPanel(): React.JSX.Element {
  return (
    <div data-panel="map-canvas" className="relative h-full w-full">
      {/* Wave 2: canvas placeholder gets the raycaster grid canvas
       *  mounted here, behind the overlay HUD. */}
      <MapCanvasOverlay />
    </div>
  );
}

export const MANIFEST: Pick<DockPanelDef, "id" | "title" | "icon"> = {
  id: "map-canvas",
  title: "Map",
  icon: <MapIcon size={12} />,
};

export default MapCanvasPanel;

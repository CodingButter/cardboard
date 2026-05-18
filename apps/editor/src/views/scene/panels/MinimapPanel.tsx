import React from "react";
import { Map } from "lucide-react";
import type { DockPanelDef } from "../../../components/dock/DockShell";

/**
 * MinimapPanel — compact overview of the whole scene.
 *
 * Opt-in panel (not part of the default Map.png layout). Renders a
 * down-sampled bird's-eye view of every tile in the active scene with
 * a viewport rectangle overlay reflecting the current MapCanvas
 * camera/zoom. Wave 2 wires the readout to the active scene's tile
 * grid + the canvas viewport state; this stub gives the orchestrator
 * a panel id to register so the panel can be opened from the
 * `DocksModal`.
 */
export function MinimapPanel(): React.JSX.Element {
  return <div data-panel="minimap" className="h-full w-full" />;
}

export const MANIFEST: Pick<DockPanelDef, "id" | "title" | "icon"> = {
  id: "minimap",
  title: "Minimap",
  icon: <Map size={12} />,
};

export default MinimapPanel;

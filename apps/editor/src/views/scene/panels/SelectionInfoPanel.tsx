import React from "react";
import { Crosshair } from "lucide-react";
import type { DockPanelDef } from "../../../components/dock/DockShell";

/**
 * SelectionInfoPanel — compact readout of the current
 * cursor / cell / layer / selection state.
 *
 * Visual target: the small status block in the bottom-centre of
 * `Editor Design/Map.png`, sitting next to the Status Console — shows
 * cursor world position, hovered cell coords, active layer name, and
 * the current selection size. Wave 2 wires this to the editor's
 * selection + pointer state.
 */
export function SelectionInfoPanel(): React.JSX.Element {
  return <div data-panel="selection-info" className="h-full w-full" />;
}

export const MANIFEST: Pick<DockPanelDef, "id" | "title" | "icon"> = {
  id: "selection-info",
  title: "Selection Info",
  icon: <Crosshair size={12} />,
};

export default SelectionInfoPanel;

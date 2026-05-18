import React from "react";
import { Sun } from "lucide-react";
import type { DockPanelDef } from "../../../components/dock/DockShell";

/**
 * LightingPanel — global lighting controls for the active scene.
 *
 * Opt-in panel (not part of the default Map.png layout). Edits the
 * scene-level environment: ambient colour/intensity, fog density,
 * fog colour, and sun direction. Per
 * `docs/plans/LIGHTING_ENTITIES_REFACTOR.md` individual lights are
 * first-class entities edited in the Cell Inspector — this panel
 * scopes only to the global env values that don't belong to any one
 * cell.
 */
export function LightingPanel(): React.JSX.Element {
  return <div data-panel="lighting" className="h-full w-full" />;
}

export const MANIFEST: Pick<DockPanelDef, "id" | "title" | "icon"> = {
  id: "lighting",
  title: "Lighting",
  icon: <Sun size={12} />,
};

export default LightingPanel;

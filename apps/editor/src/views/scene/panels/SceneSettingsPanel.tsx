import React from "react";
import { Settings } from "lucide-react";
import type { DockPanelDef } from "../../../components/dock/DockShell";

/**
 * SceneSettingsPanel — per-scene metadata + global render knobs.
 *
 * Visual target: the bottom card of the right column in
 * `Editor Design/Map.png` — scene name, grid dimensions, fog density,
 * ambient light slider, and other scene-level globals. Wave 2 wires
 * this to the active scene's settings object.
 */
export function SceneSettingsPanel(): React.JSX.Element {
  return <div data-panel="scene-settings" className="h-full w-full" />;
}

export const MANIFEST: Pick<DockPanelDef, "id" | "title" | "icon"> = {
  id: "scene-settings",
  title: "Scene Settings",
  icon: <Settings size={12} />,
};

export default SceneSettingsPanel;

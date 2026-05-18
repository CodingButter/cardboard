import React from "react";
import { Boxes } from "lucide-react";
import type { DockPanelDef } from "../../../components/dock/DockShell";

/**
 * PrefabBrowserPanel — browse + drag-drop prefab instances.
 *
 * Opt-in panel (not part of the default Map.png layout). Lists every
 * prefab defined in the active pack chain; filterable by
 * category/tag. In Entity mode the user drags a prefab card onto the
 * canvas to instantiate it. Wave 2 wires this to the pack registry's
 * prefab table and the canvas drop handler.
 */
export function PrefabBrowserPanel(): React.JSX.Element {
  return <div data-panel="prefab-browser" className="h-full w-full" />;
}

export const MANIFEST: Pick<DockPanelDef, "id" | "title" | "icon"> = {
  id: "prefab-browser",
  title: "Prefabs",
  icon: <Boxes size={12} />,
};

export default PrefabBrowserPanel;

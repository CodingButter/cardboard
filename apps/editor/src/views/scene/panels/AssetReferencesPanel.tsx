import React from "react";
import { Link } from "lucide-react";
import type { DockPanelDef } from "../../../components/dock/DockShell";

/**
 * AssetReferencesPanel — assets referenced by the current selection.
 *
 * Opt-in panel (not part of the default Map.png layout). For the
 * currently-selected cell or entity, lists every asset it references
 * (textures, sprites, sounds, scripts) with click-through links to
 * the source asset's editor surface. Wave 2 wires this to the
 * selection store + the pack asset resolver.
 */
export function AssetReferencesPanel(): React.JSX.Element {
  return <div data-panel="asset-references" className="h-full w-full" />;
}

export const MANIFEST: Pick<DockPanelDef, "id" | "title" | "icon"> = {
  id: "asset-references",
  title: "References",
  icon: <Link size={12} />,
};

export default AssetReferencesPanel;

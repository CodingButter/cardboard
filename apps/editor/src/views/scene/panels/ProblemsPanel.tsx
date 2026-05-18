import React from "react";
import { AlertCircle } from "lucide-react";
import type { DockPanelDef } from "../../../components/dock/DockShell";

/**
 * ProblemsPanel — diagnostics surface for the active scene.
 *
 * Visual target: the bottom-group "Problems" tab in `Editor Design/Map.png`.
 * Lists validation issues, broken refs, lint warnings, and other structured
 * editor diagnostics with jump-to-source affordances. Wave 2 wires this to
 * the scene validator + reference resolver. Sibling to `OutputPanel`, which
 * carries the raw engine/build log stream.
 */
export function ProblemsPanel(): React.JSX.Element {
  return <div data-panel="problems" className="h-full w-full" />;
}

export const MANIFEST: Pick<DockPanelDef, "id" | "title" | "icon"> = {
  id: "problems",
  title: "Problems",
  icon: <AlertCircle size={12} />,
};

export default ProblemsPanel;

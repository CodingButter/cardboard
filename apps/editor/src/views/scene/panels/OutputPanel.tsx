import React from "react";
import { Terminal } from "lucide-react";
import type { DockPanelDef } from "../../../components/dock/DockShell";

/**
 * OutputPanel — log-stream surface for engine and build output.
 *
 * Visual target: the bottom-group "Output" tab in `Editor Design/Map.png`.
 * Wave 2 wires this to the editor's diagnostic bus + engine console (paint
 * conflicts, autosave ticks, build/transpile output, etc.). Paired with
 * `ProblemsPanel` — Output is the raw stream, Problems is the structured
 * diagnostics view.
 */
export function OutputPanel(): React.JSX.Element {
  return <div data-panel="output" className="h-full w-full" />;
}

export const MANIFEST: Pick<DockPanelDef, "id" | "title" | "icon"> = {
  id: "output",
  title: "Output",
  icon: <Terminal size={12} />,
};

export default OutputPanel;

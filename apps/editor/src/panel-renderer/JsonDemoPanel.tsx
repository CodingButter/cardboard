import React from "react";
import { FileJson } from "lucide-react";
import type { DockPanelDef } from "../components/dock/DockShell";
import { registerCommand } from "../state/useCommandStore";
import { useSelectionStore } from "../state/useSelectionStore";
import { PanelRenderer } from "./PanelRenderer";
import demoSpec from "./test-panels/demo-selection-info.json";
import type { PanelSpec } from "./types";

/**
 * JsonDemoPanel — the JSON-renderer Phase 0 demo wired as a real
 * `DockPanelDef`. This is the proof-of-concept that the JSON spec
 * format CAN substitute for a hand-written `.tsx` panel: the file
 * declares no JSX of its own, the body is a `<PanelRenderer>` with
 * the imported JSON spec.
 *
 * Until Phase 2 migrates production panels to JSON, this lives
 * alongside the real panels purely as a discoverability + smoke-test
 * surface. It registers in the Scene workspace's dock-add modal
 * under the Inspector category so the user can dock it next to
 * SelectionInfoPanel and compare.
 *
 * Separate from `DemoRoute.tsx` — that one mounts the same spec
 * standalone at `?renderer-demo` (bypassing the EditorShell). This
 * one mounts as a normal dockview panel.
 */

export function JsonDemoPanel(): React.JSX.Element {
  // The demo's "Clear" button references the `demo.selection.clear`
  // command. The legacy DemoRoute registered it; we register it here
  // too so the panel works regardless of whether the demo route has
  // been visited in this session.
  React.useEffect(() => {
    return registerCommand({
      id: "demo.selection.clear",
      title: "Demo: Clear Selection",
      category: "View",
      run: () => {
        useSelectionStore.getState().select(null);
      },
    });
  }, []);

  return <PanelRenderer spec={demoSpec as PanelSpec} />;
}

export const MANIFEST: Pick<DockPanelDef, "id" | "title" | "icon" | "category"> = {
  id: "json-demo-selection-info",
  title: "JSON: Selection Info",
  category: "Inspector",
  icon: <FileJson size={12} />,
};

export default JsonDemoPanel;

import React from "react";
import { History } from "lucide-react";
import type { DockPanelDef } from "../../../components/dock/DockShell";

/**
 * HistoryPanel — undo/redo timeline + named snapshots.
 *
 * Opt-in panel (not part of the default Map.png layout). Lists recent
 * scene edits in reverse-chronological order with restore buttons,
 * plus a named-snapshot section for "save this state, I'll be back".
 * Wave 2 wires this to the editor's undo stack and the project-level
 * snapshot store.
 */
export function HistoryPanel(): React.JSX.Element {
  return <div data-panel="history" className="h-full w-full" />;
}

export const MANIFEST: Pick<DockPanelDef, "id" | "title" | "icon"> = {
  id: "history",
  title: "History",
  icon: <History size={12} />,
};

export default HistoryPanel;

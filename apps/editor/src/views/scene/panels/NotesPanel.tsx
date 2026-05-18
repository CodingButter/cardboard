import React from "react";
import { StickyNote } from "lucide-react";
import type { DockPanelDef } from "../../../components/dock/DockShell";

/**
 * NotesPanel — designer scratchpad for the active scene.
 *
 * Opt-in panel (not part of the default Map.png layout). Holds
 * scene-local Markdown notes, pinned TODO markers, and free-form
 * "what was I doing here?" reminders. Persists with the scene file
 * so a designer returning days later can pick up where they left
 * off. Wave 2 wires this to the scene document's `notes` field.
 */
export function NotesPanel(): React.JSX.Element {
  return <div data-panel="notes" className="h-full w-full" />;
}

export const MANIFEST: Pick<DockPanelDef, "id" | "title" | "icon"> = {
  id: "notes",
  title: "Notes",
  icon: <StickyNote size={12} />,
};

export default NotesPanel;

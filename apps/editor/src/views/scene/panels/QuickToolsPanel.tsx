// Wave 3.4 — TSX → JSON migration.
//
// QuickToolsPanel is now rendered from a JSON PanelSpec via
// `<PanelRenderer/>`. This file is the thin TSX host that:
//
//   1. Imports the JSON spec from `panel-renderer/specs/quick-tools.json`.
//   2. Registers the static `scene.quickTools.clear` command + a
//      `scene.quickTools.tag.toggle.<id>` per MOCK_QUICK_TOOLS entry.
//   3. Exports the same MANIFEST shape MapView consumes.
//
// The visible body (eyebrow header + applied-count badge + Clear button
// + chip wrap) is fully expressed in JSON. Active state is computed by
// the renderer's `ToggleButton.activeWhenContains` discriminant against
// `store.scene.cells[selected].tags`; disabled state by
// `disabledWhen.isNullish` against `store.selection.selected`. The
// header conditionally swaps between "Quick Tools (N)" and "Quick
// Tools — select a cell" via two `Conditional` nodes gated on
// `selected` and `equals: null` respectively.
//
// Width-based tiny "Resize panel" fallback (<110px) is NOT migrated —
// the JSON renderer has no panel-width reactive context yet. Same gap
// as BrushPanel — flagged in the deliverable report. The chip wrap
// uses `flex-wrap` so chips reflow naturally at narrow widths instead
// of forcing a horizontal scrollbar.
//
// State source: Wave 3.3 — reads tags from `useSceneStore.cells[key]`
// keyed by the selected coord, writes via `toggleCellTag` from inside
// the registered commands.
import React from "react";
import { Wrench } from "lucide-react";
import type { DockPanelDef } from "../../../components/dock/DockShell";
import { registerCommand } from "../../../state/useCommandStore";
import { useSelectionStore } from "../../../state/useSelectionStore";
import { useSceneStore, cellKey } from "../../../state/useSceneStore";
import { PanelRenderer } from "../../../panel-renderer/PanelRenderer";
import type { PanelSpec } from "../../../panel-renderer/types";
import { MOCK_QUICK_TOOLS, type QuickToolRow } from "../scene-fixtures";
import quickToolsSpecJson from "../../../panel-renderer/specs/quick-tools.json";

const QUICK_TOOLS_SPEC = quickToolsSpecJson as PanelSpec;

/**
 * JSON-driven quick-tools panel — TSX shell only owns command
 * registration. Everything visible lives in the imported JSON spec,
 * rendered through `<PanelRenderer/>`.
 */
export function QuickToolsPanel(): React.JSX.Element {
  // Static "clear all" command. Registered once on mount. Reads the
  // current selection + cell tags at invoke time via getState() — no
  // closure-ref dance needed because the command body looks up live
  // state every call.
  React.useEffect(() => {
    const unreg = registerCommand({
      id: "scene.quickTools.clear",
      title: "Clear All Quick-Tools",
      category: "Quick-Tool",
      keywords: ["quick", "tool", "clear", "reset", "tags"],
      run: () => {
        const sel = useSelectionStore.getState().selected;
        if (!sel) return;
        const key = cellKey(sel.x, sel.y);
        const cur = useSceneStore.getState().cells[key]?.tags ?? [];
        // Only toggle quick-tool tags — leave user-added tags from the
        // CellInspector untouched. Otherwise this "clear all" would
        // also wipe tags the panel never surfaced as chips.
        const quickIds = new Set<string>(
          (MOCK_QUICK_TOOLS as readonly QuickToolRow[]).map((t) => t.id),
        );
        const toggle = useSceneStore.getState().toggleCellTag;
        for (const tag of cur) {
          if (quickIds.has(tag)) toggle(sel.x, sel.y, tag);
        }
      },
    });
    return unreg;
  }, []);

  // Dynamic per-quick-tool toggle commands. Each chip's onClick
  // script-ref in the JSON spec resolves to one of these. The body
  // is a no-op when nothing is selected — the JSON chip is already
  // visually disabled in that state, but commands can also fire via
  // the palette / keybindings, so the guard lives here too.
  React.useEffect(() => {
    const unregs = (MOCK_QUICK_TOOLS as readonly QuickToolRow[]).map((t) =>
      registerCommand({
        id: `scene.quickTools.tag.toggle.${t.id}`,
        title: `Toggle Quick-Tool: ${t.name}`,
        category: "Quick-Tool",
        keywords: ["quick", "tool", "toggle", "tag", t.name, t.id],
        description: t.description,
        run: () => {
          const sel = useSelectionStore.getState().selected;
          if (!sel) return;
          useSceneStore.getState().toggleCellTag(sel.x, sel.y, t.id);
        },
      }),
    );
    return () => {
      for (const u of unregs) u();
    };
  }, []);

  return <PanelRenderer spec={QUICK_TOOLS_SPEC} />;
}

export const MANIFEST: Pick<DockPanelDef, "id" | "title" | "icon" | "category"> = {
  id: "quick-tools",
  title: "Quick Tools",
  category: "Tools",
  icon: <Wrench size={12} />,
};

export default QuickToolsPanel;

// Phase-1b JSON-driven panel — TSX shell registers commands; the
// visible body is rendered by the host's `<PanelRenderer/>` against
// the bundled JSON spec.
//
// P3 batch B migration. Moved from
// `apps/editor/src/views/scene/panels/QuickToolsPanel.tsx` into the
// core-editor-pack with no behavioural changes. The JSON spec moves
// alongside the TSX file — `quick-tools.json` now lives in this
// directory rather than `apps/editor/src/panel-renderer/specs/`.
// Subsequent P4 work will see the shell's `specs/` directory empty
// out as every JSON spec migrates with its TSX counterpart.
import React from "react";
import { Wrench } from "lucide-react";
// Type-only — pack-builder erases at compile time.
import type { DockPanelDef } from "../../../apps/editor/src/components/dock/DockShell";
import type { PanelSpec } from "../../../apps/editor/src/panel-renderer/types";
// Externalised — same singleton story as the other Wave-3 stores. The
// renderer reads/writes them via the binding resolver, so the pack
// MUST run against the host's React + the host's store instances.
// `cellKey` is the canonical coord-key format the scene store uses;
// using the helper rather than hand-formatting `${x},${y}` shields the
// pack from any future format change in a single shared place.
import {
  PanelRenderer,
  cellKey,
  registerCommand,
  useSceneStore,
  useSelectionStore,
} from "@cardboard/editor-shell";
import { MOCK_QUICK_TOOLS, type QuickToolRow } from "./scene-fixtures";
// Bun bundles JSON imports inline — the spec ships as a literal in
// the compiled pack-script bundle.
import quickToolsSpecJson from "./quick-tools.json";

const QUICK_TOOLS_SPEC = quickToolsSpecJson as PanelSpec;

/**
 * JSON-driven quick-tools panel — TSX shell only owns command
 * registration. Everything visible lives in the imported JSON spec,
 * rendered through the host's `<PanelRenderer/>`.
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

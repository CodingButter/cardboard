// Wave 3.4 — TSX → JSON migration.
//
// ToolPalettePanel is now rendered from a JSON PanelSpec via
// `<PanelRenderer/>`. This file is the thin TSX host that:
//
//   1. Imports the JSON spec from `panel-renderer/specs/tool-palette.json`.
//   2. Registers per-tool + per-sub-tool commands (the JSON spec's
//      ToggleButtons invoke these by id). Each tool gets a
//      `scene.tool.select.<id>` command + each sub-tool a
//      `scene.tool.subTool.select.<parent>.<sub>` command.
//   3. Mirrors the original panel's "default sub-tool" behaviour by
//      initialising `tool.activeSubTool[activeTool]` to the first sub-
//      tool when unset. The original TSX did this implicitly at render
//      time via `resolveSubTool`; the JSON spec binds directly to the
//      store record so the fallback has to live in the store now.
//   4. Exports the same MANIFEST shape MapView consumes.
//
// The visible body (tile grid + sub-tool strip + progressive tooltips)
// is fully expressed in JSON. Sub-tools are enumerated per-tool in the
// spec; right now only "select" has them, but extending the spec is a
// drop-in change when a new tool grows sub-tools.
import React from "react";
import { Hammer } from "lucide-react";
import type { DockPanelDef } from "../../../components/dock/DockShell";
import { registerCommand } from "../../../state/useCommandStore";
import { useToolStore } from "../../../state/useToolStore";
import { PanelRenderer } from "../../../panel-renderer/PanelRenderer";
import type { PanelSpec } from "../../../panel-renderer/types";
import { MOCK_TOOLS, type ToolRow } from "../scene-fixtures";
import toolPaletteSpecJson from "../../../panel-renderer/specs/tool-palette.json";

const TOOL_PALETTE_SPEC = toolPaletteSpecJson as PanelSpec;

/** Initialise the default sub-tool for a given tool when none is set
 *  yet. The original TSX did this implicitly in `resolveSubTool` at
 *  render time; the JSON spec binds directly to the store record so
 *  the fallback has to be materialised into the store. */
function ensureDefaultSubTool(toolId: string): void {
  const tool = (MOCK_TOOLS as readonly ToolRow[]).find((t) => t.id === toolId);
  if (!tool?.subTools || tool.subTools.length === 0) return;
  const store = useToolStore.getState();
  if (store.activeSubTool[toolId]) return;
  const firstSub = tool.subTools[0]?.id;
  if (firstSub) store.setActiveSubTool(toolId, firstSub);
}

/**
 * JSON-driven tool palette — TSX shell only owns command registration
 * + the default-sub-tool fallback. Everything visible lives in the
 * imported JSON spec, rendered through `<PanelRenderer/>`.
 */
export function ToolPalettePanel(): React.JSX.Element {
  // Re-register commands on mount. Each `scene.tool.select.<id>`
  // command activates the tool AND promotes the default sub-tool so
  // the chip strip's pressed state is never blank. Each
  // `scene.tool.subTool.select.<parent>.<sub>` command also activates
  // the parent tool first (matches the original TSX behaviour:
  // invoking a sub-tool from the palette switches to its parent).
  React.useEffect(() => {
    const unregs: Array<() => void> = [];
    for (const t of MOCK_TOOLS as readonly ToolRow[]) {
      unregs.push(
        registerCommand({
          id: `scene.tool.select.${t.id}`,
          title: `Select Tool: ${t.name}`,
          category: "Tool",
          keywords: ["tool", "select", t.name, t.id],
          description: t.description,
          run: () => {
            useToolStore.getState().setActiveTool(t.id);
            ensureDefaultSubTool(t.id);
          },
        }),
      );
      for (const s of t.subTools ?? []) {
        unregs.push(
          registerCommand({
            id: `scene.tool.subTool.select.${t.id}.${s.id}`,
            title: `Sub-Tool: ${t.name} ${s.name}`,
            category: "Tool",
            keywords: ["tool", "sub-tool", "subtool", t.name, s.name, s.id],
            description: t.description,
            run: () => {
              const store = useToolStore.getState();
              store.setActiveTool(t.id);
              store.setActiveSubTool(t.id, s.id);
            },
          }),
        );
      }
    }
    // First-load fallback — make sure the currently-active tool has a
    // visible sub-tool selection so the strip's chip row isn't blank.
    ensureDefaultSubTool(useToolStore.getState().activeTool);
    return () => {
      for (const u of unregs) u();
    };
  }, []);

  return <PanelRenderer spec={TOOL_PALETTE_SPEC} />;
}

export const MANIFEST: Pick<DockPanelDef, "id" | "title" | "icon" | "category"> = {
  id: "tool-palette",
  title: "Tools",
  category: "Tools",
  icon: <Hammer size={12} />,
};

export default ToolPalettePanel;

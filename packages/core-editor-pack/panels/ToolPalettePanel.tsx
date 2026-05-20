// Phase-1b JSON-driven panel — TSX shell registers commands; the
// visible body is rendered by the host's `<PanelRenderer/>` against
// the bundled JSON spec.
//
// P3 batch D migration. Moved from
// `apps/editor/src/views/scene/panels/ToolPalettePanel.tsx` into the
// core-editor-pack with no behavioural changes. The JSON spec moves
// alongside the TSX file — `tool-palette.json` now lives in this
// directory rather than `apps/editor/src/panel-renderer/specs/`. The
// shell-side copy stays until P4 retires it (PanelRenderer.test.ts
// still references it).
//
// The visible body (tile grid + sub-tool strip + progressive tooltips)
// is fully expressed in JSON. Sub-tools are enumerated per-tool in the
// spec; right now only "select" has them, but extending the spec is a
// drop-in change when a new tool grows sub-tools.
import React from "react";
import { Hammer } from "lucide-react";
// Type-only — pack-builder erases at compile time.
import type { DockPanelDef } from "../../../apps/editor/src/components/dock/DockShell";
import type { PanelSpec } from "../../../apps/editor/src/panel-renderer/types";
// Externalised — `useToolStore` is a Wave-3 synced store with a
// per-key BroadcastChannel; the pack MUST read/write through the host
// singleton or it gets an isolated copy with no cross-window sync.
import {
  PanelRenderer,
  registerCommand,
  useToolStore,
} from "@cardboard/editor-shell";
import { MOCK_TOOLS, type ToolRow } from "./scene-fixtures";
// Bun bundles JSON imports inline — the spec ships as a literal in
// the compiled pack-script bundle.
import toolPaletteSpecJson from "./tool-palette.json";

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

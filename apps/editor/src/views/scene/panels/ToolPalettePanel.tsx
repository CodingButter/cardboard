import React from "react";
import {
  Brush,
  Eraser,
  Hammer,
  MousePointer2,
  PaintBucket,
  Pipette,
  PlusSquare,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { DockPanelDef } from "../../../components/dock/DockShell";
import { Tooltip } from "../../../components/ui/Tooltip";
import { ScrollRow } from "../../../components/ui/ScrollRow";
import { registerCommand } from "../../../state/useCommandStore";
import { useToolStore } from "../../../state/useToolStore";
import { MOCK_TOOLS, type ToolRow } from "../scene-fixtures";

/**
 * ToolPalettePanel — primary tool picker (Select / Paint / Eraser /
 * Eye Dropper / Fill / Entity Place) plus per-tool sub-tool reveals.
 *
 * Visual target: the TOOLS eyebrow + edit-mode icon row that
 * dominated the top of the leftmost column in `Editor Design/Map.png`.
 * Tiles render an icon stacked over a small uppercase name label so
 * the affordance is self-describing without needing hover.
 *
 * State source: Wave 3.3 — reads / writes via `useToolStore`. The
 * synced store handles persistence (`cardboard.sync.tool`) and
 * cross-window propagation, so this panel owns no localStorage logic
 * of its own. Sub-tool selection lives at `activeSubTool[toolId]` so
 * each parent tool remembers its own last-picked variant.
 */

/** Lucide icon name → component. Only icons referenced by `MOCK_TOOLS`
 *  are wired here; if `scene-fixtures.ts` grows a new tool icon, add
 *  the entry below. */
const TOOL_ICON_BY_NAME: Record<string, LucideIcon> = {
  MousePointer2,
  Brush,
  Eraser,
  Pipette,
  PaintBucket,
  PlusSquare,
};

function findTool(toolId: string): ToolRow | undefined {
  return (MOCK_TOOLS as readonly ToolRow[]).find((t) => t.id === toolId);
}

/** Pick the displayed sub-tool for `toolId`: prefer the store entry,
 *  fall back to the first defined sub-tool. Returns undefined when the
 *  tool has no sub-tools. Pure — never writes back. */
function resolveSubTool(
  toolId: string,
  stored: Record<string, string>,
): string | undefined {
  const tool = findTool(toolId);
  if (!tool?.subTools || tool.subTools.length === 0) return undefined;
  const hit = stored[toolId];
  if (hit && tool.subTools.some((s) => s.id === hit)) return hit;
  return tool.subTools[0]?.id;
}

export function ToolPalettePanel(): React.JSX.Element {
  // Subscribe to the synced tool store. Each selector returns a stable
  // primitive / record reference so unrelated store changes don't
  // re-render the panel.
  const activeTool = useToolStore((s) => s.activeTool);
  const activeSubToolMap = useToolStore((s) => s.activeSubTool);

  const activeSubTool = React.useMemo(
    () => resolveSubTool(activeTool, activeSubToolMap),
    [activeTool, activeSubToolMap],
  );

  const handleToolClick = React.useCallback((toolId: string) => {
    useToolStore.getState().setActiveTool(toolId);
  }, []);

  const handleSubToolClick = React.useCallback(
    (toolId: string, subToolId: string) => {
      useToolStore.getState().setActiveSubTool(toolId, subToolId);
    },
    [],
  );

  // Dynamic per-tool + per-sub-tool commands. Re-registers when the
  // tool list identity changes; aggregates unregister fns into an
  // array per `state/README.md`'s "Dynamic registrations" pattern.
  // Sub-tool commands auto-activate the parent tool before selecting
  // the sub-tool so invoking e.g. "Sub-Tool: Select Polygon" from
  // the palette also switches the active tool to Select.
  //
  // No closure-ref dance is needed: each command body calls
  // `useToolStore.getState()` directly, so it always reads the live
  // setters from the store.
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
          run: () => useToolStore.getState().setActiveTool(t.id),
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
    return () => {
      for (const u of unregs) u();
    };
    // MOCK_TOOLS is a module-level constant — identity is stable per
    // module load, so empty deps are correct.
  }, []);

  const tool = findTool(activeTool);
  const subTools = tool?.subTools;

  // Outer container is just the `data-panel` hook. DockShell wraps
  // this in `<PanelSurface/>` (raised card with p-2 inner padding)
  // because the MapView registry has `surface: true` by default. So
  // this wrapper only owns layout (flex column + gap between the
  // tool grid and the sub-tool strip), NOT padding.
  //
  // `overflow-y-auto` + `min-h-0` keeps the panel scrollable when the
  // dock leaf is squeezed to a height shorter than the natural tile
  // grid + sub-tool strip stack — Dockview gives panels arbitrary
  // heights and we'd rather scroll than clip.
  return (
    <div
      data-panel="tool-palette"
      className="h-full w-full min-h-0 flex flex-col gap-2 overflow-y-auto"
    >
      {/*
        Fluid tile grid: icon + uppercase name label stacked vertically.
        `auto-fill` + `minmax(54px, 64px)` lets the browser pack the
        widest columns it can fit without leaving phantom empty
        columns. Tiles are taller than wide (~60px) so the label has a
        full line beneath the icon without truncation.
      */}
      <div
        className="grid gap-1"
        style={{
          gridTemplateColumns: "repeat(auto-fill, minmax(54px, 64px))",
        }}
      >
        {MOCK_TOOLS.map((t) => {
          const Icon = TOOL_ICON_BY_NAME[t.icon];
          const active = t.id === activeTool;
          return (
            <Tooltip
              key={t.id}
              side="right"
              stages={[
                { delay: 1000, content: <span>{t.name}</span> },
                {
                  delay: 3000,
                  content: (
                    <div>
                      <div className="font-semibold">{t.name}</div>
                      {t.description && (
                        <div className="text-[10px] text-(--color-fg-muted) mt-1 max-w-[400px] whitespace-normal">
                          {t.description}
                        </div>
                      )}
                    </div>
                  ),
                },
              ]}
            >
              <button
                type="button"
                aria-label={t.name}
                aria-pressed={active}
                onClick={() => handleToolClick(t.id)}
                className={[
                  "w-full h-[60px] rounded",
                  "flex flex-col items-center justify-center gap-1",
                  "border transition-colors",
                  active
                    ? "bg-amber-500 border-amber-500 text-zinc-950"
                    : "bg-transparent border-(--color-border-strong) text-(--color-fg-secondary) hover:border-amber-500/60 hover:text-(--color-fg-primary)",
                ].join(" ")}
              >
                {Icon ? <Icon size={18} aria-hidden="true" /> : null}
                <span className="text-[9px] uppercase tracking-wide leading-none">
                  {t.name}
                </span>
              </button>
            </Tooltip>
          );
        })}
      </div>

      {subTools && subTools.length > 0 ? (
        // Sub-tool strip — single-row horizontal scroller via ScrollRow.
        // Per the project's no-horizontal-scroll-for-categories rule,
        // ScrollRow's hover-area affordance handles overflow at narrow
        // widths so we never render a native horizontal scrollbar and
        // never wrap chips to a second line (which would steal
        // vertical space from the tile grid).
        //
        // Outer wrapper has a fixed height so ScrollRow's
        // `h-full w-full` viewport has a definite size to scroll
        // within (it's positioned `relative` inside a flex column).
        <div className="h-7 shrink-0 pt-1">
          <ScrollRow contentClassName="flex items-center gap-1">
            {subTools.map((s) => {
              const active = s.id === activeSubTool;
              const subDescription = tool?.description
                ? `${s.name} sub-mode of ${tool.name}: ${tool.description}`
                : `${s.name} sub-mode of ${tool?.name ?? "tool"}.`;
              return (
                <Tooltip
                  key={s.id}
                  side="bottom"
                  stages={[
                    { delay: 1000, content: <span>{s.name}</span> },
                    {
                      delay: 3000,
                      content: (
                        <div>
                          <div className="font-semibold">{s.name}</div>
                          <div className="text-[10px] text-(--color-fg-muted) mt-1 max-w-[400px] whitespace-normal">
                            {subDescription}
                          </div>
                        </div>
                      ),
                    },
                  ]}
                >
                  <button
                    type="button"
                    aria-label={s.name}
                    aria-pressed={active}
                    onClick={() => handleSubToolClick(activeTool, s.id)}
                    className={[
                      "shrink-0 rounded-full px-2 py-0.5 text-[9px] uppercase tracking-wide",
                      "border transition-colors",
                      active
                        ? "bg-amber-500 border-amber-500 text-zinc-950"
                        : "bg-transparent border-(--color-border-strong) text-(--color-fg-secondary) hover:border-amber-500/60 hover:text-(--color-fg-primary)",
                    ].join(" ")}
                  >
                    {s.name}
                  </button>
                </Tooltip>
              );
            })}
          </ScrollRow>
        </div>
      ) : null}
    </div>
  );
}

export const MANIFEST: Pick<DockPanelDef, "id" | "title" | "icon" | "category"> = {
  id: "tool-palette",
  title: "Tools",
  category: "Tools",
  icon: <Hammer size={12} />,
};

export default ToolPalettePanel;

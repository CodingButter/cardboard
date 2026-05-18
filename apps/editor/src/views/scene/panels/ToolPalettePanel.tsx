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
import { MOCK_TOOLS, type ToolRow } from "../scene-fixtures";

/**
 * ToolPalettePanel — primary tool picker (Select / Paint / Eraser /
 * Eye Dropper / Fill / Entity Place) plus per-tool sub-tool reveals.
 *
 * Visual target: the TOOLS eyebrow + edit-mode icon row that
 * dominated the top of the leftmost column in `Editor Design/Map.png`.
 * Split off from the legacy `ToolsPanel`; sub-categories Brush, Tile
 * Presets, and Layers each live in their own dock panel now. Wave 2
 * wires the active tool + per-tool sub-tool persistence into the
 * editor's tool store.
 *
 * Persistence contract (shared with sibling Scene panels):
 *   - `cardboard.scene.activeMode`             string, default "map"
 *   - `cardboard.scene.activeTool`             string, default "select"
 *   - `cardboard.scene.activeSubTool.<toolId>` string per tool
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

const LS_ACTIVE_MODE = "cardboard.scene.activeMode";
const LS_ACTIVE_TOOL = "cardboard.scene.activeTool";
const LS_ACTIVE_SUBTOOL_PREFIX = "cardboard.scene.activeSubTool.";

const DEFAULT_TOOL_ID = "select";
const DEFAULT_MODE = "map";

function readLS(key: string): string | null {
  try {
    if (typeof window === "undefined") return null;
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeLS(key: string, value: string): void {
  try {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(key, value);
  } catch {
    /* ignore quota / private-mode failures */
  }
}

function findTool(toolId: string): ToolRow | undefined {
  return (MOCK_TOOLS as readonly ToolRow[]).find((t) => t.id === toolId);
}

/** Pick the persisted sub-tool for `toolId`, falling back to the first
 *  entry in `subTools` if present, else `undefined`. */
function resolveSubTool(toolId: string): string | undefined {
  const tool = findTool(toolId);
  if (!tool?.subTools || tool.subTools.length === 0) return undefined;
  const stored = readLS(LS_ACTIVE_SUBTOOL_PREFIX + toolId);
  if (stored && tool.subTools.some((s) => s.id === stored)) return stored;
  return tool.subTools[0]?.id;
}

export function ToolPalettePanel(): React.JSX.Element {
  // Mode is read-only here; another panel owns the writer.
  const [, setMode] = React.useState<string>(DEFAULT_MODE);

  const [activeTool, setActiveTool] = React.useState<string>(() => {
    const stored = readLS(LS_ACTIVE_TOOL);
    if (stored && findTool(stored)) return stored;
    return DEFAULT_TOOL_ID;
  });

  const [activeSubTool, setActiveSubTool] = React.useState<string | undefined>(
    () => resolveSubTool(
      readLS(LS_ACTIVE_TOOL) && findTool(readLS(LS_ACTIVE_TOOL) as string)
        ? (readLS(LS_ACTIVE_TOOL) as string)
        : DEFAULT_TOOL_ID,
    ),
  );

  // One-shot: hydrate mode from localStorage so future agents that
  // write to LS_ACTIVE_MODE will reflect into this panel on reload.
  React.useEffect(() => {
    const storedMode = readLS(LS_ACTIVE_MODE);
    if (storedMode) setMode(storedMode);
  }, []);

  // Persist active tool whenever it changes.
  React.useEffect(() => {
    writeLS(LS_ACTIVE_TOOL, activeTool);
  }, [activeTool]);

  // Persist active sub-tool whenever it changes (under the current
  // tool's namespaced key).
  React.useEffect(() => {
    if (activeSubTool) {
      writeLS(LS_ACTIVE_SUBTOOL_PREFIX + activeTool, activeSubTool);
    }
  }, [activeTool, activeSubTool]);

  const handleToolClick = React.useCallback((toolId: string) => {
    setActiveTool(toolId);
    setActiveSubTool(resolveSubTool(toolId));
  }, []);

  const handleSubToolClick = React.useCallback((subToolId: string) => {
    setActiveSubTool(subToolId);
  }, []);

  const tool = findTool(activeTool);
  const subTools = tool?.subTools;

  return (
    <div data-panel="tool-palette" className="h-full w-full p-2">
      <div className="h-full w-full bg-(--color-bg-panel-surface) border border-(--color-border-strong) rounded-md p-2 flex flex-col gap-2">
        <div className="grid grid-cols-3 grid-rows-2 gap-1">
          {MOCK_TOOLS.map((t) => {
            const Icon = TOOL_ICON_BY_NAME[t.icon];
            const active = t.id === activeTool;
            return (
              <button
                key={t.id}
                type="button"
                title={t.name}
                aria-pressed={active}
                onClick={() => handleToolClick(t.id)}
                className={[
                  "h-12 w-full rounded",
                  "flex flex-col items-center justify-center gap-0.5",
                  "border transition-colors",
                  active
                    ? "bg-amber-500 border-amber-500 text-zinc-950"
                    : "bg-transparent border-(--color-border-strong) text-(--color-fg-secondary) hover:border-amber-500/60 hover:text-(--color-fg-primary)",
                ].join(" ")}
              >
                {Icon ? <Icon size={14} aria-hidden="true" /> : null}
                <span className="text-[8px] uppercase tracking-wider leading-tight">
                  {t.name}
                </span>
              </button>
            );
          })}
        </div>

        {subTools && subTools.length > 0 ? (
          <div className="flex flex-wrap gap-1 pt-1">
            {subTools.map((s) => {
              const active = s.id === activeSubTool;
              return (
                <button
                  key={s.id}
                  type="button"
                  aria-pressed={active}
                  title={s.name}
                  onClick={() => handleSubToolClick(s.id)}
                  className={[
                    "rounded-full px-2 py-0.5 text-[9px] uppercase tracking-wide",
                    "border transition-colors",
                    active
                      ? "bg-amber-500 border-amber-500 text-zinc-950"
                      : "bg-transparent border-(--color-border-strong) text-(--color-fg-secondary) hover:border-amber-500/60 hover:text-(--color-fg-primary)",
                  ].join(" ")}
                >
                  {s.name}
                </button>
              );
            })}
          </div>
        ) : null}
      </div>
    </div>
  );
}

export const MANIFEST: Pick<DockPanelDef, "id" | "title" | "icon"> = {
  id: "tool-palette",
  title: "Tools",
  icon: <Hammer size={12} />,
};

export default ToolPalettePanel;

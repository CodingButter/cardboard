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

  // Outer container is just the `data-panel` hook. DockShell wraps
  // this in `<PanelSurface/>` (raised card with p-2 inner padding)
  // because the MapView registry has `surface: true` by default. So
  // this wrapper only owns layout (flex column + gap between the
  // tool grid and the sub-tool strip), NOT padding.
  return (
    <div
      data-panel="tool-palette"
      className="h-full w-full flex flex-col gap-2"
    >
      {/*
        Fluid tile grid: `auto-fit` + `minmax(56px, 80px)` lets the
        browser compute column count from available width. Because
        auto-fit prefers the max-width track size (80px) and only
        breaks to another column when one full 80px + gap fits, the
        actual breakpoints (4px gap) work out to:
          • <80px   — 1 col @ panel-width (shrinks min 56→80 per width)
          •  80-164 — 1 col × 6 rows  (vertical)
          • 164-248 — 2 cols × 3 rows
          • 248-332 — 3 cols × 2 rows
          • 332-416 — 4 cols × 2 rows
          • 416-500 — 5 cols × 2 rows
          • 500+    — 6 cols × 1 row  (horizontal)

        ScrollRow note (design decision): we considered wrapping this
        grid in <ScrollRow> as a fallback for sub-56px panel widths,
        but ScrollRow forces `overflow-y: hidden` on its viewport
        which conflicts with this grid's vertical reflow (in narrow
        mode 6 tiles stack to ~480px tall and need vertical space).
        Per the spec's escape hatch, we skip ScrollRow here and rely
        on auto-fit reflow + the panel's own vertical overflow
        behaviour. Sub-56px widths are degenerate (no real horizontal
        scrollbar shown either — the parent dockview cell clips).
      */}
      <div
        className="grid gap-1"
        style={{
          gridTemplateColumns: "repeat(auto-fit, minmax(56px, 80px))",
        }}
      >
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
                "aspect-square w-full rounded",
                "flex flex-col items-center justify-center gap-0.5",
                "border transition-colors",
                active
                  ? "bg-amber-500 border-amber-500 text-zinc-950"
                  : "bg-transparent border-(--color-border-strong) text-(--color-fg-secondary) hover:border-amber-500/60 hover:text-(--color-fg-primary)",
              ].join(" ")}
            >
              {Icon ? <Icon size={14} aria-hidden="true" /> : null}
              <span className="block w-full truncate px-1 text-center text-[8px] uppercase tracking-wider leading-tight">
                {t.name}
              </span>
            </button>
          );
        })}
      </div>

      {subTools && subTools.length > 0 ? (
        // Sub-tool strip uses flex-wrap to flow chips to a second row
        // naturally when the panel is narrow. ScrollRow was considered
        // but skipped for the same reason as the tile grid: its
        // `overflow-y: hidden` would clip a wrapped second row of chips,
        // which is the more common narrow-width scenario than a single
        // chip wider than the panel.
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
  );
}

export const MANIFEST: Pick<DockPanelDef, "id" | "title" | "icon"> = {
  id: "tool-palette",
  title: "Tools",
  icon: <Hammer size={12} />,
};

export default ToolPalettePanel;

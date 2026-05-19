// Wave 3.3 panel migration #8: wired to useSelectionStore (selected cell)
// and useSceneStore (per-cell tags). Each chip toggles a tag on the
// currently-selected cell via `toggleCellTag`. The previous localStorage
// "applied set" is gone — tags now live on the cell itself and are read
// fresh on every render via a keyed selector.
import React from "react";
import { Wrench, X } from "lucide-react";
import type { DockPanelDef } from "../../../components/dock/DockShell";
import { Tooltip } from "../../../components/ui/Tooltip";
import { registerCommand } from "../../../state/useCommandStore";
import { useSelectionStore } from "../../../state/useSelectionStore";
import { useSceneStore, cellKey } from "../../../state/useSceneStore";
import { MOCK_QUICK_TOOLS, type QuickToolRow } from "../scene-fixtures";

/**
 * QuickToolsPanel — chip strip of one-tap tag toggles for the current
 * cell selection.
 *
 * Visual target: the QUICK TOOLS pill row in `Editor Design/Map.png`'s
 * left column. Each chip is a quick-apply tag (solid, door, trigger,
 * spawn, exit, secret, cover, decor, lit, loot). Clicking a chip
 * toggles whether that tag is present on the currently-selected cell.
 *
 * Data flow (Wave 3.3):
 *   - Read selected coord from `useSelectionStore.selected`.
 *   - Read tags ON that cell from `useSceneStore.cells[key].tags`
 *     via a keyed selector so the panel only re-renders when THIS
 *     cell's tag set changes (or when the selection moves).
 *   - Write via `useSceneStore.getState().toggleCellTag(x, y, tag)`.
 *
 * When nothing is selected the chips render disabled — the click
 * handler is a no-op and the chip is dimmed + `aria-disabled`. Same
 * for the eyebrow Clear button.
 *
 * Command-registry contract: every clickable affordance ALSO exists
 * as a runtime-registered command so the command palette + global
 * keybinding handler can drive the same actions. Per-tag toggles are
 * registered dynamically; "clear all" is a single static command.
 */

// Below this width the panel renders a "Resize panel" fallback instead
// of the chip grid. Matches the LayersPanel responsive pattern — a
// ResizeObserver on the root drives the breakpoint flip because
// container queries aren't wired in this codebase's Tailwind setup.
const TINY_WIDTH_PX = 110;

export function QuickToolsPanel(): React.JSX.Element {
  // --- Cross-panel store subscriptions -----------------------------
  // Keep each selector keyed/primitive-ish so this panel does not
  // re-render on every paint elsewhere on the map.
  const selected = useSelectionStore((s) => s.selected);
  // Keyed cell-tag subscription. The selector returns the tags array
  // ref (or undefined) — the store only allocates a NEW array when
  // `toggleCellTag` actually mutates this cell's tags, so unrelated
  // edits don't trigger a re-render here.
  const cellTags = useSceneStore((s) =>
    selected ? s.cells[cellKey(selected.x, selected.y)]?.tags : undefined,
  );

  const applied = React.useMemo<readonly string[]>(
    () => cellTags ?? [],
    [cellTags],
  );
  const appliedCount = applied.length;
  const hasAny = appliedCount > 0;
  const hasSelection = selected !== null;

  // --- Tiny-width fallback driven by the panel root's measured width.
  const rootRef = React.useRef<HTMLDivElement | null>(null);
  const [tiny, setTiny] = React.useState(false);

  React.useEffect(() => {
    const node = rootRef.current;
    if (!node || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width ?? 0;
      setTiny(w > 0 && w < TINY_WIDTH_PX);
    });
    ro.observe(node);
    return () => ro.disconnect();
  }, []);

  // --- Canonical handlers (single source of truth) -----------------
  // Both chip onClicks and command `run` delegate to these via
  // handler refs, matching the pattern in `state/README.md`.

  const handleToggle = React.useCallback(
    (toolId: string) => {
      const sel = useSelectionStore.getState().selected;
      if (!sel) return; // no-op when no cell selected
      useSceneStore.getState().toggleCellTag(sel.x, sel.y, toolId);
    },
    [],
  );

  const handleClearAll = React.useCallback(() => {
    const sel = useSelectionStore.getState().selected;
    if (!sel) return;
    // Snapshot the current tags then toggle each one OFF. We read
    // through getState() rather than closing over `applied` so the
    // callback identity is stable + commands stay accurate.
    const key = cellKey(sel.x, sel.y);
    const cur = useSceneStore.getState().cells[key]?.tags ?? [];
    // Only toggle quick-tool tags — leave user-added tags from the
    // CellInspector untouched. Otherwise this "clear all" would also
    // wipe tags the panel never surfaced as chips.
    const quickIds = new Set<string>(
      (MOCK_QUICK_TOOLS as readonly QuickToolRow[]).map((t) => t.id),
    );
    const toggle = useSceneStore.getState().toggleCellTag;
    for (const tag of cur) {
      if (quickIds.has(tag)) toggle(sel.x, sel.y, tag);
    }
  }, []);

  // --- Command-registry refs ---------------------------------------
  const toggleRef = React.useRef(handleToggle);
  const clearRef = React.useRef(handleClearAll);

  React.useEffect(() => {
    toggleRef.current = handleToggle;
  }, [handleToggle]);
  React.useEffect(() => {
    clearRef.current = handleClearAll;
  }, [handleClearAll]);

  // Static "clear all" command. Registered once on mount.
  React.useEffect(() => {
    return registerCommand({
      id: "scene.quickTools.clear",
      title: "Clear All Quick-Tools",
      category: "Quick-Tool",
      keywords: ["quick", "tool", "clear", "reset", "tags"],
      icon: <X size={14} />,
      run: () => clearRef.current(),
    });
  }, []);

  // Dynamic per-quick-tool toggle commands. Re-registers when the
  // fixture list identity changes; returns an unregister array per
  // `state/README.md`'s "Dynamic registrations" pattern.
  React.useEffect(() => {
    const unregs = (MOCK_QUICK_TOOLS as readonly QuickToolRow[]).map((t) =>
      registerCommand({
        id: `scene.quickTools.tag.toggle.${t.id}`,
        title: `Toggle Quick-Tool: ${t.name}`,
        category: "Quick-Tool",
        keywords: ["quick", "tool", "toggle", "tag", t.name, t.id],
        description: t.description,
        run: () => toggleRef.current(t.id),
      }),
    );
    return () => {
      for (const u of unregs) u();
    };
    // MOCK_QUICK_TOOLS is a module-level constant today; deps stay
    // empty (matches BrushPanel precedent). When this becomes a live
    // store selector, lift it into deps.
  }, []);

  // Outer container is just the `data-panel` hook. DockShell wraps
  // this in `<PanelSurface/>` (raised card with p-2 inner padding),
  // so this wrapper only owns layout (flex column + gap between the
  // eyebrow header and the chip wrap), NOT padding or surface styling.
  // `overflow-x-hidden` guards against the loudest chip label
  // overflowing the container at narrow widths.
  return (
    <div
      ref={rootRef}
      data-panel="quick-tools"
      className="h-full w-full flex flex-col gap-2 overflow-y-auto overflow-x-hidden"
    >
      {tiny ? (
        <div className="flex items-center justify-center h-full text-[10px] text-(--color-fg-muted) text-center px-2">
          Resize panel
        </div>
      ) : (
        <>
          {/*
            Eyebrow header — matches the SCENE-style header pattern used
            across sibling panels (Output / Problems / TilePresets).
            Shows the panel name, an optional applied-count badge, and
            inline Clear button (replaces the trailing × chip that
            used to live in the chip wrap, which felt like an
            ambiguous 11th chip). When no cell is selected the header
            surfaces a brief hint so the disabled chips have context.
          */}
          <div className="flex items-center justify-between gap-1 min-w-0">
            <div className="text-[10px] uppercase tracking-wider text-(--color-fg-muted) truncate">
              {hasSelection ? (
                <>Quick Tools{appliedCount > 0 ? ` (${appliedCount})` : ""}</>
              ) : (
                <>Quick Tools — select a cell</>
              )}
            </div>
            {hasSelection && hasAny ? (
              <Tooltip
                side="top"
                stages={[
                  { delay: 1000, content: <span>Clear all</span> },
                  {
                    delay: 3000,
                    content: (
                      <div>
                        <div className="font-semibold">Clear All</div>
                        <div className="text-[10px] text-(--color-fg-muted) mt-1 max-w-[400px] whitespace-normal">
                          Remove every applied quick-tool tag from the
                          selected cell in one step.
                        </div>
                      </div>
                    ),
                  },
                ]}
              >
                <button
                  type="button"
                  aria-label="Clear all applied quick tools"
                  onClick={handleClearAll}
                  className={[
                    "h-4 w-4 rounded-full",
                    "flex items-center justify-center",
                    "bg-transparent border border-(--color-border)",
                    "text-(--color-fg-muted)",
                    "hover:border-amber-500/60 hover:text-(--color-fg-primary)",
                    "transition-colors",
                  ].join(" ")}
                >
                  <X size={11} aria-hidden="true" />
                </button>
              </Tooltip>
            ) : null}
          </div>

          {/*
            Chip wrap. flex-wrap with gap-1 lets chips reflow naturally:
            single column at very narrow widths, several columns as the
            panel grows. `whitespace-nowrap` on each chip keeps the
            label on one line; combined with the outer
            `overflow-x-hidden` the row wraps instead of forcing a
            horizontal scrollbar.

            Chip pattern matches Output / Problems / TilePresets:
            `rounded-full px-2 py-1 text-[10px] uppercase tracking-wide`.
            The active state is a calm amber tint (mirrors the
            CellInspector tag-chip aesthetic) rather than a full fill,
            so multiple active chips don't visually shout.

            Disabled state (no cell selected): chips dim to muted fg +
            border, lose hover affordance, and `aria-disabled` so AT
            users hear the state. The click handler still no-ops
            defensively via `handleToggle`.
          */}
          <div
            className="flex flex-wrap gap-1"
            role="group"
            aria-label="Quick tools"
          >
            {(MOCK_QUICK_TOOLS as readonly QuickToolRow[]).map((t) => {
              const active = hasSelection && applied.includes(t.id);
              const disabled = !hasSelection;
              return (
                <Tooltip
                  key={t.id}
                  side="top"
                  stages={[
                    { delay: 1000, content: <span>{t.name}</span> },
                    {
                      delay: 3000,
                      content: (
                        <div>
                          <div className="font-semibold">{t.name}</div>
                          <div className="text-[10px] text-(--color-fg-muted) mt-1 max-w-[400px] whitespace-normal">
                            {t.description}
                          </div>
                          {disabled ? (
                            <div className="text-[10px] text-(--color-fg-muted) mt-1 italic">
                              Select a cell to apply this tag.
                            </div>
                          ) : null}
                        </div>
                      ),
                    },
                  ]}
                >
                  <button
                    type="button"
                    aria-label={t.name}
                    aria-pressed={active}
                    aria-disabled={disabled || undefined}
                    disabled={disabled}
                    onClick={() => handleToggle(t.id)}
                    className={[
                      "rounded-full px-2 py-1 text-[10px] uppercase tracking-wide whitespace-nowrap",
                      "border transition-colors",
                      disabled
                        ? "bg-transparent border-(--color-border) text-(--color-fg-muted) opacity-60 cursor-not-allowed"
                        : active
                          ? "bg-amber-500/15 border-amber-500 text-amber-300"
                          : "bg-transparent border-(--color-border-strong) text-(--color-fg-secondary) hover:border-amber-500/60 hover:text-(--color-fg-primary)",
                    ].join(" ")}
                  >
                    {t.name}
                  </button>
                </Tooltip>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

export const MANIFEST: Pick<DockPanelDef, "id" | "title" | "icon"> = {
  id: "quick-tools",
  title: "Quick Tools",
  icon: <Wrench size={12} />,
};

export default QuickToolsPanel;

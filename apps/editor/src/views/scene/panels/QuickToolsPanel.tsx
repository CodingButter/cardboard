import React from "react";
import { Wrench, X } from "lucide-react";
import type { DockPanelDef } from "../../../components/dock/DockShell";
import { Tooltip } from "../../../components/ui/Tooltip";
import { registerCommand } from "../../../state/useCommandStore";
import { MOCK_QUICK_TOOLS, type QuickToolRow } from "../scene-fixtures";

/**
 * QuickToolsPanel — chip strip of one-tap tag/tool toggles.
 *
 * Visual target: the QUICK TOOLS pill row in `Editor Design/Map.png`'s
 * left column. Each chip is a quick-apply tag (solid, door, trigger,
 * spawn, exit, secret, ambush-cover, decor, lit, loot). Clicking a
 * chip toggles whether that tag is "applied" to the current
 * selection. Wave 3 will hook this into the real selection store —
 * for now the applied set persists per-page in localStorage.
 *
 * Persistence contract (page-scope localStorage):
 *   - `cardboard.scene.quickTools.applied`  JSON string[], default [].
 *
 * Command-registry contract: every clickable affordance ALSO exists
 * as a runtime-registered command so the command palette + global
 * keybinding handler can drive the same actions. Per-tool toggles are
 * registered dynamically; "clear all" is a single static command.
 */

const LS_APPLIED = "cardboard.scene.quickTools.applied";

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

function readJSON<T>(key: string, fallback: T): T {
  const raw = readLS(key);
  if (raw == null) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function writeJSON(key: string, value: unknown): void {
  try {
    writeLS(key, JSON.stringify(value));
  } catch {
    /* JSON.stringify can throw on circular refs — defensive only */
  }
}

/** Sanitize the persisted applied list: drop ids that no longer exist
 *  in the fixture (resilient to fixture edits across reloads). */
function reconcileApplied(stored: readonly string[]): string[] {
  const known = new Set<string>(
    (MOCK_QUICK_TOOLS as readonly QuickToolRow[]).map((t) => t.id),
  );
  const seen = new Set<string>();
  const out: string[] = [];
  for (const id of stored) {
    if (known.has(id) && !seen.has(id)) {
      seen.add(id);
      out.push(id);
    }
  }
  return out;
}

export function QuickToolsPanel(): React.JSX.Element {
  const [applied, setApplied] = React.useState<string[]>(() =>
    reconcileApplied(readJSON<string[]>(LS_APPLIED, [])),
  );

  // Persist on every change.
  React.useEffect(() => {
    writeJSON(LS_APPLIED, applied);
  }, [applied]);

  // --- Canonical handlers (single source of truth) -----------------
  // Both chip onClicks and command `run` delegate to these via
  // handler refs, matching the pattern in `state/README.md`.

  const handleToggle = React.useCallback((toolId: string) => {
    setApplied((cur) => {
      if (cur.includes(toolId)) return cur.filter((id) => id !== toolId);
      return [...cur, toolId];
    });
  }, []);

  const handleClearAll = React.useCallback(() => {
    setApplied([]);
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
      id: "scene.quickTool.clear",
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
        id: `scene.quickTool.toggle.${t.id}`,
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

  const appliedCount = applied.length;
  const hasAny = appliedCount > 0;

  // Outer container is just the `data-panel` hook. DockShell wraps
  // this in `<PanelSurface/>` (raised card with p-2 inner padding),
  // so this wrapper only owns layout (flex column + gap between the
  // header readout and the chip wrap), NOT padding or surface styling.
  return (
    <div
      data-panel="quick-tools"
      className="h-full w-full flex flex-col gap-2 overflow-y-auto"
    >
      {/*
        Chip wrap + inline clear. flex-wrap with gap-1 lets chips reflow
        naturally: single column at very narrow widths (~120px),
        several columns as the panel grows. Each chip has a small
        min-width so all 10 chips fit in ~2–3 rows inside the default
        Scene-layout panel (~180×80px). `whitespace-nowrap` keeps
        multi-word names ("Ambush Cover") on one line. No horizontal
        scrollbar — the row wraps instead.

        The "Clear all" affordance is rendered as a trailing ghost
        `×` chip inline with the toggle chips, but ONLY when at least
        one chip is applied. This removes the persistent eyebrow +
        button bar (~16–20px of header chrome) that was eating the
        default panel's vertical budget.
      */}
      <div
        className="flex flex-wrap gap-1"
        role="group"
        aria-label="Quick tools"
      >
        {(MOCK_QUICK_TOOLS as readonly QuickToolRow[]).map((t) => {
          const active = applied.includes(t.id);
          return (
            <Tooltip
              key={t.id}
              side="top"
              stages={[
                { delay: 2000, content: <span>{t.name}</span> },
                {
                  delay: 5000,
                  content: (
                    <div>
                      <div className="font-semibold">{t.name}</div>
                      <div className="text-[10px] text-(--color-fg-muted) mt-1 max-w-[220px] whitespace-normal">
                        {t.description}
                      </div>
                    </div>
                  ),
                },
              ]}
            >
              <button
                type="button"
                aria-label={t.name}
                aria-pressed={active}
                onClick={() => handleToggle(t.id)}
                className={[
                  "min-w-[44px] h-5 px-1.5 rounded-full",
                  "text-[9px] uppercase tracking-wide whitespace-nowrap",
                  "flex items-center justify-center",
                  "border transition-colors",
                  active
                    ? "bg-amber-500 border-amber-500 text-zinc-950"
                    : "bg-transparent border-(--color-border-strong) text-(--color-fg-secondary) hover:border-amber-500/60 hover:text-(--color-fg-primary)",
                ].join(" ")}
              >
                {t.name}
              </button>
            </Tooltip>
          );
        })}
        {hasAny ? (
          <Tooltip
            side="top"
            stages={[
              {
                delay: 2000,
                content: <span>Clear all ({appliedCount})</span>,
              },
              {
                delay: 5000,
                content: (
                  <div>
                    <div className="font-semibold">Clear All Quick-Tools</div>
                    <div className="text-[10px] text-(--color-fg-muted) mt-1 max-w-[220px] whitespace-normal">
                      Remove every applied quick-tool tag from the current
                      selection in one step.
                    </div>
                  </div>
                ),
              },
            ]}
          >
            <button
              type="button"
              aria-label={`Clear all quick-tools (${appliedCount} applied)`}
              onClick={handleClearAll}
              className={[
                "h-5 w-5 rounded-full",
                "flex items-center justify-center",
                "bg-transparent border border-(--color-border)",
                "text-(--color-fg-muted)",
                "hover:border-amber-500/60 hover:text-(--color-fg-primary)",
                "transition-colors",
              ].join(" ")}
            >
              <X size={10} aria-hidden="true" />
            </button>
          </Tooltip>
        ) : null}
      </div>
    </div>
  );
}

export const MANIFEST: Pick<DockPanelDef, "id" | "title" | "icon"> = {
  id: "quick-tools",
  title: "Quick Tools",
  icon: <Wrench size={12} />,
};

export default QuickToolsPanel;
